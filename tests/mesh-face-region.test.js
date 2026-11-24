'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT } = ink.load(), api = KIT.meshTopology;
const sample = require('../examples/mesh-face-region/fixture.cjs');
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, String(actual));
const index = rows => new Map(rows.map(row => [row.id, row]));
const make = (doc, kind, distance, ids, options) => sample.request(api, doc, kind, kind, distance, ids, options);
const manifold = doc => api.inspect(doc).edges.every(edge => edge.uses.length === 2);
const solid = (doc, origin) => KIT.sceneMeshes.rayQuery(api.toSceneMesh(doc), KIT)({
  origin, direction: [0, 0, -1], maxDistance: 5
});
const permit = result => assert(result.report.canCommit, JSON.stringify(result.report.issues));

test('a multi-face annular extrusion retains the bore, authored corners and paint', () => {
  const doc = api.create(sample.collar()), ids = doc.faces.filter(face => face.id.startsWith('rim/')).map(face => face.id);
  const request = make(doc, 'extrude', .34, ids, { rim: { material: 'trim', uv: 'strip' } });
  const result = api.planFaceRegion(doc, request);
  permit(result);
  assert(manifold(result.document));
  const group = result.report.regions[0], faces = index(result.document.faces), before = index(doc.faces);
  assert.deepEqual(group.boundaries.map(loop => loop.length), [12, 12]);
  assert.equal(group.rimFaces.length, 24);
  assert.deepEqual(faces.get('back/0'), before.get('back/0'));
  for (const id of ids) {
    assert.equal(faces.get(id).material, before.get(id).material);
    assert.deepEqual(faces.get(id).corners.map(({ id, uv, attributes }) => ({ id, uv, attributes })),
      before.get(id).corners.map(({ id, uv, attributes }) => ({ id, uv, attributes })));
  }
  assert(solid(result.document, [0, 0, 2]) === null);
  close(solid(result.document, [.86, 0, 2]).point[2], .51);
  const sides = group.rimFaces.slice(0, 12).map(id => faces.get(id));
  assert(sides.every(face => face.material === 'trim'));
  assert.equal(sides[0].corners[0].uv[0], 0);
  assert.equal(sides.at(-1).corners[1].uv[0], 1);
  for (let i = 1; i < sides.length; i++) assert.equal(sides[i].corners[0].uv[0], sides[i - 1].corners[1].uv[0]);
  assert(result.report.lineage.edges.length > 0);
  assert.deepEqual(api.edit(doc, result.patch), result.document);
  assert.deepEqual(api.planFaceRegion(doc, request), result);
  assert.throws(() => api.planFaceRegion(result.document, request), /Stale/);
});

