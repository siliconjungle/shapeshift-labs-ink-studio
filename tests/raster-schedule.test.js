const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load(), P = kit.KIT.procedural;
const raster = (width, height, channels, data) => ({ width, height, channels, data });
const rgba = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];

test('palette slots stay distinct, and only a pixel size write re-anchors the sample grid', () => {
  const source = raster(4, 5, 1, [
    0, 1, 2, 0,
    0, 1, 2, 1,
    2, 2, 0, 1,
    1, 1, 2, 2,
    1, 2, 0, 1
  ]);
  const value = P.pixelEffects.rasterSchedule(source, {
    palette: ['#ff0000', '#ff0000', '#00ff00'], schedule: [
      { row: 1, pixelScale: [2, 2], palette: [[1, '#00ff00']] },
      { row: 2, palette: [[0, '#0000ff']] },
      { row: 3, offset: [1, -1] },
      { row: 4, pixelScale: [1, 1], offset: [0, 0] }
    ]
  });
  assert.deepEqual(rgba(value, 1, 0), red);
  assert.deepEqual(rgba(value, 1, 1), red);
  // Row two still samples from row one after a palette-only write.
  assert.deepEqual(rgba(value, 0, 2), blue);
  assert.deepEqual(rgba(value, 3, 2), green);
  assert.deepEqual(rgba(value, 3, 3), green);
  assert.deepEqual(rgba(value, 1, 4), green);
  assert.deepEqual(rgba(value, 2, 4), blue);
});

test('offsets apply on authored output rows, with alpha, wrapping and independent source grids', () => {
  const source = raster(2, 2, 2, [1, 128, -1, 200, 0, 255, 1, 255]);
  const options = { width: 4, height: 4, palette: ['#ff0000', '#0000ff80'],
    schedule: [{ row: 1, offset: [-1, 0] }, { row: 2, offset: [0, 1] }, { row: 4, palette: [[0, '#ffaa00']] }] };
  const read = P.pixelEffects.rasterSchedule;
  const value = read(source, options);
  assert.deepEqual(rgba(value, 0, 0), [0, 0, 255, 64]);
  assert.deepEqual(rgba(value, 3, 0), clear);
  assert.deepEqual(rgba(value, 0, 1), clear);
  assert.deepEqual(rgba(value, 0, 2), red);
  assert.deepEqual(rgba(value, 0, 3), clear);
  const wrapped = read(source, { ...options, wrap: true });
  assert.deepEqual(rgba(wrapped, 0, 3), [0, 0, 255, 64]);
  assert.throws(() => read(raster(1, 1, 1, [9]), options), /out of range/);
  assert.throws(() => read(source, { ...options, schedule: [{ row: 1, palette: [[0, '#aabbcc'], [0, '#112233']] }] }),
    /distinct/);
  assert.throws(() => read(source, { ...options, schedule: [{ row: 1, offset: [0, 0] }, { row: 1, pixelScale: [2, 2] }] }),
    /increasing/);
  assert.throws(() => read(source, { ...options, schedule: [{ row: 1, pixelScale: [2, 0] }] }), /positive/);
  assert.throws(() => read(source, { ...options, palette: ['#ff0000', undefined] }), /hex/);
});

test('the procedural node and JavaScript callback author the same register schedule', () => {
  const input = raster(2, 1, 4, [...red, ...green]);
  const run = P.graph.create({ inputs: { source: 'raster' },
    nodes: { effect: { op: 'fx.rasterSchedule', inputs: { source: { input: 'source' },
      options: { wrap: true, schedule: [{ row: 0, offset: [1, 0] }] } } } },
    outputs: { plate: { node: 'effect' } } });
  const { outputs } = run.evaluate({ source: input });
  const callback = P.pixelEffects.rasterSchedule(input, { time: 1, wrap: true,
    schedule: ({ width, height, time }) => [{ row: height - 1, offset: [width - time, 0] }] });
  assert.deepEqual(outputs.plate, callback);
  assert.deepEqual([...callback.data], [...green, ...red]);
});

