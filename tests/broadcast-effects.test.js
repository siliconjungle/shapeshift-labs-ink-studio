const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { generator, pixelEffects, graph, data } = KIT.procedural;
const { smpteColorBars, tvStatic } = generator;

function sample(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  return [...frame.data.subarray(i, i + 4)];
}

test('EG 1 bars include the reverse-blue strip and three PLUGE steps', () => {
  const picture = smpteColorBars({ width: 168 });
  assert.equal(picture.height, 126);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => sample(picture, 12 + 24 * i, 0)), [
    [191, 191, 191, 255], [191, 191, 0, 255], [0, 191, 191, 255], [0, 191, 0, 255],
    [191, 0, 191, 255], [191, 0, 0, 255], [0, 0, 191, 255]
  ]);
  assert.deepEqual(sample(picture, 12, 85), [0, 0, 191, 255]);
  assert.deepEqual(sample(picture, 36, 85), [0, 0, 0, 255]);
  assert.deepEqual(sample(picture, 48, 125), [255, 255, 255, 255]);
  assert.deepEqual(sample(picture, 125, 125), [0, 0, 0, 255]);
  const coded = smpteColorBars({ width: 168, levels: 'limited' });
  assert.deepEqual([125, 132, 141].map(x => sample(coded, x, 125)[0]), [7, 16, 25]);
  const blue = smpteColorBars({ width: 168, blueOnly: true });
  assert.deepEqual(sample(blue, 12, 0), [0, 0, 191, 255]);
  assert.deepEqual(sample(blue, 36, 0), [0, 0, 0, 255]);
});

test('RP 219 bars include side panels, a luminance ramp and HD PLUGE', () => {
  const picture = smpteColorBars({ pattern: 'rp219', width: 224, levels: 'limited' });
  assert.equal(picture.height, 126);
  assert.deepEqual(sample(picture, 0, 0), [104, 104, 104, 255]);
  assert.deepEqual(sample(picture, 40, 0), [180, 180, 180, 255]);
  assert.deepEqual(sample(picture, 215, 75), [16, 16, 235, 255]);
  assert.deepEqual(sample(picture, 0, 90), [235, 235, 16, 255]);
  assert.equal(sample(picture, 40, 90)[0], 16);
  assert.ok(sample(picture, 156, 90)[0] > sample(picture, 86, 90)[0]);
  assert.equal(sample(picture, 173, 90)[0], 235);
  assert.deepEqual([136, 144, 152, 160, 168].map(x => sample(picture, x, 125)[0]), [12, 16, 20, 16, 25]);
  assert.deepEqual(sample(picture, 223, 125), [49, 49, 49, 255]);
  assert.equal(smpteColorBars({ width: 1, height: 1 }).data[3], 255);
  assert.throws(() => smpteColorBars({ pattern: 'unknown' }), /pattern/);
  assert.throws(() => smpteColorBars({ width: 2000, height: 2001 }), /budget/);
});

test('static is seekable, has distinct presets, and can hold frames or form coarse grains', () => {
  const options = { width: 21, height: 13, seed: 103, rate: 12 };
  const frames = ['snow', 'chroma', 'weak-signal', 'tracking'].map(preset => tvStatic({ ...options, preset }));
  assert.equal(new Set(frames.map(frame => frame.data.join(','))).size, 4);
  assert.ok(frames[0].data.every((v, i, a) => i % 4 === 3 ? v === 255 : v === a[i - i % 4]));
  assert.ok(frames[1].data.some((v, i, a) => i % 4 === 0 && v !== a[i + 1]));
  const at = time => tvStatic({ ...options, preset: 'tracking', time }).data;
  const first = at(.5);
  assert.deepEqual(first, at(.56));
  assert.notDeepEqual(first, at(.6));
  assert.deepEqual(first, at(.5));
  assert.notDeepEqual(at(-.5), first);
  assert.notDeepEqual(first, tvStatic({ ...options, preset: 'tracking', time: .5, seed: 104 }).data);
  const frozen = { ...options, rate: 0, grain: [5, 3], rowNoise: 0, scanlines: 0 };
  const held = tvStatic(frozen);
  assert.deepEqual(held, tvStatic({ ...frozen, time: 500 }));
  assert.deepEqual(sample(held, 0, 0), sample(held, 4, 2));
  assert.notDeepEqual(sample(held, 0, 0), sample(held, 5, 0));
  assert.throws(() => tvStatic({ preset: 'constructor' }), /preset/);
  assert.throws(() => tvStatic({ grain: [2, 0] }), /grain/);
  assert.throws(() => tvStatic({ band: { height: 0 } }), /appearance/);
});

test('TV static blends RGB and preserves source alpha, pivot, dimensions and untouched pixels', () => {
  const source = { width: 3, height: 1, channels: 4, pivot: [1, .5],
    data: Uint8Array.of(15, 30, 45, 180, 100, 120, 140, 0, 151, 170, 180, 255) };
  const opts = { seed: 5, opacity: .5 };
  const original = source.data.slice(), result = pixelEffects.tvStatic(source, opts);
  const layer = tvStatic({ ...opts, width: source.width, height: source.height });
  assert.deepEqual(result.pivot, source.pivot);
  assert.deepEqual(sample(result, 0, 0), [0, 1, 2].map(i =>
    Math.round(original[i] + (layer.data[i] - original[i]) * 128 / 255)).concat(180));
  assert.deepEqual(sample(result, 1, 0), sample(source, 1, 0));
  assert.equal(sample(result, 2, 0)[3], 255);
  assert.deepEqual(source.data, original);
  assert.deepEqual(pixelEffects.tvStatic(source, { opacity: 0 }), source);
  assert.deepEqual(pixelEffects.tvStatic(source, { density: 0 }), source);
});

test('typed graphs can generate patterns and animate static with the graph time and seed', () => {
  const link = node => ({ node });
  const options = { width: 14, height: 12, rate: 20 };
  const session = graph.create({ nodes: {
    bars: { op: 'proc.smpteColorBars', inputs: { options: { value: options } } },
    static: { op: 'proc.tvStatic', inputs: { options: { value: options } } },
    mixed: { op: 'fx.tvStatic', inputs: { source: link('bars'), options: { value: { preset: 'tracking', opacity: .4 } } } }
  }, outputs: { bars: link('bars'), static: link('static'), mixed: link('mixed') } });
  const at = time => session.evaluate({}, { time, seed: 22 }).outputs;
  const first = at(.3);
  assert.deepEqual(first.bars, smpteColorBars(options));
  assert.deepEqual(first.static, tvStatic({ ...options, time: .3, seed: data.hash('static', 22) }));
  assert.deepEqual(first.mixed, pixelEffects.tvStatic(first.bars,
    { preset: 'tracking', opacity: .4, time: .3, seed: data.hash('mixed', 22) }));
  assert.notDeepEqual(at(.8).mixed.data, first.mixed.data);
  assert.deepEqual(at(.3).mixed, first.mixed);
});
