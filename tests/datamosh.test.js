const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = ink.load(), P = kit.KIT.procedural;
const chrome = process.env.INK_TEST_CHROME;
const image = (reds, alpha = 255) => ({ width: reds.length, height: 1, channels: 4,
  data: Uint8Array.from(reds.flatMap(value => [value, 0, 0, alpha])) });
const vector = (x, width = 4) => ({ width, height: 1, channels: 2,
  data: Float32Array.from({ length: width * 2 }, (_, i) => i % 2 ? 0 : x) });
const mask = (...data) => ({ width: data.length, height: 1, channels: 1, data });
const red = raster => [...raster.data].filter((_, i) => i % 4 === 0);

test('datamosh reads signed displacements, recovers by half-life and honors confidence, validity and refresh independently', () => {
  const session = P.datamosh.create({ halfLife: .25, minConfidence: .2 });
  const start = image([20, 60, 100, 180]), clean = image([200, 200, 200, 200]);
  const planes = { confidence: mask(.1, .5, 1, 1), valid: mask(255, 255, 0, 255), refresh: mask(0, 0, 0, 128) };
  assert.deepEqual(session.sample(start, null, 0).value, start);
  const result = session.sample(clean, vector(1), .25, planes);
  assert.deepEqual(red(result.value), [200, 155, 200, 176]);
  assert.deepEqual([...result.carry.data.slice(0, 3)], [0, .25, 0]);
  assert(Math.abs(result.carry.data[3] - .5 * 127 / 255) < 1e-7);
  const again = session.sample(start, vector(-1), .25);
  assert.deepEqual(again, result);
  again.value.data[4] = 8;
  assert.equal(session.sample(start, vector(3), .25).value.data[4], 155);
  const still = session.sample(clean, vector(0), .5);
  assert.deepEqual(red(still.value), [200, 178, 200, 188]);
  assert.deepEqual(session.sample(clean, null, .75).value, clean);
  assert.deepEqual(session.sample(start, vector(1), .1).value, start);

  for (const [options, field] of [
    [{ direction: 'backward' }, vector(-1)], [{ units: 'pixels/second' }, vector(4)]
  ]) {
    const copy = P.datamosh.create({ halfLife: .25, minConfidence: .2, ...options });
    copy.sample(start, null, 0);
    assert.deepEqual(copy.sample(clean, field, .25, planes), result);
  }
});

test('datamosh transports premultiplied alpha, keeps clean resets atomic and supports fractional donors', () => {
  const session = P.datamosh.create({ halfLife: .5, filter: 'linear' }), initial = image([40, 160, 80, 10]);
  const clean = image([0, 0, 0, 0], 0);
  session.sample(initial, vector(0), 0);
  assert.throws(() => session.sample(clean, vector(.5, 2), .5), /aligned/);
  const corrupt = vector(.5); corrupt.data[0] = NaN;
  assert.throws(() => session.sample(clean, corrupt, .5), /finite/);
  const result = session.sample(clean, vector(.5), .5, { refresh: mask(0, 0, 255, 0) });
  assert.deepEqual([...result.value.data.filter((_, i) => i % 4 === 3)], [127, 127, 0, 127]);
  assert.equal(result.value.data[4], 100);
  assert.deepEqual(session.sample(initial, vector(-1), .5, { reset: true }).value, initial);
  assert.deepEqual(session.sample(image([20, 40]), vector(-1, 2), 1).value, image([20, 40]));
});

test('backward optical flow drives an aligned displaced donor without color packing', () => {
  const width = 32, height = 28;
  function guide(offset) {
    const data = Uint8Array.from({ length: width * height }, (_, p) => {
      const x = p % width - offset, y = Math.floor(p / width);
      return x >= 0 ? (x * 37 + y * 29 + (x * y * 13) % 127) % 256 : 0;
    });
    return { width, height, channels: 1, data };
  }
  const before = guide(0), after = guide(2);
  const { value: motion, confidence } = P.rasterWarp.opticalFlow(before, after, { direction: 'backward', search: 4 });
  const session = P.datamosh.create({ direction: 'backward', halfLife: 1 });
  const source = P.raster.canvas({ width, height, color: [64, 120, 180, 255] });
  session.sample(before, null, 0);
  const result = session.sample(source, motion, .1, { confidence });
  const p = 13 * width + 14;
  assert(motion.data[p * 2] < -1.65 && motion.data[p * 2] > -2.35);
  assert(result.carry.data[p] > 0.2);
  assert.notEqual(result.value.data[p * 4], source.data[p * 4]);
});

