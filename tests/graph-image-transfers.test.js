const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const curves = require('../src/color-curves.js');
const I = Ink.load().KIT.procedural.graphImages;
const T = I.transfers, C = I.corrections;
const values = image => Array.from(image.raster.data);
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-10, value + ' != ' + expected[index]));
};
const image = (width, height, channels, data, settings = {}, pivot) =>
  I.declare({ width, height, channels, data, pivot }, { intent: channels === 1 ? 'data' : 'color', ...settings });

test('named curve stops and editable cubic handles preserve interpolation and addressing rules', () => {
  const stops = [{ id: 'low', at: 0, value: 0, out: [1 / 3, 0] },
    { id: 'high', at: 1, value: 1, in: [2 / 3, 0] }];
  const cubic = curves.scalar({ stops, interpolation: 'bezier' });
  close([cubic(-1), cubic(.25), cubic(.5), cubic(.75), cubic(1), cubic(1.25)],
    [0, .25 ** 3, .5 ** 3, .75 ** 3, 1, 1]);
  const periodic = curves.scalar({ stops, interpolation: 'bezier', address: 'repeat' });
  close([periodic(-.25), periodic(.5), periodic(1), periodic(1.25), periodic(2)], [.75 ** 3, .125, 0, .25 ** 3, 0]);
  const mixed = curves.scalar({ stops: [{ id: 'a', at: 0, value: -.25, interpolation: 'step' },
    { id: 'mid', at: .5, value: .5, interpolation: 'smooth' }, { id: 'b', at: 1, value: 2 }] });
  close([mixed(.49), mixed(.5), mixed(.75), mixed(1)], [-.25, .5, 1.25, 2]);
  assert.throws(() => curves.scalar({ stops: [stops[0], { ...stops[1], id: 'low' }] }), /unique/);
  assert.throws(() => curves.scalar({ stops: [stops[0], { ...stops[1], in: [.2, 0] }], interpolation: 'bezier' }), /ordered/);
  const edited = T.preset('soft-contrast');
  edited.value.stops[0].value = .99;
  assert.equal(T.preset('soft-contrast').value.stops[0].value, .04);
  assert.equal(T.preset('copper-tide').kind, 'ramp');
});

test('channel curves retain float HDR, association and unchanged channels', () => {
  const source = image(2, 1, 4, [.125, .25, .375, .5, 0, 0, 0, 0],
    { colorSpace: 'srgb-linear', alpha: 'premultiplied', precision: 'float32', pixelPitchMm: [.5, .8] }, [.5, .5]);
  const graded = C.curve(source, { stops: [[0, 0], [1, 4]] }, { channel: 'r' });
  assert.deepEqual(values(graded), [.5, .25, .375, .5, 0, 0, 0, 0]);
  assert.deepEqual(graded.descriptor, source.descriptor);
  assert.deepEqual(graded.raster.pivot, source.raster.pivot);
  const data = image(2, 1, 1, [-2, 2], { intent: 'height', units: 'art-px' });
  assert.deepEqual(values(C.curve(data, { stops: [[-3, -6], [3, 6]] })), [-4, 4]);
});

test('sampled ramps support linear light, alpha-aware interpolation, steps and repeating UVs', () => {
  const gray = { stops: [[0, '#000000'], [1, '#ffffff']] };
  const native = T.ramp(gray);
  close(native.sample(.5), [.5, .5, .5, 1]);
  close(T.ramp({ ...gray, interpolationSpace: 'linear' }).sample(.5),
    [.7353569830524495, .7353569830524495, .7353569830524495, 1]);
  close(T.ramp({ stops: [[0, [1, 0, 0, 0]], [1, [0, 0, 1, 1]]] }).sample(.5), [0, 0, 1, .5]);
  const rgba = T.gradient(gray, 4, 1);
  close(values(rgba).filter((_n, i) => i % 4 === 0), [.125, .375, .625, .875]);
  const repeated = T.gradient({ ...gray, address: 'repeat' }, 4, 1, { from: [.25, .5], to: [.75, .5] });
  close(values(repeated).filter((_n, i) => i % 4 === 0), [.75, .25, .75, .25]);
  const pin = { stops: [{ at: 0, value: '#000000', interpolation: 'step' },
    { at: .5, value: '#ff0000' }, { at: 1, value: '#ffffff' }] };
  close(T.ramp(pin).sample(.49), [0, 0, 0, 1]);
  close(T.ramp(pin).sample(.5), [1, 0, 0, 1]);
  assert.throws(() => T.gradient(gray, 2, 1, { from: [.5, .5], to: [.5, .5] }), /distinct/);
  const hdr = { colorSpace: 'srgb-linear', stops: [[0, [-1, 0, 1]], [1, [3, 2, 0]]] };
  close(T.ramp(hdr).sample(.5), [1, 1, .5, 1]);
  assert.throws(() => T.gradient(hdr, 4, 1, { precision: 'unorm16' }), /outside/);
  assert(I.valid(T.gradient(hdr, 4, 1, { precision: 'unorm16', outOfRange: 'clamp' })));
});

