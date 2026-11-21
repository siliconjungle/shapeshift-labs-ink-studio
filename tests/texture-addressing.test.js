const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..'), kit = ink.load(), P = kit.KIT.procedural;
const runWebGL = require('../cli/look-webgl');
const W = P.rasterWarp;
const at = (image, x, y = 0) => Array.from(image.data.slice((y * image.width + x) * image.channels,
  (y * image.width + x + 1) * image.channels));
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < 1e-5, actual + ' differs from ' + expected));
};

test('rotation respects the pixel aspect and zoom composes about its own pivot', () => {
  const rotate = { type: 'rotate', turns: .25 }, zoom = { type: 'zoom', scale: 2, pivot: [0, 0] };
  const field = changes => W.addressField({ width: 4, height: 2, transforms: changes });
  near(at(field([rotate]), 0), [.375, 1.25, 1]);
  near(at(field([rotate, zoom]), 0), [.1875, .625, 1]);
  assert.notDeepEqual(at(field([zoom, rotate]), 0), at(field([rotate, zoom]), 0));
  assert.throws(() => field([{ type: 'zoom', scale: 0 }]), /zoom/);
  assert.throws(() => field([{ type: 'rotate', axes: [0, 0] }]), /settings/);
});

test('polar tunnels use angle and reciprocal depth with deterministic clocks and a covered center hole', () => {
  const transform = { type: 'tunnel', depth: .25, spinRate: .5, travelRate: .5, inner: .08, outer: .35 };
  const field = time => W.addressField({ width: 5, height: 5, transforms: [transform], time });
  const advanced = field(.5);
  near(at(advanced, 3, 2), [.25, 1.5, 1]);
  near(at(advanced, 1, 2), [.75, 1.5, 1]);
  assert.equal(at(advanced, 2, 2)[2], 0);
  assert.equal(at(advanced, 4, 4)[2], 0);
  near(at(field(-.5), 3, 2), [.75, 1, 1]);
  assert.deepEqual(field(.5), advanced);
});

test('row transforms honor Copper boundaries and do not quantize untouched coordinates', () => {
  const via = W.addressField({ width: 5, height: 6, time: 2, transforms: [
    { type: 'rows', schedule: ({ time }) => [
      { row: time, offset: [1, 0], pixelScale: [2, 2] }, { row: 3, offset: [1, 1] }
    ] }
  ] });
  near(at(via, 1, 1), [.3, .25, 1]);
  near(at(via, 1, 2), [.3, 2.5 / 6, 1]);
  near(at(via, 1, 3), [.3, 3.5 / 6, 1]);
  near(at(via, 1, 4), [.3, 5.5 / 6, 1]);
  const zoom = W.addressField({ width: 5, height: 6, transforms: [{ type: 'zoom', scale: 1.5 }] });
  const identity = W.addressField({ width: 5, height: 6,
    transforms: [{ type: 'zoom', scale: 1.5 }, { type: 'rows' }] });
  assert.deepEqual(zoom, identity);
});

test('sampled UV composition mixes address coverage and can drive a single image lookup in a graph', () => {
  const map = { width: 2, height: 1, channels: 3, data: [.3, .5, 1, .9, .5, 0] };
  const first = { width: 1, height: 1, channels: 3, data: [.5, .5, .5] };
  near(at(W.composeFields([first, map], { filter: 'linear' }), 0), [.3, .5, .25]);
  const outside = { ...first, data: [-.25, .5, 1] };
  assert.equal(at(W.composeFields([outside, map]), 0)[2], 0);
  assert.equal(at(W.composeFields([outside, map], { edge: 'mirror' }), 0)[2], 1);
  const n = node => ({ node });
  const pipeline = P.graph.create({ inputs: { source: 'raster' }, nodes: {
    zoom: { op: 'warp.address', inputs: { width: 2, height: 1, transforms: [{ type: 'zoom', scale: 2 }] } },
    maps: { op: 'data.record', inputs: { first: n('zoom'), second: map } },
    chain: { op: 'data.collect', inputs: { source: n('maps'), keys: ['first', 'second'] } },
    pull: { op: 'warp.compose', inputs: { fields: n('chain') } },
    draw: { op: 'warp.sample', inputs: { source: { input: 'source' }, field: n('pull'), options: { filter: 'nearest' } } }
  }, outputs: { value: n('draw') } });
  const source = { width: 2, height: 1, channels: 4, data: [255, 0, 0, 255, 0, 0, 255, 255] };
  const { value } = pipeline.evaluate({ source }).outputs;
  assert.deepEqual([...value.data], [255, 0, 0, 255, 0, 0, 0, 0]);
});

