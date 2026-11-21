const types = {
  number: { finite: true },
  vec2: { dimensions: 2, finite: true },
  vec3: { dimensions: 3, finite: true },
  raster: { layout: 'Interleaved samples on a positive integer grid', channels: [1, 4], finite: true },
  image: { layout: 'Width, height and image data' },
  palette: { minItems: 1, maxItems: 256, entries: 'RGB integer, #rrggbb or normalized RGB triple' },
  path: { minItems: 2, dimensions: [2, 3], finite: true },
  mesh: { layout: 'XYZ vertices with in-range indices' },
  geometry: { layout: 'Native geometry or mesh buffers' },
  field: { layout: 'Function or native object with a sample method' },
  record: { layout: 'Plain named object' },
  atlas: { layout: 'Compiled atlas or bounded frame rectangles with aligned image maps' },
  audio: { layout: 'Interleaved PCM with integer sample rate and channel count', samples: [-1, 1] },
  world: { layout: 'Native world with 16 samples per splat row' },
  renderFrame: { layout: 'Headless frame with width, height and RGB buffer' }
};
const positivePixels = { unit: 'pixels', constraints: { integer: true, min: 1 } };
const pixelOffset = { unit: 'pixels', constraints: { integer: true, min: 0 } };
const seconds = { unit: 'seconds' };
const rate = { unit: 'frames/second' };
const unit = value => ({ unit: value });
const limit = (min, max, integer = false) => ({ constraints: { min, max, ...(integer && { integer }) } });
const pixelRange = (min, max, integer = false) => ({ unit: 'pixels', ...limit(min, max, integer) });
const oneOf = (...choices) => ({ constraints: { choices } });
const property = (type, details = {}, fallback) => ({ type, ...details, ...(fallback !== undefined && { default: fallback }) });
const pixelSize = property('number', positivePixels);
const sampleTime = property('number', seconds);
const sampleRate = property('number', rate, 12);
const mode = property('string', oneOf('hold', 'loop', 'pingpong'), 'hold');
const warpFilter = property('string', oneOf('nearest', 'linear'), 'linear');
const address = property('string', oneOf('clamp', 'transparent', 'wrap', 'mirror'), 'clamp');
const size = { width: pixelSize, height: pixelSize };
const warp = { ...size, filter: warpFilter, edge: address };
const connectivity = property('number', oneOf(4, 8), 4);
const dimension = { constraints: { integer: true, min: 1, max: 8192 } };

