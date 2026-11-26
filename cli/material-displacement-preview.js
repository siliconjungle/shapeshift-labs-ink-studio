const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const files = require('./asset-files.js');

const format = 'ink-studio/displacement-preview';
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));
const range = (n, min, max) => Number.isFinite(n) && min <= n && n <= max;
const integer = (n, min, max) => Number.isSafeInteger(n) && range(n, min, max);
const pair = (row, validate) => Array.isArray(row) && row.length === 2 && Array.from(row).every(validate);
const id = n => typeof n === 'string' && /^[a-z][\w.-]{0,63}$/i.test(n);
const text = n => typeof n === 'string' && !!n.trim() && n.length <= 140 && !/[\x00-\x1f]/.test(n);
const modes = ['flat', 'parallax', 'relief'];

function prepare(plan) {
  if (!fields(plan, ['format', 'version', 'label', 'source', 'maps', 'settings', 'cameras', 'view']) ||
      plan.format !== format || plan.version !== 1 || !text(plan.label) ||
      (plan.source === undefined) === (plan.maps === undefined))
    throw new TypeError('Supply a version 1 displacement preview plan and one graph source or map collection');
  const watches = plan.source !== undefined ? { source: plan.source } : plan.maps;
  if (plan.maps !== undefined && (!fields(plan.maps, ['height', 'baseColor', 'normal']) || !plan.maps.height) ||
      !Object.values(watches).every(watch => fields(watch, ['output', 'map']) && Object.keys(watch).length === 1 &&
        id(watch.output ?? watch.map)))
    throw new TypeError('Displacement preview requires a height output, material packet or named height map');
  const options = plan.settings ?? {}, view = plan.view ?? {};
  const { scale, bias, tessellation = [64, 48], reference = [112, 80], tangent,
    seam = 'clamp', seamWidth = .07, repeats = [1, 1], steps = 48, tileSize = [2.4, 1.65] } = options;
  if (!fields(options, ['scale', 'bias', 'tessellation', 'reference', 'tangent',
    'seam', 'seamWidth', 'repeats', 'steps', 'tileSize']) ||
      scale !== undefined && !range(scale, -100, 100) || bias !== undefined && !range(bias, -1e5, 1e5) ||
      !pair(tessellation, n => integer(n, 1, 160)) || !pair(reference, n => integer(n, 1, 160)) ||
      !pair(repeats, n => integer(n, 1, 2)) || !pair(tileSize, n => range(n, .1, 10)) ||
      tangent !== undefined && !['opengl', 'directx'].includes(tangent) ||
      !['clamp', 'repeat', 'fade'].includes(seam) || !range(seamWidth, .005, .24) || !integer(steps, 12, 96))
    throw new RangeError('Invalid displacement amplitude, tessellation, tangent convention or seam parameters');
  const { width = 344, height = 238, profilePixels = 10, profileFraction = .01, colorRmse = 5.5 } = view;
  if (!fields(view, ['width', 'height', 'profilePixels', 'profileFraction', 'colorRmse']) ||
      !integer(width, 96, 512) || !integer(height, 72, 384) || !integer(profilePixels, 0, 32768) ||
      !range(profileFraction, 0, .5) || !range(colorRmse, 0, 64) || !Array.isArray(plan.cameras) || !integer(plan.cameras.length, 1, 8) ||
      plan.cameras.length * width * height > 900000)
    throw new RangeError('Invalid displacement native grid, tolerance or camera work budget');
  const cameras = Array.from(plan.cameras, row => {
    if (!fields(row, ['id', 'label', 'distance', 'yaw', 'pitch', 'fov', 'projection']))
      throw new TypeError('Expected a displacement camera preset');
    const { id: name, label, distance, yaw = 0, pitch = 12, fov = 39, projection = 'perspective' } = row;
    if (!id(name) || !text(label) || !range(distance, .25, 120) || !range(yaw, -82, 82) ||
        !range(pitch, -82, 82) || !range(fov, 15, 84) || !['perspective', 'orthographic'].includes(projection))
      throw new RangeError('Camera presets need a label, positive distance, and forward-facing angles in degrees');
    return { id: name, label, distance, yaw, pitch, fov, projection };
  });
  if (new Set(cameras.map(row => row.id)).size !== cameras.length) throw new RangeError('Duplicate displacement camera ID');
  return { label: plan.label, watches, cameras, view: { width, height, profilePixels, profileFraction, colorRmse },
    settings: { scale, bias, tessellation, reference, tangent, seam, seamWidth, repeats, steps, tileSize } };
}

function image(P, value, name, intents) {
  if (!P.graphImages.valid(value) || !intents.includes(value.descriptor.intent) ||
      value.raster.width > 1024 || value.raster.height > 1024)
    throw new TypeError('Displacement ' + name + ' needs a matching typed graph image up to 1024 × 1024');
  return value;
}

const scaleOf = value => ({ unorm8: 255, unorm16: 65535 })[value.descriptor.precision] ?? 1;
function wire(data, width, height, extra = {}) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { width, height, ...extra, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}

