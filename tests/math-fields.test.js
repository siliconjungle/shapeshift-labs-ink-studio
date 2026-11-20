const test = require('node:test'),
  assert = require('node:assert/strict');
const ink = require('..'),
  M = require('../src/math-fields'),
  { KIT: K, makeBuilder } = ink.load(),
  F = K.procedural.fields;
const near = (a, b, e = 1e-7) => assert(Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const point = (a, b, e) => a.forEach((v, i) => near(v, b[i], e));
function numeric(fn, p, i) {
  const a = p.slice(),
    b = p.slice(),
    h = 1e-6;
  a[i] += h;
  b[i] -= h;
  return (fn(...a) - fn(...b)) / (2 * h);
}

test('complex charts compose analytic Jacobians and time derivatives on every plane', () => {
  const operations = [
    { type: 'affine', scale: [0.7, 1.2], rotate: 0.4, velocity: [0.1, -0.2], spin: 0.2 },
    { type: 'mobius', a: [1, 0.1], b: [0.2, -0.1], c: [0.15, 0.08], d: [1, 0] },
    { type: 'power', exponent: 1.4 },
    { type: 'reciprocal' },
    { type: 'exp' },
    { type: 'log' },
    { type: 'sin' },
    { type: 'conjugate' },
    { type: 'polar', logRadius: true },
    { type: 'cartesian', logRadius: true },
    { type: 'spiral', twist: 1.7 }
  ];
  for (const plane of ['xy', 'xz', 'yz'])
    for (const op of operations) {
      const map = M.mapping({
          plane,
          scale: [1.3, 0.8],
          outputScale: [0.9, 1.5],
          origin: [0.1, -0.15, 0.2],
          steps: [op]
        }),
        p = [0.73, 0.91, 0.58, 0.37],
        s = map.sample(...p);
      assert(s.valid, JSON.stringify(op));
      assert.deepEqual(map(...p), s.point);
      for (let out = 0; out < 3; out++)
        for (let axis = 0; axis < 4; axis++)
          near(
            axis < 3 ? s.jacobian[out * 3 + axis] : s.dt[out],
            numeric((...q) => map(...q)[out], p, axis),
            2e-5
          );
    }
  const chain = M.mapping({ steps: operations.slice(0, 4) }),
    p = [0.4, 0.7, 0.3, 0.5],
    s = chain.sample(...p);
  for (let out = 0; out < 3; out++)
    for (let axis = 0; axis < 4; axis++)
      near(
        axis < 3 ? s.jacobian[out * 3 + axis] : s.dt[out],
        numeric((...q) => chain(...q)[out], p, axis),
        2e-5
      );
});

test('polar and logarithmic charts round trip, preserve the unused axis and flag cuts', () => {
  for (const logRadius of [false, true]) {
    const chart = M.mapping({
      plane: 'xz',
      origin: [2, 3, 4],
      scale: [0.8, 1.2],
      steps: [
        { type: 'polar', logRadius },
        { type: 'cartesian', logRadius }
      ]
    });
    for (const p of [
      [2.4, 17, 4.8],
      [1.1, 4, 5.7],
      [-1, 9, 2]
    ])
      point(chart(...p), p, 1e-9);
  }
  assert(M.mapping({ steps: [{ type: 'log' }] }).sample(-1, 0, 0).seam);
  assert(!M.mapping({ steps: [{ type: 'power', exponent: 2 }] }).sample(-1, 0, 0).seam);
  const translated = M.mapping({ steps: [{ type: 'mobius', a: [1, 0], b: [1, 0], c: [0, 0], d: [1, 0] }] });
  point(translated(2, 3, 7), [3, 3, 7]);
});

test('poles, overflowing charts and derivative limits never produce NaN or infinity', () => {
  for (const type of ['reciprocal', 'log', 'polar']) {
    const map = M.mapping({ steps: [{ type }], singularity: 'identity' }),
      s = map.sample(0, 0, 3);
    assert(!s.valid);
    assert(s.singular);
    point(s.point, [0, 0, 3]);
    assert.equal(map.mask()(0, 0, 3), 0);
    point(map.deform({ amount: 4 })([0, 0, 3]), [0, 0, 3]);
    point(map.flow()(0, 0, 3), [0, 0, 0]);
  }
  const pole = M.mapping({ steps: [{ type: 'mobius', a: [1, 0], b: [0, 0], c: [1, 0], d: [1, 0] }] });
  assert(pole.sample(-1, 0, 0).singular);
  const overflow = M.mapping({ steps: [{ type: 'exp' }], limit: 20 }),
    s = overflow.sample(1000, 1, 2);
  assert(!s.valid && s.limited);
  assert(s.point.every(Number.isFinite));
  assert(s.jacobian.every(Number.isFinite));
  assert(Math.max(...s.point.map(Math.abs)) <= 20);
  const large = M.mapping({ outputScale: [1e4, 1e4], limit: 1e7 }).sample(1e7, 1e7, 0);
  assert(!large.valid);
  assert(large.point.every(n => Math.abs(n) <= 1e9));
});

test('deformation has an analytic capped Jacobian and keeps original splat covariance finite', () => {
  const map = M.mapping({ steps: [{ type: 'spiral', twist: 0.9 }] }),
    deform = map.deform({ amount: 0.8, maxDisplacement: 0.2 });
  deform.time = 0.7;
  for (const p of [
    [1, 0.6, 0.1],
    [0.08, 0.01, 0],
    [0, 0, 0]
  ]) {
    const q = deform(p),
      J = K.deform.jac(deform, p);
    assert(Math.hypot(...q.map((v, i) => v - p[i])) <= 0.2 + 1e-10);
    if (Math.hypot(...p) > 0.01)
      for (let out = 0; out < 3; out++)
        for (let axis = 0; axis < 3; axis++)
          near(
            J[out * 3 + axis],
            numeric((...v) => deform(v)[out], p, axis),
            2e-5
          );
  }
  const B = makeBuilder(9, [0x66cbbd]);
  B.disc(0.8, 0.3, 0, [0, 0, 1], 0.07, 0.01, B.P[0], 3);
  const world = B.finish(),
    rest = K.deform.rest(world, [0]);
  K.deform.apply(world, [0], rest, deform);
  assert(world.data.every(Number.isFinite));
  point(Array.from(world.data.subarray(0, 3)), deform([rest[0], rest[1], rest[2]]), 1e-6);
  assert.throws(
    () =>
      K.deform.jac(
        Object.assign(p => p, { jacobian: () => [NaN] }),
        [0, 0, 0]
      ),
    /Jacobian/
  );
});

test('mask patterns and coordinate expressions propagate spatial and time derivatives', () => {
  const mapping = {
    steps: [
      { type: 'affine', velocity: [0.13, 0.2], spin: 0.31 },
      { type: 'spiral', twist: 0.45 }
    ]
  };
  for (const pattern of ['bands', 'checker', 'rings', 'angular']) {
    const source = F.compile({
        type: 'mathMask',
        mapping,
        pattern,
        frequency: 0.83,
        phase: 0.06,
        rate: 0.1,
        feather: 0.8
      }),
      p = [0.42, 0.69, 0.17, 0.36],
      s = source.sample(...p);
    near(s.value, source(...p));
    for (let i = 0; i < 4; i++) near(i < 3 ? s.gradient[i] : s.dt, numeric(source, p, i), 3e-5);
    const inverse = M.mapping(mapping).mask({
      pattern,
      frequency: 0.83,
      phase: 0.06,
      rate: 0.1,
      feather: 0.8,
      invert: true
    });
    near(source(...p) + inverse(...p), 1);
  }
  const f = F.compile({
      type: 'coordinateMap',
      mapping,
      source: { type: 'loop', period: 3.2, radius: 0.4, scale: [1, 1, 0.7] }
    }),
    p = [0.7, 0.3, 0.4, 0.8],
    s = f.sample(...p);
  for (let i = 0; i < 4; i++) near(i < 3 ? s.gradient[i] : s.dt, numeric(f, p, i), 3e-5);
  const fallback = F.compile({
    type: 'coordinateMap',
    mapping: { steps: [{ type: 'log' }] },
    source: { type: 'axis', axis: 'x' },
    fallback: 0.3
  });
  near(fallback(0, 0, 0), 0.3);
});

test('chart flows plug into bounded streamlines and reusable field sources', () => {
  const field = M.mapping({ steps: [{ type: 'affine', rotate: 0.3 }] }).flow({ gain: 2, maxSpeed: 0.4 });
  assert(Math.hypot(...field(100, 0, 0)) <= 0.4 + 1e-9);
  const path = K.procedural.motion.streamline(field, [0.5, 0.2, 0], {
    maxLength: 1,
    maxSteps: 100,
    maxChecks: 4000,
    bounds: { min: [-2, -2, -2], max: [2, 2, 2] }
  });
  assert(path.points.length > 5);
  assert(path.points.flat().every(Number.isFinite));
  const source = K.fieldViews.source({ type: 'vec3', sample: field, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } });
  point(source.sample(0.5, 0.2, 0), field(0.5, 0.2, 0));
});

