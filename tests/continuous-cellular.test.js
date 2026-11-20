const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const C = K.cellular.continuous;

function near(actual, expected, tolerance = 2e-6) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test('sampled kernels normalize their taps and support authored signed filters', () => {
  const disk = C.kernel({ radius: 3.4, samples: 4, weight: () => 1 });
  near(disk.taps.reduce((sum, tap) => sum + tap[2], 0), 1);
  const weights = new Map(disk.taps.map(([x, y, n]) => [`${x},${y}`, n]));
  assert.equal(weights.get('2,1'), weights.get('-2,-1'));
  assert(weights.get('1,3') < weights.get('0,0'));
  const source = [[-1, 0, -2], [1, 0, 2]];
  const edge = C.kernel({ taps: source, normalize: 'l1' });
  source[0][2] = 5;
  assert.deepEqual(edge.taps, [[-1, 0, -.5], [1, 0, .5]]);
  assert.throws(() => C.kernel({ taps: edge.taps }), /zero mass/);
});

test('FFT sampling matches directional sums at both boundaries and on tiny or non-power grids', () => {
  const taps = [[1, 0, .7], [-5, -1, -.3], [0, 2, .11], [0, 0, 1]];
  const kernel = C.kernel({ taps, normalize: 'none' });
  for (const [width, height] of [[8, 4], [8, 3], [5, 3], [1, 1]]) for (const boundary of ['empty', 'wrap']) {
    const source = Float32Array.from({ length: width * height }, (_, i) => (i + 1) / (width * height + 1));
    const sim = C.create({ width, height, boundary, channels: ['a'], initial: { a: source }, rule: () => ({}),
      neighborhoods: { sensed: { channel: 'a', kernel } } });
    const field = sim.frame().data('sensed');
    const at = (x, y) => {
      if (boundary === 'wrap') return source[((y % height + height) % height) * width + (x % width + width) % width];
      return x >= 0 && x < width && y >= 0 && y < height ? source[y * width + x] : 0;
    };
    field.forEach((value, i) => near(value, taps.reduce((v, [dx, dy, w]) =>
      v + w * at(i % width + dx, Math.floor(i / width) + dy), 0)));
  }
});

test('two state channels exchange distinct potentials synchronously and keep unchanged values', () => {
  const probe = C.kernel({ taps: [[1, 0, 1]] });
  const sim = C.create({ width: 3, height: 1, channels: ['heat', 'pigment'],
    initial: { heat: [1, .5, 0], pigment: [.25, .75, 1] },
    neighborhoods: { hot: { channel: 'heat', kernel: probe }, colored: { channel: 'pigment', kernel: probe } },
    rule: ({ fields, x }) => x === 0 ? { pigment: fields.hot } : { heat: fields.colored, pigment: fields.hot } });
  const before = sim.frame();
  sim.step();
  assert.deepEqual([...sim.frame().data('heat')], [1, 1, .25]);
  assert.deepEqual([...sim.frame().data('pigment')].map(v => Math.round(v * 4) / 4), [.5, 0, 1]);
  assert.deepEqual([...before.data('heat')], [1, .5, 0]);
  const copy = before.data('hot');
  copy[0] = 0;
  near(before.data('hot')[0], .5);
});

test('masks gate updates and local injections, including across a periodic seam', () => {
  const sim = C.create({ width: 5, height: 1, channels: ['a', 'b'], mask: [1, 0, 1, 1, .5],
    initial: { a: .25 }, rule: () => ({ a: 1 }) });
  assert.deepEqual([...sim.frame().data('a')], [.25, 0, .25, .25, .25]);
  sim.inject({ at: [0, 0], radius: 1, falloff: 'flat', values: { a: .5, b: 1 } });
  assert.deepEqual([...sim.frame().data('a')], [.75, 0, .25, .25, .5]);
  assert.deepEqual([...sim.frame().data('b')], [1, 0, 0, 0, .5]);
  sim.step();
  assert.deepEqual([...sim.frame().data('a')], [1, 0, 1, 1, .75]);
  sim.inject({ at: [4, 0], radius: .2, mode: 'replace', values: { a: .25 } });
  assert.equal(sim.frame().data('a')[4], .5);
  sim.setMask(({ x }) => Number(x < 3));
  assert.deepEqual([...sim.frame().data('a')], [1, 0, 1, 0, 0]);
  sim.reset();
  assert.deepEqual([...sim.frame().data('a')], [.25, 0, .25, .25, .25]);
});

