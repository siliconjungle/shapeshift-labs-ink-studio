/* Serializable material transfer presets, ramp sampling and image-derived pins. */
const TypedImageTransfers = ({
  requireImage, descriptor, wrap, storage, pack, alphaAt, integerMax, convertColor, luminance, sampler, dimensions, fields
}) => {
  const finite = Number.isFinite;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const point = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(unit);
  const spaces = ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'];
  const presets = {
    'linear': { kind: 'curve', label: 'Linear', value: { stops: [
      { id: 'black', at: 0, value: 0 }, { id: 'white', at: 1, value: 1 }
    ] } },
    'soft-contrast': { kind: 'curve', label: 'Soft contrast', value: { interpolation: 'bezier', stops: [
      { id: 'black', at: 0, value: .04, out: [.16, .04] },
      { id: 'middle', at: .48, value: .43, in: [.34, .27], out: [.64, .62] },
      { id: 'white', at: 1, value: .97, in: [.83, .95] }
    ] } },
    'lifted-ink': { kind: 'curve', label: 'Lifted ink', value: { interpolation: 'smooth', stops: [
      { id: 'black', at: 0, value: .14 }, { id: 'middle', at: .38, value: .51 }, { id: 'white', at: 1, value: .91 }
    ] } },
    'copper-tide': { kind: 'ramp', label: 'Copper Tide', value: { interpolation: 'linear', stops: [
      { id: 'shadow', at: 0, value: '#1b2037' }, { id: 'water', at: .32, value: '#3b8187' },
      { id: 'copper', at: .67, value: '#dd8d53' }, { id: 'light', at: 1, value: '#fff0bc' }
    ] } },
    'silver-mist': { kind: 'ramp', label: 'Silver Mist', value: { interpolation: 'smooth', stops: [
      { id: 'shadow', at: 0, value: '#202330' }, { id: 'fog', at: .58, value: '#809baa' },
      { id: 'light', at: 1, value: '#eff5e8' }
    ] } },
    'night-signal': { kind: 'ramp', label: 'Night Signal', value: { interpolation: 'step', stops: [
      { id: 'shadow', at: 0, value: '#201a34' }, { id: 'signal', at: .4, value: '#964966' },
      { id: 'ember', at: .72, value: '#fb9c62' }, { id: 'light', at: 1, value: '#ffe4aa' }
    ] } }
  };

  function preset(name) {
    if (!Object.hasOwn(presets, name)) throw new RangeError('Unknown material transfer preset ' + name);
    return structuredClone(presets[name]);
  }

  function ramp(definition) {
    if (!fields(definition, ['stops', 'interpolation', 'address', 'colorSpace', 'interpolationSpace']))
      throw new TypeError('Invalid material gradient ramp');
    const { colorSpace = 'srgb', interpolationSpace = 'native', ...stops } = definition;
    if (!spaces.includes(colorSpace) || !['native', 'linear'].includes(interpolationSpace))
      throw new RangeError('Material gradient needs a supported color space and native or linear interpolation');
    const display = !colorSpace.endsWith('-linear');
    const linear = display ? colorSpace + '-linear' : colorSpace;
    const tagged = display ? { space: colorSpace, outOfRange: 'clamp' } : colorSpace;
    const working = interpolationSpace === 'linear' ? linear : colorSpace;
    const toWorking = ColorSpace.prepare(colorSpace, working), toTag = ColorSpace.prepare(working, tagged);
    const sample = ColorCurves.rgba(stops, value => {
      const numeric = Array.isArray(value) && [3, 4].includes(value.length) && Array.from(value).every(finite);
      const rgb = numeric ? value.slice(0, 3) : ColorSpace.convert(ColorCurves.color(value), 'srgb', tagged);
      if (display && !rgb.every(unit))
        throw new RangeError('Display-encoded ramp pin RGB must be in [0, 1]');
      return [...toWorking(rgb), numeric ? value[3] ?? 1 : 1];
    });
    const rgb = [0, 0, 0];
    return { colorSpace, sample(value, out = [0, 0, 0, 0]) {
      sample(value, out);
      toTag(out, rgb);
      for (let c = 0; c < 3; c++) out[c] = rgb[c];
      return out;
    } };
  }

  function rasterize(width, height, pivot, metadata, definition, options, coordinate) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !dimensions({ width, height }))
      throw new RangeError('Material gradient extent exceeds the raster budget');
    const { precision = 'float64', outOfRange = 'error' } = options;
    if (!['error', 'clamp'].includes(outOfRange)) throw new RangeError('Invalid material gradient range policy');
    const { colorSpace, sample } = ramp(definition);
    const { sampling, tiling, pixelPitchMm, materialSeed } = metadata;
    const grid = { width, height, channels: 4, pivot };
    const spec = descriptor(grid, { intent: 'color', colorSpace, precision, sampling, tiling, pixelPitchMm, materialSeed });
    const output = new storage[precision](width * height * 4);
    const color = [0, 0, 0, 0], input = [0, 1];
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      coordinate(x, y, p, input);
      sample(input[0], color);
      for (let c = 0; c < 3; c++) output[p * 4 + c] = pack(color[c], spec, false, outOfRange);
      output[p * 4 + 3] = pack(color[3] * input[1], spec, true, 'clamp');
    }
    return wrap({ ...grid, data: output }, spec);
  }

  function gradient(definition, width, height, options = {}) {
    const { from = [0, .5], to = [1, .5] } = options;
    if (!point(from) || !point(to)) throw new TypeError('Gradient endpoints need normalized UV coordinates');
    const dx = (to[0] - from[0]) * width, dy = (to[1] - from[1]) * height;
    const length = dx * dx + dy * dy;
    if (!length) throw new RangeError('Gradient endpoints must be distinct');
    return rasterize(width, height, undefined, {}, definition, options, (x, y, _p, out) => {
      out[0] = ((x + .5 - from[0] * width) * dx + (y + .5 - from[1] * height) * dy) / length;
    });
  }

  function gradientMap(source, definition, options = {}) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const color = spec.intent === 'color';
    const { channel = color ? 'luminance' : 'value', range = [0, 1] } = options;
    const channels = color ? ['luminance', 'r', 'g', 'b', 'alpha'] : ['value'];
    if (!channels.includes(channel) || !color && (grid.channels !== 1 || !['data', 'mask', 'height'].includes(spec.intent)) ||
        !Array.isArray(range) || range.length !== 2 || !Array.from(range).every(finite) ||
        range[1] <= range[0] || !finite(range[1] - range[0]))
      throw new TypeError('Gradient mapping needs a compatible typed channel and increasing finite range');
    const read = color && convertColor(spec, channel === 'luminance' ? 'srgb-linear' : spec.colorSpace);
    const { width, height, pivot, data } = grid, scale = integerMax(spec.precision) || 1;
    const rgb = [0, 0, 0], component = ['r', 'g', 'b'].indexOf(channel);
    return rasterize(width, height, pivot, spec, definition, options, (_x, _y, p, out) => {
      const i = p * grid.channels;
      const alpha = channel === 'alpha' ? alphaAt(data, i, spec) : read ? read(data, i, rgb) : 1;
      const value = !color ? data[i] / scale : channel === 'alpha' ? alpha :
        channel === 'luminance' ? luminance(rgb) : rgb[component];
      out[0] = (value - range[0]) / (range[1] - range[0]);
      out[1] = alpha;
    });
  }

  function gradientFromImage(source, options = {}) {
    const { raster: grid, descriptor: spec } = requireImage(source, 'color');
    const { path = [[0, .5], [1, .5]], count = 9, filter = spec.sampling,
      interpolation = 'linear', address = 'clamp', interpolationSpace = 'native' } = options;
    if (!Array.isArray(path) || path.length < 2 || path.length > 32 || !Array.from(path).every(point) ||
        !Number.isSafeInteger(count) || count < 2 || count > 256 || !['nearest', 'linear'].includes(filter))
      throw new RangeError('Image gradient needs 2–32 UV path points, 2–256 samples and a filter');
    const { width, height } = grid;
    let length = 0;
    const distances = [0];
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i];
      const step = Math.hypot((x1 - x0) * width, (y1 - y0) * height);
      if (!step || length + step === length) throw new RangeError('Adjacent gradient path points must be distinct');
      length += step;
      distances.push(length);
    }
    const read = sampler(grid, { ...spec, sampling: filter, tiling: { u: 'clamp', v: 'clamp' } });
    const scale = integerMax(spec.precision) || 1;
    const rgba = [0, 0, 0, 0], stops = [];
    let segment = 1;
    for (let i = 0; i < count; i++) {
      const at = i / (count - 1), distance = at * length;
      while (segment < distances.length - 1 && distance > distances[segment]) segment++;
      const share = (distance - distances[segment - 1]) / (distances[segment] - distances[segment - 1]);
      const [x0, y0] = path[segment - 1], [x1, y1] = path[segment];
      read(x0 + (x1 - x0) * share, y0 + (y1 - y0) * share, rgba);
      const alpha = spec.alpha === 'none' ? 1 : Math.min(1, Math.max(0, rgba[3] / scale));
      const association = spec.alpha === 'premultiplied' ? alpha : 1;
      const value = [0, 1, 2].map(c => {
        const sample = association ? rgba[c] / scale / association : 0;
        return spec.domain === 'unit' ? Math.min(1, Math.max(0, sample)) : sample;
      });
      stops.push({ id: 'sample-' + String(i + 1).padStart(3, '0'), at, value: [...value, alpha] });
    }
    const definition = { stops, interpolation, address, interpolationSpace, colorSpace: spec.colorSpace };
    ramp(definition);
    return definition;
  }

  return Object.freeze({ preset, ramp, gradient, gradientMap, gradientFromImage });
};
