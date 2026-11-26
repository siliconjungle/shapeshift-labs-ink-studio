'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT: K } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const view = { w: 128, h: 110, ortho: true, raw: true };

function fixture() {
  const points = [[.64, -.48, .45], [1.22, -.48, .45], [1.22, .32, .45], [.64, .32, .45]];
  const badge = { id: 'badge-mesh', vertices: points.map((position, i) => ({ id: 'v' + i, position })),
    faces: [{ id: 'card', material: 'ink', corners: [[0, 1], [1, 1], [1, 0], [0, 0]].map((uv, i) =>
      ({ id: 'c' + i, vertex: 'v' + i, uv })) }] };
  const source = { id: 'review-check', parts: { boom: { joint: [0, 0, 0] }, eye: { parent: 'boom' } },
    camera: { target: [0, 0, 0], dist: 6, yaw: 0, pitch: 0 },
    light: { sun: [0, 0, -1], amb: 0, sky: 0 },
    effects: [{ do: 'lamp', at: [.5, .6, -.2], follow: 'eye', strength: .2, r: 2 }],
    solids: [
      { id: 'housing', kind: 'ball', at: [0, 0, 0], r: 1, part: 'eye', mat: 'stone', res: .08 },
      { id: 'wall', kind: 'box', at: [0, 0, 1.4], half: [.34, 1.2, .13], mat: 'stone', res: .09 },
      { id: 'stand', kind: 'box', at: [1.5, -.7, 0], half: [.2, .2, .2], part: 'boom', mat: 'stone', res: .09 }
    ],
    topologyMeshes: { badge: { document: badge, part: 'eye', materials: [{ id: 'ink', color: 0xc0c0c0,
      texture: { width: 2, height: 1, pixels: [240, 41, 24, 255, 214, 80, 39, 255] } }] } }
  };
  const editor = ink.createSceneEditor(source);
  editor.applySculptSpray({ id: 'enamel', targets: ['housing'], occlusion: 'wrap', facing: 'all', color: '#967e19',
    brush: { shape: 'ellipsoid', direction: [0, 0, -1], center: [-.6, 0, 0], half: [.7, .7, 2] } });
  return JSON.parse(editor.serialize());
}

test('part review expands to descendant sculpts, meshes, paint and attached lights', () => {
  const editor = ink.createSceneEditor(fixture());
  const report = editor.setAssemblyReview({ isolate: ['part:boom'], hide: ['paint:mesh/badge', 'light:lamp/0'],
    freeze: ['part:eye'], revealThrough: ['part:eye'], time: .25 });
  const states = new Map(report.items.map(row => [row.key, row]));
  for (const key of ['sculpt:housing', 'mesh:badge', 'paint:sculpt/housing', 'part:eye']) {
    const row = states.get(key);
    assert(row.visible && row.frozen && row.revealThrough, key);
  }
  for (const key of ['paint:mesh/badge', 'light:lamp/0']) {
    const row = states.get(key);
    assert(row.hidden && !row.visible && !row.revealThrough, key);
  }
  assert(!states.get('sculpt:wall').visible);
  const { world, time } = editor.buildAssemblyReview();
  assert.equal(time, .25);
  assert.equal(world.lab.lit, null);
  const tint = K.sceneMeshes.trianglePigment(world.meshes[0], 0);
  const normal = K.sceneMeshes.trianglePigment(editor.build().meshes[0], 0);
  assert.equal(tint.color, 0xc0c0c0);
  assert.equal(tint.material, normal.material);
  assert.notEqual(tint.color, normal.color);
  assert.equal(editor.pick({ origin: [0, 0, 5], direction: [0, 0, -1] }).key, 'solid:housing');
});

