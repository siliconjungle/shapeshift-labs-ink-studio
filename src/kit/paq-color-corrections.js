/* Typed material corrections. All arithmetic uses decoded, straight samples. */
const TypedImageCorrections = ({
  requireImage, descriptor, wrap, storage, pack, alphaAt, integerMax, convertColor, luminance
}) => {
  const finite = Number.isFinite;
  const clamp = n => Math.max(0, Math.min(1, n));
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const tuple = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(finite);
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const smooth = t => t * t * (3 - 2 * t);
  const fade = (distance, softness) => distance <= 0 ? 1 : softness ? 1 - smooth(clamp(distance / softness)) : 0;
  const range = value => tuple(value, 2) && value[1] > value[0] && finite(value[1] - value[0]);
  const maxQuantileSamples = 16777216;

  function frame(source, colorOnly = false) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const color = spec.intent === 'color';
    if (!color && (colorOnly || grid.channels !== 1 || !['data', 'mask', 'height'].includes(spec.intent)))
      throw new TypeError('Material correction needs a typed ' + (colorOnly ? 'color image' : 'color image or scalar plane'));
    const divisor = integerMax(spec.precision) || 1;
    return { source, grid, spec, color, components: color ? 3 : 1,
      read(space = spec.colorSpace) {
        const decode = color && convertColor(spec, space);
        return decode ? (i, out) => decode(grid.data, i, out) : (i, out) => {
          out[0] = grid.data[i] / divisor;
          return 1;
        };
      }
    };
  }

  function apply(input, options, grade, space = input.spec.colorSpace) {
    const { grid, spec, color, components } = input;
    const { precision = spec.precision, outOfRange = 'clamp' } = options;
    if (!['clamp', 'error'].includes(outOfRange)) throw new TypeError('Unknown material correction range policy');
    if (!grade && precision === spec.precision) return input.source;
    const result = descriptor(grid, { ...spec, precision, domain: undefined });
    const { width, height, channels, pivot, data } = grid;
    const output = new storage[precision](data.length);
    const read = input.read(space);
    const destination = result.domain === 'unit' ? { space: spec.colorSpace, outOfRange } : spec.colorSpace;
    const encode = color && ColorSpace.prepare(space, destination);
    const sameSpace = space === spec.colorSpace;
    const encodeNative = sameSpace ? encode : color && ColorSpace.prepare(spec.colorSpace, destination);
    const readNative = sameSpace ? read : input.read();
    const rgb = [0, 0, 0], adjusted = [0, 0, 0];
    const hasAlpha = spec.alpha !== 'none';
    for (let i = 0; i < data.length; i += channels) {
      const alpha = alphaAt(data, i, spec);
      if (hasAlpha) output[i + 3] = pack(alpha, result, true, 'error');
      let changed = false;
      if (grade && alpha) {
        read(i, rgb);
        changed = grade(rgb, adjusted) !== false;
      }
      if (!changed && precision === spec.precision) {
        for (let c = 0; c < components; c++) output[i + c] = data[i + c];
        continue;
      }
      if (changed) {
        if (encode) encode(adjusted, adjusted);
      } else {
        readNative(i, adjusted);
        if (encodeNative) encodeNative(adjusted, adjusted);
      }
      const association = spec.alpha === 'premultiplied' ? output[i + 3] ? alpha : 0 : 1;
      for (let c = 0; c < components; c++)
        output[i + c] = pack(association ? adjusted[c] * association : 0, result, false, outOfRange);
    }
    return wrap({ width, height, channels, pivot, data: output }, result);
  }

  const each = (input, options, operation, space) => apply(input, options, (rgb, out) => {
    for (let c = 0; c < input.components; c++) out[c] = operation(rgb[c]);
  }, space);

  function measure(input, channel) {
    if (!['all', 'luminance', 'r', 'g', 'b', 'alpha', 'value'].includes(channel) ||
        (input.color ? channel === 'value' : !['all', 'luminance', 'value'].includes(channel)))
      throw new RangeError('Material correction channel does not match the image');
    const { grid, components, spec } = input;
    const read = input.read(channel === 'luminance' && input.color ? 'srgb-linear' : spec.colorSpace);
    const component = ['r', 'g', 'b'].indexOf(channel);
    const rgb = [0, 0, 0];
    function at(i, alpha) {
      if (channel === 'alpha') return alpha;
      read(i, rgb);
      return channel === 'luminance' && input.color ? luminance(rgb) : rgb[Math.max(0, component)];
    }
    function visit(callback, includeTransparent = false) {
      for (let i = 0; i < grid.data.length; i += grid.channels) {
        const alpha = alphaAt(grid.data, i, spec);
        if (!alpha && !includeTransparent) continue;
        if (channel === 'all') {
          read(i, rgb);
          for (let c = 0; c < components; c++) callback(rgb[c]);
        } else callback(at(i, alpha));
      }
    }
    return { at, visit };
  }

  function histogramStats(input, { channel = 'luminance', bins = 256, range: domain = [0, 1], includeTransparent = false } = {}) {
    if (!Number.isSafeInteger(bins) || bins < 2 || bins > 4096 || !range(domain) || typeof includeTransparent !== 'boolean')
      throw new RangeError('Material histogram needs 2–4096 bins, an increasing finite range and a boolean transparency flag');
    const [low, high] = domain, counts = Array(bins).fill(0);
    let count = 0, below = 0, above = 0, min = Infinity, max = -Infinity, inMin = Infinity, inMax = -Infinity;
    measure(input, channel).visit(value => {
      if (!finite(value)) throw new RangeError('Material histogram needs finite decoded samples');
      count++;
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (value < low) below++;
      else if (value > high) above++;
      else {
        inMin = Math.min(inMin, value);
        inMax = Math.max(inMax, value);
        counts[Math.min(bins - 1, Math.floor((value - low) / (high - low) * bins))]++;
      }
    }, includeTransparent);
    return { channel, range: domain.slice(), counts, count, below, above, min: count ? min : null, max: count ? max : null,
      inRange: count > below + above ? [inMin, inMax] : null };
  }

  function levelsCurve({ inputRange: input = [0, 1], outputRange: output = [0, 1], gamma = 1 } = {}) {
    const exponent = 1 / gamma;
    if (!range(input) || !tuple(output, 2) || !finite(output[1] - output[0]) || !finite(gamma) || gamma <= 0 || !finite(exponent))
      throw new RangeError('Material levels need finite input and output ranges and positive gamma');
    return value => mix(output[0], output[1], clamp((value - input[0]) / (input[1] - input[0])) ** exponent);
  }

  function levels(source, options = {}) {
    return each(frame(source), options, levelsCurve(options));
  }

  function autoLevels(source, options = {}) {
    const input = frame(source), { channel = 'all', percentiles = [.01, .99] } = options;
    if (!range(percentiles) || !percentiles.every(unit)) throw new RangeError('Auto levels needs increasing percentiles from 0 to 1');
    const read = measure(input, channel), endpoints = percentiles[0] === 0 && percentiles[1] === 1;
    let count = 0, min = Infinity, max = -Infinity;
    read.visit(value => {
      if (!finite(value)) throw new RangeError('Auto levels needs finite decoded samples');
      min = Math.min(min, value);
      max = Math.max(max, value);
      count++;
    });
    let bounds = count ? [min, max] : null;
    if (bounds && !endpoints && min !== max) {
      if (count > maxQuantileSamples) throw new RangeError('Exact auto levels exceeds its percentile sample budget. Use [0, 1] percentiles.');
      const values = new Float64Array(count);
      let index = 0;
      read.visit(value => { values[index++] = value; });
      values.sort();
      bounds = percentiles.map(p => {
        const position = p * (count - 1), low = Math.floor(position), high = Math.ceil(position);
        return mix(values[low], values[high], position - low);
      });
    }
    const flat = bounds === null || bounds[0] === bounds[1];
    const grade = levelsCurve({ ...options, inputRange: flat ? [0, 1] : bounds });
    const value = flat ? apply(input, options) : each(input, options, grade);
    return { value, report: { channel, percentiles: percentiles.slice(), bounds, count, flat } };
  }

  function histogramAdjust(source, options = {}) {
    const input = frame(source);
    const { mode = 'equalize', range: domain = [0, 1], bins = 256, position = .5, span = .5, softness = 0, offset = 0 } = options;
    if (!range(domain) || !finite(position) || !finite(span) || span <= 0 || !finite(offset) || !finite(softness) || softness < 0)
      throw new RangeError('Invalid material histogram adjustment range or controls');
    const [low, high] = domain;
    const start = position - span / 2, end = position + span / 2;
    switch (mode) {
      case 'range': return each(input, options, levelsCurve({ inputRange: domain, outputRange: [start, end] }));
      case 'shift': return each(input, options, value => {
        if (!offset || value < low || value > high) return value;
        const period = high - low, phase = ((value - low) / period + (offset % period) / period) % 1;
        return mix(low, high, phase < 0 ? phase + 1 : phase);
      });
      case 'scan': return each(input, options, value => fade(position - value, softness));
      case 'select': return each(input, options, value => fade(Math.max(start - value, value - end), softness));
      case 'equalize': {
        const { counts, count, below, above, inRange } = histogramStats(input, { channel: 'all', range: domain, bins });
        const nonempty = counts.find(n => n > 0), span = count - below - above - nonempty;
        if (!(span > 0)) return apply(input, options);
        let sum = 0;
        const cdf = counts.map(n => {
          sum += n;
          return clamp((sum - nonempty) / span);
        });
        return each(input, options, value => {
          if (value < low || value > high) return value;
          if (value <= inRange[0]) return low;
          if (value >= inRange[1]) return high;
          const bin = Math.max(0, Math.min(bins - 1, (value - low) / (high - low) * bins - .5));
          const left = Math.floor(bin), right = Math.ceil(bin);
          return mix(low, high, mix(cdf[left], cdf[right], bin - left));
        });
      }
      default: throw new RangeError('Unknown material histogram adjustment ' + mode);
    }
  }

  function mask(input, options, select) {
    const { spec, grid: { width, height, data, channels, pivot } } = input;
    const { precision = 'float64', useAlpha = true, invert = false } = options;
    if (typeof useAlpha !== 'boolean' || typeof invert !== 'boolean') throw new TypeError('Invalid material mask controls');
    const target = descriptor({ width, height, channels: 1, data }, { ...spec, intent: 'mask', layout: 'r',
      precision, units: 'unitless', colorSpace: 'none', alpha: 'none', domain: undefined });
    const output = new storage[precision](width * height);
    for (let p = 0, i = 0; p < output.length; p++, i += channels) {
      const alpha = alphaAt(data, i, spec), gate = useAlpha ? alpha : 1;
      if (!gate) continue;
      const weight = select(i, alpha);
      output[p] = pack(gate * (invert ? 1 - weight : weight), target, false, 'clamp');
    }
    return wrap({ width, height, channels: 1, pivot, data: output }, target);
  }

  function threshold(source, options = {}) {
    const input = frame(source);
    const { level = .5, softness = 0, channel = 'luminance' } = options;
    if (!finite(level) || !finite(softness) || softness < 0 || channel === 'all')
      throw new RangeError('Material threshold needs a finite level, softness and one measurement channel');
    const read = measure(input, channel).at;
    return mask(input, options, (i, alpha) => fade(level - read(i, alpha), softness));
  }

  function hueGrade(source, options, hsl) {
    const input = frame(source, true);
    const { degrees = 0, saturation = 1, lightness = 0, valueFactor = 1, inputRange = 'error' } = options;
    if (!finite(degrees) || !finite(saturation) || saturation < 0 || !finite(lightness) || Math.abs(lightness) > 1 ||
        !finite(valueFactor) || valueFactor < 0 || !['error', 'clamp'].includes(inputRange))
      throw new RangeError('Invalid HSL or HSV adjustment');
    const display = input.spec.colorSpace.replace(/-linear$/, '');
    const shift = degrees % 360 / 60;
    if (!shift && saturation === 1 && (hsl ? lightness === 0 : valueFactor === 1) && inputRange === 'error')
      return apply(input, options);
    const convert = ColorSpace.prepare(display, { space: display, outOfRange: inputRange });
    return apply(input, options, (rgb, out) => {
      convert(rgb, rgb);
      const [r, g, b] = rgb, max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
      const hue = !chroma ? 0 : max === r ? (g - b) / chroma : max === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
      const level = hsl ? (max + min) / 2 : max;
      const denominator = hsl ? 1 - Math.abs(2 * level - 1) : level;
      const sat = denominator ? clamp(chroma / denominator * saturation) : 0;
      const next = clamp(hsl ? level + lightness : level * valueFactor);
      const strength = (hsl ? 1 - Math.abs(2 * next - 1) : next) * sat;
      const angle = ((hue + shift) % 6 + 6) % 6, sector = Math.floor(angle);
      const middle = strength * (1 - Math.abs(angle % 2 - 1)), base = next - strength / (hsl ? 2 : 1);
      out[0] = base + (sector === 0 || sector === 5 ? strength : sector === 1 || sector === 4 ? middle : 0);
      out[1] = base + (sector === 1 || sector === 2 ? strength : sector === 0 || sector === 3 ? middle : 0);
      out[2] = base + (sector === 3 || sector === 4 ? strength : sector === 2 || sector === 5 ? middle : 0);
    }, display);
  }

  function exposure(source, options = {}) {
    const input = frame(source), { stops = 0 } = options, gain = 2 ** stops;
    if (!finite(stops) || !finite(gain)) throw new RangeError('Material exposure needs finite stops and gain');
    const native = input.spec.colorSpace, space = input.color && !native.endsWith('-linear') ? native + '-linear' : native;
    return stops === 0 ? apply(input, options) : each(input, options, value => value * gain, space);
  }

  function contrast(source, options = {}) {
    const { factor = 1, pivot = .5 } = options;
    if (!finite(factor) || factor < 0 || !finite(pivot)) throw new RangeError('Material contrast needs a nonnegative factor and finite pivot');
    const input = frame(source);
    return factor === 1 ? apply(input, options) : each(input, options, value => pivot + (value - pivot) * factor);
  }

  function invert(source, options = {}) {
    const { pivot = .5 } = options;
    if (!finite(pivot)) throw new RangeError('Material inversion needs a finite pivot');
    return each(frame(source), options, value => pivot + (pivot - value));
  }

  function swatch(value, space) {
    return tuple(value, 3) ? value.slice() : ColorSpace.convert(ColorCurves.color(value), 'srgb', space);
  }

  function posterize(source, options = {}) {
    const { steps = 4, range: domain = [0, 1], palette } = options;
    const input = frame(source, palette !== undefined);
    if (palette !== undefined) {
      if (!Array.isArray(palette) || !palette.length || palette.length > 256 ||
          palette.length * input.grid.width * input.grid.height > 64e6)
        throw new RangeError('Material posterize needs a palette within its swatch visit budget');
      const entries = Array.from(palette, color => swatch(color, input.spec.colorSpace));
      return apply(input, options, (rgb, out) => {
        const selected = entries[PixelLook.nearest(rgb, entries, false)];
        for (let c = 0; c < 3; c++) out[c] = selected[c];
      });
    }
    if (!Number.isSafeInteger(steps) || steps < 2 || steps > 65536 || !range(domain))
      throw new RangeError('Material posterize needs 2–65536 steps and an increasing finite range');
    const [low, high] = domain;
    return each(input, options, value => mix(low, high, Math.round(clamp((value - low) / (high - low)) * (steps - 1)) / (steps - 1)));
  }

  function colorMatch(input, from, options) {
    const { metric = 'perceptual', tolerance = .04, softness = 0 } = options;
    if (!['rgb', 'perceptual', 'chroma'].includes(metric) || !finite(tolerance) || tolerance < 0 ||
        !finite(softness) || softness < 0)
      throw new RangeError('Invalid material color selection metric, tolerance or softness');
    const toSrgb = metric !== 'rgb' && ColorSpace.prepare(input.spec.colorSpace, 'srgb');
    const converted = [0, 0, 0];
    const feature = rgb => toSrgb ? ColorSpace.toOKLab(toSrgb(rgb, converted)) : rgb;
    const target = feature(swatch(from, input.spec.colorSpace));
    return rgb => {
      const point = feature(rgb);
      const distance = Math.hypot(metric === 'chroma' ? 0 : point[0] - target[0], point[1] - target[1], point[2] - target[2]);
      const error = 8 * Number.EPSILON * Math.max(1, Math.abs(target[0]), Math.abs(target[1]), Math.abs(target[2]));
      return fade(distance - tolerance - error, softness);
    };
  }

  function colorSelect(source, color, options = {}) {
    const input = frame(source, true), read = input.read(), select = colorMatch(input, color, options), rgb = [0, 0, 0];
    return mask(input, options, i => { read(i, rgb); return select(rgb); });
  }

  function colorReplace(source, from, to, options = {}) {
    const input = frame(source, true), { amount = 1 } = options;
    if (!unit(amount)) throw new RangeError('Material color replacement amount needs to be in [0, 1]');
    const select = colorMatch(input, from, options), replacement = swatch(to, input.spec.colorSpace);
    return apply(input, options, (rgb, out) => {
      const weight = amount * select(rgb);
      if (!weight) return false;
      for (let c = 0; c < 3; c++) out[c] = mix(rgb[c], replacement[c], weight);
    });
  }

  return Object.freeze({
    levels, autoLevels, histogram: (source, options) => histogramStats(frame(source), options), histogramAdjust,
    hsl: (source, options = {}) => hueGrade(source, options, true),
    hsv: (source, options = {}) => hueGrade(source, options, false),
    exposure, contrast, threshold, invert, posterize, colorSelect, colorReplace
  });
};
