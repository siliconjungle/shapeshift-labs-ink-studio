import * as sharedCodec from './splat-codec.js';

export const gaussianChunkSchema = 'ink.gaussian-chunks.v1';
export const gaussianRecordFloats = 16;
export const gaussianRecordBytes = gaussianRecordFloats * Float32Array.BYTES_PER_ELEMENT;

const finite = Number.isFinite;
const xyz = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const half = Math.sqrt(2 * Math.log(2));
const codec = sharedCodec.default ?? globalThis[Symbol.for('ink-studio.splat-codec')];
const filename = /^[a-zA-Z0-9_-]+\.(?:bin|irc)$/;
const losslessOptions = Object.freeze({ maxPositionError: 0, maxCovarianceError: 0 });
const covarianceFields = [4, 5, 6, 8, 9, 10];
const color = (value, channel) => value >>> (channel * 8) & 255;
const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

export function gaussianChunkData(input, count) {
  if (!(input instanceof ArrayBuffer) || input.byteLength !== count * gaussianRecordBytes)
    throw new RangeError('Gaussian chunk byte length does not match its manifest');
  if (littleEndian) return new Float32Array(input);
  const source = new DataView(input), values = new Float32Array(count * gaussianRecordFloats);
  for (let i = 0; i < values.length; i++) values[i] = source.getFloat32(i * 4, true);
  return values;
}

export function decodeGaussianChunkPayload(bytes, count, encoding) {
  return encoding === 'irc1'
    ? codec.decode(bytes, { expectedCount: count }).data
    : gaussianChunkData(bytes.buffer, count);
}

function validPayload(level) {
  const { file, encoding, payloadBytes, splats } = level;
  if (typeof file !== 'string' || !filename.test(file)) return false;
  if (encoding === undefined && payloadBytes === undefined) return file.endsWith('.bin');
  if (!Number.isSafeInteger(payloadBytes)) return false;
  if (encoding === 'raw') return file.endsWith('.bin') && payloadBytes === splats * gaussianRecordBytes;
  return encoding === 'irc1' && file.endsWith('.irc') &&
    payloadBytes > 8 && payloadBytes <= codec.maxEncodedBytes(splats);
}

function setBounds(bounds, data, shaped) {
  for (let i = 0; i < data.length; i += gaussianRecordFloats) {
    for (const [axis, field] of [4, 8, 10].entries()) {
      const radius = (shaped && data[i+11] ? data[i+12] : 3) * Math.sqrt(Math.max(0, data[i + field]));
      bounds.min[axis] = Math.min(bounds.min[axis], data[i + axis] - radius);
      bounds.max[axis] = Math.max(bounds.max[axis], data[i + axis] + radius);
    }
  }
}

// Moment matching retains the direction and spread of a group. Optical
// thickness is averaged over that larger footprint rather than summing alpha.
function coarsen(source, voxel, protect) {
  const groups = new Map();
  for (let i = 0; i < source.length; i += gaussianRecordFloats) {
    const [x, y, z] = source.subarray(i, i + 3);
    const row=i/gaussianRecordFloats;
    const key = protect[row] ? 'row:'+row : [x, y, z].map(n => Math.floor(n / voxel)).join(',');
    let group = groups.get(key);
    if (!group) {
      group = { origin: [x, y, z], sum: new Float64Array(13), indices: [] };
      groups.set(key, group);
    }
    const { origin, sum, indices } = group;
    indices.push(i);
    const dx = x - origin[0], dy = y - origin[1], dz = z - origin[2];
    const terms = [dx * dx, dx * dy, dx * dz, dy * dy, dy * dz, dz * dz];
    sum[0] += dx;
    sum[1] += dy;
    sum[2] += dz;
    covarianceFields.forEach((field, k) => { sum[3 + k] += source[i + field] + terms[k]; });
    const alpha = Math.min(.99, Math.max(0, source[i + 3]));
    const footprint = Math.max(1e-12, source[i + 4] + source[i + 8] + source[i + 10]);
    const weight = Math.max(1e-10, alpha * footprint);
    for (let c = 0; c < 3; c++) sum[9 + c] += color(source[i + 7], c) * weight;
    sum[12] += weight;
    group.thickness = (group.thickness ?? 0) - Math.log1p(-alpha) * footprint;
  }
  const data = new Float32Array(groups.size * gaussianRecordFloats);
  let error = 0, offset = 0;
  for (const { origin, sum, indices, thickness } of groups.values()) {
    if (indices.length === 1) {
      data.set(source.subarray(indices[0], indices[0] + gaussianRecordFloats), offset);
    } else {
      const count = indices.length, x = sum[0] / count, y = sum[1] / count, z = sum[2] / count;
      data.set([origin[0] + x, origin[1] + y, origin[2] + z], offset);
      const terms = [x * x, x * y, x * z, y * y, y * z, z * z];
      covarianceFields.forEach((field, k) => { data[offset + field] = sum[3 + k] / count - terms[k]; });
      const footprint = Math.max(1e-12, data[offset + 4] + data[offset + 8] + data[offset + 10]);
      data[offset + 3] = Math.min(.99, -Math.expm1(-thickness / footprint));
      for (let c = 0; c < 3; c++) data[offset + 7] += Math.round(sum[9 + c] / sum[12]) << (c * 8);
      for (const at of indices) {
        error = Math.max(error, Math.hypot(source[at] - data[offset],
          source[at + 1] - data[offset + 1], source[at + 2] - data[offset + 2]));
      }
    }
    offset += gaussianRecordFloats;
  }
  return { data, error };
}

