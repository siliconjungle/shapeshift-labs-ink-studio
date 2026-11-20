const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const PNG = require('../cli/png.js');
const kit = studio.load(), K = kit.KIT, W = K.world;
const close = (a, b, tolerance = 1e-8) => assert(Math.abs(a-b) < tolerance, `${a} is not close to ${b}`);
const frameHeight = ({ dist, fov }) => dist*Math.tan(fov/2);

function diorama() {
  return {
    id: 'authored-rig',
    camera: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5 },
    solids: [
      { id: 'figure', kind: 'box', at: [0, 0, 0], half: [.45, .52, .3], part: 'body', mat: 'stone', res: .08 },
      { id: 'accent', kind: 'box', at: [.5, .21, .14], half: [.2, .25, .17], mat: 'accent', res: .08 }
    ],
    parts: { body: { joint: [0, 0, 0] } },
    cameraRig: {
      duration: 2,
      targets: { figure: { part: 'body', point: [0, 0, 0], offset: [0, .15, 0] } },
      rails: { track: { points: [[0, .15, 5], [1, .15, 5], [1, .15, 3]], curve: 0 } },
      shots: {
        rail: { target: 'figure', rail: 'track', progress: [{ time: 0, value: 0, ease: 'linear' }, { time: 2, value: 1 }] },
        close: { target: 'figure', eye: [2, 1.5, 3], fov: .48, projection: 'orthographic' }
      },
      sequence: [{ time: 0, shot: 'rail' }, { time: 1, shot: 'close', blend: .8, projectionAt: .25, ease: 'linear' }]
    }
  };
}

test('shots advance their local rail clocks and change projection without jumping the eye or subject scale', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs');
  const source = diorama(), program = K.cameraRig.compile(source.cameraRig);
  assert.equal(program.duration, 2);
  const half = program.sample(1, { shot: 'rail', resolveTarget: ({ point }) => ({ point }) }).camera;
  close(half.dist, Math.hypot(1, 4.5));
  close(half.yaw, Math.atan2(1, 4.5));
  const world = K.diorama.build(source);
  const a = world.cameraRig.sample(1.199999), b = world.cameraRig.sample(1.2);
  assert.equal(a.camera.ortho, false);
  assert.equal(b.camera.ortho, true);
  close(a.blend.weight, .25, 2e-6);
  close(frameHeight(a.camera), frameHeight(b.camera), 2e-6);
  const before = makeCamera(world, { time: 1.199999 }, 120, 80);
  const after = makeCamera(world, { time: 1.2 }, 120, 80);
  before.eye.forEach((n, i) => close(n, after.eye[i], 3e-6));
  assert.deepEqual(world.cameraRig.sample(2).camera, world.cameraRig.sample(2, { shot: 'close' }).camera);
  assert.equal(world.cameraRig.sample(.5).shot, 'rail');

  const crossing = K.cameraRig.compile({
    shots: { a: { yaw: 3.1 }, b: { yaw: -3.1 } },
    sequence: [{ time: 0, shot: 'a' }, { time: 1, shot: 'b', blend: 1 }]
  }).sample(1.5);
  close(crossing.camera.yaw, Math.PI);
});

test('diorama tracks can select an authored shot and adjust its rail, framing target and lens', () => {
  const source = diorama();
  const key = (target, value) => ({ target, keys: [{ time: 0, value }] });
  source.timeline = { tracks: [
    key('/camera/shot', 'rail'), key('/camera/railProgress', 1), key('/camera/fov', .8),
    key('/poses/body/translation', [1, 0, 0]), key('/poses/body/rotation', [0, 0, Math.PI/2])
  ] };
  const world = studio.createSceneEditor(source).build();
  world.anim.update(0, 0);
  const { shot, camera } = world.cameraRig.sample(1.6);
  assert.equal(shot, 'rail');
  close(camera.target[0], .85);
  close(camera.target[1], 0);
  close(camera.dist, Math.hypot(.15, .15, 3));
  assert.equal(camera.fov, .8);
  assert.equal(world.cameraRig.sample(1.6, { shot: 'close' }).camera.ortho, true);
});

test('avoidance shortens in front of a baked wall, tries alternate angles and honors named exclusions', () => {
  const source = diorama();
  source.cameraRig.shots = { front: { target: 'figure', yaw: 0, pitch: 0, dist: 8 } };
  delete source.cameraRig.sequence;
  source.solids.push({ id: 'wall', kind: 'box', at: [0, 0, 3], half: [.65, 1, .12], res: .1, mat: 'moss' });
  source.cameraRig.avoidance = true;
  const first = K.diorama.build(source).cameraRig.sample(0);
  assert(first.avoidance.shortened);
  assert(!first.avoidance.occluded);
  close(first.camera.dist, 3 - .12 - .12, .12);
  close(frameHeight(first.camera), 8*Math.tan(K.cameraRig.defaultFov/2));
  source.cameraRig.avoidance = { yawOffsets: [.45, -.45] };
  const clear = K.diorama.build(source).cameraRig.sample(0);
  assert.equal(clear.camera.dist, 8);
  assert.equal(clear.avoidance.yawOffset, -.45);
  source.cameraRig.avoidance = { ignore: [{ entity: 'wall' }] };
  assert.equal(K.diorama.build(source).cameraRig.sample(0).camera.dist, 8);

  source.cameraRig.avoidance = { minDistance: 4 };
  const blocked = K.diorama.build(source).cameraRig.sample(0);
  assert.equal(blocked.camera.dist, 4);
  assert(blocked.avoidance.occluded);
});

