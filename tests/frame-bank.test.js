const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = ink.load(), K = kit.KIT, P = K.procedural;
const chrome = process.env.INK_TEST_CHROME;

function fixture({ makeBuilder }) {
  const w = 8, h = 4;
  const world = makeBuilder(13, [0x122032]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const graph = { passes: [
    { id: 'feed', type: 'composite', isolated: true, layer: { source: { slot: 'image' } } },
    { id: 'tracked', type: 'mask', raster: { slot: 'labels', match: 513 } },
    { id: 'refresh', type: 'mask', raster: { slot: 'pulse' } },
    { id: 'bank', type: 'frameBank', fps: 4, input: 'feed', cameraMotion: 'keep',
      tiles: { size: [2, 4], every: 4 }, refresh: 'refresh', regions: [
        { rect: [0, 0, 2, 2], every: 2 },
        { mask: 'tracked', every: 3, phase: 2 }
      ] }
  ] };
  function slots(shade, labelX, pulse) {
    return {
      image: { width: w, height: h, channels: 4, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => [shade, 15, 35, 255][i % 4]) },
      labels: { width: w, height: h, channels: 1,
        data: Uint32Array.from({ length: w * h }, (_, i) => i % w === labelX ? 513 : 514) },
      pulse: { width: w, height: h, channels: 1, data: Uint8Array.from({ length: w * h }, (_, i) => pulse && i % w === 7 ? 255 : 0) }
    };
  }
  return { world, graph, w, h, slots };
}

const steps = [
  [0, 10, 6, false], [.25, 20, 6, false], [.375, 30, 6, true], [.375, 40, 6, true],
  [.5, 50, 6, false], [.75, 60, 5, false], [1.25, 65, 5, false], [2.25, 70, 5, false], [.25, 80, 5, false]
];
const expected = [
  [10, 10, 10, 10, 10, 10], [10, 20, 10, 10, 10, 10], [10, 20, 10, 10, 10, 30], [10, 20, 10, 10, 10, 30],
  [50, 20, 50, 50, 50, 30], [50, 20, 50, 50, 60, 60], [65, 65, 50, 65, 60, 60], [70, 70, 70, 70, 70, 70],
  [80, 80, 80, 80, 80, 80]
];

test('render graph refreshes tiles, rectangle masks, moving IDs and sub-tick pulses independently', () => {
  const { world, graph, w, h, slots } = fixture(kit), history = K.renderGraph.history();
  const draw = (time, shader, label, pulse, extra = {}) => ink.render(world, {
    w, h, px: 1, raw: true, t: time, renderGraph: graph, renderHistory: history,
    renderGraphInputs: slots(shader, label, pulse), ...extra
  });
  const pick = result => [0, 2, 4, 5, 6, 7].map(x => result.rgb[x * 3]);
  assert.deepEqual(steps.map(step => pick(draw(...step))), expected);
  assert.deepEqual(pick(draw(.5, 180, 6, false, { resetRenderHistory: true })), Array(6).fill(180));
  const captured = draw(.75, 190, 6, false, { renderGraphCapture: ['tracked', 'bank'] }).renderGraphPasses;
  assert.deepEqual([...captured.tracked.data.slice(0, w)], [0, 0, 0, 0, 0, 0, 255, 0]);
  assert.equal(captured.bank.data[0], 180);
  assert.equal(captured.bank.data[8], 190);
});

test('bank budgets and mask dependencies are validated before rendering', () => {
  const { graph } = fixture(kit), { prepare, resources } = K.renderGraph, plan = prepare(graph);
  assert.deepEqual(plan.passes.map(p => p.id), ['feed', 'tracked', 'refresh', 'bank']);
  const { historyPixels, historyBytes } = resources(plan, 8, 4);
  assert.deepEqual([historyPixels, historyBytes], [32, 256]);
  assert.throws(() => resources(prepare({ ...graph, budget: { maxHistoryPixels: 16 } }), 8, 4), /history.*budget/i);
  const invalid = settings => prepare({ passes: [...graph.passes.slice(0, -1), { ...graph.passes.at(-1), ...settings }] });
  assert.throws(() => invalid({ regions: [{ mask: 'feed' }] }), /mask/);
  assert.throws(() => invalid({ tiles: { size: [0, 4] } }), /pixel size/);
  assert.throws(() => invalid({ tiles: { size: [4, 4], every: 3, phase: 3 } }), /phase/);
  assert.throws(() => prepare({ passes: [
    { id: 'matching', type: 'mask', raster: { slot: 'labels', match: 2, range: [0, 1] } }
  ] }), /raster binding/);
});