test('named dynamics share existing trace kernels and fixed-step live clocks', () => {
  for (const family of K.procedural.mathFields.families) {
    const sim = M.integrator({ family, maxSteps: 10000, maxEvaluations: 40000 }),
      dt = sim.state.dt,
      seconds = family === 'clifford' || family === 'deJong' ? 10 : dt * 10;
    const live = sim.advance(seconds),
      trace = K.procedural.attractors.trace({ family, steps: 10, burnIn: 0, dt });
    point(live.point, trace.points.at(-1), 1e-10);
    assert.equal(live.tick, 10);
    assert(live.point.every(Number.isFinite));
  }
  const first = M.integrator(),
    second = M.integrator();
  first.advance(0.03);
  first.advance(0.07);
  second.advance(0.1);
  point(first.state.point, second.state.point, 1e-12);
  assert.equal(first.state.tick, second.state.tick);
  const stored = first.state;
  stored.point[0] = 900;
  assert.notEqual(first.state.point[0], 900);
  first.reset();
  point(first.state.point, [1, 1, 1]);
});

test('integrators bound work, retain debt, and recover deterministically with advance(0)', () => {
  const small = M.integrator({ maxSteps: 2, maxEvaluations: 8 }),
    whole = M.integrator({ maxSteps: 100 });
  let state = small.advance(0.1);
  assert.equal(state.status, 'budget');
  assert.equal(state.evaluations, 8);
  assert.equal(state.steps, 2);
  assert(state.pending > 0.07);
  while (small.state.pending > 0.001) small.advance(0);
  whole.advance(0.1);
  point(small.state.point, whole.state.point, 1e-12);
  const before = small.state;
  assert.throws(() => small.advance(61), /elapsed/);
  assert.deepEqual(small.state, before);
  const limited = M.integrator({ maxSteps: 1, maxPending: 0.1 });
  limited.advance(0.1);
  const prior = limited.state;
  assert.throws(() => limited.advance(0.1), /pending/);
  assert.deepEqual(limited.state, prior);
});