const ports = {
  'array.broadcast': { mode: oneOf('zip', 'cycle', 'hold', 'cartesian', 'cartesianReverse'), limit: limit(1, 100000, true) },
  'array.sort': { direction: oneOf('asc', 'desc') },
  'raster.canvas': { width: dimension, height: dimension,
    color: { unit: 'byte levels', constraints: { lengths: [3, 4], min: 0, max: 255 } } },
  'raster.math': { op: oneOf('add', 'subtract', 'multiply', 'divide', 'min', 'max', 'difference', 'power', 'greater', 'less', 'equal') },
  'draw.render': { edges: oneOf('smooth', 'hard') },
  'warp.field': { width: dimension, height: dimension, matrix: { constraints: { length: 2, rows: 'Two affine rows of three values' } } },
  'warp.opticalFlow': { value: { unit: 'pixels', constraints: { channels: [2, 2] } },
    confidence: { unit: 'ratio', constraints: { channels: [1, 1], min: 0, max: 1 } } },
  'warp.cameraMotion': { value: unit('pixels'), camera: unit('pixels'),
    motion: { unit: 'pixels', constraints: { channels: [2, 2], min: -16384, max: 16384 } } },
  'warp.flow': { motion: { unit: 'pixels', constraints: { channels: [2, 2], min: -16384, max: 16384 } } },
  'warp.flowPoints': { points: unit('pixels'), value: unit('pixels'),
    motion: { unit: 'pixels', constraints: { channels: [2, 2], min: -16384, max: 16384 } } },
  'warp.morph': { amount: { unit: 'ratio', ...limit(0, 1) } },
  'proc.reaction': { steps: { unit: 'iterations', constraints: { integer: true, min: 0 } } },
  'proc.horizon': { bands: { constraints: { minItems: 1, maxItems: 16 } } },
  'scene.light': { kind: oneOf('sun', 'point', 'rectangle', 'disk', 'line') },
  'scene.world': { objects: { constraints: { minItems: 1, maxItems: 32 } } },
  'scene.render': { renderGraphCapture: { constraints: { maxItems: 33, uniqueItems: true } } },
  'audio.buffer': { sampleRate: { unit: 'Hz', ...limit(1, 768000, true) },
    channels: { unit: 'channels', ...limit(1, 64, true) },
    samples: { unit: 'normalized amplitude', constraints: { min: -1, max: 1, maxItems: 32000000 } } },
  'sim.define': { kind: oneOf('particles', 'cloth', 'strand', 'smoke', 'grain', 'rigid', 'flip', 'feedback') },
  'music.clock': { beat: unit('beats'), bar: { unit: 'bar index', constraints: { integer: true } },
    phrase: { unit: 'phrase index', constraints: { integer: true } } },
  'audio.analyze': { rms: unit('normalized amplitude'), peak: unit('normalized amplitude') },
  'warp.frames': { fps: rate, times: seconds },
  'fx.trackRegions': { time: seconds, frame: { unit: 'frame', constraints: { integer: true, min: 0 } } },
  'anim.frame': { time: seconds, index: { unit: 'frame', constraints: { integer: true, min: 0 } } },
  'anim.clock': { value: seconds, progress: { unit: 'ratio', ...limit(0, 1) }, direction: oneOf(-1, 1) },
  'anim.stagger': { count: { unit: 'items', ...limit(0, 8192, true) }, value: seconds },
  'anim.keyframes': { keys: { constraints: { minItems: 1, maxItems: 8192 } }, duration: seconds },
  'proc.path': { length: unit('source coordinate units') },
  'proc.cable': { length: unit('world units'), start: unit('world units'), end: unit('world units') },
  'geo.tube': { start: unit('world units'), end: unit('world units') },
  attributeTransfer: { domain: oneOf('vertex', 'face', 'point', 'curve', 'instance', 'splat') },
  time: { value: seconds },
  random: { value: { constraints: { min: 0, exclusiveMax: 1 } } }
};

const clock = { time: sampleTime, range: property('vec2', seconds, [0, 1]),
  rate: property('number', limit(1e-5, 1e5), 1), delay: property('number', seconds, 0),
  reverse: property('boolean', {}, false), mode };