function fixture({ makeBuilder, KIT }) {
  const width = 8, height = 6;
  const world = makeBuilder(31, [0x14263a]).finish({ radius: 3, cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const art = { width: 4, height: 3, channels: 2, data: Int16Array.from([
    0, 255, 1, 255, 2, 255, -1, 255,
    2, 255, 0, 128, 1, 255, 0, 255,
    1, 255, 2, 255, 0, 255, 1, 255
  ]) };
  const editor = KIT.renderGraph.create({ passes: [
    { id: 'paper', type: 'composite', isolated: true, layer: {
      draw: [{ type: 'rect', rect: [0, 0, width, height], color: '#203040' }]
    } },
    { id: 'gate', type: 'mask', rect: [0, 0, 7, 6] },
    { id: 'indexed', type: 'rasterSchedule', indices: { slot: 'art' }, mask: 'gate',
      palette: ['#ff0000', '#ff0000', '#33ccf080'], schedule: [
        { row: 1, offset: [1, 0], palette: [[1, '#00ff00']], pixelScale: [2, 2] },
        { row: 3, palette: [[0, '#0000ff']], offset: [-1, -1] }, { row: 4, pixelScale: [1, 1] }
      ] },
    { id: 'rgba', type: 'rasterSchedule', source: 'indexed', wrap: true,
      schedule: ({ time }) => [{ row: 0, pixelScale: [1, 2] }, { row: 2, offset: [time >= 1 ? -2 : 2, 0] }] }
  ] });
  return { world, editor, width, height, art };
}

function observed(frame, names = ['indexed', 'rgba']) {
  return Object.fromEntries(names.map(name => [name, Array.from(frame[name].data)]));
}

test('the CPU render graph combines scheduled index writes, masks and a named RGBA source', () => {
  const { world, editor, width, height, art } = fixture(kit);
  const draw = t => ink.render(world, { w: width, h: height, px: 1, raw: true, transparent: true, t,
    renderGraph: editor, renderGraphInputs: { art }, renderGraphCapture: ['indexed', 'rgba'] }).renderGraphPasses;
  const { indexed, rgba: shifted } = draw(0);
  assert.deepEqual(rgba(indexed, 2, 0), red);
  assert.deepEqual(rgba(indexed, 2, 1), green);
  assert.deepEqual(rgba(indexed, 7, 1), [32, 48, 64, 255]);
  assert.deepEqual(rgba(indexed, 0, 3), clear);
  assert.deepEqual(rgba(shifted, 5, 2), rgba(indexed, 7, 2));
  assert.notDeepEqual(draw(1).rgba.data, shifted.data);
  editor.update('indexed', { blend: 'over' });
  assert.deepEqual(rgba(draw(0).indexed, 0, 3), [32, 48, 64, 255]);
  assert.throws(() => ink.render(world, { w: width, h: height, raw: true, renderGraph: editor }), /Missing render graph raster slot/);
});

test('WebGL matches CPU register boundaries, indexed alpha and RGBA sampling', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const { world, editor, width, height, art } = fixture(kit);
  const names = ['indexed', 'rgba'];
  const actual = runWebGL({}, fixture, (kit, build, backend, names) => {
    const { world, editor, width, height, art } = build(kit);
    const draw = backend(width, height, { raw: true, offscreen: true, transparent: true });
    try {
      return { outputs: [0, 1].map(time => {
        if (time) editor.update('rgba', { blend: 'over', opacity: .5 });
        const captured = draw.draw(world, { time, renderGraph: editor, renderGraphInputs: { art }, renderGraphCapture: names });
        return Object.fromEntries(names.map(name => [name, Array.from(captured[name].data)]));
      }) };
    } finally { draw.close(); }
  }, names);
  const expected = [0, 1].map(t => {
    if (t) editor.update('rgba', { blend: 'over', opacity: .5 });
    return observed(ink.render(world, { w: width, h: height, px: 1, raw: true, transparent: true, t,
      renderGraph: editor, renderGraphInputs: { art }, renderGraphCapture: names }).renderGraphPasses);
  });
  assert.deepEqual(actual.outputs, expected);
});
