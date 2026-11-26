'use strict';

const fs = require('node:fs');
const Footprints = require('../src/splat-footprints.js');
const Provenance = require('../src/splat-provenance.js');
const { maxRows } = require('./splat-attribute-plan.js');

const format = 'ink-studio/splat-exchange';
const suffix = /\.inksplats$/i;
const shades = [['normals', 3, Float32Array], ['shadingNormals', 3, Float32Array],
  ['objectIds', 1, Uint32Array], ['targetIds', 1, Uint32Array], ['materialIds', 1, Uint32Array]];
const harmonics = [['dc', 3, Float32Array], ['normals', 3, Int8Array], ['linear', 1, Uint8Array],
  ['available', 1, Uint8Array]];
const metadataKeys = ['objects', 'targets', 'materials'];
const worldKeys = ['radius', 'pal', 'palName', 'bg', 'seed', 'detail', 'cam', 'dither', 'fog', 'outline',
  'gaussianCloud', 'gaussianSort'];
const unsupported = ['anim', 'rest', 'meshes', 'pix', 'fine', 'attr', 'surfaceData', 'curveClips', 'curveLod',
  'effectParticles', 'sortRanges', 'spriteSurfaces', 'spriteAtlases', 'reconstructionPose', 'renderSdfs', 'referenceSdfs',
  'engravings', 'engraving', 'paintDecals', 'paintCorrections', 'splatBakedEmission', 'opticalSplats', 'shadowLod',
  'splatRoughness', 'areaLights', 'liveSun', 'fogVolumes', 'volumes', 'tilesets', 'reflections', 'cameraRig'];
const maxBytes = 96 * 1024 ** 2;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const present = value => value && (value.length === undefined || value.length > 0);
const known = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));

function read(file, limit = maxBytes) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new RangeError('Invalid or over-budget splat input ' + file);
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) throw new RangeError('Splat input exceeds its byte limit');
    return JSON.parse(bytes);
  } finally {
    fs.closeSync(fd);
  }
}

function columns(obj, desc, count) {
  return Object.fromEntries(desc.flatMap(([name, stride, Type]) => {
    const data = obj[name];
    if (data === undefined) return [];
    const ok = Type === Float32Array ? n => Number.isFinite(Math.fround(n)) : n => Number.isInteger(n) &&
      (Type === Int8Array ? n >= -127 && n <= 127 : n >= 0 && n <= (Type === Uint32Array ? 0xffffffff : 1));
    if (!(Array.isArray(data) || data instanceof Type) || data.length !== count * stride || !data.every(ok))
      throw new RangeError('Invalid splat exchange column ' + name);
    return [[name, Array.isArray(data) ? Type.from(data) : Array.from(data)]];
  }));
}

function checkStatic(world) {
  const excess = unsupported.find(key => present(world[key]));
  const { splatFit, ...look } = world.look ?? {};
  if (excess || world.moving?.length || world.back?.length || Object.keys(look).length)
    throw new RangeError('Splat exchange needs a static, textureless Gaussian scene. Unsupported channel: ' +
      (excess ?? (world.moving?.length || world.back?.length ? 'moving/back rows' : 'look')));
  const meta = world.renderMetadata ?? {};
  const extra = Object.keys(meta).find(key => ![...metadataKeys, ...shades.map(row => row[0])].includes(key) && present(meta[key]));
  if (extra) throw new RangeError('Unsupported splat exchange render metadata: ' + extra);
  for (let i = 0; i < world.count; i++) {
    const q = i * 16;
    if (world.data[q + 11] !== 0 || [3,4,8,10].some(k => world.data[q + k] < 0))
      throw new RangeError('Splat exchange needs nonnegative opacity and covariance diagonals without special draw flags');
  }
}

