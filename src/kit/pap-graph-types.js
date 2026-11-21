/* Shared port validation for graph data and native toolkit handles. */
(function (K) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && typeof value.length === 'number';
  function all(values, valid) {
    if (!list(values)) return false;
    for (let i = 0; i < values.length; i++) if (!valid(values[i])) return false;
    return true;
  }
  const vector = (value, length) => Array.isArray(value) && value.length === length && all(value, Number.isFinite);
  const dimensions = value => Number.isSafeInteger(value?.width) && value.width > 0 &&
    Number.isSafeInteger(value.height) && value.height > 0 && Number.isSafeInteger(value.width * value.height);
  function raster(value) {
    if (!dimensions(value) || !list(value.data)) return false;
    const channels = value.channels ?? value.data.length / (value.width * value.height);
    return Number.isSafeInteger(channels) && channels >= 1 && channels <= 4 &&
      value.data.length === value.width * value.height * channels &&
      (value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray || all(value.data, Number.isFinite));
  }
  function path(value) {
    const points = Array.isArray(value) ? value : value?.points;
    const width = points?.[0]?.length;
    return Array.isArray(points) && points.length >= 2 && (width === 2 || width === 3) &&
      all(points, point => vector(point, width)) &&
      (value.closed === undefined || typeof value.closed === 'boolean');
  }
  function mesh(value) {
    if (!record(value)) return false;
    const {points,faces} = value;
    if (Array.isArray(points) && Array.isArray(faces)) {
      return points.length > 0 && all(points, point => vector(point, 3)) &&
        all(faces, face => list(face) && face.length >= 3 && all(face, index => vertex(index, points.length)));
    }
    const positions = value.pos ?? value.positions ?? points;
    const indices = value.tri ?? value.indices ?? value.triangles;
    return list(positions) && positions.length > 0 && positions.length % 3 === 0 && all(positions, Number.isFinite) &&
      list(indices) && indices.length % 3 === 0 && all(indices, index => vertex(index, positions.length / 3));
  }
  const vertex = (index,count) => Number.isSafeInteger(index) && index >= 0 && index < count;
  const unit = value => Number.isFinite(value) && value>=0 && value<=1;
  const byteLevel = value => Number.isFinite(value) && value >= 0 && value <= 255;
  const ratio = value => record(value) && Number.isSafeInteger(value.numerator) &&
    Number.isSafeInteger(value.denominator) && value.denominator > 0 &&
    Object.keys(value).every(key => key === 'numerator' || key === 'denominator');
  const rgb = (value, valid) => Array.isArray(value) && [3, 4].includes(value.length) && all(value, valid);
  const byteData = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  function frameRate(value) {
    const rate = ratio(value) ? value.numerator / value.denominator : value;
    return Number.isFinite(rate) && rate >= .001 && rate <= 1000;
  }
  function linearRaster(value) {
    if (!raster(value) || byteData(value.data) || value.colorSpace === 'srgb') return false;
    const channels = value.channels ?? value.data.length / (value.width * value.height);
    if (channels !== 3 && channels !== 4) return false;
    if (channels === 4) for (let i = 3; i < value.data.length; i += 4) if (!unit(value.data[i])) return false;
    return true;
  }
  function cameraGrid(value) {
    return dimensions(value) && list(value.view) && value.view.length === 16 && all(value.view, Number.isFinite) &&
      Number.isFinite(value.tangent) && value.tangent > 0 && typeof value.ortho === 'boolean' &&
      Number.isFinite(value.clipNear) && value.clipNear > 0 &&
      Number.isFinite(value.clipFar) && value.clipFar > value.clipNear;
  }
  function palette(value) {
    const colors = list(value) ? value : value?.palette;
    return list(colors) && colors.length >= 1 && colors.length <= 256 && all(colors, color =>
      typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ||
      Number.isSafeInteger(color) && color >= 0 && color <= 0xffffff ||
      vector(color, 3) && all(color, unit));
  }
  function atlas(value) {
    if (!record(value)) return false;
    if (value[Symbol.for('ink-studio.sprite-atlas')] === true &&
        typeof value.select === 'function' && typeof value.snapshot === 'function') return true;
    const {metadata,images} = value;
    if (!dimensions(metadata) || !record(images) || !list(images.color)) return false;
    const frames = metadata.frames === undefined && metadata.scenery !== undefined
      ? [{rect:{x:0,y:0,width:metadata.width,height:metadata.height}}] : metadata.frames;
    return Array.isArray(frames) && frames.length > 0 && Object.values(images).every(buffer => list(buffer) &&
      buffer.length === metadata.width * metadata.height * 4 &&
      (buffer instanceof Uint8Array || buffer instanceof Uint8ClampedArray ||
        all(buffer, n => Number.isInteger(n) && n>=0 && n<=255))) &&
      all(frames, frame => {
        const rect = frame?.rect;
        return dimensions(rect) && Number.isSafeInteger(rect.x) && Number.isSafeInteger(rect.y) &&
          rect.x>=0 && rect.y>=0 && rect.x+rect.width<=metadata.width && rect.y+rect.height<=metadata.height;
      });
  }
  function audio(value) {
    const {sampleRate,channels,samples} = value ?? {};
    return Number.isSafeInteger(sampleRate) && sampleRate > 0 && Number.isSafeInteger(channels) && channels > 0 &&
      list(samples) && samples.length <= 32000000 && samples.length % channels === 0 && all(samples, n => Number.isFinite(n) && n>=-1 && n<=1);
  }

  const checks = {
    any: () => true,
    number: Number.isFinite,
    boolean: value => typeof value === 'boolean',
    string: value => typeof value === 'string',
    vec2: value => vector(value, 2),
    vec3: value => vector(value, 3),
    array: Array.isArray,
    record: value => record(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)),
    geometry: value => record(value) && ((value.points && value.faces) || (value.pos && value.tri) || value.positions || mesh(value)),
    field: value => typeof value === 'function' || typeof value?.sample === 'function',
    points: Array.isArray,
    world: value => record(value) && Number.isSafeInteger(value.count) && value.count >= 0 &&
      list(value.data) && value.data.length >= value.count * 16,
    renderFrame: value => record(value) && Number.isSafeInteger(value.w) && value.w > 0 &&
      Number.isSafeInteger(value.h) && value.h > 0 && list(value.rgb) && value.rgb.length === value.w * value.h * 3,
    image: value => record(value) && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) && value.data,
    raster, path, mesh, palette, atlas, audio, cameraGrid, frameRate, linearRaster,
    pixels: value => vector(value, 2),
    uv: value => vector(value, 2),
    worldPosition: value => vector(value, 3),
    pixelCount: value => Number.isSafeInteger(value) && value > 0,
    axialDepth: value => Number.isFinite(value) && value > 0,
    seconds: Number.isFinite,
    frames: Number.isSafeInteger,
    rgb8: value => rgb(value, byteLevel),
    srgb: value => rgb(value, unit),
    'srgb-linear': value => rgb(value, Number.isFinite) && (value.length === 3 || unit(value[3])),
    displayRaster: value => raster(value) && value.colorSpace !== 'srgb-linear' &&
      (byteData(value.data) || all(value.data, byteLevel))
  };
  // Semantic ports retain compatibility with legacy numeric and raster sockets.
  const semantics = {
    pixels: ['top-left pixel coordinates', 'vec2'],
    uv: ['normalized top-left UV coordinates', 'vec2'],
    worldPosition: ['world XYZ position', 'vec3'],
    pixelCount: ['positive integer pixel count', 'number'],
    axialDepth: ['positive axial camera depth', 'number'],
    seconds: ['seconds', 'number'],
    frames: ['integer frame index', 'number'],
    frameRate: ['frame rate in frames per second', 'number'],
    rgb8: ['display RGB(A) in byte levels [0,255]', 'array<number>', 'vec3'],
    srgb: ['display sRGB(A) in [0,1]', 'vec3', 'array<number>'],
    'srgb-linear': ['linear sRGB(A)', 'vec3', 'array<number>'],
    displayRaster: ['display RGB(A) raster in byte levels', 'raster', 'image'],
    linearRaster: ['linear RGB(A) raster with unit alpha', 'raster', 'image'],
    cameraGrid: ['camera grid with view and viewport', 'record']
  };
  const description = type => Object.hasOwn(semantics, type) ? semantics[type][0] : type;
  const conversions = {
    'pixels/uv': 'coord.pixelToUV', 'uv/pixels': 'coord.uvToPixel',
    'worldPosition/pixels': 'coord.project', 'worldPosition/uv': 'coord.project (uv output)',
    'pixels/worldPosition': 'coord.unproject with axial depth',
    'uv/worldPosition': 'coord.uvToPixel, then coord.unproject with axial depth',
    'seconds/frames': 'time.toFrames', 'frames/seconds': 'time.toSeconds',
    'rgb8/srgb': 'color.fromRGB8', 'srgb/rgb8': 'color.toRGB8',
    'srgb/srgb-linear': 'color.toLinear', 'srgb-linear/srgb': 'color.toDisplay',
    'rgb8/srgb-linear': 'color.fromRGB8, then color.toLinear',
    'srgb-linear/rgb8': 'color.toDisplay, then color.toRGB8',
    'displayRaster/linearRaster': 'color.rasterToLinear', 'linearRaster/displayRaster': 'color.rasterToDisplay'
  };
  const conversion = (from, to) => conversions[from + '/' + to];
  function element(type) {
    if (type === 'array' || type === 'points') return 'any';
    return typeof type === 'string' && type.startsWith('array<') && type.endsWith('>') ? type.slice(6,-1) : undefined;
  }
  function validator(type) {
    if (typeof type !== 'string' || type.length > 128) return;
    if (Object.hasOwn(checks,type)) return checks[type];
    const item = element(type), check = item && validator(item);
    if (check) return values => Array.isArray(values) && all(values,check);
  }
  function compatible(from,to) {
    if (from === to || from === 'any' || to === 'any') return true;
    const source = Object.hasOwn(semantics, from) ? semantics[from] : null;
    const target = Object.hasOwn(semantics, to) ? semantics[to] : null;
    if (source || target) return !(source && target) &&
      (source ?? target).some((base, index) => index > 0 && compatible(base, source ? to : from));
    const alias = type => type === 'image' ? 'raster' : type === 'geometry' ? 'mesh' : type;
    if (alias(from) === alias(to)) return true;
    const a = element(from), b = element(to);
    return Boolean(a && b && compatible(a,b));
  }
  K.procedural.graphTypes = Object.freeze({validator,compatible,description,conversion});
})(KIT);
