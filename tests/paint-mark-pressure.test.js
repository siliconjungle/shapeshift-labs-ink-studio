'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const kit = ink.load(), { KIT: K } = kit;
const { prepare } = K.procedural.shapeSweeps;
const point = (x, y, z, pressure, rotation) => ({ point: [x, y, z], pressure, ...(rotation && { rotation }) });
const quarter = [0, 0, Math.SQRT1_2, Math.SQRT1_2], round = { kind: 'sphere', radius: .18 };
const plate = { kind: 'box', id: 'plate', at: [0, 0, 0], half: [1.45, .82, .16], mat: 'stone', res: .08 };
const base = { id: 'mark-test', solids: [plate] };
const stroke = { id: 'stroke', brush: round, mat: 'ember', res: .048,
  poses: [point(-.8, -.1, .18, 0), point(0, .56, .18, .5, quarter), point(.8, -.1, .18, 1)] };
const dab = { id: 'dab', brush: { kind: 'box', half: [.18, .065, .05] }, mat: 'accent', res: .03,
  poses: [point(0, -.47, .19, .42, quarter)], pressureResponse: { width: [1, 1] } };
const placement = marks => ({ id: 'test', painting: { format: K.authoring.paintings3d.format, version: 1, id: 'guide', marks } });
const close = (a, b, eps = 1e-8) => assert(Math.abs(a - b) < eps, `${a} expected near ${b}`);
const alphas = (world, entity) => Array.from(world.renderMetadata.targetIds,
  (id, i) => world.renderMetadata.targets[id]?.entity === entity ? world.data[i * 16 + 3] : null).filter(n => n !== null);

test('a dab is one oriented sample and width and opacity map independently', () => {
  const stamp = prepare(dab);
  assert.equal(stamp.sampleCount, 1);
  assert(stamp.sd(0, -.32, .19) < 0);
  assert(stamp.sd(.15, -.47, .19) > 0);
  assert(stamp.bounds.max[0] - stamp.bounds.min[0] < .14);
  const poses = [point(-1, 0, 0, 0), point(1, 0, 0, 1)];
  const fade = prepare({ brush: round, poses, pressureResponse: { opacity: [0, .9] } });
  const held = prepare({ brush: round, poses, pressureResponse: { width: [1, 1] } });
  assert.deepEqual(fade.bounds, held.bounds);
  close(fade.opacityAt(-1, .1, 0), 0);
  close(fade.opacityAt(0, .1, 0), .45);
  close(fade.opacityAt(1, .1, 0), .9);
  const taper = prepare({ brush: round, poses, pressureResponse: { width: [.4, 1.4] } });
  assert(taper.sd(-.86, .16, 0) > 0);
  assert(taper.sd(.86, .16, 0) < 0);
  assert.equal(taper.opacityAt, undefined);
  assert.throws(() => prepare({ ...dab, pressureResponse: { opacity: [0, 1.1] } }), /Pressure response/);
});

test('ruling straightens the guide without changing recorded samples or surface snapping', () => {
  const line = { ...stroke, path: 'ruled', pressureResponse: { width: [.6, 1.3] } };
  const free = prepare({ ...line, path: 'free' }), ruled = prepare(line);
  assert.deepEqual(ruled.guide.map(pose => pose.pressure), [0, .5, 1]);
  assert.deepEqual(ruled.guide[1].rotation, free.guide[1].rotation);
  assert(ruled.guide.every(pose => pose.point[1] === -.1));
  assert(ruled.sd(0, -.1, .18) < 0);
  assert(ruled.sd(0, .56, .18) > 0);
  assert(free.sd(0, .56, .18) < 0);
  assert.throws(() => prepare({ ...dab, path: 'ruled' }), /distinct first and last/);
  const engine = K.procedural.sweepSnap;
  const snap = { mode: 'surface', maxDistance: .5, direction: [0, 0, 1], spacing: .12 };
  const projected = engine.resolve({ ...line, kind: 'sweep' }, snap, (x, y, z) => z - .1 * x * x);
  assert(projected.contacts.length > 3);
  assert(projected.contacts.every(({ point }) => Math.abs(point[1] + .1) < 1e-8));
  assert(projected.contacts.some(({ point }) => Math.abs(point[0]) < .1 && point[2] < .01));
  assert.deepEqual(line.poses, stroke.poses);
});

test('mapped opacity survives placement, rig motion and model export without erasing the receiver', () => {
  const scene = { ...base, solids: [{ ...plate, part: 'face' }], parts: { face: { joint: [0, 0, 0] } },
    motion: [{ do: 'turn', part: 'face', axis: [0, 1, 0], amount: .5, period: 2 }] };
  const layered = { ...stroke, path: 'ruled', transform: { position: [.15, 0, .08] },
    pressureResponse: { opacity: [.12, .88] }, attachment: { kind: 'part', slot: 'face' } };
  const editor = ink.createSceneEditor(scene);
  editor.applyPainting3d({ ...placement([layered]), bindings: { face: 'face' } });
  const world = editor.build(), name = 'paint.test.stroke', mark = world.made[name];
  close(mark.mat.opacityAt(-.65, -.1, .26), .12);
  close(mark.mat.opacityAt(.95, -.1, .26), .88);
  const alpha = alphas(world, name);
  assert(alpha.length > 30 && Math.min(...alpha) < .2 && Math.max(...alpha) > .8);
  assert(alphas(world, 'plate').some(a => a >= 1));
  const first = world.lab.rig.at('face', mark.bc);
  require('../cli/diarama-pose.js').pose(world, .5, { kit });
  assert(K.V.dist(world.lab.rig.at('face', mark.bc), first) > .03);
  assert.deepEqual(alphas(world, name), alpha);
  const model = K.diorama.scene(editor.snapshot()).model({ resolution: .12, duration: 1, fps: 4 });
  assert(model.meshes.some(mesh => mesh.name === 'face' && mesh.materials.every(row => row.opacity === undefined)));
  const overlay = model.meshes.find(mesh => mesh.name === name);
  assert(overlay.paintedOpacity && overlay.weights.length && overlay.materials.some(row => row.opacity < .2));
  assert(overlay.materials.some(row => row.opacity > .8));
});

test('CLI revisions preserve the original pressure and orientation across an opacity-to-width remap', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mark-pressure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const original = { ...stroke, path: 'ruled', pressureResponse: { opacity: [.04, .88] } };
  save('base.json', base);
  save('place.json', placement([original, dab]));
  save('edit.json', { id: 'test', edits: [{ op: 'set', id: 'stroke', patch: { pressureResponse: { width: [.35, 1.2] } } }] });
  run('painting-3d', 'apply', 'base.json', 'place.json', '--out', 'painted.json');
  run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'updated.json');
  run('painting-3d', 'extract', 'updated.json', '--id', 'test', '--out', 'extracted.json');
  assert.deepEqual(read('extracted.json').marks[0].poses, original.poses);
  assert.deepEqual(read('extracted.json').marks[1], dab);
  assert.deepEqual(JSON.parse(run('painting-3d', 'inspect', 'updated.json'))[0].marks[0].pressureResponse, { width: [.35, 1.2] });
  for (const scene of ['painted', 'updated']) run('render', scene + '.json', '--ortho', '--w', '130', '--h', '100', '--out', scene + '.png');
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'painted.png')), fs.readFileSync(path.join(dir, 'updated.png')));
});
