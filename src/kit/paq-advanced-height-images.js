/* Editable bevel, lighting, frequency and wear operations on material height. */
function ShapeBevelProfile(width, height, profile, side) {
  const inside = side === 'outside' ? 0 : width, outside = side === 'inside' ? 0 : width;
  const curve = profile === 'round' ? t => Math.sqrt(t * (2 - t)) : profile === 'smooth' ? t => t * t * (3 - 2 * t) : t => t;
  return distance => height * curve(Math.max(0, Math.min(1, (outside - distance) / (inside + outside))));
}

const AdvancedHeightReader = ({ width, height, data }, tiling, sampler, filter) => {
  const values = new Float64Array(2), axis = [tiling.u, tiling.v].map(TextureAddress.axis);
  const read = sampler({ width, height, accumulate(i, out, weight) {
    out[0] += data[i / 2] * weight;
    out[1] += weight;
  } }, 2, filter, ...axis);
  return (x, y, missing) => {
    values.fill(0);
    read((x + .5) / width, (y + .5) / height, 1, values);
    return values[1] ? values[0] / values[1] : missing;
  };
};

const TypedAdvancedHeight = ({ requireImage, descriptor, wrap, pack, storage, integerMax, fields, alignedGrid,
  borders, sampler, morphology, filters, normals }) => {
  const maxCells = 4e6, visitBudget = 128e6;
  const finite = Number.isFinite;
  const within = (x, lo, hi) => finite(x) && x >= lo && x <= hi;
  const unit = x => Math.max(0, Math.min(1, x));
  const smooth = x => { const t = unit(x); return t * t * (3 - 2 * t); };
  const radians = degrees => degrees % 360 * Math.PI / 180;

  function settings(options, keys) {
    if (!fields(options, keys)) throw new TypeError('Unknown advanced height filter option');
  }

  function frame(source, border) {
    const { raster: grid, descriptor: spec } = requireImage(source, 'height');
    if (grid.width * grid.height > maxCells) throw new RangeError('Advanced height filter exceeds its grid budget');
    return { grid, spec, tiling: borders(border, spec.tiling) };
  }

  function plane({ grid, spec }, data, intent, units, precision) {
    const out = { ...grid, channels: 1, data };
    return wrap(out, descriptor(out, { intent, precision, units, tiling: spec.tiling,
      sampling: spec.sampling, pixelPitchMm: spec.pixelPitchMm, materialSeed: spec.materialSeed }));
  }

  function outputHeight(input, precision, sample) {
    if (!['float32', 'float64'].includes(precision)) throw new RangeError('Height output needs float32 or float64');
    const target = descriptor(input.grid, { ...input.spec, precision });
    const data = new storage[precision](input.grid.width * input.grid.height);
    for (let p = 0; p < data.length; p++) data[p] = pack(sample(p), target, false, 'error');
    return wrap({ ...input.grid, data }, target);
  }

  function spacingFor(spec, spacing) {
    const result = spacing ?? (spec.units === 'mm' ? spec.pixelPitchMm : undefined) ?? [1, 1];
    if (!Array.isArray(result) || result.length !== 2 || !Array.from(result).every(n => finite(n) && n > 0))
      throw new RangeError('Height spacing needs two positive values in the source height units');
    return result;
  }

  function bevel(source, options = {}) {
    settings(options, ['channel', 'threshold', 'invert', 'border', 'width', 'height', 'profile', 'side']);
    const { width = 3, height = 2, profile = 'round', side = 'inside', border = {}, ...selection } = options;
    if (!within(width, .125, 128) || !within(height, -4096, 4096) ||
        !['linear', 'round', 'smooth'].includes(profile) || !['inside', 'outside', 'both'].includes(side))
      throw new RangeError('Invalid bevel width, height, profile or side');
    const distance = morphology.signedDistance(source, { ...selection, border, maxDistance: width + 1 });
    const input = frame(distance, border);
    const sample = ShapeBevelProfile(width,height,profile,side);
    return outputHeight(input, 'float32', p => {
      const n = input.grid.data[p], d = Math.sign(n) * Math.max(0, Math.abs(n) - .5);
      return sample(d);
    });
  }

  function emboss(source, options = {}) {
    settings(options, ['azimuth', 'elevation', 'strength', 'bias', 'border', 'method', 'spacing']);
    const { azimuth = -135, elevation = 35, strength = 1, bias = .5, border = {}, method = 'scharr', spacing } = options;
    if (!finite(azimuth) || !within(elevation, 0, 90) || !within(strength, 0, 8) || !within(bias, 0, 1))
      throw new RangeError('Invalid emboss light or strength');
    const input = frame(source, border);
    const n = normals.heightToNormal(source, { method, border, spacing: spacingFor(input.spec, spacing), precision: 'float64' }).raster.data;
    const a = radians(azimuth), e = radians(elevation), z = Math.sin(e);
    const x = Math.cos(a) * Math.cos(e), y = -Math.sin(a) * Math.cos(e);
    const data = new Float32Array(input.grid.data.length);
    for (let p = 0; p < data.length; p++) data[p] = unit(bias + strength * (n[p * 3] * x + n[p * 3 + 1] * y + n[p * 3 + 2] * z - z));
    return plane(input, data, 'mask', 'unitless', 'float32');
  }

  function heightShadow(source, options = {}) {
    settings(options, ['azimuth', 'elevation', 'softness', 'reach', 'step', 'bias', 'border', 'filter', 'spacing', 'opacity']);
    const { azimuth = -135, elevation = 25, softness = 0, reach = 32, step = 1, bias = .01,
      border = {}, filter = 'linear', spacing, opacity = 1 } = options;
    if (!finite(azimuth) || !within(elevation, .1, 89.9) || !within(softness, 0, 30) || !within(reach, 0, 512) ||
        !within(step, .25, 16) || !finite(bias) || bias < 0 || !['nearest', 'linear'].includes(filter) || !within(opacity, 0, 1))
      throw new RangeError('Invalid height shadow direction, sampling, bias or softness');
    const input = frame(source, border), { grid: { width, height, data: heights }, spec } = input;
    const count = opacity ? Math.ceil(reach / step) : 0;
    if (heights.length * count * (filter === 'linear' ? 4 : 1) > visitBudget)
      throw new RangeError('Height shadow exceeds its sample budget. Reduce reach or increase step.');
    const a = radians(azimuth), x = Math.cos(a), y = Math.sin(a), [sx, sy] = spacingFor(spec, spacing);
    const pitch = Math.hypot(x * sx, y * sy);
    const low = Math.tan(radians(Math.max(0, elevation - softness))) * pitch;
    const high = Math.tan(radians(Math.min(89.9, elevation + softness))) * pitch;
    if (!finite(high) || !finite(low)) throw new RangeError('Height shadow spacing exceeds its numeric range');
    const read = AdvancedHeightReader(input.grid, input.tiling, sampler, filter);
    const taps = Array.from({ length: count }, (_, i) => {
      const d = Math.min(reach, (i + 1) * step);
      return [d, x * d, y * d];
    });
    const data = new Float32Array(heights.length);
    for (let v = 0, p = 0; v < height; v++) for (let u = 0; u < width; u++, p++) {
      let horizon = -Infinity;
      for (const [distance, dx, dy] of taps) {
        const z = read(u + dx, v + dy, -Infinity);
        horizon = Math.max(horizon, (z - heights[p] - bias) / distance);
        if (horizon > high) break;
      }
      data[p] = opacity * (high > low ? smooth((horizon - low) / (high - low)) : Number(horizon > high));
    }
    return plane(input, data, 'mask', 'unitless', 'float32');
  }

  function heightFrequency(source, options = {}) {
    settings(options, ['fineRadius', 'coarseRadius', 'fineGain', 'midGain', 'coarseGain', 'precision', 'border']);
    const { fineRadius = 2, coarseRadius = 12, fineGain = 1, midGain = 1, coarseGain = 1,
      precision = 'float64', border = {} } = options;
    if (!Number.isSafeInteger(fineRadius) || !Number.isSafeInteger(coarseRadius) ||
        fineRadius < 1 || coarseRadius > 64 || coarseRadius <= fineRadius ||
        ![fineGain, midGain, coarseGain].every(n => within(n, -16, 16)))
      throw new RangeError('Height frequency needs two increasing Gaussian radii and bounded band gains');
    const input = frame(source, border), samples = input.grid.data;
    const blur = radius => filters.gaussianBlur(source, { radius, border, precision: 'float64' }).raster.data;
    const a = blur(fineRadius), b = blur(coarseRadius);
    const fine = outputHeight(input, precision, p => samples[p] - a[p]);
    const mid = outputHeight(input, precision, p => a[p] - b[p]);
    const coarse = outputHeight(input, precision, p => b[p]);
    const value = outputHeight(input, precision, p => {
      if (fineGain === 1 && midGain === 1 && coarseGain === 1) return samples[p];
      return fineGain * (samples[p] - a[p]) + midGain * (a[p] - b[p]) + coarseGain * b[p];
    });
    return { value, fine, mid, coarse };
  }

  function edgeWear(source, options = {}, mask = null) {
    settings(options, ['radius', 'threshold', 'softness', 'amount', 'depth', 'edge', 'border']);
    const { radius = 3, threshold = .06, softness = .24, amount = 1, depth = 0, edge = 'convex', border = {} } = options;
    if (!Number.isSafeInteger(radius) || radius < 1 || radius > 64 || !finite(threshold) || threshold < 0 ||
        !finite(softness) || softness < 0 || !within(amount, 0, 1) || !finite(depth) || depth < 0 ||
        !['convex', 'concave', 'both'].includes(edge))
      throw new RangeError('Invalid edge wear radius, response or removal depth');
    const input = frame(source, border), heights = input.grid.data;
    const selection = mask === null ? null : requireImage(mask, 'mask');
    if (selection && (!alignedGrid(source, selection, true) || selection.descriptor.units !== 'unitless'))
      throw new TypeError('Edge wear mask must be an aligned unitless mask');
    const divisor = selection && (integerMax(selection.descriptor.precision) || 1);
    const low = filters.gaussianBlur(source, { radius, precision: 'float64', border }).raster.data;
    const data = new Float32Array(heights.length);
    const direction = edge === 'both' ? Math.abs : edge === 'concave' ? n => -n : n => n;
    for (let p = 0; p < data.length; p++) {
      const epsilon = 16 * Number.EPSILON * Math.max(1, Math.abs(heights[p]), Math.abs(low[p]));
      const response = direction(heights[p] - low[p]) - Math.max(threshold, epsilon);
      const weight = softness ? smooth(response / softness) : Number(response > 0);
      data[p] = amount * weight * (selection ? selection.raster.data[p] / divisor : 1);
    }
    const height = depth ? outputHeight(input, input.spec.precision, p => heights[p] - data[p] * depth) : source;
    return { value: plane(input, data, 'mask', 'unitless', 'float32'), height };
  }

  return Object.freeze({ bevel, emboss, heightShadow, heightFrequency, edgeWear });
};