test('freeze protects edits, membership and history while allowing unrelated changes', () => {
  const source = fixture(), editor = ink.createSceneEditor(source);
  const draft = structuredClone(source);
  const guard = { freeze: ['part:eye'] };
  draft.effects[0].strength = .5;
  draft.parts.eye.joint = [0, .2, 0];
  draft.topologyMeshes.badge.materials[0].texture.pixels[0] = 11;
  draft.solids[0].sdfSpray[0].color = '#111111';
  const result = editor.checkAssemblyReview(draft, guard);
  for (const key of ['light:lamp/0', 'part:eye', 'mesh:badge', 'paint:sculpt/housing', 'paint:mesh/badge'])
    assert(result.conflicts.some(row => row.key === key), key);
  const added = structuredClone(source);
  added.solids.push({ ...added.solids[1], id: 'new', part: 'eye' });
  assert(editor.checkAssemblyReview(added, guard).conflicts.some(row => row.key === 'sculpt:new'));

  editor.setTransform({ translation: [.1, 0, 0] }, 'solid:housing');
  editor.setAssemblyReview(guard);
  const before = editor.serialize(), history = editor.history();
  assert.throws(() => editor.undo(), /Frozen assembly items/);
  assert.deepEqual(editor.history(), history);
  assert.throws(() => editor.setTransform({ translation: [1, 0, 0] }, 'solid:housing'), /sculpt:housing/);
  assert.throws(() => editor.editMeshTopology('badge', { vertices: [{ id: 'v0', position: [.8, -.48, .45] }] }), /mesh:badge/);
  assert.equal(editor.serialize(), before);
  editor.setTransform({ translation: [.2, 0, 0] }, 'solid:wall');
  assert(editor.undo());
  editor.setAssemblyReview(null);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(), source);
});

test('a frozen assembly protects its pose channels and unnamed rig geometry', () => {
  const scene = fixture();
  delete scene.solids[2].id;
  scene.timeline = { duration: 1, tracks: [
    { target: ['poses', 'eye', 'translation'], keys: [{ time: 0, value: [0, 0, 0] }] },
    { target: ['camera', 'yaw'], keys: [{ time: 0, value: 0 }] }
  ] };
  const editor = ink.createSceneEditor(scene);
  const preset = { isolate: ['part:boom'], freeze: ['part:boom'] };
  const items = editor.inspectAssemblyReview(preset).items;
  assert(items.some(row => row.key === 'sculpt:@slot/2' && row.visible && row.frozen));
  const draft = structuredClone(scene);
  draft.timeline.tracks[1].keys[0].value = .2;
  assert(editor.checkAssemblyReview(draft, preset).canEdit);
  draft.timeline.tracks[0].keys[0].value = [.2, 0, 0];
  assert(editor.checkAssemblyReview(draft, preset).conflicts.some(row => row.key === 'part:eye'));
});

test('neutral and through review change only an independent render and through picking', () => {
  const source = fixture(), editor = ink.createSceneEditor(source);
  const shot = ink.renderAssemblyReview(editor, {}, view).frame;
  const neutral = ink.renderAssemblyReview(editor, { lighting: 'neutral' }, view).frame;
  assert.notDeepEqual(shot.rgb, neutral.rgb);
  const reveal = { lighting: 'neutral', revealThrough: ['part:eye'] };
  const { report } = ink.renderAssemblyReview(editor, reveal, view);
  assert(report.frame.revealedPixels > 10);
  assert.deepEqual(report.frame.locators.map(row => row.key), ['light:lamp/0']);
  editor.setAssemblyReview(reveal);
  const ray = { origin: [0, 0, 5], direction: [0, 0, -1] };
  assert.equal(editor.pick(ray).key, 'solid:wall');
  assert.equal(editor.pick(ray, { through: true }).key, 'solid:housing');
  const hidden = ink.renderAssemblyReview(editor, { lighting: 'neutral',
    hide: ['paint:sculpt/housing', 'paint:mesh/badge'] }, view).frame;
  assert.notDeepEqual(hidden.rgb, neutral.rgb);
  assert.deepEqual(editor.snapshot(), source);
  assert.deepEqual(editor.history(), { undo: [], redo: [] });
  assert.deepEqual(ink.renderAssemblyReview(editor, {}, view).frame.rgb, shot.rgb);
});

test('CLI reuses a preset for inspection, render, and read-only candidate checking', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-assembly-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fixture(), candidate = structuredClone(source);
  candidate.parts.eye.joint = [0, .3, 0];
  const preset = { lighting: 'neutral', isolate: ['part:boom'], freeze: ['part:eye'] };
  for (const [name, data] of [['shot', source], ['review', preset], ['draft', candidate]])
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data));
  const run = (...args) => execFileSync(process.execPath, [cli, 'assembly-review', ...args], { cwd: dir, encoding: 'utf8' });
  assert(JSON.parse(run('inspect', 'shot.json', 'review.json')).items.some(row => row.frozen));
  run('render', 'shot.json', 'review.json', '--ortho', '--w', '128', '--h', '110', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 300);
  const blocked = spawnSync(process.execPath, [cli, 'assembly-review', 'check', 'shot.json', 'review.json', 'draft.json'],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).canEdit, false);
  assert.equal(fs.readFileSync(path.join(dir, 'shot.json'), 'utf8'), JSON.stringify(source));
});
