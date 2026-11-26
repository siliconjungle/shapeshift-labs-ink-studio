const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { KIT: K } = require('..').load();
const T = K.meshTopology, UV = T.uvPreparation;

function fixture({ paintOverlap = false, alternate = false } = {}) {
  const vertices = [], faces = [];
  const pos = (id, position) => {
    if (!vertices.some(row => row.id === id)) vertices.push({ id, position });
    return id;
  };
  const face = (id, material, keys, uv, pin = false) => faces.push({ id, material, corners: keys.map((vertex, i) => ({
    id: id + '/' + i, vertex, uv: uv[i], ...(pin && i === 0 && { uvPinned: true }),
    ...(alternate && { attributes: { 'uv/1': uv[i] } })
  })) });
  const a = pos('a', [0, 0, 0]), b = pos('b', [1.5, 0, 0]), c = pos('c', [1.5, 1, 0]), d = pos('d', [0, 1, 0]);
  const e = pos('e', [1.5, 1, -.9]), f = pos('f', [0, 1, -.9]);
  const u = [[.12, .2], [.59, .24], [.59, .35], [.12, .32]];
  face('front', 'metal', [a, b, c, d], u);
  face('cover', 'metal', [d, c, e, f], [u[3], u[2], u[1], u[0]]);
  for (let side = 0; side < 2; side++) {
    const x = 2 + side * 1.9;
    face('plate-' + side, 'metal', [[x, 0, 0], [x+1.5, 0, 0], [x+1.5, 1, 0], [x, 1, 0]]
      .map((p, i) => pos('plate-' + side + '-' + i, p)), u);
  }
  const painted = [[.15,.18],[.65,.18],[.65,.68],[.15,.68]];
  const label = (id, x) => face(id, 'ink', [[x, 0, 0], [x+.95, 0, 0], [x+.95,.95,0], [x,.95,0]]
    .map((p, i) => pos(id + '-' + i, p)), painted, true);
  label('label', -1.2);
  if (paintOverlap) label('label-2', -2.5);
  return T.create({ id: 'relay', vertices, faces, ...(alternate && { uvBindings: { pigment: 0, bake: 1 } }) });
}

const request = { atlas: [24, 24], texelsPerUnit: 10, densityTolerance: .12, seamAngle: 50, gutter: 2, maxTiles: 12 };
const atlasFor = id => id === 'ink' ? { size: [20, 20], kind: 'tileset' } : undefined;
const find = (doc, id) => doc.faces.find(row => row.id === id);

test('whole mesh preparation stages creases, repairs overlap and distortion, and emits native UV pages', () => {
  const input = fixture(), plan = UV.prepare(input, { ...request, revision: T.revision(input) }, { atlasFor });
  const { report, layout, document } = plan;
  assert(report.canCommit, JSON.stringify(report.failures));
  assert(report.before.overlapCount > 0);
  assert(report.before.faces.some(row => row.reasons.includes('distortion')));
  assert.equal(report.after.overlapCount, 0);
  assert.equal(report.after.failedFaces.length, 0);
  assert(report.proposedSeams.some(row => row.reason === 'crease' && row.faces.includes('cover')));
  assert(report.proposedSeams.some(row => document.edges.find(edge => edge.id === row.edge).uvSeam));
  assert(layout.tiles.length > 2);
  assert.deepEqual(find(document, 'label'), find(input, 'label'));
  assert.deepEqual(report.preserved.pins[0].texel, [.15 * 19, .18 * 19]);
  assert.deepEqual(document.vertices, input.vertices);
  assert(UV.validate(document, { texelsPerUnit: 10 }, { layout }).clean);
  assert(T.toSceneMesh(document).triangles > 0);
  assert.throws(() => UV.validate(input, { texelsPerUnit: 10 }, { layout }), /different document or set/);
});

test('capacity and overlapping protected charts leave the source transaction intact', () => {
  const input = fixture();
  const small = UV.prepare(input, { ...request, maxTiles: 2 }, { atlasFor });
  assert(!small.report.canCommit);
  assert.equal(small.document, input);
  assert(small.report.failures.some(row => row.code === 'tile-budget'));
  const collision = fixture({ paintOverlap: true });
  const blocked = UV.prepare(collision, request, { atlasFor });
  assert.equal(blocked.document, collision);
  assert(!blocked.layout);
  assert(blocked.report.failures.some(row => row.code === 'unresolved-overlap' && row.faces.includes('label-2')));
});

test('alternate layout preparation leaves all pigment addresses and intrinsic pins untouched', () => {
  const input = fixture({ alternate: true }), { document, layout } = UV.prepare(input,
    { ...request, uvSet: 'bake', protect: { painted: [{ id: 'label', faces: ['label'] }] } }, { atlasFor });
  assert(layout);
  assert.equal(layout.uvSet, 1);
  for (const face of document.faces) assert.deepEqual(face.corners.map(c => [c.uv, c.uvPinned]),
    find(input, face.id).corners.map(c => [c.uv, c.uvPinned]));
  assert.deepEqual(document.uvBindings, input.uvBindings);
  assert(document.faces.some(face => face.material.startsWith('uv-page-')));
});

test('CLI scene preparation holds registered pigment and batch validation distinguishes source and prepared layouts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-uv-preparation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = name => path.join(directory, name);
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const pigment = Array.from({ length: 20 * 20 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 241);
  save('scene.json', { id: 'relay-fixture', style: 'slate', solids: [],
    topologyMeshes: { relay: { document: fixture(), materials: [{ id: 'metal', color: 0xb45844 },
      { id: 'ink', texture: { width: 20, height: 20, pixels: pigment } }] } } });
  save('request.json', request);
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, 'mesh-uv', ...args], { encoding: 'utf8' });
  const result = JSON.parse(run('prepare', file('scene.json'), file('request.json'), '--out', file('prepared.json'),
    '--layout-out', file('layout.json')));
  assert(result.canCommit);
  const revised = read('prepared.json').topologyMeshes.relay;
  assert.deepEqual(revised.materials.find(row => row.id === 'ink').texture.pixels, pigment);
  assert.deepEqual(find(revised.document, 'label'), find(fixture(), 'label'));
  assert(revised.materials.some(row => row.id.startsWith('uv-page-') && row.color === 0xb45844));
  save('batch.json', { format: 'ink-studio/uv-density-batch', version: 1, settings: { texelsPerUnit: 10, atlas: [24, 24] },
    assets: [{ id: 'original', file: 'scene.json' }, { id: 'prepared', file: 'prepared.json', layout: 'layout.json' }] });
  const checked = spawnSync(process.execPath, [cli, 'mesh-uv', 'validate-batch', file('batch.json'), '--out', file('density.json')],
    { encoding: 'utf8' });
  assert.equal(checked.status, 1, checked.stderr);
  const validation = read('density.json');
  assert.equal(validation.failed, 1);
  assert.equal(validation.passed, 1);
  assert(validation.assets[1].clean);
});