function packHeight(P, value) {
  const { raster: { width, height, channels, data }, descriptor } = image(P, value, 'height', ['height', 'data', 'mask']);
  if (channels !== 1) throw new TypeError('Displacement needs one height channel');
  let min = Infinity, max = -Infinity;
  const divisor = scaleOf(value), bytes = Buffer.alloc(data.length * 4);
  for (let p = 0; p < data.length; p++) {
    const z = Math.fround(data[p] / divisor);
    if (!range(z, -1e5, 1e5)) throw new RangeError('Displacement height exceeds the preview sample range');
    min = Math.min(min, z);
    max = Math.max(max, z);
    bytes.writeFloatLE(z, p * 4);
  }
  return wire(bytes, width, height, { min, max, units: descriptor.units, encoding: 'float32-le' });
}

function packPigment(P, value) {
  const { width, height, channels, data } = P.graphImages.toDisplay(image(P, value, 'base color', ['color']));
  const pixels = new Uint8Array(width * height * 4);
  for (let p = 0, i = 0; p < width * height; p++, i += channels)
    pixels.set([data[i], data[i + 1], data[i + 2], channels === 4 ? data[i + 3] : 255], p * 4);
  return wire(pixels, width, height, { encoding: 'srgb8-alpha8' });
}

function packNormal(P, value) {
  const { raster: { width, height, channels, data }, descriptor } = image(P, value, 'normal', ['normal']);
  if (descriptor.normalSpace === 'world') throw new TypeError('Displacement preview needs a tangent normal image');
  const divisor = scaleOf(value), pixels = new Uint8Array(width * height * 4);
  for (let p = 0, i = 0; p < width * height; p++, i += channels) {
    const alpha = descriptor.alpha === 'none' ? 1 : data[i + 3] / divisor;
    const gain = descriptor.alpha === 'premultiplied' ? alpha : 1;
    for (let c = 0; c < 3; c++) {
      const raw = gain ? data[i + c] / (gain * divisor) : 0;
      const n = !gain ? Number(c === 2) : descriptor.domain === 'unit' ? raw * 2 - 1 : raw;
      pixels[p * 4 + c] = Math.round(128 + 127 * Math.min(1, Math.max(-1, n)));
    }
    pixels[p * 4 + 3] = 255;
  }
  return wire(pixels, width, height, { encoding: 'tangent-rgba8', tangent: descriptor.normalOrientation ?? 'opengl' });
}

async function createDisplacementPreview(project, plan, { toolkit = require('../index.js').load(), run = {} } = {}) {
  const { watches, view, cameras, label, settings } = prepare(plan);
  const P = toolkit.KIT.procedural;
  const evaluated = await project.previewFrame(watches, run, { encodeArtifacts: false });
  if (!evaluated.report.passed) throw new RangeError('Graph assertions failed during displacement preview');
  const packet = evaluated.values.source;
  const maps = packet === undefined ? evaluated.values : P.materialChannels.valid(packet) ?
    Object.fromEntries(Object.entries(packet.channels).map(([name, row]) => [name, row.raster])) : { height: packet };
  const height = packHeight(P, maps.height), baseColor = maps.baseColor && packPigment(P, maps.baseColor);
  const normal = maps.normal && packNormal(P, maps.normal);
  const maxScale = Math.min(100, 4 * Math.max(...settings.tileSize) / Math.max(height.max - height.min, .0001));
  const bias = settings.bias ?? height.min;
  const scale = settings.scale ?? Math.min(maxScale, .23 / Math.max(height.max - height.min, .001));
  const tangent = settings.tangent ?? normal?.tangent ?? 'opengl';
  if (Math.max(Math.abs((height.min - bias) * scale), Math.abs((height.max - bias) * scale)) > 40)
    throw new RangeError('Configured displacement exceeds the 40-unit preview bound');
  return { format, version: 1, label, modes, view, cameras, settings: { ...settings, scale, bias, tangent },
    controls: { maxScale }, maps: { height, ...(baseColor && { baseColor }), ...(normal && { normal }) } };
}

async function writeDisplacementPreview(project, filename, { directory, toolkit, run, sources = [] } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Displacement preview needs --out directory');
  const plan = path.resolve(filename), folder = path.resolve(directory);
  const data = await createDisplacementPreview(project, JSON.parse(fs.readFileSync(plan, 'utf8')), { toolkit, run });
  const report = { ...data, maps: Object.fromEntries(Object.entries(data.maps).map(([name, { data, ...info }]) => [name, info])) };
  const pathOf = name => path.join(__dirname, name);
  const entries = new Map([
    ['index.html', fs.readFileSync(pathOf('displacement-preview.html'))],
    ['shaders.js', fs.readFileSync(pathOf('displacement-preview-shaders.js'))],
    ['renderer.js', fs.readFileSync(pathOf('displacement-preview-render.js'))],
    ['live.js', fs.readFileSync(pathOf('displacement-preview.browser.js'))],
    ['camera-lens.js', fs.readFileSync(pathOf('../src/camera-lens.js'))],
    ['textured-surface.js', fs.readFileSync(pathOf('../src/textured-surface.js'))],
    ['data.js', 'const displacementPreview = ' + JSON.stringify(data) + ';\n'],
    ['preview.json', JSON.stringify(report, null, 2) + '\n']
  ]);
  const inputs = new Set([...sources, ...project.sourceFiles(), plan].map(file => path.resolve(file)));
  if ([...entries.keys()].some(file => inputs.has(path.join(folder, file))))
    throw new RangeError('Choose a preview directory that keeps the graph and plan intact');
  for (const [name, data] of entries) files.write(path.join(folder, name), data);
  return { file: path.join(folder, 'index.html'), ...report };
}

module.exports = { createDisplacementPreview, writeDisplacementPreview };