test('JSON checkpoints replay exactly and invalid edits or rule batches leave state intact', () => {
  const recipe = C.presets.lenia({ radius: 5 });
  const spec = { ...recipe, width: 21, height: 15, initial: { life: ({ x, y }) => x % 3 === 0 && y % 3 === 0 ? .5 : 0 } };
  const a = C.create(spec), b = C.create(spec);
  a.step(4);
  a.setMask(({ x }) => x ? 1 : 0);
  const saved = JSON.parse(JSON.stringify(a.checkpoint()));
  b.restore(saved);
  assert.deepEqual(b.checkpoint(), saved);
  const injection = { at: [9, 10], radius: 3, values: { life: .7 } };
  for (const sim of [a, b]) { sim.inject(injection); sim.step(6); }
  assert.deepEqual(a.checkpoint(), b.checkpoint());
  const frame = b.frame();
  saved.state.life[0] = .9;
  assert.throws(() => b.restore(saved), /masked-out/);
  assert.throws(() => b.inject({ ...injection, values: { wrong: .3 } }), /unknown channel/);
  assert.equal(b.frame(), frame);
  const failed = C.create({ ...spec, rule: ({ tick }) => ({ life: tick === 3 ? NaN : .5 }) });
  const initial = failed.checkpoint();
  assert.throws(() => failed.step(3), /finite/);
  assert.deepEqual(failed.checkpoint(), initial);
});

test('Lenia and both SmoothLife time modes implement their respective transition equations', () => {
  const lenia = C.presets.lenia({ radius: 3, mu: .3, sigma: .02, dt: .12 });
  const a = C.create({ ...lenia, width: 8, height: 8, initial: { life: .3 } });
  a.step();
  near(a.frame().data('life')[4], .42);
  const disk = C.presets.smoothLife({ radius: 4 });
  const rate = C.presets.smoothLife({ radius: 4, mode: 'rate', dt: .07 });
  const simulators = [disk, rate].map(rule => C.create({ ...rule, width: 8, height: 8, initial: { life: .32 } }));
  for (const sim of simulators) {
    near(sim.frame().data('inside')[3], .32);
    near(sim.frame().data('ring')[3], .32);
    sim.step();
  }
  const [discrete, integrated] = simulators.map(sim => sim.frame().data('life')[0]);
  assert(discrete > .95);
  near(integrated, .32 + .07 * (2 * discrete - 1));
});

test('retained chart fields drive existing material masks and field view sources', () => {
  const sim = C.create({ width: 2, height: 2, channels: ['reveal'], initial: { reveal: [0, 1, 0, 1] }, rule: () => ({ reveal: 0 }) });
  const frame = sim.frame(), context = K.splatEffects.context({ fields: { culture: sim } });
  const prepared = SurfaceLook.prepare({ layers: {
    wash: { type: 'projected', field: 'culture', maskChannel: 'reveal', color: '#ff9900',
      projection: ([u, v]) => [u, v] }
  } }, [], [0, 1, 0], context);
  const sample = { position: [.75, .25, 0], normal: [0, 0, 1], view: [0, 0, 1] };
  assert.deepEqual(SurfaceLook.shade(prepared, sample, [0, 0, 0]).slice(0, 3), [1, .6, 0]);
  sim.step();
  assert.deepEqual(SurfaceLook.shade(prepared, sample, [0, 0, 0]).slice(0, 3), [0, 0, 0]);
  const source = frame.source('reveal', { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, project: ([x, y]) => [x, y] });
  near(source.sample(.5, .5, 0), .5);
  near(frame.sample('reveal', .75, .25), 1);
  assert.equal(frame.sample('reveal', 1.1, .5), 0);
});
