const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runGraph = require('../cli/render-graph');
const runWebGL = require('../cli/look-webgl');
const { KIT } = ink.load();
const chrome = process.env.INK_TEST_CHROME;

function fixture({ makeBuilder }) {
  const world = makeBuilder(8, [0x112234]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const w = 10, h = 2;
  const colorLayer = (id, pixel) => ({ id, type: 'composite', isolated: true, layer: {
    source({ time }) {
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) rgba.set(pixel(i % w, time), i * 4);
      return { w, h, rgba };
    }
  } });
  const graph = { passes: [
    colorLayer('flow', (x, time) => [time >= 2 || x % 2 === 0 ? 128 : x < 4 ? 255 : 0, 128, x < 8 ? 255 : 0, 255]),
    colorLayer('clean', (x, time) => [time === 0 ? x * 20 : 200, time === 0 ? 44 : 40, 90, 255]),
    { id: 'intra', type: 'mask', rect: [5, 0, 1, h] },
    { id: 'smear', type: 'motionSmear', field: 'flow', input: 'clean', refresh: 'intra',
      halfLife: 1, fieldScale: [1, 1], blockSize: [2, 1], cameraMotion: 'keep' }
  ] };
  return { world, graph, w, h };
}

const times = [0, 0, 1, 1, 2, 3, 0];
const initial = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180];
const dragged = [200, 100, 110, 120, 150, 200, 170, 180, 200, 200];
const expected = [
  initial, initial, dragged, dragged, [200, 150, 155, 160, 175, 200, 185, 190, 200, 200],
  [200, 175, 178, 180, 188, 200, 193, 195, 200, 200], initial
];

test('different blocks drag in opposite directions and recover when movement stops', () => {
  const { world, graph, w, h } = fixture(ink.load());
  const renderHistory = KIT.renderGraph.history();
  const draw = (t, extra) => ink.render(world, { w, h, t, renderGraph: graph, renderHistory, ...extra });
  const firstRow = frame => [...frame.rgb.subarray(0, w * 3)].filter((_, i) => i % 3 === 0);
  assert.deepEqual(times.map(t => firstRow(draw(t))), expected);
  assert.deepEqual(firstRow(draw(1, { resetRenderHistory: true })), Array(w).fill(200));
  draw(2, { renderGraph: false });
  assert.deepEqual(firstRow(draw(3)), Array(w).fill(200));
});

test('smear transports premultiplied alpha and can keep an explicit display mask crisp', () => {
  const renderHistory = KIT.renderGraph.history();
  const passes = [
    { id: 'gate', type: 'mask', rect: [0, 0, 2, 1] },
    { id: 'drag', type: 'motionSmear', velocity: [1, 0], halfLife: 1, mask: 'gate', cameraMotion: 'keep' }
  ];
  const plan = KIT.renderGraph.prepare({ passes });
  const world = {};
  const draw = (time, rgba, active = plan) => runGraph(active, {
    w: 3, h: 1, rgba: Uint8Array.from(rgba), alpha: Uint8Array.of(rgba[3], rgba[7], rgba[11])
  }, world, time, null, null, null, { renderHistory });
  draw(0, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]);
  const result = draw(1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255]);
  assert.deepEqual([...result.rgb], [0, 0, 0, 255, 0, 0, 0, 0, 255]);
  assert.deepEqual([...result.alpha], [0, 127, 255]);
  const stationary = KIT.renderGraph.prepare({ passes: [passes[0], { ...passes[1], velocity: [0, 0] }] });
  for (let time = 2; time <= 8; time++) {
    const recovered = draw(time, Array(12).fill(0), stationary);
    if (time === 8) assert.deepEqual([...recovered.alpha], [0, 0, 0]);
  }
});

test('history budgets and ordered dependencies include the motion and refresh maps', () => {
  const { graph, w, h } = fixture(ink.load());
  const pass = graph.passes.at(-1);
  const { prepare, resources } = KIT.renderGraph;
  const plan = prepare(graph);
  assert.deepEqual(plan.passes.map(node => node.id), ['flow', 'clean', 'intra', 'smear']);
  assert.equal(resources(plan, w, h).historyBytes, w * h * 8);
  const override = extra => ({ passes: [...graph.passes.slice(0, -1), { ...pass, ...extra }] });
  const reduced = override({ budget: { maxPixels: 4 } });
  assert(resources(prepare(reduced), w, h).historyPixels <= 4);
  const { world } = fixture(ink.load());
  const renderHistory = KIT.renderGraph.history();
  const frame = ink.render(world, { w, h, t: 0, renderGraph: reduced, renderHistory });
  assert.deepEqual([...frame.rgb.subarray(0, w * 3)].filter((_, i) => i % 3 === 0), initial);
  for (const change of [
    { field: 'intra' }, { refresh: 'clean' }, { field: 'smear' }, { velocity: [0, Infinity] },
    { halfLife: 0 }, { blockSize: [4, .5] }
  ]) assert.throws(() => prepare(override(change)));
});

test('WebGL matches CPU block transport, clean refresh, duplicate times and a rewind', { skip: !chrome }, () => {
  const result = runWebGL({ chrome }, fixture, (kit, makeFixture, backend, times) => {
    const { world, graph, w, h } = makeFixture(kit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    const row = Object.fromEntries(Array.from({ length: w }, (_, x) => [x, [x, 0]]));
    const colors = times.map(time => {
      draw.draw(world, { renderGraph: graph, time });
      return Object.values(draw.sample(row));
    });
    draw.close();
    return { values: colors.map(row => row.map(color => color[0])), recovered: colors[5].map(color => color[1]) };
  }, times);
  assert.deepEqual(result.values, expected);
  assert.deepEqual(result.recovered, Array(10).fill(40));
});
