const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load();
const { graph, pixelEffects } = kit.KIT.procedural;
const plane = (width, height, data) => ({ width, height, channels: 1, data: Float64Array.from(data) });

test('skip compacts the source, then repeat and blank override destination rows in order', () => {
  const source = { ...plane(2, 5, [-1, .5, 2, 3, 4, 5, 6, 7, 8, 9]), pivot: [1, 3] };
  const result = pixelEffects.scanlineRemap(source, { edits: [
    { mode: 'blank', start: 1, count: 2 },
    { mode: 'skip', start: 1, count: 2 },
    { mode: 'repeat', start: 2, source: 1 }
  ] });
  assert.deepEqual([...result.addresses.data], [0, -1, 1, -1, -1]);
  assert.deepEqual([...result.value.data], [-1, .5, 0, 0, 2, 3, 0, 0, 0, 0]);
  assert.deepEqual(result.value.pivot, source.pivot);
  assert.equal(source.data[2], 2);
});

test('repeat keeps whole RGBA rows and handles clipped ranges and missing donor rows', () => {
  const first = [30, 40, 50, 96], second = [60, 70, 80, 190], third = [90, 100, 110, 255];
  const source = { width: 1, height: 3, channels: 4, data: Uint8Array.of(...first, ...second, ...third) };
  const result = pixelEffects.scanlineRemap(source, { edits: [
    { mode: 'repeat', start: 1, count: 2 }, { mode: 'repeat', start: 2, count: 4, source: 5 }
  ] });
  assert.deepEqual([...result.value.data], [...first, ...first, 0, 0, 0, 0]);
  assert.throws(() => pixelEffects.scanlineRemap(source, { edits: [{ mode: 'skip', start: 1, count: 0 }] }), /scanline edit/i);
  assert.throws(() => pixelEffects.scanlineRemap(source, { edits: [{ mode: 'blank', start: 1, source: 0 }] }), /scanline edit/i);
});

test('the standalone graph node exposes both the raster and its row addresses', () => {
  const source = plane(1, 4, [10, 20, 30, 40]);
  const session = graph.create({
    inputs: { image: 'raster' },
    nodes: { lines: { op: 'fx.scanlineRemap', inputs: { source: { input: 'image' },
      options: { value: { edits: [{ mode: 'skip', start: 1 }] } } } } },
    outputs: { value: { node: 'lines' }, addresses: { node: 'lines', port: 'addresses' } }
  });
  const { outputs } = session.evaluate({ image: source });
  assert.deepEqual([...outputs.value.data], [10, 30, 40, 0]);
  assert.deepEqual([...outputs.addresses.data], [0, 2, 3, -1]);
});

function fixture({ makeBuilder, KIT }) {
  const B = makeBuilder(7, [0x101e2b]);
  const world = B.finish({ radius: 3, cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const colors = ['#843c40', '#4b646a', '#44c292', '#a76f8b', '#d9a47c', '#a1c3cc'];
  const editor = KIT.renderGraph.create({ passes: [
    { id: 'paint', type: 'composite', layer: {
      draw: colors.map((color, y) => ({ type: 'rect', rect: [0, y, 8, 1], color }))
    } },
    { id: 'mask', type: 'mask', rect: [0, 0, 4, 6] },
    { id: 'lines', type: 'distortion', mask: 'mask', rowEdits: [
      { mode: 'skip', start: 1 }, { mode: 'repeat', start: 2, source: 0 }, { mode: 'blank', start: 4 }
    ] }
  ] });
  return { world, editor };
}

const points = { skipped: [1, 1], repeated: [1, 2], blanked: [1, 4], tail: [1, 5], protected: [6, 4] };
const expected = { skipped: [68, 194, 146], repeated: [132, 60, 64], blanked: [0, 0, 0],
  tail: [0, 0, 0], protected: [217, 164, 124] };

test('render graph row edits preserve masks and respect replace and over alpha', () => {
  const { world, editor } = fixture(kit);
  const render = (t = 0) => ink.render(world, { w: 8, h: 6, px: 1, raw: true, transparent: true, t, renderGraph: editor });
  const sample = (frame, [x, y]) => [...frame.rgb.subarray((y * 8 + x) * 3, (y * 8 + x) * 3 + 3)];
  const frame = render();
  assert.deepEqual(Object.fromEntries(Object.entries(points).map(([key, xy]) => [key, sample(frame, xy)])), expected);
  assert.equal(frame.alpha[4 * 8 + 1], 0);
  assert.equal(frame.alpha[4 * 8 + 6], 255);
  editor.update('lines', { blend: 'over' });
  assert.deepEqual(sample(render(), points.blanked), expected.protected);
  editor.update('lines', { blend: 'replace', rowEdits: ({ time }) =>
    time > .5 ? [{ mode: 'blank', start: 4 }] : [] });
  assert.equal(render(0).alpha[4 * 8 + 1], 255);
  assert.equal(render(1).alpha[4 * 8 + 1], 0);
});

test('WebGL render graph matches CPU repeat, skip, dropout, and destination mask', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, build, backend, points) => {
    const { world, editor } = build(kit);
    const draw = backend(8, 6, { raw: true, offscreen: true, transparent: true });
    try {
      draw.draw(world, { renderGraph: editor });
      return { pixels: draw.sample(points) };
    } finally {
      draw.close();
    }
  }, points);
  assert.deepEqual(result.pixels, expected);
});
