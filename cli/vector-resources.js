const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Vector = require('../src/vector-resources.js');

const format = 'svg';
const filename = value => typeof value === 'string' && !!value.trim() && value.length <= 4096 && !value.includes('\0');
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validate(definition) {
  if (!record(definition) || definition.format !== format ||
      Object.keys(definition).some(key => !['format', 'file', 'document', 'origin'].includes(key)) ||
      Object.hasOwn(definition, 'file') === Object.hasOwn(definition, 'document') ||
      (Object.hasOwn(definition, 'file') ? !filename(definition.file) || Object.hasOwn(definition, 'origin') :
        definition.origin !== undefined && !filename(definition.origin)))
    throw new TypeError('Vector resource needs one SVG file or embedded vector document');
  if (Object.hasOwn(definition, 'document')) Vector.index(definition.document);
  return definition;
}

function read(file, baseDir = process.cwd()) {
  const full = path.resolve(baseDir, file), stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > Vector.maxText) throw new RangeError('SVG requires a regular file within its 2 MiB budget');
  const bytes = fs.readFileSync(full);
  if (bytes.length > Vector.maxText) throw new RangeError('SVG file exceeds its 2 MiB budget');
  const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { full, bytes, value: Vector.parse(svg) };
}

function load(definition, { baseDir, onFile = () => {} } = {}) {
  validate(definition);
  const stored = definition.file ? read(definition.file, baseDir) :
    { value: definition.document, bytes: Buffer.from(Vector.write(definition.document)) };
  if (stored.full) onFile(stored.full);
  const sha256 = createHash('sha256').update(stored.bytes).digest('hex');
  const { viewBox, elements } = Vector.describe(stored.value);
  return { value: stored.value, sha256, info: { storage: definition.file ? 'linked' : 'embedded',
    viewBox, elementCount: elements.length, ...(definition.file && { file: definition.file }),
    ...(definition.origin && { origin: definition.origin }) } };
}
module.exports = { format, validate, read, load };