test('boundary policies stop, wrap, clamp or reset without leaking invalid state', () => {
  const controls = {
    field: () => [2, 0, 0],
    start: [0.95, 0, 0],
    dt: 0.1,
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] }
  };
  for (const boundary of ['stop', 'wrap', 'clamp', 'reset']) {
    const sim = M.integrator({ ...controls, boundary }),
      s = sim.advance(0.1);
    assert(s.point.every(Number.isFinite));
    if (boundary === 'stop') {
      assert.equal(s.status, 'escaped');
      point(s.point, [0.95, 0, 0]);
      assert.equal(s.tick, 0);
      assert.deepEqual(sim.advance(10).point, s.point);
    }
    if (boundary === 'wrap') near(s.point[0], -0.85);
    if (boundary === 'clamp') near(s.point[0], 1);
    if (boundary === 'reset') {
      near(s.point[0], 0.95);
      assert.equal(s.resets, 1);
    }
  }
  for (const field of [() => [Infinity, 0, 0], () => [1e308, 0, 0], () => [NaN, 1, 0], () => [1, 2]]) {
    const sim = M.integrator({ field });
    const s = sim.advance(0.02);
    assert.equal(s.status, 'escaped');
    assert(s.point.every(Number.isFinite));
  }
  const nonautonomous = M.integrator({ field: (x, y, z, t) => [t, 0, 0], dt: 0.01 });
  near(nonautonomous.advance(1).point[0], 0.5, 1e-10);
});

