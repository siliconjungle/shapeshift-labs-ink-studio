const fs = require('node:fs');
const path = require('node:path');
const Assets = require('./asset-references.js');
const MaterialGraph = require('./material-graph.js');
const Metadata = require('./material-metadata.js');
const files = require('./asset-files.js');

const bundledRegistry = path.resolve(__dirname,'../materials/recipes/registry.json');

function selectMaterialLibrary(file = bundledRegistry, { audience = 'library', query, tag, offset, limit, kit = require('../index.js').load() } = {}) {
  if (!['library', 'workspace', 'publication'].includes(audience))
    throw new TypeError('Material library audience must be library, workspace or publication');
  const { authoring, procedural } = kit.KIT;
  const registry = Assets.open(authoring.assetReferences, path.resolve(file)), cards = new Map();
  const entries = [];
  for (const entry of registry.entries) {
    if (entry.kind !== 'graph') continue;
    const resolved = registry.inspect(entry), source = Assets.parse(resolved.bytes);
    if (source.format !== MaterialGraph.format) continue;
    const material = Metadata.summary(MaterialGraph.openMaterialGraph(source));
    if (audience === 'library' && !material.visibility.library ||
        audience === 'publication' && material.visibility.publication !== 'public') continue;
    const key = authoring.assetReferences.key(entry);
    cards.set(key, { entry, material, file: resolved.filename });
    const { author, description, tags, intendedUse, materialModel } = material;
    entries.push({ id: key, label: material.label, subtitle: description, categories: tags,
      keywords: [material.id, author, intendedUse, materialModel].filter(value => value !== undefined) });
  }
  const catalog = procedural.assetCatalog.create(entries);
  const results = catalog.search({ query, category: tag, offset, limit });
  const thumbnails = new Map();
  const items = results.items.map(({ id }) => {
    const { entry, material, file } = cards.get(id);
    const card = { asset: entry.asset, revision: entry.revision, ...material };
    if (material.thumbnail) {
      const { bytes, info } = Metadata.thumbnailInfo(file, material.thumbnail);
      card.thumbnail = info;
      if (audience === 'publication') thumbnails.set(info.sha256, bytes);
    }
    return audience === 'publication' ? Metadata.publicationCard(card) : { ...card, file, sha256: entry.sha256 };
  });
  return { index: { format: 'ink-studio/material-library', version: 1, audience, total: results.total,
    categories: catalog.categories, items }, thumbnails };
}

function searchMaterialLibrary(file, options) {
  return selectMaterialLibrary(file, options).index;
}

function publishMaterialLibrary(file, { out, ...options } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Choose a new material publication directory');
  if (options.audience !== undefined && options.audience !== 'publication')
    throw new TypeError('A material publication needs the publication audience');
  const directory = path.resolve(out), { index, thumbnails } = selectMaterialLibrary(file, { ...options, audience: 'publication' });
  const target = path.join(directory, 'index.json');
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  try {
    for (const [sha256, bytes] of thumbnails)
      files.write(path.join(directory, 'thumbnails', sha256 + '.png'), bytes);
    for (const item of index.items) if (item.thumbnail)
      item.thumbnail.file = 'thumbnails/' + item.thumbnail.sha256 + '.png';
    files.json(target, index);
    return { file: target, ...index };
  } catch (error) {
    fs.rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

module.exports = { searchMaterialLibrary, publishMaterialLibrary };
