const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const P = Ink.load().KIT.procedural;
const A = P.sceneGraph;
const { graph } = require('../examples/sdf-functions/moonlock.cjs');

const ref = (node, port = 'value') => ({ node, port });
const node = (op, inputs) => ({ op, inputs });
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);
const labels = (values, table) => new Set(Array.from(values, value => table[value]));

test('primitive sockets, rotated bounds and scaled distance work within declared functions', () => {
  const fn = {
    result: 'field',
    inputs: { radius: 'number' },
    nodes: {
      cylinder: node('sdf.primitive', { kind: 'cylinder', radius: { input: 'radius' }, length: 2 }),
      rotate: node('sdf.transform', { source: ref('cylinder'), position: [4, 3, 0],
        rotation: [0, 0, Math.PI / 2], scale: [2, 2, 2] })
    },
    outputs: { result: ref('rotate') }
  };
  const group = P.graph.group(fn);
  assert.equal(group.outputs.result.type, 'field');
  const runner = P.graph.create({
    nodes: {
      shape: node('makeShape', { radius: .5 }),
      bounds: node('sdf.bounds', { source: ref('shape', 'result') }),
      point: node('sdf.sample', { source: ref('shape', 'result'), position: [6.3, 4.4, 0] })
    },
    outputs: { center: ref('bounds', 'center'), size: ref('bounds'), value: ref('point') }
  }, { groups: { makeShape: group } });
  const { center, size, value } = runner.evaluate().outputs;
  assert.deepEqual(center, [4, 3, 0]);
  near(size[0], 4.008);
  near(size[1], 2.004);
  near(value, .5);
  assert.throws(() => P.graph.create({
    nodes: { shape: node('sdf.primitive', { kind: 'sphere', length: 1 }) }, outputs: { value: ref('shape') }
  }), /Unknown socket shape.length/);
});

test('finite off-center repeats, mirrors, and subtraction preserve deterministic ownership', () => {
  const red = [1, .1, 0], blue = [0, .2, 1];
  const ball = A.tagSDF(A.shape('sphere', { radius: .4, center: [1.2, 0, 0] }),
    { objectId: 'body', materialId: 'red', color: red });
  const copies = A.repeatSDF(ball, { count: [3, 1, 1], spacing: [1, 1, 1], center: [0, 0, 0], idPrefix: 'ball' });
  near(copies(.2, 0, 0), -.4);
  near(copies(1.2, 0, 0), -.4);
  assert.equal(A.sdfTags(copies)(2.2, 0, 0).objectId, 'ball/2/0/0');
  const mirrored = A.symmetrySDF(copies, { axis: 'x', plane: -.3 });
  near(mirrored(-1.8, 0, 0), -.4);
  assert.deepEqual(A.sdfTags(mirrored)(-1.8, 0, 0), { objectId: 'ball/1/0/0', materialId: 'red', color: red });

  const tool = A.tagSDF(A.shape('sphere', { radius: .25, center: [1.4, 0, 0] }),
    { objectId: 'tool', materialId: 'blue', color: blue });
  const cut = A.combineSDF([ball, tool], { operation: 'subtract' });
  near(cut(1.15, 0, 0), 0);
  assert.deepEqual(A.sdfTags(cut)(1.15, 0, 0), { objectId: 'body', materialId: 'blue', color: blue });
  assert.deepEqual(A.sdfTags(cut)(.8, 0, 0), { objectId: 'body', materialId: 'red', color: red });
  assert.deepEqual(A.sdfTags(A.tagSDF(cut, { objectId: 'master' }))(1.15, 0, 0),
    { objectId: 'master', materialId: 'blue', color: blue });
  const empty = A.combineSDF([ball, A.shape('sphere', { radius: .2, center: [-4, 0, 0] })], { operation: 'intersection' });
  assert(empty(0, 0, 0) > 0);
  assert.throws(() => A.repeatSDF(ball, { count: [32, 32, 1], spacing: [1, 1, 1], center: [0, 0, 0] }), /256 copies/);
});

test('saved material sends one field to the renderer, pigment scatter and the ID slice stack', () => {
  const material = JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph(), { id: 'sdf-functions-test' })));
  const runner = Ink.createGraphProject(material);
  const { outputs: first } = runner.run();
  const { passes } = first.frame;
  assert(labels(passes.objectId, passes.objects).has('waxingMoon'));
  assert(labels(passes.materialId, passes.materials).has('cut'));
  assert(labels(first.scatterMaterials.raster.data, first.scatterLayout.materials).has('gold'));
  assert(first.sliceMaterials.some(layer => labels(layer.data, first.sliceLayout.materials).has('gem')));
  assert(first.tile.data.some((n, i) => i % 4 === 3 && n === 255));
  assert.equal(runner.describeSubgraph({ node: 'lock' }).outputs.result.type, 'field');

  const { outputs: turned } = runner.run({ inputs: { yaw: 120 } });
  assert.notDeepEqual(turned.orbit.data, first.orbit.data);
  assert.deepEqual(turned.frame.passes.materials, passes.materials);
  assert.deepEqual(turned.tile.data, first.tile.data);
  assert.deepEqual(turned.slices, first.slices);
  const { outputs: edited } = runner.run({ inputs: { cut: .5, rivets: 1 } });
  assert.notDeepEqual(edited.orbit.data, first.orbit.data);
  assert.notDeepEqual(edited.tile.data, first.tile.data);
  assert.notDeepEqual(edited.slices, first.slices);
  assert(edited.frame.passes.objects.includes('fastener/0/0/0'));
  assert(!edited.frame.passes.objects.includes('fastener/1/0/0'));
});

test('typed field arguments and point queries in a reusable group read the current time', () => {
  const source = A.boundSDF({ sample(x, y, z, time) { return Math.hypot(x, y, z) - time; } },
    { min: [-4, -4, -4], max: [4, 4, 4] });
  const fn = P.graph.group({
    result: 'number', inputs: { source: 'field' },
    nodes: { at: node('sdf.sample', { source: { input: 'source' }, position: [1, 0, 0] }) },
    outputs: { result: ref('at') }
  });
  const graph = P.graph.create({
    inputs: { field: 'field' }, nodes: { test: node('sampleField', { source: { input: 'field' } }) },
    outputs: { value: ref('test', 'result') }
  }, { groups: { sampleField: fn } });
  assert.equal(graph.evaluate({ field: source }, { time: .25 }).outputs.value, .75);
  assert.equal(graph.evaluate({ field: source }, { time: 1.25 }).outputs.value, -.25);
  assert.throws(() => P.graph.group({
    result: 'field', inputs: { source: 'field' }, outputs: { result: { input: 'source' } },
    nodes: { render: node('sdf.render', { source: { input: 'source' } }) }
  }), /pure value operation/);
});