test('attractor fields respect placement, speed caps and finite sample contracts', () => {
  for (const family of K.procedural.mathFields.families) {
    const field = M.attractorFlow({ family, origin: [1, 2, 3], scale: [0.2, 0.3, 0.4], maxSpeed: 0.7 });
    const out = new Float64Array(3);
    assert.equal(field(7, 5, 2, 0.4, out), out);
    assert(out.every(Number.isFinite));
    assert(Math.hypot(...out) <= 0.7 + 1e-10);
  }
});

test('math specifications validate before work and remain immutable', () => {
  const spec = { steps: [{ type: 'affine', offset: [0.3, 0.5] }] },
    map = M.mapping(spec);
  spec.steps[0].offset[0] = 99;
  point(map(0, 0, 0), [0.3, 0.5, 0]);
  assert(Object.isFrozen(map.spec.steps[0].offset));
  for (const value of [
    { steps: [{ type: 'constructor' }] },
    { steps: [{ type: 'mobius', a: [0, 0], b: [0, 0] }] },
    { plane: 'xx' },
    { epsilon: 0 },
    { scale: [0, 1] },
    { steps: [{ type: 'log', surprise: 1 }] },
    { steps: [{ type: 'exp' }], maxOperations: 1 },
    { steps: Array.from({ length: 33 }, () => ({ type: 'log' })) }
  ])
    assert.throws(() => M.mapping(value));
  assert.throws(
    () =>
      F.compile({ type: 'coordinateMap', mapping: { steps: [{ type: 'spiral' }] }, source: 1 }, { maxOperations: 2 }),
    /budget/
  );
  assert.throws(() => M.integrator({ family: 'constructor' }));
  assert.throws(() => M.integrator({ parameters: { unknown: 1 } }));
  assert.throws(() => M.integrator({ maxEvaluations: 1 }));
  assert.throws(() => M.integrator({ field: () => [0, 0, 0], family: 'lorenz' }));
  assert.throws(() => M.integrator({ family: 'clifford', dt: 0.1 }));
  assert.throws(() => map(NaN, 0, 0));
  assert.throws(() => map.mask({ frequency: 0 }));
});

