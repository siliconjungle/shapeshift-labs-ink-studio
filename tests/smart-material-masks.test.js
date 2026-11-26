const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');

const kit = Ink.load();
const P = kit.KIT.procedural;
const { graphImages: I, smartMasks: S } = P;
function image(data, width, { intent = 'mask', channels = 1, ...settings } = {}) {
  return I.declare({ width, height: data.length / (width * channels), channels, data }, { intent, ...settings });
}
const gray = (values, width = values.length) => image(values, width);
const output = result => [...result.value.raster.data];
const approximate = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < 1e-6, value + ' at ' + i));
};

test('wear, dirt, rust and exposure use their bake evidence and preserve protected texels', () => {
  const coverage = gray([1, 1, .5, 0]);
  const bakes = { coverage, convex: gray([1, .1, .9, 1]), cavity: gray([.05, .9, .7, 1]),
    ao: gray([.98, .25, .6, 0]), metalness: gray([0, 1, 0, 1]), exposure: gray([1, 0, .65, 1]),
    validity: gray([1, 1, .5, 1]) };
  const { value, raw, evidence, report } = S.evaluate('edgeWear', bakes, {}, gray([0, .8, 0, 1]), gray([1, 0, .4, 0]));
  approximate([...raw.raster.data], [1, 0, .25, 0]);
  approximate([...value.raster.data], [0, .8, .15, 0]);
  approximate([...evidence.raster.data], [1, .045, .1816875, 0]);
  assert.deepEqual(report.inputs, ['add', 'convex', 'coverage', 'exposure', 'remove', 'validity']);
  assert.deepEqual(output(S.evaluate('dirt', bakes)), [0, 1, .25, 0]);
  assert.deepEqual(output(S.evaluate('rust', bakes)), [0, 1, 0, 0]);
  assert.deepEqual(output(S.evaluate('exposure', bakes)), [1, 0, .25, 0]);
  assert(output(S.evaluate('rust', { ...bakes, susceptibility: gray([1, 0, 1, 0]) }))[2] > 0);
  assert.equal(output(S.evaluate('rust', bakes, { threshold: 0 }))[0], 0);
});

test('dust and slope read signed and unsigned world normals across the angle range', () => {
  const coverage = gray([1, 1, 1, 0]);
  const normal = image([0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0], 4,
    { intent: 'normal', channels: 3, normalSpace: 'world' });
  const unsigned = image(Uint16Array.from(normal.raster.data, n => Math.round((n + 1) * 32767.5)), 4,
    { intent: 'normal', channels: 3, normalSpace: 'world' });
  assert.deepEqual(output(S.evaluate('dust', { coverage, normal })), [1, 0, 0, 0]);
  assert.deepEqual(output(S.evaluate('dust', { coverage, normal: unsigned })), [1, 0, 0, 0]);
  assert.deepEqual(output(S.evaluate('slope', { coverage, normal })), [0, 1, 0, 0]);
  assert.deepEqual(output(S.evaluate('slope', { coverage, normal }, { minAngle: 90, maxAngle: 180, feather: 0 })), [0, 1, 1, 0]);
  assert.deepEqual(output(S.evaluate('dust', { coverage, normal }, { up: [0, 0, 2] })), [0, 1, 0, 0]);
});

test('leaks follow world downhill along rotated UVs and stop at gaps or part changes', () => {
  const width = 6;
  // World height decreases across U, while the second UV row belongs to a detached part.
  const points = Array.from({ length: width * 2 }, (_, i) => [0, -i % width, i < width ? 0 : .3]).flat();
  points[4 * 3 + 1] = -12;
  points[5 * 3 + 1] = -13;
  const bakes = {
    coverage: gray(Array(width * 2).fill(1), width),
    source: gray([1, ...Array(width * 2 - 1).fill(0)], width),
    position: image(points, width, { intent: 'data', channels: 3, units: 'shape-units' }),
    partId: image(Array.from({ length: width * 2 }, (_, i) => i === 3 || i >= width ? 2 : 1),
      width, { intent: 'data', units: 'id' })
  };
  const runoff = S.evaluate('leaks', bakes, { length: 4, maxGap: 1.5 });
  approximate(output(runoff), [1, .75, .5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(runoff.report.positionUnits, 'shape-units');
  assert.equal(runoff.report.maxGap, 1.5);
  const withoutParts = { ...bakes };
  delete withoutParts.partId;
  approximate(output(S.evaluate('leaks', withoutParts, { length: 4, maxGap: 1.5 })).slice(0, 6), [1, .75, .5, .25, 0, 0]);
  assert.deepEqual(output(S.evaluate('leaks', bakes, { up: [0, -1, 0] })), [1, ...Array(11).fill(0)]);
});

test('waterline uses physical signed height and deterministic breakup respects coverage', () => {
  const coverage = gray([1, 1, 1, 1, 0]);
  const position = image([0, -.8, 0, .4, -.2, 0, .5, 0, 0, .82, .18, 0, 1, 0, 0], 5,
    { intent: 'data', channels: 3, units: 'shape-units' });
  const band = S.evaluate('waterline', { coverage, position }, { width: .22 });
  assert.equal(band.value.raster.data[2], 1);
  assert.equal(band.value.raster.data[0], 0);
  assert.equal(band.value.raster.data[4], 0);
  assert(band.value.raster.data[3] > band.value.raster.data[1]);
  const below = { side: 'below', width: .2, breakup: .6 };
  const seed = n => output(S.evaluate('waterline', { coverage, position }, { ...below, seed: n }));
  assert.deepEqual(seed(81), seed(81));
  assert.notDeepEqual(seed(81), seed(82));
});

test('saved graphs expose three grayscale stages and report invalid bake contracts precisely', () => {
  const project = { format: 'ink-studio/graph-project', version: 1,
    inputs: { baked: 'record' },
    nodes: { mask: { op: 'material.smartMask', inputs: { recipe: 'edgeWear', bakes: { input: 'baked' } } } },
    outputs: Object.fromEntries(['value', 'raw', 'evidence', 'report'].map(port => [port, { node: 'mask', port }]))
  };
  const graph = Ink.createGraphProject(Ink.openMaterialGraph(project, { id: 'smart-masks-test' }), { kit });
  const coverage = gray([1, 0]), convex = image([35, 70], 2, { intent: 'data', units: 'inverse-shape-units' });
  assert.equal(graph.plan().outputs.raw.type, 'grayImage');
  assert.deepEqual(output(graph.run({ inputs: { baked: { coverage, convex } } }).outputs), [1, 0]);
  assert.throws(() => S.evaluate('dirt', { coverage }), /needs cavity or concave/);
  assert.throws(() => S.evaluate('edgeWear', { coverage, convex: gray([1]) }), /aligned typed image/);
  assert.throws(() => S.evaluate('edgeWear', { convex, coverage: null }), /coverage needs an aligned/);
  assert.throws(() => S.evaluate('rust', { coverage, cavity: gray([0, 0]) }), /needs susceptibility or metalness/);
  assert.throws(() => S.evaluate('edgeWear', { coverage, convex }, { maxGap: 2 }), /Invalid edgeWear option maxGap/);
  const tangent = image([0, 1, 0, 0, 1, 0], 2, { intent: 'normal', channels: 3, normalSpace: 'tangent' });
  assert.throws(() => S.evaluate('dust', { coverage, normal: tangent }), /encoding for smart mask normal/);
});
