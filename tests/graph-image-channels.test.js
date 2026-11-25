const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const I = Ink.load().KIT.procedural.graphImages;
const op = (op, inputs) => ({ op, inputs });
const link = (node, port = 'value') => ({ node, port });
const samples = image => Array.from(image.raster.data);
const grid = (data, settings = {}, channels = 1, pivot = [1, .5]) =>
  I.declare({ width: 2, height: 1, channels, data, pivot }, { intent: 'data', ...settings });

test('splitting preserves exact native samples, coverage, alignment and physical values', () => {
  const settings = { intent: 'color', precision: 'unorm16', alpha: 'premultiplied',
    colorSpace: 'srgb-linear', tiling: { u: 'wrap' }, pixelPitchMm: [.5, .75], materialSeed: 31 };
  const color = grid([12001, 12002, 12003, 32001, 0, 0, 0, 0], settings, 4);
  const { red, green, blue, coverage } = I.split(color, { red: 'r', green: 1, blue: 'b', coverage: 'alpha' });
  assert.deepEqual(samples(red), [12001, 0]);
  assert.deepEqual(samples(green), [12002, 0]);
  assert.deepEqual(samples(blue), [12003, 0]);
  assert.deepEqual(samples(coverage), [32001, 0]);
  assert.equal(coverage.descriptor.intent, 'mask');
  assert.equal(red.descriptor.precision, 'unorm16');
  assert.equal(red.descriptor.materialSeed, 31);
  assert.deepEqual(red.descriptor.pixelPitchMm, [.5, .75]);
  assert.deepEqual(red.raster.pivot, [1, .5]);
  const routes = ['red', 'green', 'blue', 'coverage'].map(source => ({ source, channel: 'r' }));
  const packed = I.pack({ red, green, blue, coverage }, routes,
    { intent: 'color', colorSpace: 'srgb-linear', alpha: 'premultiplied' });
  assert.deepEqual(packed, color);

  const height = grid([-2.75, 5.5], { intent: 'height', units: 'art-px', precision: 'float32' });
  assert.deepEqual(I.split(height, { h: 0 }).h, height);
  const normal = grid([-.25, .5, 1, .25, -.5, 0], { intent: 'normal', precision: 'float32' }, 3);
  assert.deepEqual(samples(I.split(normal, { x: 'x' }).x), [-.25, .25]);
  const data = grid([1, 2, 3, 4, 5, 6, 7, 8], {}, 4);
  assert.equal(I.split(data, { a: 'a' }).a.descriptor.intent, 'data');
  assert.throws(() => I.split(data, { coverage: 'alpha' }), /has no channel alpha/);
});

test('shuffle and pack route arbitrary channels, duplicate values and constants with explicit encodings', () => {
  const rgb = grid([29, 90, 111, 62, 193, 205], { intent: 'color', precision: 'unorm8' }, 3);
  const reordered = I.shuffle(rgb, ['b', { channel: 0 }, 1, 'b']);
  assert.deepEqual(samples(reordered), [111, 29, 255, 111, 205, 62, 255, 205]);
  assert.equal(reordered.descriptor.layout, 'rgba');
  assert.equal(reordered.descriptor.alpha, 'none');
  const u16 = grid([30001, 30002], { precision: 'unorm16' });
  const route = (source, channel = 'r') => ({ source, channel });
  assert.deepEqual(samples(I.pack({ rgb, u16 }, [route('u16'), route('rgb', 'g'), .5])),
    [30001, 90 * 257, 32768, 30002, 193 * 257, 32768]);
  const hdr = grid([-3.5, 2.25], { precision: 'float32' });
  const mixed = I.pack({ rgb, hdr }, [route('hdr'), route('rgb', 'g'), -.125]);
  assert.equal(mixed.descriptor.precision, 'float64');
  assert.deepEqual(samples(mixed), [-3.5, 90 / 255, -.125, 2.25, 193 / 255, -.125]);
  assert.deepEqual(samples(I.pack({ hdr }, [-3, 5])), [-3, 5, -3, 5]);
  const moved = grid([0, 1], {}, 1, [0, 0]);
  assert.throws(() => I.pack({ rgb, moved }, [route('rgb'), route('moved')]), /must match extent, pivot/);
  assert.throws(() => I.pack({ rgb }, [route('absent')]), /Unknown image packing source/);
  assert.throws(() => I.shuffle(rgb, ['a']), /has no channel a/);
  assert.throws(() => I.shuffle(rgb, [{ source: 'other', channel: 'r' }]), /shuffle route/);
  assert.throws(() => I.shuffle(rgb, [1.25]), /outside/);
});

