const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { procedural: { tiles: { hyperbolic }, packing: { apollonian } } } } = require('..').load();
const near = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(...sub(a, b));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const area = p => p.reduce((sum, v, i) =>
  sum + v[0] * p[(i + 1) % p.length][1] - v[1] * p[(i + 1) % p.length][0], 0) / 2;

function arcCenter(a, b) {
  // Orthogonality to the unit circle gives c·a = (1 + |a|²) / 2.
  const u = (1 + dot(a, a)) / 2, v = (1 + dot(b, b)) / 2, d = a[0] * b[1] - a[1] * b[0];
  return [(u * b[1] - v * a[1]) / d, (v * a[0] - u * b[0]) / d];
}

test('seed polygons have the requested vertex angles and orthogonal geodesic arcs', () => {
  for (const [p, q] of [[3, 7], [4, 5], [5, 4], [7, 3], [8, 4]]) {
    const edgeSegments = 12, { tiles: [seed] } = hyperbolic({ p, q, depth: 0, edgeSegments });
    assert.equal(seed.vertices.length, p);
    assert.equal(seed.outline.length, p * edgeSegments);
    const a = seed.vertices[0], b = seed.vertices[1], prev = seed.vertices.at(-1);
    const c = arcCenter(a, b), r = dist(c, a);
    near(dot(c, c) - r * r, 1);
    for (const point of seed.outline.slice(0, edgeSegments + 1)) near(dist(c, point), r);
    const normalAfter = sub(a, c), normalBefore = sub(a, arcCenter(prev, a));
    near(Math.acos(-dot(normalAfter, normalBefore) / (Math.hypot(...normalAfter) * Math.hypot(...normalBefore))),
      2 * Math.PI / q);
  }
});

test('adjacent reflections retain matching curved edges and each disk tile is unique', () => {
  const edgeSegments = 8, p = 5, q = 4;
  const first = hyperbolic({ p, q, depth: 1, edgeSegments });
  assert.equal(first.tiles.length, p + 1);
  const root = first.tiles[0];
  for (const tile of first.tiles.slice(1)) {
    const edge = tile.address[0];
    for (let i = 0; i <= edgeSegments; i++) {
      const point = root.outline[(edge * edgeSegments + i) % root.outline.length];
      assert(tile.outline.some(v => dist(v, point) < 1e-9));
    }
  }
  const deep = hyperbolic({ p, q, depth: 6, edgeSegments });
  assert.equal(new Set(deep.tiles.map(t => t.center.map(v => Math.round(v * 1e8)).join(','))).size, deep.tiles.length);
  const totalArea = deep.tiles.reduce((sum, tile) => {
    assert(area(tile.outline) > 0);
    assert(tile.outline.every(v => Math.hypot(...v) < 1));
    return sum + area(tile.outline);
  }, 0);
  assert(totalArea > 2.9 && totalArea < Math.PI);
  assert.deepEqual(deep.tiles.slice(0, first.tiles.length), first.tiles);
  const capped = hyperbolic({ p, q, depth: 6, edgeSegments, maxTiles: 35 });
  assert(capped.limited);
  assert.deepEqual(capped.tiles, deep.tiles.slice(0, 35));
});

test('disk frame transforms keep normalized topology and prune small rim tiles', () => {
  const settings = { p: 7, q: 3, depth: 5 };
  const a = hyperbolic(settings), b = hyperbolic({ ...settings, center: [3, 5], radius: 2, rotation: Math.PI / 2 });
  assert.deepEqual(a.tiles.map(t => t.id), b.tiles.map(t => t.id));
  for (const [i, { center: [u, v] }] of a.tiles.entries()) {
    near(b.tiles[i].center[0], 3 - 2 * v);
    near(b.tiles[i].center[1], 5 + 2 * u);
  }
  assert(hyperbolic({ ...settings, minEdge: .03 }).tiles.length < a.tiles.length);
  assert(Object.isFrozen(a.tiles[0].outline[0]));
  assert.throws(() => hyperbolic({ p: 4, q: 4 }), /hyperbolic/);
  assert.throws(() => hyperbolic({ maxTiles: 17000 }), /budget/);
});

test('Apollonian recursion creates the Descartes circles with exact parent tangencies', () => {
  const seeds = [{ center: [-.5, 0], radius: .5 }, { center: [.5, 0], radius: .5 },
    { center: [0, 2 / 3], radius: 1 / 3 }];
  for (const settings of [{}, { seeds }]) {
    const { boundary, circles } = apollonian({ ...settings, depth: 4, minRadius: 1e-5 });
    assert.equal(circles.length, 3 + 4 + 12 + 36 + 108);
    const known = new Map([[boundary.id, boundary]]);
    for (const [i, circle] of circles.entries()) {
      assert(Math.hypot(...circle.center) + circle.radius <= 1 + 1e-9);
      if (circle.depth) assert.equal(circle.parents.length, 3);
      for (const id of circle.parents) {
        const other = known.get(id);
        near(dist(other.center, circle.center), id === boundary.id ? other.radius - circle.radius : other.radius + circle.radius);
      }
      for (let j = 0; j < i; j++)
        assert(dist(circle.center, circles[j].center) >= circle.radius + circles[j].radius - 1e-9);
      assert(!known.has(circle.id));
      known.set(circle.id, circle);
    }
    if (settings.seeds) {
      near(known.get('gap:0').radius, 1 / 15);
      near(known.get('gap:0').center[1], 4 / 15);
    }
  }
});

test('packing exposes bounded deterministic prefixes, normalized cutoffs, and custom frame', () => {
  const normal = apollonian({ depth: 5, minRadius: .01 });
  assert(normal.circles.every(c => c.radius >= .01));
  const moved = apollonian({ depth: 5, minRadius: .01, center: [4, -1], radius: 2, rotation: Math.PI / 2 });
  assert.deepEqual(normal.circles.map(c => c.id), moved.circles.map(c => c.id));
  for (const [i, circle] of normal.circles.entries()) {
    near(moved.circles[i].center[0], 4 - 2 * circle.center[1]);
    near(moved.circles[i].center[1], -1 + 2 * circle.center[0]);
    near(moved.circles[i].radius, 2 * circle.radius);
  }
  const limited = apollonian({ depth: 5, minRadius: .01, maxCircles: 16 });
  assert(limited.limited);
  assert.deepEqual(limited.circles, normal.circles.slice(0, 16));
  assert.equal(apollonian({ depth: 0 }).circles.length, 3);
  assert.throws(() => apollonian({ seeds: [] }), /seed circles/);
  assert.throws(() => apollonian({ seeds: Array.from({ length: 3 }, () => ({ center: [0, .6], radius: .4 })) }), /mutually tangent/);
});
