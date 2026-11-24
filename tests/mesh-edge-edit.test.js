'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT } = ink.load(), api = KIT.meshTopology;
const { coupler, panel, rim, edgeSelection, request } = require('../examples/mesh-edge-edit/fixture.cjs');

const index = rows => new Map(rows.map(row => [row.id, row]));
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, String(actual));
const pass = plan => assert(plan.report.canCommit, JSON.stringify(plan.report.issues));
const bore = (doc, origin) => KIT.sceneMeshes.rayQuery(api.toSceneMesh(doc), KIT)({
  origin, direction: [0, 0, -1], maxDistance: 6
});
const seed = (doc, i) => edgeSelection(api, doc, ends => ends.includes('heel/' + i) && ends.includes('nose/' + i));
const insertion = doc => ({ kind: 'insert-loop', selection: seed(doc, 0), start: 'heel/0', fraction: .4 });

test('loop insertion splits quad strips with face-specific corner data and inherited weights', () => {
  const doc = api.create(coupler(false));
  const spec = request(api, doc, 'insert', insertion(doc));
  const plan = api.planEdgeEdit(doc, spec), after = plan.document;
  pass(plan);
  assert.equal(after.faces.length, doc.faces.length + 8);
  assert.equal(plan.report.detail.transitionFaces.length, 0);
  assert.equal(plan.report.lineage.edges.length, 16);
  assert.equal(plan.report.lineage.faces.length, 8);
  assert(api.inspect(after).edges.every(edge => edge.uses.length === 2));
  assert.deepEqual(after.vertices.slice(0, doc.vertices.length), doc.vertices);
  const newId = plan.report.detail.vertices[0].id, row = index(after.vertices).get(newId);
  assert.deepEqual(row.weights, { root: .6, tip: .4 });
  const use = after.faces.flatMap(face => face.corners.filter(corner => corner.vertex === newId));
  assert.equal(use.length, 4);
  assert.equal(new Set(use.map(corner => corner.uv[0])).size, 2);
  assert.equal(new Set(use.map(corner => corner.attributes.heat)).size, 2);
  for (const { from, to } of plan.report.lineage.faces)
    assert.equal(index(after.faces).get(to).material, index(doc.faces).get(from).material);
  const retained = index(after.faces.flatMap(face => face.corners));
  for (const corner of doc.faces.flatMap(face => face.corners)) assert.deepEqual(retained.get(corner.id), corner);
  assert.deepEqual(api.edit(doc, plan.patch), after);
  assert.deepEqual(api.planEdgeEdit(doc, spec), plan);
  assert.throws(() => api.planEdgeEdit(after, spec), /Stale/);
});

test('insertion stops at a pinned edge and slide follows rails while retaining UVs and pin positions', () => {
  const doc = api.create(coupler(false)), protectedEdge = seed(doc, 1).ids[0];
  const ended = api.planEdgeEdit(doc, request(api, doc, 'partial', insertion(doc), { edges: [protectedEdge] }));
  pass(ended);
  assert.deepEqual(ended.report.detail.stoppedAt, [protectedEdge]);
  assert.equal(ended.report.detail.transitionFaces.length, 2);
  assert.deepEqual(index(ended.document.edges).get(protectedEdge), index(doc.edges).get(protectedEdge));

  const inserted = api.planEdgeEdit(doc, request(api, doc, 'insert', insertion(doc)));
  const middle = inserted.document, ids = new Set(inserted.report.detail.vertices.map(row => row.id));
  const pinned = ids.values().next().value;
  const operation = { kind: 'slide', selection: edgeSelection(api, middle, ends => ends.every(id => ids.has(id))), amount: .35 };
  const plan = api.planEdgeEdit(middle, request(api, middle, 'slide', operation, { vertices: [pinned] }));
  pass(plan);
  assert.equal(plan.report.detail.rails.length, 7);
  assert.deepEqual(plan.report.detail.pinned, [pinned]);
  assert.deepEqual(plan.document.faces, middle.faces);
  assert.deepEqual(plan.document.edges, middle.edges);
  const before = index(middle.vertices), after = index(plan.document.vertices);
  for (const row of before.values()) if (!ids.has(row.id) || row.id === pinned) assert.deepEqual(after.get(row.id), row);
  for (const { vertex, toward } of plan.report.detail.rails) {
    assert.deepEqual(after.get(vertex).weights, before.get(vertex).weights);
    const p = before.get(vertex).position, q = before.get(toward).position;
    after.get(vertex).position.forEach((n, i) => near(n, p[i] + (q[i] - p[i]) * .35));
  }
});

