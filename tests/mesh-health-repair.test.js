'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const api = ink.load().KIT.meshTopology;

function fixture() {
  const vertices = [], faces = [];
  function points(entries) {
    for (const [id, position, weights] of entries) vertices.push({ id, position, ...(weights && { weights }) });
  }
  function face(id, material, ring, uvs) {
    faces.push({ id, material, corners: ring.map((vertex, i) => ({ id: id + '/' + vertex, vertex, uv: uvs?.[i] ?? [0, 0] })) });
  }
  return { points, face, mesh: () => api.create({ id: 'fixture', vertices, faces }) };
}

function select(doc, ids) { return api.select(doc, { domain: 'faces', ids }); }
function plan(doc, ...operations) { return api.planRepair(doc, { revision: api.revision(doc), operations }); }

test('health uses local incidence, a broad phase and bounded pair evidence', () => {
  const f = fixture();
  f.points([
    ['a', [0, 0, 0]], ['b', [1, 0, 0]], ['c', [0, 1, 0]], ['d', [0, -1, 0]], ['e', [0, 0, 1]],
    ['wa', [3, 0, 0]], ['wb', [4, 0, 0]], ['wc', [3, 1, 0]], ['wd', [3, -1, 0]],
    ['p', [6, 0, 0]], ['q', [7, 0, 0]], ['r', [6, .001, 0]], ['dup', [6, 0, 0]],
    ['i', [9, 0, 0]], ['j', [10, 0, 0]], ['k', [9, 1, 0]],
    ['l', [9.3, .2, -.25]], ['m', [9.3, .2, .25]], ['n', [9.3, .8, 0]],
    ['o', [9.1, .12, 0]], ['s', [9.14, .12, 0]], ['t', [9.1, .17, 0]]
  ]);
  f.face('fan-a', 'paint', ['a', 'b', 'c']);
  f.face('fan-b', 'paint', ['b', 'a', 'd']);
  f.face('fan-c', 'paint', ['b', 'a', 'e']);
  f.face('upright', 'paint', ['wa', 'wb', 'wc']);
  f.face('reversed', 'paint', ['wa', 'wb', 'wd']);
  f.face('sliver', 'paint', ['p', 'q', 'r']);
  f.face('crossed', 'stone', ['i', 'j', 'k']);
  f.face('crossing', 'stone', ['l', 'm', 'n']);
  f.face('overlap', 'stone', ['o', 's', 't']);
  const doc = f.mesh(), report = api.health(doc);
  assert.equal(report.complete, true);
  assert.equal(report.counts.nonManifold, 1);
  assert.deepEqual(report.findings.nonManifold[0].faces, ['fan-a', 'fan-b', 'fan-c']);
  assert.deepEqual(report.findings.winding[0].faces, ['reversed', 'upright']);
  assert.deepEqual(report.findings.duplicates.map(row => row.vertices), [['dup', 'p']]);
  assert.deepEqual(report.findings.slivers.map(row => row.face), ['sliver']);
  assert.deepEqual(report.findings.selfIntersections.map(row => row.kind).sort(), ['coplanar', 'crossing']);
  assert(report.findings.selfIntersections.every(row => row.point.every(Number.isFinite)));
  const local = api.health(doc, { selection: select(doc, ['crossing']) });
  assert.equal(local.counts.selfIntersections, 1);
  assert.equal(local.counts.slivers, 0);
  assert.equal(local.counts.nonManifold, 0);
  const reverseScope = api.health(doc, { selection: select(doc, ['sliver']) });
  assert.deepEqual(reverseScope.findings.duplicates.map(row => row.vertices), [['dup', 'p']]);
  const limited = api.health(doc, { maxPairs: 1, limit: 1 });
  assert.equal(limited.complete, false);
  assert.equal(limited.work.trianglePairs, 1);
});

test('coplanar duplicate faces still intersect when they share every boundary edge', () => {
  const f = fixture();
  f.points([['a', [0, 0, 0]], ['b', [2, 0, 0]], ['c', [0, 2, 0]]]);
  f.face('front', 'paint', ['a', 'b', 'c']);
  f.face('back', 'paint', ['c', 'b', 'a']);
  const issues = api.health(f.mesh());
  assert.equal(issues.counts.winding, 0);
  assert.deepEqual(issues.findings.selfIntersections.map(row => row.kind), ['coplanar']);
});

