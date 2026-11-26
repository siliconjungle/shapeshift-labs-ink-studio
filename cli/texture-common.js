const { inflateSync } = require('node:zlib');

const maxBytes = 128 * 1024 ** 2;
const maxProfile = 4 * 1024 ** 2;
const srgb = Object.freeze([.64, .33, .30, .60, .15, .06, .3127, .3290]);
const p3 = Object.freeze([.68, .32, .265, .69, .15, .06, .3127, .3290]);
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const uint = (n, lo, hi) => Number.isSafeInteger(n) && lo <= n && n <= hi;
const sampleType = depth => ({ 8: Uint8Array, 16: Uint16Array, 32: Float32Array })[depth];

function extent(width, height, bytesPerPixel = 1) {
  if (!uint(width, 1, 8192) || !uint(height, 1, 8192) || width * height * bytesPerPixel > maxBytes ||
      width * height > 2 ** 24) throw new RangeError('Texture exceeds its extent or sample budget');
}
function checkedRaster(image) {
  const { width, height, channels, data } = image ?? {};
  const depth = data instanceof Uint8Array ? 8 : data instanceof Uint16Array ? 16 : data instanceof Float32Array ? 32 : 0;
  extent(width, height, channels * depth / 8);
  if (!depth || ![1, 2, 3, 4].includes(channels) || data.length !== width * height * channels ||
      depth === 32 && !data.every(Number.isFinite)) throw new TypeError('Texture needs finite 8/16-bit integer or 32-bit float samples');
  return { width, height, channels, data, depth };
}
function slice(bytes, at, size) {
  if (!uint(at, 0, bytes.length) || !uint(size, 0, bytes.length - at))
    throw new RangeError('Truncated texture data');
  return bytes.subarray(at, at + size);
}
function inflate(bytes, expected) {
  const out = inflateSync(bytes, { maxOutputLength: expected });
  if (out.length !== expected) throw new RangeError('Texture compressed block does not match its declared dimensions');
  return out;
}
function input(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > maxBytes)
    throw new TypeError('Expected a bounded texture file');
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function icc(bytes) {
  if (bytes.length < 132 || bytes.length > maxProfile || bytes.readUInt32BE(0) !== bytes.length ||
      bytes.toString('ascii', 36, 40) !== 'acsp') throw new TypeError('Invalid ICC profile header or length');
  const count = bytes.readUInt32BE(128);
  if (count > 4096 || 132 + count * 12 > bytes.length) throw new RangeError('ICC tag table exceeds its bounds');
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    slice(bytes, bytes.readUInt32BE(at + 4), bytes.readUInt32BE(at + 8));
  }
  return bytes;
}
function profileMode(bytes, channels) {
  if (bytes && bytes.toString('ascii',16,20) !== (channels > 2 ? 'RGB ' : 'GRAY'))
    throw new TypeError('ICC profile color model does not match the texture');
  return bytes;
}
function profile(value = {}) {
  if (!fields(value, ['icc', 'name', 'chromaticities', 'gamma', 'srgb']))
    throw new TypeError('Expected a texture color profile record');
  const { icc: base64, name, chromaticities, gamma, srgb } = value;
  if (name !== undefined && (typeof name !== 'string' || !/^[\x20-\x7e\xa1-\xff]{1,79}$/.test(name) ||
      name !== name.trim() || name.includes('  ') || base64 === undefined))
    throw new TypeError('Invalid ICC profile name');
  if (chromaticities !== undefined && (!Array.isArray(chromaticities) || chromaticities.length !== 8 ||
      !Array.from(chromaticities).every(v => Number.isFinite(v) && Math.abs(v) <= 16)))
    throw new RangeError('Color primaries need eight finite coordinates');
  if (gamma !== undefined && (!Number.isFinite(gamma) || gamma < .00001 || gamma > 100) ||
      srgb !== undefined && (!uint(srgb, 0, 3) || base64 !== undefined))
    throw new RangeError('Invalid gamma or sRGB rendering intent');
  let bytes;
  if (base64 !== undefined) {
    if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(maxProfile / 3))
      throw new RangeError('ICC profile exceeds its byte budget');
    bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) throw new TypeError('Expected canonical Base64 ICC profile bytes');
    icc(bytes);
  }
  return { ...value, bytes };
}

function alphaMode(channels, mode = channels % 2 ? 'none' : 'straight') {
  if (!['none', 'straight', 'premultiplied'].includes(mode) || (mode === 'none') !== Boolean(channels % 2))
    throw new TypeError('Texture alpha mode needs a matching alpha channel');
  return mode;
}

module.exports = { maxBytes, maxProfile, srgb, p3, record, fields, uint, sampleType, extent,
  checkedRaster, slice, input, inflate, icc, profileMode, profile, alphaMode };