export function packGaussianChunks(world, { cellSize = 2, voxelSizes = [.2, .1, .05, 0], layer = 'main',
  previousFootprints = [], encoding = 'raw', lossless = false } = {}) {
  const { count, data, cam, radius, bg } = world ?? {};
  if (!Number.isSafeInteger(count) || count < 0 || !(data instanceof Float32Array) || data.length !== count * gaussianRecordFloats)
    throw new TypeError('Expected a packed imported Gaussian world');
  if (!finite(cellSize) || cellSize <= 0 || !Array.isArray(voxelSizes) || !voxelSizes.length ||
      voxelSizes.length > 16 || voxelSizes.at(-1) !== 0 || !voxelSizes.every(n => finite(n) && n >= 0) ||
      voxelSizes.slice(1, -1).some((size, i) => size === 0 || !Number.isInteger(voxelSizes[i] / size) || voxelSizes[i] / size < 2) ||
      voxelSizes.length > 1 && !voxelSizes[voxelSizes.length - 2] ||
      typeof layer !== 'function' && !validId(layer))
    throw new RangeError('Gaussian chunk packing needs a positive cell size, nested voxel sizes ending in zero, and a layer ID');

  if (!['raw', 'irc1'].includes(encoding) || typeof lossless !== 'boolean' || lossless && encoding !== 'irc1')
    throw new RangeError('Gaussian chunks accept raw or irc1 encoding, with lossless available for irc1');
  const compressed = encoding === 'irc1', extension = compressed ? '.irc' : '.bin';

  if (!Array.isArray(previousFootprints) || previousFootprints.length > 64)
    throw new TypeError('Invalid previous Gaussian footprint registry');
  const layout=world.splatFootprints, byKey=new Map(previousFootprints.flatMap((style,index)=>
    style ? [[JSON.stringify(style),index]] : []));
  const footprints=new Array(previousFootprints.length).fill(null), styles=new Map();
  const styleAt=i=>layout?.styles[(layout.indices[i]??0)-1];
  for (let i=0;i<count;i++) {
    const style=styleAt(i);
    if (!style) continue;
    if (style.depth==='plane' || layout.frames?.subarray(i*6,i*6+6).some(Boolean))
      throw new RangeError('Streamed custom Gaussian footprints need center-depth covariance profiles');
    if (styles.has(style)) continue;
    const slot=byKey.get(JSON.stringify(style));
    if (slot!==undefined) footprints[slot]=style;
    styles.set(style,slot);
  }
  for (const [style,slot] of styles) if (slot===undefined) {
    const free=footprints.indexOf(null);
    const index=free<0 ? footprints.length : free;
    if (index>=64) throw new RangeError('A Gaussian pack supports up to 64 footprint profiles');
    footprints[index]=style;
    styles.set(style,index);
  }
  while (footprints.length && !footprints.at(-1)) footprints.pop();

  const bins = new Map();
  for (let n = 0; n < count; n++) {
    const i = n * gaussianRecordFloats;
    const cell = Array.from(data.subarray(i, i + 3), point => Math.floor(point / cellSize));
    const id = typeof layer === 'function' ? layer(n) : layer;
    if (!validId(id) || !cell.every(Number.isSafeInteger)) throw new RangeError('Invalid Gaussian chunk cell or layer');
    const key = [id, ...cell].join(',');
    if (!bins.has(key)) bins.set(key, { layer: id, cell, indices: [] });
    bins.get(key).indices.push(n);
  }

  function* chunks() {
    let id = 0;
    for (const key of [...bins.keys()].sort()) {
      const { layer,cell,indices } = bins.get(key);
      const raw = new Float32Array(indices.length * gaussianRecordFloats), protect=new Uint8Array(indices.length);
      const shaped=indices.some(n=>!!styleAt(n));
      for (const [i,n] of indices.entries()) {
        const at=n*gaussianRecordFloats, offset=i*gaussianRecordFloats, style=styleAt(n);
        raw.set(data.subarray(at,at+gaussianRecordFloats),offset);
        protect[i]=+(!!style || !!world.splatLodProtected?.[n]);
        if (shaped) raw[offset+11]=style ? styles.get(style)+1 : 0;
        if (style) {
          raw[offset+12]=half*Math.SQRT2*Math.max(...style.stretch)*(1+style.softness);
        }
      }
      const name = 'chunk-' + String(++id).padStart(5, '0');
      const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const levels = [];
      let prior = 0;
      for (let i = voxelSizes.length - 1; i >= 0; i--) {
        const level = voxelSizes[i] ? coarsen(raw, voxelSizes[i],protect) : { data: raw, error: 0 };
        const splats = level.data.length / gaussianRecordFloats;
        if (levels[0]?.splats === splats) continue;
        const payload = compressed ? codec.encode(level.data, splats, lossless ? losslessOptions : undefined) : undefined;
        const decoded = compressed && !lossless ? decodeGaussianChunkPayload(payload, splats, encoding) : level.data;
        let encodingError = 0;
        if (decoded !== level.data) for (let at = 0; at < decoded.length; at += gaussianRecordFloats) {
          encodingError = Math.max(encodingError, Math.hypot(decoded[at] - level.data[at],
            decoded[at + 1] - level.data[at + 1], decoded[at + 2] - level.data[at + 2]));
        }
        prior = Math.max(prior, level.error + encodingError);
        setBounds(bounds, decoded, shaped);
        levels.unshift({ id: 'lod-' + i, file: name + '-' + i + extension, revision: 1, splats,
          error: prior, encoding, payloadBytes: payload?.byteLength ?? level.data.byteLength,
          data: level.data, ...(payload && { payload }) });
      }
      yield { id: name, layer, cell, bounds, levels,...(shaped&&{footprints:true}) };
    }
  }
  return { schema: gaussianChunkSchema, world: { cam, radius, bg }, chunks,...(footprints.length&&{footprints}) };
}

