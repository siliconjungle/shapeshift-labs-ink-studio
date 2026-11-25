/* Exact distance and mask operations over typed material-image pixel centers. */
const TypedImageMorphology = ({ requireImage, descriptor, wrap, storage, alphaAt, integerMax,
  convertColor, luminance, fields, geometry }) => {
  const finite = Number.isFinite, maxCells = 6000000;
  const modes = ['clamp', 'wrap', 'mirror', 'transparent'];
  const saturated = value => Math.min(1, Math.max(0, value));

  function borders(spec, border = {}) {
    if (typeof border !== 'string' && !fields(border, ['u', 'v']))
      throw new TypeError('Material morphology border needs a mode or u and v modes');
    const { u = spec.tiling.u, v = spec.tiling.v } = typeof border === 'string' ? { u: border, v: border } : border;
    if (!modes.includes(u) || !modes.includes(v)) throw new RangeError('Unknown material morphology border');
    return [u, v];
  }

  function measure(source, { channel } = {}) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { width, height, channels, data } = grid;
    if (width * height > maxCells) throw new RangeError('Material morphology exceeds its grid budget');
    const color = spec.intent === 'color';
    const name = channel ?? (color ? spec.alpha === 'none' ? 'luminance' : 'alpha' : 'value');
    if (color ? !['luminance', 'r', 'g', 'b', 'alpha'].includes(name) :
      channels !== 1 || spec.intent === 'normal' || name !== 'value')
      throw new TypeError('Material morphology needs a color channel or a single-plane numeric image');
    const divisor = integerMax(spec.precision) || 1;
    const component = ['r', 'g', 'b'].indexOf(name), rgb = [0, 0, 0];
    const decode = color && name !== 'alpha' && convertColor(spec, name === 'luminance' ? 'srgb-linear' : spec.colorSpace);
    function sample(p) {
      if (!color) return data[p] / divisor;
      const i = p * channels;
      if (name === 'alpha') return alphaAt(data, i, spec);
      if (!alphaAt(data, i, spec)) return 0;
      decode(data, i, rgb);
      return component < 0 ? luminance(rgb) : rgb[component];
    }
    return { grid, spec, width, height, sample, units: color ? 'unitless' : spec.units };
  }

  function plane(image, data, settings) {
    const { width, height, grid: { pivot }, spec: previous } = image;
    const layout = settings.layout ?? 'r', grid = { width, height, channels: layout.length, pivot, data };
    const spec = descriptor(grid, { ...previous, ...settings, layout, alpha: 'none', colorSpace: 'none', domain: undefined });
    return wrap(grid, spec);
  }

  function maskPlane(image, coverage, precision = 'float64') {
    if (!Object.hasOwn(storage, precision)) throw new TypeError('Unknown material morphology precision');
    const data = new storage[precision](coverage.length);
    const scale = integerMax(precision) || 1;
    for (let i = 0; i < data.length; i++) data[i] = scale === 1 ? coverage[i] : Math.round(coverage[i] * scale);
    return plane(image, data, { intent: 'mask', units: 'unitless', precision });
  }

  function features(source, options, signed, owners = false) {
    const image = measure(source, options), { width, height, spec, sample } = image;
    const { units = 'pixels', threshold = .5, invert = false } = options;
    if (!['pixels', 'normalized'].includes(units) || !finite(threshold) || typeof invert !== 'boolean')
      throw new RangeError('Distance needs pixels or normalized units, a finite threshold and a boolean invert flag');
    const border = borders(spec, options.border);
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < binary.length; i++) {
      const value = sample(i);
      if (!finite(value)) throw new RangeError('Material morphology needs finite decoded samples');
      binary[i] = Number((value >= threshold) !== invert);
    }
    const transform = geometry.distanceTransform(binary, {
      size: [width, height], signed, indices: owners, wrap: border.map(mode => mode === 'wrap'), maxCells
    });
    // Virtual outside pixels can be nearer to an occupied center than any vacant texel in the lattice.
    if (signed && border.includes('transparent')) {
      const [horizontal, vertical] = border;
      for (let i = 0; i < binary.length; i++) {
        if (!binary[i]) continue;
        const x = i % width, y = Math.floor(i / width);
        const u = horizontal === 'transparent' ? Math.min(x + 1, width - x) : Infinity;
        const v = vertical === 'transparent' ? Math.min(y + 1, height - y) : Infinity;
        transform.distance[i] = -Math.min(-transform.distance[i], u, v);
      }
    }
    return { ...image, binary, transform, scale: units === 'pixels' ? 1 : Math.min(width, height),
      distanceUnits: units === 'pixels' ? 'art-px' : 'normalized' };
  }

  function distancePlane(feature, { maxDistance = Math.hypot(feature.width, feature.height) / feature.scale,
    precision = 'float64' } = {}) {
    if (!finite(maxDistance) || maxDistance < 0 || !['float32', 'float64'].includes(precision) ||
        precision === 'float32' && !finite(Math.fround(maxDistance)))
      throw new RangeError('Distance needs a finite nonnegative cap and float32 or float64 precision');
    const data = storage[precision].from(feature.transform.distance, n =>
      Math.max(-maxDistance, Math.min(maxDistance, n / feature.scale)));
    return plane(feature, data, { intent: 'height', units: feature.distanceUnits, precision });
  }

  function distance(source, options = {}) {
    const feature = features(source, options, false, true), { width, transform: { nearest } } = feature;
    const coords = new Float32Array(nearest.length * 2), valid = new Uint8Array(nearest.length);
    for (let i = 0; i < nearest.length; i++) {
      const site = nearest[i];
      coords[i * 2] = site < 0 ? -1 : site % width;
      coords[i * 2 + 1] = site < 0 ? -1 : Math.floor(site / width);
      valid[i] = Number(site >= 0);
    }
    return {
      value: distancePlane(feature, options),
      nearest: plane(feature, coords, { intent: 'data', units: 'art-px', precision: 'float32', layout: 'rg' }),
      valid: maskPlane(feature, valid, 'unorm8')
    };
  }

  function signedDistance(source, options = {}) {
    return distancePlane(features(source, options, true), options);
  }

  function propagate(source, nearest) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { raster: owners, descriptor: indices } = requireImage(nearest, 'data');
    const { width, height, channels, pivot, data } = grid;
    const samePair = (a, b) => a === b || a && b && a[0] === b[0] && a[1] === b[1];
    if (width * height > maxCells || width !== owners.width || height !== owners.height || indices.layout !== 'rg' ||
        indices.units !== 'art-px' || !samePair(pivot, owners.pivot) || !samePair(spec.pixelPitchMm, indices.pixelPitchMm))
      throw new TypeError('Material propagation needs an aligned nearest-seed coordinate image');
    const output = new storage[spec.precision](data.length);
    for (let p = 0; p < width * height; p++) {
      const x = owners.data[p * 2], y = owners.data[p * 2 + 1];
      if (!(x === -1 && y === -1) &&
          (!Number.isSafeInteger(x) || x < 0 || x >= width || !Number.isSafeInteger(y) || y < 0 || y >= height))
        throw new RangeError('Invalid nearest-seed coordinate at index ' + p);
      const from = (x < 0 ? p : y * width + x) * channels;
      for (let c = 0; c < channels; c++) output[p * channels + c] = data[from + c];
    }
    return wrap({ ...grid, data: output }, spec);
  }

  function morphology(source, options, erode) {
    const { radius = 1, precision = 'float64' } = options;
    if (!finite(radius) || radius < 0) throw new RangeError('Material morphology needs a finite nonnegative radius');
    const feature = features(source, options, erode);
    const coverage = Uint8Array.from(feature.transform.distance, value =>
      erode ? Number(value / feature.scale < -radius) : Number(value / feature.scale <= radius));
    return maskPlane(feature, coverage, precision);
  }

  function outline(source, options = {}) {
    const { inner = 0, outer = 1, feather = 0, precision = 'float64' } = options;
    if (![inner, outer, feather].every(value => finite(value) && value >= 0))
      throw new RangeError('Material outline widths and feather must be finite and nonnegative');
    const feature = features(source, options, true), { transform, binary, scale } = feature;
    const sides = [new Float64Array(binary.length), new Float64Array(binary.length)];
    for (let i = 0; i < binary.length; i++) {
      const inside = binary[i], width = inside ? inner : outer;
      const distance = Math.abs(transform.distance[i]) / scale;
      if (!width || !finite(distance)) continue;
      const t = feather ? saturated(.5 + (distance - width) / feather) : Number(distance > width);
      sides[inside][i] = 1 - t * t * (3 - 2 * t);
    }
    return {
      value: maskPlane(feature, Float64Array.from(sides[0], (value, i) => value + sides[1][i]), precision),
      outer: maskPlane(feature, sides[0], precision), inner: maskPlane(feature, sides[1], precision)
    };
  }

  function edgeDetect(source, options = {}) {
    const image = measure(source, options), { width, height, sample } = image;
    const { method = 'sobel', threshold = .08, softness = 0, precision = 'float64' } = options;
    if (!['sobel', 'scharr'].includes(method) ||
        ![threshold, softness].every(value => finite(value) && value >= 0))
      throw new RangeError('Edge detection needs sobel or scharr and nonnegative threshold and softness');
    const [ax, ay] = borders(image.spec, options.border).map(TextureAddress.axis);
    function read(x, y) {
      const u = ax(x, width), v = ay(y, height);
      return u < 0 || v < 0 ? 0 : samples[v * width + u];
    }
    const samples = new Float64Array(width * height);
    const magnitude = new Float64Array(samples.length), coverage = new Float64Array(samples.length);
    const gradient = [0, 0], slope = RasterDerivatives(method, read);
    for (let p = 0; p < samples.length; p++) samples[p] = sample(p);
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      slope(x, y, gradient);
      const length = Math.hypot(gradient[0], gradient[1]);
      if (!finite(length)) throw new RangeError('Edge derivative exceeds the finite sample range');
      magnitude[i] = length;
      const t = softness ? saturated((length - threshold) / softness) : Number(length >= threshold);
      coverage[i] = t * t * (3 - 2 * t);
    }
    return { value: maskPlane(image, coverage, precision),
      magnitude: plane(image, magnitude, { intent: 'data', units: image.units, precision: 'float64' }) };
  }

  return Object.freeze({ distance, signedDistance, propagate,
    dilate: (source, options = {}) => morphology(source, options, false),
    erode: (source, options = {}) => morphology(source, options, true), outline, edgeDetect });
};