test('world camera tracks simulation sockets across ticks and can avoid invisible collision geometry', () => {
  const source = simulation();
  const run = W.runtime.create(source);
  run.advance(5);
  const world = W.visual(kit, run.view(), run.query());
  const sample = world.cameraRig.sample(run.view().time);
  close(sample.camera.target[0], .7);
  close(sample.camera.target[1], 1.2);
  assert(sample.avoidance.shortened);
  close(sample.camera.dist, 2.68, .01);
  const checkpoint = run.checkpoint(), resumed = W.runtime.create(checkpoint.world, { checkpoint });
  assert.deepEqual(W.visual(kit, resumed.view(), resumed.query()).cameraRig.sample(.5), sample);
});

function simulation() {
  return { id: 'sim-rig', dt: .1, entities: { actor: { sockets: { head: [0, .2, 0] },
    visual: { kind: 'box', half: [.4, .4, .4] } } },
    systems: { rig: { kind: 'mechanics', config: { gravity: [0, 0, 0], ground: -5, drag: 0,
      bodies: {
        body: { entity: 'actor', position: [0, 1, 0], velocity: [1, 0, 0], half: [.4, .4, .4] },
        wall: { fixed: true, position: [0, 1, 3], half: [2, 2, .2] }
      } } } },
    visual: { cameraRig: {
      targets: { face: { entity: 'actor', socket: 'head', offset: [.2, 0, 0] } },
      shots: { front: { target: 'face', yaw: 0, pitch: 0, dist: 7 } },
      avoidance: { field: 'rig/clearance' }
    } }
  };
}

test('validation catches dangling shots and parts, invalid projection, rails, and overlapping blends', () => {
  const compile = K.cameraRig.compile;
  assert.throws(() => compile({ shots: { close: { target: 'missing' } } }), /invalid shot close/);
  assert.throws(() => compile({ shots: { close: { projection: 'fisheye' } } }), /invalid shot close/);
  assert.throws(() => compile({ shots: { wide: {} }, rails: { flat: { points: [[0,0,0], [0,0,0]] } } }), /invalid rail flat/);
  const spec = diorama();
  spec.cameraRig.sequence.push({ time: 1.3, shot: 'rail' });
  assert.throws(() => compile(spec.cameraRig), /overlapping transition/);
  spec.cameraRig.sequence.pop();
  spec.cameraRig.targets.figure.part = 'missing';
  assert(K.diorama.check(spec).some(row => row.path === 'cameraRig' && /framing target/.test(row.problem)));
  spec.cameraRig.targets.figure.part = 'body';
  spec.timeline = { tracks: [{ target: '/camera/shot', keys: [{ time: 0, value: 'missing' }] }] };
  assert(K.diorama.check(spec).some(row => row.path === 'timeline' && /keyframe value/.test(row.problem)));
});

test('CLI inspects rigs, renders authored shots and derives clip duration from the rig', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-camera-rig-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), scene = path.join(dir, 'scene.json');
  const sim = path.join(dir, 'world.json'), png = path.join(dir, 'shot.png');
  fs.writeFileSync(scene, JSON.stringify(diorama()));
  fs.writeFileSync(sim, JSON.stringify(W.manifest(simulation())));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' });
  const report = JSON.parse(call('camera-rig', scene, '--at', '1.4'));
  assert.equal(report.blend.from, 'rail');
  assert.equal(report.camera.ortho, true);
  const simReport = JSON.parse(call('camera-rig', sim, '--at', '.5'));
  assert.equal(simReport.avoidance.shortened, true);
  function render(args) {
    call(...args, '--w', '84', '--h', '64', '--px', '1', '--out', png);
    return Buffer.from(PNG.read(png).rgb);
  }
  assert(!render(['render', scene, '--t', '0']).equals(render(['render', scene, '--t', '0', '--camera-shot', 'close'])));
  assert(render(['sim', 'render', sim, '--t', '.5', '--camera-shot', 'front']).length > 0);
  call('clip', scene, '--fps', '3', '--w', '84', '--h', '64', '--px', '1', '--out', png);
  const apng = fs.readFileSync(png), acTL = apng.indexOf('acTL');
  assert(acTL > 0);
  assert.equal(apng.readUInt32BE(acTL + 4), 6);
});

test('WebGL draws the authored perspective and orthographic shots and accepts an explicit shot', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { changed, equal } = runWebGL({}, diorama, (kit, fixture, backend) => {
    const world = kit.KIT.diorama.build(fixture()), draw = backend(100, 76, { raw: true });
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const first = draw.image();
      draw.draw(world, { time: 2 });
      const last = draw.image();
      draw.draw(world, { time: 0, cameraShot: 'close' });
      return { changed: last !== first, equal: last === draw.image() };
    } finally {
      draw.close();
    }
  });
  assert(changed);
  assert(equal);
});
