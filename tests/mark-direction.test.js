'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const kit = ink.load(), { KIT: K } = kit;
const plate = { id: 'plate', kind: 'box', at: [0, 0, 0], half: [1.7, .70, .18], mat: 'stone', res: .057 };
const scene = { id: 'direction-test', solids: [plate], camera: { target: [0, 0, 0], dist: 4.3, yaw: 0, pitch: 0 } };
const at = (x, y = 0, z = .43) => ({ point: [x, y, z], rotation: [0, 0, 0, 1], pressure: .92 });
const stroke = { id: 'tuft', brush: { kind: 'box', half: [.145, .03, .045], round: .015 },
  poses: [at(-.6), at(.6)], step: .21, res: .032, mat: 'ember',
  attachment: { kind: 'surface', slot: 'panel', snap: { mode: 'surface', maxDistance: .55, direction: [0, 0, 1], offset: .023 } } };
const axis = { kind: 'axis', axis: [1, 0, 0] };
const flow = (u, v) => ({ ...K.flowMap.create({ width: 1, height: 1, bounds: [-2, -1, 2, 1] }).asset(), vectors: [u, v] });
const placement = (marks, flowMaps) => ({ id: 'weave', bindings: { panel: 'plate' }, painting: {
  id: 'paint', format: K.authoring.paintings3d.format, version: 1, marks, ...(flowMaps && { flowMaps }) } });
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} expected near ${b}`);
const same = (a, b, e = 1e-6) => a.forEach((value, i) => near(value, b[i], e));
const angle = vector => Math.atan2(vector[1], vector[0]) * 180 / Math.PI;

function inspect(editor, mark, flowMaps) {
  return editor.planPainting3d(placement([mark], flowMaps)).report.marks[0].orientation;
}

test('comb strength and sampled flow direction are independent of the seeded ruffle', () => {
  const editor = ink.createSceneEditor(scene), field = { kind: 'flow-map', map: 'up' };
  const plan = (strength, ruffleDegrees, seed) => inspect(editor, { ...stroke,
    direction: { field, strength, ruffleDegrees, seed } }, { up: flow(0, 1) });
  const combed = plan(.5, 0, 13), ruffled = plan(.5, 25, 13), changed = plan(1, 25, 13);
  assert.equal(combed.samples, 7);
  assert.deepEqual(plan(.5, 25, 13), ruffled);
  assert.notDeepEqual(plan(.5, 25, 31), ruffled);
  assert(ruffled.frames.some(frame => Math.abs(frame.ruffleDegrees) > 8));
  for (const [i, frame] of ruffled.frames.entries()) {
    near(angle(combed.frames[i].restTangent), 45);
    near(angle(frame.restTangent), 45 + frame.ruffleDegrees);
    near(angle(changed.frames[i].restTangent), 90 + frame.ruffleDegrees);
    near(changed.frames[i].ruffleDegrees, frame.ruffleDegrees);
    assert(Math.abs(frame.ruffleDegrees) <= 25);
    same(frame.point, combed.frames[i].point);
    same(frame.normal, [0, 0, 1]);
  }
  const calm = inspect(editor, { ...stroke, direction: { field: { kind: 'flow-map', map: flow(0, 0) } } });
  same(calm.frames[0].restTangent, [1, 0, 0]);
});

test('receiver warp chains carry rest positions, signed tangents and normals into the rebuilt marks', () => {
  const bend = .51, stretch = [1.2, .84, 1.07], center = [0, 0, 0];
  const warped = { ...scene, solids: [{ id: 'plate', kind: 'warp', stretch, centre: center, mat: 'stone', res: .057,
    part: 'wing', of: { kind: 'warp', bend, centre: center, of: { ...plate, id: 'base' } } }],
    parts: { wing: { joint: [0, 0, 0] } }, motion: [{ do: 'squash', part: 'wing', amount: .29, period: 2, axis: [0, 1, 0] }] };
  const editor = ink.createSceneEditor(warped), tuft = { ...stroke, poses: [at(1.02)], direction: { field: axis, ruffleDegrees: 0 } };
  const report = editor.applyPainting3d(placement([tuft])).marks[0].orientation;
  assert.equal(report.warped, true);
  const row = report.frames[0], [x, y, z] = row.rest, a = bend * x, R = 1 / bend;
  const expected = [(R - y) * Math.sin(a) * stretch[0], (R - (R - y) * Math.cos(a)) * stretch[1], z * stretch[2]];
  const tangent = K.V.norm([Math.cos(a) * stretch[0], Math.sin(a) * stretch[1], 0]);
  same(row.point, expected);
  same(row.tangent, tangent);
  same(row.normal, [0, 0, 1]);
  same(row.restTangent, [1, 0, 0]);
  const world = editor.build(), mark = world.made['paint.weave.tuft'];
  assert.equal(mark.tag, 'wing');
  same(mark.bc, row.point);
  const group = world.lab.rig.names.indexOf('wing'), before = world.lab.rig.at('wing', row.point);
  const wingId = world.renderMetadata.targets.findIndex(row => row?.entity === 'paint.weave.tuft');
  const sampleIndex = world.renderMetadata.targetIds.indexOf(wingId);
  assert(sampleIndex >= 0);
  const offset = sampleIndex * 16, original = Array.from(world.data.slice(offset, offset + 3));
  require('../cli/diarama-pose.js').pose(world, .5, { kit });
  assert(world.lab.rig.M[group * 12 + 4] > 1.2);
  assert(K.V.dist(world.lab.rig.at('wing', row.point), before) > .08);
  same(Array.from(world.data.slice(offset, offset + 3)), world.lab.rig.at('wing', original), 1e-5);
});

test('direction also changes zero-allowance paint without changing the carrier geometry', () => {
  const editor = ink.createSceneEditor(scene), mark = { ...stroke, looseness: { silhouetteAllowance: 0 }, direction: { field: axis } };
  editor.applyPainting3d(placement([mark]));
  const along = editor.build();
  editor.applyPainting3d({ id: 'weave', edits: [{ op: 'set', id: mark.id, patch: {
    direction: { field: { kind: 'contour', axis: axis.axis } }
  } }] }, { update: true });
  const across = editor.build();
  assert.equal(along.count, across.count);
  let changed = 0;
  for (let i = 0; i < along.count * 16; i++) {
    if (i % 16 === 7) changed += Number(along.data[i] !== across.data[i]);
    else assert.equal(along.data[i], across.data[i]);
  }
  assert(changed > 30);
});

test('a negative bend carries paint to the asymmetric receiver surface', () => {
  const base = { ...plate, id: 'base', at: [1.04, 0, 0], half: [.48, .32, .18] };
  const bent = { ...scene, solids: [{ id: 'plate', kind: 'warp', centre: [0, 0, 0], bend: -.48, of: base }] };
  const editor = ink.createSceneEditor(bent);
  const report = inspect(editor, { ...stroke, poses: [at(1.04)], direction: { field: axis } });
  const row = report.frames[0], field = K.diorama.brushField(bent);
  assert(row.tangent[0] > .8 && row.tangent[1] < -.4);
  assert(field.sdf(...K.V.mad(row.point, row.normal, -.06)) < 0);
  assert(field.sdf(...row.point) > 0);
});

test('pigment faces the same rest side even after a twist turns that side away', () => {
  const base = { ...plate, id: 'base', at: [0, 1.2, 0], half: [1.1, .42, .16] };
  const twisted = { ...scene, solids: [{ id: 'plate', kind: 'warp', centre: [0, 0, 0], twist: 1.6, of: base }] };
  const editor = ink.createSceneEditor(twisted), bare = editor.build();
  const mark = { ...stroke, poses: [at(-.55, 1.2), at(.55, 1.2)], looseness: { silhouetteAllowance: 0 },
    direction: { field: axis } };
  const orientation = editor.applyPainting3d(placement([mark])).marks[0].orientation;
  assert(orientation.frames.every(frame => frame.normal[2] < 0));
  const painted = editor.build();
  assert.equal(painted.count, bare.count);
  const changed = Array.from({ length: bare.count }, (_, i) => painted.data[i * 16 + 7] !== bare.data[i * 16 + 7]);
  assert(changed.filter(Boolean).length > 12);
});

test('CLI retains named flow maps and ruffle settings, supports shared map edits and renders the revised mark', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mark-direction-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const get = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const direction = { field: { kind: 'flow-map', map: 'grain' }, strength: 1, ruffleDegrees: 21, seed: 782 };
  const input = placement([{ ...stroke, direction }], { grain: flow(1, 0) });
  save('base.json', scene);
  save('input.json', input);
  const before = JSON.parse(run('painting-3d', 'apply', 'base.json', 'input.json', '--out', 'applied.json'));
  save('edit.json', { id: 'weave', flowMaps: { grain: flow(0, 1) } });
  const after = JSON.parse(run('painting-3d', 'update', 'applied.json', 'edit.json', '--out', 'revised.json'));
  assert.deepEqual(after.flowMaps, ['grain']);
  const a = before.marks[0].orientation.frames[0], b = after.marks[0].orientation.frames[0];
  near(angle(b.restTangent) - angle(a.restTangent), 90);
  near(b.ruffleDegrees, a.ruffleDegrees);
  run('painting-3d', 'extract', 'revised.json', '--id', 'weave', '--out', 'painting.json');
  assert.deepEqual(get('painting.json').marks, input.painting.marks);
  assert.deepEqual(get('painting.json').flowMaps.grain, flow(0, 1));
  for (const file of ['applied','revised']) run('render', file + '.json', '--ortho', '--w', '140', '--h', '99', '--out', file + '.png');
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'applied.png')), fs.readFileSync(path.join(dir, 'revised.png')));
});
