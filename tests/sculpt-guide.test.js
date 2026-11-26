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
const base = { id: 'guided-test', solids: [{ id: 'plate', kind: 'box', at: [0, 0, 0], half: [3, .2, 3], mat: 'stone' }] };
const stroke = { id: 'line', type: 'stroke', target: 'plate', guides: { space: 'world', mirror: { axis: 'x' } },
  stroke: { op: 'add', brush: { kind: 'sphere', radius: .12 },
    poses: [{ point: [-.42, .22, .1] }, { point: [.42, .62, .1] }], mat: 'metal' } };
const stamp = { format: 'ink-studio/sculpt-stamp', version: 1,
  add: { rim: { kind: 'box', at: [0, .31, 0], half: [.26, .14, .21], round: .025, mat: 'metal' } },
  cut: { bore: { shape: { kind: 'lathe', at: [0, -.4, 0], h: 1.1, r: .105 } } } };
const socket = { id: 'stud', type: 'stamp', target: 'plate', stamp,
  placement: { transform: { translation: [1.1, 0, 0], rotation: [.28, .28, .22] } },
  guides: { space: 'world', radial: { axis: 'y', count: 4 }, angleIncrement: 45, upright: true } };

test('clipped mirror keeps only the selected source half and does not cut unrelated geometry', () => {
  const editor = ink.createSceneEditor(base);
  editor.applySculptGuide(stroke);
  const cut = K.diorama.brushField(editor.snapshot());
  for (const x of [-.3, .3]) {
    assert(cut.sdf(x, .56, .1) < 0);
    assert(cut.sdf(x, .28, .1) > 0);
  }
  assert(cut.sdf(0, .4, .1) < 0, 'no crack on the mirror plane');
  const trace = K.diorama.sculptRestTrace(editor.snapshot(), 'plate');
  for (const x of [-.3, .3]) assert.equal(trace.materialAt([x, .56, .1], [0, 1, 0]).role, 'metal');
  assert.equal(editor.snapshot().solids.length, 1);
  assert.deepEqual(editor.snapshot().solids[0], base.solids[0]);
  editor.undo();
  assert.deepEqual(editor.snapshot(), base);
});

test('radial count is editable and stamp copies carry cuts, increments and upright orientation', () => {
  const editor = ink.createSceneEditor(base);
  const first = editor.applySculptGuide(socket);
  assert.deepEqual(first.copies.map(row => row.angleDegrees).map(Math.round), [0, 90, 180, 270]);
  assert(first.copies.every(row => K.V.dist(row.up, [0, 1, 0]) < 1e-8));
  const field = K.diorama.brushField(editor.snapshot());
  for (const { origin: [x, , z] } of first.copies)
    assert(field.sdf(x, .15, z) > 0, 'each bore reaches the host');
  assert(field.sdf(.48, .15, .48) < 0);
  const second = editor.applySculptGuide({ id: 'stud', guides: { radial: { count: 8 } } }, { update: true });
  assert.equal(second.copies.length, 8);
  assert.equal(second.generatedIds[0], first.generatedIds[0]);
  assert.equal(editor.snapshot().guidedOperations.length, 1);
  assert.equal(editor.inspectSculptGuides()[0].copies.length, 8);
  assert.throws(() => editor.applySculptGuide({ id: 'stud', guides: { angleIncrement: 180 } }, { update: true }),
    /same angle/);
  assert.equal(editor.inspectSculptGuides()[0].copies.length, 8);
  editor.undo();
  assert.equal(editor.inspectSculptGuides()[0].copies.length, 4);
});

