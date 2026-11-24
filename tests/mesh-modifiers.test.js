'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT } = ink.load(), api = KIT.meshTopology;
const { fixture, quad, materials } = require('../examples/mesh-modifiers/fixture.cjs');

const complete = plan => assert(plan.report.canApply, JSON.stringify(plan.report.stages));
const by = (rows, id) => rows.find(row => row.id === id);

test('all six stages evaluate on a fixed cage with welded mirror, shell and bevel output', () => {
  const { cage, stack, context } = fixture(api);
  const before = JSON.stringify(cage);
  const plan = api.evaluateModifiers(cage, stack, context);
  complete(plan);
  assert.deepEqual(plan.report.stages.map(row => row.kind), ['projection','mirror','shell','bevel','subdivision','array']);
  assert.equal(plan.report.stages[0].evidence.moved, 4);
  assert.equal(plan.report.stages[1].evidence.weldedVertices, 2);
  assert.equal(plan.report.stages[1].output.faces, 2);
  assert.equal(plan.report.stages[2].output.faces, 10);
  assert(plan.report.stages[3].output.faces > 10);
  assert(api.inspect(plan.document).edges.every(edge => edge.uses.length === 2));
  assert(plan.document.faces.some(face => face.material === 'trim'));
  assert.equal(plan.report.stages[5].output.faces, plan.report.stages[4].output.faces * 2);
  assert.equal(JSON.stringify(cage), before);
  assert.deepEqual(api.evaluateModifiers(cage, stack, context), plan);
  const part = api.evaluateModifiers(cage, stack, { ...context, through: 'housing' });
  assert.equal(part.report.stages.length, 3);
  assert.deepEqual(part.remaining.map(row => row.id), ['trim','round','bank']);
  assert.equal(part.document.faces.length, 10);
  const rerun = api.evaluateModifiers(part.document, part.remaining, context);
  assert.deepEqual(rerun.document, plan.document);
});

test('reordering changes stage results, and bypassed projection has no dependency', () => {
  const cage = api.create(quad('plate', [[0,0,0],[1,0,0],[1,1,0],[0,1,0]]));
  const target = api.create(quad('ramp', [[-1,-1,.6],[6,-1,2],[6,2,2],[-1,2,.6]]));
  const array = { id: 'copies', kind: 'array', count: 2, step: [3,0,0] };
  const projection = { id: 'seat', kind: 'projection', target: 'ramp', direction: [0,0,1], distance: 3, miss: 'error' };
  const context = { target: () => target };
  const first = api.evaluateModifiers(cage, [array, projection], context), last = api.evaluateModifiers(cage, [projection, array], context);
  complete(first);
  complete(last);
  assert.notEqual(first.report.output.revision, last.report.output.revision);
  assert(first.document.vertices.find(row => row.position[0] === 3).position[2] >
    last.document.vertices.find(row => row.position[0] === 3).position[2] + .5);
  const blocked = api.evaluateModifiers(cage, [array, projection]);
  assert.equal(blocked.report.canApply, false);
  assert.equal(blocked.report.stages.at(-1).status, 'blocked');
  assert.deepEqual(blocked.report.remaining, ['seat']);
  const stack = api.updateModifier([array, projection], 'seat', { enabled: false });
  const bypassed = api.evaluateModifiers(cage, stack, { target() { assert.fail('Bypassed stage fetched target'); } });
  complete(bypassed);
  assert.equal(by(bypassed.report.stages, 'seat').status, 'bypassed');
  assert.throws(() => api.modifierStack([array, array]), /Duplicate/);
});

