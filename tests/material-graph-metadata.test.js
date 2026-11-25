const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const legacy = { format: 'ink-studio/graph-project', version: 1, nodes: {},
  outputs: { area: { value: 18 } }, exports: { result: { output: 'area', format: 'json' } } };

function workspace(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ink-material-metadata-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = (...name) => path.join(directory, ...name);
  const json = (name, document) => fs.writeFileSync(file(name), JSON.stringify(document));
  const command = (mode, ...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', mode, ...args],
    { cwd: directory, encoding: 'utf8' }));
  fs.mkdirSync(file('images'));
  const bytes = PNG.encode(3, 2, Uint8Array.from({ length: 18 }, (_, n) => n * 11), 3);
  fs.writeFileSync(file('images/card.png'), bytes);
  return { directory, file, json, command, bytes };
}

const metadata = {
  author: 'Studio Lumen',
  description: 'Glazed stone with a fine copper patina.',
  tags: ['Ceramics', 'Weathered'],
  userData: { internal: { review: 'studio-only', notes: [3, null, false] } },
  intendedUse: 'Repeatable tile on hand-painted station walls.',
  materialModel: 'pbr.metallic-roughness',
  physicalDimensions: { width: 18, height: 12, depth: 1.2, unit: 'cm' },
  thumbnail: { file: 'images/card.png', alt: 'Copper on a turquoise ceramic tile' },
  visibility: { library: true, publication: 'public' }
};

function card(id, label, fields = metadata) {
  return { ...Ink.openMaterialGraph(legacy, { id }), label, metadata: fields };
}

test('metadata round-trips, relocates thumbnails, and leaves graph execution identity intact', t => {
  const { directory, file, json, command, bytes } = workspace(t);
  const document = card('copper-clay', 'Copper clay'), original = file('copper.material.json');
  Ink.writeMaterialGraph(original, document);
  assert.deepEqual(Ink.readMaterialGraph(original), document);
  const inspected = Ink.describeMaterialMetadata(original);
  assert.equal(inspected.id, 'copper-clay');
  assert.equal(inspected.label, 'Copper clay');
  assert.deepEqual(inspected.userData, metadata.userData);
  assert.deepEqual(inspected.thumbnail, { ...metadata.thumbnail, file: file('images/card.png'),
    width: 3, height: 2, sha256: sha256(bytes) });
  assert.deepEqual(command('material-info', original), inspected);

  const moved = Ink.writeMaterialGraph(file('review/copper.material.json'), document, { baseDir: directory });
  assert.equal(moved.metadata.thumbnail.file, '../images/card.png');
  assert.throws(() => Ink.writeMaterialGraph(file('images/card.png'), document, { baseDir: directory }), /overwrite its dependency/);
  assert.throws(() => Ink.openMaterialGraph(document, { id: 'different' }), /cannot be reassigned/);

  const old = Ink.createGraphProject(legacy), edited = Ink.readGraphProject(original);
  assert.equal(edited.plan().projectHash, old.plan().projectHash);
  assert.deepEqual(edited.run().artifacts, old.run().artifacts);
  assert.deepEqual(edited.artifactIdentity(), old.artifactIdentity());
  assert.deepEqual(edited.plan().materialMetadata.physicalDimensions, metadata.physicalDimensions);
  assert.deepEqual(edited.snapshot().settings.materialMetadata.userData, metadata.userData);
  const plan = edited.plan();
  plan.materialMetadata.userData.internal.review = 'local mutation';
  assert.equal(edited.plan().materialMetadata.userData.internal.review, 'studio-only');

  json('metadata.json', { ...metadata, author: 'Renamed studio' });
  const receipt = command('material', original, '--metadata', file('metadata.json'), '--out', file('export/draft.json'));
  assert.equal(command('material-info', receipt.file).author, 'Renamed studio');
  assert.equal(Ink.readMaterialGraph(receipt.file).metadata.thumbnail.file, '../images/card.png');
  assert.throws(() => Ink.openMaterialGraph(card('malformed', 'Malformed', { tags: ['Clay', 'clay'] })), /distinct/);
  assert.throws(() => Ink.openMaterialGraph(card('malformed', 'Malformed', { thumbnail: { file: 'https://example.com/p.png' } })), /relative PNG path/);
  assert.throws(() => Ink.openMaterialGraph(card('malformed', 'Malformed', { physicalDimensions: {
    width: 10, height: 0, unit: 'cm' } })), /positive/);

  fs.unlinkSync(file('images/card.png'));
  assert.equal(Ink.readMaterialGraph(original).label, 'Copper clay');
  assert.equal(Ink.readGraphProject(original).run().outputs.area, 18);
  assert.throws(() => Ink.describeMaterialMetadata(original), /ENOENT/);
});

