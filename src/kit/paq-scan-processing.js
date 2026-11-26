/* Register, restore and repeat the maps of one planar scan as a material. */
(function (P) {
  const I = P.graphImages, M = P.materialChannels;
  const { fields, tuple, bounded, registration, footprint } = MeasuredAlignment;
  const record = P.graphTypes.validator('record');
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const maxPixels = 4_000_000, maxSamples = 36_000_000;
  const flat = [0, 0, 1];
  const scale = ({ precision }) => ({ unorm8: 255, unorm16: 65535 })[precision] ?? 1;
  const validUnit = n => bounded(n, 0, 1);
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  const saturate = n => Math.max(0, Math.min(1, n));
  const normalized = (x, y, z) => {
    const length = Math.hypot(x, y, z);
    return length > 1e-8 ? [x / length, y / length, z / length] : flat;
  };
  const pair = (a, b) => !a || !b || a[0] === b[0] && a[1] === b[1];
  const aligned = (a, b) => a.raster.width === b.raster.width && a.raster.height === b.raster.height &&
    pair(a.raster.pivot, b.raster.pivot) && pair(a.descriptor.pixelPitchMm, b.descriptor.pixelPitchMm);

  function setup(source, options) {
    if (!M.valid(source) || !source.channels.baseColor)
      throw new TypeError('Scan processing needs a material packet with pigment');
    if (!fields(options, ['align', 'repair', 'tile', 'deLight']))
      throw new TypeError('Unknown scan processing option');
    const { align = {}, repair = {}, tile = null, deLight = {} } = options;
    if (!fields(align, ['width', 'height', 'pixelPitchMm', 'pivot', 'landmarks', 'perChannel', 'tolerance', 'filter', 'normalFrame']) ||
        !fields(repair, ['radius', 'threshold', 'minimumCoverage']) || !fields(deLight, ['strength', 'minimumLight']))
      throw new TypeError('Invalid scan alignment, repair or de-light options');
    const base = source.channels.baseColor.raster;
    if (!I.valid(base, 'color')) throw new TypeError('Scan pigment needs a typed color image');
    const { raster: baseGrid, descriptor: baseSpec } = base;
    const { width = baseGrid.width, height = baseGrid.height, pivot = baseGrid.pivot, landmarks,
      pixelPitchMm = baseSpec.pixelPitchMm ?? source.channels.height?.raster.descriptor?.pixelPitchMm,
      perChannel = {}, tolerance = 1, filter = 'linear', normalFrame = 'surface' } = align;
    const { radius = 12, threshold = .5, minimumCoverage = .5 } = repair;
    const { strength = 1, minimumLight = .06 } = deLight;
    if (![width, height].every(n => integer(n) && n >= 2 && n <= 8192) || width * height > maxPixels ||
        pixelPitchMm !== undefined && !tuple(pixelPitchMm, 2, n => bounded(n, 1e-6, 1e6)) ||
        pivot !== undefined && !tuple(pivot, 2) || !record(perChannel) ||
        Object.keys(perChannel).some(name => !Object.hasOwn(source.channels, name)) ||
        !bounded(tolerance, .001, 64) || !['nearest', 'linear'].includes(filter) || !['surface', 'image'].includes(normalFrame) ||
        !bounded(radius, 0, 512) || !bounded(threshold, .001, 1) || !bounded(minimumCoverage, .001, 1) ||
        !validUnit(strength) || !bounded(minimumLight, .0001, 32))
      throw new RangeError('Invalid scan grid, registration, repair radius or illumination controls');
    return { width, height, pivot, pixelPitchMm, landmarks, perChannel, tolerance, filter, normalFrame,
      minimumCoverage, threshold, radius, tile: tileOptions(tile, width, height), strength, minimumLight };
  }

  function tileOptions(tile, width, height) {
    if (tile === null) return null;
    if (!fields(tile, ['crop', 'axes', 'band', 'strength', 'normalMode']))
      throw new TypeError('Invalid scan tile options');
    const { crop = [0, 0, width, height], axes = 'both', band = 8, strength = 1, normalMode = 'auto' } = tile;
    const size = typeof band === 'number' ? [band, band] : band;
    if (!tuple(crop, 4, integer) || crop[0] < 0 || crop[1] < 0 || crop[2] < 2 || crop[3] < 2 ||
        crop[0] + crop[2] > width || crop[1] + crop[3] > height ||
        !['u', 'v', 'both'].includes(axes) || !tuple(size, 2, n => integer(n) && bounded(n, 1, 256)) ||
        !validUnit(strength) || !['auto', 'sampled', 'height-detail'].includes(normalMode))
      throw new RangeError('Scan tile needs an in-bounds crop, seam band and normal mode');
    return { crop, axes, band: size, strength, normalMode };
  }

  function field(grid, value, label, max = 1) {
    if (!I.validGray(value) || !aligned(grid, value) ||
        !value.raster.data.every(n => bounded(n, 0, max * scale(value.descriptor))))
      throw new TypeError('Scan ' + label + ' needs an aligned unitless grayscale image in [0,' + max + ']');
    const divisor = scale(value.descriptor);
    return p => value.raster.data[p] / divisor;
  }

  function workingColor(image) {
    const alpha = image.descriptor.alpha !== 'none' ? 'straight' : 'none';
    return I.convert(image, { intent: 'color', colorSpace: 'srgb-linear', precision: image.descriptor.precision === 'float64' ?
      'float64' : 'float32', alpha });
  }

  function decode(image, name) {
    const { intent, precision, layout } = image.descriptor;
    if (intent === 'color') {
      const { raster, descriptor } = workingColor(image);
      return { spec: descriptor, channels: raster.channels, read(p, out) {
        const i = p * raster.channels;
        for (let c = 0; c < 3; c++) out[c] = raster.data[i + c];
        return raster.channels === 4 ? raster.data[i + 3] : 1;
      } };
    }
    if (intent === 'normal') {
      const read = I.normals.reader(image), { alpha, normalSpace = 'tangent' } = image.descriptor;
      return { spec: { intent, precision: precision === 'float64' ? precision : 'float32', normalSpace,
        ...(normalSpace === 'tangent' && { normalOrientation: 'opengl' }) }, channels: 3,
        read(p, out) { const a = read(p, out); return alpha === 'none' ? 1 : a; } };
    }
    const { raster, descriptor } = image;
    const divisor = scale(descriptor);
    if (name === 'flow' || intent === 'data' && layout !== 'r' ||
        intent !== 'height' && (descriptor.units !== 'unitless' || !raster.data.every(n => validUnit(n / divisor))))
      throw new TypeError('Scan channel ' + name + ' needs a scalar, color, height or normal map');
    return { spec: { intent, units: descriptor.units, precision: precision === 'float64' ? precision : 'float32' },
      channels: 1, read(p, out) { out[0] = raster.data[p] / divisor; return 1; } };
  }

  function lightSampler(base, light) {
    if (light === null) return null;
    if (!I.valid(light) || !aligned(base, light))
      throw new TypeError('Scan illumination must be aligned to the source pigment');
    if (light.descriptor.intent !== 'color') {
      const read = field(base, light, 'illumination', 32);
      return (p, out) => { out.fill(read(p)); return 1; };
    }
    const { raster } = workingColor(light);
    const { data, channels } = raster;
    if (data.some(n => !bounded(n, 0, 32))) throw new RangeError('Scan RGB illumination needs samples in [0,32]');
    return (p, out) => {
      for (let c = 0; c < 3; c++) out[c] = data[p * channels + c];
      return channels === 4 ? data[p * channels + 3] : 1;
    };
  }

  function mapGrid(image, name, settings, validity, light) {
    const { width, height, pivot, pixelPitchMm, filter, perChannel, landmarks, tolerance, normalFrame } = settings;
    const { raster, descriptor: from } = image;
    // An explicit null overrides shared registration for an already registered plane.
    const authored = Object.hasOwn(perChannel, name) ? perChannel[name] : landmarks;
    const constant = raster.width === 1 && raster.height === 1;
    if (constant && Object.hasOwn(perChannel, name) && authored !== null)
      throw new RangeError('A constant scan channel cannot have landmarks');
    if (!constant && (raster.width < 2 || raster.height < 2))
      throw new RangeError('Scan maps must be two-dimensional or a one-texel constant');
    const solution = constant ? { map(_x, _y, out) { out[0] = out[1] = 0; },
      report: { landmarks: 0, rmsPx: 0, maxPx: 0, constant: true } } :
      registration(authored === null ? undefined : authored, [width, height], [raster.width, raster.height], tolerance);
    const { spec, channels, read } = decode(image, name), activeLight = !!light && settings.strength > 0;
    const target = { width, height, pivot, channels };
    const alloc = () => new (spec.precision === 'float64' ? Float64Array : Float32Array)(width * height * channels);
    const data = alloc(), delit = activeLight ? alloc() : null;
    const support = new Float32Array(width * height), lightSupport = delit && new Float32Array(support.length);
    const uv = [0, 0], derivatives = [0, 0, 0, 0];
    const sample = [0, 0, 0], energy = [0, 0, 0], sum = [0, 0, 0], clean = [0, 0, 0];
    const normal = spec.intent === 'normal', roughness = name === 'roughness';
    const transformNormal = normal && spec.normalSpace === 'tangent' && normalFrame === 'image' && !constant;
    const inputPitch = from.pixelPitchMm ?? pixelPitchMm ?? [1, 1], outputPitch = pixelPitchMm ?? inputPitch;
    const gate = validity ? field(image, validity, 'validity for ' + name) : () => 1;
    let skippedLight = 0, sampled = 0;
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      solution.map(x, y, uv);
      const taps = footprint(uv[0], uv[1], raster.width, raster.height);
      let weight = 0, corrected = 0;
      sum.fill(0); clean.fill(0);
      if (taps) {
        const [a, b] = uv;
        const nearest = filter === 'nearest' ? [[Math.round(b) * raster.width + Math.round(a), 1]] : taps;
        for (const [i, gain] of nearest) {
          if (!gain) continue;
          const w = gain * read(i, sample) * gate(i);
          if (!w || normal && Math.hypot(...sample) < 1e-8) continue;
          weight += w;
          for (let c = 0; c < Math.min(channels, 3); c++) sum[c] += w * (roughness ? sample[c] ** 2 : sample[c]);
          if (delit) {
            const lw = w * light(i, energy);
            if (!lw || Math.min(...energy) < settings.minimumLight) continue;
            corrected += lw;
            for (let c = 0; c < 3; c++) clean[c] += lw * lerp(sample[c], sample[c] / energy[c], settings.strength);
          }
        }
      }
      const i = p * channels;
      if (normal) {
        let [nx, ny, nz] = sum;
        if (weight && transformNormal) {
          solution.jacobian(x, y, derivatives);
          const [a, b, c, d] = derivatives;
          const xx = (a * inputPitch[0] * nx - c * inputPitch[1] * ny) / outputPitch[0];
          const yy = (-b * inputPitch[0] * nx + d * inputPitch[1] * ny) / outputPitch[1];
          nx = xx;
          ny = yy;
        }
        if (Math.hypot(nx, ny, nz) < 1e-8) weight = 0;
        data.set(normalized(nx, ny, nz), i);
      } else if (weight) {
        for (let c = 0; c < Math.min(channels, 3); c++) data[i + c] = roughness ?
          saturate(Math.sqrt(sum[c] / weight)) : sum[c] / weight;
        if (channels === 4) data[i + 3] = saturate(weight);
      }
      support[p] = saturate(weight);
      if (weight) sampled++;
      if (delit) {
        for (let c = 0; c < 3; c++) delit[i + c] = corrected ? clean[c] / corrected : data[i + c];
        if (channels === 4) delit[i + 3] = corrected ? saturate(corrected) : data[i + 3];
        lightSupport[p] = saturate(corrected);
        if (weight >= settings.minimumCoverage && corrected < settings.minimumCoverage) skippedLight++;
      }
    }
    const typed = buffer => I.declare({ ...target, data: buffer }, { ...spec, pixelPitchMm, sampling: filter, tiling: { u: 'clamp', v: 'clamp' } });
    return { raw: typed(data), delit: delit && typed(delit), support, lightSupport,
      report: { channel: name, width: raster.width, height: raster.height, sampled, ...solution.report },
      skippedLight };
  }

  function donors(support, defects, settings) {
    const { width, height, minimumCoverage, threshold, radius } = settings;
    const clean = Uint8Array.from(support, (n, p) => Number(n >= minimumCoverage && defects(p) < threshold));
    const count = clean.reduce((sum, n) => sum + n, 0), damaged = clean.length - count;
    const repaired = new Float32Array(clean.length), unresolved = new Float32Array(clean.length);
    if (!damaged) return { repaired, unresolved, damaged, count: 0 };
    const transform = !count || !radius ? null : P.geometry.distanceTransform(clean, { size: [width, height], indices: true });
    let fixed = 0;
    for (let p = 0; p < clean.length; p++) if (!clean[p]) {
      if (transform && transform.nearest[p] >= 0 && transform.distance[p] <= radius) { repaired[p] = 1; fixed++; }
      else unresolved[p] = 1;
    }
    return { map: transform?.nearest, repaired, unresolved, damaged, count: fixed };
  }

  function repairImage(image, { map, repaired }) {
    const { raster, descriptor } = image, { channels, data: input } = raster;
    const data = input.slice();
    for (let p = 0; p < repaired.length; p++) if (repaired[p]) {
      const from = map[p] * channels;
      for (let c = 0; c < channels; c++) data[p * channels + c] = input[from + c];
    }
    return I.declare({ ...raster, data }, descriptor);
  }

  function crop(image, rect) {
    const { raster: grid, descriptor } = image, [x, y, width, height] = rect;
    if (x === 0 && y === 0 && width === grid.width && height === grid.height) return image;
    const { channels, pivot } = grid, data = new grid.data.constructor(width * height * channels);
    for (let v = 0; v < height; v++) {
      const start = ((v + y) * grid.width + x) * channels;
      data.set(grid.data.subarray(start, start + width * channels), v * width * channels);
    }
    return I.declare({ width, height, channels, pivot: pivot && [pivot[0] - x, pivot[1] - y], data }, descriptor);
  }

  function seamError(image, axes) {
    const { width, height, channels, data } = image.raster;
    let sum = 0, n = 0;
    function compare(a, b) {
      for (let c = 0; c < channels; c++) {
        const delta = data[a * channels + c] - data[b * channels + c];
        sum += delta * delta;
        n++;
      }
    }
    if (axes !== 'v') for (let y = 0; y < height; y++) compare(y * width, (y + 1) * width - 1);
    if (axes !== 'u') for (let x = 0; x < width; x++) compare(x, (height - 1) * width + x);
    const rms = Math.sqrt(sum / n);
    return finite(rms) ? rms : null;
  }

  function tileMaterial(packet, unresolved, tile) {
    const { axes, strength, band, crop: rect, normalMode } = tile;
    if (crop(unresolved, rect).raster.data.some(n => n))
      throw new RangeError('Scan tile crop contains unresolved defects. Adjust crop or repair radius.');
    const tiling = { u: axes === 'v' ? 'clamp' : 'wrap', v: axes === 'u' ? 'clamp' : 'wrap' };
    const maps = Object.fromEntries(Object.entries(packet.channels).map(([name, { raster }]) => [name, crop(raster, rect)]));
    function tileImage(image) {
      const blended = I.advancedTexture.seamRepair(image, { axes, strength, width: band });
      return I.declare(blended.raster, { ...blended.descriptor, tiling });
    }
    const result = Object.fromEntries(Object.entries(maps).map(([name, image]) => [name, tileImage(image)]));
    const { normal, height } = maps;
    const detail = normal && height && normal.descriptor.normalSpace === 'tangent' &&
      (height.descriptor.units === 'art-px' || height.descriptor.units === 'mm' && height.descriptor.pixelPitchMm);
    if (normalMode === 'height-detail' && !detail)
      throw new TypeError('Height-detail scan tiling needs tangent normals and height in mm with pitch or art-px');
    if (detail && normalMode !== 'sampled' && strength) {
      const { raster, descriptor } = normal;
      const options = { method: 'central', precision: descriptor.precision };
      const old = I.normals.heightToNormal(height, options).raster.data;
      const current = I.normals.heightToNormal(result.height, options).raster.data;
      const measures = raster.data, residual = new raster.data.constructor(measures.length);
      const n = I.normals.mixVectors;
      for (let i = 0; i < old.length; i += 3)
        residual.set(n([-old[i], -old[i + 1], old[i + 2]], measures.subarray(i, i + 3), 'rnm', 1), i);
      const periodic = tileImage(I.declare({ ...raster, data: residual }, descriptor));
      const data = new raster.data.constructor(measures.length), transported = periodic.raster.data;
      for (let i = 0; i < current.length; i += 3)
        data.set(n(current.subarray(i, i + 3), transported.subarray(i, i + 3), 'rnm', 1), i);
      result.normal = I.declare({ ...raster, data }, { ...descriptor, tiling });
    } else if (normal && strength) result.normal = I.normals.normalNormalize(result.normal);
    const seams = Object.fromEntries(Object.entries(maps).map(([name, image]) =>
      [name, { before: seamError(image, axes), after: seamError(result[name], axes) }]));
    return { maps: result, report: { axes, crop: rect, band, strength, seams, normalMode: detail && normalMode !== 'sampled' && strength ?
      'height-detail' : 'sampled' } };
  }

  function process(source, options = {}, defects = null, illumination = null, validity = {}) {
    const settings = setup(source, options);
    if (!record(validity) || Object.keys(validity).some(name => !Object.hasOwn(source.channels, name)))
      throw new TypeError('Scan validity must identify supplied material channels');
    const { width, height, pivot, pixelPitchMm } = settings, count = width * height;
    const entries = Object.entries(source.channels);
    if (entries.some(([, { raster }]) => !I.valid(raster)) ||
        entries.reduce((n, [, { raster }]) => n + raster.raster.channels, 0) * count > maxSamples)
      throw new TypeError('Scan maps must be typed images within the working sample budget');
    const base = source.channels.baseColor.raster, light = lightSampler(base, illumination);
    const plane = data => I.declare({ width, height, pivot, channels: 1, data }, { intent: 'mask', pixelPitchMm });
    const support = new Float32Array(count).fill(1);
    const detect = defects === null ? () => 0 : field(plane(support), defects, 'defect mask');
    const raw = {}, metadata = {}, alignment = [];
    let delit = null, skippedLight = 0;
    for (const [name, { raster, metadata: details }] of entries) {
      const result = mapGrid(raster, name, settings, validity[name], name === 'baseColor' ? light : null);
      raw[name] = result.raw;
      metadata[name] = details;
      alignment.push(result.report);
      const valid = result.lightSupport ?? result.support;
      for (let p = 0; p < count; p++) support[p] = Math.min(support[p], valid[p]);
      if (result.delit) { delit = result.delit; skippedLight = result.skippedLight; }
    }
    const aligned = M.pack(raw, metadata);
    const deLit = delit ? M.replace(aligned, { baseColor: delit }) : aligned;
    const plan = donors(support, detect, settings);
    const repaired = plan.count ? M.replace(deLit, Object.fromEntries(Object.entries(deLit.channels).map(([name, row]) =>
      [name, repairImage(row.raster, plan)]))) : deLit;
    const unresolved = plane(plan.unresolved);
    const tile = settings.tile && tileMaterial(repaired, unresolved, settings.tile);
    const value = tile ? M.replace(repaired, tile.maps) : repaired;
    return { value, aligned, delit: deLit, repaired, repairedMask: plane(plan.repaired), unresolved, support: plane(support),
      report: { width, height, pixelPitchMm: pixelPitchMm ?? null, alignment,
        repair: { damaged: plan.damaged, repaired: plan.count, unresolved: plan.damaged - plan.count, radius: settings.radius },
        deLight: { strength: delit ? settings.strength : 0, skipped: skippedLight, minimumLight: settings.minimumLight },
        tile: tile?.report ?? null } };
  }

  const optionalImage = { type: 'any', default: null };
  const node = {
    description: 'Register, de-light, repair and tile material scan maps on a shared surface grid.',
    inputs: { source: 'materialChannels', options: { type: 'record', default: {} },
      defects: optionalImage, illumination: optionalImage, validity: { type: 'record', default: {} } },
    outputs: { value: 'materialChannels', aligned: 'materialChannels', delit: 'materialChannels', repaired: 'materialChannels',
      repairedMask: 'grayImage', unresolved: 'grayImage', support: 'grayImage', report: 'record' },
    run({ source, options, defects, illumination, validity }) { return process(source, options, defects, illumination, validity); }
  };
  P.scanProcessing = Object.freeze({ process, operations: Object.freeze({ 'material.scanProcess': node }) });
})(KIT.procedural);