function serialize(world, attributes) {
  checkStatic(world);
  const { count, data, gaussianHarmonics: scan, splatLodProtected, materialAlbedo, renderMetadata: meta = {} } = world;
  const fitFootprints = Footprints.validate(world);
  const ids = Provenance.identities(world);
  const object = { format, version: 1, count, settings: known(world, worldKeys), data: Array.from(data.subarray(0, count * 16)),
    ids: Array.from({ length: count }, (_, i) => ids.idAt(i)), attributes,
    metadata: { ...known(meta, metadataKeys), ...columns(meta, shades, count) },
    ...(materialAlbedo && { materialAlbedo: Array.from(materialAlbedo.subarray(0, count)) }),
    ...(splatLodProtected && { splatLodProtected: Array.from(splatLodProtected) }),
    ...(fitFootprints && { footprints: { styles: fitFootprints.styles, indices: Array.from(fitFootprints.indices),
      ...(fitFootprints.frames && { frames: Array.from(fitFootprints.frames) }) } }),
    ...(scan && { scan: { degree: scan.degree, up: scan.up, colorMode: scan.colorMode,
      ...columns(scan, [...harmonics, ['sh', 3 * ((scan.degree + 1) ** 2 - 1), Float32Array]], count) } }) };
  return object;
}

function open(document, api, kit) {
  const { count, ids, settings, metadata, scan, footprints, attributes } = document ?? {};
  if (document?.format !== format || document.version !== 1 || !Number.isSafeInteger(count) || count < 1 || count > maxRows ||
      !Array.isArray(ids) || ids.length !== count || !Array.from(ids).every(Provenance.validId) || new Set(ids).size !== count ||
      !record(settings) || ![settings.cam,settings.fog,settings.outline].every(record) || !Array.isArray(settings.pal) ||
      !settings.pal.length || settings.pal.length > 256 || !settings.pal.every(n => Number.isSafeInteger(n) && n >= 0 && n < 2**24) ||
      !Number.isFinite(settings.radius) || settings.radius <= 0 || !record(metadata) ||
      metadataKeys.some(key => metadata[key] !== undefined && (!Array.isArray(metadata[key]) || metadata[key].length > maxRows + 1)))
    throw new RangeError('Invalid or over-budget Ink splat exchange');
  const A = kit.procedural.attributes, table = A.open(attributes);
  if (table.domain !== 'splat' || table.entities.length !== count || table.channels.size > 105 ||
      !table.entities.every(({ id }, i) => id === ids[i]))
    throw new RangeError('Splat exchange attributes must follow the exported row IDs');
  const geometry = columns(document, [['data', 16, Float32Array], ['materialAlbedo', 1, Uint32Array],
    ['splatLodProtected', 1, Uint8Array]], count);
  if (!geometry.data) throw new RangeError('Splat exchange needs packed data');
  const world = { ...known(settings, worldKeys), count, ...geometry, splatIds: ids.slice(), proceduralSplatAttributes: attributes,
    renderMetadata: { ...known(metadata, metadataKeys), ...columns(metadata, shades, count) },
    back: new Int32Array(), moving: new Int32Array() };
  if (!table.entities.every(({ point }, i) => point.every((n, k) => n === world.data[i * 16 + k])))
    throw new RangeError('Splat exchange attributes must use the exported positions');
  if (footprints !== undefined) {
    const { indices, styles, frames } = footprints ?? {};
    if (!Array.isArray(indices) || indices.length !== count || indices.some(n => !Number.isSafeInteger(n) || n < 0 || n > Footprints.maxStyles))
      throw new RangeError('Invalid splat exchange footprint slots');
    const layout = columns({ frames }, [['frames', 6, Float32Array]], count);
    world.splatFootprints = Footprints.layout(count, styles, Uint16Array.from(indices), layout.frames);
  }
  if (scan !== undefined) {
    const { degree, up, colorMode } = scan ?? {};
    if (!Number.isInteger(degree) || degree < 0 || degree > 4 || !['y', 'z'].includes(up) || !['rgb', 'palette'].includes(colorMode))
      throw new RangeError('Invalid splat exchange directional settings');
    const decoded = columns(scan, [...harmonics, ['sh', 3 * ((degree + 1) ** 2 - 1), Float32Array]], count);
    if (!decoded.dc || !decoded.sh) throw new RangeError('Missing splat exchange directional color');
    world.gaussianHarmonics = { count, degree, up, colorMode, ...decoded };
    world.gaussianAppearanceDelta = api.gaussianAppearanceDelta;
    world.gaussianHarmonicRotation = api.gaussianHarmonicRotation;
  }
  checkStatic(world);
  return world;
}

async function load(file, kit) {
  return open(read(file), await import('../src/gaussian-splats.mjs'), kit);
}

module.exports = { format, suffix, read, serialize, load, checkStatic };