export function inspectGaussianChunkManifest(manifest) {
  const { schema, world, chunks } = manifest ?? {};
  if (schema !== gaussianChunkSchema || !xyz(world?.cam?.target) ||
      ![world.cam.yaw, world.cam.pitch, world.cam.dist, world.radius].every(finite) ||
      world.cam.dist <= 0 || world.radius <= 0 || !xyz(world.bg) || !world.bg.every(n => n >= 0 && n <= 255) ||
      (manifest.epoch!==undefined && (!Number.isSafeInteger(manifest.epoch) || manifest.epoch<1)) ||
      !Array.isArray(chunks) || chunks.length > 65536 ||
      (manifest.footprints!==undefined && (!Array.isArray(manifest.footprints) || manifest.footprints.length>64 ||
        !manifest.footprints.every(style=>style===null || style && typeof style==='object' && style.depth!=='plane'))))
    throw new TypeError('Invalid Gaussian chunk manifest');
  const ids = new Set(), files = new Set();
  for (const chunk of chunks) {
    if (!validId(chunk?.id) || ids.has(chunk.id) || !validId(chunk.layer) ||
        (chunk.footprints!==undefined && typeof chunk.footprints!=='boolean') ||
        (chunk.footprints && !manifest.footprints?.some(Boolean)) ||
        (chunk.footprintRevision!==undefined && (typeof chunk.footprintRevision!=='string' ||
          !/^[a-f0-9]{20}$/.test(chunk.footprintRevision))) ||
        !xyz(chunk.bounds?.min) || !xyz(chunk.bounds.max) || chunk.bounds.min.some((n, i) => n > chunk.bounds.max[i]) ||
        !Array.isArray(chunk.levels) || !chunk.levels.length || chunk.levels.length > 16)
      throw new TypeError('Invalid Gaussian chunk bounds, identity, or levels');
    ids.add(chunk.id);
    const levels = new Set();
    let count = 0, error = Infinity;
    for (const level of chunk.levels) {
      if (!validId(level?.id) || levels.has(level.id) || files.has(level.file) ||
          !Number.isSafeInteger(level.revision) || level.revision < 1 ||
          !Number.isSafeInteger(level.splats) || level.splats < 1 || level.splats < count || level.splats > 4_000_000 ||
          !validPayload(level) || !finite(level.error) || level.error < 0 || level.error > error)
        throw new TypeError('Invalid Gaussian chunk level, file, count, or projected error');
      levels.add(level.id);
      files.add(level.file);
      count = level.splats;
      error = level.error;
    }
  }
  return manifest;
}
