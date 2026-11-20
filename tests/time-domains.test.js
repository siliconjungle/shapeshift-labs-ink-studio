const test = require('node:test'),
  assert = require('node:assert/strict'),
  core = require('..'),
  { KIT: K } = core.load(),
  T = K.timeDomains;
const near = (a, b, e = 1e-8) => assert(Math.abs(a - b) <= e, `${a} != ${b}`);
function stage() {
  const B = core.load().makeBuilder(1, [0, 0xffffff]);
  B.iso(0, 0, 0, 0.1, B.P[1], 3);
  return K.stage(B.finish());
}
test('independent clocks freeze a character without freezing camera, interface or simulation', () => {
  const c = T.create({ domains: { hero: { parent: 'animation', fps: 12 } } });
  for (let i = 0; i < 30; i++) c.advance(1 / 60);
  const before = c.read('hero');
  c.pause('hero');
  for (let i = 0; i < 60; i++) c.advance(1 / 60);
  near(c.read('hero').time, before.time);
  near(c.read('camera').time, 1.5);
  near(c.read('interface').time, 1.5);
  near(c.read('simulation').time, 1.5);
  c.pause('hero', false);
  c.advance(1 / 60);
  near(c.read('hero').time, before.time + 1 / 60);
});
test('pose sampling is held at 12 fps while the source clock remains continuous', () => {
  const c = T.create({ domains: { hero: { parent: 'animation', fps: 12 } } }),
    values = [];
  for (let i = 0; i < 60; i++) {
    c.advance(1 / 60);
    values.push(c.read('hero').sampleTime);
  }
  assert.equal(new Set(values).size, 13);
  near(c.read('hero').sampleTime, 1);
  near(values[3], 0);
  near(values[4], 1 / 12);
  c.fps('hero', 24);
  const before = c.read('hero').sampleTime;
  c.advance(1 / 60);
  assert(c.read('hero').sampleTime >= before);
});
test('nested rates and pause inheritance retain independent sampling cadence', () => {
  const c = T.create({
    domains: {
      animation: { rate: 0.5 },
      hero: { parent: 'animation', rate: 2, fps: 12 },
      hand: { parent: 'hero', rate: 0.5 }
    }
  });
  c.advance(0.5);
  near(c.read('animation').time, 0.25);
  near(c.read('hero').time, 0.5);
  near(c.read('hand').time, 0.25);
  c.pause('animation');
  c.advance(0.5);
  near(c.read('hand').time, 0.25);
  near(c.read('camera').time, 1);
});
test('fixed ticks retain backlog, pause it, drain it without skipping ticks and can explicitly drop elapsed time', () => {
  const c = T.create({ domains: { simulation: { step: 0.1, maxSteps: 2 } } });
  c.advance(1);
  assert.equal(c.read('simulation').steps.length, 2);
  near(c.read('simulation').time, 0.2);
  near(c.read('simulation').backlogSeconds, 0.8);
  c.pause('simulation');
  c.advance(0.5);
  assert.equal(c.read('simulation').steps.length, 0);
  near(c.read('simulation').time, 0.2);
  c.pause('simulation', false);
  for (let i = 0; i < 4; i++) c.advance(0);
  near(c.read('simulation').time, 1);
  assert.equal(c.read('simulation').tick, 10);
  const d = T.create({ domains: { simulation: { step: 0.1, maxSteps: 2, backlog: 'drop' } } });
  d.advance(1);
  near(d.read('simulation').time, 0.2);
  near(d.read('simulation').droppedSeconds, 0.8);
  d.advance(0.1);
  assert.equal(d.read('simulation').steps[0].tick, 3);
});
test('freeze and slow presentation cues integrate exactly across long frames and overlaps', () => {
  const cues = [
      K.anim.cue('freeze', 'freeze', 0.2, { duration: 0.3, domain: 'hero' }),
      K.anim.cue('slow', 'slow', 0.4, { duration: 0.4, amount: 0.5, domain: 'hero' })
    ],
    def = { domains: { hero: { parent: 'animation' } }, cues },
    a = T.create(def),
    b = T.create(def);
  a.advance(1);
  for (let i = 0; i < 100; i++) b.advance(0.01);
  near(a.read('hero').time, 0.55);
  near(a.read('hero').time, b.read('hero').time);
  near(a.read('camera').time, 1);
  const hold = a.hold('hero', 0.5),
    before = a.read('hero').time;
  a.advance(0.25);
  near(a.read('hero').time, before);
  a.cancel(hold);
  a.advance(0.25);
  near(a.read('hero').time, before + 0.25);
});
test('long-running rational cadence does not lose fixed ticks to frame accumulation', () => {
  const c = T.create({ domains: { hero: { parent: 'animation', fps: 12 } } });
  for (let i = 0; i < 10000; i++) c.advance(1 / 60);
  assert.equal(c.read('simulation').tick, 10000);
  near(c.wall, 10000 / 60, 1e-12);
  near(c.read('animation').time, 10000 / 60, 1e-12);
});
test('checkpoints restore accumulated debt, cues and sampled phase deterministically', () => {
  const a = T.create({ domains: { hero: { parent: 'animation', fps: 12 }, simulation: { step: 0.05, maxSteps: 2 } } });
  a.hold('hero', 0.3);
  a.advance(0.17);
  const saved = JSON.parse(JSON.stringify(a.snapshot())),
    b = T.restore(saved);
  for (const dt of [0.04, 0.2, 0.016, 0]) {
    a.advance(dt);
    b.advance(dt);
    for (const id of a.ids()) {
      near(a.read(id).time, b.read(id).time);
      near(a.read(id).sampleTime, b.read(id).sampleTime);
    }
  }
  b.reset();
  assert(b.has('hero'));
  near(b.wall, 0);
  const invalid = JSON.parse(JSON.stringify(saved));
  invalid.domains.hero.settings.parent = 'hero';
  const before = a.snapshot();
  assert.throws(() => a.restore(invalid));
  assert.deepEqual(a.snapshot(), before);
});
test('stage routes selected objects at their cadence, with exact fixed deltas and legacy frame hooks', () => {
  const s = stage(),
    c = T.create({ domains: { hero: { parent: 'animation', fps: 12 }, simulation: { step: 1 / 60, maxSteps: 8 } } });
  s.useTimeDomains(c);
  const hero = [],
    camera = [],
    sim = [],
    hooks = [];
  s.add({ update: (dt, t) => hero.push([dt, t]), post: (dt, t) => hooks.push(t) }, { domain: 'hero' });
  s.add({ update: (dt, t) => camera.push(t) }, { domain: 'camera' });
  s.add({ update: (dt, t) => sim.push([dt, t]) }, { domain: 'simulation' });
  s.update(0, 0);
  for (let i = 1; i <= 60; i++) s.update(1 / 60, i / 60);
  assert.equal(hero.length, 13);
  assert.equal(camera.length, 61);
  assert.equal(sim.length, 61);
  near(hero[1][0], 1 / 12);
  near(sim[1][0], 1 / 60);
  assert.equal(hooks.length, 61);
  c.pause('hero');
  for (let i = 0; i < 10; i++) s.update(1 / 60, 2);
  assert.equal(hero.length, 13);
  assert.equal(camera.length, 71);
});
test('externally advanced stage clocks cannot consume a fixed tick twice', () => {
  const s = stage(),
    c = T.create(),
    calls = [];
  s.useTimeDomains(c, { advance: false });
  s.add({ update: (dt, t) => calls.push([dt, t]) }, { domain: 'simulation' });
  c.advance(1 / 60);
  s.update(0, 0);
  s.update(0, 0);
  assert.equal(calls.length, 1);
  near(calls[0][0], 1 / 60);
});
test('simulation adapter reuses native ticks and resumes existing checkpoints', async () => {
  const run = K.world.runtime.create({
      id: 'clock-test',
      dt: 0.05,
      systems: { n: { kind: 'control', config: { op: 'timer', ticks: 4 } } }
    }),
    c = T.create(),
    driver = T.simulation(c, run);
  c.advance(0.2);
  driver.update();
  assert.equal(run.view().tick, 4);
  c.pause('simulation');
  c.advance(0.3);
  driver.update();
  assert.equal(run.view().tick, 4);
  c.pause('simulation', false);
  c.advance(0.05);
  await driver.updateAsync();
  assert.equal(run.view().tick, 5);
  const d = T.create(),
    restored = K.world.runtime.create(run.checkpoint().world, { checkpoint: run.checkpoint() }),
    other = T.simulation(d, restored);
  near(d.read('simulation').time, 0.25);
  d.advance(0.05);
  other.update();
  assert.equal(restored.view().tick, 6);
});
test('renderer frame times are independent and explicit overrides do not alias other domains', () => {
  const c = T.create();
  c.pause('animation');
  c.advance(0.5);
  const frame = T.frame({ timeDomains: c }, { time: 0.1 });
  near(frame.time, 0.1);
  near(frame.cameraTime, 0.5);
  near(frame.interfaceTime, 0.5);
  near(frame.simulationTime, 8 / 60);
  assert.equal(frame.stepAnimation, false);
  assert.equal(T.frame({}, {}).time, undefined);
});
test('invalid clocks and edits reject cycles, time reversal and unsafe cadence budgets', () => {
  for (const domains of [
    { hero: { parent: 'missing' } },
    { hero: { parent: 'hero' } },
    { hero: { rate: -1 } },
    { hero: { fps: 12, step: 0.1 } },
    { simulation: { step: 0 } },
    { hero: { fps: 1000 } }
  ])
    assert.throws(() => T.create({ domains }));
  const c = T.create();
  assert.throws(() => c.advance(-1));
  assert.throws(() => c.advance(NaN));
  assert.throws(() => c.configure('animation', { parent: 'animation' }));
  c.advance(0.1);
  assert.throws(() => c.configure('simulation', { step: 0.1 }), /before/);
  assert.throws(() => c.hold('animation', -1));
  assert.throws(() => c.add('camera'));
});
test('installed native systems can be routed without being added twice', () => {
  const s = stage(),
    c = T.create({ domains: { hero: { parent: 'animation', fps: 12 } } }),
    calls = [],
    system = s.add({ update: (dt, t) => calls.push(t) });
  s.useTimeDomains(c);
  assert.equal(s.t0, 0);
  s.setTimeDomain(system, 'hero');
  for (let i = 0; i < 60; i++) s.update(1 / 60, i / 60);
  assert.equal(s.systems.length, 1);
  assert.equal(calls.length, 13);
  s.setTimeDomain(system, null);
  s.update(1 / 60, 1);
  assert.equal(calls.length, 14);
  assert.throws(() => s.setTimeDomain({}, 'hero'));
  assert.throws(() => s.setTimeDomain(system, 'missing'));
});
test('native scene timeline samples camera separately from held poses', () => {
  const track = (target, end) => ({
      target,
      keys: [
        { time: 0, value: 0, ease: 'linear' },
        { time: 2, value: end }
      ]
    }),
    world = K.diorama.build({
      id: 'split-camera',
      camera: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5 },
      solids: [
        { id: 'body', kind: 'box', at: [0, 0, 0], half: [0.3, 0.3, 0.3], part: 'body', mat: 'stone', res: 0.15 }
      ],
      parts: { body: { joint: [0, 0, 0] } },
      timeline: {
        duration: 2,
        tracks: [
          track('/camera/yaw', 1),
          {
            target: '/poses/body/translation',
            keys: [
              { time: 0, value: [0, 0, 0], ease: 'linear' },
              { time: 2, value: [2, 0, 0] }
            ]
          }
        ]
      }
    }),
    c = T.create({ domains: { animation: { paused: true } } });
  world.anim.useTimeDomains(c);
  world.anim.update(1, 123);
  near(world.cam.yaw, 0.5);
  assert.deepEqual(world.lab.rig.at('body', [0, 0, 0]), [0, 0, 0]);
  c.pause('animation', false);
  world.anim.update(0.5, 124);
  near(world.cam.yaw, 0.75);
  near(world.lab.rig.at('body', [0, 0, 0])[0], 0.5);
});
test('CPU and WebGL view sample a live camera clock without mutating it', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs'),
    B = core.load().makeBuilder(1, [0, 0xffffff]);
  B.iso(0, 0, 0, 0.1, B.P[1], 3);
  const w = B.finish(),
    c = T.create({ domains: { animation: { paused: true } } }),
    seen = [];
  w.cam = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5 };
  w.timeDomains = c;
  w.cameraRig = {
    sample: t => {
      seen.push(t);
      return { camera: { ...w.cam, yaw: t } };
    }
  };
  c.advance(0.5);
  const saved = c.snapshot();
  makeCamera(w, { time: 0 }, 96, 64);
  require('../cli/render.js').render(w, { w: 96, h: 64, raw: true });
  assert(seen.every(t => t === 0.5));
  assert(seen.length >= 2);
  assert.deepEqual(c.snapshot(), saved);
  seen.length = 0;
  makeCamera(w, { cameraTime: 0.25 }, 96, 64);
  require('../cli/render.js').render(w, { w: 96, h: 64, raw: true, cameraTime: 0.25 });
  assert(seen.every(t => t === 0.25));
});
test('generated hit-stop IDs avoid authored IDs and failed holds leave serial untouched', () => {
  const c = T.create({ cues: [{ id: 'hold.1', type: 'freeze', time: 0, duration: 1 }] });
  assert.equal(c.hold('camera', 0.5), 'hold.2');
  const before = c.snapshot();
  assert.throws(() => c.hold('camera', -1));
  assert.deepEqual(c.snapshot(), before);
});
test(
  'native WebGL renders independent camera and interface time during animation pause',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl.js')(
      {},
      () => null,
      (kit, fixture, backend) => {
        const K = kit.KIT,
          B = kit.makeBuilder(1, [0x080e24, 0xffd79a]);
        B.iso(0.3, 0, 0, 0.2, B.P[1], 3);
        const world = B.finish(),
          c = K.timeDomains.create({ domains: { animation: { paused: true } } }),
          seen = [];
        world.cam = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 3 };
        world.timeDomains = c;
        world.cameraRig = {
          sample: t => {
            seen.push(t);
            return { camera: { ...world.cam, yaw: t } };
          }
        };
        const draw = backend(96, 64, { raw: true });
        try {
          draw.draw(world, {});
          const a = draw.image();
          c.advance(0.5);
          draw.draw(world, {});
          return {
            changed: draw.image() !== a,
            seen,
            animation: c.read('animation').sampleTime,
            camera: c.read('camera').sampleTime,
            interface: c.read('interface').sampleTime,
            wall: c.wall
          };
        } finally {
          draw.close();
        }
      }
    );
    assert(result.changed);
    assert(result.seen.includes(0) && result.seen.includes(0.5));
    assert.equal(result.animation, 0);
    assert.equal(result.camera, 0.5);
    assert.equal(result.interface, 0.5);
    assert.equal(result.wall, 0.5);
  }
);
test('separate cloth updates honor selected clocks and do not replay a shared frame', () => {
  const s = stage(),
    c = T.create({ domains: { cloth: { parent: 'animation', fps: 12 } } }),
    calls = [],
    cloth = s.add({ independentCloth: true, update: (dt, t) => calls.push([dt, t]) }, { domain: 'cloth' });
  s.useTimeDomains(c);
  for (let i = 0; i <= 60; i++) {
    s.update(i ? 1 / 60 : 0, i / 60, { separateCloth: true });
    s.advanceCloth(1 / 60, i / 60);
    s.advanceCloth(1 / 60, i / 60);
  }
  assert.equal(calls.length, 13);
  near(calls[1][0], 1 / 12);
  c.pause('animation');
  s.update(0.1, 2, { separateCloth: true });
  s.advanceCloth(0.1, 2);
  assert.equal(calls.length, 13);
  const fresh = T.create({ domains: { cloth: { parent: 'animation', fps: 12 } } });
  s.useTimeDomains(fresh);
  s.update(0, 0, { separateCloth: true });
  s.advanceCloth(0, 0);
  assert.equal(calls.length, 14);
  assert.equal(s.clockFor(cloth).id, 'cloth');
});
test('reserved clock names reject JSON prototype keys', () => {
  assert.throws(() => T.create(JSON.parse('{"domains":{"__proto__":{"rate":2}}}')));
  assert.throws(() => T.create({ domains: { constructor: {} } }));
});
test('inspection and annotation anchors retain scene pose while interface effects advance', () => {
  const B = core.load().makeBuilder(1, [0, 0xffffff]);
  B.iso(1, 0, 0, 0.1, B.P[1], 3, { k: 5, sp: 1 });
  const world = B.finish(),
    c = T.create({ domains: { animation: { paused: true } } });
  world.timeDomains = c;
  c.advance(0.5);
  assert.deepEqual(K.inspection.anchor({ splat: 0 }, { world, time: 0.5 }).at, [1, 0, 0]);
  assert.deepEqual(K.annotations.anchor({ splat: 0 }, { world, time: 0.5 }), [1, 0, 0]);
  const at = K.inspection.anchor({ splat: 0 }, { world, time: 0.5, sceneTime: 0.25 }).at;
  near(at[0], Math.cos(0.25));
  near(at[2], -Math.sin(0.25));
  const settings = K.inspection.prepare({
      targets: [{ id: 'courier', at: { splat: 0 }, label: 'HELD', occlusion: 'none' }]
    }),
    plan = K.inspection.plan(settings, {
      world,
      time: 0.5,
      width: 200,
      height: 100,
      project: p => [0.5 + p[0] / 10, 0.5 - p[1] / 10, 0.5, 5]
    });
  assert.equal(plan.time, 0.5);
  assert.equal(plan.targets.length, 1);
  near(plan.targets[0].anchor[0], 120);
});
