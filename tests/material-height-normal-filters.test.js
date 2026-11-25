const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const PNG = require('../cli/png.js');
const { graphImages: image } = Ink.load().KIT.procedural;
const { heightToNormal, normalDecode, normalNormalize, normalInvert, normalRotate, normalOrientation,
  normalCombine, normalSpace, heightBlend } = image.normals;

function typed(width, height, channels, data, settings) {
  return image.declare({ width, height, channels, data: Float64Array.from(data) }, settings);
}
const height = (values, units = 'art-px') => typed(values.length, 1, 1, values, { intent: 'height', units });
const normal = (values, spec = {}, channels = 3) => typed(values.length / channels, 1, channels, values,
  { intent: 'normal', ...spec });
const mask = values => typed(values.length, 1, 1, values, { intent: 'mask' });
const samples = image => Array.from(image.raster.data);
const approx = (got, expected, tolerance = 1e-8) => {
  assert.equal(got.length, expected.length);
  got.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= tolerance, n + ' differs from ' + expected[i]));
};
const unit = v => v.map(n => n / Math.hypot(...v));

test('height derivatives respect physical pitch, top-left coordinates and wrapped neighbors', () => {
  const ramp = typed(3, 3, 1, [0, 1, 2, 2, 3, 4, 4, 5, 6],
    { intent: 'height', units: 'mm', pixelPitchMm: [.5, 2] });
  for (const method of ['central', 'sobel', 'scharr']) {
    const result = heightToNormal(ramp, { method, precision: 'float64' });
    approx(samples(result).slice(12, 15), unit([-2, 1, 1]));
    assert.equal(result.descriptor.normalSpace, 'tangent');
    assert.equal(result.descriptor.normalOrientation, 'opengl');
    assert.deepEqual(result.descriptor.pixelPitchMm, [.5, 2]);
  }
  const wrapped = heightToNormal(ramp, { border: { u: 'wrap', v: 'clamp' }, method: 'scharr', precision: 'float64' });
  approx(samples(wrapped).slice(9, 12), unit([1, 1, 1]));
  assert.deepEqual(wrapped.descriptor.tiling, { u: 'wrap', v: 'clamp' });
  const inverted = heightToNormal(ramp, { strength: -2, spacing: [1, 2], orientation: 'directx', precision: 'float64' });
  approx(samples(inverted).slice(12, 15), unit([2, 2, 1]));
  assert.deepEqual(samples(heightToNormal(height([9]), { strength: 0, precision: 'unorm8' })), [128, 128, 255]);
  assert.throws(() => heightToNormal(ramp, { spacing: [1, 0] }), /spacing/);
});

test('normal import treats encoded RGB as data and orientation conversion flips the green codes only', () => {
  const rock = normalDecode({ width: 2, height: 1, channels: 4, colorSpace: 'srgb',
    data: Uint8Array.of(25, 165, 212, 47, 152, 252, 1, 238) }, { orientation: 'directx' });
  assert.equal(rock.descriptor.colorSpace, 'none');
  assert.equal(rock.descriptor.normalOrientation, 'directx');
  const gl = normalOrientation(rock, { orientation: 'opengl' });
  assert.deepEqual(samples(gl), [25, 90, 212, 47, 152, 3, 1, 238]);
  assert.deepEqual(samples(normalOrientation(gl, { orientation: 'directx' })), samples(rock));
  const signed = image.convert(gl, { intent: 'normal', precision: 'float64' });
  approx(samples(signed).slice(0, 4), [2 * 25 / 255 - 1, 2 * 90 / 255 - 1, 2 * 212 / 255 - 1, 47 / 255]);
  assert.equal(signed.descriptor.normalOrientation, 'opengl');
  const sixteen = image.convert(signed, { intent: 'normal', precision: 'unorm16' });
  assert.deepEqual(samples(sixteen), samples(gl).map(n => n * 257));
  const { x } = image.split(gl, { x: 'x' });
  assert.equal(x.descriptor.normalOrientation, undefined);
  assert.deepEqual(samples(x), [25, 152]);
});

test('normalize, inversion and right-handed rotation preserve the intended vector and coverage', () => {
  const value = normal([.3, .4, 0, .35, 0, 0, 0, .6], {}, 4);
  approx(samples(normalNormalize(value)), [.6, .8, 0, .35, 0, 0, 1, .6]);
  approx(samples(normalNormalize(value, { fallback: [1, 0, 0] })), [.6, .8, 0, .35, 1, 0, 0, .6]);
  approx(samples(normalInvert(value, { axes: 'x' })), [-.3, .4, 0, .35, 0, 0, 0, .6]);
  approx(samples(normalRotate(value, { degrees: 90 })), [-.8, .6, 0, .35, 0, 0, 1, .6]);
  const associated = normal([0, .3, .4, .5, 0, 0, 0, 0], { alpha: 'premultiplied' }, 4);
  approx(samples(normalInvert(associated, { axes: 'y' })), [0, -.3, .4, .5, 0, 0, 0, 0]);
  assert.throws(() => normalRotate(value, { axis: [0, 0, 0] }), /nonzero/);
});

