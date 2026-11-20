const test = require('node:test'),
  assert = require('node:assert/strict');
const ink = require('..'),
  R = require('../src/randomness'),
  { KIT: K } = ink.load();
const near = (a, b, t = 1e-9) => assert(Math.abs(a - b) < t, `${a} != ${b}`);
const normal = R.distribution({ type: 'normal' });
function stats(v) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean, variance: v.reduce((n, x) => n + (x - mean) ** 2, 0) / v.length };
}
function correlation(a, b) {
  const A = stats(a),
    B = stats(b);
  return (
    a.reduce((sum, x, i) => sum + (x - A.mean) * (b[i] - B.mean), 0) / a.length / Math.sqrt(A.variance * B.variance)
  );
}

test('named streams isolate systems, call order and keyed property edits', () => {
  const a = R.create('garden'),
    b = R.create('garden'),
    plants = a.stream('plants'),
    lamps = a.stream('lamps');
  const lamp = lamps.batch(12);
  plants.batch(900);
  assert.deepEqual(lamp, b.stream('lamps').batch(12));
  const ids = ['leaf-A', 'leaf-B', 'leaf-C'];
  const values = ids.map(id => plants.sample([id, 'height'], normal));
  for (const id of ids) plants.sample([id, 'unused-decoration']);
  plants.next();
  assert.deepEqual(
    values,
    ids.map(id => b.stream('plants').sample([id, 'height'], normal))
  );
  assert.equal(a.stream('plants'), plants);
  const cursor = plants.cursor;
  plants.fork('color').next();
  assert.equal(plants.cursor, cursor);
  assert.notEqual(plants.sample(1), plants.sample('1'));
  assert.notEqual(a.stream('a/b').next(), a.stream('a', 'b').next());
});

test('indexed sampling reproduces each draw slot regardless of distribution consumption', () => {
  const s = R.create(0).stream('draws'),
    specs = [undefined, { type: 'integer', min: 0, max: 2147483646 }, normal, { type: 'choice', values: ['a', 'b'] }];
  for (let i = 0; i < specs.length; i++) assert.deepEqual(s.next(specs[i]), s.at(i, specs[i]));
  const fresh = R.create(0).stream('draws');
  fresh.next({ type: 'normal' });
  assert.equal(fresh.next(), s.at(1));
  s.seek(0);
  assert.equal(s.next(), s.at(0));
  s.skip(2);
  assert.equal(s.cursor, 3);
  assert.equal(s.next(), s.at(3));
  const keys = Array.from({ length: 50 }, (_, i) => i);
  const first = s.order(keys.slice(0, 20)),
    larger = s.order(keys);
  assert.deepEqual(
    larger.filter(i => i < 20),
    first
  );
  assert.equal(s.cursor, 4);
});

test('checkpoints replay existing handles, clear later cursors and validate atomically', () => {
  const r = R.create(10),
    a = r.stream('a'),
    b = r.stream('b');
  a.batch(3, normal);
  b.next();
  const state = JSON.parse(JSON.stringify(r.snapshot())),
    future = a.batch(8, normal),
    later = r.stream('later');
  later.batch(9);
  r.restore(state);
  assert.deepEqual(r.snapshot(), state);
  assert.deepEqual(a.batch(8, normal), future);
  assert.equal(later.cursor, 0);
  later.next();
  assert(r.snapshot().streams.some(s => s.path[0] === 'later'));
  const restored = R.from(state);
  assert.deepEqual(restored.stream('a').batch(8, normal), future);
  const before = r.snapshot();
  for (const bad of [
    { ...state, seed: 11 },
    { ...state, algorithm: 'future' },
    { ...state, streams: [{ path: ['a'], cursor: -1 }] },
    { ...state, streams: [...state.streams, state.streams[0]] },
    { ...state, limits: {} }
  ]) {
    assert.throws(() => r.restore(bad));
    assert.deepEqual(r.snapshot(), before);
  }
  assert.throws(() => r.restore({ ...state, limits: { ...state.limits, maxWords: 0 } }));
  assert.deepEqual(r.snapshot(), before);
});

test('global legacy dice are untouched and typed seeds and hierarchical paths remain separate', () => {
  K.seed(123);
  const expected = Array.from({ length: 12 }, () => K.rnd());
  K.seed(123);
  R.create(123).stream('noise').batch(100);
  K.random.spatial(K.random.create(123).stream('terrain'))(0.2, 0.3, 0.4);
  assert.deepEqual(
    Array.from({ length: 12 }, () => K.rnd()),
    expected
  );
  const seeds = [0, 1, '0', '1', -1],
    values = seeds.map(seed => R.create(seed).stream('stream').next());
  assert.equal(new Set(values).size, seeds.length);
  assert(!R.isStream({}));
  assert(R.isStream(R.create().stream('a')));
});

