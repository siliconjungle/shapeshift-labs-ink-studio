'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const api = ink.load().KIT.meshTopology;
const { panel } = require('../examples/mesh-component-selection.cjs');
const assets = require('../examples/asset-part-revisions.cjs');

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => assert(Math.abs(n - expected[i]) < 1e-7, JSON.stringify({ actual, expected })));
};
const at = (plan, id) => plan.document.vertices.find(row => row.id === id).position;
const move = offset => ({ kind: 'move', offset });
const triangle = (id, positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]) =>
  api.fromIndexed({ id, positions, indices: [0, 1, 2] });
const choose = (doc, ...ids) => api.select(doc, ids.length ? { domain: 'vertices', ids } : { domain: 'faces' });

test('local, world and normal transforms keep stable topology and use an exact pivot', () => {
  const doc = triangle('placed'), selection = choose(doc);
  const frame = { matrix: [0, -2, 0, 3, 0, 0, 0, 0, 1], position: [8, 4, 2] };
  const local = api.planTransform(doc, { selection, frame, operation: move([1, 0, 0]) });
  const world = api.planTransform(doc, { selection, frame, space: 'world', operation: move([1, 0, 0]) });
  close(at(local, 'v/0'), [1, 0, 0]);
  close(at(world, 'v/0'), [0, -.5, 0]);
  const rotate = api.planTransform(doc, { selection, frame, space: 'world', pivot: [0, 0, 0],
    operation: { kind: 'rotate', axis: [0, 0, 1], degrees: 90 } });
  close(at(rotate, 'v/1'), [0, 1.5, 0]);
  assert.deepEqual(rotate.document.faces, doc.faces);
  assert.deepEqual(rotate.document.edges, doc.edges);
  const scaled = api.planTransform(doc, { selection, pivot: [0, 0, 0],
    operation: { kind: 'scale', factors: [2, 3, 1] } });
  close(at(scaled, 'v/2'), [0, 3, 0]);

  const upright = triangle('upright', [0, 0, 0, 0, 1, 0, 0, 0, 1]);
  const normal = api.planTransform(upright, { selection: choose(upright), space: 'normal', operation: move([0, 0, .25]) });
  close(at(normal, 'v/1'), [.25, 1, 0]);
  close(normal.report.axes[2], [1, 0, 0]);
  assert.throws(() => api.planTransform(scaled.document, { selection, operation: move([1, 0, 0]) }), /same topology revision/);
  assert.throws(() => api.planTransform(doc, { selection: choose(doc, 'v/1'), operation: move([-1, 0, 0]) }), /simple polygon/);
});

test('proportional edits taper along edges and stop at pinned and disconnected geometry', () => {
  const source = panel();
  source.vertices.push({ id: 'floating', position: [.905, .905, .01] });
  const doc = api.create(source);
  const plan = api.planTransform(doc, { selection: choose(doc, 'v/2/2'), operation: move([0, 0, .3]),
    pins: { vertices: ['v/2/3'], boundary: 'mesh' }, falloff: { radius: .9, curve: 'linear' } });
  close(at(plan, 'v/2/2'), [.9, .9, .3]);
  close(at(plan, 'v/1/2'), [.45, .9, .15]);
  close(at(plan, 'v/2/3'), [.9, 1.35, 0]);
  close(at(plan, 'v/0/2'), [0, .9, 0]);
  close(at(plan, 'floating'), [.905, .905, .01]);
  assert(plan.report.vertices.some(row => row.id === 'v/1/2' && !row.selected && row.weight < 1));
  const region = api.select(doc, { domain: 'faces', ids: ['f/1/1', 'f/2/1', 'f/1/2', 'f/2/2'] });
  const pinRim = api.planTransform(doc, { selection: region, operation: move([0, 0, .3]), pins: { boundary: 'selection' } });
  assert.deepEqual(pinRim.patch.vertices.map(row => row.id), ['v/2/2']);
});

test('mesh, plane and host socket snaps use the transformed anchor and report geometric evidence', () => {
  const doc = triangle('panel');
  const target = triangle('datum', [0, 0, 1, 2, 0, 1, 0, 2, 1]);
  const context = { mesh: id => id === 'datum' && { document: target },
    socket: (instance, binding) => instance === 'fixture' && binding === 'peg' ? [.15, .2, .8] : undefined };
  const spec = { selection: choose(doc), operation: move([.2, .25, .3]) };
  const to = snap => api.planTransform(doc, { ...spec, snap: { ...snap, anchor: 'v/0' } }, context);
  const point = to({ kind: 'vertex', id: 'v/0', object: 'datum' });
  close(at(point, 'v/0'), [0, 0, 1]);
  const edge = target.edges.find(row => row.vertices.join() === 'v/0,v/1');
  const projected = to({ kind: 'edge', id: edge.id, object: 'datum' });
  close(at(projected, 'v/0'), [.2, 0, 1]);
  close([projected.report.snap.t], [.1]);
  const face = to({ kind: 'face', id: 'f/0', object: 'datum' });
  close(at(face, 'v/0'), [.2, .25, 1]);
  close(face.report.snap.barycentric, [.775, .1, .125]);
  close(at(to({ kind: 'socket', instance: 'fixture', binding: 'peg' }), 'v/0'), [.15, .2, .8]);
  const plane = { kind: 'plane', origin: [0, 0, .95], normal: [0, 0, 1] };
  close(at(to(plane), 'v/0'), [.2, .25, .95]);
  const pivot = api.planTransform(doc, { ...spec, snap: plane, pivot: [0, 0, 0] });
  close(pivot.report.snap.from, [.2, .25, .3]);
  close(at(pivot, 'v/0'), [.2, .25, .95]);
  assert.throws(() => to({ ...plane, maxDistance: .1 }), /maximum distance/);
  assert.throws(() => api.planTransform(doc, { ...spec, pins: { vertices: ['v/0'] }, snap: { ...plane, anchor: 'v/0' } }), /unpinned/);
  assert(!Object.isFrozen(plane.origin));
});

