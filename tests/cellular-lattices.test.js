const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const C = K.cellular, rules = C.rules;
const cells = grid => grid.snapshot().cells;
const count = grid => cells(grid).reduce((sum, value) => sum + value, 0);

test('Rule 30, 90, and 110 implement the elementary truth tables and infer a line', () => {
  assert.strictEqual(K.glyphGrid.rules, rules);
  assert.strictEqual(K.glyphGrid.create, C.create);
  const fixtures = [
    [rules.rule30(), [0, 1, 1, 1, 1, 0, 0, 0]],
    [rules.rule90(), [0, 1, 0, 1, 1, 0, 1, 0]],
    [rules.rule110(), [0, 1, 1, 1, 0, 1, 1, 0]]
  ];
  for (const [rule, table] of fixtures) for (let pattern = 0; pattern < 8; pattern++) {
    const grid = C.create({ width: 3, rule, initial: [pattern >> 2, pattern >> 1 & 1, pattern & 1] });
    assert.equal(grid.lattice, 'line');
    grid.step();
    assert.equal(grid.get(1), table[pattern]);
  }
  const grid = C.create({ width: 9, rule: rules.rule90(), initial: ({ x }) => Number(x === 4) });
  grid.step(2);
  assert.deepEqual([...cells(grid)], [0, 0, 1, 0, 0, 0, 1, 0, 0]);
  assert.throws(() => C.create({ width: 4, height: 2, lattice: 'square', rule: rules.rule30() }), /one row/);
  assert.throws(() => C.create({ width: 4, rule: rules.rule30(), neighborhood: [[1, 0], [-1, 0]] }), /in order/);
});

test('cyclic succession wraps and Brian’s Brain counts firing neighbors only', () => {
  const cyclic = rules.cyclic({ states: 4, threshold: 2 });
  assert.equal(cyclic({ state: 3, neighbors: [0, 1, 0] }), 0);
  assert.equal(cyclic({ state: 3, neighbors: [0, 1, 2] }), 3);
  const brain = rules.briansBrain();
  assert.equal(brain({ state: 0, neighbors: [1, 2, 1, 0] }), 1);
  assert.equal(brain({ state: 0, neighbors: [2, 2, 1, 0] }), 0);
  assert.equal(brain({ state: 0, neighbors: [1, 1, 1, 0] }), 0);
  assert.equal(brain({ state: 1, neighbors: [0, 0] }), 2);
  assert.equal(brain({ state: 2, neighbors: [1, 1] }), 0);
  const grid = C.create({ width: 5, height: 5, rule: brain, initial: ({ x, y }) => Number(y === 2 && (x === 1 || x === 3)) });
  assert.equal(grid.states, 3);
  grid.step();
  assert.equal(grid.get(2, 2), 1);
  grid.step();
  assert.equal(grid.get(2, 2), 2);
  grid.step();
  assert.equal(grid.get(2, 2), 0);
  assert.throws(() => C.create({ width: 4, height: 4, states: 2, rule: brain }), /alphabet/);
});

test('axial hex neighborhoods have six unit-spaced directions and wrap at storage edges', () => {
  const seed = { width: 5, height: 5, initial: ({ x, y }) => Number(x === 2 && y === 2),
    rule: ({ neighbors }) => Number(neighbors.includes(1)) };
  const square = C.create({ ...seed, neighborhood: 'cardinal' });
  const hex = C.create({ ...seed, lattice: 'hex' });
  square.step(); hex.step();
  assert.equal(count(square), 4);
  assert.equal(count(hex), 6);
  const expected = [[3, 2], [3, 1], [2, 1], [1, 2], [1, 3], [2, 3]], center = hex.position(2, 2);
  for (const [x, y] of expected) {
    assert.equal(hex.get(x, y), 1);
    assert(Math.abs(K.V.dist(center, hex.position(x, y)) - 1) < 1e-12);
  }
  const wrapped = C.create({ width: 5, height: 4, lattice: 'hex', boundary: 'wrap',
    initial: ({ x, y }) => Number(x === 0 && y === 3), rule: ({ neighbors }) => neighbors[1] });
  wrapped.step();
  assert.equal(wrapped.get(4, 0), 1);
  assert.throws(() => hex.restore(square.snapshot()), /incompatible/);
});