function plates() {
  const f = fixture();
  f.points([
    ['a', [0, 0, 0]], ['b', [1, 0, 0], { lower: .75, upper: .25 }], ['c', [1, 1, 0], { lower: 1 }], ['d', [0, 1, 0]],
    ['e', [1.005, 0, 0], { lower: .25, upper: .75 }], ['f', [2, 0, 0]], ['g', [2, 1, 0]], ['h', [1.005, 1, 0], { lower: 1 }],
    ['i', [3, 0, 0]], ['j', [4, 0, 0]], ['k', [4, 1, 0]], ['l', [3, 1, 0]]
  ]);
  f.face('left', 'ochre', ['a', 'b', 'c', 'd'], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  f.face('right', 'green', ['e', 'h', 'g', 'f'], [[0, 0], [0, 1], [1, 1], [1, 0]]);
  f.face('trim', 'black', ['i', 'j', 'k'], [[0, 0], [1, 0], [1, 1]]);
  f.face('trim-b', 'black', ['i', 'k', 'l'], [[0, 0], [1, 1], [0, 1]]);
  return f.mesh();
}

const weldA = { kind: 'weld', keep: 'b', remove: ['e'], maxDistance: .01, weights: 'average' };
const weldB = { kind: 'weld', keep: 'c', remove: ['h'], maxDistance: .01 };
const winding = { kind: 'winding', anchor: 'left' };

test('repair receipts retain corner UV seams, state weight policy and trace a dissolved face', () => {
  const doc = plates();
  const edge = doc.edges.find(row => row.vertices.join() === 'i,k').id;
  assert.throws(() => plan(doc, { ...weldA, weights: 'match' }), /weights differ/);
  assert.throws(() => plan(doc, { ...weldA, maxDistance: .001 }), /maximum distance/);
  const result = plan(doc, weldA, weldB, winding, { kind: 'dissolve', edge, keep: 'trim' });
  assert.equal(result.report.canCommit, true);
  assert.equal(result.document.faces.length, 3);
  assert.deepEqual(result.report.steps[2].reversed, ['right']);
  assert.deepEqual(result.patch.lineage.faces, [{ from: 'trim-b', to: 'trim' }]);
  assert.deepEqual(result.report.changes.weights.find(row => row.id === 'b'),
    { id: 'b', before: { lower: .75, upper: .25 }, after: { lower: .5, upper: .5 } });
  assert.deepEqual(result.report.changes.weights.find(row => row.id === 'e').after, null);
  const seam = result.report.changes.seams.after.find(row => row.seam);
  assert.deepEqual(seam.vertices, ['b', 'c']);
  assert.deepEqual(seam.uses.map(row => row.corners.map(corner => corner.uv)), [[[1, 0], [1, 1]], [[0, 0], [0, 1]]]);
  assert.deepEqual(result.report.changes.materials.find(row => row.id === 'trim-b'),
    { id: 'trim-b', before: 'black', after: null });
  assert.equal(api.health(result.document).counts.winding, 0);
  assert.equal(api.health(result.document).counts.selfIntersections, 0);
  const retained = api.edit(result.document, { vertices: [{ id: 'b', position: [1.01, 0, 0] }] });
  assert.deepEqual(retained.vertices.find(row => row.id === 'b').weights, { lower: .5, upper: .5 });
  assert.throws(() => api.planRepair(retained, { revision: result.report.afterRevision, operations: [winding] }), /Stale/);
  assert.throws(() => plan(result.document, { kind: 'dissolve', edge: seam.id }), /material boundary/);
  const oneMaterial = api.edit(result.document, { faces: [{ ...result.document.faces.find(row => row.id === 'right'), material: 'ochre' }] });
  assert.throws(() => plan(oneMaterial, { kind: 'dissolve', edge: seam.id }), /UV seam/);
  const changed = api.edit(doc, { faces: [{ ...doc.faces[3],
    corners: doc.faces[3].corners.map((row, i) => i === 2 ? { ...row, uv: [.2, 1] } : row) }] });
  assert.throws(() => plan(changed, { kind: 'dissolve', edge }), /UV interpolation/);
  const weighted = api.edit(doc, { vertices: [{ id: 'l', position: [3, 1, 0], weights: { hinge: 1 } }] });
  assert.throws(() => plan(weighted, { kind: 'dissolve', edge }), /weight interpolation.*hinge/);
  const creased = api.edit(doc, { vertices: [{ id: 'l', position: [3, 1, .2] }] });
  assert.throws(() => plan(creased, { kind: 'dissolve', edge }), /geometric crease/);
});

function scene(doc) {
  return { id: 'workbench', style: 'slate', solids: [], topologyMeshes: { panel: { document: doc, part: 'plate' } } };
}

test('topology editor and CLI reject welding a third face onto a manifold edge', t => {
  const f = fixture();
  f.points([['a', [0, 0, 0]], ['b', [1, 0, 0]], ['c', [0, 1, 0]], ['d', [0, -1, 0]],
    ['e', [0, 0, 0]], ['f', [1, 0, 0]], ['g', [0, 0, 1]]]);
  f.face('top', 'paint', ['a', 'b', 'c']);
  f.face('bottom', 'paint', ['b', 'a', 'd']);
  f.face('third', 'paint', ['f', 'e', 'g']);
  const doc = f.mesh();
  const operations = ['a', 'b'].map((keep, i) => ({ kind: 'weld', keep, remove: [i ? 'f' : 'e'], maxDistance: 0 }));
  const request = { revision: api.revision(doc), operations };
  const source = scene(doc), editor = ink.createSceneEditor(source);
  assert.deepEqual(editor.meshHealth('panel', undefined, { part: 'plate' }).counts, api.health(doc).counts);
  const preview = editor.planMeshRepair('panel', request);
  assert.equal(preview.report.canCommit, false);
  assert.equal(preview.report.blockers[0].code, 'new-non-manifold-edge');
  assert.throws(() => editor.repairMeshTopology('panel', request), /non-manifold edge/);
  assert.deepEqual(editor.snapshot(), source);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-repair-blocked-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'mesh.json'), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, 'repair.json'), JSON.stringify(request));
  const args = [path.join(__dirname, '../cli/ink-studio.js'), 'mesh-topology', 'repair', 'mesh.json', 'repair.json'];
  const result = spawnSync(process.execPath, [...args, '--out', 'out.json', '--report', 'report.json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, 'out.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'))).blockers, preview.report.blockers);
});

