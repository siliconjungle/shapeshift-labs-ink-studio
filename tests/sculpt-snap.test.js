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
const base = { id: 'snap-test', solids: [{ id: 'shell', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone', res: .075 }] };
const seam = { target: 'shell', id: 'rim', op: 'cut', brush: { kind: 'sphere', radius: .10 },
  poses: [{ point: [-.68, 1.26, 0], pressure: .8 }, { point: [.68, 1.26, 0], pressure: 1.2 }],
  snap: { mode: 'surface', maxDistance: .65, direction: [0, 1, 0], spacing: .06 } };

test('a seam is evaluated along the surface and follows a later carrier shape edit', () => {
  const editor = ink.createSceneEditor(base);
  const planned = editor.planSculptSnap(seam);
  assert.deepEqual(editor.snapshot(), base);
  const result = editor.applySculptSnap(seam);
  assert.deepEqual(result, planned);
  assert(result.contacts.length > seam.poses.length);
  assert(result.contacts.every(({ point, normal }) => Math.abs(K.V.len(point) - 1) < 1e-6 && normal[1] > .7));
  assert.deepEqual(editor.snapshot().solids[0].modifiers[0].shape.poses, seam.poses);
  const cut = K.diorama.brushField(editor.snapshot());
  assert(cut.sdf(0, .96, 0) > 0 && cut.sdf(0, .92, .22) < 0);
  editor.updateShape({ r: 1.17 }, 'solid:shell');
  const moved = editor.inspectSculptSnap('shell', 'rim');
  assert(moved.contacts.every(({ point }) => Math.abs(K.V.len(point) - 1.17) < 1e-6));
  editor.undo();
  editor.undo();
  assert.deepEqual(editor.snapshot(), base);
});

test('a planted root preserves the free path, orientations and pressure, even after moving the operand', () => {
  const editor = ink.createSceneEditor(base);
  const request = { target: 'shell', id: 'branch', op: 'add', brush: { kind: 'sphere', radius: .13 }, mat: 'metal',
    poses: [{ point: [0, 1.31, 0] }, { point: [.20, 1.75, .1], rotation: [0, 0, .2, .9797958971] },
      { point: [.7, 2, .1], pressure: .6 }], snap: { mode: 'root', maxDistance: .5, offset: -.03 } };
  function verify(report, x = 0) {
    assert.equal(report.contacts.length, 1);
    assert.equal(report.resolvedPoseCount, request.poses.length);
    assert.deepEqual(report.resolvedPoses.map(({ point, ...row }) => row), request.poses.map(({ point, ...row }) => row));
    report.resolvedPoses.forEach(({ point }, i) =>
      assert(K.V.dist(K.V.sub(point, report.resolvedPoses[0].point), K.V.sub(request.poses[i].point, request.poses[0].point)) < 1e-9));
    assert(Math.abs(K.V.len(report.contacts[0].point) - 1) < 1e-5);
    assert(report.contacts[0].point[0] >= x);
    assert(K.V.len(report.resolvedPoses.at(-1).point) > 1.5);
  }
  verify(editor.applySculptSnap(request));
  editor.editSculptContribution({ solid: 'shell', contribution: 'branch', op: 'move', delta: [.2, 0, 0] });
  verify(editor.inspectSculptSnap('shell', 'branch'), .12);
});

test('blocks a surface gap and a visible branch change, without changing the source', () => {
  const body = { id: 'gap', solids: [{ id: 'shell', kind: 'join', how: 'union', size: 0,
    a: { kind: 'ball', at: [-1, 0, 0], r: .6 }, b: { kind: 'ball', at: [1, 0, 0], r: .6 } }] };
  const editor = ink.createSceneEditor(body), original = editor.snapshot();
  assert.throws(() => editor.applySculptSnap({ ...seam, poses: [{ point: [-1, .8, 0] }, { point: [1, .8, 0] }] }),
    /segment.*(?:No facing|would cross)/);
  assert.equal(editor.snapshot(), original);
});

test('CLI plans, saves and inspects a snapped stroke and keeps previous output on a miss', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sculpt-snap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const read = file => fs.readFileSync(path.join(dir, file), 'utf8');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  put('base.json', base);
  put('seam.json', seam);
  const plan = JSON.parse(run('sculpt-snap', 'plan', 'base.json', 'seam.json'));
  const apply = () => JSON.parse(run('sculpt-snap', 'apply', 'base.json', 'seam.json', '--out', 'done.json'));
  assert.deepEqual(apply(), plan);
  assert.deepEqual(JSON.parse(run('sculpt-snap', 'inspect', 'done.json', '--target', 'shell', '--id', 'rim')), plan);
  const saved = read('done.json');
  put('seam.json', { ...seam, poses: [{ point: [0, 4, 0] }, { point: [.3, 4, 0] }] });
  assert.throws(apply, /Sculpt snap shell\/rim: Snap root/);
  assert.equal(read('done.json'), saved);
  assert.deepEqual(JSON.parse(read('base.json')), base);
});
