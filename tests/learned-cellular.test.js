const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const C = K.cellular.learned;

function propagator(options = {}) {
  return { format: 'ink-studio/neural-cellular', version: 1, channels: ['pigment', 'alpha'],
    perception: ['identity', 'sobelX'], alpha: 'alpha', aliveThreshold: .1, updateRate: 1,
    seedState: [.5, 1], hidden: { bias: [0], weights: [0, 0, 0, 1] }, delta: { bias: [0, 0], weights: [2, 4] },
    ...options };
}
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} differs from ${b}`);

test('compiles channel-major perception and residual layers without retaining caller buffers', () => {
  const input = propagator(), model = C.compile(input);
  input.hidden.weights[3] = 0;
  const sim = C.create({ model, width: 7, height: 1 });
  sim.seedAt(4, 0);
  sim.step();
  assert.deepEqual([...sim.frame().get(3, 0)], [.5, 1]);
  assert.deepEqual([...sim.frame().get(4, 0)], [.5, 1]);
  assert.deepEqual([...sim.frame().get(2, 0)], [0, 0]);
  sim.step();
  assert.deepEqual([...sim.frame().get(2, 0)], [.5, 1]);
  assert.equal(C.compile(model), model);
  assert(Object.isFrozen(model.channels));
});

test('blank cells stay blank and cells without surviving alpha lose all hidden state', () => {
  const model = propagator({ hidden: { bias: [1], weights: [0, 0, 0, 0] }, delta: { bias: [1, -1], weights: [0, 0] } });
  const blank = C.create({ model, width: 3, height: 3 });
  blank.step(3);
  assert(blank.frame().data('pigment').every(value => value === 0));
  blank.seedAt(1, 1);
  blank.step();
  assert(blank.frame().data('pigment').every(value => value === 0));
  assert(blank.frame().data('alpha').every(value => value === 0));
});

test('wrapped propagation and circular erasure use the same topology and clear every channel', () => {
  const periodic = C.create({ model: propagator(), width: 7, height: 3, boundary: 'wrap' });
  const open = C.create({ model: propagator(), width: 7, height: 3 });
  for (const sim of [open, periodic]) { sim.seedAt(0, 1); sim.step(); }
  assert.deepEqual([...open.frame().get(6, 1)], [0, 0]);
  assert.deepEqual([...periodic.frame().get(6, 1)], [.5, 1]);
  const old = periodic.frame();
  assert.equal(periodic.erase({ at: [0, 1], radius: 1 }), 5);
  assert.deepEqual([...periodic.frame().get(6, 1)], [0, 0]);
  assert.deepEqual([...old.get(6, 1)], [.5, 1]);
});

test('seeded partial updates replay exactly through batch partitioning and checkpoints', () => {
  const opts = { model: propagator({ updateRate: .52 }), seed: 19, width: 15, height: 3 };
  const first = C.create(opts), replay = C.create(opts);
  first.seedAt(11, 1);
  first.step(5);
  const saved = JSON.parse(JSON.stringify(first.checkpoint()));
  replay.restore(saved);
  first.step(7);
  for (let i = 0; i < 7; i++) replay.step();
  assert.deepEqual(first.checkpoint(), replay.checkpoint());
  replay.reset();
  assert.equal(replay.tick, 0);
  assert(replay.frame().data('alpha').every(value => !value));
  assert.throws(() => C.create({ ...opts, seed: 20 }).restore(saved), /incompatible/);
});

test('bad model coefficients and unstable batches fail atomically', () => {
  assert.throws(() => C.compile(propagator({ perception: ['eval'] })), /supported perception/);
  assert.throws(() => C.compile(propagator({ hidden: { bias: [0], weights: [Infinity] } })), /invalid shape/);
  assert.throws(() => C.compile(propagator({ seedState: [1, 0] })), /seed must be alive/);
  const sim = C.create({ width: 2, height: 2, model: propagator({ delta: { bias: [40, 0], weights: [0, 0] } }) });
  sim.seedAt(0, 0);
  const frame = sim.frame();
  assert.throws(() => sim.step(2), /bounded state range/);
  assert.throws(() => sim.edit([{ x: 0, y: 0, state: [1, 1] }, { x: 3, y: 0, state: [0, 0] }]), /outside the grid/);
  assert.equal(sim.frame(), frame);
  assert.equal(sim.tick, 0);
});

test('a neural state plane can drive a projected material and a retained world source', () => {
  const sim = C.create({ width: 3, height: 3, model: propagator() });
  const context = K.splatEffects.context({ fields: { iris: sim } });
  const prepared = SurfaceLook.prepare({ layers: {
    gold: { type: 'projected', field: 'iris', maskChannel: 'alpha', color: '#aaee88', projection: ([u, v]) => [u, v] }
  } }, [], [0, 1, 0], context);
  const sample = { position: [.5, .5, 0], normal: [0, 0, 1], view: [0, 0, 1] };
  assert.deepEqual(SurfaceLook.shade(prepared, sample, [0, 0, 0]).slice(0, 3), [0, 0, 0]);
  sim.seedAt(1, 1);
  near(SurfaceLook.shade(prepared, sample, [0, 0, 0])[1], 238 / 255);
  const source = sim.frame().source('pigment', { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, project: ([x, y]) => [x, y] });
  near(source.sample(.5, .5, 0), .5);
  sim.erase({ at: [1, 1], radius: 0 });
  near(source.sample(.5, .5, 0), .5);
  near(sim.frame().sample('pigment', .5, .5), 0);
});

test('the shipped trained rule grows from one cell and repairs two different all-channel erasures', () => {
  const model = require('../examples/learned-harbor-mark.json');
  const sim = C.create({ model, width: 23, height: 23, seed: 12 });
  const alpha = () => sim.frame().data('alpha');
  sim.seedAt(11, 11);
  assert.equal(alpha().filter(v => v > .5).length, 1);
  sim.step(109);
  const mature = alpha(), saved = sim.checkpoint();
  const overlap = plane => {
    let intersection = 0, union = 0;
    for (let i = 0; i < mature.length; i++) {
      const a = mature[i] > .5, b = plane[i] > .5;
      intersection += Number(a && b);
      union += Number(a || b);
    }
    return intersection / union;
  };
  assert(mature.filter(v => v > .5).length > 100);
  for (const wound of [{ at: [13.3, 6.8], radius: 4.1 }, { at: [6.4, 13.2], radius: 4 }]) {
    sim.restore(saved);
    sim.erase(wound);
    assert(overlap(alpha()) < .80);
    assert(sim.frame().get(...wound.at.map(Math.round)).every(v => v === 0));
    sim.step(80);
    assert(overlap(alpha()) > .90);
  }
});
