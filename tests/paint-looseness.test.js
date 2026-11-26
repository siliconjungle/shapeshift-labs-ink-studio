'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const kit = K.procedural.paintLooseness;
const { prepare } = K.procedural.shapeSweeps;
const at = (x, y = 0, z = 0) => ({ point: [x, y, z] });
const brush = { kind: 'sphere', radius: .16 };
const plate = { id: 'plate', kind: 'box', at: [0, 0, 0], half: [1.1, .74, .15], res: .051, mat: 'stone' };
const scene = { id: 'guard', solids: [plate], camera: { target: [0, 0, 0], dist: 4.1, yaw: 0, pitch: 0, sway: 0 } };
const attachment = { kind: 'surface', slot: 'face', snap: { mode: 'surface', maxDistance: .45, direction: [0, 0, 1], offset: .06 } };
const placement = (marks, id = 'example') => ({ id, bindings: { face: 'plate' },
  painting: { id: 'strokes', version: 1, format: K.authoring.paintings3d.format, marks } });
const mark = { id: 'ink', brush, mat: 'ember', step: .2, res: .033, poses: [at(-.7, 0, .42), at(.7, 0, .42)], attachment };
const near = (a, b, e = 1e-8) => assert(Math.abs(a - b) < e, `${a} expected near ${b}`);

test('size, spacing, displacement, and profile distortion have independent effects', () => {
  const source = { brush, poses: [at(0), at(1)], step: .2 };
  const neutral = prepare({ ...source, looseness: {} });
  const sized = prepare({ ...source, looseness: { size: 2 } });
  const spaced = prepare({ ...source, looseness: { spacing: 2 } });
  assert.equal(sized.sampleCount, neutral.sampleCount);
  assert(spaced.sampleCount < neutral.sampleCount);
  near(sized.bounds.max[2], neutral.bounds.max[2] * 2);
  near(spaced.bounds.max[2], neutral.bounds.max[2]);
  const scatter = prepare({ ...source, looseness: { displacement: .14, seed: 12 } });
  assert.equal(scatter.sampleCount, neutral.sampleCount);
  near(scatter.bounds.max[2], neutral.bounds.max[2]);
  assert.notDeepEqual(scatter.bounds, neutral.bounds);
  assert.deepEqual(scatter.bounds, prepare({ ...source, looseness: { displacement: .14, seed: 12 } }).bounds);
  const uneven = prepare({ ...source, looseness: { irregularity: .9, seed: 12 } });
  assert.equal(uneven.sampleCount, neutral.sampleCount);
  near(uneven.bounds.max[2], neutral.bounds.max[2]);
  assert(uneven.bounds.min[0] < neutral.bounds.min[0]);
  assert.notEqual(uneven.sd(.12, .052, 0), neutral.sd(.12, .052, 0));
  assert.deepEqual(source.poses, [at(0), at(1)]);
});

test('an interior mask keeps neutral stations at the outer edge', () => {
  const poses = prepare({ brush, poses: [at(0), at(2)] }).guide;
  const definition = kit.prepare({ size: 2, spacing: 2, displacement: .1, irregularity: .6,
    interior: { center: [1, 0, 0], radii: [.65, .7, .7], feather: .25 } });
  const rows = kit.dabs(poses, .1, definition);
  assert(rows.some(row => row.amount === 1));
  assert(rows.some(row => row.amount > 0 && row.amount < 1));
  assert(rows.filter(row => row.pose.point[0] < .35 || row.pose.point[0] > 1.65).every(row => row.amount === 0));
  near(rows[1].pose.point[0] - rows[0].pose.point[0], .1);
  const inner = rows.findIndex(row => row.amount === 1);
  near(rows[inner + 1].pose.point[0] - rows[inner].pose.point[0], .2);
});

test('a looseness eraser restores local size and spacing and rejoins unaffected stations', () => {
  const poses = prepare({brush,poses:[at(0),at(2)]}).guide;
  const settings = kit.prepare({size:2,spacing:2,displacement:.1,seed:12});
  const mask = K.procedural.channelEraser.surface([{id:'wear',points:[[.7,0,0],[1.3,0,0]],radius:.2,channels:['looseness']}]);
  const before = kit.dabs(poses,.1,settings);
  const after = kit.dabs(poses,.1,settings,4096,point=>mask.remaining('looseness',point));
  const untouched = rows=>rows.filter(row=>row.pose.point[0]>=1.6-1e-8);
  assert.deepEqual(untouched(after),untouched(before));
  const inner = after.filter(row=>row.pose.point[0]>.7 && row.pose.point[0]<1.3);
  assert(inner.length>=5 && inner.every(row=>row.amount===0));
  near(inner[1].pose.point[0]-inner[0].pose.point[0],.1);
});

