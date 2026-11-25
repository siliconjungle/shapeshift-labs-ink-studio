/* Slope trails, periodic edge repair, and scan restoration for typed material images. */
const TypedAdvancedTexture = ({ requireImage, descriptor, wrap, storage, integerMax, measure,
  fields, alignedGrid, alphaAt, borders, sampler, workingSamples }) => {
  const maxCells = 4e6, visitBudget = 128e6;
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const within = (n, low, high) => finite(n) && n >= low && n <= high;

  function settings(options, keys) {
    if (!fields(options, keys)) throw new TypeError('Unknown advanced texture filter option');
  }

  function bounded(source, intent) {
    const image = requireImage(source, intent), { width, height } = image.raster;
    if (width * height > maxCells) throw new RangeError('Advanced texture filter exceeds its grid budget');
    return image;
  }

  function copyImage(image) {
    const { raster, descriptor: spec } = image;
    return new storage[spec.precision](raster.data);
  }

  function addressedSample(grid, spec, tiling, filter) {
    const { channels, data } = grid, { read, write } = workingSamples(spec, data, channels);
    return { write, read: sampler({ ...grid, accumulate: read }, channels, filter,
      TextureAddress.axis(tiling.u), TextureAddress.axis(tiling.v)) };
  }

  function slopeBlur(source, slopeSource, options = {}) {
    settings(options, ['distance', 'samples', 'mode', 'slopeGain', 'border', 'mapBorder', 'filter']);
    const image = bounded(source), driver = bounded(slopeSource, 'height');
    const { raster: grid, descriptor: spec } = image, { width, height, channels } = grid;
    const { distance = 6, samples = 8, mode = 'average', slopeGain = 1, border = {},
      mapBorder = {}, filter = 'linear' } = options;
    if (!within(distance, -128, 128) || !integer(samples) || !within(samples, 2, 32) ||
        !['average', 'min', 'max'].includes(mode) || !within(slopeGain, 0, 64) || !['linear', 'nearest'].includes(filter))
      throw new RangeError('Slope blur needs bounded travel, samples, gain and a valid blend mode');
    const tiling = borders(border, spec.tiling), driverTiling = borders(mapBorder, driver.descriptor.tiling);
    if (!distance || !slopeGain) return source;
    if (width * height * samples * (filter === 'linear' ? 20 : 17) > visitBudget)
      throw new RangeError('Slope blur exceeds its sample budget');
    const heightAt = AdvancedHeightReader(driver.raster, driverTiling, sampler, 'linear');
    const sx = driver.raster.width / width, sy = driver.raster.height / height;
    const { read, write } = addressedSample(grid, spec, tiling, filter), output = copyImage(image);
    const sum = new Float64Array(channels), tap = new Float64Array(channels);
    const average = (a, b) => a + b / samples;
    const combine = mode === 'min' ? Math.min : mode === 'max' ? Math.max : average;
    const initial = mode === 'min' ? Infinity : mode === 'max' ? -Infinity : 0;
    const step = -distance / (samples - 1);
    function z(x, y) {
      return heightAt((x + .5) * sx - .5, (y + .5) * sy - .5, 0);
    }
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p += channels) {
      let u = x, v = y, moved = false;
      sum.fill(initial);
      for (let j = 0; j < samples; j++) {
        tap.fill(0);
        read((u + .5) / width, (v + .5) / height, 1, tap);
        for (let c = 0; c < channels; c++) sum[c] = combine(sum[c], tap[c]);
        if (j + 1 === samples) break;
        const dx = (.5 * z(u + 1, v) - .5 * z(u - 1, v)) * slopeGain;
        const dy = (.5 * z(u, v + 1) - .5 * z(u, v - 1)) * slopeGain;
        const magnitude = Math.hypot(dx, dy);
        if (!finite(magnitude)) throw new RangeError('Slope blur gradient exceeds its numeric range');
        if (magnitude < 1e-12) {
          if (mode === 'average')
            for (let c = 0; c < channels; c++) sum[c] += tap[c] * ((samples - j - 1) / samples);
          break;
        }
        const advance = step / Math.max(1, magnitude);
        u += dx * advance;
        v += dy * advance;
        moved = true;
      }
      if (moved) {
        output.fill(0, p, p + channels);
        write(sum, p, output);
      }
    }
    return wrap({ ...grid, data: output }, spec);
  }

  function seamRepair(source, options = {}) {
    settings(options, ['axes', 'width', 'strength']);
    const image = bounded(source), { raster: grid, descriptor: spec } = image;
    const { width, height, channels, data } = grid;
    const { axes = 'both', width: band = 8, strength = 1 } = options, size = Array.isArray(band) ? Array.from(band) : [band, band];
    if (!['u', 'v', 'both'].includes(axes) || !within(strength, 0, 1) ||
        size.length !== 2 || !size.every(n => integer(n) && within(n, 1, 256)))
      throw new RangeError('Seam repair needs valid axes, blend widths and strength');
    if (!strength || width === 1 && height === 1) return source;
    const u = axes !== 'v' && width > 1, v = axes !== 'u' && height > 1;
    if (!u && !v) return source;
    const out = copyImage(image), sum = new Float64Array(channels), { read, write } = workingSamples(spec, data, channels);
    const weight = (index, span, limit) => {
      const d = Math.min(index, span - 1 - index);
      const t = Math.min(1, d / Math.min(limit, Math.floor(span / 2)));
      return .5 * strength * (1 - t * t * (3 - 2 * t));
    };
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p += channels) {
      const wx = u ? weight(x, width, size[0]) : 0, wy = v ? weight(y, height, size[1]) : 0;
      if (!wx && !wy) continue;
      const left = wx === .5 ? Math.min(x, width - x - 1) : x;
      const top = wy === .5 ? Math.min(y, height - y - 1) : y;
      const mirrorX = width - left - 1, mirrorY = height - top - 1;
      sum.fill(0);
      read((top * width + left) * channels, sum, (1 - wx) * (1 - wy));
      if (wx) read((top * width + mirrorX) * channels, sum, wx * (1 - wy));
      if (wy) read((mirrorY * width + left) * channels, sum, (1 - wx) * wy);
      if (wx && wy) read((mirrorY * width + mirrorX) * channels, sum, wx * wy);
      out.fill(0, p, p + channels);
      write(sum, p, out);
    }
    return wrap({ ...grid, data: out }, spec);
  }

  function alignedPlane(source, other, kind) {
    const { raster: grid, descriptor: spec } = requireImage(other);
    if (!alignedGrid(source, other, true) || spec.units !== 'unitless' || grid.channels !== 1 ||
        (kind === 'mask' ? spec.intent !== 'mask' : !['mask', 'data'].includes(spec.intent)))
      throw new TypeError('Scan cleanup ' + kind + ' must be an aligned unitless scalar image');
    const divisor = integerMax(spec.precision) || 1;
    return p => grid.data[p] / divisor;
  }

  function neighborhood(span, radius, axis) {
    return Array.from({ length: span }, (_, c) => {
      const indices = new Set();
      for (let d = -radius; d <= radius; d++) {
        const sample = axis(c + d, span);
        if (sample >= 0) indices.add(sample);
      }
      return Array.from(indices);
    });
  }

  function scanCleanup(source, options = {}, mask = null, illumination = null) {
    settings(options, ['radius', 'threshold', 'support', 'amount', 'border', 'illuminationStrength', 'reference']);
    const image = bounded(source), { raster: grid, descriptor: spec } = image;
    const { width, height, channels, data: original } = grid;
    const { radius = 1, threshold = .15, support = .8, amount = 1, border = {},
      illuminationStrength = 1, reference = 1 } = options;
    if (!integer(radius) || !within(radius, 1, 4) || !finite(threshold) || threshold < 0 ||
        !within(support, .5, 1) || !within(amount, 0, 1) || !within(illuminationStrength, 0, 1) ||
        !within(reference, 1 / 32, 32)) throw new RangeError('Invalid scan cleanup outlier or illumination options');
    const color = spec.intent === 'color', count = width * height;
    const { sample } = measure(source, { channel: color ? 'luminance' : 'value' }, maxCells);
    const gate = mask === null ? () => 1 : alignedPlane(source, mask, 'mask');
    if (illumination !== null && !color) throw new TypeError('Scan illumination compensation needs a color source');
    const gain = illumination === null ? null : alignedPlane(source, illumination, 'illumination');
    if (amount && count * (2 * radius + 1) ** 2 > 24e6)
      throw new RangeError('Scan cleanup exceeds its neighborhood budget');
    const tiling = borders(border, spec.tiling), us = neighborhood(width, radius, TextureAddress.axis(tiling.u)),
      vs = neighborhood(height, radius, TextureAddress.axis(tiling.v));
    const values = new Float64Array(count), coverage = new Float64Array(count);
    for (let p = 0; p < count; p++) {
      values[p] = sample(p);
      coverage[p] = alphaAt(original, p * channels, spec);
      if (!finite(values[p])) throw new RangeError('Scan cleanup received a nonfinite measurement');
    }
    const data = copyImage(image), repaired = new Float32Array(count), { read, write } = workingSamples(spec, original, channels);
    const central = new Float64Array(channels), candidate = new Float64Array(channels), neighbors = [];
    const components = spec.alpha === 'none' ? channels : channels - 1;
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const select = gate(p);
      if (!select || !coverage[p]) continue;
      let repair = 0, median = p, compensation = 1;
      if (amount) {
        neighbors.length = 0;
        for (const v of vs[y]) for (const u of us[x]) {
          const i = v * width + u;
          if (i !== p && coverage[i]) neighbors.push(i);
        }
        if (neighbors.length >= 3) {
          neighbors.sort((a, b) => values[a] - values[b] || a - b);
          median = neighbors[Math.floor(neighbors.length / 2)];
          const difference = values[p] - values[median];
          if (Math.abs(difference) > threshold) {
            const sign = Math.sign(difference);
            const agree = neighbors.reduce((n, i) => n + Number(sign * (values[p] - values[i]) > threshold), 0);
            if (agree >= support * neighbors.length) repair = amount * select;
          }
        }
      }
      if (gain && illuminationStrength) {
        const observed = gain(p);
        if (!within(observed, 1 / 32, 32)) throw new RangeError('Scan illumination multipliers must be in [1/32, 32]');
        compensation += illuminationStrength * select * (reference / observed - 1);
      }
      if (!repair && compensation === 1) continue;
      const i = p * channels;
      central.fill(0);
      read(i, central, 1);
      if (repair) {
        candidate.fill(0);
        read(median * channels, candidate, 1);
        const associate = coverage[p] / coverage[median];
        for (let c = 0; c < components; c++) central[c] = central[c] * (1 - repair) + candidate[c] * associate * repair;
        repaired[p] = repair;
      }
      for (let c = 0; c < components; c++) central[c] *= compensation;
      data.fill(0, i, i + channels);
      write(central, i, data);
    }
    const maskGrid = { width, height, channels: 1, pivot: grid.pivot, data: repaired };
    const maskSpec = descriptor(maskGrid, { intent: 'mask', precision: 'float32', tiling: spec.tiling,
      sampling: spec.sampling, pixelPitchMm: spec.pixelPitchMm, materialSeed: spec.materialSeed });
    return { value: wrap({ ...grid, data }, spec), repaired: wrap(maskGrid, maskSpec) };
  }

  return Object.freeze({ slopeBlur, seamRepair, scanCleanup });
};
