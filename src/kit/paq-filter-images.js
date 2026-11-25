/* Native material filters. Working samples are float64 and colors are associated with coverage. */
const TypedImageFilters = ({ requireImage, descriptor, wrap, storage, pack, integerMax, convertColor, fields }) => {
  const { weights } = RasterFilterKernels;
  const finite = Number.isFinite;
  const inRange = (n, min, max) => finite(n) && n >= min && n <= max;
  const integer = (n, min, max) => Number.isSafeInteger(n) && inRange(n, min, max);
  const pair = (value, check) => Array.isArray(value) && value.length === 2 && Array.from(value).every(check);
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const unit = value => Math.max(0, Math.min(1, value));
  const edgeModes = ['clamp', 'wrap', 'mirror', 'transparent'];
  const maxVisits = 128000000, maxBytes = 192 * 1024 * 1024;

  function frame(source, options, detail = false, signed = false) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { width, height, channels } = grid, color = spec.intent === 'color';
    const { intensity = 1, border = {}, space = 'linear',
      precision = signed ? 'float64' : spec.precision, outOfRange = signed ? 'error' : 'clamp' } = options;
    if (spec.intent === 'normal' || !color && spec.alpha !== 'none')
      throw new TypeError('Material filters need color or unassociated numeric channels. Split other channels first.');
    if (!inRange(intensity, 0, detail ? 16 : 1) || !['linear', 'native'].includes(space) ||
        !['error', 'clamp'].includes(outOfRange) || signed && space !== 'linear' ||
        typeof border !== 'string' && !fields(border, ['u', 'v']))
      throw new RangeError('Invalid material filter intensity, border, space or range policy');
    const { u = spec.tiling.u, v = spec.tiling.v } = typeof border === 'string' ? { u: border, v: border } : border;
    if (!edgeModes.includes(u) || !edgeModes.includes(v)) throw new RangeError('Unknown material filter border');
    const native = spec.colorSpace;
    const working = color && space === 'linear' && !native.endsWith('-linear') ? native + '-linear' : native;
    const target = descriptor(grid, { ...spec, precision, domain: undefined,
      ...(signed && color && { colorSpace: working }), ...(signed && spec.intent === 'mask' && { intent: 'data' }) });
    return { source, grid, spec, target, color, working, policy: outOfRange, intensity, width, height, channels,
      components: color ? 3 : channels, alpha: color && channels === 4, ax: TextureAddress.axis(u), ay: TextureAddress.axis(v) };
  }

  function checkWork(input, visits, workingBuffers) {
    const { width, height, channels, target } = input;
    const pixels = width * height;
    if (pixels * visits > maxVisits) throw new RangeError('Material filter exceeds its sample budget');
    if (pixels * channels * (8 * workingBuffers + storage[target.precision].BYTES_PER_ELEMENT) > maxBytes)
      throw new RangeError('Material filter exceeds its working memory budget');
  }

  function decode(input) {
    const { grid: { data }, spec, color, working, alpha, channels } = input;
    const out = new Float64Array(data.length), divisor = integerMax(spec.precision) || 1;
    if (!color) {
      for (let i = 0; i < data.length; i++) out[i] = data[i] / divisor;
      return out;
    }
    const read = convertColor(spec, working), rgb = [0, 0, 0];
    for (let i = 0; i < data.length; i += channels) {
      const coverage = read(data, i, rgb);
      if (alpha) out[i + 3] = coverage;
      for (let c = 0; c < 3; c++) out[i + c] = rgb[c] * coverage;
    }
    return out;
  }

  function encode(input, data) {
    const { grid, target, color, working, policy, channels, components, alpha } = input;
    const output = new storage[target.precision](data.length);
    const destination = target.domain === 'unit' ? { space: target.colorSpace, outOfRange: policy } : target.colorSpace;
    const convert = color && ColorSpace.prepare(working, destination), rgb = [0, 0, 0];
    for (let i = 0; i < data.length; i += channels) {
      const coverage = alpha ? unit(data[i + 3]) : 1;
      if (alpha) output[i + 3] = pack(coverage, target, true, 'error');
      if (convert) {
        const covered = !alpha || output[i + 3] > 0;
        for (let c = 0; c < 3; c++) rgb[c] = covered ? data[i + c] / coverage : 0;
        convert(rgb, rgb);
        const association = target.alpha === 'premultiplied' ? coverage : 1;
        for (let c = 0; c < 3; c++) output[i + c] = pack(rgb[c] * association, target, false, policy);
      } else {
        for (let c = 0; c < components; c++) output[i + c] = pack(data[i + c], target, false, policy);
      }
    }
    return wrap({ ...grid, data: output }, target);
  }

  function unchanged(input) {
    if (input.spec.precision === input.target.precision) return input.source;
    checkWork(input, 0, 1);
    return encode(input, decode(input));
  }

  function gather(input, data) {
    const { ax, ay, width, height, channels } = input;
    function at(x, y, gain, out) {
      if (!gain) return;
      const u = ax(x, width), v = ay(y, height);
      if (u < 0 || v < 0) return;
      const offset = (v * width + u) * channels;
      for (let c = 0; c < channels; c++) out[c] += data[offset + c] * gain;
    }
    function linear(x, y, gain, out) {
      const u = Math.floor(x), v = Math.floor(y), fx = x - u, fy = y - v;
      at(u, v, gain * (1 - fx) * (1 - fy), out);
      at(u + 1, v, gain * fx * (1 - fy), out);
      at(u, v + 1, gain * (1 - fx) * fy, out);
      at(u + 1, v + 1, gain * fx * fy, out);
    }
    return { at, linear };
  }

  function pass(input, data, filter) {
    const { width, height, channels } = input;
    const result = new Float64Array(data.length), sum = new Float64Array(channels);
    const { at, linear } = gather(input, data);
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      sum.fill(0);
      filter(x, y, p, sum, at, linear);
      result.set(sum, p * channels);
    }
    return result;
  }

  function vector(angle) {
    if (!finite(angle)) throw new RangeError('Material blur angle must be finite');
    const angleRad = angle % 360 * (Math.PI / 180);
    const snap = n => Math.abs(n) < 1e-15 ? 0 : n;
    return [snap(Math.cos(angleRad)), snap(Math.sin(angleRad))];
  }

  function line(row, direction, spacing = 1) {
    const middle = (row.length - 1) / 2;
    const taps = row.map((gain, i) => {
      const offset = (i - middle) * spacing;
      return [offset * direction[0], offset * direction[1], gain];
    }).filter(tap => tap[2]);
    const aligned = taps.every(([x, y]) => Number.isSafeInteger(x) && Number.isSafeInteger(y));
    return { visits: taps.length * (aligned ? 1 : 4), filter(x, y, _p, sum, at, linear) {
      const read = aligned ? at : linear;
      for (const [dx, dy, weight] of taps) read(x + dx, y + dy, weight, sum);
    } };
  }

  function gaussianPlan(radius, sigma) {
    const row = weights(radius, 'gaussian', sigma);
    return radius ? [line(row, [1, 0]), line(row, [0, 1])] : [];
  }

  function runBlur(input, plans, active = true) {
    if (!active || !input.intensity || !plans.length) return unchanged(input);
    checkWork(input, plans.reduce((total, plan) => total + plan.visits, 0), plans.length > 1 ? 3 : 2);
    const data = decode(input);
    const filtered = plans.reduce((samples, plan) => pass(input, samples, plan.filter), data);
    if (input.intensity !== 1)
      for (let i = 0; i < filtered.length; i++) filtered[i] = mix(data[i], filtered[i], input.intensity);
    return encode(input, filtered);
  }

  function gaussianBlur(source, options = {}) {
    const { radius = 2, sigma } = options;
    return runBlur(frame(source, options), gaussianPlan(radius, sigma));
  }

  function directionalBlur(source, options = {}) {
    const { radius = 4, angle = 0, samples = 17 } = options;
    if (!inRange(radius, 0, 64) || !integer(samples, 2, 65))
      throw new RangeError('Directional blur needs radius 0–64 and 2–65 samples');
    const direction = vector(angle), row = Array(samples).fill(1 / samples);
    return runBlur(frame(source, options), [line(row, direction, 2 * radius / (samples - 1))], radius !== 0);
  }

  function radialBlur(source, options = {}) {
    const input = frame(source, options);
    const { width, height } = input;
    const { radius = 7, center = [.5, .5], mode = 'spin', samples = 17 } = options;
    if (!inRange(radius, 0, 64) || !pair(center, n => inRange(n, 0, 1)) ||
        !['spin', 'zoom'].includes(mode) || !integer(samples, 2, 65))
      throw new RangeError('Radial blur needs radius 0–64, a normalized center, spin or zoom and 2–65 samples');
    const cx = center[0] * width - .5, cy = center[1] * height - .5;
    const reach = Math.max(.5, Math.hypot(Math.max(Math.abs(cx), Math.abs(width - 1 - cx)),
      Math.max(Math.abs(cy), Math.abs(height - 1 - cy))));
    const taps = Array.from({ length: samples }, (_, i) => {
      const t = (2 * i / (samples - 1) - 1) * radius / reach;
      return mode === 'spin' ? [Math.cos(t), Math.sin(t)] : [1 + Math.max(-1, t), 0];
    });
    return runBlur(input, [{ visits: samples * 4, filter(x, y, _p, sum, _at, linear) {
      const dx = x - cx, dy = y - cy;
      for (const [a, b] of taps) linear(cx + dx * a - dy * b, cy + dy * a + dx * b, 1 / samples, sum);
    } }], radius !== 0);
  }

  function anisotropicBlur(source, options = {}) {
    const { radii = [7, 2], angle = 0, sigma } = options;
    const direction = vector(angle);
    if (!pair(radii, n => integer(n, 0, 64)) || sigma !== undefined && !pair(sigma, n => finite(n) && n > 0))
      throw new RangeError('Anisotropic blur needs along/across radii 0–64 and optional positive sigmas');
    const directions = [direction, [-direction[1], direction[0]]];
    const plans = [];
    for (let i = 0; i < 2; i++) if (radii[i]) plans.push(line(weights(radii[i], 'gaussian', sigma?.[i]), directions[i]));
    return runBlur(frame(source, options), plans);
  }

  function variableBlur(source, radiusMap, options = {}) {
    const input = frame(source, options);
    const { radius = 4, sigma } = options;
    const { raster: map, descriptor: spec } = requireImage(radiusMap);
    if (!integer(radius, 0, 16) || map.width !== input.width || map.height !== input.height || map.channels !== 1 ||
        !['mask', 'data'].includes(spec.intent) || spec.units !== 'unitless')
      throw new RangeError('Variable blur needs radius 0–16 and an aligned unitless scalar radius map');
    const divisor = integerMax(spec.precision) || 1, row = weights(radius, 'gaussian', sigma);
    let full = 0, partial = 0;
    for (const value of map.data) {
      const amount = value / divisor;
      if (!inRange(amount, 0, 1)) throw new RangeError('Variable blur radius map samples must be in [0, 1]');
      if (amount === 1) full++;
      else if (amount > 0) partial++;
    }
    if ((!full && !partial) || !radius) return unchanged(input);
    if (full === map.data.length) return runBlur(input, gaussianPlan(radius, sigma));
    const kernelVisits = row.length ** 2;
    const visits = 1 + kernelVisits * (full + 4 * partial) / map.data.length;
    return runBlur(input, [{ visits, filter(x, y, p, sum, at, linear) {
      const amount = map.data[p] / divisor;
      if (!amount) { at(x, y, 1, sum); return; }
      const read = amount === 1 ? at : linear;
      for (let j = 0; j < row.length; j++) for (let i = 0; i < row.length; i++)
        read(x + (i - radius) * amount, y + (j - radius) * amount, row[i] * row[j], sum);
    } }]);
  }

  function detailFilter(source, options, mode) {
    const signed = mode === 'highPass';
    const input = frame(source, options, true, signed);
    const { radius = mode === 'sharpen' ? 1 : 2, sigma, threshold = 0, bias = 0 } = options;
    const { channels, components, alpha, intensity } = input;
    if (!finite(threshold) || threshold < 0 || !finite(bias) || mode === 'sharpen' && !integer(radius, 0, 64))
      throw new RangeError('Invalid detail filter radius, threshold or bias');
    const plans = mode === 'sharpen' ? (radius ? [{ visits: 4, filter(x, y, _p, sum, at) {
      at(x - radius, y, .25, sum);
      at(x + radius, y, .25, sum);
      at(x, y - radius, .25, sum);
      at(x, y + radius, .25, sum);
    } }] : []) : gaussianPlan(radius, sigma);
    if (!signed && (!plans.length || !intensity)) return unchanged(input);
    const activePlans = intensity ? plans : [];
    checkWork(input, activePlans.reduce((total, plan) => total + plan.visits, 0), Math.min(3, activePlans.length + 1));
    const data = decode(input), filtered = activePlans.reduce((samples, plan) => pass(input, samples, plan.filter), data);
    const differences = new Float64Array(components);
    for (let i = 0; i < data.length; i += channels) {
      const coverage = alpha ? data[i + 3] : 1;
      const softCoverage = alpha ? filtered[i + 3] : 1;
      let largest = 0;
      for (let c = 0; c < components; c++) {
        const base = coverage ? data[i + c] / coverage : 0;
        const soft = softCoverage ? filtered[i + c] / softCoverage : base;
        differences[c] = base - soft;
        largest = Math.max(largest, Math.abs(differences[c]));
      }
      const active = largest > threshold ? intensity : 0;
      for (let c = 0; c < components; c++) {
        const change = active * differences[c];
        data[i + c] = signed ? (bias + change) * coverage : data[i + c] + change * coverage;
      }
    }
    return encode(input, data);
  }

  function antialias(source, options = {}) {
    const input = frame(source, options);
    const { radius = .85, threshold = .08 } = options;
    if (!inRange(radius, 0, 2) || !finite(threshold) || threshold < 0)
      throw new RangeError('Antialias needs radius 0–2 and a nonnegative contrast threshold');
    if (!radius || !input.intensity) return unchanged(input);
    checkWork(input, 17, 2);
    const data = decode(input), neighbors = Array.from({ length: 9 }, () => new Float64Array(input.channels));
    const filtered = pass(input, data, (x, y, p, sum, at, linear) => {
      let tap = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const row = neighbors[tap++];
        row.fill(0);
        at(x + dx, y + dy, 1, row);
      }
      const [a, b, c, d, , f, g, h, i] = neighbors;
      let sx = 0, sy = 0, strongest = threshold * 4;
      for (let k = 0; k < input.channels; k++) {
        const gx = c[k] + 2 * f[k] + i[k] - a[k] - 2 * d[k] - g[k];
        const gy = g[k] + 2 * h[k] + i[k] - a[k] - 2 * b[k] - c[k];
        const magnitude = Math.hypot(gx, gy);
        if (magnitude > strongest) { strongest = magnitude; sx = gx; sy = gy; }
      }
      const diagonal = Math.min(Math.abs(sx), Math.abs(sy)) / (Math.max(Math.abs(sx), Math.abs(sy)) || 1);
      const amount = input.intensity * diagonal;
      const offset = p * input.channels;
      for (let k = 0; k < input.channels; k++) sum[k] = data[offset + k] * (1 - amount);
      if (amount) {
        const dx = sx / strongest * radius, dy = sy / strongest * radius;
        linear(x - dx, y - dy, amount / 2, sum);
        linear(x + dx, y + dy, amount / 2, sum);
      }
    });
    return encode(input, filtered);
  }

  return Object.freeze({ gaussianBlur, directionalBlur, radialBlur, anisotropicBlur, variableBlur,
    highPass: (source, options = {}) => detailFilter(source, options, 'highPass'),
    unsharpMask: (source, options = {}) => detailFilter(source, options, 'unsharpMask'),
    sharpen: (source, options = {}) => detailFilter(source, options, 'sharpen'), antialias });
};