test('raster sessions expose the refresh matte, preserve alpha, and reset on rewind or resize', () => {
  const bank = P.frameBanks.create({ fps: 4, regions: [{ rect: [0, 0, 1, 1], mask: 'half', every: 1 }],
    refresh: 'instant' });
  const image = (left, right) => ({ width: 2, height: 1, channels: 4, data: Uint8Array.from([...left, ...right]) });
  const byte = (a, b) => ({ width: 2, height: 1, channels: 1, data: Uint8Array.of(a, b) });
  const masks = { half: byte(128, 255), instant: byte(0, 255) };
  const original = image([200, 0, 0, 255], [0, 200, 0, 255]);
  const transparent = image([0, 0, 0, 0], [0, 0, 0, 0]);
  const start = bank.sample(original, 0);
  assert.deepEqual([...start.refreshed.data], [255, 255]);
  const before = bank.sample(transparent, .125, { masks });
  assert.deepEqual([...before.refreshed.data], [0, 255]);
  assert.deepEqual([...before.value.data], [200, 0, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual(bank.sample(original, .125), before);
  const half = bank.sample(transparent, .25, { masks });
  assert.deepEqual([...half.refreshed.data], [128, 255]);
  assert.deepEqual([...half.value.data], [201, 0, 0, 127, 0, 0, 0, 0]);
  half.value.data[3] = 0;
  assert.equal(bank.sample(original, .25).value.data[3], 127);
  assert.deepEqual(bank.sample(original, .01).value, original);
  assert.deepEqual(bank.sample({ width: 1, height: 1, channels: 4, data: [3, 6, 9, 255] }, .5).refreshed.data, Uint8Array.of(255));
});

test('graph clips keep independent bank histories and reset them at authored cuts', () => {
  const strip = [20, 40, 60, 80].map(value => ({ width: 2, height: 1, channels: 4, data: [value, 0, 0, 255, value, 0, 0, 255] }));
  const node = node => ({ node });
  const graph = ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1,
    groups: { channel: { inputs: { timingRules: 'record' }, nodes: {
      source: { op: 'anim.frame', inputs: { frames: strip, options: { fps: 4 } } },
      bank: { op: 'anim.frameBank', inputs: { source: node('source'), options: { input: 'timingRules' } } }
    }, outputs: { value: node('bank') } } },
    nodes: {
      first: { op: 'channel', inputs: { timingRules: { fps: 4, regions: [{ rect: [0, 0, 1, 1] }] } } },
      second: { op: 'channel', inputs: { timingRules: { fps: 4, regions: [{ rect: [1, 0, 1, 1] }] } } }
    }, outputs: { first: node('first'), second: node('second') } });
  const sample = output => graph.clip({ output, to: 4, format: 'frames', clock: { fps: 4, cuts: [{ frame: 2, id: 'next' }] } })
    .artifacts.map(({ bytes }) => [...require('../cli/png.js').raster(bytes).data].filter((_, i) => i % 4 === 0));
  assert.deepEqual(sample('first'), [[20, 20], [40, 20], [60, 60], [80, 60]]);
  assert.deepEqual(sample('second'), [[20, 20], [20, 40], [60, 60], [60, 80]]);
});

test('WebGL frame bank matches CPU and retains the same masked and tiled pixels', { skip: !chrome }, () => {
  const actual = runWebGL({ chrome }, fixture, (kit, makeFixture, backend, steps) => {
    const { world, graph, w, h, slots } = makeFixture(kit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    try {
      const values = steps.map(([time, shade, labelX, pulse]) => {
        draw.draw(world, { renderGraph: graph, time, renderGraphInputs: slots(shade, labelX, pulse) });
        return Object.values(draw.sample(Object.fromEntries([0, 2, 4, 5, 6, 7].map((x, i) => ['p' + i, [x, 0]]))))
          .map(rgba => rgba[0]);
      });
      return { values };
    } finally { draw.close(); }
  }, steps);
  assert.deepEqual(actual.values, expected);
});