test('RNM preserves a flat detail, uses the base tangent, and gates coverage only on contribution', () => {
  const a = normal([.6, 0, .8]), b = normal([0, .6, .8]);
  approx(samples(normalCombine(a, b)), [.48, .6, .64]);
  approx(samples(normalCombine(a, normal([0, 0, 1]))), samples(a));
  approx(samples(normalCombine(normal([0, 0, 1]), b)), samples(b));
  approx(samples(normalCombine(a, b, { method: 'whiteout' })), unit([.6, .6, .64]));
  approx(samples(normalCombine(a, b, {}, mask([0]))), samples(a));
  approx(samples(normalCombine(normal([0, 0, -1]), b)), [0, -.6, -.8]);
  const base = normal([.6, 0, .8, .72], {}, 4), detail = normal([0, .6, .8, .5], {}, 4);
  approx(samples(normalCombine(base, detail)), [...unit([.54, .3, .72]), .72]);
  const world = normal([.6, 0, .8], { normalSpace: 'world' });
  assert.throws(() => normalCombine(world, world), /method/);
  approx(samples(normalCombine(world, world, { method: 'lerp' })), samples(world));
});

test('world and tangent conversion use the orthonormal frame in each direction', () => {
  const authored = normal([0, .6, .8]);
  const frame = { normal: [0, 2, 0], tangent: [2, .2, 0], handedness: -1 };
  const localDX = normalOrientation(authored, { orientation: 'directx' });
  const world = normalSpace(localDX, { frame });
  approx(samples(world), [0, .8, .6]);
  assert.equal(world.descriptor.normalSpace, 'world');
  assert.equal(world.descriptor.normalOrientation, undefined);
  const unpacked = normalSpace(world, { frame, orientation: 'directx' });
  approx(samples(unpacked), samples(localDX));
  assert.equal(unpacked.descriptor.normalOrientation, 'directx');
  assert.throws(() => normalOrientation(world), /tangent/);
  assert.throws(() => normalSpace(authored, { frame: { normal: [1, 0, 0] } }), /independent tangent/);
});

test('per-texel surface frames honor UV handedness and survive a round trip', () => {
  const local = normal([0, .6, .8, 0, .6, .8]);
  const surfaces = normal([0, 0, 1, 0, 1, 0], { normalSpace: 'world' });
  const tangents = typed(2, 1, 3, [1, 0, 0, 1, .25, 0], { intent: 'data' });
  const signs = typed(2, 1, 1, [1, -1], { intent: 'data' });
  const world = normalSpace(local, {}, surfaces, tangents, signs);
  approx(samples(world), [0, .6, .8, 0, .8, .6]);
  approx(samples(normalSpace(world, {}, surfaces, tangents, signs)), samples(local));
  assert.throws(() => normalSpace(local, {}, surfaces), /paired frame maps/);
  assert.throws(() => normalSpace(local, {}, surfaces, tangents, mask([0])), /aligned scalar/);
});

test('controlled height blending returns the same soft selector that moves the relief', () => {
  const base = height([2, 2, 2, 2, 2]), layer = height([0, 1, 2, 3, 4]);
  const mixed = heightBlend(base, layer, { softness: 2 });
  approx(samples(mixed.weight), [0, .15625, .5, .84375, 1]);
  approx(samples(mixed.value), [2, 1.84375, 2, 2.84375, 4]);
  assert.equal(mixed.value.descriptor.units, 'art-px');
  assert.equal(mixed.weight.descriptor.intent, 'mask');
  approx(samples(heightBlend(base, layer, { offset: 1, bias: -1, opacity: .5 }, mask([1, 1, 0, .5, 1])).value),
    [2, 2, 2, 2.5, 3.5]);
  approx(samples(heightBlend(base, layer, { mode: 'mix', opacity: .5 }).value), [1, 1.5, 2, 2.5, 3]);
  assert.throws(() => heightBlend(base, height([0, 1, 2, 3, 4], 'mm')), /matching units/);
});

test('editable graphs keep typed normal outputs and export tagged OpenGL and DirectX PNGs', () => {
  const link = node => ({ node, port: 'value' });
  const op = (op, inputs) => ({ op, inputs });
  const source = op('image.declare', { source: { width: 1, height: 1, channels: 3, data: [0, .6, .8] },
    descriptor: { intent: 'normal' } });
  const graph = { format: 'ink-studio/graph-project', version: 1, nodes: {
    source, direct: op('image.normalOrientation', { source: link('source'), options: { orientation: 'directx' } })
  }, outputs: { gl: link('source'), dx: link('direct') }, outputUsages: Object.fromEntries(['gl','dx'].map((output, order) =>
    [output, { usage: 'normal', label: output, order, format: { format: 'png', bitDepth: 16 }, source: { output } }])) };
  const editable = Ink.openMaterialGraph(graph, { id: 'normal-filter' });
  const project = Ink.createGraphProject(JSON.parse(JSON.stringify(editable)));
  const result = project.run(), gl = PNG.raster(result.artifacts[0].bytes).data, dx = PNG.raster(result.artifacts[1].bytes).data;
  assert.equal(gl[1] + dx[1], 65535);
  assert.equal(gl[2], dx[2]);
  assert.equal(result.outputs.dx.descriptor.normalOrientation, 'directx');
  source.inputs.descriptor.intent = 'color';
  assert.throws(() => Ink.createGraphProject(graph), /typed normal image/);
});
