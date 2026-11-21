const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runGraph = require('../cli/render-graph');
const runWebGL = require('../cli/look-webgl');
const { KIT } = ink.load();
const chrome = process.env.INK_TEST_CHROME;

function fixture({ makeBuilder }) {
  const world = makeBuilder(13, [0x122032]).finish({
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }
  });
  const w = 8, h = 4;
  const graph = { passes: [
    { id: 'feed', type: 'composite', isolated: true, layer: {
      source({ time }) {
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) rgba.set([30 + Math.round(time * 4) * 10, 90, 120, 255], i * 4);
        return { w, h, rgba };
      }
    } },
    { id: 'delay', type: 'mask', rect: [0, 0, 2, h] },
    { id: 'hold', type: 'mask', rect: [2, 0, 2, h] },
    { id: 'replay', type: 'mask', rect: [4, 0, 2, h] },
    { id: 'age', type: 'frameAge', fps: 4, cameraMotion: 'keep', regions: [
      { mask: 'delay', mode: 'delay', frames: 2 },
      { mask: 'hold', mode: 'hold', start: 1 },
      { mask: 'replay', mode: 'replay', start: 1, frames: 2 }
    ] }
  ] };
  return { world, graph, w, h };
}

const times = [0, .25, .5, .75, 1, 1.25, 1.25, 1.5, 2.5, 2.75, .5];
const expected = [
  [30, 30, 30, 30], [40, 40, 40, 40], [30, 40, 50, 50], [40, 40, 40, 60],
  [50, 40, 50, 70], [60, 40, 40, 80], [60, 40, 40, 80], [70, 40, 50, 90],
  [90, 40, 50, 130], [90, 40, 40, 140], [50, 50, 50, 50]
];

test('live frame age samples delay, pinned and replay ticks independently, including dropped frames and a rewind', () => {
  const { world, graph, w, h } = fixture(ink.load());
  const renderHistory = KIT.renderGraph.history();
  const draw = (t, settings) => ink.render(world, { w, h, t, renderGraph: graph, renderHistory, ...settings });
  const values = frame => [0, 2, 4, 6].map(x => frame.rgb[(w + x) * 3]);
  assert.deepEqual(times.map(t => values(draw(t))), expected);
  assert.deepEqual(values(draw(1, { resetRenderHistory: true })), [70, 70, 70, 70]);
  assert.deepEqual(values(draw(1.25)), [80, 80, 80, 80]);
  draw(1.5, { renderGraph: false });
  assert.deepEqual(values(draw(1.75)), [100, 100, 100, 100]);
});

test('a selected object must be visible in the current image and in the sampled pixels', () => {
  const world = { count: 2, data: new Float32Array(32), renderMetadata: {
    objectIds: new Uint32Array([1, 2]), objects: [null, 'relay', 'foreground']
  } };
  const plan = KIT.renderGraph.prepare({ passes: [{
    id: 'age', type: 'frameAge', fps: 1, cameraMotion: 'keep',
    select: { object: 'relay' }, regions: [{ mode: 'delay', frames: 1 }]
  }] });
  const renderHistory = KIT.renderGraph.history();
  const draw = (t, shade, owners) => runGraph(plan, {
    w: 4, h: 1, rgb: Uint8Array.from(shade.flatMap(v => [v, 0, 0])),
    passes: { w: 4, h: 1, splatId: Uint32Array.from(owners) }
  }, world, t, null, undefined, null, { renderHistory }).rgb.filter((_, i) => i % 3 === 0);
  draw(0, [50, 100, 150, 200], [1, 2, 1, 0]);
  assert.deepEqual([...draw(1, [81, 82, 83, 84], [2, 1, 1, 1])], [81, 82, 150, 84]);
});

test('region masks compose in order and delayed transparent pixels replace the isolated input', () => {
  const world = {};
  const plan = KIT.renderGraph.prepare({ passes: [
    { id: 'right', type: 'mask', rect: [1, 0, 1, 1] },
    { id: 'age', type: 'frameAge', fps: 1, cameraMotion: 'keep', regions: [
      { mode: 'delay', frames: 1 }, { mask: 'right', mode: 'hold', start: 0 }
    ] }
  ] });
  const renderHistory = KIT.renderGraph.history();
  const draw = (t, rgba) => runGraph(plan, {
    w: 2, h: 1, rgba: Uint8Array.from(rgba), alpha: Uint8Array.of(rgba[3], rgba[7])
  }, world, t, null, null, null, { renderHistory });
  draw(0, [90, 0, 0, 255, 40, 0, 0, 255]);
  draw(1, [0, 0, 0, 0, 80, 0, 0, 255]);
  const result = draw(2, [160, 0, 0, 255, 160, 0, 0, 255]);
  assert.deepEqual([...result.rgb], [0, 0, 0, 40, 0, 0]);
  assert.deepEqual([...result.alpha], [0, 255]);
});

test('frame age counts live mask dependencies, retained slots and scratch and rejects invalid inputs', () => {
  const { graph } = fixture(ink.load());
  const { prepare, resources } = KIT.renderGraph;
  const plan = prepare(graph);
  assert.deepEqual(plan.passes.map(pass => pass.id), ['feed', 'delay', 'hold', 'replay', 'age']);
  assert.equal(plan.historyPasses[0].slots, 6);
  const budget = resources(plan, 16, 8);
  assert.equal(budget.historyPixels, 6 * 16 * 8);
  assert.equal(budget.historyBytes, 4 * budget.historyPixels);
  assert.equal(budget.passes.at(-1).work, 4 * 16 * 8);
  assert.throws(() => resources(prepare({ ...graph, budget: { maxHistoryPixels: 767 } }), 16, 8), /history.*budget/i);
  for (const region of [
    { mode: 'hold', frames: 2 }, { mode: 'delay', frames: 0 }, { mode: 'replay', start: -1 },
    { mode: 'hold', mask: 'feed' }, { mode: 'delay', frames: 65 }
  ]) assert.throws(() => prepare({ passes: [...graph.passes.slice(0, -1), { ...graph.passes.at(-1), regions: [region] }] }));
});

test('WebGL uses the same live frame age clock and region masks as CPU', { skip: !chrome }, () => {
  const result = runWebGL({ chrome }, fixture, (kit, makeFixture, backend, times) => {
    const { world, graph, w, h } = makeFixture(kit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    const values = times.map(time => {
      draw.draw(world, { renderGraph: graph, time });
      return Object.values(draw.sample({ delay: [0, 1], hold: [2, 1], replay: [4, 1], live: [6, 1] })).map(c => c[0]);
    });
    draw.close();
    return { values };
  }, times);
  assert.deepEqual(result.values, expected);
});
