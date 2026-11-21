const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder, KIT }) {
  const B = makeBuilder(2, [0x18283c, 0xffffff]);
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const renderGraphInputs = {
    art: { width: 1, height: 2, channels: 4, data: [232, 88, 32, 255, 32, 180, 228, 255] },
    stencil: { width: 2, height: 1, channels: 1, data: Float32Array.of(.5, 1) }
  };
  const passes = [
    { id: 'coverage', type: 'mask', raster: { slot: 'stencil', range: [0, 1], rect: [2, 0, 4, 4] },
      rect: [0, 0, 5, 4] },
    { id: 'artwork', type: 'composite', isolated: true, layer: { source: { slot: 'art' } }, mask: 'coverage' },
    { id: 'overlay', type: 'composite', input: 'scene', source: 'artwork' },
    { id: 'unused', type: 'mask', raster: { slot: 'unused' } }
  ];
  return { world, renderGraph: KIT.renderGraph.create({ output: 'overlay', passes }), renderGraphInputs };
}

const view = { w: 8, h: 4, px: 1, raw: true };
const pixel = (frame, x, y) => Array.from(frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3));
const kit = ink.load();

test('CPU raster slots preserve alpha, mask range and placement, and capture branches by name', () => {
  const { world, ...settings } = fixture(kit);
  const plain = ink.render(world, { ...view, ...settings });
  assert.deepEqual(pixel(plain, 0, 0), [24, 40, 60]);
  assert.deepEqual(pixel(plain, 4, 0), [232, 88, 32]);
  assert.deepEqual(pixel(plain, 4, 3), [32, 180, 228]);
  assert.deepEqual(pixel(plain, 5, 3), [24, 40, 60]);
  assert.deepEqual(pixel(plain, 2, 0), [128, 64, 46]);
  assert.equal(plain.renderGraphPasses, undefined);
  const captured = ink.render(world, { ...view, ...settings, renderGraphCapture: ['scene', 'artwork', 'coverage'] });
  assert.deepEqual(captured.rgb, plain.rgb);
  assert.deepEqual([...captured.renderGraphPasses.coverage.data.subarray(0, 8)], [0, 0, 128, 128, 255, 0, 0, 0]);
  assert.equal(captured.renderGraphPasses.artwork.data[(2 * 4) + 3], 128);
  assert.equal(captured.renderGraphPasses.artwork.data[3], 0);
  assert.deepEqual([...captured.renderGraphPasses.scene.data.subarray(0, 4)], [24, 40, 60, 255]);
  assert.throws(() => ink.render(world, { ...view, ...settings, renderGraphCapture: ['unused'] }), /Missing render graph raster slot: unused/);
  assert.throws(() => ink.render(world, { ...view, ...settings, renderGraphCapture: ['unknown'] }), /Unknown render graph capture: unknown/);
  assert.throws(() => ink.graphRenderPass(plain, 'graph:coverage'), /did not capture pass graph:coverage/);
  settings.renderGraph.update('unused', { enabled: false });
  const disabled = ink.render(world, { ...view, ...settings, renderGraphCapture: ['unused'] });
  assert(disabled.renderGraphPasses.unused.data.every(value => value === 0));
});

test('an ordinary graph connects authored rasters to the renderer and processes a named pass', () => {
  const { world, renderGraph } = fixture(kit);
  const link = (node, port = 'value') => ({ node, port });
  const project = ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1,
    nodes: {
      world: { op: 'fixture' },
      art: { op: 'raster.canvas', inputs: { width: 2, height: 2, color: [192, 102, 49, 255] } },
      stencil: { op: 'raster.channel', inputs: { source: link('art'), options: { channel: 'alpha' } } },
      slots: { op: 'data.record', inputs: { art: link('art'), stencil: link('stencil') } },
      scene: { op: 'scene.render', inputs: { source: link('world'), renderGraphInputs: link('slots'),
        renderGraphCapture: ['coverage', 'artwork'], options: { width: 8, height: 4, raw: true, renderGraph: renderGraph.snapshot() } } },
      pass: { op: 'scene.pass', inputs: { frame: link('scene', 'frame'), channel: 'graph:coverage' } },
      artwork: { op: 'scene.pass', inputs: { frame: link('scene', 'frame'), channel: 'graph:artwork' } },
      resized: { op: 'raster.resize', inputs: { source: link('pass', 'data'), options: { width: 4, height: 2 } } }
    },
    outputs: { resized: link('resized'), frame: link('scene'), pass: link('pass', 'report'),
      artwork: link('artwork', 'data'), valid: link('artwork', 'valid') }
  }, { operations: { fixture: { outputs: { value: 'world' }, run: () => ({ value: world }) } } });
  const { outputs } = project.run();
  assert.deepEqual(outputs.pass, { channel: 'graph:coverage', kind: 'mask', width: 8, height: 4 });
  assert.equal(outputs.resized.channels, 1);
  assert.deepEqual(Array.from(outputs.resized.data), [0, 255, 0, 0, 0, 255, 0, 0]);
  assert.deepEqual(Array.from(outputs.frame.data.slice(4 * 4, 5 * 4)), [192, 102, 49, 255]);
  assert.deepEqual(Array.from(outputs.artwork.data.slice(4 * 4, 5 * 4)), [192, 102, 49, 255]);
  assert.deepEqual(Array.from(outputs.valid.data.subarray(0, 8)), [0, 0, 255, 255, 255, 0, 0, 0]);
});

