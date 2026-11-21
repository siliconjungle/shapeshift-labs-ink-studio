import { decodeGaussianZstd } from './zstd.mjs';

const maxFileBytes = 768 * 1024 * 1024;
const pointLimit = 4_000_000;
const SH0 = 0.28209479177387814;
const ngsp = 0x5053474e;
const scalarTypes = new Map([
  ['char', ['getInt8', 1]], ['uchar', ['getUint8', 1]], ['short', ['getInt16', 2]],
  ['ushort', ['getUint16', 2]], ['int', ['getInt32', 4]], ['uint', ['getUint32', 4]],
  ['float', ['getFloat32', 4]], ['double', ['getFloat64', 8]]
]);
for (const [alias, name] of Object.entries({
  int8: 'char', uint8: 'uchar', int16: 'short', uint16: 'ushort',
  int32: 'int', uint32: 'uint', float32: 'float', float64: 'double'
})) scalarTypes.set(alias, scalarTypes.get(name));

function bytesOf(input) {
  if (typeof input === 'string') {
    if (input.length > maxFileBytes) throw new RangeError('Gaussian file exceeds the byte limit');
    input = new TextEncoder().encode(input);
  }
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes || bytes.length > maxFileBytes) throw new RangeError('Expected Gaussian file bytes within the byte limit');
  return bytes;
}

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function checkCount(count, maxPoints) {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > pointLimit)
    throw new RangeError('Gaussian maxPoints must be between 1 and ' + pointLimit);
  if (!Number.isSafeInteger(count) || count < 1 || count > maxPoints)
    throw new RangeError('Gaussian point count is empty or exceeds maxPoints');
}
function allocate(count, degree, format) {
  return {
    format, count, degree,
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    rotations: new Float32Array(count * 4),
    opacity: new Float32Array(count),
    dc: new Float32Array(count * 3),
    sh: new Float32Array(count * 3 * ((degree + 1) ** 2 - 1))
  };
}

function plyHeader(bytes) {
  const decoder = new TextDecoder();
  const text = decoder.decode(bytes.subarray(0, 65536));
  const end = /^end_header[ \t]*\r?$/m.exec(text);
  if (!end) throw new Error('Gaussian PLY header is missing or too large');
  const newline = text.indexOf('\n', end.index + end[0].length);
  if (newline < 0) throw new Error('Gaussian PLY header must end with a newline');
  const header = text.slice(0, newline + 1);
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(header)) throw new Error('Expected an ASCII PLY header');
  const [magic, ...lines] = header.trim().split(/\r?\n/);
  if (magic.trim() !== 'ply') throw new Error('Invalid PLY signature');
  let format, count, stride = 0;
  const properties = new Map();
  for (const line of lines) {
    const [kind, name, version] = line.trim().split(/\s+/);
    if (kind === 'format') {
      if (format || version !== '1.0' || !['ascii', 'binary_little_endian', 'binary_big_endian'].includes(name))
        throw new Error('Unsupported Gaussian PLY format');
      format = name;
    } else if (kind === 'element') {
      if (count !== undefined) break;
      if (name !== 'vertex') throw new Error('Gaussian PLY requires vertex as the first element');
      count = Number(version);
    } else if (kind === 'property') {
      if (count === undefined || !scalarTypes.has(name) || !version || properties.has(version))
        throw new Error('Gaussian PLY requires unique scalar vertex fields');
      const [getter, size] = scalarTypes.get(name);
      properties.set(version, { getter, column: properties.size, offset: stride });
      stride += size;
    }
  }
  if (!format || count === undefined) throw new Error('Gaussian PLY format or vertex element is missing');
  return { format, count, stride, properties, offset: header.length };
}

