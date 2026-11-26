const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Bitmap = require('../src/bitmap-resources.js');
const PNG = require('./png.js');

const absent = error => ['ENOENT', 'ENOTDIR'].includes(error.code);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function read(file, baseDir) {
  const full = path.resolve(baseDir, file), stat = fs.statSync(full);
  if (!stat.isFile()) throw new TypeError('Linked bitmap needs a regular file: ' + file);
  if (stat.size > Bitmap.maxFileBytes) throw new RangeError('Bitmap file exceeds 32 MiB: ' + file);
  return { bytes: fs.readFileSync(full), full };
}

function bytesFor(member, baseDir) {
  if (member.base64 !== undefined) {
    const bytes = Buffer.from(member.base64, 'base64');
    if (bytes.toString('base64') !== member.base64) throw new TypeError('Embedded bitmap needs canonical base64');
    return { bytes };
  }
  if (!member.file) return;
  try { return read(member.file, baseDir); }
  catch (error) {
    if (!absent(error)) throw error;
  }
}

function load(definition, { baseDir = process.cwd(), declare, onFile = () => {} } = {}) {
  const { rows } = Bitmap.layout(definition);
  const encoded = new Map(), preview = new Map();
  let fileBytes = 0, decodedBytes = 0;
  for (const row of rows) {
    const input = bytesFor(row, baseDir);
    if (!input) continue;
    const { full, bytes } = input, codec = Bitmap.encoding(row);
    try {
      if (bytes.length > Bitmap.maxFileBytes || (fileBytes += bytes.length) > Bitmap.maxResourceBytes)
        throw new RangeError('Bitmap resource exceeds its file byte budget');
      const header = codec === 'png' ? Bitmap.png(PNG.nativeLayout(bytes)) : Bitmap.pfm(bytes, { layoutOnly: true });
      const rawBytes = header.width * header.height * header.channels *
        (header.precision === 'float32' ? 4 : header.precision === 'unorm16' ? 2 : 1);
      if ((decodedBytes += rawBytes) > Bitmap.maxResourceBytes)
        throw new RangeError('Bitmap resource exceeds its raw sample budget');
      encoded.set(row.key, { row, bytes, codec, sha256: hash(bytes) });
      preview.set(row.key, header);
    } catch (error) {
      throw new Error('Bitmap member ' + row.key + ': ' + error.message, { cause: error });
    }
    if (full) onFile(full);
  }

  // Check the budget and collection contract before inflating any members.
  let result = Bitmap.compile(definition, preview);
  if (declare) {
    const decoded = new Map();
    for (const [key, { row, bytes, codec }] of encoded) {
      try {
        const raw = codec === 'png' ? Bitmap.png(PNG.raster(bytes)) : Bitmap.pfm(bytes, { rowOrder: row.rowOrder });
        decoded.set(key, raw);
      } catch (error) {
        throw new Error('Bitmap member ' + key + ': ' + error.message, { cause: error });
      }
    }
    result = Bitmap.compile(definition, decoded, declare);
  }
  const members = result.info.members.map(member => encoded.has(member.key) ?
    { ...member, sha256: encoded.get(member.key).sha256 } : member);
  return { select: result.select, info: { ...result.info, members },
    sha256: hash(JSON.stringify(members.map(({ key, sha256 }) => [key, sha256 ?? null]))) };
}

function embed(member, baseDir, refresh) {
  if (!member) throw new RangeError('There is no linked bitmap at that member');
  const { file, origin, base64, ...settings } = member;
  const source = file ?? origin;
  if (refresh && !source) throw new RangeError('Embedded bitmap has no reimport origin');
  if (!refresh && !file) return member;
  const { bytes } = read(source, baseDir);
  if (refresh && file) return member;
  return { ...settings, encoding: Bitmap.encoding(member), base64: bytes.toString('base64'), origin: source };
}

module.exports = { load, embed };
