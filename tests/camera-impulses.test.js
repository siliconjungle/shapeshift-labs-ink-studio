const test = require('node:test'),
  assert = require('node:assert/strict'),
  core = require('..'),
  kit = core.load(),
  K = kit.KIT,
  I = kit.CameraImpulses,
  L = kit.CameraLens;
const near = (a, b, e = 1e-8) => assert(Math.abs(a - b) <= e, `${a} != ${b}`),
  nearVec = (a, b, e = 1e-8) => a.forEach((n, i) => near(n, b[i], e)),
  pose = { eye: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] },
  pulse = {
    translation: [0.2, 0, 0],
    rotation: [0, 0, 0.1],
    profile: 'spring',
    frequency: 1,
    damping: 0,
    attack: 0,
    duration: 1
  };
test('directional impulses start and end at rest and can be sampled repeatedly or out of order', () => {
  const e = I.create();
  e.emit(pulse);
  nearVec(e.sample(0).translation, [0, 0, 0]);
  nearVec(e.sample(0.25).translation, [0.2, 0, 0]);
  nearVec(e.sample(0.25).rotation, [0, 0, 0.1]);
  nearVec(e.sample(1).translation, [0, 0, 0]);
  const a = e.sample(0.25),
    saved = e.snapshot();
  e.sample(0.8);
  assert.deepEqual(e.sample(0.25), a);
  assert.deepEqual(e.snapshot(), saved);
  assert(Object.isFrozen(a.contributions[0].translation));
});
test('camera-space, world-space and source-oriented impacts resolve into the unshaken listener frame', () => {
  const turned = { eye: [0, 0, 0], right: [0, 0, -1], up: [0, 1, 0], back: [1, 0, 0] },
    local = I.create({ impulses: [pulse] }),
    world = I.create({ impulses: [{ ...pulse, space: 'world' }] });
  nearVec(local.sample(0.25, { pose: turned }).translation, [0, 0, -0.2]);
  nearVec(world.sample(0.25, { pose: turned }).translation, [0.2, 0, 0]);
  const left = I.create({
      impulses: [{ ...pulse, translation: [0, 0, 0.2], rotation: [0, 0, 0], space: 'impact', source: [10, 0, 0] }]
    }),
    right = I.create({
      impulses: [{ ...pulse, translation: [0, 0, 0.2], rotation: [0, 0, 0], space: 'impact', source: [-10, 0, 0] }]
    });
  nearVec(left.sample(0.25).translation, [-0.2, 0, 0]);
  nearVec(right.sample(0.25).translation, [0.2, 0, 0]);
});
test('distance falloff and propagation delays distinguish nearby impacts from distant thunder', () => {
  const e = I.create({
    impulses: [{ ...pulse, source: [10, 0, 0], falloff: { inner: 0, outer: 20, power: 2 }, propagationSpeed: 10 }]
  });
  const waiting = e.sample(0.5);
  assert.equal(waiting.activeCount, 0);
  assert.equal(waiting.pending[0].arrival, 1);
  nearVec(e.sample(1.25).translation, [0.05, 0, 0]);
  near(e.sample(1.25).contributions[0].gain, 0.25);
  const far = { ...pose, eye: [-11, 0, 0] };
  assert.equal(e.sample(2.35, { pose: far }).activeCount, 0);
  assert.equal(e.sample(2.35, { pose: far }).pending.length, 0);
});
test('angular leverage derives signed rotation from impact translation without rotating the eye around a target', () => {
  const e = I.create({
    impulses: [
      { ...pulse, translation: [0.2, 0, 0], rotation: [0, 0, 0], space: 'world', lever: [0, 0.5, 0], angularGain: 1 }
    ]
  });
  const f = e.sample(0.25);
  nearVec(f.rotation, [0, 0, -0.1]);
  const moved = L.applyMotion(pose, f);
  nearVec(moved.eye, [0.2, 0, 0]);
  near(moved.right[0], Math.cos(0.1));
  near(moved.right[1], -Math.sin(0.1));
  nearVec(L.fromView(L.matrix(moved)).eye, moved.eye);
});
test('layered handheld motion is seeded, bounded, frame-rate independent and retains its phase on edits', () => {
  const def = {
      handheld: [
        { id: 'breath', frequency: 0.3, seed: 11 },
        { id: 'steps', frequency: 2.2, seed: 15, translation: [0.01, 0.02, 0], rotation: [0.001, 0, 0] }
      ]
    },
    a = I.create(def),
    b = I.create(def);
  for (let i = 0; i < 30; i++) a.advance(1 / 30);
  for (let i = 0; i < 144; i++) b.advance(1 / 144);
  nearVec(a.sample().translation, b.sample().translation, 1e-12);
  nearVec(a.sample().rotation, b.sample().rotation, 1e-12);
  const before = a.sample(2),
    layer = a.snapshot().handheld[1];
  a.setLayer({ id: 'steps', weight: 1 });
  assert.equal(a.snapshot().handheld[1].seed, layer.seed);
  assert.deepEqual(a.sample(2), before);
  a.removeLayer('steps');
  assert.equal(a.sample(2).contributions.length, 1);
  assert.notDeepEqual(a.sample(2).translation, before.translation);
});
test('layer superposition is deterministic and independent translation/rotation limits are inspectable', () => {
  const a = I.create({
      impulses: [
        { ...pulse, id: 'a' },
        { ...pulse, id: 'b' }
      ],
      translationLimit: 0.3,
      rotationLimit: 0.15
    }),
    b = I.create({
      impulses: [
        { ...pulse, id: 'b' },
        { ...pulse, id: 'a' }
      ],
      translationLimit: 0.3,
      rotationLimit: 0.15
    });
  assert.deepEqual(a.sample(0.25), b.sample(0.25));
  nearVec(a.sample(0.25).translation, [0.3, 0, 0]);
  nearVec(a.sample(0.25).rotation, [0, 0, 0.15]);
  near(a.sample(0.25).limits.translationScale, 0.75);
  near(a.sample(0.25).limits.rotationScale, 0.75);
});
test('motion checkpoints restore events, handheld settings and clock compensation atomically', () => {
  const a = I.create({ seed: 23, handheld: [{ id: 'hand' }] });
  a.emit(I.preset('recoil'));
  a.advance(0.05);
  const saved = JSON.parse(JSON.stringify(a.snapshot())),
    b = I.restore(saved);
  for (const dt of [0.01, 0.1, 0.03]) {
    assert.deepEqual(a.advance(dt), b.advance(dt));
  }
  const bad = JSON.parse(JSON.stringify(saved));
  bad.impulses[0].frequency = -1;
  const before = a.snapshot();
  assert.throws(() => a.restore(bad));
  assert.deepEqual(a.snapshot(), before);
  a.reset();
  assert.equal(a.time, 0);
  assert.equal(a.snapshot().impulses.length, 0);
  assert.equal(a.snapshot().handheld.length, 1);
});
test('history cancellation, safe pruning and budget failures do not alter existing effects', () => {
  const e = I.create({ maxImpulses: 2 });
  const a = e.emit(pulse);
  e.emit({ ...pulse, id: 'other', time: 2 });
  const saved = e.snapshot();
  assert.throws(() => e.emit(pulse));
  assert.deepEqual(e.snapshot(), saved);
  e.cancel(a);
  assert.equal(e.sample(0.25).activeCount, 0);
  e.prune(4);
  assert.equal(e.snapshot().impulses.length, 0);
  const delayed = I.create({
    impulses: [{ ...pulse, source: [10, 0, 0], falloff: { outer: 20 }, propagationSpeed: 10 }]
  });
  delayed.prune(1.5);
  assert.equal(delayed.snapshot().impulses.length, 1);
  delayed.prune(3);
  assert.equal(delayed.snapshot().impulses.length, 0);
});
test('existing numeric animation shake is preserved while object impulses opt into the directional layer', () => {
  const c = K.anim.camera({ rate: 50, decay: 12 });
  c.impulse(0.2);
  const out = c.advance(0.1);
  nearVec(out, [Math.sin(5 * 12.9898) * 0.2 * Math.exp(-1.2), Math.sin(5 * 78.233 + 1) * 0.2 * Math.exp(-1.2), 0]);
  c.impulse(pulse);
  nearVec(c.sample(0.35).translation, [0.2, 0, 0]);
  c.advance(0.1);
  near(c.effects.time, 0.2);
  const world = {};
  const unbind = c.bind(world);
  assert.equal(world.cameraImpulses, c.effects);
  unbind();
  assert.equal(world.cameraImpulses, undefined);
});
test('browser and headless renderers apply the same full six-axis pose in perspective and orthographic views', async () => {
  const { makeCamera, cameraPose } = await import('../src/webgl/view.mjs'),
    B = kit.makeBuilder(1, [0, 0xffffff]);
  B.iso(0, 0, 0, 0.1, B.P[1], 3);
  const world = B.finish();
  world.cam = { target: [0, 0, 0], dist: 5, yaw: 0.3, pitch: 0.2, fov: 0.7 };
  world.radius = 14;
  world.cameraImpulses = I.create({
    impulses: [{ ...pulse, translation: [0.03, 0.02, 0.04], rotation: [0.03, 0.01, 0.08] }]
  });
  for (const ortho of [false, true]) {
    const frame = { time: 0.25, camera: { ortho } },
      view = makeCamera(world, frame, 120, 80);
    let captured;
    require('../cli/render.js').render(world, {
      w: 120,
      h: 80,
      px: 1,
      raw: true,
      t: 0.25,
      camera: { ortho },
      cameraFrame: f => (captured = f)
    });
    const gpu = cameraPose(view);
    for (const key of ['eye', 'right', 'up', 'back']) nearVec(captured.pose[key], gpu[key], 2e-6);
    const rest = makeCamera(world, { ...frame, cameraImpulses: false }, 120, 80);
    assert.notDeepEqual(view.view, rest.view);
    const locked = makeCamera(world, { ...frame, lockCamera: true }, 120, 80);
    nearVec(locked.view, rest.view);
  }
});
test('orthographic spatial effects use the physical listener instead of the artificial rendering setback', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    world = {
      cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
      radius: 20,
      cameraImpulses: I.create({ impulses: [{ ...pulse, source: [0, 0, 5], falloff: { outer: 2 } }] })
    };
  const view = makeCamera(world, { time: 0.25 }, 120, 80);
  near(view.cameraImpulse.contributions[0].distance, 0);
  nearVec(view.cameraImpulse.translation, [0.2, 0, 0]);
});
test('camera effects use camera time, are read-only across views and can be disabled', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    clocks = K.timeDomains.create({ domains: { animation: { paused: true } } }),
    effects = I.create({ impulses: [pulse] }),
    world = { cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 }, timeDomains: clocks, cameraImpulses: effects };
  clocks.advance(0.25);
  const before = effects.snapshot(),
    a = makeCamera(world, {}, 120, 80),
    b = makeCamera(world, {}, 120, 80);
  near(a.cameraImpulse.time, 0.25);
  assert.deepEqual(a.view, b.view);
  assert.deepEqual(effects.snapshot(), before);
  assert.equal(makeCamera(world, { cameraImpulses: false }, 120, 80).cameraImpulse, undefined);
  assert.equal(makeCamera(world, { cameraTime: 1 }, 120, 80).cameraImpulse.activeCount, 0);
});
test('invalid impulses, layers, camera bases and edits fail before changing a live history', () => {
  const e = I.create(),
    saved = e.snapshot();
  for (const input of [
    { direction: [0, 0, 0], space: 'impact' },
    { space: 'impact' },
    { translation: [Infinity, 0, 0] },
    { falloff: { outer: 0 } },
    { propagationSpeed: 2 },
    { rotation: [0, 0] },
    { seed: -1 },
    { duration: 0 },
    { unexpected: 1 }
  ])
    assert.throws(() => e.emit(input));
  assert.deepEqual(e.snapshot(), saved);
  assert.throws(() => e.setLayer({ id: 'bad', frequency: 0 }));
  assert.throws(() => e.sample(0.1, { pose: { ...pose, right: [2, 0, 0] } }));
  assert.throws(() => I.create({ rotationLimit: -1 }));
  assert.throws(() => I.preset('missing'));
});
test('portable look definitions and the CLI inspect the same contributions and applied pose', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    { execFileSync } = require('node:child_process'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-camera-impulse-'));
  try {
    const input = path.join(dir, 'motion.json');
    fs.writeFileSync(input, JSON.stringify({ impulses: [{ ...pulse, id: 'hit' }] }));
    const json = JSON.parse(
      execFileSync(
        process.execPath,
        [path.resolve('cli/ink-studio.js'), 'camera-impulses', input, '--at', '.25', '--eye', '0,0,5'],
        { encoding: 'utf8' }
      )
    );
    nearVec(json.translation, [0.2, 0, 0]);
    nearVec(json.pose.eye, [0.2, 0, 5]);
    assert.equal(json.contributions[0].id, 'hit');
    const world = { look: { cameraImpulses: { impulses: [pulse] } } };
    nearVec(I.frame(world, { cameraTime: 0.25 }, pose).translation, [0.2, 0, 0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test(
  'native WebGL consumes the same roll and translation with pure sampling',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')(
      {},
      () => null,
      (kit, fixture, backend) => {
        const K = kit.KIT,
          B = kit.makeBuilder(1, [0x101c35, 0xffc483]);
        B.iso(0.4, 0.3, 0, 0.25, B.P[1], 3);
        const world = B.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } }),
          effects = K.cameraImpulses.create({
            impulses: [
              { translation: [0.12, 0, 0], rotation: [0, 0, 0.18], duration: 1, damping: 0, frequency: 1, attack: 0 }
            ]
          });
        effects.bind(world);
        const draw = backend(120, 80, { raw: true });
        try {
          draw.draw(world, { time: 0 });
          const initial = draw.image(),
            before = JSON.stringify(effects.snapshot());
          draw.draw(world, { time: 0.25 });
          const shaken = draw.image();
          draw.draw(world, { time: 0.25 });
          const same = shaken === draw.image();
          draw.draw(world, { time: 0.25, cameraImpulses: false });
          return {
            changed: initial !== shaken,
            same,
            restored: initial === draw.image(),
            pure: before === JSON.stringify(effects.snapshot())
          };
        } finally {
          draw.close();
        }
      }
    );
    assert(result.changed && result.same && result.restored && result.pure);
  }
);
test('named stochastic layers keep their seed when reordered and reject non-JSON preset edits', () => {
  const a = I.create({
      impulses: [
        { ...pulse, id: 'a', profile: 'shake' },
        { ...pulse, id: 'b', profile: 'shake' }
      ],
      handheld: [{ id: 'fine' }, { id: 'slow' }]
    }),
    b = I.create({
      impulses: [
        { ...pulse, id: 'b', profile: 'shake' },
        { ...pulse, id: 'a', profile: 'shake' }
      ],
      handheld: [{ id: 'slow' }, { id: 'fine' }]
    });
  assert.deepEqual(a.sample(0.25), b.sample(0.25));
  assert.throws(() => I.preset('recoil', { frequency: () => 5 }));
  const saved = a.snapshot();
  delete saved.impulses;
  assert.throws(() => a.restore(saved));
});
test('an explicit impulse clock can hold camera response while an authored rig keeps moving', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    seen = [],
    world = {
      cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 },
      cameraRig: {
        sample: t => {
          seen.push(t);
          return { camera: { target: [0, 0, 0], dist: 5, yaw: t, pitch: 0 } };
        }
      },
      cameraImpulses: I.create({ impulses: [pulse] })
    };
  const a = makeCamera(world, { cameraTime: 0.3, cameraImpulseTime: 0.25 }, 120, 80),
    b = makeCamera(world, { cameraTime: 0.8, cameraImpulseTime: 0.25 }, 120, 80);
  assert.deepEqual(seen, [0.3, 0.8]);
  near(a.cameraImpulse.time, 0.25);
  near(b.cameraImpulse.time, 0.25);
  assert.notDeepEqual(a.view, b.view);
});
test('diorama look validation and rendering preserve portable camera-motion settings', () => {
  const scene = {
      id: 'portable-camera-impulses',
      camera: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 },
      solids: [{ id: 'a', kind: 'box', at: [0, 0, 0], half: [0.2, 0.2, 0.2], mat: 'stone', res: 0.1 }],
      finish: { look: { cameraImpulses: { impulses: [pulse] } } }
    },
    world = K.diorama.build(scene);
  let frame;
  require('../cli/render.js').render(world, { w: 48, h: 32, raw: true, t: 0.25, cameraFrame: f => (frame = f) });
  nearVec(frame.motion.translation, [0.2, 0, 0]);
  scene.finish.look.cameraImpulses.impulses[0] = { duration: 0 };
  assert(K.diorama.check(scene).some(e => e.path === 'finish.look.cameraImpulses'));
});