test('library and publication enforce separate visibility and publish portable thumbnails', t => {
  const { file, json, command, bytes } = workspace(t);
  const cases = [
    card('published', 'Copper clay', metadata),
    card('library-only', 'Glazed graphite', { ...metadata, tags: ['Architectural'],
      visibility: { library: true, publication: 'unlisted' } }),
    card('public-only', 'Slipcast terracotta', { ...metadata, visibility: { library: false, publication: 'public' } }),
    card('draft', 'Paused glaze', { ...metadata, tags: ['Draft-only'], visibility: { library: false, publication: 'private' } }),
    { ...Ink.openMaterialGraph(legacy, { id: 'old-graph' }), label: '' }
  ];
  const entries = cases.map(document => {
    const filename = document.id + '.json';
    Ink.writeMaterialGraph(file(filename), document);
    return { asset: 'material/' + document.id, revision: 2, kind: 'graph', file: filename,
      sha256: sha256(fs.readFileSync(file(filename))) };
  });
  json('registry.json', { format: 'ink-studio/asset-registry', version: 1, entries });
  const registry = file('registry.json'), ids = index => index.items.map(row => row.id);
  assert.deepEqual(ids(Ink.searchMaterialLibrary(registry)), ['published', 'library-only']);
  assert.deepEqual(ids(Ink.searchMaterialLibrary(registry, { audience: 'publication' })), ['published', 'public-only']);
  assert.deepEqual(ids(Ink.searchMaterialLibrary(registry, { audience: 'workspace' })),
    ['published', 'library-only', 'old-graph', 'draft', 'public-only']);
  const only = Ink.searchMaterialLibrary(registry, { query: 'Studio Lumen patina', tag: 'Ceramics' });
  assert.deepEqual(ids(only), ['published']);
  assert.equal(only.items[0].revision, 2);
  const direct = command('material-info', file('library-only.json'), '--audience', 'publication');
  assert.equal(direct.visibility.publication, 'unlisted');
  assert.equal(Object.hasOwn(direct.thumbnail, 'file'), false);
  assert.equal(Object.hasOwn(direct, 'userData'), false);
  assert.throws(() => Ink.describeMaterialMetadata(file('draft.json'), { audience: 'publication' }), /private/);
  assert.deepEqual(only.items[0].userData, metadata.userData);
  assert.deepEqual(ids(command('material-library', registry, '--audience', 'publication', '--offset', '1', '--limit', '1')),
    ['public-only']);

  const folder = file('review/public'), result = command('material-library', registry, '--out', folder);
  const disk = JSON.parse(fs.readFileSync(result.file));
  assert.deepEqual(ids(disk), ['published', 'public-only']);
  assert.deepEqual(disk.categories, ['Ceramics', 'Weathered']);
  for (const row of disk.items) {
    assert.equal(Object.hasOwn(row, 'userData'), false);
    assert.equal(Object.hasOwn(row, 'file'), false);
    assert.deepEqual(fs.readFileSync(path.join(folder, row.thumbnail.file)), bytes);
  }
  assert.equal(fs.readdirSync(path.join(folder, 'thumbnails')).length, 1);
  assert.throws(() => Ink.publishMaterialLibrary(registry, { out: folder }), /EEXIST/);
  assert.throws(() => Ink.publishMaterialLibrary(registry, { out: file('private'), audience: 'workspace' }), /publication audience/);
  fs.writeFileSync(file('published.json'), '{}');
  assert.throws(() => Ink.searchMaterialLibrary(registry), /SHA-256 mismatch/);
});

test('take bundles preserve thumbnail files, authored metadata and runnable graphs', t => {
  const { directory, file, json, bytes } = workspace(t);
  Ink.writeMaterialGraph(file('copper.material.json'), card('copper-clay', 'Copper clay'));
  json('take.json', { format: 'ink-studio/take', version: 1, id: 'copper-take', graph: 'copper.material.json' });
  const bundle = file('portable.json');
  const { project } = Ink.packProject(file('take.json'), { root: directory, out: bundle });
  assert.deepEqual(project.files(), ['copper.material.json', 'images/card.png', 'take.json']);
  fs.unlinkSync(file('images/card.png'));
  assert.equal(Ink.readGraphProject(bundle).plan().materialMetadata.label, 'Copper clay');
  assert.equal(Ink.readGraphProject(bundle).run().outputs.area, 18);
  const extracted = Ink.unpackProject(bundle, { out: file('review') });
  const material = path.join(extracted.directory, 'copper.material.json');
  const { thumbnail } = Ink.describeMaterialMetadata(material);
  assert.deepEqual(fs.readFileSync(thumbnail.file), bytes);
});
