const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..'), kit = ink.load();
const runWebGL = require('../cli/look-webgl.js');
const { graph, pixelEffects } = kit.KIT.procedural;
const raster = (width, height, data) => ({ width, height, channels: 1, data });
const rgba = (image, x, y = 0) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const colors = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ff0000'];

test('flat cycling keeps fixed indices, alpha, duplicate swatches and uncoupled cycle clocks', () => {
  const original = [1, 4, 7, 0, -1];
  const source = { ...raster(5, 1, Int16Array.from(original)), pivot: [1.5, .5] };
  const alpha = raster(5, 1, [255, 96, 255, 64, 255]);
  const cycles = {
    forward: { range: [1, 3], period: 3 },
    reverse: { slots: [4, 5, 6], period: 6, direction: 'reverse', phase: .5 }
  };
  const at = time => pixelEffects.paletteCycle(source, colors, { cycles, alpha, time });
  const start = at(0), next = at(1), earlier = at(-1);
  assert.deepEqual(rgba(start.value, 0), [255, 0, 0, 255]);
  assert.deepEqual(rgba(next.value, 0), [0, 255, 0, 255]);
  assert.deepEqual(rgba(earlier.value, 0), [0, 0, 255, 255]);
  assert.deepEqual(rgba(start.value, 1), [255, 0, 255, 96]);
  assert.deepEqual(rgba(next.value, 1), [0, 255, 255, 96]);
  assert.deepEqual(rgba(next.value, 2), [255, 0, 0, 255]);
  assert.deepEqual(rgba(next.value, 3), [255, 255, 255, 64]);
  assert.deepEqual(rgba(next.value, 4), [0, 0, 0, 0]);
  assert.deepEqual(next.palette, ['#ffffff', '#00ff00', '#0000ff', '#ff0000', '#00ffff', '#ff00ff', '#ffff00', '#ff0000']);
  assert.deepEqual([...next.indices.data], original);
  assert.deepEqual(next.indices.pivot, source.pivot);
  assert.deepEqual(next.value.pivot, source.pivot);
  assert.deepEqual(at(7), next);
  next.indices.data.fill(0);
  assert.deepEqual([...source.data], original);
  assert.deepEqual([...at(1).indices.data], original);
});

test('the graph uses its clock and returns a reusable palette and unchanged indices', () => {
  const session = graph.create({ inputs: { source: 'raster', alpha: 'raster', palette: 'palette' }, nodes: {
    cycle: { op: 'fx.paletteCycle', inputs: { source: { input: 'source' }, alpha: { input: 'alpha' },
      palette: { input: 'palette' }, cycles: { glow: { role: 'lights', period: .1 } } } }
  }, outputs: Object.fromEntries(['value', 'indices', 'palette'].map(port => [port, { node: 'cycle', port }])) });
  const at = time => session.evaluate({ source: raster(1, 1, [1]), alpha: raster(1, 1, [123]),
    palette: { palette: colors, roles: { lights: [1, 3, 2] } } }, { time }).outputs;
  const later = at(.05);
  assert.deepEqual(rgba(later.value, 0), [0, 0, 255, 123]);
  assert.deepEqual(later.indices.data, Int16Array.of(1));
  assert.equal(later.palette[1], '#0000ff');
  assert.deepEqual(at(.3), at(0));
  assert.deepEqual(at(.05), later);
  const run = cycles => pixelEffects.paletteCycle(raster(1, 1, [1]), colors, { cycles });
  assert.throws(() => run({ one: { range: [1, 3], period: 1 }, two: { slots: [3, 4], period: 2 } }), /cannot share/);
  assert.throws(() => run({ bad: { range: [1, 9], period: 1 } }), /out of range/);
  assert.throws(() => run({ bad: { slots: [1, 2], range: [1, 2], period: 1 } }), /needs one/);
  assert.throws(() => run({ bad: { range: [3, 1], period: 1 } }), /increasing range/);
});

function fixture({ makeBuilder, KIT }) {
  const width = 6, height = 4;
  const world = makeBuilder(10, [0x192a3c]).finish();
  const inputs = { plate: { width, height, channels: 1, data: Uint8Array.from({ length: width * height }, (_, i) => i % width) } };
  const pass = {
    id: 'cycled', type: 'rasterSchedule', indices: { slot: 'plate' },
    palette: ['#152439', '#ff0000', '#00ff00', '#0000ff', '#ffcc77', '#96d5c9'],
    cycles: { flow: { range: [1, 3], period: 3 }, tail: { slots: [4, 5], period: 1, direction: 'reverse', phase: .5 } },
    schedule: [{ row: 1, palette: [[1, '#f99d58']] }, { row: 2, pixelScale: [1, 2], offset: [1, 0] }], wrap: true
  };
  return { world, width, height, inputs, pass, renderGraph: KIT.renderGraph.create({ passes: [pass] }) };
}

test('the Copper pass cycles its starting palette and then holds authored row overrides across the frame', () => {
  const { world, width, height, pass, inputs, renderGraph } = fixture(kit);
  const draw = t => ink.render(world, { w: width, h: height, px: 1, t, raw: true, renderGraph,
    renderGraphInputs: inputs, renderGraphCapture: ['cycled'] }).renderGraphPasses.cycled;
  const start = draw(0), later = draw(1), earlier = draw(-1);
  assert.deepEqual(rgba(start, 1), [255, 0, 0, 255]);
  assert.deepEqual(rgba(later, 1), [0, 255, 0, 255]);
  assert.deepEqual(rgba(earlier, 1), [0, 0, 255, 255]);
  assert.deepEqual(rgba(later, 1, 1), [249, 157, 88, 255]);
  assert.deepEqual(rgba(later, 0, 3), [249, 157, 88, 255]);
  assert.deepEqual(draw(3).data, start.data);
  const { palette, cycles, schedule, wrap } = pass;
  assert.deepEqual(pixelEffects.rasterSchedule(inputs.plate, { palette, cycles, schedule, wrap, time: 1 }).data, later.data);
});

test('WebGL samples the same cycling palette and row overrides as the headless render graph', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const times = [0, .5, 1, -1, 3];
  const actual = runWebGL({}, fixture, (kit, build, backend, times) => {
    const { world, width, height, inputs, renderGraph } = build(kit);
    const draw = backend(width, height, { raw: true, offscreen: true });
    try {
      return { values: times.map(time => Array.from(draw.draw(world, { time, renderGraph, renderGraphInputs: inputs,
        renderGraphCapture: ['cycled'] }).cycled.data)) };
    } finally { draw.close(); }
  }, times);
  const { world, width, height, inputs, renderGraph } = fixture(kit);
  const expected = times.map(t => Array.from(ink.render(world, { w: width, h: height, px: 1, t, raw: true, renderGraph,
    renderGraphInputs: inputs, renderGraphCapture: ['cycled'] }).renderGraphPasses.cycled.data));
  assert.deepEqual(actual.values, expected);
});
