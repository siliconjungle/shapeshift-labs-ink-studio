const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Fonts = require('../src/font-resources.js');

const format = 'ttf';
const filename = value => typeof value === 'string' && !!value.trim() && value.length <= 4096 && !value.includes('\0');
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validate(definition) {
  if (!record(definition) || definition.format !== format ||
      Object.keys(definition).some(key => !['format', 'file', 'data', 'origin', 'family', 'style'].includes(key)) ||
      Object.hasOwn(definition, 'file') === Object.hasOwn(definition, 'data') ||
      (definition.family !== undefined && !Fonts.label(definition.family)) ||
      (definition.style !== undefined && !Fonts.label(definition.style)))
    throw new TypeError('Font definition needs one linked or embedded TrueType face');
  if (Object.hasOwn(definition, 'file')) {
    if (!filename(definition.file) || Object.hasOwn(definition, 'origin'))
      throw new TypeError('Linked font needs a relative or absolute filename');
  } else if (typeof definition.data !== 'string' || definition.data.length < 16 ||
      definition.data.length > 4 * Math.ceil(Fonts.maxBytes / 3) || definition.data.length % 4 ||
      (definition.origin !== undefined && !filename(definition.origin))) {
    throw new TypeError('Embedded font needs Base64 data and an optional origin filename');
  }
  return definition;
}

function read(filename, baseDir) {
  const full = path.resolve(baseDir, filename), stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > Fonts.maxBytes) throw new RangeError('Font requires a regular file within 8 MiB');
  const bytes = fs.readFileSync(full);
  if (bytes.length > Fonts.maxBytes) throw new RangeError('Font file exceeds 8 MiB');
  return { full, bytes };
}

function load(definition, { baseDir = process.cwd(), onFile = () => {} } = {}) {
  validate(definition);
  const { file, data, family, style, origin } = definition;
  const linked = file && read(file, baseDir), bytes = linked?.bytes ?? Fonts.decode(data);
  const value = Fonts.create(bytes, { family, style });
  if (linked) onFile(linked.full);
  const sha256 = createHash('sha256').update(bytes).digest('hex'), metrics = Fonts.open(value);
  return { value, sha256, info: {
    family: value.family, style: value.style, storage: linked ? 'linked' : 'embedded', bytes: bytes.length,
    unitsPerEm: metrics.unitsPerEm, ascender: metrics.ascender, descender: metrics.descender,
    ...(file && {file}), ...(origin && {origin})
  } };
}

module.exports = { format, validate, read, load };
