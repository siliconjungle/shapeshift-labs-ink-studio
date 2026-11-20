const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const { curve: C, V } = K;
const tau = 2 * Math.PI;
const xy = { axis: [0, 0, 1] };
const near = (actual, expected, tolerance = 1e-9) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const vector = (actual, expected) => near(V.dist(actual, expected), 0);

test('Archimedean and Fermat spirals obey their radial laws and allow either end at the origin', () => {
  const startRadius = .5, endRadius = 3, phase = .42, turns = -2.25;
  for (const type of ['archimedeanSpiral', 'fermatSpiral']) {
    const path = C.create({ ...xy, type, startRadius, endRadius, phase, turns, height: 2 });
    assert.equal(path.closed, false);
    for (const t of [0, .13, .5, .86, 1]) {
      const p = path.evaluate(t), a = phase + tau * turns * t, r = Math.hypot(p[0], p[1]);
      if (type === 'archimedeanSpiral') near(r, startRadius * (1 - t) + endRadius * t);
      else near(r ** 2, startRadius ** 2 * (1 - t) + endRadius ** 2 * t);
      vector(p, [r * Math.cos(a), r * Math.sin(a), 2 * t]);
    }
    const inward = C.create({ type, startRadius: 2, endRadius: 0 });
    vector(inward.evaluate(1), [0, 0, 0]);
    vector(C.create({ type }).evaluate(0), [0, 0, 0]);
  }
});

test('cycloid retains off-grid cusps in uniform and adaptive paths', () => {
  const opts = { ...xy, type: 'cycloid', radius: .6, turns: 2.25, phase: .3, segments: 32 };
  for (const settings of [opts, { ...opts, adaptive: { tolerance: .003, maxSegments: 512 } }]) {
    const path = C.create(settings);
    for (const k of [1, 2]) {
      const t = (k - opts.phase / tau) / opts.turns;
      const index = path.parameters.indexOf(t);
      assert(index > 0);
      vector(path.points[index], [(k * tau - opts.phase) * opts.radius, 0, 0]);
    }
    if (!settings.adaptive) assert.equal(path.points.length, opts.segments + 1);
  }
  const line = C.create({ ...xy, type: 'cycloid', radius: 2, penRadius: 0, turns: -2 });
  vector(line.evaluate(.25), [-tau, 2, 0]);
  near(line.length, 4 * tau);
  const prolate = C.create({ ...xy, type: 'cycloid', radius: 1, penRadius: 1.5, turns: 1 });
  assert(prolate.evaluate(.05)[0] < 0);
  assert.deepEqual(prolate.breaks, [0, 1]);
});

test('circular rolling paths use the fundamental gear ratio and exact closed seams', () => {
  const hypo = { ...xy, type: 'hypotrochoid', fixedTeeth: 3, rollingTeeth: 1, fixedRadius: 3, pen: 1 };
  const deltoid = C.create(hypo);
  assert.deepEqual(deltoid.breaks, [0, 1 / 3, 2 / 3, 1]);
  for (const t of [0, .14, .46, .82, 1]) {
    const a = tau * t;
    vector(deltoid.evaluate(t), [2 * Math.cos(a) + Math.cos(2 * a), 2 * Math.sin(a) - Math.sin(2 * a), 0]);
  }
  assert.deepEqual(deltoid.points, C.create({ ...hypo, fixedTeeth: 12, rollingTeeth: 4 }).points);
  const cardioid = C.create({ ...xy, type: 'epitrochoid', fixedRadius: 1, fixedTeeth: 1, rollingTeeth: 1, pen: 1 });
  vector(cardioid.evaluate(.25), [1, 2, 0]);
  vector(cardioid.evaluate(.5), [-3, 0, 0]);
  const guide = C.create({ ...hypo, fixedTeeth: 13, rollingTeeth: 5, pen: 0 });
  vector(guide.evaluate(.25), [0, 3 * 8 / 13, 0]);
  for (const path of [deltoid, cardioid, guide]) {
    assert.deepEqual(path.points[0], path.points.at(-1));
    assert.deepEqual(path.frame(0), path.frame(path.length));
  }
});

test('pen phase shifts rolling cusps without changing closure or frame validity', () => {
  for (const type of ['epitrochoid', 'hypotrochoid']) {
    const def = { type, ...xy, fixedTeeth: 5, rollingTeeth: 2, pen: 1, penPhase: .42, phase: -.26,
      adaptive: { tolerance: .003, maxSegments: 800 } };
    const path = C.create(def);
    assert.equal(path.breaks.length, 7);
    for (const t of path.breaks.slice(1, -1)) {
      assert(path.parameters.includes(t));
      const velocity = V.sub(path.evaluate(t + 1e-6), path.evaluate(t - 1e-6));
      assert(V.len(velocity) < 1e-10);
    }
    for (const t of [0, .13, .45, .8, 1]) near(V.len(path.frame(t * path.length).T), 1);
    assert.deepEqual(C.create(path.snapshot()).points, path.points);
  }
});

test('new family limits reject invalid wheels, phases, and sample budgets', () => {
  assert.throws(() => C.create({ type: 'archimedeanSpiral', turns: 0 }), /spiral dimensions/);
  assert.throws(() => C.create({ type: 'fermatSpiral', startRadius: -1 }), /spiral dimensions/);
  assert.throws(() => C.create({ type: 'cycloid', penRadius: -1 }), /pen radius/);
  assert.throws(() => C.create({ type: 'epitrochoid', fixedTeeth: 5.5 }), /gears/);
  assert.throws(() => C.create({ type: 'hypotrochoid', fixedTeeth: 2, rollingTeeth: 2 }), /fit/);
  assert.throws(() => C.create({ type: 'epitrochoid', fixedTeeth: 32, rollingTeeth: 31, segments: 24 }), /segments/);
});