function asciiReader(bytes, offset) {
  const decoder = new TextDecoder();
  let cursor = offset;
  return () => {
    while (cursor < bytes.length && bytes[cursor] <= 32) cursor++;
    const start = cursor;
    while (cursor < bytes.length && bytes[cursor] > 32) cursor++;
    if (cursor === start || cursor - start > 64) throw new Error('Truncated or invalid ASCII Gaussian PLY data');
    const token = decoder.decode(bytes.subarray(start, cursor));
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))
      throw new Error('Invalid number in ASCII Gaussian PLY');
    return Number(token);
  };
}
const finite = value => Number.isFinite(Math.fround(value));
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function decodeGaussianPly(input, { maxPoints = pointLimit } = {}) {
  const bytes = bytesOf(input);
  const { format, count, stride, properties, offset } = plyHeader(bytes);
  checkCount(count, maxPoints);
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_1', 'rot_2', 'rot_3', 'rot_0',
    'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  if (fields.some(name => !properties.has(name)))
    throw new Error('PLY is missing Gaussian fields (position, scale, rotation, opacity or f_dc)');
  const rest = [...properties.keys()].filter(name => /^f_rest_\d+$/.test(name)).length;
  const degree = Math.sqrt(rest / 3 + 1) - 1;
  if (!Number.isInteger(degree) || degree > 4 || Array.from({ length: rest }, (_, i) => i).some(i => !properties.has('f_rest_' + i)))
    throw new Error('Gaussian PLY spherical harmonic fields must be contiguous through degree 4');
  const fieldSpecs = fields.map(name => properties.get(name));
  const harmonics = Array.from({ length: rest }, (_, index) => properties.get('f_rest_' + index));
  const ascii = format === 'ascii';
  if (ascii ? bytes.length - offset < count * properties.size : bytes.length - offset < count * stride)
    throw new Error('Truncated Gaussian PLY vertices');
  const data = viewOf(bytes), little = format === 'binary_little_endian';
  const next = ascii ? asciiReader(bytes, offset) : null;
  const row = ascii ? new Float64Array(properties.size) : null;
  const cloud = allocate(count, degree, 'ply');
  const values = new Float64Array(fields.length);
  let base = offset;
  const get = field => ascii ? row[field.column] : data[field.getter](base + field.offset, little);
  for (let i = 0; i < count; i++, base += stride) {
    if (ascii) for (let column = 0; column < row.length; column++) row[column] = next();
    for (let j = 0; j < fields.length; j++) values[j] = get(fieldSpecs[j]);
    if (!values.every(finite)) throw new Error('Non-finite Gaussian PLY vertex ' + i);
    for (let j = 0; j < 3; j++) {
      cloud.positions[i * 3 + j] = values[j];
      const scale = Math.exp(values[3 + j]);
      if (!finite(scale) || Math.fround(scale) <= 0) throw new Error('Invalid Gaussian scale at vertex ' + i);
      cloud.scales[i * 3 + j] = scale;
      cloud.dc[i * 3 + j] = values[11 + j];
    }
    const length = Math.hypot(values[6], values[7], values[8], values[9]);
    if (!length) throw new Error('Invalid Gaussian quaternion at vertex ' + i);
    for (let j = 0; j < 4; j++) cloud.rotations[i * 4 + j] = values[6 + j] / length;
    cloud.opacity[i] = 1 / (1 + Math.exp(-values[10]));
    for (let j = 0; j < rest; j++) {
      const value = get(harmonics[j]), terms = rest / 3;
      if (!finite(value)) throw new Error('Non-finite Gaussian PLY harmonic at vertex ' + i);
      cloud.sh[i * rest + (j % terms) * 3 + Math.floor(j / terms)] = value;
    }
  }
  return cloud;
}

async function decompressStream(codec, bytes, maxBytes) {
  if (codec === 'zstd') return decodeGaussianZstd(bytes, maxBytes);
  let stream;
  try { stream = new DecompressionStream(codec); }
  catch { throw new Error('This runtime cannot decompress ' + codec + ' SPZ. Supply a decompressor or use PLY.'); }
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) throw new RangeError('SPZ decompressed data exceeds the byte limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function spzHeader(bytes, maxPoints, legacy) {
  const data = viewOf(bytes);
  if (bytes.length < (legacy ? 16 : 32) || data.getUint32(0, true) !== ngsp)
    throw new Error('Invalid SPZ signature');
  const version = data.getUint32(4, true), count = data.getUint32(8, true);
  const degree = bytes[12], fractional = bytes[13], flags = bytes[14];
  checkCount(count, maxPoints);
  if ((legacy ? version < 1 || version > 3 : version !== 4) || degree > 4 || fractional > 24)
    throw new Error('Unsupported SPZ version or attribute layout');
  const widths = [version === 1 ? 6 : 9, 1, 3, 3, version < 3 ? 3 : 4, 3 * ((degree + 1) ** 2 - 1)];
  return { version, count, degree, fractional, flags, widths };
}

