const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const C = K.curve, axis = [0, 0, 1];
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, actual + ' differs from ' + expected);

test('Koch splits every edge into thirds with a signed equilateral peak', () => {
  const model = C.recursive({ type: 'koch', axis }), first = model.level(1);
  assert.equal(first.segments.length, 4);
  close(first.points[2][0], 0);
  close(first.points[2][1], Math.sqrt(3) / 6);
  for (const { from, to } of first.segments) close(K.V.dist(first.points[from], first.points[to]), 1 / 3);
  const dense = model.level(5);
  close(dense.length, (4 / 3) ** 5);
  assert.equal(dense.segments.length, 4 ** 5);
  assert.equal(first.segments[2].id, 'koch/2');
  assert.equal(first.segments[2].parentId, model.level(0).segments[0].id);
});

test('dragon preserves the expected directed paperfolding turns', () => {
  const model = C.recursive({ type: 'dragon', axis }), curve = model.level(3);
  const directions = curve.points.slice(1).map((p, i) => K.V.sub(p, curve.points[i]));
  const turns = directions.slice(1).map((p, i) => Math.sign(K.V.cross(directions[i], p)[2]));
  assert.deepEqual(turns, [-1, -1, 1, -1, -1, 1, 1]);
  assert.equal(curve.segments.length, 8);
  assert.equal(curve.segments[6].id, 'dragon/1/1/0');
  assert.deepEqual(curve.points[0], [-.5, 0, 0]);
  assert.deepEqual(curve.points.at(-1), [.5, 0, 0]);
  close(curve.length, Math.sqrt(2) ** 3);
});

test('Hilbert and Peano visit each lattice position exactly once over adjacent steps', () => {
  for (const [type, base, max] of [['hilbert', 2, 6], ['peano', 3, 3]]) {
    const model = C.recursive({ type, axis });
    assert.equal(model.maxGeneration, max);
    for (let generation = 1; generation <= max; generation++) {
      const level = model.level(generation), side = base ** generation, count = side ** 2;
      assert.equal(level.points.length, count);
      assert.equal(level.cells.length, count);
      assert.equal(new Set(level.cells.map(cell => cell.grid.join(','))).size, count);
      assert.equal(new Set(level.segments.map(segment => segment.id)).size, count - 1);
      assert.deepEqual(level.points[0], model.level(0).points[0]);
      assert.deepEqual(level.points.at(-1), model.level(0).points.at(-1));
      for (const { from, to } of level.segments) {
        const a = level.cells[from].grid, b = level.cells[to].grid;
        assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
      }
    }
  }
  assert.deepEqual(C.hilbert({ generation: 1, axis }), [
    [-.5, -.5, 0], [-.5, .5, 0], [.5, .5, 0], [.5, -.5, 0]
  ]);
  assert.deepEqual(C.peano({ generation: 1, axis }), [
    [-.5, -.5, 0], [-.5, 0, 0], [-.5, .5, 0],
    [0, .5, 0], [0, 0, 0], [0, -.5, 0],
    [.5, -.5, 0], [.5, 0, 0], [.5, .5, 0]
  ]);
});

test('nested segment addresses and grid bridges retain stable identities in placed frames', () => {
  for (const type of ['koch', 'dragon', 'hilbert', 'peano']) {
    const base = C.recursive({ type, axis }), placed = C.recursive({ type, axis, origin: [2, 5, -3],
      right: [0, 1, 0], scale: 2.5 });
    const source = base.level(2), fine = base.level(3), sibling = placed.level(3);
    assert.deepEqual(fine.segments, sibling.segments);
    assert.deepEqual(fine.cells, sibling.cells);
    const old = new Set(source.segments.map(row => row.id));
    if (fine.cells.length) {
      assert.equal(fine.segments.filter(row => old.has(row.id)).length, old.size);
      const parents = new Set(source.cells.map(row => row.id));
      assert(fine.cells.every(row => parents.has(row.parentId)));
    } else assert(fine.segments.every(row => old.has(row.parentId)));
    assert(Object.isFrozen(sibling.segments[0]));
    assert.strictEqual(placed.level(3), sibling);
  }
});

test('morphs start on the old geometry and finish with the same ordered identities as the new level', () => {
  for (const type of ['koch', 'dragon', 'hilbert', 'peano']) {
    const model = C.recursive({ type, axis, origin: [0, 2, 0], scale: 4 });
    for (let depth = 0; depth < 3; depth++) {
      const level = model.level(depth), next = model.level(depth + 1),
        start = model.morph(depth, 0), end = model.morph(depth, 1), mid = model.morph(depth, .4);
      assert.strictEqual(end.points, next.points);
      assert.strictEqual(mid.segments, next.segments);
      assert.strictEqual(start.segments, end.segments);
      close(C.path(start.points, { closed: false }).length, level.length);
      assert.deepEqual(mid.points[0], level.points[0]);
      assert.deepEqual(mid.points.at(-1), level.points.at(-1));
      assert.equal(mid.points.length, next.points.length);
      for (const point of start.points) close(level.closest(point).distance, 0);
      assert(C.path(mid.points, { closed: false }).length > 0);
    }
  }
});

test('recursive definitions use native curve lookup, snapshots, route followers, and family rails', () => {
  const definition = { type: 'hilbert', generation: 2, scale: 3 }, curve = C.create(definition);
  assert.equal(curve.closed, false);
  assert.equal(curve.sampling.mode, 'recursive');
  assert.strictEqual(C.create(curve), curve);
  assert.deepEqual(C.create(curve.snapshot()).points, curve.points);
  assert.deepEqual(curve.evaluate(-5), curve.points[0]);
  assert.deepEqual(curve.evaluate(10), curve.points.at(-1));
  close(curve.closest(curve.evaluate(.07)).parameter, .07);
  const route = K.anim.route(curve, { speed: 2 });
  assert.deepEqual(route.vehicle(0).p, curve.points[0]);
  const rig = K.cameraRig.compile({ rails: { h: { family: { ...definition, origin: [0, 1, 6] } } },
    shots: { one: { rail: 'h', progress: .45, target: [0, 1, 0] } } });
  assert(rig.sample(0, { base: { target: [0, 1, 0], yaw: 0, pitch: .1, dist: 7, fov: .56 } }).camera.dist > 0);
});

test('invalid generations and morph ranges are rejected with finite native segment budgets', () => {
  assert.throws(() => C.create({ type: 'peano', generation: 4 }), /generation/);
  assert.throws(() => C.create({ type: 'dragon', generation: 1.5 }), /generation/);
  assert.throws(() => C.create({ type: 'hilbert', segments: 200 }), /frame settings/);
  assert.throws(() => C.recursive({ type: 'clothoid' }), /supported type/);
  const model = C.recursive({ type: 'koch' });
  assert.throws(() => model.morph(6, .5), /generation/);
  assert.throws(() => model.morph(3, 1.5), /progress/);
  assert.equal(model.level(6).segments.length, 4096);
  assert.equal(C.create({ type: 'dragon', generation: 12 }).segments.length, 4096);
});