test('portable captured motion feeds the graph operator and clip cuts restore the clean frame', () => {
  const recording = P.visualResampling.create({ fps: 4 });
  for (const [index, shade] of [20, 80, 110, 160].entries())
    recording.append(image(Array.from({ length: 4 }, (_, x) => shade + x * 10)), index ? { motion: vector(1) } : {});
  const link = (node, port) => ({ node, ...(port && { port }) });
  const project = ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1, nodes: {
      replay: { op: 'anim.visualSample', inputs: { source: recording.snapshot() } },
      smear: { op: 'anim.datamosh', inputs: { source: link('replay'), motion: link('replay', 'motion'),
        valid: link('replay', 'motionValid'), options: { halfLife: .25 } } }
    },
    outputs: { value: link('smear'), carry: link('smear', 'carry') }
  });
  const { artifacts } = project.clip({ output: 'value', to: 4, format: 'frames',
    clock: { fps: 4, cuts: [{ frame: 2, id: 'fresh' }] } });
  assert.deepEqual(artifacts.map(({ bytes }) => red(require('../cli/png.js').raster(bytes))),
    [[20, 30, 40, 50], [80, 55, 65, 75], [110, 120, 130, 140], [160, 140, 150, 160]]);
});

function fixture({ makeBuilder }) {
  const w = 6, h = 4;
  const world = makeBuilder(13, [0x122032]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const graph = { passes: [
    { id: 'feed', type: 'composite', isolated: true, layer: { source: { slot: 'image' } } },
    { id: 'fresh', type: 'mask', raster: { slot: 'refresh' } },
    { id: 'smear', type: 'motionSmear', input: 'feed', refresh: 'fresh', cameraMotion: 'keep', halfLife: .25,
      motion: { slot: 'vectors', confidence: 'confidence', valid: 'valid', direction: 'backward' } }
  ] };
  function slots(index) {
    const make = (channels, data) => ({ width: w, height: h, channels, data });
    const cell = (channels, fn, Type) => Type.from({ length: w * h * channels }, (_, i) => fn(Math.floor(i / channels), i % channels));
    return {
      image: make(4, cell(4, (p, channel) => [20 + p * 6 + index * 10, 60, 15 + index * 10, 255][channel], Uint8Array)),
      vectors: index === 3 ? null : make(2, cell(2, (p, channel) =>
        channel ? (p >= w ? -1 : 0) : (p % w > 2 ? -1.25 : .75), Float32Array)),
      confidence: make(1, cell(1, p => p % w === 1 ? .5 : 1, Float32Array)),
      valid: make(1, cell(1, p => p % w === 2 ? 0 : 255, Uint8Array)),
      refresh: make(1, cell(1, p => p % w === 4 && index === 2 ? 255 : 0, Uint8Array))
    };
  }
  return { world, graph, w, h, slots };
}
const times = [0, .25, .5, .75, .25];

function headless() {
  const { world, graph, w, h, slots } = fixture(kit), history = kit.KIT.renderGraph.history();
  return times.map((t, index) => [...ink.render(world, { w, h, t, px: 1, raw: true,
    renderGraph: graph, renderGraphInputs: slots(index), renderGraphCapture: ['smear'], renderHistory: history
  }).renderGraphPasses.smear.data]);
}

test('screen passes read aligned signed motion slots and recover on missing motion and rewind', () => {
  const { graph, slots } = fixture(kit);
  const actual = headless();
  assert.notDeepEqual(actual[1], [...slots(1).image.data]);
  assert.deepEqual(actual[3], [...slots(3).image.data]);
  assert.deepEqual(actual[4], [...slots(4).image.data]);
  const { prepare } = kit.KIT.renderGraph;
  const invalid = motion => prepare({ passes: [...graph.passes.slice(0, -1), { ...graph.passes.at(-1), motion }] });
  assert.throws(() => invalid({ slot: 'vectors', direction: 'forward' }), /direction/);
  assert.throws(() => invalid({ slot: 'vectors', minConfidence: 2 }), /confidence/);
});

test('WebGL transports signed float vectors in top-down coordinates with CPU parity', { skip: !chrome }, () => {
  const actual = runWebGL({ chrome }, fixture, (toolkit, build, backend, times) => {
    const { world, graph, w, h, slots } = build(toolkit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    try {
      const frames = times.map((time, index) => Array.from(draw.draw(world, { renderGraph: graph, time,
        renderGraphInputs: slots(index), renderGraphCapture: ['smear'] }).smear.data));
      return { frames };
    } finally { draw.close(); }
  }, times);
  assert.deepEqual(actual.frames, headless());
});