test('inset handles hole rings and recesses report remaining wall and swept contacts', () => {
  const collar = api.create(sample.collar());
  const ids = collar.faces.filter(face => face.id.startsWith('rim/')).map(face => face.id);
  const insetRing = api.planFaceRegion(collar, make(collar, 'inset', .06, ids));
  permit(insetRing);
  assert.strictEqual(solid(insetRing.document, [0, 0, 2]), null);
  assert(insetRing.report.regions[0].boundaries.length === 2);
  assert(manifold(insetRing.document));

  const doc = api.create(sample.meter());
  const inset = api.planFaceRegion(doc, make(doc, 'inset', .21, ['gauge'], { rim: { material: 'brass', uv: 'per-edge' } }));
  permit(inset);
  const insetFaces = index(inset.document.faces), insetVertices = index(inset.document.vertices);
  const insetGauge = insetFaces.get('gauge');
  close(insetVertices.get(insetGauge.corners[0].vertex).position[0], -1.09);
  close(insetVertices.get(insetGauge.corners[0].vertex).position[1], -.67);
  for (const id of inset.report.regions[0].rimFaces) {
    assert.equal(insetFaces.get(id).material, 'brass');
    assert.deepEqual(insetFaces.get(id).corners.map(c => c.uv), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  assert.throws(() => api.planFaceRegion(doc, make(doc, 'inset', 1.1, ['gauge'])), /collapses rim/);
  const recess = distance => api.planFaceRegion(inset.document, make(inset.document, 'extrude', distance, ['gauge'], { minWall: .18 }));
  permit(recess(-.38));
  const thin = recess(-.76), through = recess(-1);
  assert.equal(thin.report.canCommit, false);
  assert.deepEqual(thin.report.issues.map(row => row.kind), ['thin-wall']);
  assert.deepEqual(thin.report.wall.closest.faces, ['gauge', 'back']);
  close(thin.report.wall.closest.distance, .06);
  assert(through.report.sweep.count > 0);
  assert.equal(through.report.canCommit, false);
});

test('thicken creates an oriented skin and seam walls and guards against shell collapse', () => {
  const doc = api.create(sample.canopy());
  const result = api.planFaceRegion(doc, make(doc, 'thicken', .25, doc.faces.map(face => face.id), {
    minWall: .16, rim: { material: 'edge' }, interior: { material: 'lining', uv: 'planar' }
  }));
  permit(result);
  assert(manifold(result.document));
  const faces = index(result.document.faces), vertices = index(result.document.vertices);
  const inner = result.report.regions[0].interiorFaces.map(id => faces.get(id));
  assert.equal(inner.length, doc.faces.length);
  assert(inner.every(face => face.material === 'lining' && new Set(face.corners.map(corner => String(corner.uv))).size === 4));
  assert.equal(result.report.regions[0].rimFaces.length, 20);
  assert.deepEqual(result.document.faces.slice(0, doc.faces.length), doc.faces);
  assert.deepEqual(result.report.vertices.map(({ id }) => vertices.get(id).weights),
    Array.from({ length: doc.vertices.length }, () => ({ chassis: 1 })));
  assert.equal(result.report.lineage.corners.length, 36);
  assert.equal(result.report.lineage.faces.length, 9);
  assert.throws(() => api.planFaceRegion(doc, make(doc, 'thicken', .25, ['roof/1'])), /complete surface islands/);
  const box = api.create(sample.meter()), ids = box.faces.map(face => face.id);
  const hollow = api.planFaceRegion(box, make(box, 'thicken', .19, ids));
  permit(hollow);
  assert(manifold(hollow.document));
  assert.equal(hollow.report.regions[0].rimFaces.length, 0);
  const folded = api.planFaceRegion(box, make(box, 'thicken', .5, ids));
  assert(folded.report.issues.some(issue => issue.kind === 'flipped-region'));
});

test('an obstacle between the old and new faces blocks extrusion even with free endpoints', () => {
  const doc = sample.meter();
  doc.vertices.push(...[[-.2, -.2, .45], [.2, -.2, .45], [0, .2, .45]].map((position, i) => ({ id: 'probe/' + i, position })));
  doc.faces.push({ id: 'probe', corners: Array.from({ length: 3 }, (_, i) => ({ id: 'contact/' + i, vertex: 'probe/' + i })) });
  const result = api.planFaceRegion(doc, make(doc, 'extrude', .4, ['gauge'], { minWall: .01 }));
  assert.equal(result.report.health.counts.selfIntersections, 0);
  assert(result.report.sweep.hits.some(hit => hit.face === 'gauge' && hit.vertex.startsWith('probe/')));
  assert.equal(result.report.canCommit, false);
});

test('scene, bound pixel edits and CLI share the same checked transaction', t => {
  const doc = api.create(sample.meter());
  const scene = { id: 'workbench', style: 'slate', solids: [], topologyMeshes: { meter: { document: doc, part: 'gauge',
    bindings: [{ id: 'paint', domain: 'faces', element: 'gauge' }], bakes: [{ id: 'dial-map', material: 'dial', maps: { roughness: .4 } }] } } };
  const editor = ink.createSceneEditor(scene);
  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { chalk: '#c3aa76' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'meter', scene: 'workbench', object: 'meter', part: 'gauge' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'meter' }] };
  const pixels = ink.createPixelEditor(design, { sceneEditor: editor });
  const inset = make(doc, 'inset', .21, ['gauge']);
  const preview = editor.planMeshFaceRegion('meter', inset);
  const patch = { id: 'edit-gauge', frame: 'front', revision: pixels.describe().revision, destination: 'geometry',
    operation: { faceRegion: inset } };
  patch.sourceRevision = pixels.previewEdit(patch).sourceRevision;
  const diff = pixels.previewEdit(patch, { exact: true });
  assert(diff.valid, JSON.stringify(diff.conflicts));
  assert.deepEqual(diff.targets[0].faceRegion, preview.report);
  pixels.apply(patch);
  const revised = editor.snapshot(), receipt = pixels.receipts()[0];
  assert.equal(revised.topologyMeshes.meter.bindings[0].element, 'gauge');
  assert(revised.topologyMeshes.meter.bakes[0].invalidated.faces.includes('gauge'));
  assert(pixels.undo());
  assert.deepEqual(editor.meshTopology('meter').document, doc);
  pixels.replay(receipt);
  assert.deepEqual(editor.snapshot(), revised);

  const blocked = make(preview.document, 'extrude', -.76, ['gauge'], { minWall: .18 });
  assert.throws(() => editor.editMeshFaceRegion('meter', blocked), error => error.report.issues[0].kind === 'thin-wall');
  assert.deepEqual(editor.snapshot(), revised);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-face-region-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const cli = (scene, request, out, report) => spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'),
    'mesh-topology', 'face-region', scene, request, '--object', 'meter', '--out', out, '--report', report],
  { cwd: dir, encoding: 'utf8' });
  write('scene.json', scene);
  write('inset.json', inset);
  const success = cli('scene.json', 'inset.json', 'revised.json', 'inset-report.json');
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(read('revised.json'), revised);
  assert.deepEqual(read('inset-report.json').faceRegion, preview.report);
  write('blocked.json', blocked);
  const failure = cli('revised.json', 'blocked.json', 'should-not-exist.json', 'blocked-report.json');
  assert.equal(failure.status, 1, failure.stderr);
  assert(!fs.existsSync(path.join(dir, 'should-not-exist.json')));
  assert.equal(read('blocked-report.json').canCommit, false);
});
