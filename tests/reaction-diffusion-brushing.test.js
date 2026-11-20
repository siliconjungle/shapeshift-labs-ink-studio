const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const P = K.procedural, G = P.growth.grayScott;
const near = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`);

const chart = (id, width = 5, height = 5, options = {}) => ({ id, width, height, ...options });
const join = { a: ['left', 'u1'], b: ['right', 'u0'] };

test('a linked pair evolves the same Gray–Scott field as a single uncut lattice', () => {
  const width = 13, height = 7, steps = 75;
  function initial(x, y) {
    return Math.hypot(x - 5, y - 3) < 2.5 ? [.45 + .02 * y, .28] : [1, 0];
  }
  const legacy = P.growth.grayScottGrid({ width, height, steps, initial: ([x, y]) => initial(x, y) });
  const live = G.create({ charts: [chart('left', 6, height), chart('right', 7, height)], seams: [join],
    initial: c => initial(c.x + (c.chart === 'right' ? 6 : 0), c.y) });
  live.step(steps);
  for (const name of ['u', 'v']) {
    const a = live.frame('left').data(name), b = live.frame('right').data(name);
    legacy[name].forEach((value, i) => {
      const x = i % width, y = Math.floor(i / width);
      near(value, x < 6 ? a[y * 6 + x] : b[y * 7 + x - 6]);
    });
  }
  const y = 3.5 / height;
  near(live.frame('left').sample('v', 1, y), live.frame('right').sample('v', 0, y));
});

test('brush dabs follow a rotated reversed seam and paint feed and kill', () => {
  const sim = G.create({ charts: [chart('left'), chart('right'), chart('island')],
    seams: [{ a: ['left', 'u1'], b: ['right', 'v0'], reverse: true }] });
  const original = sim.frame('right');
  const edits = sim.brush({ chart: 'left', at: [.9, .3], radius: 1.1, falloff: 'flat', values: { u: .4, v: .35, feed: .08, kill: .13 } });
  assert.equal(edits, 5);
  const frame = sim.frame('right');
  assert.equal(frame.data('v')[3], .35);
  assert.equal(frame.data('feed')[3], .08);
  assert.equal(frame.data('kill')[3], .13);
  assert.equal(frame.data('v')[1], 0);
  assert.equal(original.data('v')[3], 0);
  assert(sim.frame('island').data('v').every(v => v === 0));
  sim.brush({ chart: 'right', at: [.7, .1], radius: .5, mode: 'add', values: { v: -.5 } });
  assert.equal(sim.frame('right').data('v')[3], 0);
});

test('masks stop diffusion, brush footprints, and strong currents at holes', () => {
  const sim = G.create({ charts: [chart('bed', 7, 5, { mask: ({ x }) => x !== 3 })] });
  const dab = { chart: 'bed', radius: 8, values: { u: .47, v: .35 }, falloff: 'flat' };
  assert.equal(sim.brush({ ...dab, at: [.5, .5] }), 0);
  assert.equal(sim.brush({ ...dab, at: [.27, .5] }), 15);
  sim.step(10, { flow: () => [1, 0] });
  const frame = sim.frame('bed');
  assert.equal(frame.sample('v', .5, .5), 0);
  assert(!frame.active(3, 2));
  assert(frame.data('v').every((v, i) => i % 7 < 3 || v === 0));
});

test('upwind flow crosses a rotated seam and projects XYZ motion through a skew chart', () => {
  const quiet = { du: 0, dv: 0, feed: 0, kill: 0 };
  const rotated = G.create({ ...quiet, charts: [chart('left'), chart('right')],
    seams: [{ a: ['left', 'u1'], b: ['right', 'v0'], reverse: true }],
    initial: c => [0, c.chart === 'left' && c.x === 4 && c.y === 1 ? .8 : 0] });
  rotated.step(1, { flow: ({ chart }) => chart === 'right' ? [0, .1] : null });
  near(rotated.frame('right').data('v')[3], .4);
  const carrier = P.surface.plane({ id: 'skew', origin: [0, 0, 0], u: [2, 0, 0], v: [1, 1, 0] });
  const skew = G.create({ ...quiet, charts: [chart('skew', 4, 4, { carrier })],
    initial: ({ x }) => [0, x === 0 ? .8 : 0], flow: () => [.25, 0, .7] });
  skew.step();
  const data = skew.frame('skew').data('v');
  near(data[1], .4);
  near(data[5], .4);
  near(data[2], 0);
});

test('JSON checkpoints replay edited rates and flow, and failed steps commit nothing', () => {
  const settings = { charts: [chart('left'), chart('right')], seams: [join], feed: ({ x }) => .025 + .002 * x };
  const a = G.create(settings), b = G.create(settings);
  a.brush({ chart: 'left', at: [.7, .6], radius: 2.8, values: { u: .3, v: .35, feed: .049 } });
  a.step(9);
  const saved = JSON.parse(JSON.stringify(a.checkpoint()));
  b.restore(saved);
  assert.deepEqual(b.checkpoint(), saved);
  const flow = (_cell, { tick }) => [.06 * Math.cos(tick), -.05];
  for (const sim of [a, b]) sim.step(13, { flow });
  assert.deepEqual(a.checkpoint(), b.checkpoint());
  const before = b.frame('left'), end = b.checkpoint();
  assert.throws(() => b.step(2, { flow: (_cell, { tick }) => tick === end.tick ? [.01, .01] : [Infinity, 0] }), /finite UV or XYZ/);
  assert.throws(() => b.step(1, { flow: () => [100, 1] }), /substep limit/);
  assert.deepEqual(b.checkpoint(), end);
  assert.equal(b.frame('left'), before);
  assert.throws(() => G.create({ ...settings, seams: [] }).restore(saved), /incompatible/);
  b.reset();
  assert.equal(b.tick, 0);
  near(b.frame('left').data('feed')[1], .027);
});

test('retained chart adapters drive existing projected material masks', () => {
  const sim = G.create({ charts: [chart('bed')] });
  const field = sim.field('bed'), sample = { position: [.5, .5, 0], normal: [0, 0, 1], view: [0, 0, 1] };
  const context = K.splatEffects.context({ fields: { ink: field } });
  const prepared = SurfaceLook.prepare({ layers: {
    color: { type: 'projected', field: 'ink', maskChannel: 'v', color: '#99ffee', projection: ([u, v]) => [u, v] }
  } }, [], [0, 1, 0], context);
  assert.deepEqual(SurfaceLook.shade(prepared, sample, [0, 0, 0]).slice(0, 3), [0, 0, 0]);
  sim.brush({ chart: 'bed', at: [.5, .5], radius: 1.5, values: { v: 1 } });
  near(SurfaceLook.shade(prepared, sample, [0, 0, 0])[1], 1);
});