test('bridge aligns two complete rims and grid fill builds a four-by-two patch on the same border', () => {
  const gap = api.create(coupler());
  const bridge = { kind: 'bridge', first: rim(api, gap, 'heel'), second: rim(api, gap, 'nose'), segments: 2, uv: 'inherit' };
  const result = api.planEdgeEdit(gap, request(api, gap, 'bridge', bridge, { boundary: true }));
  pass(result);
  assert.equal(result.report.detail.faces.length, 16);
  assert.equal(result.report.detail.vertices.length, 8);
  assert(result.report.detail.pairs.every(([a, b]) => a.split('/')[1] === b.split('/')[1]));
  assert(api.inspect(result.document).edges.every(edge => edge.uses.length === 2));
  assert.deepEqual(result.document.vertices.slice(0, gap.vertices.length), gap.vertices);
  assert.deepEqual(result.document.faces.slice(0, gap.faces.length), gap.faces);
  assert(result.patch.vertices.every(({ weights }) => weights.root === .5 && weights.tip === .5));
  assert(result.patch.faces.some(face => face.material === 'oxide'));
  assert(result.patch.faces.some(face => face.material === 'enamel'));
  const first = result.patch.faces[0], sourceEdge = result.report.detail.faces[0].edges[0];
  const sourceUse = api.inspect(gap).edges.find(edge => edge.id === sourceEdge).uses[0];
  const corner = index(gap.faces.flatMap(face => face.corners));
  assert.deepEqual(first.corners.slice(0, 2).map(row => row.uv), [corner.get(sourceUse.to).uv, corner.get(sourceUse.from).uv]);

  const frame = api.create(panel()), selection = rim(api, frame, 'inner');
  const fill = { kind: 'grid-fill', selection, start: 'inner/0', columns: 4 };
  const filled = api.planEdgeEdit(frame, request(api, frame, 'panel', fill, { boundary: true }));
  pass(filled);
  assert.equal(filled.report.detail.columns, 4);
  assert.equal(filled.report.detail.rows, 2);
  assert.equal(filled.patch.vertices.length, 3);
  assert.equal(filled.patch.faces.length, 8);
  assert(filled.patch.faces.every(face => face.corners.length === 4));
  assert.deepEqual(filled.document.faces.slice(0, frame.faces.length), frame.faces);
  assert.deepEqual(filled.document.vertices.slice(0, frame.vertices.length), frame.vertices);
  const edges = index(api.inspect(filled.document).edges);
  assert(selection.ids.every(id => edges.get(id).uses.length === 2));
  near(filled.patch.vertices[1].weights.root, .5);
  assert.strictEqual(bore(frame, [0, 0, 2]), null);
  near(bore(filled.document, [0, 0, 2]).point[2], .22);
});

test('checked SDK, bound-pixel transactions, and CLI replay use one mesh patch', t => {
  const doc = api.create(coupler());
  const scene = { id: 'bench', style: 'slate', solids: [], topologyMeshes: { coupler: { document: doc, part: 'joint',
    bindings: [{ id: 'mount', domain: 'faces', element: 'front-plate' }] } } };
  const editor = ink.createSceneEditor(scene);
  const operation = { kind: 'bridge', first: rim(api, doc, 'heel'), second: rim(api, doc, 'nose'), segments: 2 };
  const safe = request(api, doc, 'bridge', operation, { boundary: true });
  const bad = request(api, doc, 'twist', { ...operation, offset: 4 });
  const expected = editor.planMeshEdgeEdit('coupler', safe);
  assert.throws(() => editor.editMeshEdges('coupler', bad), error => !error.report.canCommit);
  assert.deepEqual(editor.meshTopology('coupler').document, doc);

  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { chalk: '#c3aa76' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'joint', scene: 'bench', object: 'coupler', part: 'joint' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'joint' }] };
  const pixels = ink.createPixelEditor(design, { sceneEditor: editor });
  const patch = { id: 'bridge-part', frame: 'front', revision: pixels.describe().revision, destination: 'geometry',
    operation: { edgeEdit: safe } };
  patch.sourceRevision = pixels.previewEdit(patch).sourceRevision;
  const preview = pixels.previewEdit(patch, { exact: true });
  assert(preview.valid, JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].edgeEdit, expected.report);
  pixels.apply(patch);
  const receipt = pixels.receipts()[0], revised = editor.snapshot();
  assert.deepEqual(editor.meshTopology('coupler').document, expected.document);
  assert.equal(revised.topologyMeshes.coupler.bindings[0].element, 'front-plate');
  assert(pixels.undo());
  assert.deepEqual(editor.meshTopology('coupler').document, doc);
  pixels.replay(receipt);
  assert.deepEqual(editor.snapshot(), revised);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-edge-edit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const cli = (name, output) => spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'),
    'mesh-topology', 'edge-edit', 'scene.json', name + '.json', '--object', 'coupler',
    '--out', output + '.json', '--report', name + '-report.json'], { cwd: dir, encoding: 'utf8' });
  write('scene.json', scene);
  write('safe.json', safe);
  write('bad.json', bad);
  const accepted = cli('safe', 'revised');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(read('revised.json'), revised);
  assert.deepEqual(read('safe-report.json').edgeEdit, expected.report);
  assert.equal(cli('bad', 'blocked').status, 1);
  assert.equal(read('bad-report.json').canCommit, false);
  assert(!fs.existsSync(path.join(dir, 'blocked.json')));
});