async function spzStreams(bytes, header, decompress) {
  const { count, widths } = header, data = viewOf(bytes);
  const streams = bytes[15], toc = data.getUint32(16, true);
  const sizes = widths.map(width => width * count).filter(Boolean);
  if (toc < 32 || toc + streams * 16 > bytes.length || streams !== sizes.length)
    throw new Error('Invalid SPZ stream table');
  const spans = [];
  let offset = toc + streams * 16;
  for (let i = 0; i < streams; i++) {
    const size = Number(data.getBigUint64(toc + i * 16, true));
    const expanded = Number(data.getBigUint64(toc + i * 16 + 8, true));
    if (!size || size > bytes.length - offset || expanded !== sizes[i])
      throw new Error('Invalid SPZ stream size');
    spans.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  if (offset !== bytes.length) throw new Error('Unexpected trailing SPZ stream data');
  const out = [];
  for (let i = 0; i < streams; i++) {
    const decoded = bytesOf(await decompress('zstd', spans[i], sizes[i]));
    if (decoded.length !== sizes[i]) throw new Error('Incorrect SPZ decompressed stream size');
    out.push(decoded);
  }
  return out;
}

function half(value) {
  const sign = value & 0x8000 ? -1 : 1, exponent = (value >> 10) & 31, digits = value & 1023;
  if (exponent === 31) throw new Error('Non-finite SPZ half-float position');
  return sign * (exponent ? 2 ** (exponent - 15) * (1 + digits / 1024) : 2 ** -24 * digits);
}

function spzRotation(bytes, data, index, width, target) {
  const start = index * width, out = index * 4;
  let sum = 0;
  if (width === 3) {
    for (let j = 0; j < 3; j++) {
      const value = bytes[start + j] / 127.5 - 1;
      target[out + j] = value;
      sum += value * value;
    }
    target[out + 3] = Math.sqrt(Math.max(0, 1 - sum));
  } else {
    let packed = data.getUint32(start, true);
    const omitted = packed >>> 30;
    for (let j = 3; j >= 0; j--) {
      if (j === omitted) continue;
      const value = (packed & 511) / (511 * Math.SQRT2) * (packed & 512 ? -1 : 1);
      target[out + j] = value;
      sum += value * value;
      packed >>>= 10;
    }
    target[out + omitted] = Math.sqrt(Math.max(0, 1 - sum));
  }
  if (sum > 1) for (let j = 0; j < 4; j++) target[out + j] /= Math.sqrt(sum);
}

export async function decodeGaussianSpz(input, { maxPoints = pointLimit, decompress = decompressStream } = {}) {
  let bytes = bytesOf(input);
  const legacy = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (legacy) {
    checkCount(1, maxPoints);
    bytes = bytesOf(await decompress('gzip', bytes, Math.min(maxFileBytes, 16 + 92 * maxPoints)));
    if (bytes.length > 16 + 92 * maxPoints) throw new RangeError('SPZ decompressed data exceeds the byte limit');
  }
  const header = spzHeader(bytes, maxPoints, legacy);
  const { count, degree, version, fractional, flags, widths } = header;
  let streams;
  if (legacy) {
    let offset = 16;
    streams = widths.map(width => {
      const span = bytes.subarray(offset, offset + width * count);
      offset += width * count;
      return span;
    });
    if (offset > bytes.length || (offset !== bytes.length && !(flags & 2))) throw new Error('Invalid SPZ attribute sizes');
  } else {
    streams = await spzStreams(bytes, header, decompress);
  }
  const [positions, alpha, color, scale, rotation, sh] = streams;
  const positionData = viewOf(positions), rotationData = viewOf(rotation);
  const cloud = allocate(count, degree, 'spz');
  cloud.version = version;
  cloud.antialiased = Boolean(flags & 1);
  cloud.hasExtensions = Boolean(flags & 2);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 3; j++) {
      const index = i * 3 + j;
      if (version === 1) cloud.positions[index] = half(positionData.getUint16(index * 2, true));
      else {
        const p = index * 3;
        const value = positions[p] | positions[p + 1] << 8 | positions[p + 2] << 16;
        cloud.positions[index] = (value << 8 >> 8) * 2 ** -fractional;
      }
      cloud.scales[index] = Math.exp(scale[index] / 16 - 10);
      cloud.dc[index] = (color[index] / 255 - 0.5) / 0.15;
    }
    cloud.opacity[i] = alpha[i] / 255;
    spzRotation(rotation, rotationData, i, widths[4], cloud.rotations);
  }
  for (let i = 0; i < cloud.sh.length; i++) cloud.sh[i] = (sh[i] - 128) / 128;
  return cloud;
}

export async function decodeGaussianSplat(input, options) {
  const bytes = bytesOf(input);
  if (bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79) return decodeGaussianPly(bytes, options);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b || bytes.length >= 4 && viewOf(bytes).getUint32(0, true) === ngsp)
    return decodeGaussianSpz(bytes, options);
  throw new Error('Unsupported Gaussian asset. Expected PLY or a file with a valid SPZ signature.');
}

