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
    if (!fields(settings, specKeys)) throw new TypeError('Invalid graph image descriptor');
    const { intent, layout = defaultLayout(intent, count(source)), precision = precisionOf(source.data) ?? 'float64',
      units = intent === 'height' ? undefined : 'unitless',
      colorSpace = intent === 'color' ? source.colorSpace ?? 'srgb' : 'none',
      alpha = intent === 'color' && layout === 'rgba' || intent === 'normal' && layout === 'xyza' ? 'straight' : 'none',
      sampling = 'nearest', tiling = {} } = settings;
    if (!intents.includes(intent) || typeof layout !== 'string' || layout.length !== count(source) ||
        !['r', 'rg', 'rgb', 'rgba', 'xyz', 'xyza'].includes(layout) || !own(storage, precision) || !unit(units) ||
        !['none', 'straight', 'premultiplied'].includes(alpha) || alpha !== 'none' && !layout.endsWith('a') ||
        !['nearest', 'linear'].includes(sampling) || !fields(tiling, ['u', 'v']))
      throw new TypeError('Invalid graph image intent, layout, precision, units, alpha or sampling');
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
      tiling: Object.freeze({ u, v }), sampling });
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
        !record(value.descriptor) || Object.keys(value.descriptor).length !== specKeys.length ||
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
      for (let c = 0; c < 3; c++) rgb[c] = data[i + c] * gain;
      convert(rgb, out);
      return a;
    };
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
        .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] : data[i] / divisor;
      out[p] = value * scale + offset;
      if (!finite(out[p])) throw new RangeError('Height conversion produced a nonfinite sample');
    }
    return declare({ width, height, channels: 1, data: out, pivot },
      { intent: 'height', units, tiling: spec.tiling, sampling: spec.sampling });
  }

  function toDisplay(source, outOfRange = 'clamp') {
    const { raster: grid, descriptor: spec } = requireImage(source, 'color');
    if (!['clamp', 'error'].includes(outOfRange)) throw new TypeError('Display output needs clamp or error range handling');
    const { data, channels } = grid, out = new Uint8Array(data.length), rgb = [0, 0, 0];
    const convert = convertColor(spec, { space: 'srgb', range: [0, 255], outOfRange });
    for (let i = 0; i < data.length; i += channels) {
      const opacity = convert(data, i, rgb);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgb[c]);
      if (channels === 4) out[i + 3] = Math.round(opacity * 255);
    }
    return { ...grid, data: out, colorSpace: 'srgb' };
  }

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

  function specialize({ params, inputs }) {
    const binding = inputs?.descriptor ?? params?.descriptor;
    const settings = own(binding ?? {}, 'value') ? binding.value : binding;
    if (!record(settings) || !intents.includes(settings.intent))
      throw new TypeError('image.declare needs a literal descriptor with an image intent');
    const { intent } = settings;
    return {
      inputs: { source: intent === 'height' ? 'scalarRaster' : 'raster', descriptor: 'record' },
      outputs: { value: intent === 'color' ? 'colorImage' : intent === 'height' ? 'heightImage' : 'typedImage' },
      run({ source, descriptor }) { return { value: declare(source, descriptor) }; }
    };
  }

  const operations = Object.freeze({
    'image.declare': { description: 'Attach a verified image contract to a legacy raster using a literal descriptor.', specialize },
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
  P.graphImages = Object.freeze({ format, version, valid, declare, toHeight, resize, toDisplay, toRaster, inspect, operations });
})(KIT.procedural);
