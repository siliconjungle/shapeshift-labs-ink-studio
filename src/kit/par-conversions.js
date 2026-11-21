/* Explicit picture-grid, clock and RGB conversions for typed graphs. */
(function (K) {
  const P = K.procedural, T = P.takeTime, V = K.V;
  const { validator, description } = P.graphTypes;
  const requireType = (type, value) => {
    if (!validator(type)(value)) throw new TypeError('Expected ' + description(type));
    return value;
  };
  function extent({ width, height }) {
    return [requireType('pixelCount', width), requireType('pixelCount', height)];
  }
  function pixelToUV(point, size) {
    const [width, height] = extent(size), [x, y] = requireType('pixels', point);
    return [x / width, y / height];
  }
  function uvToPixel(point, size) {
    const [width, height] = extent(size), [u, v] = requireType('uv', point);
    return requireType('pixels', [u * width, v * height]);
  }

  function fromCameraFrame(frame, width, height) {
    return requireType('cameraGrid', { width, height, view: frame.view.slice(),
      tangent: frame.ortho ? frame.dist * frame.tangent : frame.tangent, ortho: frame.ortho,
      clipNear: frame.clipNear, clipFar: frame.clipFar });
  }
  function cameraGrid(camera, size, radius = 14) {
    const [width, height] = extent(size);
    if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Camera grid needs a positive scene radius');
    const frame = CameraLens.frame({ cam: P.sceneGraph.camera(camera), radius }, {}, width, height);
    return fromCameraFrame(frame, width, height);
  }
  function renderGrid(report) {
    const camera = report?.camera;
    if (!camera) throw new RangeError('Render report has no captured camera grid');
    return requireType('cameraGrid', { width: camera.width ?? report.width, height: camera.height ?? report.height,
      view: Array.from(camera.view ?? []), tangent: camera.tangent, ortho: camera.ortho,
      clipNear: camera.clipNear, clipFar: camera.clipFar });
  }
  function project(point, grid) {
    const { width, height, view, tangent, ortho, clipNear, clipFar } = requireType('cameraGrid', grid);
    const { eye, right, up, back } = CameraLens.fromView(view);
    const relative = V.sub(requireType('worldPosition', point), eye);
    const depth = -V.dot(relative, back);
    if (!Number.isFinite(depth) || depth <= 0) throw new RangeError('Point is at or behind the camera plane');
    const focal = height / (2 * tangent * (ortho ? 1 : depth));
    const x = width / 2 + V.dot(relative, right) * focal, y = height / 2 - V.dot(relative, up) * focal;
    const value = requireType('pixels', [x, y]);
    return { value, uv: pixelToUV(value, grid), depth,
      visible: depth >= clipNear && depth <= clipFar && x >= 0 && x < width && y >= 0 && y < height };
  }
  function unproject(point, depth, grid) {
    const [x, y] = requireType('pixels', point);
    const { width, height, view, tangent, ortho } = requireType('cameraGrid', grid);
    const { eye } = CameraLens.fromView(view);
    const ray = CameraLens.rays(view, eye, width, height, height / (2 * tangent), ortho)(x, height - y);
    return requireType('worldPosition', V.mad(ray.origin, ray.direction, requireType('axialDepth', depth) / ray.axial));
  }

  const rate = fps => T.read(requireType('frameRate', fps));
  const secondsAt = (frame, picture) => T.seconds(T.div([frame, 1n], picture));
  function toSeconds(frame, fps) {
    return requireType('seconds', secondsAt(BigInt(requireType('frames', frame)), rate(fps)));
  }
  function toFrames(time, fps, rounding = 'floor') {
    const picture = rate(fps), [n, d] = T.mul(T.read(requireType('seconds', time)), picture);
    if (!['floor', 'ceil', 'nearest', 'exact'].includes(rounding))
      throw new RangeError('Frame rounding needs floor, ceil, nearest or exact');
    const lower = T.roundDown([n, d]);
    // A seconds port can carry the rounded number from an exact frame boundary.
    const boundary = [lower, lower + 1n].find(frame => secondsAt(frame, picture) === time);
    if (boundary !== undefined) return T.index(boundary);
    if (rounding === 'exact') throw new RangeError('Seconds fall between frames. Choose a frame rounding mode');
    const frame = rounding === 'ceil' ? lower + 1n : rounding === 'nearest' ? T.roundDown([2n * n + d, 2n * d]) : lower;
    return T.index(frame);
  }

  const display = { space: 'srgb', range: [0, 255] };
  const toLinearRGB = ColorSpace.prepare('srgb', 'srgb-linear');
  const fromByteRGB = ColorSpace.prepare(display, 'srgb');
  const toByteRGB = ColorSpace.prepare('srgb', display);
  function colorTuple(value, type, convert, alpha = 1, quantize = false) {
    requireType(type, value);
    const output = convert(value);
    if (value.length === 4) output.push(value[3] * alpha);
    return quantize ? output.map(Math.round) : output;
  }
  function displayPolicy(outOfRange) {
    if (outOfRange !== 'clamp' && outOfRange !== 'error') throw new RangeError('Display RGB needs clamp or error for out-of-range values');
    return outOfRange;
  }
  const toLinear = value => colorTuple(value, 'srgb', toLinearRGB);
  const toDisplay = (value, outOfRange = 'clamp') =>
    colorTuple(value, 'srgb-linear', ColorSpace.prepare('srgb-linear', { space: 'srgb', outOfRange: displayPolicy(outOfRange) }));
  const fromRGB8 = value => colorTuple(value, 'rgb8', fromByteRGB, 1 / 255);
  const toRGB8 = value => colorTuple(value, 'srgb', toByteRGB, 255, true);

  function rasterColor(source, linear, outOfRange) {
    requireType(linear ? 'displayRaster' : 'linearRaster', source);
    const { width, height, data, pivot } = source, channels = source.channels ?? data.length / (width * height);
    if (channels !== 3 && channels !== 4) throw new TypeError('Colour conversion needs RGB or RGBA raster channels');
    if (width > 8192 || height > 8192 || width * height > 16777216)
      throw new RangeError('Colour conversion exceeds the raster dimensions budget');
    const result = linear ? new Float32Array(data.length) : new Uint8Array(data.length);
    const convert = linear ? ColorSpace.prepare(display, 'srgb-linear') :
      ColorSpace.prepare('srgb-linear', { ...display, outOfRange: displayPolicy(outOfRange) });
    const input = [0, 0, 0], output = [0, 0, 0];
    for (let i = 0; i < data.length; i += channels) {
      for (let c = 0; c < 3; c++) input[c] = data[i + c];
      convert(input, output);
      for (let c = 0; c < 3; c++) result[i + c] = linear ? output[c] : Math.round(output[c]);
      if (channels === 4) result[i + 3] = linear ? data[i + 3] / 255 : Math.round(data[i + 3] * 255);
    }
    return { width, height, channels, data: result, colorSpace: linear ? 'srgb-linear' : 'srgb',
      ...(pivot !== undefined && { pivot: requireType('pixels', pivot).slice() }) };
  }

  const rasterToLinear = source => rasterColor(source, true);
  const rasterToDisplay = (source, outOfRange = 'clamp') => rasterColor(source, false, outOfRange);
  const size = { width: 'pixelCount', height: 'pixelCount' };
  const setting = (type, value, props = {}) => ({ type, default: value, ...props });
  const policy = setting('string', 'clamp', { constraints: { choices: ['clamp', 'error'] } });
  const slot = (type, unit, description) => ({ type, unit, ...(description && { description }) });
  const pixels = slot('pixels', 'pixels', 'Top-left pixel-edge coordinates. The first pixel center is [0.5, 0.5].');
  const uv = slot('uv', 'normalized UV', 'Top-left UV. Values outside [0,1] are allowed.');
  const world = slot('worldPosition', 'world units');
  const depth = slot('axialDepth', 'world units', 'Distance along the camera forward axis, including any orthographic setback.');
  const fps = slot('frameRate', 'frames/second', 'Positive rate or integer numerator/denominator, for example 30000/1001.');
  const unary = (inputs, output, run) => ({ inputs, outputs: { value: output }, run: args => ({ value: run(args) }) });

  const operations = Object.freeze({
    'coord.pixelToUV': unary({ point: pixels, ...size }, uv, ({ point, ...size }) => pixelToUV(point, size)),
    'coord.uvToPixel': unary({ point: uv, ...size }, pixels, ({ point, ...size }) => uvToPixel(point, size)),
    'coord.cameraGrid': unary({ camera: setting('record', {}), ...size, radius: setting('number', 14) },
      'cameraGrid', ({ camera, radius, ...size }) => cameraGrid(camera, size, radius)),
    'coord.renderGrid': unary({ report: 'record' }, 'cameraGrid', ({ report }) => renderGrid(report)),
    'coord.project': {
      inputs: { point: world, grid: 'cameraGrid' }, outputs: { value: pixels, uv, depth, visible: 'boolean' },
      run({ point, grid }) { return project(point, grid); }
    },
    'coord.unproject': unary({ point: pixels, depth, grid: 'cameraGrid' }, world,
      ({ point, depth, grid }) => unproject(point, depth, grid)),
    'time.toFrames': unary({ time: slot('seconds', 'seconds'), fps, rounding: setting('string', 'floor',
      { constraints: { choices: ['floor', 'ceil', 'nearest', 'exact'] } }) }, slot('frames', 'frames'),
      ({ time, fps, rounding }) => toFrames(time, fps, rounding)),
    'time.toSeconds': unary({ frame: slot('frames', 'frames'), fps }, slot('seconds', 'seconds'),
      ({ frame, fps }) => toSeconds(frame, fps)),
    'color.fromRGB8': unary({ source: 'rgb8' }, 'srgb', ({ source }) => fromRGB8(source)),
    'color.toRGB8': unary({ source: 'srgb' }, 'rgb8', ({ source }) => toRGB8(source)),
    'color.toLinear': unary({ source: 'srgb' }, 'srgb-linear', ({ source }) => toLinear(source)),
    'color.toDisplay': unary({ source: 'srgb-linear', outOfRange: policy }, 'srgb',
      ({ source, outOfRange }) => toDisplay(source, outOfRange)),
    'color.rasterToLinear': unary({ source: 'displayRaster' }, 'linearRaster', ({ source }) => rasterToLinear(source)),
    'color.rasterToDisplay': unary({ source: 'linearRaster', outOfRange: policy }, 'displayRaster',
      ({ source, outOfRange }) => rasterToDisplay(source, outOfRange))
  });
  P.conversions = Object.freeze({ pixelToUV, uvToPixel, fromCameraFrame, cameraGrid, renderGrid, project, unproject,
    toFrames, toSeconds, fromRGB8, toRGB8, toLinear, toDisplay, rasterToLinear, rasterToDisplay, operations });
})(KIT);