function shBasis(direction, degree) {
  if (!direction) return null;
  if (direction.length !== 3 || !Array.from(direction).every(finite) || !Math.hypot(...direction))
    throw new TypeError('Gaussian viewDirection must be a nonzero XYZ vector');
  const z = clamp(direction[2] / Math.hypot(...direction), -1, 1);
  const phi = Math.atan2(direction[1], direction[0]), basis = [];
  const p = [[1]], factorial = [1];
  for (let i = 1; i <= 2 * degree; i++) factorial[i] = factorial[i - 1] * i;
  for (let l = 1; l <= degree; l++) {
    p[l] = [];
    p[l][l] = -(2 * l - 1) * Math.sqrt(1 - z * z) * p[l - 1][l - 1];
    p[l][l - 1] = (2 * l - 1) * z * p[l - 1][l - 1];
    for (let m = 0; m < l - 1; m++)
      p[l][m] = ((2 * l - 1) * z * p[l - 1][m] - (l + m - 1) * p[l - 2][m]) / (l - m);
    for (let m = -l; m <= l; m++) {
      const a = Math.abs(m), angular = m < 0 ? Math.SQRT2 * Math.sin(a * phi) : m > 0 ? Math.SQRT2 * Math.cos(a * phi) : 1;
      basis.push(angular * p[l][a] * Math.sqrt((2 * l + 1) / (4 * Math.PI) * factorial[l - a] / factorial[l + a]));
    }
  }
  return basis;
}

export function gaussianSplatWorld(cloud, { size = 6, up = 'y', viewDirection } = {}) {
  const { count, positions, scales, rotations, opacity, dc, sh, degree } = cloud;
  checkCount(count, pointLimit);
  if (!Number.isInteger(degree) || degree < 0 || degree > 4) throw new TypeError('Invalid Gaussian SH degree');
  const terms = (degree + 1) ** 2 - 1;
  if (![[positions, 3], [scales, 3], [rotations, 4], [opacity, 1], [dc, 3], [sh, 3 * terms]]
    .every(([array, width]) => array instanceof Float32Array && array.length === count * width))
    throw new TypeError('Invalid Gaussian cloud attributes');
  if (!finite(size) || size <= 0 || !['y', 'z'].includes(up)) throw new TypeError('Invalid Gaussian world size or up axis');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let maxScale = 0;
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    lo[axis] = Math.min(lo[axis], positions[i]);
    hi[axis] = Math.max(hi[axis], positions[i]);
    maxScale = Math.max(maxScale, scales[i]);
  }
  const center = lo.map((value, axis) => (value + hi[axis]) * 0.5);
  const span = Math.max(...hi.map((value, axis) => value - lo[axis]), 6 * maxScale, 1e-30);
  const fit = size / span, basis = shBasis(viewDirection, degree);
  const data = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const p = i * 3, q = i * 4, o = i * 16;
    const x = rotations[q], y = rotations[q + 1], z = rotations[q + 2], w = rotations[q + 3];
    const v0 = (scales[p] * fit) ** 2, v1 = (scales[p + 1] * fit) ** 2, v2 = (scales[p + 2] * fit) ** 2;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    const xx = v0 * r00 * r00 + v1 * r01 * r01 + v2 * r02 * r02;
    const xy = v0 * r00 * r10 + v1 * r01 * r11 + v2 * r02 * r12;
    const xz = v0 * r00 * r20 + v1 * r01 * r21 + v2 * r02 * r22;
    const yy = v0 * r10 * r10 + v1 * r11 * r11 + v2 * r12 * r12;
    const yz = v0 * r10 * r20 + v1 * r11 * r21 + v2 * r12 * r22;
    const zz = v0 * r20 * r20 + v1 * r21 * r21 + v2 * r22 * r22;
    const py = (positions[p + 1] - center[1]) * fit, pz = (positions[p + 2] - center[2]) * fit;
    data[o] = (positions[p] - center[0]) * fit;
    data[o + 1] = up === 'z' ? pz : py;
    data[o + 2] = up === 'z' ? -py : pz;
    data[o + 3] = opacity[i];
    data[o + 4] = xx;
    data[o + 5] = up === 'z' ? xz : xy;
    data[o + 6] = up === 'z' ? -xy : xz;
    data[o + 8] = up === 'z' ? zz : yy;
    data[o + 9] = up === 'z' ? -yz : yz;
    data[o + 10] = up === 'z' ? yy : zz;
    let packed = 0;
    for (let channel = 0; channel < 3; channel++) {
      let color = 0.5 + SH0 * dc[p + channel];
      if (basis) for (let j = 0; j < terms; j++) color += basis[j] * sh[(i * terms + j) * 3 + channel];
      packed += Math.round(clamp(color, 0, 1) * 255) * 256 ** channel;
    }
    data[o + 7] = packed;
  }
  return {
    count, data, seed: 1, detail: 14, radius: size, moving: new Int32Array(), back: new Int32Array(),
    bg: [12, 18, 23], pal: [0x0c1217, 0x334552, 0x6f8590, 0xbccdd0, 0xf4f8f5],
    palName: 'Imported Gaussian', dither: 0, fog: { c: 0, start: 1, max: 0 }, outline: { c: 0, edge: 0 },
    cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: size * 2.15, sway: 0 }
  };
}