test('scene render, application preview, partial apply and undo share exact binding changes', () => {
  const { cage, target, stack } = fixture(api);
  const panel = { document: cage, part: 'housing', materials: materials(), modifiers: stack,
    bindings: [{ id: 'label', domain: 'faces', element: 'panel' }, { id: 'corner', domain: 'corners', element: 'c0' }],
    bakes: [{ id: 'registered-paint', material: 'paint', maps: { roughness: .35 } }] };
  const scene = { id: 'workbench', style: 'slate', solids: [], topologyMeshes: { face: panel, mount: { document: target } } };
  const editor = ink.createSceneEditor(scene);
  assert.equal(editor.node('mesh-modifier:face/round').modifier.levels, 1);
  assert.equal(editor.meshTopology('face').document.faces.length, 1);
  const baked = editor.build().topologyMeshes.face;
  assert(baked.document.faces.length > 20);
  assert.equal(baked.bakes[0].invalidated, undefined);
  assert.equal(by(baked.bindings, 'label').review.reason, 'split');
  const preview = editor.planApplyMeshModifiers('face', { through: 'round' });
  assert.equal(preview.row.modifiers.length, 1);
  assert.equal(preview.row.modifiers[0].id, 'bank');
  assert.equal(by(preview.row.bindings, 'label').review.reason, 'split');
  assert(by(preview.row.bindings, 'label').review.candidates.length > 3);
  assert(preview.row.bakes[0].invalidated.faces.includes('panel'));
  assert.equal(editor.meshTopology('face').bakes[0].invalidated, undefined);
  const applied = editor.applyMeshModifiers('face', { through: 'round' });
  assert.deepEqual(applied, preview);
  assert.deepEqual(editor.build().topologyMeshes.face.document, baked.document);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), scene);
  editor.updateMeshModifier('face', 'bank', { enabled: false });
  assert.equal(editor.inspectMeshModifiers('face').report.stages.at(-1).status, 'bypassed');
  editor.setMeshModifiers('face', stack);
  assert(editor.undo());
  assert.equal(editor.inspectMeshModifiers('face').report.stages.at(-1).status, 'bypassed');
  assert.throws(() => editor.setMeshModifiers('mount', [
    { id: 'loop', kind: 'projection', target: 'face', direction: [0,0,1], distance: 2 }
  ]), /cycle/);
  assert.equal(editor.meshTopology('mount').modifiers, undefined);
});

test('saved stacks replay through CLI and bound-pixel transactions', t => {
  const { cage, target, stack } = fixture(api);
  const scene = { id: 'bench', style: 'slate', solids: [], topologyMeshes: {
    body: { document: cage, part: 'skin', modifiers: stack }, mount: { document: target } } };
  const editor = ink.createSceneEditor(scene), pixels = ink.createPixelEditor({
    format: 'ink-studio/pixel-art', version: 2, width: 8, height: 8, pixelAspect: [1,1],
    palette: { ink: '#aa9966' }, layers: [{ id: 'ink' }], frames: [{ id: 'front', durationMs: 100, cels: {} }],
    sceneBindings: [{ id: 'body', scene: 'bench', object: 'body', part: 'skin' }],
    destinations: [{ id: 'geo', kind: 'mesh-topology', binding: 'body' }]
  }, { sceneEditor: editor });
  const change = { id: 'apply-stack', frame: 'front', revision: pixels.describe().revision, destination: 'geo',
    operation: { modifiers: { action: 'apply', through: 'housing' } } };
  change.sourceRevision = pixels.previewEdit(change).sourceRevision;
  const preview = pixels.previewEdit(change, { exact: true });
  assert(preview.valid, JSON.stringify(preview.conflicts));
  pixels.apply(change);
  const after = editor.snapshot(), receipt = pixels.receipts()[0];
  assert(pixels.undo());
  pixels.replay(receipt);
  assert.deepEqual(editor.snapshot(), after);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-modifier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
  const cli = (...args) => {
    const run = spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'mesh-topology', 'modifiers', ...args],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  write('scene.json', scene);
  write('cage.json', cage);
  write('stack.json', stack);
  write('targets.json', { mount: target });
  const dryRun = JSON.parse(cli('apply', 'scene.json', '--object', 'body', '--through', 'housing'));
  assert.equal(dryRun.output.faces, 10);
  assert(dryRun.topology.faces.length > 0);
  cli('apply', 'scene.json', '--object', 'body', '--through', 'housing', '--out', 'scene-edited.json');
  assert.deepEqual(read('scene-edited.json'), after);
  cli('set', 'cage.json', 'stack.json', '--targets', 'targets.json', '--out', 'retained.json');
  const retained = read('retained.json');
  assert.deepEqual(retained.document, cage);
  cli('inspect', 'retained.json', '--targets', 'targets.json', '--through', 'symmetry', '--preview', 'native', '--out', 'stage.json');
  assert.equal(read('stage.json').faces.length, 2);
  const image = fs.readFileSync(path.join(dir, 'native/stage.png'));
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [160,112]);
  write('bypass.json', { id: 'bank', patch: { enabled: false } });
  cli('update', 'retained.json', 'bypass.json', '--targets', 'targets.json', '--out', 'bypassed.json');
  const state = JSON.parse(cli('inspect', 'bypassed.json', '--targets', 'targets.json'));
  assert.equal(state.stages.at(-1).status, 'bypassed');
});