function scene(doc) {
  return { id: 'workbench', style: 'slate',
    solids: [{ id: 'alignment-ball', kind: 'ball', at: [0, 0, 1], r: .5 }],
    topologyMeshes: { panel: { document: doc, part: 'cover' } } };
}

test('scene SDF snap works through CLI, native preview, undo and replay', t => {
  const doc = triangle('panel'), source = scene(doc);
  const editor = ink.createSceneEditor(source);
  const transform = { selection: choose(doc), operation: move([0, 0, .7]),
    snap: { kind: 'sdf', object: 'alignment-ball', anchor: 'v/0', maxDistance: 1 } };
  const planned = editor.planMeshTransform('panel', transform, { part: 'cover' });
  close(at(planned, 'v/0'), [0, 0, .5]);
  assert(Math.abs(planned.report.snap.residual) < 1e-5);
  assert.throws(() => editor.planMeshTransform('panel', { ...transform, snap: { ...transform.snap, maxDistance: .1 } }), /did not reach/);
  assert.throws(() => editor.planMeshTransform('panel', { ...transform, snap: { ...transform.snap, object: 'absent' } }), /No SDF snap target/);

  const design = { format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1, 1],
    palette: { ink: '#293d52' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'panel', scene: 'workbench', object: 'panel', part: 'cover' }],
    destinations: [{ id: 'geometry', kind: 'mesh-topology', binding: 'panel' }] };
  const session = ink.createPixelEditor(design, { sceneEditor: editor });
  const patch = { id: 'align', frame: 'front', revision: session.describe().revision,
    destination: 'geometry', operation: { transform } };
  patch.sourceRevision = session.previewEdit(patch).sourceRevision;
  const preview = session.previewEdit(patch);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.targets[0].transform, planned.report);
  session.apply(patch);
  const receipt = session.receipts()[0];
  assert.deepEqual(receipt.affectedTargets[0].transform, planned.report);
  assert.equal(session.undo(), true);
  assert.deepEqual(editor.snapshot(), source);
  const replay = ink.createPixelEditor(design, { sceneEditor: ink.createSceneEditor(source) });
  replay.replay(receipt);
  assert.deepEqual(replay.sceneEditor.meshTopology('panel').document, planned.document);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-component-transforms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  const cli = (...args) => execFileSync(process.execPath,
    [path.join(__dirname, '../cli/ink-studio.js'), 'mesh-topology', 'transform', ...args], { cwd: dir, encoding: 'utf8' });
  const { selection, ...request } = transform;
  write('scene', source);
  write('selection', selection);
  write('transform', request);
  const args = ['scene.json', 'transform.json', '--object', 'panel', '--selection', 'selection.json'];
  assert.deepEqual(JSON.parse(cli(...args)), { patch: planned.patch, report: planned.report });
  cli(...args, '--out', 'revised.json', '--report', 'report.json');
  assert.deepEqual(read('revised').topologyMeshes.panel.document, planned.document);
  assert.deepEqual(read('report').transform, planned.report);
});

test('native transforms cannot reshape derived hybrid topology', () => {
  const doc = triangle('panel'), source = scene(doc);
  source.hybridOwnership = { format: 'ink-studio/hybrid-ownership', version: 1,
    sources: { shape: { kind: 'sdf', target: { object: 'alignment-ball' } } },
    parts: [{ object: 'panel', part: 'cover', owners: {
      shape: { source: 'shape' }, pigment: { source: 'shape' }, coverage: { source: 'shape' }, detail: { source: 'shape' }
    } }] };
  const editor = ink.createSceneEditor(source);
  assert.throws(() => editor.transformMeshTopology('panel', {
    selection: choose(doc), operation: move([.2, 0, 0])
  }), /authored hybrid shape source/);
  assert.deepEqual(editor.snapshot(), source);
});

test('scene socket snaps use registered asset placement and its pinned binding', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-component-sockets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'relay-v1.glb');
  ink.writeGltfAsset(assets.source(1), { out: file });
  const source = scene(triangle('panel'));
  const placement = assets.scene().assetParts.relay;
  source.assetParts = { relay: placement };
  const imported = await ink.readAssetRevisionPart(file, 'relay', placement);
  const editor = ink.createSceneEditor(source, { env: { assetPartImports: { relay: imported } } });
  const plan = editor.planMeshTransform('panel', {
    selection: choose(source.topologyMeshes.panel.document), operation: move([0, 0, 0]),
    snap: { kind: 'socket', instance: 'relay', binding: 'lamp', anchor: 'v/0' }
  });
  close(at(plan, 'v/0'), [.53, 1.58, .28]);
  close(plan.report.snap.point, imported.part.bindings.lamp.resolved.position);
});