test('repair runs through pixel preview, scene undo, and replay of the same receipt', () => {
  const doc = plates(), source = scene(doc), editor = ink.createSceneEditor(source);
  const operations = [weldA, weldB, winding];
  const repair = { revision: api.revision(doc), operations };
  const planned = editor.planMeshRepair('panel', repair);
  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { ink: '#293d52' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'panel', scene: 'workbench', object: 'panel', part: 'plate' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'panel' }] };
  const pixels = ink.createPixelEditor(design, { sceneEditor: editor });
  const patch = { id: 'repair', frame: 'front', revision: pixels.describe().revision,
    destination: 'geometry', operation: { repair } };
  patch.sourceRevision = pixels.previewEdit(patch).sourceRevision;
  const preview = pixels.previewEdit(patch, { exact: true });
  assert.equal(preview.valid, true, JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].repair, planned.report);
  pixels.apply(patch);
  const receipt = pixels.receipts()[0];
  assert.deepEqual(receipt.affectedTargets[0].repair, planned.report);
  assert.deepEqual(editor.meshTopology('panel').document, planned.document);
  assert.equal(pixels.undo(), true);
  assert.deepEqual(editor.snapshot(), source);
  const replay = ink.createPixelEditor(design, { sceneEditor: ink.createSceneEditor(source) });
  replay.replay(receipt);
  assert.deepEqual(replay.sceneEditor.meshTopology('panel').document, planned.document);
});

test('a weld removes a collapsed sliver only when requested', () => {
  const f = fixture();
  f.points([['a', [0, 0, 0]], ['b', [1, 0, 0]], ['c', [1, .0001, 0]], ['d', [0, 1, 0]]]);
  f.face('sliver', 'ochre', ['a', 'b', 'c']);
  f.face('panel', 'ochre', ['a', 'c', 'd']);
  const doc = f.mesh(), op = { kind: 'weld', keep: 'b', remove: ['c'], maxDistance: .0002 };
  assert.equal(api.health(doc).counts.slivers, 1);
  assert.throws(() => plan(doc, op), /collapses face sliver/);
  const repaired = plan(doc, { ...op, removeCollapsed: true });
  assert.deepEqual(repaired.report.steps[0].removedFaces, ['sliver']);
  assert.equal(api.health(repaired.document).counts.slivers, 0);
});
