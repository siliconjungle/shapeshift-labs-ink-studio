'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { fixture } = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const kit = ink.load(), topology = kit.KIT.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('an isolated reskin commits an undoable instance override and preserves the sibling and source', () => {
  const { scene, library, panel, request } = fixture();
  const editor = ink.createSceneEditor(scene, { env: { prefabs: library } }), before = editor.snapshot();
  const saved = topology.select(panel.document, { domain: 'faces', ids: ['sign'] });
  const edit = { ...request, faces: { panel: saved } };
  const report = editor.planPrefabIsolation(edit);
  assert.equal(report.changed, true);
  assert.deepEqual(report.members[0].selection, saved);
  assert.deepEqual(report.edits[0].changedFaces, ['sign']);
  assert.deepEqual(editor.snapshot(), before);
  editor.editIsolatedPrefab(edit);
  const next = editor.snapshot(), changed = next.instances.west.meshOverrides.panel.mesh;
  assert.equal(next.instances.west.meshOverrides.panel.revision, 3);
  assert.equal(next.instances.west.meshOverrides.panel.base, topology.revision(panel.document));
  assert.deepEqual(next.instances.east, before.instances.east);
  assert.deepEqual(next.topologyMeshes, before.topologyMeshes);
  assert.deepEqual(changed.document.faces.find(face => face.id === 'grille'), panel.document.faces.find(face => face.id === 'grille'));
  assert.equal(changed.bindings.find(row => row.element === 'sign').data.selection.x, 48);
  assert.equal(library.bay.topologyMeshes.panel.bindings.find(row => row.element === 'sign').data.selection.x, 0);
  const built = editor.build(), west = built.topologyMeshes['west.panel'], east = built.topologyMeshes['east.panel'];
  assert.equal(west.mesh.objectId, 'west.panel');
  assert.deepEqual(east.document, panel.document);
  const at = mesh => kit.KIT.sceneMeshes.geometry(mesh).positions[0];
  assert(Math.abs(at(east.mesh)-at(west.mesh)-2.62) < 1e-6);
  assert.deepEqual(editor.node('prefab:west').meshes, ['west.panel']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(), next);
  assert.throws(() => editor.planPrefabIsolation(edit), /same topology revision/);
  assert.throws(() => editor.refreshPrefabs({ bay: { ...library.bay, revision: 4 } }), /Mesh override for panel needs review/);
  assert.deepEqual(editor.snapshot(), next);
});

test('isolation blocks shared or inactive components and discards all edits in a blocked batch', () => {
  const { scene, library, request, shared, panel } = fixture();
  const editor = ink.createSceneEditor(scene, { env: { prefabs: library } }), before = editor.snapshot();
  const move = { member: 'panel', transform: { operation: { kind: 'move', offset: [.1,0,0] } } };
  const bad = { ...request, edits: [...request.edits, move] };
  const report = editor.planPrefabIsolation(bad);
  assert.equal(report.canCommit, false);
  assert.equal(report.changed, false);
  assert.equal(report.edits.length, 1);
  assert.deepEqual(report.conflicts[0].faces, ['grille']);
  assert.throws(() => editor.editIsolatedPrefab(bad), /need review/);
  assert.deepEqual(editor.snapshot(), before);
  const pinned = { ...move, transform: { ...move.transform, pins: { vertices: shared } } };
  const approved = editor.editIsolatedPrefab({ ...request, edits: [pinned] });
  assert.deepEqual(approved.edits[0].changedFaces, ['sign']);
  assert.deepEqual(approved.edits[0].evidence.pinned, [...shared].sort());
  const sharedEdge = topology.inspect(panel.document).edges.find(edge => edge.uses.length === 2);
  const boundary = editor.planPrefabIsolation({ ...request, edits: [{ member: 'panel', patch: {
    edges: [{ id: sharedEdge.id, uvSeam: true }]
  } }] });
  assert.equal(boundary.canCommit, false);
  assert.deepEqual(boundary.conflicts[0].faces, ['grille']);
  const otherFace = editor.planPrefabIsolation({ ...request, edits: [{ member: 'panel', reskin: {
    ...request.edits[0].reskin, face: 'grille'
  } }] });
  assert.equal(otherFace.canCommit, false);
  assert.equal(editor.planPrefabIsolation({ ...request, edits: [{ ...move, member: 'pillar' }] }).conflicts[0].reason,
    'outside-active-members');
});

test('CLI preview hides other owners without dropping them from the published scene', t => {
  const { scene, library, request, view } = fixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-prefab-isolation-'));
  t.after(() => fs.rmSync(cwd, { force: true, recursive: true }));
  const at = name => path.join(cwd, name);
  const write = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(at(name), 'utf8'));
  const args = (...args) => [cli, 'mesh-topology', 'isolate-prefab', 'station.json', ...args];
  const run = (...input) => JSON.parse(execFileSync(process.execPath, args(...input), { cwd, encoding: 'utf8' }));
  write('station.json',scene);
  write('library.json',library);
  write('view.json',view);
  write('isolated.json',request);
  write('context.json',{ ...request, hideSurroundings: false });
  write('blocked.json',{ ...request, edits: [{ member: 'panel', transform: { operation: { kind: 'move', offset: [.1,0,0] } } }] });
  const result = run('isolated.json','--preview','isolated.png','--view','view.json','--out','revised.json');
  assert(result.preview.visible.some(row => row.object === 'west.panel'));
  assert(result.preview.visible.some(row => row.object === 'west.body'));
  assert(result.preview.visible.every(row => result.objects.includes(row.object)));
  const context = run('context.json','--preview','context.png','--view','view.json');
  assert(context.preview.visible.some(row => row.object === 'east.panel'));
  assert(context.preview.visible.some(row => row.object === 'pillar'));
  const pixels = result.preview.visible.find(row => row.object === 'west.panel').pixels;
  assert(pixels > context.preview.visible.find(row => row.object === 'west.panel').pixels);
  const next = read('revised.json');
  assert.deepEqual(Object.keys(next.instances), ['west','east']);
  assert.deepEqual(next.topologyMeshes, scene.topologyMeshes);
  assert.deepEqual(read('station.json'), scene);
  assert.deepEqual(read('library.json'), library);
  const blocked = spawnSync(process.execPath, args('blocked.json','--out','failed.json'), { cwd, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).canCommit, false);
  assert.equal(fs.existsSync(at('failed.json')), false);
});
