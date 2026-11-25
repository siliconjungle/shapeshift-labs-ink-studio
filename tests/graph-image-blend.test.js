const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const { graphImages: I, raster: R } = Ink.load().KIT.procedural;
const link = node => ({ node });
const scalar = (data, descriptor = {}, width = data.length, height = 1) =>
  I.declare({ width, height, channels: 1, data }, { intent: 'data', ...descriptor });
const color = (value, settings = {}) => I.uniform(value, 1, 1,
  { intent: 'color', layout: value.length === 4 ? 'rgba' : 'rgb', colorSpace: 'srgb-linear', ...settings });
const samples = image => Array.from(image.raster.data);
const close = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  for (const [i, value] of actual.entries())
    assert(Math.abs(value - expected[i]) <= 1e-12, label + ' sample ' + i + ': ' + value + ' ≠ ' + expected[i]);
};

test('each Designer atomic mode has opaque per-channel fixtures and shared legacy byte formulas agree', () => {
  const background = scalar([.25, .75, .5]), foreground = scalar([.75, .25, .5]);
  const rows = {
    copy: [.75, .25, .5], add: [1, 1, 1], subtract: [0, .5, 0], multiply: [.1875, .1875, .25],
    addSub: [.5, .5, .5], max: [.75, .75, .5], min: [.25, .25, .5], switch: [.75, .25, .5],
    divide: [1 / 3, 1, 1], overlay: [.375, .625, .5], screen: [.8125, .8125, .75],
    softLight: [.375, .65625, .5]
  };
  for (const [mode, expected] of Object.entries(rows))
    close(samples(I.blend(background, foreground, { mode, clamp: 'mode' })), expected, mode);

  const back8 = R.canvas({ width: 1, height: 1, color: [44, 115, 203, 255] });
  const front8 = R.canvas({ width: 1, height: 1, color: [180, 94, 78, 255] });
  const typed = value => I.declare(value, { intent: 'color', precision: 'unorm8' });
  for (const [mode, legacy] of Object.entries({ copy: 'normal', add: 'add', subtract: 'subtract', multiply: 'multiply',
    max: 'lighten', min: 'darken', overlay: 'overlay', screen: 'screen', softLight: 'softLight',
    hardLight: 'hardLight', difference: 'difference', exclusion: 'exclusion' })) {
    assert.deepEqual(samples(I.blend(typed(back8), typed(front8), { mode, opacity: .6 })),
      Array.from(R.blend(back8, front8, { mode: legacy, opacity: .6 }).data), mode);
  }
});

test('foreground and background order, scalar opacity, grayscale mask and all crop edges', () => {
  const back = scalar(Array(16).fill(.25), {}, 4, 4), front = scalar(Array(16).fill(.75), {}, 4, 4);
  const mask = scalar([255, 255, 255, 255, 255, 255, 128, 255, 255, 0, 255, 255, 255, 255, 255, 255],
    { intent: 'mask', precision: 'unorm8' }, 4, 4);
  const crop = { left: .375, right: .875, top: .375, bottom: .875 };
  const expected = Array(16).fill(.25);
  expected[5] = .5;
  expected[6] = .25 + .25 * 128 / 255;
  expected[10] = .5;
  close(samples(I.blend(back, front, { mask, crop, opacity: .5 })), expected, 'masked crop');
  assert.deepEqual(samples(I.blend(back, front, { mode: 'subtract' })), Array(16).fill(-.5));
  assert.deepEqual(samples(I.blend(front, back, { mode: 'subtract' })), Array(16).fill(.5));
  assert.deepEqual(samples(I.blend(back, front, { mode: 'switch', opacity: 0 })), samples(back));
  assert.deepEqual(samples(I.blend(back, front, { mode: 'switch', opacity: 1 })), samples(front));
  assert.throws(() => I.blend(back, front, { crop: { left: .8, right: .6 } }), /ordered edges/);
  assert.throws(() => I.blend(back, front, { mask: scalar([1], { intent: 'mask' }) }), /mask must match/);
  assert.throws(() => I.blend(back, front, { mask: back }), /typed mask/);
  assert.throws(() => I.blend(back, scalar([.75])), /aligned/);
  assert.throws(() => I.blend(back, color([1, 0, 0])), /matching/);
  assert.throws(() => I.blend(color([1, 0, 0]), color([1, 0, 0], { colorSpace: 'srgb' })), /color space/);
});

