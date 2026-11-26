/* Optional native AxF SDK bridge. Adapters are supplied by the trusted host. */
const maxBytes = 512 * 1024 * 1024;

function codec(options, operation) {
  const adapter = options?.adapter;
  if (typeof adapter?.[operation] !== 'function')
    throw new TypeError('AxF exchange needs a host adapter backed by the X-Rite SDK');
  return adapter[operation].bind(adapter);
}

function sample(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes)
    throw new RangeError('AxF exchange needs nonempty bytes within its 512 MiB budget');
  return bytes;
}

function report(result) {
  if (typeof result?.representation !== 'string' || !result.representation.trim() || result.representation.length > 80 ||
      !Array.isArray(result.unsupported) || result.unsupported.length > 96 ||
      !Array.from(result.unsupported).every(entry => typeof entry === 'string' && entry.trim() && entry.length <= 240))
    throw new TypeError('AxF adapter must report the source representation and unsupported properties');
  return { representation: result.representation, unsupported: [...result.unsupported] };
}

function packet(value) {
  const P = require('../index.js').load().KIT.procedural;
  if (!P.materialChannels.valid(value) || !Object.values(value.channels).every(({ raster }) => P.graphImages.valid(raster)))
    throw new TypeError('AxF adapter exchange needs a packet of typed material maps');
  return value;
}

async function importAxF(bytes, options) {
  const decode = codec(options, 'decode');
  const result = await decode(sample(bytes));
  return { value: packet(result?.value), ...report(result) };
}

async function exportAxF(value, options) {
  const encode = codec(options, 'encode');
  const result = await encode(packet(value));
  return { bytes: sample(result?.bytes), ...report(result) };
}

module.exports = { importAxF, exportAxF };
