/* Inverse displacement maps for typed material images. */
const TypedImageDisplacement = ({ requireImage, descriptor, wrap, integerMax, filters, resample, sampler, borders }) => {
  const tau = 2 * Math.PI;
  const bounded = n => Number.isFinite(n) && Math.abs(n) <= 1e6;
  const unit = n => n >= 0 && n <= 1;
  const common = ['amount', 'units', 'smooth', 'mapBorder', 'mapFilter'];
  const directional = ['angle', 'center'];
  const optionsFor = {
    directionalWarp: directional,
    nonuniformWarp: [...directional, 'directionScale'],
    vectorWarp: ['encoding', 'center', 'yAxis'],
    slopeWarp: ['slope'],
    multiDirectionalWarp: [...directional, 'axes', 'combine']
  };

  function imageView(source, kind) {
    const { raster, descriptor: spec } = requireImage(source);
    const vector = kind === 'vector', slope = kind === 'slope';
    if (spec.alpha !== 'none' || raster.channels !== (vector ? 2 : 1) ||
        !(spec.intent === 'data' || !vector && spec.intent === 'mask' || slope && spec.intent === 'height') ||
        !slope && spec.units !== 'unitless')
      throw new TypeError(kind + ' driver needs an unassociated ' + (vector ? 'unitless RG data' :
        slope ? 'scalar height, mask or data' : 'unitless scalar mask or data') + ' image');
    return { raster, spec };
  }

  function driver(view, options, convert, channels = view.raster.channels) {
    const { raster: { width, height, data: original, channels: stride }, spec } = view;
    const { smooth, mapBorder, mapFilter } = options;
    const tiling = borders(mapBorder, spec.tiling), divisor = integerMax(spec.precision) || 1;
    const [ax, ay] = [tiling.u, tiling.v].map(TextureAddress.axis);
    let data = new Float64Array(width * height * channels);
    for (let i = 0, j = 0; i < original.length; i += stride, j += channels)
      convert(original[i] / divisor, stride === 2 ? original[i + 1] / divisor : 0, data, j);
    if (smooth) {
      const raster = { width, height, channels, data };
      const image = wrap(raster, descriptor(raster, { intent: 'data', tiling }));
      data = filters.gaussianBlur(image, { radius: smooth }).raster.data;
    }
    const values = new Float64Array(channels);
    const read = sampler({ width, height, accumulate(i, out, weight) {
      for (let c = 0; c < channels; c++) out[c] += weight * data[i + c];
    } }, channels, mapFilter, ax, ay);
    return (u, v) => {
      values.fill(0);
      read(u, v, 1, values);
      return values;
    };
  }

  function angleVector(degrees) {
    const theta = (degrees % 360) * tau / 360;
    const snap = n => Math.abs(n) < 1e-15 ? 0 : n;
    return [snap(Math.cos(theta)), snap(Math.sin(theta))];
  }

  function prepare(grid, output, mapImage, directionImage, intensityImage, options, name) {
    const { units = 'pixels', amount = 1, smooth = 0, mapBorder = {}, mapFilter = 'linear', angle = 0,
      directionScale = 1, slope = 'downhill', yAxis = 'down', axes = 2, combine = 'chain' } = options;
    if (!['pixels', 'normalized'].includes(units) || !bounded(amount) || !bounded(angle) ||
        !bounded(directionScale) || !Number.isSafeInteger(smooth) || smooth < 0 || smooth > 32 ||
        !['nearest', 'linear'].includes(mapFilter) || !['downhill', 'uphill'].includes(slope) ||
        !['down', 'up'].includes(yAxis) || ![1, 2, 4].includes(axes) || !['chain', 'average', 'min', 'max'].includes(combine))
      throw new RangeError('Invalid displacement amount, direction, smoothing or sampling options');

    const vectorWarp = name === 'vectorWarp', slopeWarp = name === 'slopeWarp', multi = name === 'multiDirectionalWarp';
    const mapView = imageView(mapImage, vectorWarp ? 'vector' : slopeWarp ? 'slope' : 'displacement');
    const angleView = name === 'nonuniformWarp' ? imageView(directionImage, 'angle') : null;
    const intensityView = intensityImage === null ? null : imageView(intensityImage, 'intensity');
    const views = [mapView, angleView, intensityView].filter(Boolean);
    const size = view => view.raster.width * view.raster.height;
    const components = size(mapView) * mapView.raster.channels + (angleView ? size(angleView) * 2 : 0) +
      (intensityView ? size(intensityView) : 0);
    const mipReads = ['nearest', 'linear'].includes(options.mip) ? 5 : 1;
    const pathReads = multi ? 2 * axes : slopeWarp ? 4 : 1;
    if (components > 8e6 || output.width * output.height * pathReads * mipReads > 120e6)
      throw new RangeError('Image displacement exceeds its field or sample budget');
    // Validate the selected address overrides before building working fields.
    for (const { spec } of views) borders(mapBorder, spec.tiling);

    const settings = { smooth: amount ? smooth : 0, mapBorder, mapFilter };
    const encoding = options.encoding ?? (integerMax(mapView.spec.precision) ? 'unorm' : 'signed');
    const vectorCenter = encoding === 'unorm' ? .5 : 0;
    const center = options.center ?? (vectorWarp ? vectorCenter : 0);
    const centers = Array.isArray(center) ? Array.from(center) : [center, center];
    if (vectorWarp ? !['unorm', 'signed'].includes(encoding) || centers.length !== 2 ||
      !centers.every(encoding === 'unorm' ? unit : bounded) : !bounded(center))
      throw new RangeError('Invalid displacement center or vector encoding');
    const vectorGain = encoding === 'unorm' ? 2 : 1, ySign = yAxis === 'up' ? -1 : 1;
    const map = driver(mapView, settings, (x, y, data, i) => {
      const range = vectorWarp && encoding === 'unorm' ? unit : bounded;
      if (!range(x) || vectorWarp && !range(y)) throw new RangeError('Displacement map sample is outside its encoding range');
      data[i] = vectorWarp ? (x - centers[0]) * vectorGain : x - center;
      if (vectorWarp) data[i + 1] = (y - centers[1]) * vectorGain * ySign;
    });
    const heading = angleView && driver(angleView, settings, (turn, _unused, data, i) => {
      if (!bounded(turn)) throw new RangeError('Invalid displacement angle in turns');
      const [x, y] = angleVector(360 * ((turn * directionScale) % 1) + angle);
      data[i] = x;
      data[i + 1] = y;
    }, 2);
    const intensity = intensityView && driver(intensityView, settings, (x, _unused, data, i) => {
      if (!unit(x)) throw new RangeError('Displacement intensity samples must be within [0, 1]');
      data[i] = x;
    });
    const identity = (u, v, out) => { out[0] = u; out[1] = v; return true; };
    if (!amount) return { map: identity };

    const distance = multi && combine !== 'chain' ? Math.abs(amount) : amount;
    const dx = distance / (units === 'pixels' ? grid.width : 1);
    const dy = distance / (units === 'pixels' ? grid.height : 1);
    const gain = intensity ? (u, v) => intensity(u, v)[0] : () => 1;
    function move(u, v, x, y, strength, out) {
      const s = u - strength * dx * x, t = v - strength * dy * y;
      if (Math.abs(s) > 1e9 || Math.abs(t) > 1e9 || !Number.isFinite(s) || !Number.isFinite(t))
        throw new RangeError('Displaced image address exceeds its coordinate range');
      out[0] = s;
      out[1] = t;
      return true;
    }
    if (vectorWarp) return { map(u, v, out) {
      const [x, y] = map(u, v);
      return move(u, v, x, y, gain(u, v), out);
    } };
    if (slopeWarp) {
      const { width, height } = mapView.raster;
      const sign = slope === 'uphill' ? 1 : -1;
      const ru = 1 / width, rv = 1 / height;
      return { map(u, v, out) {
        const x = (map(u + ru, v)[0] - map(u - ru, v)[0]) * .5 * width / grid.width;
        const y = (map(u, v + rv)[0] - map(u, v - rv)[0]) * .5 * height / grid.height;
        return move(u, v, x, y, sign * gain(u, v), out);
      } };
    }
    if (heading) return { map(u, v, out) {
      const [x, y] = heading(u, v);
      const length = Math.hypot(x, y);
      if (length < 1e-10) return identity(u, v, out);
      return move(u, v, x / length, y / length, gain(u, v) * map(u, v)[0], out);
    } };

    function along(x, y) {
      return (u, v, out) => move(u, v, x, y, gain(u, v) * map(u, v)[0], out);
    }
    if (!multi) return { map: along(...angleVector(angle)) };
    const maps = Array.from({ length: axes }, (_, i) => {
      const [x, y] = angleVector(angle + i * 180 / axes);
      return [along(x, y), along(-x, -y)];
    }).flat();
    if (combine !== 'chain') return { maps, combine };
    return { map(u, v, out) {
      identity(u, v, out);
      for (const read of maps) read(out[0], out[1], out);
      return true;
    } };
  }

  function run(name, source, map, direction, intensity, options) {
    return resample(source, options, name, [...common, ...optionsFor[name]],
      (grid, settings, output) => prepare(grid, output, map, direction, intensity, settings, name));
  }

  return Object.freeze({
    directionalWarp: (source, map, options = {}, intensity = null) =>
      run('directionalWarp', source, map, null, intensity, options),
    nonuniformWarp: (source, map, direction, options = {}, intensity = null) =>
      run('nonuniformWarp', source, map, direction, intensity, options),
    vectorWarp: (source, map, options = {}, intensity = null) =>
      run('vectorWarp', source, map, null, intensity, options),
    slopeWarp: (source, map, options = {}, intensity = null) =>
      run('slopeWarp', source, map, null, intensity, options),
    multiDirectionalWarp: (source, map, options = {}, intensity = null) =>
      run('multiDirectionalWarp', source, map, null, intensity, options)
  });
};