test('image-derived pins sample exact native colors, interpolate coverage and honor pixel-space arc length', () => {
  const r = image(2, 1, 4, [65535, 0, 0, 65535, 0, 0, 65535, 0], { precision: 'unorm16' });
  const derived = T.gradientFromImage(r, { count: 3, filter: 'linear' });
  assert.deepEqual(derived.stops.map(pin => [pin.id, pin.at]), [['sample-001', 0], ['sample-002', .5], ['sample-003', 1]]);
  close(derived.stops[0].value, [1, 0, 0, 1]);
  close(derived.stops[1].value, [1, 0, 0, .5]);
  close(T.ramp(derived).sample(1), [0, 0, 0, 0]);
  const tiles = image(3, 2, 3, [
    1, 0, 0, 0, 1, 0, 0, 0, 1,
    1, 1, 0, 0, 1, 1, 1, 0, 1
  ]);
  const walk = T.gradientFromImage(tiles, { path: [[0, 0], [1, 0], [1, 1]], count: 6 });
  close(walk.stops[2].value, [0, 0, 1, 1]);
  close(walk.stops[4].value, [1, 0, 1, 1]);
  assert.throws(() => T.gradientFromImage(tiles, { path: [[0, 0], [0, 0]] }), /distinct/);
});

test('gradient maps preserve source coverage and alignment in a reopenable material graph', () => {
  const source = image(2, 1, 4, [1, 0, 0, .5, 0, 1, 0, 1], { pixelPitchMm: [.3, .75] }, [.25, .5]);
  const painted = T.gradientMap(source, { stops: [[0, [0, 0, 0, .5]], [1, [1, 1, 1, .75]]] }, { channel: 'r' });
  close(values(painted), [1, 1, 1, .375, 0, 0, 0, .5]);
  assert.deepEqual(painted.raster.pivot, [.25, .5]);
  assert.deepEqual(painted.descriptor.pixelPitchMm, [.3, .75]);
  const op = (op, inputs) => ({ op, inputs }), link = node => ({ node });
  const spec = { format: 'ink-studio/graph-project', version: 1, inputs: { paint: 'colorImage' }, nodes: {
    preset: op('image.transferPreset', { name: 'soft-contrast' }),
    adjusted: op('image.curve', { source: { input: 'paint' }, curve: link('preset') }),
    extracted: op('image.gradientFromImage', { source: link('adjusted'), options: { count: 4 } }),
    preview: op('image.gradient', { ramp: link('extracted'), width: 4, height: 1 }),
    mapped: op('image.gradientMap', { source: link('adjusted'), ramp: link('extracted') })
  }, outputs: { mapped: link('mapped'), preview: link('preview'), extracted: link('extracted') },
  exports: { ramp: { output: 'extracted', format: 'json' } } };
  const graph = Ink.createGraphProject(Ink.openMaterialGraph(spec, { id: 'image-transfer' }));
  const result = graph.run({ inputs: { paint: source } });
  assert.equal(graph.plan({ paint: source }).outputs.mapped.type, 'colorImage');
  assert.equal(result.outputs.preview.raster.width, 4);
  assert.equal(JSON.parse(result.artifacts[0].bytes).stops.length, 4);
});
