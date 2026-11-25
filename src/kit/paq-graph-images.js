/* Image contracts for typed graph ports and explicit legacy raster boundaries. */
(function (P) {
  const format = 'ink-studio/graph-image';
  const version = 1;
  const { validator } = P.graphTypes;
  const record = validator('record'), raster = validator('raster');
  const intents = ['color', 'height', 'normal', 'mask', 'data'];
  const storage = { unorm8: Uint8Array, unorm16: Uint16Array, float32: Float32Array, float64: Float64Array };
  const colors = ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'];
  const edges = ['clamp', 'transparent', 'wrap', 'mirror'];
  const specKeys = ['intent', 'layout', 'precision', 'units', 'colorSpace', 'alpha', 'tiling', 'sampling', 'domain'];
  const optionalSpecKeys = [...specKeys, 'pixelPitchMm', 'materialSeed', 'normalSpace', 'normalOrientation'];
  const maxPixels = 16777216;
  const own = Object.hasOwn;
  const finite = Number.isFinite;
  const unit = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 64;
  const integerMax = precision => precision === 'unorm8' ? 255 : precision === 'unorm16' ? 65535 : 0;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const dimensions = ({ width, height }) => width <= 8192 && height <= 8192 && width * height <= maxPixels;
  const validPivot = pivot => pivot === undefined || Array.isArray(pivot) && pivot.length === 2 &&
    finite(pivot[0]) && finite(pivot[1]);
  const count = source => source.channels ?? source.data.length / (source.width * source.height);
  const precisionOf = data => data instanceof Uint8ClampedArray ? 'unorm8' :
    Object.keys(storage).find(name => data instanceof storage[name]);

  function defaultLayout(intent, channels) {
    if (intent === 'normal') return channels === 4 ? 'xyza' : 'xyz';
    return ['r', 'rg', 'rgb', 'rgba'][channels - 1];
  }

  function descriptor(source, settings) {
    if (!fields(settings, optionalSpecKeys)) throw new TypeError('Invalid graph image descriptor');
    const { intent, layout = defaultLayout(intent, count(source)), precision = precisionOf(source.data) ?? 'float64',
      units = intent === 'height' ? undefined : 'unitless',
      colorSpace = intent === 'color' ? source.colorSpace ?? 'srgb' : 'none',
      alpha = intent === 'color' && layout === 'rgba' || intent === 'normal' && layout === 'xyza' ? 'straight' : 'none',
      sampling = 'nearest', tiling = {}, pixelPitchMm, materialSeed, normalSpace, normalOrientation } = settings;
    if (!intents.includes(intent) || typeof layout !== 'string' || layout.length !== count(source) ||
        !['r', 'rg', 'rgb', 'rgba', 'xyz', 'xyza'].includes(layout) || !own(storage, precision) || !unit(units) ||
        !['none', 'straight', 'premultiplied'].includes(alpha) || alpha !== 'none' && !layout.endsWith('a') ||
        !['nearest', 'linear'].includes(sampling) || !fields(tiling, ['u', 'v']))
      throw new TypeError('Invalid graph image intent, layout, precision, units, alpha or sampling');
    if (pixelPitchMm !== undefined && (!Array.isArray(pixelPitchMm) || pixelPitchMm.length !== 2 ||
        !finite(pixelPitchMm[0]) || pixelPitchMm[0] <= 0 || !finite(pixelPitchMm[1]) || pixelPitchMm[1] <= 0))
      throw new TypeError('Graph image pixel pitch needs two positive millimeter values');
    if (materialSeed !== undefined && !Number.isSafeInteger(materialSeed))
      throw new TypeError('Graph image material seed must be a safe integer');
    if (normalSpace !== undefined && (intent !== 'normal' || !['tangent', 'world'].includes(normalSpace)) ||
        normalOrientation !== undefined && (intent !== 'normal' || normalSpace === 'world' ||
          !['opengl', 'directx'].includes(normalOrientation)))
      throw new TypeError('Normal space and orientation must describe a tangent or world normal image');
    const { u = 'clamp', v = 'clamp' } = tiling;
    if (!edges.includes(u) || !edges.includes(v)) throw new TypeError('Invalid graph image tiling');
    const color = intent === 'color', linear = color && typeof colorSpace === 'string' && colorSpace.endsWith('-linear');
    if (color ? !colors.includes(colorSpace) || !['rgb', 'rgba'].includes(layout) ||
        (alpha === 'none') !== (layout === 'rgb') || units !== 'unitless' :
      colorSpace !== 'none' || intent === 'normal' && !['xyz', 'xyza'].includes(layout) ||
        ['mask', 'height'].includes(intent) && layout !== 'r')
      throw new TypeError('Graph image layout or color space does not match its intent');
    if (source.colorSpace !== undefined && source.colorSpace !== colorSpace)
      throw new TypeError('Graph image declaration cannot change an existing color space tag');
    if (intent === 'height' && integerMax(precision)) throw new TypeError('Height images need floating point precision');
    const domain = integerMax(precision) || intent === 'mask' || color && !linear ? 'unit' :
      intent === 'normal' ? 'signed-unit' : 'finite';
    if (settings.domain !== undefined && settings.domain !== domain)
      throw new TypeError('Graph image domain does not match its encoding');
    return Object.freeze({ intent, layout, precision, units, colorSpace, alpha, domain,
      tiling: Object.freeze({ u, v }), sampling,
      ...(pixelPitchMm !== undefined && { pixelPitchMm: Object.freeze(pixelPitchMm.slice()) }),
      ...(materialSeed !== undefined && { materialSeed }),
      ...(normalSpace !== undefined && { normalSpace }),
      ...(normalOrientation !== undefined && { normalOrientation }) });
  }

  function samples(data, spec, serialized = false) {
    const { precision, layout, alpha, domain } = spec;
    const max = integerMax(precision), width = layout.length;
    const actual = precisionOf(data);
    if (!Array.isArray(data) && actual !== precision) return false;
    if (max && actual && alpha !== 'premultiplied') return true;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (!finite(value) || max && (!Number.isInteger(value) || value < 0 || value > max) ||
          precision === 'float32' && (!finite(Math.fround(value)) || serialized && Math.fround(value) !== value)) return false;
      const opacity = alpha !== 'none' && i % width === width - 1;
      if (alpha === 'premultiplied' && !opacity) {
        const coverage = data[i - i % width + width - 1];
        if (coverage === 0 && value !== 0 || spec.intent === 'color' && domain === 'unit' && value > coverage) return false;
      }
      if (!max && (opacity || domain === 'unit') && (value < 0 || value > 1) ||
          !opacity && domain === 'signed-unit' && (value < -1 || value > 1)) return false;
    }
    return true;
  }

  function wrap(source, spec) {
    const { width, height, data, pivot } = source;
    const value = Object.freeze({ width, height, channels: count(source), data,
      ...(pivot !== undefined && { pivot: Object.freeze(pivot.slice()) }) });
    return Object.freeze({ format, version, raster: value, descriptor: spec });
  }

  function valid(value, intent) {
    if (!fields(value, ['format', 'version', 'raster', 'descriptor']) || value.format !== format ||
        value.version !== version || !raster(value.raster) || !dimensions(value.raster) || !validPivot(value.raster.pivot) ||
        !fields(value.descriptor, optionalSpecKeys) || specKeys.some(key => !own(value.descriptor, key)) ||
        !fields(value.descriptor.tiling, ['u', 'v']) || Object.keys(value.descriptor.tiling).length !== 2 ||
        intent !== undefined && value.descriptor.intent !== intent) return false;
    try { return samples(value.raster.data, descriptor(value.raster, value.descriptor), true); }
    catch { return false; }
  }

  function declare(source, settings) {
    if (!raster(source) || !dimensions(source) || !validPivot(source.pivot))
      throw new TypeError('Graph image needs a bounded source raster and a valid pivot');
    const spec = descriptor(source, settings), { data } = source;
    if (!samples(data, spec)) throw new TypeError('Graph image samples do not match ' + spec.precision + ' ' + spec.domain);
    return wrap(Array.isArray(data) ? { ...source, data: storage[spec.precision].from(data) } : source, spec);
  }

  function requireImage(source, intent) {
    if (!valid(source, intent)) throw new TypeError('Expected a valid typed ' + (intent ? intent + ' ' : '') + 'image');
    return source;
  }

  function alphaAt(data, i, spec) {
    return spec.alpha === 'none' ? 1 : data[i + spec.layout.length - 1] / (integerMax(spec.precision) || 1);
  }

  function convertColor(spec, target) {
    const convert = ColorSpace.prepare(spec.colorSpace, target), rgb = [0, 0, 0];
    const scale = integerMax(spec.precision) || 1;
    return (data, i, out) => {
      const a = alphaAt(data, i, spec);
      const gain = spec.alpha === 'premultiplied' ? a ? 1 / (scale * a) : 0 : 1 / scale;
      for (let c = 0; c < 3; c++)
        rgb[c] = finite(gain) ? data[i + c] * gain : data[i + c] / scale / a;
      convert(rgb, out);
      return a;
    };
  }

  const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

  function pack(value, spec, opacity, outOfRange) {
    if (!finite(value)) throw new RangeError('Image conversion needs finite samples');
    const low = !opacity && spec.domain === 'signed-unit' ? -1 : 0;
    if (opacity || spec.domain !== 'finite') {
      if (outOfRange === 'error' && (value < low || value > 1))
        throw new RangeError('Image sample ' + value + ' is outside [' + low + ', 1]');
      value = Math.max(low, Math.min(1, value));
    }
    const max = integerMax(spec.precision);
    if (max) return Math.round(value * max);
    if (spec.precision === 'float32' && !finite(Math.fround(value)))
      throw new RangeError('Image sample exceeds float32 range');
    return value;
  }

  function uniform(value, width, height, settings) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !dimensions({ width, height }))
      throw new RangeError('Uniform image extent exceeds the raster budget');
    const { layout } = literalShape(settings, 'image.uniform');
    const input = typeof value === 'number' ? [value] : value, channels = layout.length;
    if (!Array.isArray(input) || input.length !== channels || !Array.from(input).every(finite))
      throw new TypeError('Uniform ' + layout + ' image needs ' + channels + ' finite sample values');
    const spec = descriptor({ width: 1, height: 1, channels, data: input }, { ...settings, layout });
    const alpha = spec.alpha !== 'none', last = channels - 1;
    if (spec.alpha === 'premultiplied' && input.slice(0, last).some(n =>
      input[last] === 0 && n !== 0 || spec.intent === 'color' && spec.domain === 'unit' && n > input[last]))
      throw new RangeError('Uniform image samples do not match its premultiplied alpha');
    const pixel = storage[spec.precision].from(input, (n, c) => pack(n, spec, alpha && c === last, 'error'));
    if (!samples(pixel, spec)) throw new RangeError('Uniform image samples do not match its alpha encoding');
    const data = new storage[spec.precision](width * height * channels);
    data.set(pixel);
    for (let filled = channels; filled < data.length; filled *= 2)
      data.set(data.subarray(0, Math.min(filled, data.length - filled)), filled);
    return wrap({ width, height, channels, data }, spec);
  }

  function convert(source, target, { outOfRange = 'error', dropAlpha = false } = {}) {
    const { raster: grid, descriptor: from } = requireImage(source);
    if (!fields(target, ['intent', 'layout', 'precision', 'colorSpace', 'alpha']) ||
        !['error', 'clamp'].includes(outOfRange) || typeof dropAlpha !== 'boolean')
      throw new TypeError('Invalid image conversion target or range policy');
    const { intent, layout } = literalShape(target, 'image.convert', from);
    const wasColor = from.intent === 'color', isColor = intent === 'color';
    const scalar = spec => ['data', 'mask'].includes(spec.intent) && spec.layout === 'r' && spec.units === 'unitless';
    const same = from.intent === intent && from.layout === layout;
    if (!same && !(wasColor && isColor) && !((wasColor || scalar(from)) && (isColor || scalar({ intent, layout, units: from.units }))))
      throw new TypeError('Image conversion needs compatible layouts and units. Use image.toHeight for relief.');
    const { width, height, data, pivot, channels } = grid, next = layout.length;
    const { tiling, sampling, pixelPitchMm, materialSeed, units, normalSpace, normalOrientation } = from;
    const keepAlpha = same || wasColor && isColor && layout === 'rgba' && from.alpha !== 'none';
    const { precision = from.precision, alpha = keepAlpha ? from.alpha : undefined,
      colorSpace = isColor ? wasColor ? from.colorSpace : 'srgb-linear' : 'none' } = target;
    const to = descriptor({ width, height, channels: next, data }, {
      intent, layout, precision, colorSpace, alpha, units, tiling, sampling, pixelPitchMm, materialSeed, normalSpace, normalOrientation
    });
    if (!wasColor && !isColor && from.alpha !== to.alpha)
      throw new TypeError('Non-color image conversion must keep its alpha convention');
    if (same && from.precision === to.precision && from.colorSpace === to.colorSpace && from.alpha === to.alpha)
      return source;
    if (intent === 'normal') return normals.reencode(source, precision, outOfRange);
    const output = new storage[to.precision](width * height * next);
    const divisor = integerMax(from.precision) || 1;
    const rgb = [0, 0, 0], hasAlpha = to.alpha !== 'none', last = next - 1;
    const reencode = same && from.colorSpace === to.colorSpace && from.alpha === to.alpha && from.domain === to.domain;
    const toSpace = isColor ? to.colorSpace : 'srgb-linear';
    const colorTarget = isColor && to.domain === 'unit' ? { space: toSpace, outOfRange } : toSpace;
    const decode = wasColor && !reencode && convertColor(from, colorTarget);
    const expand = !wasColor && isColor && ColorSpace.prepare('srgb-linear', colorTarget);
    for (let i = 0, o = 0; i < data.length; i += channels, o += next) {
      const a = decode ? decode(data, i, rgb) : alphaAt(data, i, from);
      if (wasColor && to.alpha === 'none' && a !== 1 && !dropAlpha)
        throw new RangeError('Image conversion would discard coverage. Set dropAlpha to acknowledge it.');
      if (hasAlpha) output[o + last] = pack(a, to, true, outOfRange);
      const zeroCoverage = to.alpha === 'premultiplied' && output[o + last] === 0;
      if (isColor && !reencode) {
        if (expand) expand(rgb.fill(data[i] / divisor), rgb);
        const gain = to.alpha === 'premultiplied' ? a : 1;
        for (let c = 0; c < 3; c++) output[o + c] = pack(rgb[c] * gain, to, false, outOfRange);
      } else {
        for (let c = 0; c < next - Number(hasAlpha); c++) {
          const value = decode ? luminance(rgb) : data[i + c] / divisor;
          output[o + c] = pack(value, to, false, outOfRange);
        }
      }
      if (zeroCoverage) output.fill(0, o, o + last);
    }
    return wrap({ width, height, channels: next, data: output, pivot }, to);
  }

  function selectChannel(spec, key) {
    const index = key === 'alpha' ? spec.alpha === 'none' ? -1 : spec.layout.length - 1 :
      typeof key === 'number' ? key : typeof key === 'string' && key.length === 1 ? spec.layout.indexOf(key) : -1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= spec.layout.length)
      throw new RangeError('Image layout ' + spec.layout + ' has no channel ' + key);
    return index;
  }

  function splitChannels(source, channels) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { width, height, pivot, data, channels: stride } = grid;
    if (!record(channels) || !Object.keys(channels).length || Object.keys(channels).length > 4)
      throw new TypeError('Image split needs one to four named output selectors');
    return Object.fromEntries(Object.entries(channels).map(([name, selector]) => {
      const index = selectChannel(spec, selector);
      const coverage = spec.alpha !== 'none' && index === stride - 1;
      const intent = coverage || spec.intent === 'mask' ? 'mask' : spec.intent === 'height' ? 'height' : 'data';
      const plane = new storage[spec.precision](width * height);
      for (let p = 0; p < plane.length; p++) plane[p] = data[p * stride + index];
      return [name, declare({ width, height, pivot, channels: 1, data: plane },
        { ...spec, intent, layout: 'r', colorSpace: 'none', alpha: 'none', domain: undefined,
          units: coverage ? 'unitless' : spec.units, normalSpace: undefined, normalOrientation: undefined })];
    }));
  }

  function alignedGrid(a, b, allowMissing = false) {
    const pair = (left, right) => left === right || (left && right ?
      left[0] === right[0] && left[1] === right[1] : allowMissing);
    return a.raster.width === b.raster.width && a.raster.height === b.raster.height &&
      pair(a.raster.pivot, b.raster.pivot) && pair(a.descriptor.pixelPitchMm, b.descriptor.pixelPitchMm);
  }

  function alignedChannels(a, b) {
    return alignedGrid(a, b) &&
      a.descriptor.sampling === b.descriptor.sampling && a.descriptor.tiling.u === b.descriptor.tiling.u &&
      a.descriptor.tiling.v === b.descriptor.tiling.v;
  }

  function packChannels(sources, routes, target = { intent: 'data' }) {
    const names = record(sources) ? Object.keys(sources) : [];
    if (!names.length || names.length > 32 || !Array.isArray(routes) || routes.length < 1 || routes.length > 4)
      throw new TypeError('Image packing needs named input images and one to four routes');
    if (!fields(target, ['intent', 'layout', 'precision', 'units', 'colorSpace', 'alpha']) || !intents.includes(target.intent))
      throw new TypeError('Invalid image packing descriptor');
    const used = new Map();
    function input(name) {
      if (typeof name !== 'string' || !own(sources, name)) throw new RangeError('Unknown image packing source ' + name);
      if (!used.has(name)) used.set(name, requireImage(sources[name]));
      return used.get(name);
    }
    const assignments = Array.from(routes, route => {
      if (finite(route)) return { value: route };
      if (!fields(route, ['source', 'channel']) || !own(route, 'channel'))
        throw new TypeError('An image packing route needs a source and channel or a finite constant');
      const source = input(route.source), { raster, descriptor } = source;
      return { source, index: selectChannel(descriptor, route.channel), stride: raster.channels,
        scale: integerMax(descriptor.precision) || 1 };
    });
    const first = assignments.find(route => route.source)?.source ?? input(names[0]);
    if ([...used.values()].some(source => !alignedChannels(first, source)))
      throw new RangeError('Image packing sources must match extent, pivot, pitch, tiling and sampling');
    const { raster: grid, descriptor: base } = first;
    const { width, height, pivot } = grid, channels = assignments.length;
    const precisions = new Set([...used.values()].map(source => source.descriptor.precision));
    const units = new Set([...used.values()].map(source => source.descriptor.units));
    if (units.size > 1 && target.units === undefined)
      throw new TypeError('Image packing sources have different units. Set the intended output units explicitly.');
    const precision = precisions.size === 1 ? base.precision :
      [...precisions].every(integerMax) ? 'unorm16' : 'float64';
    const spec = descriptor({ width, height, channels, data: grid.data }, {
      precision, units: base.units, tiling: base.tiling, sampling: base.sampling,
      pixelPitchMm: base.pixelPitchMm, materialSeed: base.materialSeed, ...target
    });
    if (spec.intent === 'color') {
      const colorSources = assignments.slice(0, 3).filter(({ source, index }) =>
        source?.descriptor.intent === 'color' && index < 3);
      if (colorSources.some(({ source }) => source.descriptor.colorSpace !== spec.colorSpace ||
          (source.descriptor.alpha === 'premultiplied') !== (spec.alpha === 'premultiplied')))
        throw new TypeError('Color packing needs matching source color spaces and RGB association. Use image.convert before routing.');
    }
    const data = new storage[spec.precision](width * height * channels);
    for (let p = 0; p < width * height; p++) for (let c = 0; c < channels; c++) {
      const { source, index, scale, stride, value } = assignments[c];
      const sample = source ? source.raster.data[p * stride + index] / scale : value;
      data[p * channels + c] = pack(sample, spec, spec.alpha !== 'none' && c === channels - 1, 'error');
    }
    if (!samples(data, spec)) throw new RangeError('Packed channels do not match the output alpha encoding');
    return wrap({ width, height, channels, data, pivot }, spec);
  }

  function shuffleChannels(source, routes, target) {
    if (!Array.isArray(routes)) throw new TypeError('Image shuffle needs a list of channel selectors or constants');
    const selections = Array.from(routes, route => {
      if (finite(route)) return route;
      if (typeof route === 'string') return { source: 'source', channel: route };
      if (fields(route, ['channel']) && own(route, 'channel')) return { source: 'source', channel: route.channel };
      throw new TypeError('An image shuffle route needs a channel selector or a finite constant');
    });
    return packChannels({ source }, selections, target);
  }

  function channelMath(a, b, operation, { precision = 'float64', outOfRange = 'error' } = {}) {
    const { raster: left, descriptor: spec } = requireImage(a);
    const right = finite(b) ? null : requireImage(b);
    if (!own(RasterChannelMath, operation) || !['error', 'clamp'].includes(outOfRange))
      throw new RangeError('Invalid image channel math operation or range policy');
    if (!['data', 'mask', 'height'].includes(spec.intent) || spec.alpha !== 'none' ||
        right && (!['data', 'mask', 'height'].includes(right.descriptor.intent) || right.descriptor.alpha !== 'none' ||
          !alignedChannels(a, right) || right.raster.channels !== 1 && right.descriptor.layout !== spec.layout))
      throw new TypeError('Image channel math needs aligned unassociated numeric channels. Split color or alpha first.');
    const { width, height, channels, pivot, data } = left;
    const output = descriptor(left, { ...spec, precision, domain: undefined });
    const out = new storage[output.precision](data.length);
    const apply = RasterChannelMath[operation], leftScale = integerMax(spec.precision) || 1;
    const rightScale = right ? integerMax(right.descriptor.precision) || 1 : 1;
    const broadcast = right?.raster.channels === 1;
    for (let i = 0; i < out.length; i++) {
      const operand = right ? right.raster.data[broadcast ? Math.floor(i / channels) : i] / rightScale : b;
      const value = apply(data[i] / leftScale, operand);
      if (!finite(value)) throw new RangeError('Image channel math returned a nonfinite sample at index ' + i);
      out[i] = pack(value, output, false, outOfRange);
    }
    return wrap({ width, height, channels, pivot, data: out }, output);
  }

  const unitClamp = value => Math.min(1, Math.max(0, value));

  function blendCrop(crop, width, height) {
    if (!fields(crop, ['left', 'right', 'top', 'bottom'])) throw new TypeError('Invalid image blend crop');
    const { left = 0, right = 1, top = 0, bottom = 1 } = crop;
    if (![left, right, top, bottom].every(n => finite(n) && n >= 0 && n <= 1) || right < left || bottom < top)
      throw new RangeError('Image blend crop needs ordered edges from 0 to 1');
    return [left * width, right * width, top * height, bottom * height].map(edge => Math.ceil(edge - .5));
  }

  function blendImage(background, foreground, {
    mode = 'copy', opacity = 1, mask = null, crop = {}, alpha = 'source', clamp = 'auto'
  } = {}) {
    const { raster: back, descriptor: base } = requireImage(background);
    const { raster: front, descriptor: paint } = requireImage(foreground);
    const { width, height, pivot } = back;
    const color = base.intent === 'color';
    const key = mode === 'switch' ? 'copy' : mode;
    if (!own(RasterBlendModes, key) || !finite(opacity) || opacity < 0 || opacity > 1 ||
        !['source', 'ignore', 'straight', 'premultiplied'].includes(alpha) ||
        !['auto', 'mode', 'output', 'none'].includes(clamp))
      throw new RangeError('Invalid image blend mode, opacity, alpha policy or clamp');
    if (front.width !== width || front.height !== height || base.intent !== paint.intent ||
        base.units !== paint.units || base.colorSpace !== paint.colorSpace || !color && (back.channels !== 1 || front.channels !== 1))
      throw new TypeError('Image blend needs aligned matching RGB(A) or scalar images with the same intent, units and color space');
    if ((alpha === 'straight' || alpha === 'premultiplied') &&
        [base.alpha, paint.alpha].some(encoding => encoding !== 'none' && encoding !== alpha))
      throw new TypeError('Image blend alpha policy requires ' + alpha + ' inputs. Use image.convert.');
    const coverage = mask === null ? null : requireImage(mask, 'mask');
    if (coverage && (coverage.raster.width !== width || coverage.raster.height !== height))
      throw new TypeError('Image blend opacity mask must match the image extent');
    const [left, right, top, bottom] = blendCrop(crop, width, height);
    const withAlpha = color && (base.alpha !== 'none' || paint.alpha !== 'none');
    const channels = withAlpha ? 4 : back.channels;
    const encoding = withAlpha ? alpha === 'premultiplied' || alpha === 'source' && base.alpha === 'premultiplied' ?
      'premultiplied' : 'straight' : 'none';
    const spec = descriptor({ width, height, channels, data: back.data }, {
      ...base, layout: withAlpha ? 'rgba' : base.layout, alpha: encoding
    });
    const output = new storage[spec.precision](width * height * channels);
    const blend = RasterBlendModes[key], ignoreAlpha = alpha === 'ignore';
    const clampMode = clamp === 'mode' || clamp === 'auto' && spec.domain === 'unit';
    const clampOutput = clamp === 'output';
    const packPolicy = clampMode || clampOutput ? 'clamp' : 'error';
    const gateScale = coverage ? (integerMax(coverage.descriptor.precision) || 1) : 1;
    const backScale = integerMax(base.precision) || 1, frontScale = integerMax(paint.precision) || 1;
    const colors = color ? 3 : 1;
    const copyBackground = channels === back.channels && encoding === base.alpha;
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      const b = i * back.channels, f = i * front.channels, o = i * channels;
      const backAlpha = alphaAt(back.data, b, base), frontAlpha = alphaAt(front.data, f, paint);
      const inside = x >= left && x < right && y >= top && y < bottom;
      const gate = inside ? opacity * (coverage ? coverage.raster.data[i] / gateScale : 1) : 0;
      const weight = gate * (ignoreAlpha ? 1 : frontAlpha);
      if (!weight && copyBackground) {
        for (let c = 0; c < channels; c++) output[o + c] = back.data[b + c];
        continue;
      }
      const outAlpha = ignoreAlpha ? backAlpha : backAlpha + weight * (1 - backAlpha);
      if (withAlpha) output[o + 3] = pack(outAlpha, spec, true, 'clamp');
      const association = encoding === 'premultiplied' ? output[o + 3] ? outAlpha : 0 : 1;
      const backGain = base.alpha === 'premultiplied' ? backAlpha : 1;
      const frontGain = paint.alpha === 'premultiplied' ? frontAlpha : 1;
      const overlap = ignoreAlpha ? 1 : backAlpha;
      for (let c = 0; c < colors; c++) {
        const backSample = backGain ? back.data[b + c] / backScale / backGain : 0;
        let result = backSample;
        if (weight) {
          const frontSample = frontGain ? front.data[f + c] / frontScale / frontGain : 0;
          const mixed = overlap ? blend(backSample, frontSample) : frontSample;
          // Bounded divide gives black for 0/0 and saturates nonzero division by zero.
          const tile = clampMode || clampOutput && !finite(mixed) && key === 'divide' ? unitClamp(mixed) : mixed;
          result = ignoreAlpha ? backSample * (1 - weight) + tile * weight :
            (backSample * backAlpha * (1 - weight) + weight * (frontSample * (1 - backAlpha) + tile * backAlpha)) / outAlpha;
          if (clampOutput || spec.domain === 'unit' && clampMode) result = unitClamp(result);
        }
        if (spec.domain === 'unit' && packPolicy === 'error') {
          if (result < -16 * Number.EPSILON || result > 1 + 16 * Number.EPSILON)
            throw new RangeError('Image blend result ' + result + ' is outside [0, 1]');
          result = unitClamp(result);
        }
        output[o + c] = pack(association ? result * association : 0, spec, false, packPolicy);
      }
    }
    return wrap({ width, height, channels, data: output, pivot }, spec);
  }

  function toHeight(source, { scale, offset = 0, units = 'art-px', channel = 'luminance' } = {}) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { data, width, height, channels, pivot } = grid;
    if (![scale, offset].every(finite) || !unit(units) ||
        !['luminance', 'r', 'g', 'b', 'alpha'].includes(channel))
      throw new TypeError('Height conversion needs finite scale and offset, units and a channel');
    const color = spec.intent === 'color';
    if (!color && (channels !== 1 || channel !== 'luminance'))
      throw new TypeError('Height conversion needs RGB(A) or one scalar channel');
    const convert = color && convertColor(spec, 'srgb-linear');
    const component = ['r', 'g', 'b'].indexOf(channel), rgb = [0, 0, 0];
    const out = new Float64Array(width * height), divisor = integerMax(spec.precision) || 1;
    for (let p = 0, i = 0; p < out.length; p++, i += channels) {
      const a = color ? convert(data, i, rgb) : 1;
      const value = color ? channel === 'alpha' ? a : component >= 0 ? rgb[component] :
        luminance(rgb) : data[i] / divisor;
      out[p] = value * scale + offset;
      if (!finite(out[p])) throw new RangeError('Height conversion produced a nonfinite sample');
    }
    return declare({ width, height, channels: 1, data: out, pivot },
      { intent: 'height', units, tiling: spec.tiling, sampling: spec.sampling,
        ...(spec.pixelPitchMm && { pixelPitchMm: spec.pixelPitchMm }),
        ...(spec.materialSeed !== undefined && { materialSeed: spec.materialSeed }) });
  }

  function displaySamples(source, bitDepth, outOfRange = 'clamp') {
    const { raster: grid, descriptor: spec } = requireImage(source, 'color');
    if (![8, 16].includes(bitDepth) || !['clamp', 'error'].includes(outOfRange))
      throw new TypeError('Display output needs 8 or 16 bits and clamp or error range handling');
    const { data, channels } = grid, maximum = 2 ** bitDepth - 1;
    const out = bitDepth === 8 ? new Uint8Array(data.length) : new Uint16Array(data.length), rgb = [0, 0, 0];
    const convert = convertColor(spec, { space: 'srgb', range: [0, maximum], outOfRange });
    for (let i = 0; i < data.length; i += channels) {
      const opacity = convert(data, i, rgb);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgb[c]);
      if (channels === 4) out[i + 3] = Math.round(opacity * maximum);
    }
    return { ...grid, data: out, colorSpace: 'srgb' };
  }

  const toDisplay = (source, outOfRange = 'clamp') => displaySamples(source, 8, outOfRange);

  function sampler(grid, spec) {
    const { width, height, channels, data } = grid;
    const ax = TextureAddress.axis(spec.tiling.u), ay = TextureAddress.axis(spec.tiling.v);
    function add(x, y, weight, out) {
      const u = ax(x, width), v = ay(y, height);
      if (u < 0 || v < 0 || !weight) return;
      const index = (v * width + u) * channels;
      const alpha = spec.alpha === 'straight' ? alphaAt(data, index, spec) : 1;
      for (let c = 0; c < channels; c++)
        out[c] += weight * data[index + c] * (c === channels - 1 ? 1 : alpha);
    }
    return (u, v, out) => {
      out.fill(0);
      const x = u * width, y = v * height;
      if (spec.sampling === 'nearest') {
        const a = ax(Math.floor(x), width), b = ay(Math.floor(y), height);
        if (a >= 0 && b >= 0) for (let c = 0; c < channels; c++) out[c] = data[(b * width + a) * channels + c];
        return out;
      }
      const i = Math.floor(x - .5), j = Math.floor(y - .5), dx = x - .5 - i, dy = y - .5 - j;
      add(i, j, (1 - dx) * (1 - dy), out);
      add(i + 1, j, dx * (1 - dy), out);
      add(i, j + 1, (1 - dx) * dy, out);
      add(i + 1, j + 1, dx * dy, out);
      if (spec.alpha === 'straight' && out[channels - 1] > 0) {
        const alpha = out[channels - 1] / (integerMax(spec.precision) || 1);
        for (let c = 0; c < channels - 1; c++) out[c] /= alpha;
      }
      return out;
    };
  }

  function resize(source, width, height) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !dimensions({ width, height }))
      throw new RangeError('Image resize extent exceeds the raster budget');
    const { channels, pivot } = grid, at = sampler(grid, spec), values = Array(channels).fill(0);
    const out = new storage[spec.precision](width * height * channels);
    const max = integerMax(spec.precision);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      at((x + .5) / width, (y + .5) / height, values);
      const start = (y * width + x) * channels;
      for (let c = 0; c < channels; c++) {
        const alpha = spec.alpha !== 'none' && c === channels - 1, value = values[c];
        out[start + c] = max ? Math.round(Math.min(max, Math.max(0, value))) :
          alpha || spec.domain === 'unit' ? Math.min(1, Math.max(0, value)) :
          spec.domain === 'signed-unit' ? Math.min(1, Math.max(-1, value)) : value;
      }
    }
    return declare({ width, height, channels, data: out, pivot: pivot && [pivot[0] * width / grid.width,
      pivot[1] * height / grid.height] }, spec);
  }

  function toRaster(source) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    return { ...grid, ...(spec.intent === 'color' && { colorSpace: spec.colorSpace }) };
  }

  function inspect(source) {
    const { raster: { width, height }, descriptor: spec } = requireImage(source);
    return { extent: { width, height }, ...spec };
  }

  function literalShape(settings, name, source) {
    if (!record(settings) || !intents.includes(settings.intent))
      throw new TypeError(name + ' needs a literal descriptor with an image intent');
    const { intent, layout = source?.intent === intent ? source.layout :
      intent === 'color' ? 'rgb' : intent === 'normal' ? 'xyz' : 'r' } = settings;
    if (typeof layout !== 'string' || !['r', 'rg', 'rgb', 'rgba', 'xyz', 'xyza'].includes(layout))
      throw new TypeError(name + ' needs a valid image layout');
    return { intent, layout };
  }

  function literalDescriptor({ params, inputs }) {
    const binding = inputs?.descriptor ?? params?.descriptor;
    return own(binding ?? {}, 'value') ? binding.value : binding;
  }

  const typedOutput = intent => ({ value: ['color', 'height', 'normal'].includes(intent) ? intent + 'Image' : 'typedImage' });

  function specialize(node) {
    const settings = literalDescriptor(node);
    if (!record(settings) || !intents.includes(settings.intent))
      throw new TypeError('image.declare needs a literal descriptor with an image intent');
    const { intent } = settings;
    return {
      inputs: { source: intent === 'height' ? 'scalarRaster' : 'raster', descriptor: 'record' },
      outputs: typedOutput(intent),
      run({ source, descriptor }) { return { value: declare(source, descriptor) }; }
    };
  }

  function channelRouter(name) {
    const packing = name === 'image.pack';
    return {
      description: packing ? 'Pack selected typed image channels and numeric constants into one image.' :
        'Reorder, repeat or replace channels of one typed image.',
      specialize(node) {
        const descriptor = literalDescriptor(node) ?? { intent: 'data' };
        const { intent } = literalShape(descriptor, name);
        const source = packing ? { sources: 'record' } : { source: 'typedImage' };
        return {
          inputs: { ...source, routes: 'array', descriptor: { type: 'record', default: { intent: 'data' } } },
          outputs: typedOutput(intent),
          run({ sources, source, routes, descriptor }) {
            return { value: packing ? packChannels(sources, routes, descriptor) : shuffleChannels(source, routes, descriptor) };
          }
        };
      }
    };
  }

  const corrections = TypedImageCorrections({
    requireImage, descriptor, wrap, storage, pack, alphaAt, integerMax, convertColor, luminance
  });
  const transfers = TypedImageTransfers({
    requireImage, descriptor, wrap, storage, pack, alphaAt, integerMax, convertColor, luminance, sampler, dimensions, fields
  });
  const filters = TypedImageFilters({ requireImage, descriptor, wrap, storage, pack, integerMax, convertColor, fields });
  const measure = TypedImageMeasure({ requireImage, alphaAt, integerMax, convertColor, luminance });
  const morphology = TypedImageMorphology({
    requireImage, descriptor, wrap, storage, integerMax, measure, fields, geometry: P.geometry
  });
  const { spatial, resample, sampler: spatialSampler, borders, workingSamples } = TypedImageSpatial({
    requireImage, descriptor, wrap, storage, pack, integerMax, convertColor, dimensions, fields
  });
  const warps = TypedImageDisplacement({
    requireImage, descriptor, wrap, integerMax, filters, resample, sampler: spatialSampler, borders
  });
  const normals = TypedImageNormals({
    requireImage, declare, descriptor, wrap, pack, storage, integerMax, precisionOf, raster, fields, alignedGrid, borders,
    V: KIT.V, M: KIT.M
  });
  const regions = TypedImageRegions({
    measure, validImage: valid, descriptor, wrap, fields, borders, alignedGrid, resample, hash01: P.data.hash01
  });
  const advancedHeight = TypedAdvancedHeight({
    requireImage, descriptor, wrap, pack, storage, integerMax, fields, alignedGrid,
    borders, sampler: spatialSampler, morphology, filters, normals
  });
  const advancedTexture = TypedAdvancedTexture({
    requireImage, descriptor, wrap, storage, integerMax, measure, fields, alignedGrid, alphaAt,
    borders, sampler: spatialSampler, workingSamples
  });
  const makeNoise = TypedNoiseImage({
    named:P.namedNoise, descriptor, wrap, pack, storage, dimensions, fields, borders, freeze:P.data.freeze
  });
  const correctionOptions = { type: 'record', default: {} };
  const sameImage = { type: 'typedImage', typeFrom: 'source' };
  const optional = { type: 'any', default: null };
  const normalOutput = { value: 'normalImage' };
  function normalFilter(name, description, source = 'normalImage') {
    return { description, inputs: { source, options: correctionOptions }, outputs: normalOutput,
      run({ source, options }) { return { value: normals[name](source, options) }; } };
  }
  function filter(name, description, output = sameImage) {
    return { description, inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: output },
      run({ source, options }) { return { value: filters[name](source, options) }; } };
  }

  function remap(name, description) {
    return { description, inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: sameImage },
      run({ source, options }) { return { value: spatial[name](source, options) }; } };
  }

  function warp(name, description, direction = false) {
    return {
      description, inputs: { source: 'typedImage', map: 'typedImage', ...(direction && { direction: 'typedImage' }),
        intensity: { type: 'any', default: null }, options: correctionOptions }, outputs: { value: sameImage },
      run({ source, map, direction: angleMap, intensity, options }) {
        const value = direction ? warps[name](source, map, angleMap, options, intensity) : warps[name](source, map, options, intensity);
        return { value };
      }
    };
  }

  function correction(name, description, type = 'typedImage', output = sameImage) {
    return { description, inputs: { source: type, options: correctionOptions }, outputs: { value: output },
      run({ source, options }) { return { value: corrections[name](source, options) }; } };
  }

  const operations = Object.freeze({
    'image.declare': { description: 'Attach a verified image contract to a legacy raster using a literal descriptor.', specialize },
    'image.uniform': {
      description: 'Promote a scalar or a tuple to a typed constant image. UNORM inputs use normalized values, linear float color can be HDR.',
      specialize(node) {
        const { intent, layout } = literalShape(literalDescriptor(node), 'image.uniform');
        return { inputs: { value: layout === 'r' ? 'number' : layout.length === 3 ? 'vec3' : 'array<number>',
          width: 'pixelCount', height: 'pixelCount', descriptor: 'record' }, outputs: typedOutput(intent),
        run({ value, width, height, descriptor }) { return { value: uniform(value, width, height, descriptor) }; } };
      }
    },
    'image.convert': {
      description: 'Convert the channel layout, precision, color space or alpha convention of a typed image.',
      specialize(node) {
        const { intent } = literalShape(literalDescriptor(node), 'image.convert');
        return { inputs: { source: 'typedImage', descriptor: 'record', outOfRange: { type: 'string', default: 'error' },
          dropAlpha: { type: 'boolean', default: false } }, outputs: typedOutput(intent),
        run({ source, descriptor, ...options }) { return { value: convert(source, descriptor, options) }; } };
      }
    },
    'image.split': {
      description: 'Split explicitly selected native channels into named scalar images, including alpha coverage.',
      specialize({ params, inputs }) {
        const binding = inputs?.channels ?? params?.channels;
        const channels = own(binding ?? {}, 'value') ? binding.value : binding;
        const names = record(channels) ? Object.keys(channels) : [];
        if (!names.length || names.length > 4 || !Object.values(channels).every(key =>
          typeof key === 'string' && /^([rgbaxyz]|alpha)$/.test(key) || Number.isSafeInteger(key) && key >= 0 && key < 4))
          throw new TypeError('image.split needs literal channel selectors keyed by output name');
        return { inputs: { source: 'typedImage', channels: 'record' },
          outputs: Object.fromEntries(names.map(name => [name, 'typedImage'])),
          run({ source, channels }) { return splitChannels(source, channels); } };
      }
    },
    'image.shuffle': channelRouter('image.shuffle'),
    'image.pack': channelRouter('image.pack'),
    'image.channelMath': {
      description: 'Apply arithmetic to decoded typed channels and write float64 unless an output precision is chosen.',
      inputs: { a: 'typedImage', b: 'any', operation: 'string', options: { type: 'record', default: {} } },
      outputs: { value: { type: 'typedImage', typeFrom: 'a' } },
      run({ a, b, operation, options }) { return { value: channelMath(a, b, operation, options) }; }
    },
    'image.blend': {
      description: 'Blend typed images at native precision with a grayscale opacity mask, crop, alpha policy and explicit clamping.',
      inputs: { background: 'typedImage', foreground: 'typedImage', mask: { type: 'any', default: null },
        mode: { type: 'string', default: 'copy' }, opacity: { type: 'unitScalar', default: 1 },
        crop: { type: 'record', default: {} }, alpha: { type: 'string', default: 'source' },
        clamp: { type: 'string', default: 'auto' } },
      outputs: { value: { type: 'typedImage', typeFrom: 'background' } },
      run({ background, foreground, ...options }) { return { value: blendImage(background, foreground, options) }; }
    },
    'image.gaussianBlur': filter('gaussianBlur', 'Blur a typed material image with a separable Gaussian kernel.'),
    'image.directionalBlur': filter('directionalBlur', 'Average along a centered line with subpixel samples and a clockwise angle.'),
    'image.radialBlur': filter('radialBlur', 'Blur by rotating or zooming around an authored image center.'),
    'image.anisotropicBlur': filter('anisotropicBlur', 'Apply rotated Gaussian kernels with separate along and across radii.'),
    'image.variableBlur': {
      description: 'Scale the local Gaussian footprint per texel using an aligned scalar radius map.',
      inputs: { source: 'typedImage', radiusMap: 'typedImage', options: correctionOptions }, outputs: { value: sameImage },
      run({ source, radiusMap, options }) { return { value: filters.variableBlur(source, radiusMap, options) }; }
    },
    'image.highPass': filter('highPass', 'Extract signed detail by subtracting a Gaussian, optionally adding a display bias.'),
    'image.unsharpMask': filter('unsharpMask', 'Add back Gaussian detail with independent intensity and contrast threshold.'),
    'image.sharpen': filter('sharpen', 'Sharpen with a four-neighbor cross while retaining original coverage.'),
    'image.antialias': filter('antialias', 'Apply edge-adaptive subpixel reconstruction to diagonal raster edges.'),
    'image.distance': {
      description: 'Measure exact nearest-seed distance and return original seed coordinates and a validity mask.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: {
        value: 'heightImage', nearest: 'typedImage', valid: 'typedImage'
      },
      run({ source, options }) { return morphology.distance(source, options); }
    },
    'image.signedDistance': {
      description: 'Measure positive distance outside and negative distance inside a thresholded selection.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: 'heightImage' },
      run({ source, options }) { return { value: morphology.signedDistance(source, options) }; }
    },
    'image.propagate': {
      description: 'Copy original typed source samples through a nearest-seed coordinate image.',
      inputs: { source: 'typedImage', nearest: 'typedImage' }, outputs: { value: sameImage },
      run({ source, nearest }) { return { value: morphology.propagate(source, nearest) }; }
    },
    'image.dilate': {
      description: 'Grow a typed mask by an exact Euclidean radius with per-axis border handling.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, options }) { return { value: morphology.dilate(source, options) }; }
    },
    'image.erode': {
      description: 'Shrink a typed mask by an exact Euclidean radius with per-axis border handling.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, options }) { return { value: morphology.erode(source, options) }; }
    },
    'image.outline': {
      description: 'Return combined, inner and outer distance outlines with optional coverage feathering.',
      inputs: { source: 'typedImage', options: correctionOptions },
      outputs: { value: 'typedImage', inner: 'typedImage', outer: 'typedImage' },
      run({ source, options }) { return morphology.outline(source, options); }
    },
    'image.edgeDetect': {
      description: 'Measure Sobel or Scharr gradient magnitude and return a thresholded typed mask.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: 'typedImage', magnitude: 'typedImage' },
      run({ source, options }) { return morphology.edgeDetect(source, options); }
    },
    'image.curve': {
      description: 'Apply an editable channel curve with named stops, cubic handles and clamp or repeat addressing.',
      inputs: { source: 'typedImage', curve: 'record', options: correctionOptions }, outputs: { value: sameImage },
      run({ source, curve, options }) { return { value: corrections.curve(source, curve, options) }; }
    },
    'image.transferPreset': {
      description: 'Load a fresh editable curve or gradient ramp preset by stable name.',
      inputs: { name: 'string' }, outputs: { value: 'record', kind: 'string', label: 'string' },
      run({ name }) { return transfers.preset(name); }
    },
    'image.gradient': {
      description: 'Sample an authored gradient ramp into a typed RGBA image along a UV segment.',
      inputs: { ramp: 'record', width: 'pixelCount', height: 'pixelCount', options: correctionOptions }, outputs: { value: 'colorImage' },
      run({ ramp, width, height, options }) { return { value: transfers.gradient(ramp, width, height, options) }; }
    },
    'image.gradientMap': {
      description: 'Map a typed measurement channel through a gradient ramp while retaining image alignment and coverage.',
      inputs: { source: 'typedImage', ramp: 'record', options: correctionOptions }, outputs: { value: 'colorImage' },
      run({ source, ramp, options }) { return { value: transfers.gradientMap(source, ramp, options) }; }
    },
    'image.gradientFromImage': {
      description: 'Sample editable gradient pins along a UV path in an input color image.',
      inputs: { source: 'colorImage', options: correctionOptions }, outputs: { value: 'record' },
      run({ source, options }) { return { value: transfers.gradientFromImage(source, options) }; }
    },
    'image.levels': correction('levels', 'Map input black and white through gamma to an output range.'),
    'image.autoLevels': {
      description: 'Fit linked levels from exact percentiles of visible decoded samples and return the measured bounds.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: sameImage, report: 'record' },
      run({ source, options }) { return corrections.autoLevels(source, options); }
    },
    'image.histogram': correction('histogram', 'Count decoded samples with explicit bins, clipping counts and range.', 'typedImage', 'record'),
    'image.histogramAdjust': correction('histogramAdjust', 'Equalize, remap, shift, scan or select an interval of sample values.'),
    'image.hsl': correction('hsl', 'Rotate HSL hue and adjust saturation and lightness in display RGB.', 'colorImage', 'colorImage'),
    'image.hsv': correction('hsv', 'Rotate HSV hue and adjust saturation and value in display RGB.', 'colorImage', 'colorImage'),
    'image.exposure': correction('exposure', 'Apply exposure stops in linear light, retaining HDR in floating linear images.'),
    'image.contrast': correction('contrast', 'Scale the distance of decoded samples from an authored pivot.'),
    'image.threshold': correction('threshold', 'Create a typed coverage mask from a threshold with optional feathering.', 'typedImage', 'typedImage'),
    'image.invert': correction('invert', 'Invert decoded samples around a pivot while preserving alpha.'),
    'image.posterize': correction('posterize', 'Quantize decoded samples to tonal steps or an ordered RGB palette.'),
    'image.colorSelect': {
      description: 'Generate a typed mask for a swatch using RGB, OKLab or OKLab chroma distance.',
      inputs: { source: 'colorImage', color: 'any', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, color, options }) { return { value: corrections.colorSelect(source, color, options) }; }
    },
    'image.colorReplace': {
      description: 'Replace an authored color with a typed swatch while retaining coverage and precision.',
      inputs: { source: 'colorImage', from: 'any', to: 'any', options: correctionOptions }, outputs: { value: 'colorImage' },
      run({ source, from, to, options }) { return { value: corrections.colorReplace(source, from, to, options) }; }
    },
    'image.toHeight': {
      description: 'Map linear-light color or scalar samples to height using an explicit scale and units.',
      inputs: { source: 'typedImage', scale: 'number', offset: { type: 'number', default: 0 },
        units: { type: 'string', default: 'art-px' }, channel: { type: 'string', default: 'luminance' } },
      outputs: { value: 'heightImage' }, run({ source, ...options }) { return { value: toHeight(source, options) }; }
    },
    'image.resize': {
      description: 'Resample a typed image using its own per-axis tiling and sampling policy. The output keeps the source port type.',
      inputs: { source: 'typedImage', width: 'pixelCount', height: 'pixelCount' }, outputs: { value: { type: 'typedImage', typeFrom: 'source' } },
      run({ source, width, height }) { return { value: resize(source, width, height) }; }
    },
    'image.transform': remap('transform', 'Apply an affine matrix, scale, rotation and translation around an editable pivot.'),
    'image.crop': remap('crop', 'Extract a pixel or normalized source rectangle with an optional output extent.'),
    'image.symmetry': remap('symmetry', 'Reflect an authored side across horizontal, vertical or paired axes.'),
    'image.polar': remap('polar', 'Convert between Cartesian images and angular strips with aspect-correct radii.'),
    'image.perspective': remap('perspective', 'Project the source onto a convex four-corner destination plane.'),
    'image.directionalWarp': warp('directionalWarp', 'Displace a typed image along a fixed angle using a scalar map.'),
    'image.nonuniformWarp': warp('nonuniformWarp', 'Drive displacement strength and local direction with independent scalar maps.', true),
    'image.vectorWarp': warp('vectorWarp', 'Use a signed or centered RG displacement map with a selectable Y convention.'),
    'image.slopeWarp': warp('slopeWarp', 'Displace uphill or downhill along the gradient of a scalar height or data map.'),
    'image.multiDirectionalWarp': warp('multiDirectionalWarp', 'Chain or blend opposed displacements along one, two or four axes.'),
    'image.heightToNormal': normalFilter('heightToNormal', 'Differentiate typed height into a tangent normal using physical spacing.', 'heightImage'),
    'image.normalDecode': normalFilter('normalDecode', 'Declare raw RGB or RGBA normal samples and their coordinate conventions.', 'raster'),
    'image.normalNormalize': normalFilter('normalNormalize', 'Normalize normal vectors and fill zero vectors with an authored direction.'),
    'image.normalInvert': normalFilter('normalInvert', 'Reverse selected normal components in the declared coordinate space.'),
    'image.normalRotate': normalFilter('normalRotate', 'Rotate normal vectors around an authored three-dimensional axis.'),
    'image.normalOrientation': normalFilter('normalOrientation', 'Convert the Y convention of a tangent normal map between OpenGL and DirectX.'),
    'image.normalCombine': {
      description: 'Combine aligned normal maps with reoriented, whiteout or normalized interpolation and an optional mask.',
      inputs: { base: 'normalImage', detail: 'normalImage', mask: optional, options: correctionOptions }, outputs: normalOutput,
      run({ base, detail, mask, options }) { return { value: normals.normalCombine(base, detail, options, mask) }; }
    },
    'image.normalSpace': {
      description: 'Convert world and tangent normals through a uniform or per-texel tangent frame with handedness.',
      inputs: { source: 'normalImage', surface: optional, tangent: optional, handedness: optional, options: correctionOptions }, outputs: normalOutput,
      run({ source, surface, tangent, handedness, options }) {
        return { value: normals.normalSpace(source, options, surface, tangent, handedness) };
      }
    },
    'image.heightBlend': {
      description: 'Blend aligned physical heights and return the shared material transition mask.',
      inputs: { base: 'heightImage', layer: 'heightImage', mask: optional, options: correctionOptions },
      outputs: { value: 'heightImage', weight: 'typedImage' },
      run({ base, layer, mask, options }) { return normals.heightBlend(base, layer, options, mask); }
    },
    'image.floodRegions': {
      description: 'Label connected typed-image regions, with stable IDs and unwrapped charts at tile seams.',
      inputs: { source: 'typedImage', options: correctionOptions },
      outputs: { value: 'regionField', labels: 'typedImage', regions: 'array<record>' },
      run({ source, options }, context) {
        const value = regions.floodRegions(source, options, context.seed);
        return { value, labels: value.labels, regions: value.regions };
      }
    },
    'image.regionMap': {
      description: 'Bake position, geometry, random color, local UV or gradients from a flood region field.',
      inputs: { source: 'regionField', kind: 'string', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, kind, options }) { return { value: regions.regionMap(source, kind, options) }; }
    },
    'image.regionLookup': {
      description: 'Sample a typed texture by region-local UV, centroid, seed or unwrapped position.',
      inputs: { regions: 'regionField', source: 'typedImage', options: correctionOptions }, outputs: { value: sameImage },
      run({ regions: field, source, options }) { return { value: regions.regionLookup(field, source, options) }; }
    },
    'image.slopeBlur': {
      description: 'Follow a height gradient and accumulate a directional trail using average, minimum or maximum samples.',
      inputs: { source: 'typedImage', slope: 'heightImage', options: correctionOptions }, outputs: { value: sameImage },
      run({ source, slope, options }) { return { value: advancedTexture.slopeBlur(source, slope, options) }; }
    },
    'image.bevel': {
      description: 'Build a typed bevel height with editable distance profile and inner or outer reach.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: 'heightImage' },
      run({ source, options }) { return { value: advancedHeight.bevel(source, options) }; }
    },
    'image.emboss': {
      description: 'Shade height as a neutral-centered emboss mask using an editable light direction.',
      inputs: { source: 'heightImage', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, options }) { return { value: advancedHeight.emboss(source, options) }; }
    },
    'image.seamRepair': {
      description: 'Join opposite tile edges with a scoped, alpha-safe crossfade that preserves the interior.',
      inputs: { source: 'typedImage', options: correctionOptions }, outputs: { value: sameImage },
      run({ source, options }) { return { value: advancedTexture.seamRepair(source, options) }; }
    },
    'image.heightShadow': {
      description: 'Trace a directional heightfield horizon and return hard or softened cast-shadow coverage.',
      inputs: { source: 'heightImage', options: correctionOptions }, outputs: { value: 'typedImage' },
      run({ source, options }) { return { value: advancedHeight.heightShadow(source, options) }; }
    },
    'image.heightFrequency': {
      description: 'Separate relief into fine, middle and coarse bands and recombine them with independent gains.',
      inputs: { source: 'heightImage', options: correctionOptions },
      outputs: { value: 'heightImage', fine: 'heightImage', mid: 'heightImage', coarse: 'heightImage' },
      run({ source, options }) { return advancedHeight.heightFrequency(source, options); }
    },
    'image.scanCleanup': {
      description: 'Remove locally unsupported scan specks and optionally divide out a measured illumination map.',
      inputs: { source: 'typedImage', mask: optional, illumination: optional, options: correctionOptions },
      outputs: { value: sameImage, repaired: 'typedImage' },
      run({ source, mask, illumination, options }) { return advancedTexture.scanCleanup(source, options, mask, illumination); }
    },
    'image.edgeWear': {
      description: 'Select convex or concave height features and optionally cut the selected surface.',
      inputs: { source: 'heightImage', mask: optional, options: correctionOptions },
      outputs: { value: 'typedImage', height: 'heightImage' },
      run({ source, mask, options }) { return advancedHeight.edgeWear(source, options, mask); }
    },
    'image.noise': {
      description: 'Bake a named scalar noise family into a typed image with spatial controls and optional looping motion.',
      seed: 'options', inputs: { family: { type:'string', default:'perlin' }, width: { type:'pixelCount', default:128 },
        height: { type:'pixelCount', default:128 }, options: correctionOptions, time:{type:'seconds',default:0} },
      outputs: { value: 'typedImage', info: 'record' },
      run({ family, width, height, options,time }, context) { return makeNoise(family,width,height,options,context.seed,time); }
    },
    'image.toDisplay': {
      description: 'Convert typed color to straight-alpha sRGB8 for legacy compositing and PNG exports.',
      inputs: { source: 'typedImage', outOfRange: { type: 'string', default: 'clamp' } },
      outputs: { value: 'displayRaster' }, run({ source, outOfRange }) { return { value: toDisplay(source, outOfRange) }; }
    },
    'image.toRaster': {
      description: 'Explicitly hand the raw samples of a typed image to a legacy raster operation.',
      inputs: { source: 'typedImage' }, outputs: { value: 'raster' },
      run({ source }) { return { value: toRaster(source) }; }
    },
    'image.inspect': {
      description: 'Report image extent and the full sampling and sample encoding contract.',
      inputs: { source: 'typedImage' }, outputs: { value: 'record' },
      run({ source }) { return { value: inspect(source) }; }
    }
  });
  P.graphImages = Object.freeze({ format, version, valid, declare, uniform, convert, split: splitChannels, shuffle: shuffleChannels, pack: packChannels, channelMath, blend: blendImage, corrections, transfers, filters, morphology, spatial, warps, normals, regions, advancedHeight, advancedTexture, noise:makeNoise, toHeight, resize, toDisplay, displaySamples, toRaster, inspect, operations });
})(KIT.procedural);
