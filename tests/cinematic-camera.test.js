const test = require('node:test'),
  assert = require('node:assert/strict'),
  core = require('..'),
  kit = core.load(),
  K = kit.KIT,
  L = kit.CameraLens;
const near = (a, b, e = 1e-8) => assert(Math.abs(a - b) <= e, `${a} != ${b}`),
  height = c => 2 * c.dist * Math.tan(c.fov / 2),
  keys = (a, b, d = 4) => [
    { time: 0, value: a, ease: 'linear' },
    { time: d, value: b }
  ];
test('dolly zoom preserves subject-plane height and remains seekable', () => {
  const rig = K.cameraRig.compile({
    shots: { push: { focalLength: 28, motion: { type: 'dollyZoom', distance: keys(5, 14) } } }
  });
  assert.equal(rig.duration, 4);
  const first = rig.sample(0);
  for (const t of [0, 0.13, 1.5, 4, 2, 0]) {
    const frame = rig.sample(t);
    near(height(frame.camera), height(first.camera));
    near(frame.lens.focalLength, (28 * frame.camera.dist) / 5);
    assert.equal(frame.technique, 'dollyZoom');
  }
  assert.deepEqual(rig.sample(1), rig.sample(1));
});
test('tracked orbit and crane resolve current subject pose with local shot clocks', () => {
  const rig = K.cameraRig.compile({
    targets: { actor: { entity: 'hero' } },
    shots: {
      orbit: { target: 'actor', motion: { type: 'orbit', yaw: keys(0, Math.PI * 2), pitch: 0.2, distance: 8 } },
      crane: { target: 'actor', motion: { type: 'crane', eye: keys([0, 2, 6], [3, 7, 5]) } }
    },
    sequence: [
      { time: 0, shot: 'orbit' },
      { time: 4, shot: 'crane', blend: 1 }
    ]
  });
  const ctx = { resolveTarget: () => ({ point: [1, 1, 0] }) },
    orbit = rig.sample(2, ctx).camera;
  near(orbit.yaw, Math.PI);
  near(orbit.dist, 8);
  assert.deepEqual(orbit.target, [1, 1, 0]);
  const crane = rig.sample(6, ctx).camera,
    eye = L.target(crane, 1.5).map(
      (n, i) =>
        n +
        crane.dist *
          [
            Math.sin(crane.yaw) * Math.cos(crane.pitch),
            Math.sin(crane.pitch),
            Math.cos(crane.yaw) * Math.cos(crane.pitch)
          ][i]
    );
  [1.5, 4.5, 5.5].forEach((v, i) => near(eye[i], v));
});
test('subject framing, composition and lens breathing have explicit independent controls', () => {
  const rig = K.cameraRig.compile({
    shots: {
      portrait: {
        focalLength: 45,
        framing: { height: 2, coverage: 0.5 },
        composition: [1 / 3, 0.45],
        lensBreathing: { amount: 0.08, reference: 4, focus: keys(4, 1) }
      }
    }
  });
  const a = rig.sample(0),
    b = rig.sample(4);
  near(height(a.camera), 4);
  near(b.lens.focalLength / a.lens.focalLength, 1.24);
  assert.deepEqual(a.camera.composition, [1 / 3, 0.45]);
  near(a.camera.focusDistance, 4);
  near(b.camera.focusDistance, 1);
  const lensFit = K.cameraRig
    .compile({ shots: { fit: { dist: 10, framing: { height: 2, coverage: 0.5, mode: 'lens' } } } })
    .sample(0);
  near(height(lensFit.camera), 4);
});
test('shared lens layers honor FOV and millimeter overrides without inherited conflicts', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    world = { cam: { focalLength: 35, sensorHeight: 20, target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 } };
  const a = makeCamera(world, {}, 160, 100);
  near(a.lens.fov, 2 * Math.atan(10 / 35));
  near(makeCamera(world, { camera: { fov: 1 } }, 160, 100).lens.fov, 1);
  near(makeCamera(world, { focalLength: 50, sensorHeight: 24 }, 160, 100).lens.fov, L.fieldOfView(50));
  assert.throws(() => makeCamera(world, { fov: 1, focalLength: 50 }, 160, 100));
  for (const x of [0, NaN, -1, Infinity]) assert.throws(() => L.fieldOfView(x));
  near(L.focalLength(L.fieldOfView(50, 18), 18), 50);
});
test('composition projects a tracked subject onto the requested normalized screen location', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    subject = [1, 2, 3],
    world = { cam: { target: subject, dist: 8, yaw: 0.4, pitch: 0.3, focalLength: 40, composition: [1 / 3, 0.4] } };
  for (const [w, h] of [
    [160, 100],
    [100, 160]
  ]) {
    const c = makeCamera(world, {}, w, h),
      v = c.view,
      p = subject.map((_, r) => v[r] * subject[0] + v[r + 4] * subject[1] + v[r + 8] * subject[2] + v[r + 12]),
      u = 0.5 + p[0] / (-2 * p[2] * c.tangent * c.aspect),
      y = 0.5 - p[1] / (-2 * p[2] * c.tangent);
    near(u, 1 / 3, 1e-6);
    near(y, 0.4, 1e-6);
  }
});
test('free camera handoff starts at the current pose, damps input and rejoins the moving rig', () => {
  const rig = K.cameraRig.compile({
      shots: { orbit: { motion: { type: 'orbit', yaw: keys(0, 1, 10), distance: 8 } } }
    }),
    control = K.cameraRig.control(rig, { handoff: 0.5 });
  for (let i = 0; i < 60; i++) control.update(1 / 60, i / 60);
  const before = control.read();
  control.take();
  assert.deepEqual(control.read().camera, before.camera);
  control.input({ yaw: 0.6, pitch: 0.1, dolly: -0.1, pan: [0.2, 0] });
  const start = control.update(1e-6, 1);
  near(start.camera.yaw, before.camera.yaw, 1e-5);
  for (let i = 0; i < 90; i++) control.update(1 / 60, 1 + (i + 1) / 60);
  assert.equal(control.read().mode, 'free');
  near(control.read().camera.yaw, before.camera.yaw + 0.6, 1e-6);
  const from = control.read();
  control.release();
  assert.deepEqual(control.read().camera, from.camera);
  for (let i = 0; i < 60; i++) control.update(1 / 60, 2.5 + (i + 1) / 60);
  assert.equal(control.read().mode, 'rig');
  near(control.read().camera.yaw, rig.sample(3.5).camera.yaw);
});
test('free camera damping is frame-rate independent and invalid edits are atomic', () => {
  const source = { sample: () => ({ camera: { target: [0, 0, 0], dist: 8, yaw: 0, pitch: 0, fov: 0.7 } }) },
    a = K.cameraRig.control(source, { handoff: 0 }),
    b = K.cameraRig.control(source, { handoff: 0 });
  for (const c of [a, b]) {
    c.update(0, 0);
    c.take();
    c.input({ yaw: 0.5, dolly: 0.3 });
  }
  for (let i = 0; i < 30; i++) a.update(1 / 30);
  for (let i = 0; i < 144; i++) b.update(1 / 144);
  near(a.read().camera.yaw, b.read().camera.yaw, 1e-9);
  near(a.read().camera.dist, b.read().camera.dist, 1e-9);
  const before = a.read();
  assert.throws(() => a.input({ pan: [NaN, 1] }));
  assert.throws(() => a.input({ focalLength: -1 }));
  assert.deepEqual(a.read(), before);
  assert.throws(() => a.update(-1));
});
test('cinematic definitions reject ambiguous motion, invalid tracks, framing and projections', () => {
  for (const shot of [
    { motion: { type: 'dollyZoom', distance: 2 }, projection: 'orthographic' },
    { motion: { type: 'crane', eye: [0, 0, 1] }, yaw: 0 },
    { motion: { type: 'orbit', yaw: 1 }, eye: [0, 0, 1] },
    { motion: { type: 'orbit', pitch: 2 } },
    { composition: [1.1, 0.5] },
    { framing: { height: 0 } },
    { lensBreathing: { amount: 2, reference: 4, focus: 1 } }
  ])
    assert.throws(() => K.cameraRig.compile({ shots: { bad: shot } }));
  const rig = K.cameraRig.compile({ shots: { x: { motion: { type: 'dollyZoom', distance: 2 } } } });
  assert.throws(() => rig.sample(0, { base: { ortho: true } }));
});
test('non-rig scene and simulation timelines override inherited FOV with keyed focal length', () => {
  const source = {
    id: 'keyed-lens',
    camera: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, fov: 0.8 },
    solids: [{ id: 's', kind: 'box', at: [0, 0, 0], half: [0.2, 0.2, 0.2], mat: 'stone', res: 0.15 }],
    timeline: { tracks: [{ target: '/camera/focalLength', keys: keys(30, 60) }] }
  };
  const world = K.diorama.build(source);
  world.anim.update(0, 0);
  near(world.cam.fov, L.fieldOfView(30));
  world.anim.update(0.05, 4);
  near(world.cam.fov, L.fieldOfView(60));
  const run = K.world.runtime.create({
    id: 'sim-lens',
    dt: 0.1,
    visual: { camera: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, fov: 0.8 } },
    timeline: source.timeline
  });
  run.advance(40);
  near(K.world.visual(kit, run.view(), run.query()).cam.fov, L.fieldOfView(60));
});
test('browser and headless camera use identical lens and composition for rig and free overrides', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    B = kit.makeBuilder(1, [0, 0xffffff]);
  B.iso(0, 0, 0, 0.1, B.P[1], 3);
  const world = B.finish();
  world.cam = { target: [0, 0, 0], dist: 5, yaw: 0.2, pitch: 0.1, focalLength: 35, composition: [1 / 3, 0.4] };
  for (const camera of [
    undefined,
    { focalLength: 50, sensorHeight: 18, yaw: 0.4, dist: 6, composition: [0.6, 0.45] }
  ]) {
    const view = makeCamera(world, { camera }, 120, 80);
    let report;
    require('../cli/render.js').render(world, {
      w: 120,
      h: 80,
      px: 1,
      raw: true,
      camera,
      shotFrame: f => (report = f)
    });
    const actual = report.camera;
    near(actual.fov ?? K.cameraRig.defaultFov, view.lens.fov);
    const back = [
        Math.sin(actual.yaw) * Math.cos(actual.pitch),
        Math.sin(actual.pitch),
        Math.cos(actual.yaw) * Math.cos(actual.pitch)
      ],
      eye = actual.target.map((n, i) => n + actual.distance * back[i]);
    eye.forEach((n, i) => near(n, view.eye[i], 1e-6));
  }
});
test('control can start on a later frame and reports handoff modes immediately', () => {
  const rig = K.cameraRig.compile({ shots: { x: { motion: { type: 'orbit', yaw: keys(0, 1, 10) } } } }),
    c = K.cameraRig.control(rig);
  c.update(0.016, 5);
  const at = c.read();
  c.take();
  assert.equal(c.read().mode, 'toFree');
  const next = c.update(1e-6, 5.000001);
  near(next.camera.yaw, at.camera.yaw, 1e-5);
  c.release({ duration: 0 });
  assert.equal(c.read().mode, 'rig');
});
test(
  'native browser module bridge renders millimeter lenses, composition and cinematic shots',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')(
      {},
      () => null,
      (kit, fixture, backend) => {
        // Fixture functions are serialized; keep their track definition local to the browser.
        const spec = {
          id: 'native-cinematic',
          camera: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, focalLength: 35 },
          solids: [{ id: 'subject', kind: 'box', at: [0, 0, 0], half: [0.3, 0.5, 0.2], mat: 'stone', res: 0.08 }],
          cameraRig: {
            shots: {
              dolly: {
                motion: {
                  type: 'dollyZoom',
                  distance: [
                    { time: 0, value: 4, ease: 'linear' },
                    { time: 4, value: 10 }
                  ]
                },
                framing: { height: 1, coverage: 0.5, mode: 'lens' },
                composition: [1 / 3, 0.5]
              }
            }
          }
        };
        const world = kit.KIT.diorama.build(spec),
          draw = backend(120, 80, { raw: true });
        try {
          draw.draw(world, { time: 0 });
          const a = draw.image();
          draw.draw(world, { time: 4 });
          const b = draw.image();
          draw.draw(world, { time: 4, camera: { focalLength: 20, sensorHeight: 18, composition: [0.65, 0.4] } });
          return {
            drawn: a.length > 0,
            changed: draw.image() !== b,
            height: 2 * world.cameraRig.sample(4).camera.dist * Math.tan(world.cameraRig.sample(4).camera.fov / 2)
          };
        } finally {
          draw.close();
        }
      }
    );
    assert(result.drawn && result.changed);
    near(result.height, 2);
  }
);
test('free-control limits do not snap an authored camera outside their range', () => {
  const source = { sample: () => ({ camera: { target: [0, 0, 0], dist: 10, yaw: 1, pitch: 0.2, fov: 0.7 } }) },
    c = K.cameraRig.control(source, { limits: { yaw: [-0.2, 0.2], distance: [3, 6] } });
  c.update(0, 0);
  c.take();
  const at = c.update(1e-6, 1e-6);
  near(at.camera.yaw, 1, 1e-8);
  near(at.camera.dist, 10, 1e-8);
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  assert(c.read().camera.yaw <= 0.2 + 1e-8);
  assert(c.read().camera.dist <= 6 + 1e-8);
});
