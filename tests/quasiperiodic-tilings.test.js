const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { procedural: { tiles: { quasiperiodic } } } } = require('..').load();
const near = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const side = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const area = p => p.slice(2).reduce((total, v, i) => total + side(p[0], p[i + 1], v), 0) / 2;
const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const heading = (a, b, c) => {
  const dot = (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]);
  return Math.acos(dot / (length(a, b) * length(c, b)));
};
const spec = {
  penrose: { depth: 5, order: 5, factor: (1 + Math.sqrt(5)) / 2, counts: [10, 20, 50, 130, 340, 890] },
  ammannBeenker: { depth: 3, order: 8, factor: 1 + Math.SQRT2, counts: [8, 56, 328, 1912] }
};

function edges(layout) {
  const all = new Map();
  for (const { polygon } of layout.tiles) for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length];
    const forward = a.join(',') < b.join(','), key = (forward ? [a, b] : [b, a]).join('|');
    if (!all.has(key)) all.set(key, { a, b, count: 0, winding: 0 });
    all.get(key).count++;
    all.get(key).winding += forward ? 1 : -1;
  }
  return [...all.values()];
}
function onSegment(a, b, p) {
  return Math.abs(side(a, b, p)) < 1e-9 &&
    p.every((v, i) => v >= Math.min(a[i], b[i]) - 1e-9 && v <= Math.max(a[i], b[i]) + 1e-9);
}

test('both substitutions partition their seed patches without internal gaps or unmatched edges', () => {
  for (const [family, { depth, order, factor, counts }] of Object.entries(spec)) {
    const original = quasiperiodic({ family, depth: 0 });
    const outline = edges(original).filter(edge => edge.count === 1);
    const originalArea = original.tiles.reduce((sum, tile) => sum + area(tile.polygon), 0);
    for (let i = 0; i <= depth; i++) {
      const layout = quasiperiodic({ family, depth: i });
      assert.equal(layout.work.pieces, counts[i]);
      assert.equal(layout.work.visited, counts.slice(0, i + 1).reduce((a, b) => a + b, 0));
      assert.equal(layout.order, order);
      near(layout.factor, factor);
      near(layout.tiles.reduce((sum, tile) => sum + area(tile.polygon), 0), originalArea);
      for (const edge of edges(layout)) {
        if (edge.count === 2) assert.equal(edge.winding, 0);
        else {
          assert.equal(edge.count, 1);
          assert(outline.some(({ a, b }) => onSegment(a, b, edge.a) && onSegment(a, b, edge.b)),
            'unmatched interior edge in ' + family);
        }
      }
    }
  }
});

test('whole plates have the specified interior angles, edge size and rotational symmetry', () => {
  for (const [family, { depth, order, factor }] of Object.entries(spec)) {
    const { tiles } = quasiperiodic({ family, depth });
    const angles = { thinRhomb: 36, thickRhomb: 72, rhomb: 45, square: 90 };
    const baseEdge = family === 'penrose' ? 1 : 1 / (2 * Math.cos(Math.PI / 8));
    const step = 2 * Math.PI / order, cardinal = new Map();
    const key = (type, vertices) => type + ':' + vertices.map(p => p.map(v => Math.round(v * 1e8)).join(',')).sort().join('.');
    for (const { type, polygon, partial } of tiles) {
      cardinal.set(key(type, polygon), true);
      assert(area(polygon) > 0);
      if (partial) continue;
      assert.equal(polygon.length, 4);
      for (const [i, p] of polygon.entries()) near(length(p, polygon[(i + 1) % 4]), baseEdge / factor ** depth);
      const a = heading(polygon[0], polygon[1], polygon[2]);
      near(Math.min(a, Math.PI - a) * 180 / Math.PI, angles[type], 1e-7);
    }
    for (const { type, polygon } of tiles) {
      const spun = polygon.map(([x, y]) => [x * Math.cos(step) - y * Math.sin(step), x * Math.sin(step) + y * Math.cos(step)]);
      assert(cardinal.has(key(type, spun)), 'rotation failed for ' + family + ' ' + type);
    }
  }
});

test('cropping keeps assembled IDs and finer pieces retain their substitution ancestry', () => {
  const boundary = [[-.27, -.24], [.27, -.24], [.27, .24], [-.27, .24]];
  for (const [family, { depth }] of Object.entries(spec)) {
    const full = quasiperiodic({ family, depth }), cropped = quasiperiodic({ family, depth, boundary });
    const ids = new Map(full.tiles.map(tile => [tile.id, tile]));
    assert.equal(ids.size, full.tiles.length);
    const seed = quasiperiodic({ family, depth: depth - 1 });
    near(cropped.tiles.reduce((sum, tile) => sum + area(tile.polygon), 0), .54 * .48);
    for (const tile of cropped.tiles) {
      assert.equal(tile.partial, false);
      assert.deepEqual(tile.addresses, ids.get(tile.id).addresses);
      assert.equal(tile.type, ids.get(tile.id).type);
      for (const address of tile.addresses) {
        const ancestor = address.slice(0, -1), raw = full.at(address);
        assert.deepEqual(full.at(ancestor), seed.at(ancestor));
        for (const p of raw.polygon)
          assert(tile.polygon.length >= 3 && seed.at(ancestor).polygon.every((a, i, points) =>
            side(a, points[(i + 1) % points.length], p) > -1e-9));
      }
    }
    assert(Object.isFrozen(cropped.tiles[0].addresses[0]));
  }
});

test('origin, rotation, and scale affect only spatial coordinates and work limits fail clearly', () => {
  for (const family of Object.keys(spec)) {
    const a = quasiperiodic({ family, depth: 2 });
    const b = quasiperiodic({ family, depth: 2, center: [5, -3], rotation: Math.PI / 2, radius: 4 });
    assert.deepEqual(a.tiles.map(t => t.id), b.tiles.map(t => t.id));
    for (const [i, tile] of a.tiles.entries()) for (const [j, [x, y]] of tile.polygon.entries()) {
      near(b.tiles[i].polygon[j][0], 5 - 4 * y);
      near(b.tiles[i].polygon[j][1], -3 + 4 * x);
    }
    assert.throws(() => quasiperiodic({ family, depth: 5, maxPieces: 15 }), /piece budget/);
    assert.throws(() => a.at([9, 8]), /does not name/);
  }
  assert.throws(() => quasiperiodic({ family: 'unknown' }), /family/);
  assert.throws(() => quasiperiodic({ radius: 0 }), /frame/);
});
