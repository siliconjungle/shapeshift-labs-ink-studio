const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const G = K.cellular.graph;
const pulse = G.rules.pulse();

test('graph pulses observe direction and delay regardless of scene coordinates', () => {
  const graph = G.create({ nodes: [{ id: 'source', state: 1, data: { p: [0, 1, 0] } },
    { id: 'far', data: { p: [12, 1, 8] } }, { id: 'near', data: { p: [.01, 1, 0] } }, 'leaf'],
  edges: [{ from: 'source', to: 'far', delay: 4 }, { from: 'far', to: 'leaf' }, { from: 'near', to: 'source' }], rule: pulse });
  graph.step(3);
  assert.equal(graph.get('far'), 0);
  assert.equal(graph.frame().get('source', 3), 1);
  graph.step();
  assert.equal(graph.get('far'), 1);
  assert.equal(graph.get('leaf'), 0);
  graph.step();
  assert.equal(graph.get('leaf'), 1);
  assert.equal(graph.get('near'), 0);
  assert.throws(() => graph.frame().get('source', 4), /retained edge history/);
});

test('weighted pulses need simultaneous arrivals and follow configurable refractory ticks', () => {
  const graph = G.create({ nodes: [{ id: 'a', state: 1 }, 'b', 'gate'], rule: G.rules.pulse({ threshold: 1, refractory: 2 }),
    edges: [{ from: 'a', to: 'gate', weight: .55, delay: 3 }, { from: 'b', to: 'gate', weight: .45 }] });
  assert.equal(graph.states, 4);
  graph.step(2);
  assert.equal(graph.get('gate'), 0);
  graph.edit([{ id: 'b', state: 1 }]);
  graph.step();
  assert.equal(graph.get('gate'), 1);
  for (const expected of [2, 3, 0]) {
    graph.step();
    assert.equal(graph.get('gate'), expected);
  }
});

test('shared local rules operate on graph neighbors without a chart', () => {
  const graph = G.create({ nodes: [{ id: 'b', state: 1 }, 'a'], rule: K.cellular.rules.briansBrain({ birth: 1 }),
    edges: [{ from: 'a', to: 'b', bidirectional: true }] });
  graph.step();
  assert.equal(graph.get('a'), 1);
  assert.equal(graph.get('b'), 2);
  graph.step();
  assert.equal(graph.get('a'), 2);
  assert.equal(graph.get('b'), 0);
  assert.throws(() => graph.step(1, K.cellular.rules.rule30()), /neighborhood rule/);
  assert.throws(() => graph.step(1, K.cellular.rules.blockGas()), /neighborhood rule/);
});

test('labeled graph data is immutable and each parallel typed connection has its own input', () => {
  const nodes = [{ id: 'sink', type: 'stroke', data: { position: [1, 2, 3] } }, { id: 'relay', state: 2 }];
  const edges = [
    { id: 'paired', from: 'sink', to: 'relay', type: 'thermal', bidirectional: true, data: { wire: 'braided' } },
    { id: 'lag', from: 'relay', to: 'sink', type: 'signal', delay: 2, weight: .65 }
  ];
  const seen = [];
  const graph = G.create({ nodes, edges, states: 3, rule(context) {
    if (context.id === 'sink') seen.push(context);
    return context.state;
  } });
  nodes[0].data.position[0] = 9;
  edges[0].data.wire = 'plastic';
  graph.step(2);
  assert.deepEqual(seen[0].node.data.position, [1, 2, 3]);
  assert(Object.isFrozen(seen[0].node.data.position));
  assert.deepEqual(seen[0].neighbors, [0, 2]);
  assert.deepEqual(seen[1].neighbors, [2, 2]);
  assert.deepEqual(seen[0].inputs.map(p => [p.id, p.edge.type, p.sampledTick]), [['relay', 'signal', -1], ['relay', 'thermal', 0]]);
  assert.equal(seen[1].inputs[0].edge.weight, .65);
  assert.equal(seen[1].inputs[1].edge.data.wire, 'braided');
});

test('stable IDs make initialization, input order, and seeded replay independent of input list order', () => {
  const nodes = ['c', 'a', 'b'], edges = [{ from: 'a', to: 'c', delay: 4 }, { from: 'b', to: 'c', delay: 2 }];
  const parameters = { nodes, edges, states: 5, seed: 99, initial: ({ random }) => Math.floor(random() * 5),
    rule: ({ neighbors, state, random }) => (state + Math.floor(random() * 5) + (neighbors[0] ?? 0)) % 5 };
  const a = G.create(parameters), b = G.create({ ...parameters, nodes: [...nodes].reverse(), edges: [...edges].reverse() });
  assert.deepEqual(a.frame().data(), b.frame().data());
  a.step(11);
  const saved = JSON.parse(JSON.stringify(a.checkpoint()));
  b.restore(saved);
  a.step(7); b.step(7);
  assert.deepEqual(a.checkpoint(), b.checkpoint());
  b.reset();
  assert.equal(b.tick, 0);
  assert.deepEqual(b.frame().data(), G.create(parameters).frame().data());
});

test('locks contribute to rules and edits, restores, and step batches are atomic', () => {
  const graph = G.create({ nodes: [{ id: 'pinned', state: 1, locked: true }, 'out'], rule: pulse,
    edges: [{ from: 'pinned', to: 'out', delay: 2 }] });
  const start = graph.frame();
  graph.step(2);
  assert.equal(graph.get('out'), 1);
  assert.equal(graph.get('pinned'), 1);
  const frame = graph.frame();
  assert(frame.isLocked('pinned'));
  assert.throws(() => graph.edit([{ id: 'pinned', state: 0 }, { id: 'missing', locked: false }]), /unknown node/);
  assert.throws(() => graph.step(2, ({ tick }) => tick === 3 ? 3 : 200), /valid cell state/);
  const checkpoint = graph.checkpoint();
  checkpoint.history[0][0] = 800;
  assert.throws(() => graph.restore(checkpoint), /invalid state/);
  assert.equal(graph.frame(), frame);
  graph.edit([{ id: 'pinned', locked: false, state: 0 }]);
  assert(!graph.frame().isLocked('pinned'));
  assert.equal(graph.frame().get('pinned'), 0);
  assert.equal(graph.frame().get('pinned', 1), 1);
  assert.equal(start.get('pinned'), 1);
  graph.reset();
  assert(graph.frame().isLocked('pinned'));
});

test('bad topology and checkpoints from another graph are rejected', () => {
  assert.throws(() => G.create({ nodes: ['a', 'a'] }), /node IDs must be unique/);
  assert.throws(() => G.create({ nodes: ['a'], edges: [{ from: 'a', to: 'missing' }] }), /valid endpoints/);
  const edge = { from: 'a', to: 'b', bidirectional: true };
  assert.throws(() => G.create({ nodes: ['a', 'b'], edges: [edge, { ...edge, from: 'b', to: 'a' }] }), /edge IDs must be unique/);
  const a = G.create({ nodes: ['a', 'b'], edges: [edge] });
  const b = G.create({ nodes: ['a', 'b'], edges: [{ ...edge, delay: 2 }] });
  assert.throws(() => b.restore(a.checkpoint()), /incompatible/);
});