test('numeric distributions have expected ranges and moments', () => {
  const root = R.create(77),
    n = 18000;
  const cases = [
    ['uniform', { type: 'uniform' }, 0.5, 1 / 12, 0.012, 0.006],
    ['normal', { type: 'normal' }, 0, 1, 0.025, 0.05],
    ['triangular', { type: 'triangular', min: 0, max: 1, mode: 0.5 }, 0.5, 1 / 24, 0.012, 0.006],
    ['power', { type: 'power', exponent: 2 }, 1 / 3, 4 / 45, 0.012, 0.006],
    ['exponential', { type: 'exponential', mean: 1 }, 1, 1, 0.03, 0.09]
  ];
  for (const [name, spec, mean, variance, mt, vt] of cases) {
    const values = root.stream(name).batch(n, R.distribution(spec)),
      measured = stats(values);
    assert(values.every(Number.isFinite));
    near(measured.mean, mean, mt);
    near(measured.variance, variance, vt);
  }
  const ints = root.stream('integer').batch(12000, R.distribution({ type: 'integer', min: -3, max: 3 }));
  assert(ints.every(n => Number.isInteger(n) && n >= -3 && n <= 3));
  const bins = Array(7).fill(0);
  for (const v of ints) bins[v + 3]++;
  assert(bins.every(n => n > 1500 && n < 1900));
});

test('truncation, clamping, log-normal tails and conditional exponentials stay finite', () => {
  const stream = R.create(31).stream('bounds');
  for (const spec of [
    { type: 'normal', mean: 0, deviation: 1, min: 1, max: 2 },
    { type: 'normal', min: -0.1, max: 0.1, bounds: 'clamp' },
    { type: 'logNormal', logMean: 0, logDeviation: 1, min: 0.2, max: 3 },
    { type: 'exponential', mean: 1, min: 100, max: 102 }
  ]) {
    const values = stream.batch(2000, R.distribution(spec));
    assert(values.every(v => Number.isFinite(v) && v >= spec.min && v <= spec.max));
  }
  assert.equal(stream.next({ type: 'uniform', min: 2, max: 2 }), 2);
  assert.equal(stream.next({ type: 'integer', min: 3, max: 3 }), 3);
  assert.equal(stream.next({ type: 'bernoulli', probability: 0 }), false);
  assert.equal(stream.next({ type: 'bernoulli', probability: 1 }), true);
  const values = stream.batch(15000, R.distribution({ type: 'logNormal', logMean: 0.3, logDeviation: 0.4 }));
  near(stats(values).mean, Math.exp(0.3 + (0.4 * 0.4) / 2), 0.03);
});

test('weighted choice skips zero weights and returns independent copies of JSON values', () => {
  const r = R.create(41).stream('choice'),
    choice = R.distribution({ type: 'choice', values: ['never', 'a', 'b'], weights: [0, 1, 3] }),
    v = r.batch(12000, choice);
  assert(!v.includes('never'));
  near(v.filter(x => x === 'a').length / v.length, 0.25, 0.018);
  const source = { x: [2, 3] },
    prepared = R.distribution({ type: 'choice', values: [source] });
  source.x[0] = 99;
  const a = r.next(prepared);
  a.x[0] = 200;
  assert.deepEqual(r.next(prepared), { x: [2, 3] });
  assert(Object.isFrozen(prepared.spec.values[0].x));
});

test('Gaussian copulas correlate named channels while preserving appended channel choices', () => {
  const spec = {
      channels: [
        { name: 'height', distribution: { type: 'normal' } },
        { name: 'width', distribution: { type: 'normal' } }
      ],
      correlation: [
        [1, 0.78],
        [0.78, 1]
      ]
    },
    d = R.correlated(spec),
    s = R.create(17).stream('trees');
  const samples = Array.from({ length: 12000 }, (_, i) => s.sample(i, d));
  near(
    correlation(
      samples.map(v => v.height),
      samples.map(v => v.width)
    ),
    0.78,
    0.025
  );
  assert.equal(s.cursor, 0);
  const larger = R.correlated({
    channels: [...spec.channels, { name: 'hue', distribution: { type: 'uniform' } }],
    correlation: [
      [1, 0.78, 0],
      [0.78, 1, 0],
      [0, 0, 1]
    ]
  });
  for (let i = 0; i < 20; i++) {
    const a = s.sample(i, d),
      b = s.sample(i, larger);
    assert.equal(a.height, b.height);
    assert.equal(a.width, b.width);
  }
  const perfect = R.correlated({
    ...spec,
    correlation: [
      [1, 1],
      [1, 1]
    ]
  });
  for (let i = 0; i < 20; i++) {
    const v = s.sample(i, perfect);
    assert.equal(v.height, v.width);
  }
  const negative = R.correlated({
    ...spec,
    correlation: [
      [1, -1],
      [-1, 1]
    ]
  });
  for (let i = 0; i < 20; i++) {
    const v = s.sample(i, negative);
    near(v.height, -v.width, 1e-6);
  }
});