const options = {
  'raster.channel': { channel: property('number|string', {}, 0) },
  'raster.crop': { x: property('number', pixelOffset), y: property('number', pixelOffset), ...size },
  'raster.resize': { ...size, filter: property('string', oneOf('nearest', 'bilinear'), 'nearest'),
    premultiply: property('boolean', {}, true) },
  'raster.nineSlice': { ...size, insets: property('array<number>', { unit: 'pixels', constraints: { length: 4 } }),
    fill: property('string', oneOf('stretch', 'repeat'), 'stretch') },
  'raster.floodFill': { seed: property('vec2', { unit: 'pixels', constraints: { integer: true, inBounds: true } }),
    tolerance: property('number', limit(0, 255), 0), connectivity, color: property('string|array', {}, '#ffffff') },
  'raster.components': { connectivity, threshold: property('number', {}, 1),
    minArea: property('number', { unit: 'pixels', constraints: { integer: true, min: 1 } }, 1), invert: property('boolean', {}, false) },
  'layout.place': { fit: property('string', oneOf('contain', 'cover', 'stretch', 'none'), 'contain'),
    align: property('vec2', limit(0, 1), [.5, .5]), clip: property('boolean', {}, true) },
  'draw.trackedAnchors': { time: sampleTime },
  'fx.regionObservations': { fps: sampleRate, contours: property('boolean', {}, false) },
  'motion.landmarks': { time: sampleTime },
  'fx.pathBlur': { samples: property('number', limit(2, 128, true), 13),
    anchor: property('string', oneOf('start', 'center', 'end'), 'start'),
    falloff: property('string', oneOf('uniform', 'start', 'end'), 'uniform'), filter: warpFilter },
  'fx.outline': { outer: property('number', pixelRange(0, 128), 1), inner: property('number', pixelRange(0, 128), 0),
    feather: property('number', pixelRange(0, 128), 0) },
  'fx.bevel': { width: property('number', { unit: 'pixels', constraints: { exclusiveMin: 0, max: 128 } }, 3),
    direction: property('vec2', { constraints: { nonzero: true } }, [-1, -1]),
    strength: property('number', limit(0, 1), .8) },
  'fx.glow': { radius: property('number', unit('pixels'), 5), threshold: property('number', {}, 1),
    strength: property('number', limit(0, 16), 1.2), color: property('string', {}, '#ffc476'),
    mode: property('string', oneOf('normal', 'screen', 'add'), 'screen'),
    placement: property('string', oneOf('behind', 'over'), 'behind') },
  'fx.erode': { radius: property('number', pixelRange(0, 128), 1) },
  'fx.bitplane': { bit: property('number', limit(0, 7, true), 0), mode: property('string', oneOf('flip', 'clear', 'borrow'), 'flip') },
  'fx.paletteFault': { swaps: property('array', { constraints: { entries: 'Nonoverlapping pairs of distinct palette slots' } }, []) },
  'warp.sample': { filter: warpFilter, edge: address }, 'warp.mesh': warp, 'warp.grid': warp, 'warp.morph': warp,
  'warp.opticalFlow': { direction: property('string', oneOf('forward', 'backward'), 'forward'),
    levels: property('number', limit(1, 7, true), 4), radius: property('number', { unit: 'pixels', ...limit(1, 12, true) }, 4),
    iterations: property('number', limit(1, 10, true), 5),
    maxMotion: property('number', { unit: 'pixels', constraints: { exclusiveMin: 0, max: 1024 } }, 64) },
  'warp.cameraMotion': { model: property('string', oneOf('translation', 'similarity'), 'similarity'),
    minConfidence: property('number', limit(0, 1), .2), threshold: property('number', pixelRange(.01, 100), 1.35),
    maxSamples: property('number', limit(2, 4096, true), 1024), iterations: property('number', limit(1, 1024, true), 192) },
  'warp.timeRemap': { fps: sampleRate, times: property('array<number>', seconds),
    mode: property('string', oneOf('offset', 'absolute'), 'offset'),
    playback: mode, interpolation: property('string', oneOf('step', 'nearest', 'linear'), 'linear'),
    bias: property('number', seconds, 0), scale: property('number', {}, 1) },
  'warp.surface': { alphaThreshold: property('number', limit(1, 255, true), 128) },
  'proc.sample': size,
  'proc.repeat': { ...size, offset: property('vec2', unit('pixels'), [0, 0]), scale: property('vec2', {}, [1, 1]) },
  'proc.reaction': { width: property('number', positivePixels, 64), height: property('number', positivePixels, 48) },
  'proc.pattern': { size: property('number|vec2', { unit: 'world units', ...limit(1e-7, 1e7) }, 8),
    angle: property('number', unit('radians'), 0), fill: property('number', limit(0, 1), .5),
    axes: property('string', oneOf('xy', 'xz', 'yz'), 'xy'),
    kind: property('string', oneOf('checker', 'stripes', 'dots', 'rings', 'brick', 'chevrons'), 'checker') },
  'geo.scrambleIndices': { amount: property('number', limit(0, 1), .12), maxFaces: property('number', limit(0, 4096, true), 128),
    minDisplacement: property('number', unit('world units'), 0),
    maxDisplacement: property('number', { unit: 'world units', ...limit(1e-6, 4e6) }) },
  'scene.camera': { projection: property('string', oneOf('perspective', 'orthographic')),
    yaw: property('number', unit('radians')), pitch: property('number', unit('radians')), dist: property('number', unit('world units')) },
  'scene.render': { width: property('number', { ...positivePixels, ...limit(1, 2048, true) }, 128),
    height: property('number', { ...positivePixels, ...limit(1, 2048, true) }, 128), time: sampleTime },
  'anim.clock': clock,
  'anim.stagger': { ...clock, interval: property('number', { ...seconds, ...limit(0, 1200) }, .1) },
  'anim.retime': clock,
  'anim.frame': { fps: sampleRate, mode,
    first: property('number', { unit: 'frame', constraints: { integer: true, min: 0 } }, 0) },
  'audio.detectTransients': { size: property('number', { unit: 'samples', ...limit(16, 8192, true) }),
    hop: property('number', { unit: 'samples', constraints: { integer: true, min: 1 } }),
    minGap: property('number', { ...seconds, ...limit(0, 10) }, .075),
    minStrength: property('number', limit(.000001, 100), .035), sensitivity: property('number', limit(0, 20), 2.5),
    channel: property('number|string', {}, 'all'), name: property('string', {}, 'Hit') },
  'audio.editEvents': { exact: property('boolean', {}, false) },
  'music.clock': { time: property('number|record', seconds) },
  'audio.window': { time: sampleTime, padding: property('string', oneOf('zero', 'trim'), 'zero') },
  'audio.fft': { time: sampleTime, window: property('string', oneOf('rect', 'hann', 'hamming', 'blackman'), 'hann') },
  densityMesh: { time: property('number', seconds, 0), resolution: property('number', unit('world units'), .12),
    iso: property('number', { constraints: { exclusiveMin: 0 } }, .5) },
  densityPoints: { time: property('number', seconds, 0), radius: property('number', unit('world units'), .18) }
};
const simulationClock = { dt: property('number', { ...seconds, ...limit(.001, .1) }, 1 / 48),
  maxTicks: property('number', limit(1, 12000, true), 2400) };

