/* Physical values, encoding contracts and delivery clipping in native material maps. */
(function (P) {
  const record = P.graphTypes.validator('record');
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const integer = Number.isSafeInteger, finite = Number.isFinite;
  const precisions = ['unorm8', 'unorm16', 'float32', 'float64'];
  const spaces = ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'];
  const maximum = { unorm8: 255, unorm16: 65535 };
  const storage = { unorm8: Uint8Array, unorm16: Uint16Array, float32: Float32Array, float64: Float64Array };
  const scalar = ['roughness', 'metalness', 'ao', 'opacity'];
  const namePattern = /^[A-Za-z][\w.-]{0,99}$/;
  const id = key => namePattern.test(key) && !['constructor', 'prototype'].includes(key);
  const clamp = n => Math.max(0, Math.min(1, n));
  const byte = n => Math.round(255 * (finite(n) ? clamp(n) : 0));
  const eps = 1e-7;
  const limitsFor = {
    png: [8, 16], tiff: [8, 16, 32], exr: [16, 32], pfm: [32], json: []
  };
  const defaults = { png: 16, tiff: 16, exr: 32, pfm: 32 };
  const tags = ['units', 'colorSpace', 'alpha', 'precision', 'normalSpace', 'normalOrientation'];
  const contractChecks = {
    units: v => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 64,
    colorSpace: v => spaces.includes(v) || v === 'none',
    alpha: v => ['none', 'straight', 'premultiplied'].includes(v),
    precision: v => precisions.includes(v),
    normalSpace: v => ['world', 'tangent'].includes(v),
    normalOrientation: v => ['opengl', 'directx'].includes(v)
  };

  function profile(settings) {
    if (!fields(settings, ['maps', 'required', 'aligned', 'normalTolerance', 'displaySpace']))
      throw new TypeError('Invalid material validation profile');
    const { maps = {}, required = [], aligned = false, normalTolerance = .025, displaySpace = 'srgb' } = settings;
    if (!record(maps) || Object.keys(maps).length > 64 || !Array.isArray(required) || required.length > 64 ||
        !Array.from(required).every(name => typeof name === 'string' && id(name)) ||
        typeof aligned !== 'boolean' || !finite(normalTolerance) || normalTolerance <= 0 || normalTolerance > 1 ||
        displaySpace !== null && !spaces.includes(displaySpace))
      throw new RangeError('Invalid material validation maps, alignment, normal tolerance or display color space');
    for (const [name, rules] of Object.entries(maps)) {
      if (!id(name) || !fields(rules, ['range', 'delivery', ...tags]) ||
          tags.some(tag => Object.hasOwn(rules, tag) && !contractChecks[tag](rules[tag])) ||
          rules.range !== undefined && (!Array.isArray(rules.range) || rules.range.length !== 2 ||
            !Array.from(rules.range).every(finite) || rules.range[0] > rules.range[1]))
        throw new TypeError('Invalid validation rules for ' + name);
      if (rules.delivery !== undefined) {
        const { delivery } = rules;
        if (!fields(delivery, ['format', 'bitDepth', 'colorSpace']) || !Object.hasOwn(limitsFor, delivery.format) ||
            delivery.bitDepth !== undefined && !limitsFor[delivery.format].includes(delivery.bitDepth) ||
            delivery.colorSpace !== undefined && !spaces.includes(delivery.colorSpace))
          throw new TypeError('Invalid validation delivery for ' + name);
      }
    }
    return { maps, required, aligned, normalTolerance, displaySpace };
  }

  function images(source) {
    const channels = source?.format === P.materialChannels.format ? source.channels : source;
    if (!record(channels) || Object.keys(channels).length > 64 || !Object.keys(channels).length)
      throw new TypeError('Material validation needs a material packet or a named image record');
    return Object.entries(channels).map(([name, value]) => {
      if (!id(name)) throw new TypeError('Invalid material validation channel name ' + name);
      return [name, source === channels ? value : value?.raster];
    });
  }

  function grid(image) {
    const row = image?.format === P.graphImages.format ? image.raster : image;
    const { width, height, data } = row ?? {};
    const channels = row?.channels ?? data?.length / (width * height);
    if (!integer(width) || !integer(height) || width < 1 || height < 1 ||
        !integer(channels) || channels < 1 || channels > 4 ||
        !(Array.isArray(data) || ArrayBuffer.isView(data)) || data.length !== width * height * channels)
      return null;
    return { width, height, channels, data, pivot: row.pivot };
  }

  function inspect(source, settings = {}, { preview = false, provenance } = {}) {
    const rules = profile(settings), entries = images(source);
    const maps = {}, rasters = {}, mapFindings = [];
    let scanned = 0, maskBytes = 0, reference;
    for (const [name, image] of entries) {
      const samples = grid(image), size = samples ? samples.width * samples.height : 0;
      if ((scanned += size) > 8_000_000) throw new RangeError('Material validation exceeds its eight million texel budget');
      const imageSpec = image?.format === P.graphImages.format && record(image.descriptor) ? image.descriptor : null;
      const spec = imageSpec ?? {}, key = rules.maps[name] ?? {};
      const lineage = provenance?.(name, image), origin = lineage?.origin ?? { kind: 'input' };
      const list = new Map();
      const row = { status: 'pass', ...(samples && { width: samples.width, height: samples.height }),
        ...(imageSpec && { descriptor: imageSpec }), origin, findings: [] };
      maps[name] = row;
      const contract = { name, spec, samples, key, version: image?.version };
      function finding(code, severity, message, p, values, details, cause) {
        let item = list.get(code);
        if (!item) {
          const summary = { id: name + ':' + code, channel: name, code, severity, message, count: 0, sources: [], examples: [],
            ...(details && { details }) };
          item = { summary, sources: new Map() };
          list.set(code, item);
          if (preview && p !== undefined) {
            if ((maskBytes += size) > 96 * 1024 * 1024) throw new RangeError('Material validation exceeds its preview mask budget');
            item.mask = new Uint8Array(size);
          }
        }
        const { summary, sources, mask } = item;
        summary.count++;
        const owner = cause ?? (p === undefined ? origin : lineage?.at?.(p) ?? origin);
        const group = [owner.kind, owner.node, owner.port, owner.layer, owner.input, owner.file].join('/');
        if (!sources.has(group)) sources.set(group, { ...owner, count: 0, index: sources.size + 1 });
        const assigned = sources.get(group);
        assigned.count++;
        if (p !== undefined) {
          const x = p % samples.width, y = Math.floor(p / samples.width), old = summary.bounds;
          summary.bounds = old ? [Math.min(old[0], x), Math.min(old[1], y), Math.max(old[2], x), Math.max(old[3], y)] : [x, y, x, y];
          if (summary.examples.length < 8) summary.examples.push({ x, y, values: Array.from(values, n => finite(n) ? n : String(n)), source: owner });
          if (mask) mask[p] = Math.min(255, assigned.index);
        }
      }
      if (!samples) finding('layout', 'error', 'Raster extent or channel storage is invalid');
      else {
        checkContract(contract, finding);
        if (rules.aligned) {
          const shape = JSON.stringify([samples.width, samples.height, samples.pivot ?? null, spec.pixelPitchMm ?? null,
            spec.tiling?.u ?? null, spec.tiling?.v ?? null, spec.sampling ?? null]);
          if (reference && reference.shape !== shape)
            finding('alignment', 'error', 'Map grid differs from ' + reference.name, undefined, undefined, { reference: reference.name });
          reference ??= { name, shape };
        }
        const rendered = checkSamples(contract, rules, finding, preview);
        if (preview) rasters[name] = { width: samples.width, height: samples.height, data: rendered, masks: {} };
        for (const { p, min, max, source, code = 'paint-clipping' } of lineage?.clips?.() ?? [])
          if (integer(p) && p >= 0 && p < size)
            finding(code, 'error', code === 'paint-clipping' ? 'Paint clipped before its bounded canvas stored the result' :
              'Image conversion clipped samples before storing the result', p, [min, max], undefined, source);
      }
      for (const { summary, sources, mask } of list.values()) {
        summary.sources = [...sources.values()].map(({ index, ...source }) => source);
        row.findings.push(summary.id);
        mapFindings.push(summary);
        if (mask) rasters[name].masks[summary.id] = mask;
        row.status = summary.severity === 'error' ? 'error' : row.status === 'pass' ? 'warning' : row.status;
      }
    }
    for (const name of new Set(rules.required)) if (!Object.hasOwn(maps, name)) {
      const finding = { id: name + ':missing', channel: name, code: 'missing', severity: 'error',
        message: 'Required material map is missing', count: 1, sources: [], examples: [] };
      mapFindings.push(finding);
      maps[name] = { status: 'error', findings: [finding.id] };
    }
    const errors = mapFindings.filter(row => row.severity === 'error').length;
    return { report: { valid: errors === 0, errors, warnings: mapFindings.length - errors, maps, findings: mapFindings }, rasters };
  }

  function checkContract({ name, spec, samples, key, version }, find) {
    const role = name === 'baseColor' || name === 'emission' ? 'color' : name === 'normal' ? 'normal' :
      name === 'height' ? 'height' : name === 'flow' ? 'flow' :
      scalar.includes(name) || name.startsWith('mask.') ? 'scalar' : null;
    if (!spec.intent) find('untyped', 'warning', 'No typed image contract is assigned');
    else {
      const { intent, layout, alpha, precision, colorSpace, units, tiling, sampling, domain } = spec;
      const { channels, data } = samples;
      const Type = storage[precision];
      const encoding = Type && (Array.isArray(data) || data instanceof Type ||
        precision === 'unorm8' && data instanceof Uint8ClampedArray);
      const expectedDomain = maximum[precision] || intent === 'mask' || intent === 'color' && (typeof colorSpace !== 'string' || !colorSpace.endsWith('-linear')) ?
        'unit' : intent === 'normal' ? 'signed-unit' : 'finite';
      if (version !== P.graphImages.version || !encoding || domain !== expectedDomain || !['nearest', 'linear'].includes(sampling) ||
          !['u', 'v'].every(axis => ['clamp', 'transparent', 'wrap', 'mirror'].includes(tiling?.[axis])) ||
          !['color', 'normal', 'height', 'mask', 'data'].includes(intent) ||
          typeof layout !== 'string' || layout.length !== channels || !contractChecks.alpha(alpha) ||
          (alpha !== 'none' && !layout.endsWith('a')) || !contractChecks.units(units) ||
          (intent === 'color' ? !spaces.includes(colorSpace) || !['rgb', 'rgba'].includes(layout) ||
            (alpha === 'none') !== (layout === 'rgb') || units !== 'unitless' : colorSpace !== 'none') ||
          intent === 'normal' && (!['xyz', 'xyza'].includes(layout) ||
            spec.normalSpace !== undefined && !contractChecks.normalSpace(spec.normalSpace) ||
            spec.normalOrientation !== undefined && (!contractChecks.normalOrientation(spec.normalOrientation) || spec.normalSpace === 'world')) ||
          intent === 'height' && (layout !== 'r' || maximum[precision]) || intent === 'mask' && layout !== 'r')
        find('contract', 'error', 'Image encoding or descriptor is inconsistent with its sample storage');
      if (role === 'scalar' ? !['data', 'mask'].includes(intent) || units !== 'unitless' || channels !== 1 :
        role === 'flow' ? intent !== 'data' || channels !== 2 || !!maximum[precision] : role && intent !== role)
        find('usage', 'error', 'Image intent, units or component count do not match ' + name);
      if (intent === 'height' && units === 'unitless') find('height-units', 'warning', 'Height has no physical unit assignment');
    }
    const differences = tags.filter(tag => Object.hasOwn(key, tag) && key[tag] !== spec[tag]).map(tag =>
      ({ field: tag, expected: key[tag], actual: spec[tag] ?? null }));
    if (differences.length) find('convention', 'error', 'Map convention differs from the validation profile', undefined, undefined, differences);
    const delivery = key.delivery;
    if (delivery && spec.intent === 'height' &&
        (delivery.format === 'png' || delivery.format === 'tiff' && (delivery.bitDepth ?? 16) < 32))
      find('delivery-format', 'error', 'Physical height needs a floating-point texture or JSON delivery');
    if (delivery?.format === 'pfm' && (samples.channels === 2 || samples.channels === 4))
      find('delivery-layout', 'error', 'PFM delivery requires one or three sample lanes');
  }

  function checkSamples({ name, spec, samples, key }, rules, find, preview) {
    const { data, width, height, channels } = samples;
    const { intent, precision, alpha: association, colorSpace, domain } = spec;
    const color = intent === 'color' && spaces.includes(colorSpace) && channels >= 3;
    const normal = (intent === 'normal' || name === 'normal') && channels >= 3;
    const alpha = channels === 4 && (association === 'straight' || association === 'premultiplied');
    const premult = alpha && association === 'premultiplied';
    const encoded = maximum[precision] ?? (!spec.intent &&
      (data instanceof Uint8Array || data instanceof Uint8ClampedArray) ? 255 : 0), divisor = encoded || 1;
    const bounded = key.range ?? (name === 'emission' ? [0, Infinity] : name === 'baseColor' ||
      scalar.includes(name) || name.startsWith('mask.') ? [0, 1] : normal ? [-1, 1] : null);
    const delivery = key.delivery, bitDepth = delivery?.bitDepth ?? defaults[delivery?.format];
    const unsigned = delivery && (delivery.format === 'png' || delivery.format === 'tiff' && bitDepth < 32);
    const limit = delivery?.format === 'exr' && bitDepth === 16 ? 65504 : 0;
    const linearize = color && ColorSpace.prepare(colorSpace, colorSpace.replace(/-linear$/, '') + '-linear');
    const display = color && rules.displaySpace && ColorSpace.prepare(colorSpace, rules.displaySpace);
    const deliver = color && unsigned && ColorSpace.prepare(colorSpace, delivery.colorSpace ??
      (delivery.format === 'png' ? 'srgb' : colorSpace));
    const length = alpha ? channels - 1 : channels, read = new Float64Array(length), converted = new Float64Array(3);
    const out = preview ? new Uint8Array(width * height * 4) : null;
    let low = Infinity, high = -Infinity;
    if (preview && intent === 'height') {
      for (const sample of data) if (finite(sample)) { low = Math.min(low, sample); high = Math.max(high, sample); }
    }
    const outside = (a, lo, hi) => a < lo - eps || a > hi + eps;
    const exceeds = (list, lo, hi) => list.some(n => outside(n, lo, hi));
    for (let p = 0; p < width * height; p++) {
      const i = p * channels, a = alpha ? data[i + length] / divisor : 1;
      let bad = !finite(a), badStorage = alpha && outside(a, 0, 1);
      for (let c = 0; c < length; c++) {
        const raw = data[i + c];
        bad ||= !finite(raw);
        badStorage ||= !!encoded && (!integer(raw) || raw < 0 || raw > encoded) ||
          precision === 'float32' && finite(raw) && !finite(Math.fround(raw));
        read[c] = raw / divisor;
      }
      if (bad) {
        find('nonfinite', 'error', 'Sample contains NaN or infinity', p, data.slice(i, i + channels));
        if (out) out.set([215, 47, 144, 255], p * 4);
        continue;
      }
      const rawRange = domain === 'unit' ? [0, 1] : domain === 'signed-unit' ? [-1, 1] : null;
      if (badStorage || rawRange && exceeds(read, ...rawRange) ||
          premult && (a === 0 && read.some(n => n !== 0) || domain === 'unit' && color && exceeds(read, 0, a)))
        find('sample-encoding', 'error', 'Sample is outside the declared encoding or alpha association', p, data.slice(i, i + channels));
      if (premult && a > 0) for (let c = 0; c < length; c++) read[c] /= a;
      if (normal && encoded) for (let c = 0; c < 3; c++) read[c] = read[c] * 2 - 1;
      try {
        if (read.some(n => !finite(n))) throw new RangeError('Sample unassociation overflows');
        if (a > 0) {
          const physical = linearize ? linearize(read, converted) : read;
          if (bounded && exceeds(physical, ...bounded))
            find('physical-range', 'error', 'Sample is outside the physical or specified range', p, physical,
              { range: bounded.map(n => finite(n) ? n : null) });
          if (normal) {
            const magnitude = Math.hypot(read[0], read[1], read[2]);
            if (Math.abs(magnitude - 1) > rules.normalTolerance)
              find('normal-length', 'error', 'Normal vector is not unit length', p, [...read, magnitude],
                { tolerance: rules.normalTolerance });
            if (spec.normalSpace !== 'world' && read[2] < -eps)
              find('normal-hemisphere', 'warning', 'Tangent normal points behind the surface', p, read);
          }
          if (deliver && exceeds(deliver(read, converted), 0, 1) ||
              unsigned && !color && !normal && intent !== 'height' && exceeds(read, 0, 1) ||
              limit && exceeds(read, -limit, limit))
            find('delivery-clipping', 'error', 'Delivery cannot represent the sample range or gamut', p, read, delivery);
          if (display && !deliver && exceeds(display(read, converted), 0, 1))
            find('preview-clipping', 'warning', 'Display gamut clips this sample', p, read, { colorSpace: rules.displaySpace });
        }
        if (!out) continue;
        const o = p * 4;
        if (display) {
          display(read, converted);
          for (let c = 0; c < 3; c++) out[o + c] = byte(converted[c]);
        } else if (normal) {
          for (let c = 0; c < 3; c++) out[o + c] = byte(.5 + .5 * read[c]);
        } else if (channels >= 3) {
          for (let c = 0; c < 3; c++) out[o + c] = byte(read[c]);
        } else {
          const value = intent === 'height' && high > low ? (read[0] - low) / (high - low) : read[0];
          out[o] = out[o + 1] = out[o + 2] = byte(value);
        }
        out[o + 3] = byte(a);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        find('numeric-overflow', 'error', 'Decoded sample exceeds the finite conversion range', p, data.slice(i, i + channels));
        if (out) out.set([215, 47, 144, 255], p * 4);
      }
    }
    return out;
  }

  const operation = {
    description: 'Check material physical ranges, map conventions and delivery clipping.',
    inputs: { source: 'any', profile: { type: 'record', default: {} } },
    outputs: { report: 'record', passed: 'boolean' },
    run({ source, profile }) {
      const { report } = inspect(source, profile);
      return { report, passed: report.valid };
    }
  };
  P.materialValidation = Object.freeze({ inspect, operations: Object.freeze({ 'material.validate': operation }) });
})(KIT.procedural);