test('independent streams have negligible cross-correlation in the deterministic fixture', () => {
  const root = R.create('independence'),
    a = root.stream('decor-A').batch(16000),
    b = root.stream('decor-B').batch(16000);
  assert(Math.abs(correlation(a, b)) < 0.035);
});

test('coherent variation reuses seeded noise without advancing streams, with analytic gradients', () => {
  const s = K.random.create(21).stream('grass'),
    field = K.random.spatial(s, { dimension: 3, scale: [2, 1.4, 2], octaves: 3, min: 0.3, max: 1.4 }),
    p = [0.37, 0.23, 0.71],
    sample = field.sample(...p);
  assert.equal(s.cursor, 0);
  near(field(...p), sample.value);
  assert(sample.value >= 0.3 && sample.value <= 1.4);
  for (let i = 0; i < 3; i++) {
    const a = p.slice(),
      b = p.slice();
    a[i] += 1e-6;
    b[i] -= 1e-6;
    near(sample.gradient[i], (field(...a) - field(...b)) / 2e-6, 2e-5);
  }
  assert.deepEqual(
    field.sample(...p),
    K.random
      .spatial(K.random.create(21).stream('grass'), {
        dimension: 3,
        scale: [2, 1.4, 2],
        octaves: 3,
        min: 0.3,
        max: 1.4
      })
      .sample(...p)
  );
  assert(Math.abs(field(...p) - field(p[0] + 0.001, p[1], p[2])) < 0.02);
  const F = K.procedural.fields,
    a = F.compile({ type: 'namedNoise', stream: ['terrain', 'west'], seed: 21 }),
    b = F.compile({ type: 'namedNoise', stream: ['terrain', 'west'], seed: 21 });
  assert.deepEqual(a.sample(...p), b.sample(...p));
  assert.notEqual(a(...p), F.compile({ type: 'namedNoise', stream: ['terrain', 'east'], seed: 21 })(...p));
});

test('work budgets and invalid authoring controls fail before consuming a draw', () => {
  const root = R.create(0, { maxStreams: 2, maxDraws: 3, maxWords: 1, maxBatch: 2 }),
    s = root.stream('a');
  assert.throws(() => s.next(normal), /word budget/);
  assert.equal(s.cursor, 0);
  assert.throws(() => s.batch(3), /batch/);
  assert.equal(s.cursor, 0);
  assert.throws(() => s.next({ type: 'choice', values: [], weights: [] }), /choice/);
  assert.equal(s.cursor, 0);
  root.stream('b');
  assert.throws(() => root.stream('c'), /stream budget/);
  assert.throws(() => R.distribution({ type: 'normal', min: 99, max: 100 }), /probability mass/);
  for (const spec of [
    { type: 'normal', deviation: 0 },
    { type: 'uniform', min: 2, max: 1 },
    { type: 'integer', min: 1.2 },
    { type: 'bernoulli', probability: 2 },
    { type: 'choice', values: ['a'], weights: [0] },
    { type: 'bad' },
    { type: 'normal', extra: 1 }
  ])
    assert.throws(() => R.distribution(spec));
  const channels = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.throws(
    () =>
      R.correlated({
        channels,
        correlation: [
          [1, 0.9, 0.9],
          [0.9, 1, -0.9],
          [0.9, -0.9, 1]
        ]
      }),
    /semidefinite/
  );
  assert.throws(
    () =>
      R.correlated({
        channels: channels.slice(0, 2),
        correlation: [
          [1, 0.5],
          [0.3, 1]
        ]
      }),
    /symmetric/
  );
  assert.throws(() => R.create(NaN));
  assert.throws(() => s.fork(''));
  assert.throws(() => s.order(['a', 'a']), /unique/);
  assert.throws(() => K.random.spatial(s, { octaves: 99 }));
  const recursive = { type: 'correlated', channels: [] };
  recursive.channels.push({ name: 'bad', distribution: recursive });
  assert.throws(() => R.distribution(recursive), /nested/);
});

test('the versioned counter generator keeps its numeric replay fixtures', () => {
  assert.equal(R.algorithm, 'ink/counter-random/1');
  assert.deepEqual(
    R.create(0).stream('stable').batch(5),
    [0.0532730885026117, 0.48133580839339063, 0.14678004421205315, 0.7647257078706121, 0.2702262377724455]
  );
});

