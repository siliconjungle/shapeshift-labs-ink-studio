/* Shutter curves map equal-energy samples to positions on the exposure clock. */
const ProgrammableExposure = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const integer = (n, min, max) => Number.isSafeInteger(n) && finite(n, min, max);
  const fields = ['duration', 'offset', 'curve', 'steps', 'scan'];
  const box = [[0, 1], [1, 1]], triangle = [[0, 0], [.5, 1], [1, 0]];
  function record(value, accepted, label) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        accepted && Object.keys(value).some(key => !accepted.includes(key))) throw new TypeError('Invalid ' + label);
  }
  function profile(value, inherited) {
    if (value === false) value = { curve: 'hold', scan: false, offset: 0 };
    record(value, fields, 'shutter profile');
    const { duration = inherited?.duration ?? 1 / 30, offset = inherited?.offset ?? 0,
      curve = inherited?.curve ?? 'box', steps = inherited?.steps, scan = inherited?.scan ?? true } = value;
    if (!finite(duration, 0, 10) || !finite(offset, -10, 10) || steps !== undefined && !integer(steps, 1, 32) || typeof scan !== 'boolean')
      throw new RangeError('Shutter needs bounded seconds, 1–32 optional exposure steps, and a boolean scan');
    if (curve === 'hold') return { duration, offset, curve, steps, scan, position: () => 0 };
    const points = curve === 'box' ? box : curve === 'triangle' ? triangle : curve;
    if (!Array.isArray(points) || points.length < 2 || points.length > 32 ||
        !Array.from(points).every((key, index) => Array.isArray(key) && key.length === 2 &&
          finite(key[0], 0, 1) && finite(key[1], 0, 1e6) && (index === 0 || key[0] > points[index - 1][0])) ||
        points[0][0] !== 0 || points.at(-1)[0] !== 1) throw new RangeError('Shutter curve needs increasing [phase, weight] knots from 0 to 1');
    let area = 0;
    const segments = points.slice(1).map(([end, right], i) => {
      const [start, left] = points[i], mass = (end - start) * (left + right) / 2;
      const segment = { start, end, left, right, mass, before: area };
      area += mass;
      return segment;
    }).filter(segment => segment.mass > 0);
    if (!(area > 0)) throw new RangeError('Shutter curve must open for part of the exposure');
    function position(phase) {
      const energy = phase * area;
      const segment = segments.find(s => energy < s.before + s.mass) ?? segments.at(-1);
      const { start, end, left, right, mass, before } = segment;
      const goal = (energy - before) / mass;
      const sum = left + right, a = left / sum, b = right / sum;
      const u = goal <= 0 ? 0 : goal / (a + Math.sqrt(Math.max(0, a*a + (b-a)*goal)));
      let x = start + (end - start) * Math.min(1, u);
      if (steps !== undefined) x = (Math.min(steps - 1, Math.floor(x * steps)) + .5) / steps;
      return (x - .5) * duration;
    }
    return { duration, offset, curve, steps, scan, position };
  }

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    record(value, [...fields, 'samples', 'rolling', 'targets', 'passes', 'space'], 'programmable exposure');
    const { samples = 8, rolling, targets = [], passes = {}, space = 'linear', ...definition } = value;
    if (!integer(samples, 1, 32) || !['linear', 'display'].includes(space) ||
        !Array.isArray(targets) || targets.length > 12) throw new RangeError('Exposure needs 1–32 samples, a color space, and at most 12 targets');
    const main = profile(definition);
    let scan = { duration: 0, bands: 1, direction: 'down' };
    if (rolling !== undefined && rolling !== false) {
      record(rolling, ['duration', 'bands', 'direction'], 'rolling shutter');
      const { duration, bands = 8, direction = 'down' } = rolling;
      if (!finite(duration, 0, 10) || !integer(bands, 1, 16) || !['down', 'up', 'right', 'left'].includes(direction))
        throw new RangeError('Rolling shutter needs bounded seconds, 1–16 bands and a scan direction');
      if (duration > 0) scan = { duration, bands, direction };
    }
    const selected = Array.from(targets, rule => {
      record(rule, ['select', 'shutter'], 'shutter target');
      return { select: selectors.prepare(rule.select), profile: profile(rule.shutter, main) };
    });
    record(passes, undefined, 'shutter passes');
    const layers = Object.entries(passes);
    if (layers.length > 8 || layers.some(([id]) => !id.trim() || id === 'scene')) throw new RangeError('Exposure supports up to eight named graph passes');
    return { main, samples, rolling: scan, targets: selected, passes: new Map(layers.map(([id, value]) => [id, profile(value, main)])), space };
  }

  function schedule({ samples, rolling }, profiles, time) {
    if (!Number.isFinite(time)) throw new RangeError('Exposure needs a finite frame time');
    const { bands, duration, direction } = rolling;
    const reverse = direction === 'up' || direction === 'left';
    return Array.from({ length: bands }, (_, band) => {
      const sweep = ((band + .5) / bands - .5) * duration * (reverse ? -1 : 1);
      const entries = new Map();
      for (let i = 0; i < samples; i++) {
        const phase = (i + .5) / samples;
        const times = profiles.map(profile => Math.max(0, time + profile.offset + profile.position(phase) + (profile.scan ? sweep : 0)));
        const key = times.join(',');
        const entry = entries.get(key);
        if (entry) entry.weight += 1 / samples;
        else entries.set(key, { times, weight: 1 / samples });
      }
      return { band, entries: [...entries.values()] };
    });
  }

  const decode = Float64Array.from({ length: 256 }, (_, index) => {
    const value = index / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const encode = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  const byte = n => Math.round(Math.max(0, Math.min(1, n)) * 255);
  function accumulate(width, height, channels, plan) {
    if (!integer(width, 1, 8192) || !integer(height, 1, 8192) || width * height > 2e6 || ![1, 4].includes(channels))
      throw new RangeError('Exposure supports masks and RGBA on grids up to two million pixels');
    const { bands, direction } = plan.rolling;
    const vertical = direction === 'up' || direction === 'down', extent = vertical ? height : width;
    const data = new Float64Array(width * height * channels), linear = plan.space === 'linear';
    let active = true;
    function add(image, band, weight) {
      if (!active || image.width !== width || image.height !== height || image.channels !== channels ||
          !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) || image.data.length !== data.length ||
          !integer(band, 0, bands - 1) || !finite(weight, 0, 1 + 1e-12)) throw new RangeError('Exposure samples must share the byte raster grid and a valid band weight');
      const first = Math.ceil(extent * band / bands - .5), end = Math.ceil(extent * (band + 1) / bands - .5);
      const x0 = vertical ? 0 : first, x1 = vertical ? width : end;
      const y0 = vertical ? first : 0, y1 = vertical ? end : height;
      const input = image.data;
      for (let y = y0; y < y1; y++) for (let x = x0, p = (y * width + x) * channels; x < x1; x++, p += channels) {
        if (channels === 1) data[p] += input[p] * weight / 255;
        else {
          const alpha = input[p + 3] * weight / 255;
          for (let c = 0; c < 3; c++) data[p + c] += alpha * (linear ? decode[input[p + c]] : input[p + c] / 255);
          data[p + 3] += alpha;
        }
      }
    }
    function finish() {
      active = false;
      const output = new Uint8Array(data.length);
      if (channels === 1) for (let i = 0; i < data.length; i++) output[i] = byte(data[i]);
      else for (let p = 0; p < data.length; p += 4) {
        const alpha = data[p + 3];
        output[p + 3] = byte(alpha);
        if (output[p + 3]) for (let c = 0; c < 3; c++) {
          const value = data[p + c] / alpha;
          output[p + c] = byte(linear ? encode(value) : value);
        }
      }
      return { width, height, channels, data: output };
    }
    return { add, finish };
  }
  return Object.freeze({ prepare, schedule, accumulate });
})();
if (typeof module !== 'undefined') module.exports = ProgrammableExposure;
