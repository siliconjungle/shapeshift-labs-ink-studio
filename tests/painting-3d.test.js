'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const plate = { id: 'plate', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone', res: .12 };
const base = { id: 'painting-test', solids: [plate] };
const trace = { id: 'trace', brush: { kind: 'sphere', radius: .12 }, mat: 'water', res: .07,
  poses: [{ point: [-.25, 0, 1.27], pressure: .8 }, { point: [.25, 0, 1.27] }],
  attachment: { kind: 'surface', slot: 'body', snap: { mode: 'surface', maxDistance: .5, direction: [0, 0, 1], offset: .02 } } };
const free = { ...trace, id: 'free', mat: { role: 'ember', materialId: 'clay' }, transform: { position: [0, .65, .3] } };
delete free.attachment;
const add = (marks, bindings, id = 'detail') => ({ id, ...(bindings && { bindings }),
  painting: { format: K.authoring.paintings3d.format, version: 1, id: 'strokes', marks } });
const zOf = (world, key) => world.made[key].bc[2];
const entityNames = world => {
  const { targets, targetIds } = world.renderMetadata;
  return new Set(Array.from(targetIds, id => targets[id]?.entity));
};

test('retains all attachment types and projects in receiver space after sculpt modifiers', () => {
  const riggedPlate = { ...plate, part: 'arm', transform: { translation: [0, 0, .5], scale: .8 },
    modifiers: [{ id: 'rim', kind: 'swell', by: .11 }] };
  const scene = { ...base, solids: [riggedPlate], parts: { arm: { joint: [0, 0, 0] } },
    motion: [{ do: 'turn', part: 'arm', axis: [0, 1, 0], period: 2, amount: .8 }] };
  const part = { ...free, id: 'part', attachment: { kind: 'part', slot: 'arm' } };
  const placement = { ...add([trace, free, part], { body: 'plate', arm: 'arm' }), transform: { position: [0, .1, 0] } };
  const editor = ink.createSceneEditor(scene), plan = editor.planPainting3d(placement);
  assert.deepEqual(editor.snapshot(), scene);
  assert.deepEqual(plan.report.marks.map(row => [row.attachment, row.part]), [['surface', 'arm'], ['free', undefined], ['part', 'arm']]);
  assert(plan.report.marks[0].contacts > 2);
  editor.applyPainting3d(placement);
  assert.deepEqual(editor.snapshot().solids, scene.solids);
  const roundTrip = ink.createSceneEditor(JSON.parse(JSON.stringify(editor.snapshot())));
  const world = roundTrip.build();
  assert.equal(world.made['paint.detail.trace'].tag, 'arm');
  assert.equal(world.made['paint.detail.part'].tag, 'arm');
  assert.equal(world.made['paint.detail.free'].tag, null);
  assert(Math.abs(zOf(world, 'paint.detail.trace') - (.5 + .8 * 1.11)) < .04);
  assert.equal(zOf(world, 'paint.detail.free'), 1.57);
  assert.equal(world.made['paint.detail.free'].mat.materialId, 'clay');
  const model = K.diorama.scene(roundTrip.snapshot()).model({ resolution: .13, duration: 1, fps: 4 });
  assert.equal(model.joints[0].name, 'arm');
  assert(model.meshes.some(mesh => mesh.weights?.length));
  assert.equal(model.animations.length, 1);
});

test('coincident free and rigged marks use editable paint order', () => {
  for (const moving of [false, true]) {
    const scene = moving ? { ...base, solids: [{ ...plate, part: 'arm' }], parts: { arm: {} } } : base;
    const attachment = moving ? { kind: 'part', slot: 'arm' } : { kind: 'free' };
    const lower = { ...free, id: 'lower', mat: 'ember', attachment };
    const upper = { ...lower, id: 'upper', mat: 'metal', res: .06 };
    const editor = ink.createSceneEditor(scene);
    editor.applyPainting3d(add([lower, upper], moving ? { arm: 'arm' } : undefined));
    const first = entityNames(editor.build());
    assert(first.has('paint.detail.upper'));
    assert(!first.has('paint.detail.lower'));
    const receipt = editor.applyPainting3d({ id: 'detail', edits: [{ op: 'move', id: 'lower' }] }, { update: true });
    assert.deepEqual(receipt.marks.map(row => [row.order, row.id]), [[0, 'upper'], [1, 'lower']]);
    const second = entityNames(editor.build());
    assert(second.has('paint.detail.lower'));
    assert(!second.has('paint.detail.upper'));
    editor.undo();
    assert.deepEqual(entityNames(editor.build()), first);
  }
});