const specialization = {
  'array.map': { field: 'group', description: 'The group declares item, optional numeric index and value. Extra group inputs become ports.' },
  'array.filter': { field: 'group', description: 'The group returns a boolean value. Extra group inputs become ports.' },
  'array.reduce': { field: 'group', description: 'The group declares item and accumulator, and returns a compatible value. Initial uses the accumulator type.' },
  'array.sort': { field: 'group', optional: true, description: 'Optional group returns a numeric or string key. With no group the items are their own keys.' },
  'data.typed': { field: 'type', description: 'The declared graph type becomes the type of the value input and output.' },
  'data.record': { field: 'inputs', description: 'Input names are the record keys you declare on the node.' },
  'anim.retime': { field: 'group', description: 'Uses the group’s inputs and outputs and adds a timing record. The group cannot declare timing.' }
};
const notes = {
  'raster.canvas': ['Width × height may not exceed 16,777,216 pixels.'],
  'raster.crop': ['The requested rectangle must fit inside the source.'],
  'raster.resize': ['Width × height may not exceed 16,777,216 pixels.'],
  'raster.nineSlice': ['Insets are left, top, right, bottom and must fit source and destination.'],
  'warp.field': ['Width × height may not exceed 4,000,000 pixels.'],
  'warp.opticalFlow': ['The two rasters must have matching dimensions and no more than 500,000 pixels each.'],
  'warp.cameraMotion': ['Confidence and masks, when supplied, must align with the motion raster and have one channel.'],
  'warp.sample': ['Field samples have U, V and optional coverage channels, on a normalized image grid.'],
  'warp.timeRemap': ['Use 1–512 same-sized frames. Explicit times increase from zero and align with the frame array.'],
  'scene.render': ['Width × height may not exceed 1,048,576 pixels.',
    'renderGraphInputs maps render-graph slot names to rasters. renderGraphCapture lists screen pass IDs to keep.'],
  'scene.pass': ['Capture native channels in scene.render.channels and screen pass IDs in scene.render.renderGraphCapture.',
    'Use graph:<id> for a captured screen pass. Color is always available.'],
  'audio.buffer': ['The interleaved sample count must be a multiple of channels.'],
  'fx.bitplane': ['Source carries one palette slot per pixel. Borrow mode requires an aligned donor bank.'],
  'fx.paletteFault': ['Source carries one palette slot per pixel. Swap rules and stuck rules may not overlap.'],
  'data.get': ['The key must exist in the input record.'],
  'data.collect': ['All requested keys must exist in the input record.']
};

function socketDetails(id, name, type, input) {
  const base = types[type] ?? (type.startsWith('array<') ? { items: type.slice(6, -1) } : {});
  const dimension = input && type === 'number' && (name === 'width' || name === 'height') ? positivePixels : {};
  const details = Object.hasOwn(ports, id) && Object.hasOwn(ports[id], name) ? ports[id][name] : {};
  const properties = !input ? undefined : id === 'sim.define' && name === 'clock' ? simulationClock :
    (name === 'options' || name === 'timing') && Object.hasOwn(options, id) ? options[id] : undefined;
  return { unit: details.unit ?? dimension.unit ?? null,
    constraints: { ...base, ...dimension.constraints, ...details.constraints }, ...(properties && { properties }) };
}

module.exports = { socketDetails, specialization, notes };
