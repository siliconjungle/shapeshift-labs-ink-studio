const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');

const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, length) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= length && !value.includes('\0');
const positive = value => Number.isFinite(value) && value > 0;
const keys = ['author', 'description', 'tags', 'userData', 'intendedUse',
  'materialModel', 'physicalDimensions', 'thumbnail', 'visibility'];
const privateVisibility = Object.freeze({ library: false, publication: 'private' });
const publicationStates = ['private', 'unlisted', 'public'];

function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(name => !allowed.includes(name)))
    throw new TypeError('Invalid material ' + label);
}

function validate(metadata) {
  fields(metadata, keys, 'graph metadata');
  const { author, description, tags, intendedUse, materialModel, physicalDimensions, thumbnail, visibility } = metadata;
  if (author !== undefined && !text(author, 200) || description !== undefined && !text(description, 4096) ||
      intendedUse !== undefined && !text(intendedUse, 1024) ||
      materialModel !== undefined && (typeof materialModel !== 'string' || !/^[A-Za-z][\w.-]{0,95}$/.test(materialModel)))
    throw new TypeError('Material metadata needs valid author, description, intended use and model text');
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 32 || !Array.from(tags).every(tag => text(tag, 64) && tag === tag.trim()) ||
        new Set(tags.map(tag => tag.normalize('NFKC').toLowerCase())).size !== tags.length)
      throw new TypeError('Material tags need up to 32 distinct nonempty labels');
  }
  if (physicalDimensions !== undefined) {
    fields(physicalDimensions, ['width', 'height', 'depth', 'unit'], 'physical dimensions');
    const { width, height, depth, unit } = physicalDimensions;
    if (!positive(width) || !positive(height) || depth !== undefined && !positive(depth) ||
        !['mm', 'cm', 'm', 'in', 'ft'].includes(unit))
      throw new TypeError('Material physical dimensions need positive width, height, optional depth and a length unit');
  }
  if (thumbnail !== undefined) {
    fields(thumbnail, ['file', 'alt'], 'thumbnail');
    const { file, alt } = thumbnail;
    if (!text(file, 4096) || file !== file.trim() || file.startsWith('/') ||
        /[\\<>:"|?*\x00-\x1f]/.test(file) || !/\.png$/i.test(file) || alt !== undefined && !text(alt, 300))
      throw new TypeError('Material thumbnail needs a relative PNG path and optional alt text');
  }
  if (visibility !== undefined) {
    fields(visibility, ['library', 'publication'], 'visibility');
    if (visibility.library !== undefined && typeof visibility.library !== 'boolean' ||
        visibility.publication !== undefined && !publicationStates.includes(visibility.publication))
      throw new TypeError('Material visibility needs a library boolean and private, unlisted or public publication');
  }
}

function summary(document) {
  const { id, label, metadata = {} } = document;
  return { id, label: label?.trim() ? label : id, ...metadata, visibility: { ...privateVisibility, ...metadata.visibility } };
}

function thumbnailInfo(owner, thumbnail) {
  const file = path.resolve(path.dirname(owner), thumbnail.file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new RangeError('Material thumbnail exceeds its 2 MiB file budget');
  const bytes = fs.readFileSync(file), { w: width, h: height } = PNG.layout(bytes);
  if (width > 1024 || height > 1024) throw new RangeError('Material thumbnail exceeds its 1024 × 1024 extent budget');
  PNG.raster(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, info: { file, width, height, sha256, ...(thumbnail.alt !== undefined && { alt: thumbnail.alt }) } };
}

function publicationCard({ userData, thumbnail, ...card }) {
  if (!thumbnail) return card;
  const { file, ...details } = thumbnail;
  return { ...card, thumbnail: details };
}

function describeMaterialMetadata(file, { audience = 'workspace' } = {}) {
  if (!['workspace', 'publication'].includes(audience))
    throw new TypeError('Material information audience must be workspace or publication');
  const source = path.resolve(file), data = summary(require('./material-graph.js').readMaterialGraph(source));
  if (audience === 'publication' && data.visibility.publication === 'private')
    throw new RangeError('This material is private');
  const card = { ...data, ...(data.thumbnail && { thumbnail: thumbnailInfo(source, data.thumbnail).info }) };
  return audience === 'publication' ? publicationCard(card) : card;
}

module.exports = { validate, summary, thumbnailInfo, publicationCard, describeMaterialMetadata };
