const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const C = K.cellular, S = C.sandpile;
const dab = (x, y, grains, z = 0) => ({ x, y, z, grains });

test('toppling transfers one grain per edge and delays newly unstable cells to the next wave', () => {
  const sim = S.create({ width: 3, height: 1, initial: [3, 0, 0] });
  assert.equal(sim.add([dab(1, 0, 4)]), 4);
  const before = sim.frame();
  assert.deepEqual(sim.step(), { status: 'limit', stable: false, waves: 1, topplings: 1, lost: 2, tick: 1 });
  assert.deepEqual([...sim.frame().data()], [4, 0, 1]);
  assert.deepEqual([...sim.frame().data('topplings')], [0, 1, 0]);
  assert.deepEqual([...before.data()], [3, 4, 0]);
  assert.deepEqual(sim.step(), { status: 'stable', stable: true, waves: 1, topplings: 1, lost: 3, tick: 2 });
  assert.deepEqual([...sim.frame().data('lastToppled')], [2, 1, 0]);
  assert.deepEqual(sim.frame().mass, { initial: 3, added: 4, lost: 5, retained: 2 });
  assert.equal(sim.step(30).waves, 0);
});

test('open edges and masked sinks drain separately from periodic and 3D topology', () => {
  const ring = S.create({ width: 5, height: 3, boundary: 'wrap', mask: ({x, y}) => x !== 0 || y !== 0 });
  assert.equal(ring.add([dab(4, 0, 4), dab(0, 0, 3)]), 4);
  ring.step();
  assert.deepEqual(ring.frame().mass, { initial: 0, added: 7, lost: 4, retained: 3 });
  assert.equal(ring.frame().get(4, 2), 1);
  assert.equal(ring.frame().active(0, 0), false);
  for (const lattice of ['hex', 'voxel']) {
    const sim = S.create({ width: 5, height: 5, depth: lattice === 'voxel' ? 3 : 1, lattice });
    sim.add([dab(2, 2, 6, lattice === 'voxel' ? 1 : 0)]);
    sim.step();
    assert.equal(sim.frame().data().filter(n => n === 1).length, 6);
    assert.equal(sim.frame().mass.retained, 6);
    if (lattice === 'hex') assert.deepEqual(sim.position(2, 2), [3, Math.sqrt(3), 0]);
    else assert.equal(sim.frame().get(2, 2, 2), 1);
  }
});

test('open sandpile stabilization gives the same result and odometer after regrouping deposits', () => {
  const opts = { width: 11, height: 9, mask: ({x, y}) => x + y > 1 };
  const a = S.create(opts), b = S.create(opts), drops = [dab(5, 4, 301), dab(8, 4, 104), dab(6, 6, 101)];
  a.add(drops);
  assert(a.stabilize().stable);
  for (const drop of [...drops].reverse()) {
    b.add([drop]);
    assert(b.stabilize().stable);
  }
  assert.deepEqual(a.frame().data(), b.frame().data());
  assert.deepEqual(a.frame().data('topplings'), b.frame().data('topplings'));
  assert.deepEqual(a.frame().mass, b.frame().mass);
});

test('a conservative unstable pile stops at its budget and checkpoints restore exactly', () => {
  const config = { width: 1, height: 1, boundary: 'wrap', maxWork: 15, initial: 4 };
  const sim = S.create(config), other = S.create(config);
  assert.deepEqual(sim.stabilize(), { status: 'budget', stable: false, waves: 3, topplings: 3, lost: 0, tick: 3 });
  other.restore(JSON.parse(JSON.stringify(sim.checkpoint())));
  for (const pile of [sim, other]) pile.step(2);
  const saved = sim.checkpoint(), view = sim.frame();
  assert.deepEqual(other.checkpoint(), saved);
  saved.grains[0] = 5;
  assert.throws(() => sim.restore(saved), /mass/);
  assert.throws(() => sim.add([dab(0, 0, 1), dab(2, 0, 1)]), /outside/);
  assert.equal(sim.frame(), view);
  sim.reset();
  assert.equal(sim.tick, 0);
  assert.equal(sim.frame().get(0, 0), 4);
});

test('excitable input charges, leaks, fires, ignores input, and then recovers', () => {
  const rule = C.rules.excitable({ threshold: 3, leak: 1, refractory: 2, recovery: 2 });
  const by = (state, n) => rule({ state, neighbors: Array(n).fill(rule.firing) });
  assert.equal(rule.states, 8);
  assert.equal(by(0, 2), 2);
  assert.equal(by(2, 0), 1);
  assert.equal(by(2, 1), rule.firing);
  assert.equal(by(rule.firing, 9), 4);
  assert.equal(by(4, 9), 5);
  assert.equal(by(5, 9), 6);
  assert.equal(rule.describe(6).required, 5);
  assert.equal(rule.describe(7).required, 4);
  assert.equal(by(6, 4), 7);
  assert.equal(by(7, 4), rule.firing);
  assert.equal(by(7, 3), 0);
  assert.deepEqual([...Array(rule.states).keys()].map(i => rule.describe(i).phase),
    ['rest', 'charging', 'charging', 'firing', 'refractory', 'refractory', 'recovering', 'recovering']);
});

test('approaching line waves meet, extinguish, and leave resting cells after recovery', () => {
  const rule = C.rules.excitable({ refractory: 5, recovery: 2 });
  const wave = C.create({ width: 33, height: 1, lattice: 'line', rule,
    initial: ({ x }) => x === 6 || x === 26 ? rule.firing : 0 });
  wave.step(10);
  assert.equal(wave.get(16), rule.firing);
  wave.step();
  assert(!wave.snapshot().cells.includes(rule.firing));
  wave.step(12);
  assert(wave.snapshot().cells.every(n => n === 0));
});

test('the excitable rule accepts graph weights and uses the graph alphabet', () => {
  const rule = C.rules.excitable({ threshold: 2, gain: 2, refractory: 1, recovery: 2 });
  const graph = C.graph.create({ nodes: [{ id: 'a', state: rule.firing, locked: true }, 'b', 'unlinked'],
    edges: [{ from: 'a', to: 'b', weight: .5 }], rule });
  assert.equal(graph.states, rule.states);
  graph.step();
  assert.equal(graph.get('b'), 1);
  graph.step();
  assert.equal(graph.get('b'), rule.firing);
  assert.equal(graph.get('unlinked'), 0);
});
