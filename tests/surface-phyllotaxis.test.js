const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, TexturedSurface } = require('..').load();
const { sphere, surface, goldenAngle } = K.procedural.sampling.phyllotaxis;
const { V } = K;
const near = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);

function checkFrame(sample) {
  const { normal, tangent, bitangent } = sample;
  for (const direction of [normal, tangent, bitangent]) near(V.len(direction), 1);
  near(V.dot(normal, tangent), 0);
  near(V.dist(V.cross(normal, tangent), bitangent), 0);
}

test('sphere grows pole to pole along an exact golden angle with stable IDs and frames', () => {
  const capacity = 233, center = [2, 3, -4], radius = 2, axis = [2, 1, -.5];
  const layout = sphere({ capacity, center, radius, axis, phase: -.62 });
  const prefix = layout.points(45), full = layout.points();
  assert.deepEqual(layout.points(0), []);
  assert.deepEqual(full.slice(0, prefix.length), prefix);
  assert.deepEqual(layout.at(9), prefix[9]);
  near(layout.area, 4 * Math.PI * radius ** 2);
  for (const [i, point] of full.entries()) {
    assert.equal(point.id, i);
    near(V.dist(point.point, center), radius);
    near(V.dot(point.normal, V.norm(axis)), 1 - 2 * (i + .5) / capacity);
    const next = full[i + 1];
    if (next) near(((next.uv[0] - point.uv[0] + 1) % 1) * 2 * Math.PI, goldenAngle);
    checkFrame(point);
    near(point.spacing, Math.sqrt(layout.area / capacity));
  }
  assert(Object.isFrozen(prefix[0].uv));
  assert(Object.isFrozen(full));
});

test('sphere density controls points per unit area and the local spacing estimate', () => {
  const weighted = sphere({ capacity: 120, density: ({ uv: [, v] }) => v < .5 ? 3 : 1 });
  const points = weighted.points();
  assert.equal(points.filter(s => s.uv[1] < .5).length, 90);
  near(points.at(-1).spacing / points[0].spacing, Math.sqrt(3));
  const mask = sphere({ capacity: 127, phase: 0, density: ({ uv: [u] }) => u >= .5 ? 1 : 0 });
  assert(mask.points().every(p => p.uv[0] >= .5));
});

test('chart sampling compensates for a stretched parameterization', () => {
  const chart = (u, v) => [4 * u, 0, 2 * v ** 3];
  const layout = surface(chart, { capacity: 256, resolution: [16, 64] });
  near(layout.area, 8);
  const points = layout.points();
  assert.equal(points.filter(p => p.point[2] < 1).length, 128);
  assert(points.filter(p => p.uv[1] < .5).length < 40);
  for (const point of points) {
    near(point.point[1], 0);
    near(V.dot(point.normal, [0, -1, 0]), 1);
    checkFrame(point);
  }
});

test('a wrapped textured chart preserves sampled normals and supports density varying across both axes', () => {
  const chart = TexturedSurface.grid({ segments: [48, 12],
    point: (u, v) => [Math.cos(2 * Math.PI * u) * (1 + v), v, Math.sin(2 * Math.PI * u) * (1 + v)] });
  const layout = surface(chart, { wrapU: true, capacity: 144, resolution: [48, 12],
    density: ({ uv: [u, v] }) => u < .25 || v > .75 ? 0 : 1 + v });
  near(layout.area, 3 * Math.PI * Math.SQRT2, .07);
  const points = layout.points();
  assert.deepEqual(layout.points(30), points.slice(0, 30));
  for (const point of points) {
    assert(point.uv[0] >= .25 && point.uv[1] <= .75);
    const actual = chart.sample(...point.uv);
    assert.deepEqual(point.point, actual.point);
    near(V.dot(actual.normal, point.normal), 1);
    checkFrame(point);
  }
});

test('invalid or nonrenderable surfaces and out-of-range sample queries fail clearly', () => {
  assert.throws(() => sphere({ capacity: 100, axis: [0, 0, 0] }), /nonzero axis/);
  assert.throws(() => sphere({ capacity: 0 }), /capacity/);
  assert.throws(() => sphere({ capacity: 5, density: () => -1 }), /density/);
  assert.throws(() => surface((u, v) => [u, v, 0], { capacity: 5, density: () => 0 }), /positive weighted area/);
  assert.throws(() => surface(() => [0, 0, 0], { capacity: 5 }), /positive weighted area/);
  assert.throws(() => surface(() => [0, 0, Infinity], { capacity: 5 }), /finite XYZ/);
  const layout = sphere({ capacity: 5 });
  assert.throws(() => layout.at(5), /point ID/);
  assert.throws(() => layout.points(6), /visible count/);
});