function fixture({ makeBuilder, KIT }) {
  const w = 8, h = 4;
  const world = makeBuilder(19, [0x273148]).finish();
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];
  const renderGraph = KIT.renderGraph.create({ passes: [
    { id: 'source', type: 'composite', isolated: true,
      layer: { draw: colors.map((color, x) => ({ type: 'rect', rect: [2 * x, 0, 2, h], color })) } },
    { id: 'out', type: 'textureAddress', field: { slot: 'map' }, source: 'source', edgeU: 'wrap', edgeV: 'transparent' }
  ] });
  const addresses = [-.25, .125, .25, .5, .7, 1.125, 1.25, 1.5];
  const data = new Float32Array(w * h * 3);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 3) {
    data[p] = addresses[x];
    data[p + 1] = y === 3 ? 1.25 : (y + .5) / h;
    data[p + 2] = y === 1 ? .5 : y === 2 ? 0 : 1;
  }
  return { world, renderGraph, w, h, map: { width: w, height: h, channels: 3, data } };
}

function renderCPU({ world, renderGraph, w, h, map }) {
  return ink.render(world, { w, h, px: 1, raw: true, transparent: true, renderGraph,
    renderGraphInputs: { map }, renderGraphCapture: ['out'] }).renderGraphPasses.out;
}

test('a native UV pass supports masked coverage, edge policies, filtering and invalid slots', () => {
  const item = fixture(kit), { renderGraph } = item, nearest = renderCPU(item);
  assert.deepEqual(at(nearest, 0), [255, 255, 255, 255]);
  assert.deepEqual(at(nearest, 2), [0, 255, 0, 255]);
  assert.deepEqual(at(nearest, 6), [0, 255, 0, 255]);
  assert.deepEqual(at(nearest, 1, 1), [255, 0, 0, 128]);
  assert.deepEqual(at(nearest, 1, 2), [0, 0, 0, 0]);
  assert.deepEqual(at(nearest, 1, 3), [0, 0, 0, 0]);
  renderGraph.update('out', { filter: 'linear', edgeU: 'mirror', blend: 'over', opacity: .5 });
  const mixed = renderCPU(item);
  assert.deepEqual(at(mixed, 1, 2), [255, 0, 0, 255]);
  assert.notDeepEqual(mixed.data, nearest.data);
  assert.throws(() => renderCPU({ ...item, map: { ...item.map, width: 1 } }), /aligned/);
  assert.throws(() => renderCPU({ ...item, map: { ...item.map, data: new Float32Array(item.map.data.length).fill(NaN) } }),
    /coordinate or coverage/);
  assert.throws(() => kit.KIT.renderGraph.prepare({ passes: [{ type: 'textureAddress', id: 'bad', field: { slot: 'map' },
    filter: 'cubic' }] }), /filter/);
});

test('WebGL and the CPU sample the same raw UV texture and alpha', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { first: firstGL, second: secondGL } = runWebGL({}, fixture, (toolkit, build, backend) => {
    const { world, renderGraph, w, h, map } = build(toolkit);
    const draw = backend(w, h, { raw: true, offscreen: true, transparent: true });
    const capture = () => Array.from(draw.draw(world, { renderGraph, renderGraphInputs: { map },
      renderGraphCapture: ['out'] }).out.data);
    try {
      const first = capture();
      renderGraph.update('out', { filter: 'linear', edgeU: 'mirror', blend: 'over', opacity: .5 });
      return { first, second: capture() };
    } finally { draw.close(); }
  });
  const item = fixture(kit), first = renderCPU(item);
  item.renderGraph.update('out', { filter: 'linear', edgeU: 'mirror', blend: 'over', opacity: .5 });
  assert.deepEqual(firstGL, [...first.data]);
  assert.deepEqual(secondGL, [...renderCPU(item).data]);
});