test('source, ignore, straight and premultiplied alpha use documented compositing and encoding', () => {
  const back = color([1, 0, 0, .5]), front = color([0, 0, 1, .5]);
  const straight = I.blend(back, front, { alpha: 'straight', opacity: .5 });
  close(samples(straight), [.6, 0, .4, .625], 'straight');
  close(samples(I.blend(back, front, { opacity: .5 })), samples(straight), 'source');
  close(samples(I.blend(back, front, { alpha: 'ignore', opacity: .5 })), [.5, 0, .5, .5], 'ignore');
  const premul = source => I.convert(source, { intent: 'color', alpha: 'premultiplied' });
  const premultiplied = I.blend(premul(back), premul(front), { alpha: 'premultiplied', opacity: .5 });
  assert.equal(premultiplied.descriptor.alpha, 'premultiplied');
  close(samples(premultiplied), [.375, 0, .25, .625], 'premultiplied');
  close(samples(I.blend(back, premul(front), { opacity: .5 })), samples(straight), 'mixed source');
  close(samples(I.blend(back, front, { mode: 'multiply' })), [1 / 3, 0, 1 / 3, .75], 'covered multiply');
  assert.throws(() => I.blend(back, premul(front), { alpha: 'straight' }), /requires straight/);
  assert.throws(() => I.blend(back, front, { alpha: 'premultiplied' }), /requires premultiplied/);

  const hidden = color([0, .25, 1, 0]);
  close(samples(I.blend(back, hidden)), samples(back), 'transparent foreground');
  close(samples(I.blend(back, hidden, { alpha: 'ignore' })), [0, .25, 1, .5], 'ignored transparent foreground');
  close(samples(I.blend(hidden, front, { mode: 'multiply' })), [0, 0, 1, .5], 'empty backdrop');
  const opaque = I.blend(color([1, 0, 0]), front);
  close(samples(opaque), [.5, 0, .5, 1], 'RGB plus RGBA');
  const bounded = I.blend(back, color([4, 0, 0, .01]), { mode: 'add' });
  assert(I.valid(bounded));
  const premul8 = color([1, 0, 0, .25], { precision: 'unorm8' });
  const boundedPremul = I.blend(premul(premul8), color([4, 0, 0, .01]), { mode: 'add' });
  assert(I.valid(boundedPremul));
});

test('range policies distinguish raw HDR, mode clipping, and output clipping', () => {
  const back = scalar([.75, .25, 0]), front = scalar([.75, .75, 0]);
  const blend = (mode, clamp, opacity = .5) => samples(I.blend(back, front, { mode, clamp, opacity }));
  close(blend('add', 'auto'), [1.125, .625, 0], 'HDR add');
  close(blend('add', 'mode'), [.875, .625, 0], 'mode clipped add');
  close(blend('add', 'output'), [1, .625, 0], 'output clipped add');
  close(blend('subtract', 'none'), [.375, -.125, 0], 'signed subtract');
  close(blend('subtract', 'mode'), [.375, .125, 0], 'floor before mix');
  close(blend('subtract', 'output'), [.375, 0, 0], 'floor after mix');
  const zeros = scalar([0, 0, 0]);
  close(samples(I.blend(back, zeros, { mode: 'divide', clamp: 'mode' })), [1, 1, 0], 'bounded zero divide');
  assert.throws(() => I.blend(back, zeros, { mode: 'divide' }), /finite samples/);
  close(samples(I.blend(back, zeros, { mode: 'divide', opacity: 0 })), samples(back), 'inactive divide');
  const unit = scalar([204], { intent: 'data', precision: 'unorm8' });
  assert.deepEqual(samples(I.blend(unit, unit, { mode: 'add', opacity: .5 })), [230]);
  assert.throws(() => I.blend(unit, unit, { mode: 'add', clamp: 'none' }), /outside/);
  const hdr = color([3.5, -.125, .5, .75]);
  assert.deepEqual(samples(I.blend(hdr, hdr, { mode: 'add', crop: { right: 0 }, clamp: 'output' })), samples(hdr));
});

test('image.blend runs through an editable graph and keeps height precision and background metadata', () => {
  const width = 2, height = 1, descriptor = { intent: 'height', precision: 'float32', units: 'art-px',
    tiling: { u: 'wrap' }, sampling: 'linear', pixelPitchMm: [.5, 1], materialSeed: 12 };
  const background = { op: 'image.uniform', inputs: { value: -2, width, height, descriptor } };
  const foreground = { op: 'image.uniform', inputs: { value: 4, width, height, descriptor } };
  const nodes = { background, foreground, blend: { op: 'image.blend',
    inputs: { background: link('background'), foreground: link('foreground'), opacity: { input: 'strength' } } } };
  const graph = Ink.createGraphProject(Ink.openMaterialGraph({ format: 'ink-studio/graph-project', version: 1,
    inputs: { strength: 'number' }, nodes, outputs: { relief: link('blend') },
    exports: { relief: { output: 'relief', format: 'json' } } }, { id: 'relief-blend' }));
  assert.equal(graph.plan({ strength: .25 }).outputs.relief.type, 'heightImage');
  const result = graph.run({ inputs: { strength: .25 } });
  const relief = JSON.parse(result.artifacts[0].bytes);
  assert(I.valid(relief, 'height'));
  assert.deepEqual(relief.raster.data, [-.5, -.5]);
  assert.equal(relief.descriptor.units, 'art-px');
  assert.equal(relief.descriptor.precision, 'float32');
  assert.deepEqual(relief.descriptor.pixelPitchMm, [.5, 1]);
  assert.deepEqual(relief.descriptor.tiling, { u: 'wrap', v: 'clamp' });
  assert.equal(relief.descriptor.materialSeed, 12);
});