test('the procedural ferry sign renders behind glass and rain, and returns its reflection mask', () => {
  const project = require('../examples/render-graph-bridge.cjs').createProject(kit);
  const clear = project.run({ inputs: { rain: false, glass: false } }).outputs;
  const glazed = project.run({ inputs: { rain: false } }).outputs;
  const storm = project.run().outputs;
  function changedSignPixels(before, after) {
    let count = 0;
    for (let y = 51; y < 86; y++) for (let x = 116; x < 149; x++) {
      const i = (x + y * before.width) * 4;
      if ([0, 1, 2].some(channel => before.data[i + channel] !== after.data[i + channel])) count++;
    }
    return count;
  }
  const hasColor = image => image.data.some((value, index) => index % 4 !== 3 && value > 0);
  assert(changedSignPixels(clear.scene, glazed.scene) > 500);
  assert(changedSignPixels(glazed.scene, storm.scene) > 50);
  assert.equal(hasColor(glazed.rain), false);
  assert(hasColor(storm.rain));
  assert(hasColor(storm.matte));
  assert.deepEqual(storm.renderReport.graphPasses, ['puddle', 'ink-reflection']);
});

test('WebGL imports the same typed image and mask with CPU-equivalent placement', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const { browser: _browser, ...result } = runWebGL({}, fixture, (toolkit, build, backend) => {
    const { world, ...settings } = build(toolkit);
    const draw = backend(8, 4, { raw: true });
    try {
      draw.draw(world, settings);
      return draw.sample({ outside: [0, 0], half: [2, 0], upper: [4, 0], lower: [4, 3], clipped: [5, 3] });
    } finally { draw.close(); }
  });
  assert.deepEqual(result, {
    outside: [24, 40, 60], half: [128, 64, 46], upper: [232, 88, 32], lower: [32, 180, 228], clipped: [24, 40, 60]
  });
});

test('WebGL captures isolated graph images and masks as top-down rasters without changing the output', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const { browser: _browser, ...result } = runWebGL({}, fixture, (toolkit, build, backend) => {
    const { world, ...settings } = build(toolkit);
    const draw = backend(8, 4, { raw: true });
    try {
      const noCapture = draw.draw(world, settings);
      const plain = draw.image();
      const passes = draw.draw(world, { ...settings, renderGraphCapture: ['artwork', 'coverage'] });
      const same = draw.image() === plain;
      const { artwork, coverage } = passes;
      const recorder = toolkit.KIT.procedural.visualResampling.create({ fps: 8 });
      recorder.append(artwork);
      const clip = toolkit.KIT.procedural.visualResampling.compile(recorder.snapshot());
      const { value } = clip.sample(0);
      const pixel = (x, y) => Array.from(value.data.slice((y * 8 + x) * 4, (y * 8 + x + 1) * 4));
      return { noCapture: noCapture === undefined, same, upper: pixel(4, 0), lower: pixel(4, 3),
        half: pixel(2, 0), clear: pixel(0, 0), mask: Array.from(coverage.data.slice(0, 8)) };
    } finally { draw.close(); }
  });
  assert.deepEqual(result, {
    noCapture: true, same: true, upper: [232, 88, 32, 255], lower: [32, 180, 228, 255],
    half: [231, 88, 32, 128], clear: [0, 0, 0, 0], mask: [0, 0, 128, 128, 255, 0, 0, 0]
  });
});
