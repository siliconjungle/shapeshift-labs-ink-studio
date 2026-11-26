/* Resolve planar material captures into an aligned, linear-light material packet. */
(function (K) {
  const P = K.procedural, { registration, calibration, fields, tuple, bounded, dot, footprint } = MeasuredAlignment;
  const unit = n => bounded(n, 0, 1);
  const magnitude = v => Math.hypot(...v);
  const flat = [0, 0, 1];
  const normalize = v => {
    const length = magnitude(v);
    return length > 1e-8 ? v.map(n => n / length) : flat;
  };
  const divisor = image => ({ unorm8: 255, unorm16: 65535 })[image.descriptor.precision] ?? 1;
  const scalar = ['mask', 'data'];
  const coverage = value => {
    const scale = divisor(value);
    return value.raster.data.every(n => unit(n / scale));
  };
  const clamp = n => Math.min(1, Math.max(0, n));
  const luma = v => .2126 * v[0] + .7152 * v[1] + .0722 * v[2];

  function grid(image, intents, extent, label) {
    if (!P.graphImages.valid(image) || !intents.includes(image.descriptor.intent))
      throw new TypeError(label + ' needs a typed ' + intents.join('/') + ' image');
    const { width, height, channels } = image.raster;
    if (width < 2 || height < 2 || extent && (width !== extent[0] || height !== extent[1]))
      throw new RangeError(label + ' must match the source color extent');
    if (intents === scalar && (channels !== 1 || image.descriptor.units !== 'unitless' || !coverage(image)))
      throw new RangeError(label + ' needs unitless scalar values between zero and one');
    return image;
  }

  function linear(image) {
    return P.graphImages.convert(image, {
      intent: 'color', colorSpace: 'srgb-linear', precision: 'float32',
      alpha: image.descriptor.alpha === 'none' ? 'none' : 'straight'
    });
  }

  function lights(value = { ambient: 1 }) {
    const strength = n => bounded(n, 0, 32);
    const rgb = n => strength(n) ? [n, n, n] : n;
    if (!fields(value, ['ambient', 'lights']) || !tuple(rgb(value.ambient), 3, strength) ||
        value.lights !== undefined && (!Array.isArray(value.lights) || value.lights.length > 8))
      throw new TypeError('Capture lighting needs calibrated ambient and up to eight directional lights');
    const ambient = rgb(value.ambient);
    const rows = Array.from(value.lights ?? [], light => {
      if (!fields(light, ['direction', 'strength']) || !tuple(light.direction, 3) ||
          !bounded(magnitude(light.direction), 1e-8, 1e6) || !tuple(rgb(light.strength), 3, strength))
        throw new TypeError('Invalid calibrated directional light');
      return { direction: normalize(light.direction), gain: rgb(light.strength) };
    });
    return {
      needsNormal: rows.some(row => row.gain.some(n => n > 0)),
      sample(normal) {
        const diffuse = ambient.slice();
        for (const { direction, gain } of rows) {
          const facing = Math.max(0, dot(direction, normal));
          for (let c = 0; c < 3; c++) diffuse[c] += facing * gain[c];
        }
        return diffuse;
      }
    };
  }

  function reader(image, gate, depthGate, clipLevel) {
    const { raster: { channels, data }, descriptor } = image;
    const scale = divisor(image), alpha = descriptor.alpha !== 'none';
    const normal = descriptor.intent === 'normal', lanes = Math.min(channels, 3);
    return taps => {
      const value = lanes === 1 ? [0] : [0, 0, 0];
      let weight = 0;
      for (const [pixel, tap] of taps) {
        if (!tap) continue;
        const i = pixel * channels;
        const a = alpha ? data[i + 3] / scale : 1;
        const w = tap * a * gate(pixel) * depthGate(pixel);
        if (!w || clipLevel !== undefined && Math.max(data[i], data[i + 1], data[i + 2]) >= clipLevel) continue;
        weight += w;
        for (let c = 0; c < value.length; c++) {
          let sample = data[i + c] / (scale * (descriptor.alpha === 'premultiplied' ? a : 1));
          if (normal && scale !== 1) sample = sample * 2 - 1;
          if (normal && c === 1 && descriptor.normalOrientation === 'directx') sample = -sample;
          value[c] += w * sample;
        }
      }
      if (weight > 1e-8) return { value: value.map(n => n / weight), weight };
    };
  }

  const maskReader = mask => mask ? pixel => mask.raster.data[pixel] / divisor(mask) : () => 1;

  function prepare(capture, target, maxLandmarkError) {
    if (!fields(capture, ['id', 'color', 'landmarks', 'coverage', 'height', 'reliefMask', 'normal', 'normalRotation',
      'roughness', 'weight', 'calibration', 'lighting', 'irradiance', 'clipLevel']) ||
        typeof capture.id !== 'string' || !/^[a-z][\w.-]{0,63}$/i.test(capture.id) ||
        !bounded(capture.weight ?? 1, .001, 100) || !bounded(capture.normalRotation ?? 0, -360, 360) ||
        capture.clipLevel !== undefined && !bounded(capture.clipLevel, .001, 128) ||
        capture.irradiance !== undefined && capture.lighting !== undefined ||
        capture.reliefMask !== undefined && capture.height === undefined)
      throw new TypeError('Invalid measured material capture');
    const color = linear(grid(capture.color, ['color'], null, 'Capture color'));
    const { width, height } = color.raster, extent = [width, height];
    const alignment = registration(capture.landmarks, target, extent, maxLandmarkError);
    const { apply, report } = calibration(capture.calibration);
    function map(name, intents) {
      return capture[name] === undefined ? undefined : grid(capture[name], intents, extent, 'Capture ' + name);
    }
    const gate = maskReader(map('coverage', scalar)), depthGate = maskReader(map('reliefMask', scalar));
    const relief = map('height', ['height']), normal = map('normal', ['normal']), roughness = map('roughness', scalar);
    if (relief && (relief.descriptor.units !== 'mm' || relief.raster.data.some(n => Math.abs(n) > 1e5)) ||
        normal?.descriptor.normalSpace === 'world')
      throw new RangeError('Measured relief needs millimeters and normals need a tangent frame');
    const irradiance = map('irradiance', ['color', 'data', 'mask']);
    if (irradiance && irradiance.descriptor.intent !== 'color' &&
        (irradiance.raster.channels !== 1 || irradiance.descriptor.units !== 'unitless' ||
          !irradiance.raster.data.every(n => bounded(n, 0, 32 * divisor(irradiance)))))
      throw new RangeError('Scalar irradiance needs one unitless channel in [0,32]');
    const lightField = irradiance?.descriptor.intent === 'color' ? linear(irradiance) : irradiance;
    const radians = (capture.normalRotation ?? 0) * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians), point = [0, 0];
    const constant = () => 1, make = image => image && reader(image, gate, constant);
    const readNormal = make(normal);
    return {
      id: capture.id, weight: capture.weight ?? 1,
      report: { id: capture.id, width, height, registration: alignment.report, calibration: report },
      taps(x, y) {
        alignment.map(x, y, point);
        return footprint(point[0], point[1], width, height);
      },
      transform: apply, color: reader(color, gate, constant, capture.clipLevel),
      height: relief && reader(relief, gate, depthGate), roughness: make(roughness),
      normal: readNormal && (taps => {
        const sample = readNormal(taps);
        if (!sample || magnitude(sample.value) <= 1e-8) return;
        const [x, y, z] = sample.value;
        return { weight: sample.weight, value: normalize([cos * x - sin * y, sin * x + cos * y, z]) };
      }),
      irradiance: make(lightField), light: irradiance ? undefined : lights(capture.lighting)
    };
  }

  function mean(samples, out) {
    let weight = 0;
    out.fill(0);
    for (const row of samples) {
      weight += row.weight;
      for (let c = 0; c < out.length; c++) out[c] += row.weight * row.value[c];
    }
    if (weight) for (let c = 0; c < out.length; c++) out[c] /= weight;
    return weight;
  }

  function consensus(samples, order, distance, tolerance, out) {
    if (!samples.length) return { weight: 0, count: 0, deviation: 0 };
    const total = samples.reduce((sum, row) => sum + row.weight, 0);
    samples.sort((a, b) => order(a.value) - order(b.value));
    let cumulative = 0;
    const center = samples.find(row => (cumulative += row.weight) >= total * .5).value;
    const inliers = samples.filter(row => distance(row.value, center) <= tolerance);
    const weight = mean(inliers, out);
    const deviation = Math.max(...samples.map(row => distance(row.value, out)));
    return { weight, count: inliers.length, deviation };
  }

  function reliefGradient(data, valid, p, x, y, width, height, spacing) {
    function derivative(before, after, pitch) {
      const lo = before >= 0 && valid[before] ? before : p;
      const hi = after >= 0 && valid[after] ? after : p;
      return lo === hi ? 0 : (data[hi] - data[lo]) / ((lo !== p && hi !== p ? 2 : 1) * pitch);
    }
    return normalize([-derivative(x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, spacing[0]),
      derivative(y ? p - width : -1, y + 1 < height ? p + width : -1, spacing[1]), 1]);
  }

  function recover(captures, settings) {
    if (!fields(settings, ['width', 'height', 'pixelPitchMm', 'maxLandmarkError', 'reliefToleranceMm',
      'pigmentTolerance', 'minimumLight'])) throw new TypeError('Invalid measured material settings');
    const { width, height, pixelPitchMm, maxLandmarkError = 1, reliefToleranceMm = .08,
      pigmentTolerance = .08, minimumLight = .06 } = settings;
    if (![width, height].every(n => Number.isSafeInteger(n) && bounded(n, 2, 4096)) ||
        !Array.isArray(captures) || !bounded(captures.length, 1, 12) || width * height * captures.length > 8_000_000 ||
        !tuple(pixelPitchMm, 2, n => bounded(n, .0001, 1e4)) || !bounded(maxLandmarkError, .001, 64) ||
        !bounded(reliefToleranceMm, .00001, 1e4) || !bounded(pigmentTolerance, .00001, 16) ||
        !bounded(minimumLight, .0001, 32))
      throw new RangeError('Measured material exceeds its dimensions, work budget or calibration ranges');
    let sourcePixels = 0;
    const views = Array.from(captures, capture => {
      const pixels = capture?.color?.raster?.width * capture?.color?.raster?.height;
      if (!bounded(pixels, 4, 8_000_000) || (sourcePixels += pixels) > 8_000_000)
        throw new RangeError('Measured material exceeds its source-pixel budget');
      return prepare(capture, [width, height], maxLandmarkError);
    });
    if (new Set(views.map(view => view.id)).size !== views.length) throw new RangeError('Capture IDs must be unique');
    const count = width * height, totalWeight = views.reduce((sum, view) => sum + view.weight, 0);
    const fieldViews = name => views.filter(view => view[name]);
    const elevations = fieldViews('height'), surfaces = fieldViews('normal'), finishes = fieldViews('roughness');
    if (!elevations.length && !surfaces.length) throw new TypeError('A measured material needs height or tangent normal observations');
    const weightFor = list => list.reduce((sum, view) => sum + view.weight, 0);
    const elevationWeight = weightFor(elevations), surfaceWeight = weightFor(surfaces);
    const expand = (view, sample) => ({ ...sample, weight: view.weight * sample.weight });
    function observe(name, list, x, y) {
      const observed = [];
      for (const view of list) {
        const taps = view.taps(x, y), sample = taps && view[name](taps);
        if (sample) observed.push(expand(view, sample));
      }
      return observed;
    }
    const relief = new Float32Array(count), reliefConfidence = new Float32Array(count);
    const observedRelief = new Uint8Array(count), pigmentConfidence = new Float32Array(count);
    const normalConfidence = new Float32Array(count), pigment = new Float32Array(count * 4);
    const normals = new Float32Array(count * 3), roughness = finishes.length ? new Float32Array(count) : null;
    const one = [0], three = [0, 0, 0];
    let reliefPixels = 0, reliefDisagreements = 0, pigmentPixels = 0, rejectedPigmentSamples = 0, normalPixels = 0;
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const samples = observe('height', elevations, x, y);
      const result = consensus(samples, a => a[0], (a, b) => Math.abs(a[0] - b[0]), reliefToleranceMm, one);
      if (!result.count) continue;
      relief[p] = one[0];
      observedRelief[p] = 1;
      reliefPixels++;
      if (result.deviation > reliefToleranceMm) reliefDisagreements++;
      reliefConfidence[p] = result.weight / elevationWeight * Math.min(1, result.count / 2) /
        (1 + result.deviation / reliefToleranceMm);
    }
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const supplied = observe('normal', surfaces, x, y), normalWeight = mean(supplied, three);
      const hasNormal = normalWeight > 0 && magnitude(three) > 1e-8;
      const normal = hasNormal ? normalize(three) : observedRelief[p] ?
        reliefGradient(relief, observedRelief, p, x, y, width, height, pixelPitchMm) : flat;
      normalConfidence[p] = hasNormal ? normalWeight / surfaceWeight * clamp(magnitude(three)) : reliefConfidence[p];
      const hasSurface = hasNormal || observedRelief[p];
      if (hasSurface) normalPixels++;
      normals.set(normal, p * 3);
      if (roughness) {
        const valid = mean(observe('roughness', finishes, x, y), one);
        roughness[p] = valid ? one[0] : .65;
      }
      const samples = [];
      for (const view of views) {
        const taps = view.taps(x, y), sample = taps && view.color(taps);
        if (!sample) continue;
        const irradiance = view.irradiance ? view.irradiance(taps) :
          hasSurface || !view.light.needsNormal ? { value: view.light.sample(normal), weight: 1 } : undefined;
        if (!irradiance || Math.min(...irradiance.value) < minimumLight) {
          rejectedPigmentSamples++;
          continue;
        }
        const corrected = view.transform(sample.value);
        const value = corrected.map((n, c) => n / irradiance.value[c % irradiance.value.length]);
        if (!value.every(n => Number.isFinite(Math.fround(n)))) throw new RangeError('Calibrated pigment exceeds the float image range');
        samples.push({ value, weight: view.weight * Math.min(sample.weight, irradiance.weight) });
      }
      const fit = consensus(samples, luma, (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), pigmentTolerance, three);
      if (!fit.count) continue;
      rejectedPigmentSamples += samples.length - fit.count;
      pigmentPixels++;
      pigment.set(three, p * 4);
      pigment[p * 4 + 3] = 1;
      pigmentConfidence[p] = fit.weight / totalWeight / (1 + fit.deviation / pigmentTolerance);
    }
    if (!pigmentPixels || !normalPixels) throw new RangeError('The material tile has no usable pigment or normal evidence');
    const image = (data, channels, descriptor) => P.graphImages.declare({ width, height, channels, data },
      { ...descriptor, pixelPitchMm });
    const maps = {
      baseColor: image(pigment, 4, { intent: 'color', colorSpace: 'srgb-linear' }),
      normal: image(normals, 3, { intent: 'normal', normalSpace: 'tangent', normalOrientation: 'opengl' }),
      'mask.pigment-confidence': image(pigmentConfidence, 1, { intent: 'mask' }),
      'mask.normal-confidence': image(normalConfidence, 1, { intent: 'mask' })
    };
    if (elevations.length) {
      maps.height = image(relief, 1, { intent: 'height', units: 'mm' });
      maps['mask.relief-confidence'] = image(reliefConfidence, 1, { intent: 'mask' });
    }
    if (roughness) maps.roughness = image(roughness, 1, { intent: 'data' });
    const report = { width, height, pixelPitchMm, captures: views.map(view => view.report),
      reliefPixels, reliefDisagreements, pigmentPixels, rejectedPigmentSamples, normalPixels };
    return { value: P.materialChannels.pack(maps), report };
  }

  const operations = {
    'material.measure': {
      description: 'Register planar scan captures, remove calibrated illumination, and recover pigment, relief, normals and confidence.',
      inputs: { captures: 'array<record>', settings: 'record' },
      outputs: { value: 'materialChannels', report: 'record' },
      run({ captures, settings }) { return recover(captures, settings); }
    }
  };
  P.measuredMaterials = Object.freeze({ recover, operations });
})(KIT);