test('alpha split, association conversion and shuffle preserve signed HDR and reject silent retagging', () => {
  const tagged = { intent: 'color', colorSpace: 'srgb-linear' };
  const source = grid([4, -.25, .5, .5, .25, .5, 1, 0], tagged, 4);
  const premult = I.convert(source, { ...tagged, alpha: 'premultiplied' });
  assert.deepEqual(samples(premult), [2, -.125, .25, .5, 0, 0, 0, 0]);
  const unpacked = I.split(premult, { rawRed: 'r', a: 'alpha' });
  assert.deepEqual(samples(unpacked.rawRed), [2, 0]);
  assert.deepEqual(samples(unpacked.a), [.5, 0]);
  const straight = I.convert(premult, { ...tagged, alpha: 'straight' });
  assert.deepEqual(samples(straight), [4, -.25, .5, .5, 0, 0, 0, 0]);
  assert.throws(() => I.shuffle(premult, ['r', 'g', 'b', 'alpha'], tagged), /matching.*association/);
  assert.throws(() => I.shuffle(straight, ['r', 'g', 'b', 'alpha'], { intent: 'color' }), /matching.*color spaces/);
  const shuffled = I.shuffle(straight, ['b', 'r', 'g', 'alpha'], tagged);
  assert.deepEqual(samples(shuffled), [.5, 4, -.25, .5, 0, 0, 0, 0]);
});

test('channel math retains sub-code increments and signed values until deliberate quantization', () => {
  const source = grid([30001, 30002], { precision: 'unorm16' });
  const increment = .25 / 65535;
  const sum = I.channelMath(source, increment, 'add');
  assert.equal(sum.descriptor.precision, 'float64');
  assert.deepEqual(samples(sum), [30001 / 65535 + increment, 30002 / 65535 + increment]);
  const signed = I.channelMath(sum, .5, 'subtract');
  assert(samples(signed).every(value => value < 0));
  const quantized = I.channelMath(source, increment, 'add', { precision: 'unorm16' });
  assert.deepEqual(samples(quantized), [30001, 30002]);
  const mixed = I.pack({ source }, [{ source: 'source', channel: 0 }, 1]);
  assert.deepEqual(samples(I.channelMath(mixed, source, 'multiply')),
    [(30001 / 65535) ** 2, 30001 / 65535, (30002 / 65535) ** 2, 30002 / 65535]);
  assert.throws(() => I.channelMath(source, 0, 'divide'), /nonfinite sample at index 0/);
  assert.throws(() => I.channelMath(source, 5, 'add', { precision: 'unorm16' }), /outside/);
  assert.deepEqual(samples(I.channelMath(source, 5, 'add', { precision: 'unorm16', outOfRange: 'clamp' })), [65535, 65535]);
  const mask = grid([.2, .8], { intent: 'mask' });
  assert.throws(() => I.channelMath(mask, 1, 'add'), /outside/);
});

test('stock channel nodes compose in an editable material graph and retain export type and values', () => {
  const inputs = { increment: { type: 'number', default: .25 / 65535 } };
  const nodes = {
    fill: op('image.uniform', { value: [1, .5, .25, .75], width: 2, height: 1,
      descriptor: { intent: 'color', layout: 'rgba', precision: 'unorm16' } }),
    separate: op('image.split', { source: link('fill'), channels: { red: 'r', alpha: 'alpha' } }),
    arithmetic: op('image.channelMath', { a: link('separate', 'alpha'), b: { input: 'increment' }, operation: 'subtract' }),
    original: op('image.shuffle', { source: link('fill'), routes: ['r', 'b', 'g', 'alpha'] }),
    combine: op('data.record', { alpha: link('arithmetic'), color: link('original') }),
    pack: op('image.pack', { sources: link('combine'), routes: [{ source: 'alpha', channel: 0 }, .5,
      { source: 'color', channel: 2 }, { source: 'color', channel: 3 }] })
  };
  const project = Ink.createGraphProject(Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1, inputs, nodes, outputs: { result: link('pack') },
    exports: { channels: { output: 'result', format: 'json' } }
  }, { id: 'aligned-channels' }));
  const expected = [49151 / 65535 - .25 / 65535, .5, 32768 / 65535, 49151 / 65535];
  const result = project.run();
  assert.deepEqual(samples(result.outputs.result), [...expected, ...expected]);
  assert.equal(result.outputs.result.descriptor.precision, 'float64');
  assert(I.valid(JSON.parse(result.artifacts[0].bytes)));
});
