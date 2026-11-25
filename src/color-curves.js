/* Numeric transfer curves and RGB ramps shared by scene and surface looks. */
const ColorCurves = (() => {
  let spaces;
  try { spaces = ColorSpace; } catch { spaces = require('./color-space.js'); }
  const modes = ['step', 'linear', 'smooth'];
  const interpolations = [...modes, 'bezier'];
  const channels = ['red', 'green', 'blue'];
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const clamp = n => Math.max(0, Math.min(1, n));
  const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const luminance = rgb => .30 * rgb[0] + .55 * rgb[1] + .15 * rgb[2];
  const mix = (a, b, t) => a * (1 - t) + b * t;

  function segmentIndex(stops, value) {
    let low = 0, high = stops.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (stops[mid].at < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function weight(mode, t) {
    return mode === 'step' ? 0 : mode === 'smooth' ? t * t * (3 - 2 * t) : t;
  }

  function bezierParameter(value, a, b) {
    let lo = 0, hi = 1, t = value;
    for (let i = 0; i < 40; i++) {
      const q = 1 - t;
      const error = t * (3 * q * (q * a + t * b) + t * t) - value;
      if (Math.abs(error) <= 1e-13) break;
      if (error < 0) lo = t;
      else hi = t;
      const derivative = 3 * (q * q * a + 2 * q * t * (b - a) + t * t * (1 - b));
      const guess = t - error / derivative;
      t = guess > lo && guess < hi ? guess : (lo + hi) / 2;
    }
    return t;
  }

  function cubic(a, b, c, d, t) {
    const ab = mix(a, b, t), bc = mix(b, c, t), cd = mix(c, d, t);
    return mix(mix(ab, bc, t), mix(bc, cd, t), t);
  }

  function sampler(definition, convert, blend, normalized = false, scalar = false) {
    if (!object(definition) || Object.keys(definition).some(key => !['stops', 'interpolation', 'address'].includes(key)))
      throw new TypeError('A color ramp or curve needs stops, optional interpolation and addressing');
    const { stops, interpolation = 'linear', address = 'clamp' } = definition;
    if (!interpolations.includes(interpolation) || !['clamp', 'repeat'].includes(address) ||
        !Array.isArray(stops) || stops.length < 2 || stops.length > 256)
      throw new RangeError('Use 2–256 stops, step, linear, smooth or bezier interpolation, and clamp or repeat addressing');
    const ids = new Set();
    const points = Array.from(stops, row => {
      const point = Array.isArray(row) && row.length === 2 ? { at: row[0], value: row[1] } : row;
      if (!object(point) || Object.keys(point).some(key => !['id', 'at', 'value', 'interpolation', 'in', 'out'].includes(key)) ||
          !Object.hasOwn(point, 'value') || !Number.isFinite(point.at) || normalized && !unit(point.at))
        throw new RangeError('Curve stop coordinates must be finite and strictly increasing');
      const { id, at, value, interpolation: mode = interpolation, in: incoming, out: outgoing } = point;
      if (id !== undefined && (typeof id !== 'string' || !/^[A-Za-z][\w.-]{0,99}$/.test(id) || ids.has(id)))
        throw new TypeError('Curve stop IDs must be unique and valid');
      if (!interpolations.includes(mode)) throw new RangeError('Unknown curve segment interpolation ' + mode);
      for (const handle of [incoming, outgoing]) {
        if (handle !== undefined && (!Array.isArray(handle) || handle.length !== 2 ||
          !Number.isFinite(handle[0]) || !(scalar && !normalized ? Number.isFinite(handle[1]) : unit(handle[1]))))
          throw new TypeError('Curve handles need a finite input coordinate and a valid output coordinate');
      }
      if (id !== undefined) ids.add(id);
      return { at, value: convert(value), mode, incoming: incoming?.slice(), outgoing: outgoing?.slice() };
    });
    const min = points[0].at, max = points.at(-1).at, period = max - min;
    if (address === 'repeat' && !Number.isFinite(period)) throw new RangeError('Curve stop span must be finite');
    const segments = points.slice(0, -1).map((a, i) => {
      const b = points[i + 1], width = b.at - a.at;
      if (width <= 0 || !Number.isFinite(width)) throw new RangeError('Curve stop coordinates must be finite and strictly increasing');
      if (a.mode !== 'bezier') return (x, out) => blend(a.value, b.value, weight(a.mode, x), out);
      const x1 = a.outgoing ? (a.outgoing[0] - a.at) / width : 1 / 3;
      const x2 = b.incoming ? (b.incoming[0] - a.at) / width : 2 / 3;
      if (!unit(x1) || !unit(x2) || x1 > x2) throw new RangeError('Bezier handles must be ordered inside their segment');
      const ay = scalar ? a.value : 0, by = scalar ? b.value : 1;
      const y1 = a.outgoing?.[1] ?? mix(ay, by, 1 / 3);
      const y2 = b.incoming?.[1] ?? mix(ay, by, 2 / 3);
      return (x, out) => {
        const y = cubic(ay, y1, y2, by, bezierParameter(x, x1, x2));
        return scalar ? y : blend(a.value, b.value, y, out);
      };
    });
    return (value, out) => {
      if (!Number.isFinite(value)) throw new RangeError('Curve input must be finite');
      if (address === 'repeat' && (value < min || value >= max)) {
        const distance = value - min;
        const phase = Number.isFinite(distance) ? distance % period / period :
          ((value % period) / period - (min % period) / period) % 1;
        value = mix(min, max, phase < 0 ? phase + 1 : phase);
      }
      const high = segmentIndex(points, value), b = points[high];
      if (!high || value >= b.at) return blend(b.value, b.value, 0, out);
      const a = points[high - 1];
      return segments[high - 1]((value - a.at) / (b.at - a.at), out);
    };
  }

  function scalar(definition, normalized = false) {
    return sampler(definition, value => {
      if (!(normalized ? unit(value) : Number.isFinite(value)))
        throw new RangeError(normalized ? 'RGB curve outputs must be in [0, 1]' : 'Curve outputs must be finite');
      return value;
    }, mix, normalized, true);
  }

  function color(input) {
    if (Array.isArray(input) && input.length === 3 && Array.from(input).every(unit)) return input.slice();
    const packed = typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? parseInt(input.slice(1), 16) : input;
    if (!Number.isSafeInteger(packed) || packed < 0 || packed > 0xffffff)
      throw new TypeError('Ramp colors need #rrggbb, packed RGB or a normalized RGB triple');
    return [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
  }

  function ramp(definition, resolveColor = color, extended = false) {
    return sampler(definition, value => {
      const rgb = value === undefined ? null : resolveColor(value);
      if (!rgb || rgb.length !== 3 || !Array.from(rgb).every(extended ? Number.isFinite : unit))
        throw new RangeError(extended ? 'Ramp stops need finite RGB colors' : 'Ramp stops need finite RGB colors in [0, 1]');
      return Array.from(rgb);
    }, (a, b, t, out = [0, 0, 0]) => {
      for (let i = 0; i < 3; i++) out[i] = mix(a[i], b[i], t);
      return out;
    });
  }

  function rgba(definition, resolveColor) {
    return sampler(definition, value => {
      const rgba = resolveColor(value);
      if (!Array.isArray(rgba) || rgba.length !== 4 || !Array.from(rgba).every(Number.isFinite) || !unit(rgba[3]))
        throw new RangeError('Ramp pins need finite RGB and unit alpha');
      const a = rgba[3];
      return [rgba[0] * a, rgba[1] * a, rgba[2] * a, a];
    }, (a, b, t, out = [0, 0, 0, 0]) => {
      const coverage = clamp(mix(a[3], b[3], t));
      for (let c = 0; c < 3; c++) out[c] = coverage ? mix(a[c], b[c], t) / coverage : 0;
      out[3] = coverage;
      return out;
    });
  }

  function prepare(definition, resolveColor = color, override) {
    if (definition === undefined || definition === false) return null;
    if (!object(definition) || Object.keys(definition).some(key => !['ramp', 'channels', 'color'].includes(key)))
      throw new TypeError('A color transfer needs a ramp or RGB channel curves');
    const contract = spaces.settings(override === undefined ? definition.color : override);
    const declaredOutput = contract && { ...contract.output, outOfRange: 'preserve' };
    const encodeStop = contract && spaces.prepare(undefined, declaredOutput);
    const passthrough = contract && spaces.prepare(contract.input, declaredOutput);
    const resolveStop = contract ? value => Array.isArray(value) ? value : encodeStop(resolveColor(value)) : resolveColor;
    const tone = definition.ramp === undefined ? null : ramp(definition.ramp, resolveStop, Boolean(contract));
    const settings = definition.channels ?? {};
    if (!object(settings) || Object.keys(settings).some(key => !channels.includes(key)))
      throw new TypeError('Use red, green or blue RGB curves');
    const rgb = channels.map(name => Object.hasOwn(settings, name) ? scalar(settings[name], !contract) : null);
    if (!tone && !rgb.some(Boolean)) throw new TypeError('A color transfer needs a ramp or RGB channel curves');
    const transfer = (input, out = [0, 0, 0], value = luminance(input)) => {
      if (tone) tone(value, out);
      else if (passthrough) passthrough(input, out);
      else for (let i = 0; i < 3; i++) out[i] = clamp(input[i]);
      for (let i = 0; i < 3; i++) if (rgb[i]) out[i] = rgb[i](contract && !tone ? input[i] : out[i]);
      return out;
    };
    return spaces.wrap(transfer, contract);
  }

  return Object.freeze({ color, scalar, ramp, rgba, prepare, luminance, segmentIndex, weight, modes: Object.freeze(modes) });
})();
if (typeof module !== 'undefined') module.exports = ColorCurves;