test('voxel faces, edges, and corners contain 6, 18, and 26 neighbors', () => {
  for (const [neighborhood, size] of [['faces', 6], ['edges', 18], ['corners', 26]]) {
    const grid = C.create({ width: 5, height: 5, depth: 5, neighborhood,
      initial: ({ x, y, z }) => Number(x === 2 && y === 2 && z === 2),
      rule: ({ neighbors }) => Number(neighbors.includes(1)) });
    assert.equal(grid.lattice, 'voxel');
    grid.step();
    assert.equal(count(grid), size);
    assert.equal(grid.get(2, 2, 3), 1);
    assert.equal(grid.get(3, 3, 2), Number(size >= 18));
    assert.equal(grid.get(3, 3, 3), Number(size === 26));
    assert.equal(grid.get(2, 2, 2), 0);
  }
  const wrapped = C.create({ width: 4, height: 3, depth: 5, boundary: 'wrap', neighborhood: [[0, 0, -1]],
    rule: ({ neighbors }) => neighbors[0], initial: ({ z }) => Number(z === 4) });
  wrapped.step();
  assert.equal(wrapped.get(0, 0, 0), 1);
  assert.equal(wrapped.get(0, 0, 4), 0);
});

test('voxel locks, edits, slices, and snapshots use packed XYZ order', () => {
  const grid = C.create({ width: 3, height: 4, depth: 5, rule: ({ z }) => Number(z % 2 === 1) });
  grid.edit([{ x: 1, y: 2, z: 3, state: 0, locked: true }]);
  grid.step();
  const snapshot = grid.snapshot(), slice = grid.slice(3);
  assert.equal(snapshot.cells[3 * 12 + 2 * 3 + 1], 0);
  assert.equal(slice.locked[7], 1);
  assert.equal(slice.cells[7], 0);
  assert.equal(slice.cells[8], 1);
  assert.equal(K.glyphGrid.paint({ mode: 'pixel', tiles: [null, { color: '#ffffff' }] }).raster(slice).h, 4);
  slice.cells.fill(0);
  assert.equal(grid.get(2, 2, 3), 1);
  grid.reset();
  grid.restore(snapshot);
  assert.deepEqual(grid.snapshot(), snapshot);
  assert.throws(() => grid.restore(slice), /incompatible/);
  assert.throws(() => grid.edit([{ x: 2, y: 2, z: 5, state: 1 }]), /edit/);
});

test('reversible blocks alternate their partition and invert wrapped or fixed-edge grids with pins', () => {
  const rotate = C.create({ width: 4, height: 4, rule: rules.blockRotate(), boundary: 'wrap',
    initial: ({ x, y }) => Number(x === 0 && y === 0) });
  rotate.step();
  assert.equal(rotate.get(1, 0), 1);
  rotate.step();
  assert.equal(rotate.get(1, 3), 1);
  rotate.back(2);
  assert.equal(rotate.get(0, 0), 1);
  assert.equal(rotate.tick, 0);

  for (const boundary of ['empty', 'wrap']) {
    const grid = C.create({ width: 8, height: 6, seed: 174, boundary, rule: rules.blockGas(),
      initial: ({ random }) => Number(random() < .45) });
    grid.edit([{ x: 0, y: 0, locked: true }, { x: 4, y: 5, locked: true }]);
    const start = grid.snapshot(), population = count(grid);
    grid.step(17);
    const future = grid.snapshot();
    assert.equal(count(grid), population);
    assert.notDeepEqual(future.cells, start.cells);
    grid.back(17);
    assert.deepEqual(grid.snapshot(), start);
    grid.restore(future);
    grid.back(17);
    assert.deepEqual(grid.snapshot(), start);
    assert.throws(() => grid.back(), /tick zero/);
    assert.deepEqual(grid.snapshot(), start);
  }
});

test('custom block tables must be permutations and incompatible lattice options are rejected', () => {
  const table = Uint8Array.from({ length: 16 }, (_, i) => (i * 5 + 3) % 16), rule = rules.margolus(table);
  for (let i = 0; i < 16; i++) assert.equal(rule.inverse[rule.table[i]], i);
  table.fill(0);
  assert.equal(rule.table[0], 3);
  assert.throws(() => rules.margolus(table), /permutation/);
  assert.throws(() => C.create({ width: 5, height: 6, rule }), /even square/);
  assert.throws(() => C.create({ width: 6, height: 6, lattice: 'hex', rule }), /even square/);
  assert.throws(() => C.create({ width: 4, height: 4, depth: 2, neighborhood: [[-1, 0]] }), /offsets/);
  assert.throws(() => C.create({ width: 4, height: 4, rule: rules.life() }).back(), /reversible/);
  assert.throws(() => rules.elementary(-1), /0–255/);
});