test('guide axes use the target pose or the retained construction plane and its grid', () => {
  const scene = { ...base, constructionPlane: { origin: [0, 0, 0], right: [0, 0, 1], up: [0, 1, 0], grid: .5 },
    solids: [{ ...base.solids[0], transform: { rotation: [Math.PI / 2, 0, 0] } }] };
  const make = space => ({ ...socket, placement: { transform: { translation: [0, 0, 1.13] } },
    guides: { space, ...(space === 'construction-plane' && { grid: true }), mirror: { axis: 'x', clip: false } } });
  function positions(space) {
    return ink.createSceneEditor(scene).planSculptGuide(make(space)).report.copies.map(row => row.origin.map(v => Math.round(v * 100) / 100));
  }
  assert.deepEqual(positions('world'), [[1.13, 0, 0], [-1.13, 0, 0]]);
  assert.deepEqual(positions('local'), [[1.13, 0, 0], [1.13, 0, 0]]);
  assert.deepEqual(positions('construction-plane'), [[1.13, 0, 0], [1.13, 0, 0]]);
  const editor = ink.createSceneEditor(scene);
  const input = { ...make('construction-plane'), placement: { transform: { translation: [1.13, 0, 1.13] } } };
  const report = editor.applySculptGuide(input);
  assert(Math.abs(report.copies[0].origin[2] + 1) < 1e-8);
  editor.setConstructionPlane({ origin: [0, 0, .14], right: [0, 0, 1], up: [0, 1, 0], grid: .5 });
  assert(Math.abs(editor.inspectSculptGuides()[0].copies[0].origin[2] + 1.36) < 1e-8);
});

test('a reflected guided surface stroke reprojects each copy in its own direction', () => {
  const scene = { id: 'guided-snap', solids: [{ id: 'plate', kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone' }] };
  const editor = ink.createSceneEditor(scene);
  const input = { ...stroke, guides: { space: 'world', mirror: { axis: 'x' } },
    stroke: { ...stroke.stroke, op: 'cut', mat: undefined, poses: [{ point: [1.2, -.25, 0] }, { point: [1.2, .25, 0] }],
      snap: { mode: 'surface', direction: [1, 0, 0], maxDistance: .35, spacing: .06 } } };
  delete input.stroke.mat;
  editor.applySculptGuide(input);
  const trace = K.diorama.sculptRestTrace(editor.snapshot(), 'plate');
  assert(trace.stages.get('line-r0').snapped.contacts.every(row => row.normal[0] > .9));
  assert(trace.stages.get('line-r0-mirror').snapped.contacts.every(row => row.normal[0] < -.9));
});

test('overlapping snapped copies project against the same original carrier', () => {
  const editor = ink.createSceneEditor(base);
  const input = { ...stroke, stroke: { ...stroke.stroke,
    poses: [{ point: [-.35, .44, 0] }, { point: [.38, .44, 0] }],
    snap: { mode: 'surface', direction: [0, 1, 0], maxDistance: .35, spacing: .07 } } };
  editor.applySculptGuide(input);
  const trace = K.diorama.sculptRestTrace(editor.snapshot(), 'plate');
  for (const modifier of ['line-r0', 'line-r0-mirror'])
    assert(trace.stages.get(modifier).snapped.contacts.every(row => Math.abs(row.point[1] - .2) < 1e-6));
});

test('standalone guided stamps leave anonymous existing modifiers alone', () => {
  const original = { kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone',
    modifiers: [{ kind: 'mask', mode: 'cut', shape: { kind: 'ball', at: [0, 0, 0], r: .2 } }] };
  const op = { ...socket, guides: { mirror: { axis: 'x' } } };
  delete op.target;
  const { scene, reports } = K.authoring.sculptGuides.expand({ ...base, solids: [original], guidedOperations: [op] });
  assert.deepEqual(scene.solids[0], original);
  assert.equal(reports[0].generatedIds.length, 2);
});

test('CLI persists one recipe, reloads it, and regenerates its count', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sculpt-guide-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  save('base.json', base);
  save('apply.json', socket);
  save('update.json', { id: 'stud', guides: { radial: { count: 8 } } });
  const report = run('sculpt-guide', 'apply', 'base.json', 'apply.json', '--out', 'stamped.json');
  assert.equal(JSON.parse(report).copies.length, 4);
  run('sculpt-guide', 'update', 'stamped.json', 'update.json', '--out', 'updated.json');
  assert.equal(JSON.parse(run('sculpt-guide', 'inspect', 'updated.json'))[0].copies.length, 8);
  run('render', 'updated.json', '--ortho', '--w', '100', '--h', '90', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 200);
});