test('CLI inspects serializable chart and integration budgets without external libraries', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    { execFileSync } = require('node:child_process'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-math-'));
  try {
    const file = path.join(dir, 'field.json'),
      cli = path.join(__dirname, '../cli/ink-studio.js');
    fs.writeFileSync(file, JSON.stringify({ steps: [{ type: 'polar', logRadius: true }] }));
    const report = JSON.parse(
      execFileSync(process.execPath, [cli, 'math-fields', file, '--point', '1,1,3'], { encoding: 'utf8' })
    );
    point(report.sample.point, [Math.log(Math.sqrt(2)), Math.PI / 4, 3]);
    assert(report.sample.valid);
    assert(report.cost > 1);
    fs.writeFileSync(file, JSON.stringify({ family: 'lorenz', maxSteps: 2 }));
    const sim = JSON.parse(
      execFileSync(process.execPath, [cli, 'math-fields', file, '--integrate', '.1'], { encoding: 'utf8' })
    );
    assert.equal(sim.state.status, 'budget');
    assert.equal(sim.state.tick, 2);
    assert.equal(sim.budget.maxSteps, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Mobius charts are invariant to common coefficient scaling and reusable outputs are checked', () => {
  const base = { type: 'mobius', a: [1, 0.2], b: [0.1, 0], c: [0.2, 0.1], d: [1, -0.1] },
    map = M.mapping({ steps: [base] });
  for (const scale of [1e-8, 1e8]) {
    const step = { type: 'mobius' };
    for (const k of ['a', 'b', 'c', 'd']) step[k] = base[k].map(v => v * scale);
    point(M.mapping({ steps: [step] })(0.7, 0.3, 1), map(0.7, 0.3, 1), 1e-10);
  }
  const storage = { point: new Float64Array(3), jacobian: new Float64Array(9), dt: new Float64Array(3) };
  assert.equal(map.sampleInto(storage, 0.7, 0.3, 1), storage);
  point(storage.point, map(0.7, 0.3, 1));
  assert.throws(() => map.sampleInto({ point: [] }, 0, 0, 0), /storage/);
  const discrete = M.integrator({ family: 'clifford', start: [0.1, 0.2] });
  discrete.advance(1);
  point(discrete.reset([0.2, 0.3]).point, [0.2, 0.3, 0]);
});

function nativeMathFixture({ KIT: K, makeBuilder }) {
  const B = makeBuilder(3, [0x0c1020, 0xe1d3ee, 0xfff3cf]);
  for (let j = -3; j <= 3; j++)
    for (let i = -3; i <= 3; i++) B.disc(i * 0.16, j * 0.16, 0, [0, 0, 1], 0.08, 0.01, B.P[(i + j) % 2 ? 1 : 2], 3);
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 3, yaw: 0, pitch: 0 }, radius: 2 }),
    ids = Array.from({ length: world.count }, (_, i) => i);
  const map = K.procedural.mathFields
    .mapping({
      scale: [0.65, 0.65],
      steps: [
        { type: 'mobius', c: [0.15, 0.08] },
        { type: 'spiral', twist: 0.4 },
        { type: 'affine', rotate: 0.15 }
      ]
    })
    .deform({ amount: 0.65, maxDisplacement: 0.2 });
  const skin = K.deform.skin(world, ids, { grid: [4, 4, 1] }),
    matrices = new Float32Array(skin.n * 12);
  const anim = K.bones.bind(world, {
    ids,
    bid: skin.bid,
    M: matrices,
    pose(t) {
      map.time = t;
      skin.fill(matrices, 0, map);
    }
  });
  anim.update(0, 0.4);
  return { world };
}

test('math fields match CPU-posed geometry and GPU-carried splats', { skip: !process.env.INK_TEST_CHROME }, () => {
  const run = require('../cli/look-webgl');
  const result = run({ hardware: true }, nativeMathFixture, (kit, build, backend) => {
    const { world } = build(kit),
      draw = backend(64, 48, { raw: true, offscreen: true });
    const read = () => Array.from(atob(draw.image()), c => c.charCodeAt(0));
    try {
      draw.draw(world, { time: 0.4 });
      const live = read();
      const data = kit.KIT.bones.posed(world);
      draw.draw({ ...world, data, anim: undefined }, { time: 0.4 });
      return { live, baked: read() };
    } finally {
      draw.close();
    }
  });
  let sum = 0,
    changed = 0;
  for (let i = 0; i < result.live.length; i++) {
    sum += Math.abs(result.live[i] - result.baked[i]);
    if (result.live[i] > 70) changed++;
  }
  assert(changed > 150);
  assert(sum / result.live.length < 2.5, 'mean posed/GPU error ' + sum / result.live.length);
});