test('retained courtyard edits preserve unrelated carrier data and named choices', () => {
  const demo = require('../examples/randomness')(ink.load());
  demo.update(0);
  const initial = demo.inspect(),
    data = demo.world.data.slice(),
    matrices = demo.matrices.slice();
  const flowerRows = new Set(demo.flowerIds.flatMap(id => demo.tags[id] ?? []));
  demo.changeFlowers();
  demo.update(0);
  assert.deepEqual(demo.inspect().unchanged, { lanterns: true, rocks: true, trees: true });
  assert.notDeepEqual(demo.inspect().flowers, initial.flowers);
  for (let i = 0; i < demo.world.count; i++)
    if (!flowerRows.has(i))
      assert.deepEqual(demo.world.data.subarray(i * 16, i * 16 + 16), data.subarray(i * 16, i * 16 + 16));
  assert.deepEqual(demo.matrices.subarray(0, 36), matrices.subarray(0, 36));
  const prefix = demo.inspect().flowers.slice(0, 16);
  demo.addFlowers();
  demo.update(0);
  assert.deepEqual(demo.inspect().flowers.slice(0, 16), prefix);
  assert.equal(demo.inspect().visibleFlowers, 24);
  demo.setCorrelation(-0.75);
  demo.update(0);
  assert.equal(demo.inspect().unchanged.rocks, true);
  assert.equal(demo.inspect().unchanged.lanterns, true);
  assert.equal(demo.inspect().unchanged.trees, false);
  demo.reset();
  demo.update(0);
  assert.deepEqual(demo.inspect().flowers, initial.flowers);
  assert.deepEqual(demo.inspect().trees, initial.trees);
  assert.deepEqual(demo.world.data, data);
  assert.deepEqual(demo.matrices, matrices);
});

test('CLI reports reproducible named recipes, keyed samples and checkpoints', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    { execFileSync } = require('node:child_process'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-random-'));
  try {
    const input = path.join(dir, 'recipe.json'),
      cli = path.join(__dirname, '../cli/ink-studio.js');
    fs.writeFileSync(
      input,
      JSON.stringify({
        seed: 'scene',
        streams: [
          { path: ['lamps'], keys: ['a', 'b'], distribution: { type: 'integer', min: 2, max: 9 } },
          { path: ['grass'], count: 4, distribution: { type: 'normal', min: -1, max: 1 } }
        ]
      })
    );
    const read = () => JSON.parse(execFileSync(process.execPath, [cli, 'randomness', input], { encoding: 'utf8' })),
      first = read();
    assert.deepEqual(first, read());
    assert.equal(first.streams[0].cursor, 0);
    assert.equal(first.streams[1].cursor, 4);
    const restored = R.from(first.checkpoint);
    assert.equal(restored.stream('grass').cursor, 4);
    assert(first.streams[0].values.every(v => v.value >= 2 && v.value <= 9));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quantile endpoints respect bounded support and zero-probability choices', () => {
  for (const spec of [
    { type: 'uniform', min: 2, max: 5 },
    { type: 'triangular', min: 2, max: 5 },
    { type: 'power', min: 2, max: 5 },
    { type: 'normal', min: 2, max: 5 },
    { type: 'logNormal', min: 2, max: 5 },
    { type: 'exponential', min: 2, max: 5 }
  ]) {
    const d = R.distribution(spec);
    assert.equal(d.quantile(0), 2);
    assert.equal(d.quantile(1), 5);
  }
  assert.equal(R.distribution({ type: 'choice', values: ['yes', 'never'], weights: [1, 0] }).quantile(1), 'yes');
  assert.equal(R.distribution({ type: 'bernoulli', probability: 0 }).quantile(1), false);
});

function browserRandomFixture({ KIT: K }) {
  const root = K.random.create('庭/014'),
    stream = root.stream('flowers', 'north');
  const uniform = stream.batch(12),
    ints = stream.batch(12, { type: 'integer', min: -100, max: 100 });
  const recipe = K.random.correlated({
    channels: [
      { name: 'height', distribution: { type: 'normal' } },
      { name: 'width', distribution: { type: 'normal' } }
    ],
    correlation: [
      [1, -0.7],
      [-0.7, 1]
    ]
  });
  const correlated = Array.from({ length: 12 }, (_, i) => stream.sample(['flower', i], recipe)),
    saved = root.snapshot();
  const next = stream.next();
  root.restore(saved);
  return { uniform, ints, correlated, saved, next, replayed: stream.next() };
}

test(
  'browser and Node authoring keep the same named bit streams and replay state',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const cpu = browserRandomFixture(ink.load()),
      native = require('../cli/look-webgl')({ hardware: true }, browserRandomFixture, (kit, build) => build(kit));
    for (const key of ['uniform', 'ints', 'saved', 'next', 'replayed']) assert.deepEqual(native[key], cpu[key]);
    for (let i = 0; i < 12; i++) {
      near(native.correlated[i].height, cpu.correlated[i].height, 1e-12);
      near(native.correlated[i].width, cpu.correlated[i].width, 1e-12);
    }
  }
);