test('an off-body mark follows a rig without shifting its inferred joint', () => {
  const scene = { ...base, solids: [{ ...plate, part: 'arm' }],
    motion: [{ do: 'turn', part: 'arm', axis: [0, 1, 0], period: 2, amount: .8 }] };
  const part = { ...free, id: 'part', transform: { position: [2, .1, 0] }, attachment: { kind: 'part', slot: 'arm' } };
  const editor = ink.createSceneEditor(scene);
  editor.applyPainting3d(add([part], { arm: 'arm' }));
  const bare = K.diorama.build(scene), painted = editor.build();
  const pose = require('../cli/diarama-pose.js').pose;
  for (const world of [bare, painted]) pose(world, .5, { kit: ink.load() });
  assert.deepEqual(painted.lab.rig.at('arm', [0, 0, 0]), bare.lab.rig.at('arm', [0, 0, 0]));
  for (const key of ['head', 'tail']) {
    const joint = spec => K.diorama.scene(spec).model({ resolution: .18 }).joints[0][key];
    assert.deepEqual(joint(editor.snapshot()), joint(scene));
  }
});

test('extracts a full painting for rebinding and rejects a failed edit atomically', () => {
  const editor = ink.createSceneEditor(base), placement = add([trace, free], { body: 'plate' });
  editor.applyPainting3d(placement);
  editor.applyPainting3d({ id: 'detail', edits: [{ op: 'set', id: 'free', patch: { enabled: false } },
    { op: 'add', id: 'new-mark', mark: { brush: { kind: 'sphere', radius: .09 }, poses: free.poses, mat: 'gold' } },
    { op: 'set', id: 'new-mark', patch: { mat: 'metal' } }, { op: 'remove', id: 'new-mark' }] }, { update: true });
  const before = editor.snapshot(), painting = editor.extractPainting3d('detail');
  assert.deepEqual(painting.marks, [trace, { ...free, enabled: false }]);
  assert.throws(() => editor.applyPainting3d({ id: 'detail', edits: [{ op: 'set', id: 'trace', patch: {
    transform: { position: [0, 0, 4] } } }] }, { update: true }), /paint.detail.trace on plate.*within reach/);
  assert.deepEqual(editor.snapshot(), before);
  const newScene = ink.createSceneEditor({ ...base, solids: [{ ...plate, id: 'dial', transform: { translation: [0, 0, .7] } }] });
  assert.throws(() => newScene.applyPainting3d({ id: 'reuse', painting }), /binding for slot body/);
  const report = newScene.applyPainting3d({ id: 'reuse', painting, bindings: { body: 'dial' } });
  assert.equal(report.marks[0].target, 'dial');
  assert.equal(report.marks[1].enabled, false);
  assert(zOf(newScene.build(), 'paint.reuse.trace') > 1.65);
});

test('CLI plans, saves, reloads, edits, extracts and renders a painting', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-painting-3d-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const placement = add([trace, free], { body: 'plate' });
  save('base.json', base);
  save('placement.json', placement);
  save('edit.json', { id: 'detail', edits: [{ op: 'set', id: 'free', patch: { mat: 'accent' } }] });
  const plan = JSON.parse(run('painting-3d', 'plan', 'base.json', 'placement.json'));
  assert(plan.marks[0].contacts > 2);
  run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'painted.json');
  assert.deepEqual(read('painted.json').paintings3d, [placement]);
  run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'edited.json');
  assert.equal(JSON.parse(run('painting-3d', 'inspect', 'edited.json'))[0].marks[1].material, 'accent');
  run('painting-3d', 'extract', 'edited.json', '--id', 'detail', '--out', 'strokes.json');
  assert.deepEqual(read('strokes.json').marks, [trace, { ...free, mat: 'accent' }]);
  run('render', 'edited.json', '--ortho', '--w', '96', '--h', '72', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 200);
});
