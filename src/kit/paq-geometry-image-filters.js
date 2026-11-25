/* Height and normal processing in typed image space. */
const RasterHeightWeight = (difference, softness) => {
  const t = softness ? Math.max(0, Math.min(1, .5 + .5 * difference / softness)) : +(difference >= 0);
  return t * t * (3 - 2 * t);
};

const TypedImageNormals = ({ requireImage, declare, descriptor, wrap, pack, storage, integerMax, precisionOf, raster,
  fields, alignedGrid, borders, V, M }) => {
  const flat = [0, 0, 1], tangentX = [1, 0, 0], origin = ['tangent', 'world'], conventions = ['opengl', 'directx'];
  const finite = Number.isFinite;
  const bounded = n => finite(n) && Math.abs(n) <= 1e6;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const tuple = (value, length, test = finite) =>
    Array.isArray(value) && value.length === length && Array.from(value).every(test);
  const normalize = (v, fallback = flat) => V.norm(v, fallback);
  const spaceOf = spec => spec.normalSpace ?? 'tangent';
  const orientationOf = spec => spec.normalOrientation ?? 'opengl';
  const sign = spec => spec.normalOrientation === 'directx' ? -1 : 1;
  const linear = (a, b, t) => a * (1 - t) + b * t;

  function settings(options, keys) {
    if (!fields(options, keys)) throw new TypeError('Unexpected height or normal filter option');
  }

  function reader(image) {
    const { raster: { channels, data }, descriptor: spec } = image;
    const integer = integerMax(spec.precision), divisor = integer || 1;
    return (p, vector) => {
      const i = p * channels;
      const fourth = channels === 4 ? data[i + 3] / divisor : 1;
      const coverage = spec.alpha === 'none' ? 1 : fourth;
      const associated = spec.alpha === 'premultiplied';
      for (let c = 0; c < 3; c++) {
        const raw = data[i + c] / divisor;
        const value = associated && coverage ? raw / coverage : raw;
        vector[c] = associated && !coverage ? flat[c] : (integer ? 2 * value - 1 : value);
        if (!finite(vector[c])) throw new RangeError('Normal unassociation exceeds its numeric range');
      }
      vector[1] *= sign(spec);
      return fourth;
    };
  }

  function encode(target, data, p, vector, fourth, policy = 'clamp') {
    const stride = target.layout.length, i = p * stride;
    const integer = integerMax(target.precision);
    if (stride === 4) data[i + 3] = pack(fourth, target, target.alpha !== 'none', policy);
    if (target.alpha === 'premultiplied' && !data[i + 3]) return;
    const gain = target.alpha === 'premultiplied' ? fourth : 1;
    for (let c = 0; c < 3; c++) {
      const n = vector[c] * (c === 1 ? sign(target) : 1);
      if (policy === 'error' && Math.abs(n) > 1) throw new RangeError('Normal component exceeds its signed unit range');
      const value = Math.max(-1, Math.min(1, n));
      data[i + c] = pack(gain * (integer ? (value + 1) / 2 : value), target, false, policy);
    }
  }

  function apply(image, overrides, operation, policy) {
    const { raster: grid, descriptor: spec } = image;
    const target = descriptor(grid, { ...spec, ...overrides, domain: undefined });
    const { width, height, channels } = grid, count = width * height;
    const data = new storage[target.precision](count * channels), src = [0, 0, 0], read = reader(image);
    for (let p = 0; p < count; p++) {
      const fourth = read(p, src);
      const vector = operation(src, p, spec.alpha === 'none' ? 1 : fourth);
      encode(target, data, p, vector, fourth, policy);
    }
    return wrap({ ...grid, data }, target);
  }

  function reencode(image, precision, policy) {
    return apply(image, { precision }, v => v, policy);
  }

  function normalDecode(source, options = {}) {
    settings(options, ['normalSpace', 'orientation', 'precision', 'tiling', 'sampling', 'pixelPitchMm', 'alpha']);
    if (!raster(source)) throw new TypeError('Normal map import needs an RGB or RGBA raster');
    const { colorSpace: _colorTag, ...grid } = source;
    const { normalSpace = 'tangent', orientation, precision = precisionOf(grid.data) ?? 'unorm8',
      tiling, sampling, pixelPitchMm, alpha } = options;
    return declare(grid, { intent: 'normal', normalSpace,
      normalOrientation: orientation ?? (normalSpace === 'tangent' ? 'opengl' : undefined),
      precision, tiling, sampling, pixelPitchMm, alpha });
  }

  function heightToNormal(source, options = {}) {
    settings(options, ['strength', 'spacing', 'method', 'border', 'orientation', 'precision']);
    const { raster: grid, descriptor: spec } = requireImage(source, 'height');
    const { width, height, data, pivot } = grid;
    const { strength = 1, spacing = (spec.units === 'mm' ? spec.pixelPitchMm : undefined) ?? [1, 1],
      method = 'sobel', border = {}, orientation = 'opengl', precision = 'float32' } = options;
    if (!bounded(strength) || !tuple(spacing, 2, n => finite(n) && n > 0) ||
        !['central', 'sobel', 'scharr'].includes(method) || !conventions.includes(orientation))
      throw new RangeError('Height to normal needs finite strength, positive spacing, derivative method and tangent orientation');
    const tiling = borders(border, spec.tiling), ax = TextureAddress.axis(tiling.u), ay = TextureAddress.axis(tiling.v);
    const target = descriptor({ ...grid, channels: 3 }, { intent: 'normal', precision, normalSpace: 'tangent',
      normalOrientation: orientation, tiling, sampling: spec.sampling, pixelPitchMm: spec.pixelPitchMm, materialSeed: spec.materialSeed });
    const out = new storage[precision](width * height * 3), gradient = [0, 0], normal = [0, 0, 1];
    const slope = RasterDerivatives(method, (x, y) => {
      const u = ax(x, width), v = ay(y, height);
      return u < 0 || v < 0 ? 0 : data[v * width + u];
    });
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      if (strength) {
        slope(x, y, gradient);
        const nx = -gradient[0] / spacing[0] * strength, ny = gradient[1] / spacing[1] * strength;
        if (!finite(nx) || !finite(ny)) throw new RangeError('Height slope exceeds its normal range');
        const m = Math.max(1, Math.abs(nx), Math.abs(ny));
        const length = Math.hypot(nx / m, ny / m, 1 / m);
        normal[0] = nx / m / length;
        normal[1] = ny / m / length;
        normal[2] = 1 / m / length;
      }
      encode(target, out, p, normal, 1);
    }
    return wrap({ width, height, channels: 3, data: out, pivot }, target);
  }

  function normalNormalize(source, options = {}) {
    settings(options, ['fallback', 'precision']);
    const image = requireImage(source, 'normal');
    const { fallback = flat, precision = image.descriptor.precision } = options;
    if (!tuple(fallback, 3, bounded) || V.len(fallback) <= 1e-9) throw new RangeError('Normal fallback needs a nonzero XYZ vector');
    const direction = normalize(fallback);
    return apply(image, { precision }, v => normalize(v, direction));
  }

  function normalInvert(source, options = {}) {
    settings(options, ['axes', 'precision']);
    const image = requireImage(source, 'normal');
    const { axes = 'xy', precision = image.descriptor.precision } = options;
    if (typeof axes !== 'string' || !/^[xyz]{1,3}$/.test(axes) || new Set(axes).size !== axes.length)
      throw new RangeError('Normal inversion needs distinct x, y or z axes');
    const flips = Array.from('xyz', axis => axes.includes(axis) ? -1 : 1);
    return apply(image, { precision }, v => [v[0] * flips[0], v[1] * flips[1], v[2] * flips[2]]);
  }

  function normalRotate(source, options = {}) {
    settings(options, ['axis', 'degrees', 'precision']);
    const image = requireImage(source, 'normal');
    const { axis = flat, degrees = 0, precision = image.descriptor.precision } = options;
    if (!tuple(axis, 3, bounded) || V.len(axis) <= 1e-9 || !bounded(degrees))
      throw new RangeError('Normal rotation needs a nonzero XYZ axis and finite degrees');
    const rotation = M.rot(normalize(axis), degrees % 360 * Math.PI / 180);
    return apply(image, { precision }, v => M.app(rotation, normalize(v)));
  }

  function normalOrientation(source, options = {}) {
    settings(options, ['orientation', 'precision']);
    const image = requireImage(source, 'normal'), spec = image.descriptor;
    const { orientation = 'opengl', precision = spec.precision } = options;
    if (spaceOf(spec) !== 'tangent' || !conventions.includes(orientation))
      throw new RangeError('Normal orientation is OpenGL or DirectX and applies to tangent images');
    return apply(image, { precision, normalSpace: 'tangent', normalOrientation: orientation }, v => v);
  }

  function weights(primary, input) {
    if (input === null) return () => 1;
    const image = requireImage(input), { raster: { channels, data }, descriptor: spec } = image;
    if (!alignedGrid(primary, image, true) || channels !== 1 || !['data', 'mask'].includes(spec.intent) ||
        spec.units !== 'unitless' || spec.alpha !== 'none')
      throw new TypeError('Height and normal masks need aligned unitless scalar images');
    const divisor = integerMax(spec.precision) || 1;
    return p => {
      const value = data[p] / divisor;
      if (!unit(value)) throw new RangeError('Height and normal mask samples must be in [0, 1]');
      return value;
    };
  }

  function reorient(base, detail) {
    const [x, y, z] = base;
    if (1 + z <= 1e-10) return [detail[0], -detail[1], -detail[2]];
    const t = [x, y, 1 + z], u = [-detail[0], -detail[1], detail[2]], gain = V.dot(t, u) / t[2];
    return V.sub(V.mul(t, gain), u);
  }

  function normalCombine(baseSource, detailSource, options = {}, mask = null) {
    settings(options, ['method', 'amount', 'precision']);
    const base = requireImage(baseSource, 'normal'), detail = requireImage(detailSource, 'normal');
    const spec = base.descriptor;
    const { method = 'rnm', amount = 1, precision = spec.precision } = options;
    if (!alignedGrid(base, detail, true) || spec.units !== detail.descriptor.units || spaceOf(spec) !== spaceOf(detail.descriptor) ||
        !['rnm', 'whiteout', 'lerp'].includes(method) || method !== 'lerp' && spaceOf(spec) !== 'tangent' || !unit(amount))
      throw new RangeError('Normal combine needs aligned maps in the same space, a valid method and amount in [0, 1]');
    const combine = method === 'rnm' ? reorient : method === 'whiteout' ?
      (a, b) => [a[0] + b[0], a[1] + b[1], a[2] * b[2]] : (_a, b) => b;
    const readDetail = reader(detail), gate = weights(base, mask), other = [0, 0, 0];
    return apply(base, { precision }, (vector, p) => {
      const n = normalize(vector);
      const fourth = readDetail(p, other), weight = gate(p) * amount * (detail.descriptor.alpha === 'none' ? 1 : fourth);
      if (!weight) return n;
      const added = normalize(combine(n, normalize(other)), n);
      return normalize(V.lerp(n, added, weight), n);
    });
  }

  function basis(normal, tangent, handedness) {
    const n = normalize(normal), orthogonal = V.mad(tangent, n, -V.dot(n, tangent));
    if (V.len(normal) <= 1e-9 || V.len(orthogonal) <= 1e-9)
      throw new RangeError('Tangent frame needs a nonzero normal and an independent tangent');
    const t = normalize(orthogonal), b = V.mul(V.cross(n, t), handedness);
    return [t[0], b[0], n[0], t[1], b[1], n[1], t[2], b[2], n[2]];
  }

  function frameReader(primary, source, label) {
    const value = requireImage(source), { raster: { channels, data }, descriptor: spec } = value;
    if (!alignedGrid(primary, value, true) || spec.units !== 'unitless' ||
        !(spec.intent === 'normal' && spaceOf(spec) === 'world' || spec.intent === 'data' && channels === 3 &&
          spec.alpha === 'none' && !integerMax(spec.precision)))
      throw new TypeError(label + ' needs an aligned world normal or float XYZ data map');
    if (spec.intent === 'normal') {
      const read = reader(value);
      return (p, out) => {
        if (!read(p, out) && spec.alpha !== 'none') throw new RangeError(label + ' needs coverage at every visible sample');
      };
    }
    return (p, out) => {
      for (let c = 0; c < 3; c++) {
        const value = data[3 * p + c];
        if (!bounded(value)) throw new RangeError(label + ' components exceed the frame range');
        out[c] = value;
      }
    };
  }

  function normalSpace(source, options = {}, surface = null, tangentMap = null, handednessMap = null) {
    settings(options, ['to', 'orientation', 'precision', 'frame']);
    const image = requireImage(source, 'normal'), spec = image.descriptor, from = spaceOf(spec);
    const { to = from === 'tangent' ? 'world' : 'tangent', orientation, precision = spec.precision, frame = {} } = options;
    if (!origin.includes(to) || orientation !== undefined && (to !== 'tangent' || !conventions.includes(orientation)) ||
        !fields(frame, ['normal', 'tangent', 'handedness']) || (surface === null) !== (tangentMap === null) ||
        surface !== null && (frame.normal !== undefined || frame.tangent !== undefined))
      throw new TypeError('Normal conversion needs tangent or world space and a uniform frame or paired frame maps');
    const { normal = flat, tangent = tangentX, handedness = 1 } = frame;
    if (!tuple(normal, 3, bounded) || !tuple(tangent, 3, bounded) || ![-1, 1].includes(handedness))
      throw new TypeError('Normal frame needs finite XYZ axes and a handedness of -1 or +1');
    const target = { normalSpace: to, normalOrientation: to === 'tangent' ?
      orientation ?? (from === 'tangent' ? orientationOf(spec) : 'opengl') : undefined, precision };
    if (to === from) return apply(image, target, v => v);
    const fromFrame = matrix => to === 'world' ? matrix : M.tr(matrix);
    let signAt = () => handedness;
    if (handednessMap !== null) {
      const input = requireImage(handednessMap), { descriptor: hs, raster: { channels, data } } = input;
      if (!alignedGrid(image, input, true) || channels !== 1 || hs.units !== 'unitless' || !['mask', 'data'].includes(hs.intent))
        throw new TypeError('Handedness needs an aligned scalar sign image');
      signAt = p => {
        const value = data[p];
        if (hs.intent === 'mask') return value < (integerMax(hs.precision) || 1) / 2 ? -1 : 1;
        if (![-1, 1].includes(value) || integerMax(hs.precision))
          throw new RangeError('Handedness data samples must be signed -1 or +1');
        return value;
      };
    }
    const readN = surface === null ? null : frameReader(image, surface, 'Surface normal');
    const readT = tangentMap === null ? null : frameReader(image, tangentMap, 'Surface tangent');
    const constant = !readN && handednessMap === null ? fromFrame(basis(normal, tangent, handedness)) : null;
    const n = normal.slice(), t = tangent.slice();
    return apply(image, target, (vector, p, coverage) => {
      if (!coverage) return flat;
      if (readN) { readN(p, n); readT(p, t); }
      const matrix = constant ?? fromFrame(basis(n, t, signAt(p)));
      return M.app(matrix, normalize(vector));
    });
  }

  function heightBlend(baseSource, layerSource, options = {}, mask = null) {
    settings(options, ['mode', 'bias', 'offset', 'softness', 'opacity', 'precision']);
    const base = requireImage(baseSource, 'height'), layer = requireImage(layerSource, 'height');
    const { raster: grid, descriptor: spec } = base, { width, height } = grid;
    const { mode = 'height', bias = 0, offset = 0, softness = 0, opacity = 1, precision = spec.precision } = options;
    if (!alignedGrid(base, layer, true) || spec.units !== layer.descriptor.units || !['height', 'mix'].includes(mode) ||
        ![bias, offset].every(finite) || !finite(softness) || softness < 0 || !unit(opacity))
      throw new RangeError('Height blend needs aligned heights with matching units and valid transition controls');
    const target = descriptor(grid, { ...spec, precision, domain: undefined });
    const maskSpec = descriptor(grid, { ...spec, intent: 'mask', units: 'unitless', precision: 'float64', domain: undefined });
    const gate = weights(base, mask), count = width * height;
    const data = new storage[target.precision](count), weight = new Float64Array(count);
    for (let p = 0; p < count; p++) {
      const a = grid.data[p], b = layer.raster.data[p] + offset, m = gate(p) * opacity;
      if (!finite(b)) throw new RangeError('Height layer offset exceeds its numeric range');
      const w = mode === 'mix' ? m : m * RasterHeightWeight(b - a + bias, softness);
      weight[p] = w;
      data[p] = pack(linear(a, b, w), target, false, 'error');
    }
    return { value: wrap({ ...grid, data }, target), weight: wrap({ ...grid, data: weight }, maskSpec) };
  }

  return Object.freeze({ heightToNormal, normalDecode, normalNormalize, normalInvert, normalRotate, normalOrientation,
    normalCombine, normalSpace, heightBlend, reencode });
};