test('the allowance clips paint against the transformed receiver while the carrier field stays unchanged', () => {
  const transformed = { ...scene, solids: [{ ...plate, transform: { translation: [.3, 0, .2], scale: 1.5 } }] };
  const editor = ink.createSceneEditor(transformed), edit = { ...mark, poses: [at(.9, 0, .42), at(.98, 0, .42)],
    looseness: { size: 2.5, displacement: .03, silhouetteAllowance: .06 } };
  editor.applyPainting3d(placement([edit]));
  const before = K.diorama.brushField(transformed), after = K.diorama.brushField(editor.snapshot());
  const baked = editor.build(), paint = baked.made['paint.example.ink'];
  const x = .3 + 1.5 * .98, front = .2 + 1.5 * .15;
  assert(paint.sd(x, 0, front + 1.5 * .025) < 0);
  assert(paint.sd(x, 0, front + 1.5 * .085) > 0);
  const edge = .3 + 1.5 * 1.1;
  assert(paint.sd(edge + 1.5 * .03, 0, front - .02) < 0);
  assert(paint.sd(edge + 1.5 * .075, 0, front - .02) > 0);
  for (const point of [[edge + .02, 0, front], [x, 0, front + .03], [x, 0, front - .11]])
    near(after.sdf(...point), before.sdf(...point));
  assert.deepEqual(editor.snapshot().solids, transformed.solids);
});

test('zero allowance edits surface pigment while keeping the exact splat geometry', () => {
  const editor = ink.createSceneEditor(scene), bare = editor.build();
  const row = { ...mark, looseness: { size: 1.6, spacing: 1.3, irregularity: .6, silhouetteAllowance: 0 } };
  editor.applyPainting3d(placement([row]));
  const painted = editor.build();
  assert.deepEqual(editor.snapshot().solids, scene.solids);
  assert.equal(painted.count, bare.count);
  const changed = [];
  for (let i = 0; i < bare.count; i++) {
    const offset = i * 16;
    for (const axis of [0,1,2,3,4,5,6,8,9,10]) assert.equal(painted.data[offset + axis], bare.data[offset + axis]);
    if (painted.data[offset + 7] !== bare.data[offset + 7]) changed.push(i);
  }
  assert(changed.length > 15);
  assert(changed.every(i => painted.data[i * 16 + 2] > .12));
  const previous = editor.snapshot();
  assert.throws(() => editor.applyPainting3d({ id: 'example', edits: [{ op: 'set', id: 'ink', patch: {
    looseness: { size: 2 }
  } }] }, { update: true }), /State a silhouette allowance/);
  assert.deepEqual(editor.snapshot(), previous);
});

test('model export keeps the receiver when its entire relief mark is clipped', () => {
  const offFace = { ...mark, brush: { kind: 'sphere', radius: .025 }, poses: [at(0, 0, .42)],
    attachment: { ...attachment, snap: { ...attachment.snap, offset: .2 } }, looseness: { silhouetteAllowance: .03 } };
  const editor = ink.createSceneEditor(scene);
  editor.applyPainting3d(placement([offFace]));
  const model = K.diorama.scene(editor.snapshot()).model({ resolution: .07 });
  assert.deepEqual(model.meshes.map(mesh => mesh.name), ['guard']);
  assert(model.meshes[0].faces.length > 100);
});

test('CLI can revise and extract looseness without rewriting the recorded stroke', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-looseness-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const settings = { size: 2, spacing: 1.25, displacement: .034, irregularity: .66, seed: 77, silhouetteAllowance: .08 };
  save('base.json', scene);
  save('placement.json', placement([{ ...mark, looseness: { silhouetteAllowance: 0 } }]));
  save('edit.json', { id: 'example', edits: [{ op: 'set', id: 'ink', patch: { looseness: settings } }] });
  run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'painted.json');
  const report = JSON.parse(run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'revised.json'));
  assert.deepEqual(report.marks[0].looseness, settings);
  run('painting-3d', 'extract', 'revised.json', '--id', 'example', '--out', 'painting.json');
  assert.deepEqual(read('painting.json').marks[0], { ...mark, looseness: settings });
  for (const file of ['painted', 'revised'])
    run('render', file + '.json', '--ortho', '--w', '140', '--h', '105', '--out', file + '.png');
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'painted.png')), fs.readFileSync(path.join(dir, 'revised.png')));
});
