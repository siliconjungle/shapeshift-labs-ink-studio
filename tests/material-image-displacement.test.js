const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const { graphImages: image } = Ink.load().KIT.procedural;
const { directionalWarp, nonuniformWarp, vectorWarp, slopeWarp, multiDirectionalWarp } = image.warps;

function data(width, height, values, options = {}, channels = 1) {
  return image.declare({ width, height, channels, data: Float64Array.from(values) }, { intent: 'data', ...options });
}
const samples = value => Array.from(value.raster.data);
const row = (...values) => data(values.length, 1, values);
const constant = value => row(value);
const close = (got, want) => assert.ok(Math.abs(got - want) < 1e-9, got + ' differs from ' + want);

test('scalar displacement controls direction, sign, neutral point, units and independent intensity', () => {
  const source = row(11, 22, 33, 44), map = constant(.75);
  const opts = { amount: 2, center: .25, border: 'wrap' };
  assert.deepEqual(samples(directionalWarp(source, map, opts)), [44, 11, 22, 33]);
  assert.deepEqual(samples(directionalWarp(source, map, { ...opts, amount: -2 })), [22, 33, 44, 11]);
  assert.deepEqual(samples(directionalWarp(source, map, { ...opts, amount: .5, units: 'normalized' })), [44, 11, 22, 33]);
  assert.deepEqual(samples(directionalWarp(source, map, opts, row(1, 0, 1, 0))), [44, 22, 22, 44]);
  const square = data(2, 2, [1, 2, 3, 4]);
  assert.deepEqual(samples(directionalWarp(square, constant(1), { angle: 90, border: 'transparent' })), [0, 0, 1, 2]);
  assert.throws(() => directionalWarp(source, map, {}, constant(1.01)), /within/);
  assert.throws(() => directionalWarp(source, map, { amount: Infinity }), /amount/);
});

test('angular maps interpolate and smooth on the unit circle across a full turn', () => {
  const source = row(10, 20, 30, 40, 50), distance = constant(1);
  const circulate = (direction, options) => samples(nonuniformWarp(source, distance, direction,
    { width: 1, filter: 'nearest', ...options }))[0];
  assert.equal(circulate(row(.99, .01)), 20);
  assert.equal(circulate(row(.99, .01), { smooth: 1, mapBorder: 'wrap' }), 20);
  assert.equal(circulate(row(.99, .01), { directionScale: 0, angle: 180 }), 40);
  assert.equal(circulate(row(0, .5)), 30);
  assert.deepEqual(samples(nonuniformWarp(source, distance, row(0, .5, 0, .5, 0), { border: 'wrap' })),
    [50, 30, 20, 50, 40]);
});

test('vector warp decodes RG and flips between image-space and Y-up conventions', () => {
  const source = data(3, 2, [1, 2, 3, 4, 5, 6]);
  const flow = data(1, 1, [1, -1], {}, 2);
  const opts = { border: { u: 'wrap', v: 'transparent' } };
  assert.deepEqual(samples(vectorWarp(source, flow, opts)), [6, 4, 5, 0, 0, 0]);
  assert.deepEqual(samples(vectorWarp(source, flow, { ...opts, yAxis: 'up' })), [0, 0, 0, 3, 1, 2]);
  const packed = image.declare({ width: 1, height: 1, channels: 2, data: Uint8Array.of(255, 0) }, { intent: 'data' });
  assert.deepEqual(samples(vectorWarp(source, packed, opts)), samples(vectorWarp(source, flow, opts)));
  assert.throws(() => vectorWarp(source, flow, { encoding: 'unorm' }), /encoding range/);
  assert.throws(() => vectorWarp(source, constant(1)), /RG data/);
});

test('height slopes move uphill or downhill against their own grid and preserve flat regions', () => {
  const source = row(10, 20, 30, 40, 50);
  const height = data(5, 1, [0, 1, 2, 3, 4], { intent: 'height', units: 'art-px' });
  const down = samples(slopeWarp(source, height, { filter: 'linear' }));
  down.forEach((value, i) => close(value, [15, 30, 40, 50, 50][i]));
  const up = samples(slopeWarp(source, height, { filter: 'linear', slope: 'uphill' }));
  up.forEach((value, i) => close(value, [10, 10, 20, 30, 45][i]));
  assert.deepEqual(samples(slopeWarp(source, constant(10))), samples(source));
  const wrapped = samples(slopeWarp(source, height, { mapBorder: 'wrap', border: 'wrap', filter: 'linear' }));
  close(wrapped[0], 45);
  close(wrapped[4], 35);
  const sparseHeight = row(.5, 2.5, 4.5, 6.5);
  const denseHeight = row(0, 1, 2, 3, 4, 5, 6, 7);
  const spaced = row(10, 20, 30, 40, 50, 60, 70, 80);
  close(samples(slopeWarp(spaced, sparseHeight, { filter: 'linear' }))[3],
    samples(slopeWarp(spaced, denseHeight, { filter: 'linear' }))[3]);
});

test('Gaussian driver smoothing sees wrapped neighbors and keeps separate source addressing', () => {
  const source = row(0, 10, 20, 30, 40), driver = row(1, 0, 0, 0, 0);
  const opts = { filter: 'linear', smooth: 1, border: 'clamp', mapFilter: 'nearest' };
  const wrapped = samples(directionalWarp(source, driver, { ...opts, mapBorder: 'wrap' }));
  const clamped = samples(directionalWarp(source, driver, opts));
  const weight = Math.exp(-2) / (1 + 2 * Math.exp(-2));
  close(wrapped[1], 10 * (1 - weight));
  close(wrapped[4], 40 - 10 * weight);
  close(clamped[4], 40);
  const shift = values => [values.at(-1), ...values.slice(0, -1)];
  const options = { ...opts, border: 'wrap', mapBorder: 'wrap' };
  const moved = samples(directionalWarp(row(...shift(samples(source))), row(...shift(samples(driver))), options));
  shift(samples(directionalWarp(source, driver, options))).forEach((expected, i) => close(moved[i], expected));
});

test('opposed multidirectional passes can chain without global drift or blend independent samples', () => {
  const source = row(0, 12, 60, 24, 48), distance = constant(1);
  const opts = { axes: 1, border: 'wrap', mapBorder: 'wrap' };
  assert.deepEqual(samples(multiDirectionalWarp(source, distance, opts)), samples(source));
  for (const [combine, expected] of [['average', [30, 30, 18, 54, 12]], ['min', [12, 0, 12, 48, 0]],
    ['max', [48, 60, 24, 60, 24]]]) {
    assert.deepEqual(samples(multiDirectionalWarp(source, distance, { ...opts, combine })), expected);
    assert.deepEqual(samples(multiDirectionalWarp(source, distance, { ...opts, combine, amount: -1 })), expected);
  }
  const authored = row(0, 1, 1, 1, 0);
  const chained = samples(multiDirectionalWarp(source, authored, opts));
  assert.deepEqual(chained, [0, 0, 60, 24, 48]);
  assert.notDeepEqual(chained, samples(multiDirectionalWarp(source, authored, { ...opts, amount: -1 })));
});

test('resampling protects typed codes and alpha while multi-axis averaging uses associated linear light', () => {
  const source = image.declare({ width: 3, height: 1, channels: 4,
    data: Uint16Array.of(65535, 0, 0, 0, 10, 20, 30, 8, 0, 0, 65535, 65535) }, { intent: 'color' });
  const moved = directionalWarp(source, constant(1), { border: 'wrap' });
  assert.deepEqual(moved.descriptor, source.descriptor);
  assert.deepEqual(samples(moved).slice(0, 8), [0, 0, 65535, 65535, 65535, 0, 0, 0]);
  const blended = multiDirectionalWarp(source, constant(1), { axes: 1, combine: 'average', border: 'wrap' });
  assert.deepEqual(samples(blended).slice(4, 8), [0, 0, 65535, 32768]);
  const zero = multiDirectionalWarp(source, constant(1), { amount: 0, axes: 4, combine: 'max' });
  assert.deepEqual(samples(zero), samples(source));
  const alternating = row(0, 1, 0, 1, 0, 1, 0, 1);
  assert.deepEqual(samples(directionalWarp(alternating, constant(1), { width: 2, mip: 'linear', border: 'wrap' })),
    [.5, .5]);
});

test('editable graph can reconnect a typed intensity driver and keep the color output socket', () => {
  const link = node => ({ node, port: 'value' });
  const uniform = (value, descriptor) => ({ op: 'image.uniform', inputs: { value, descriptor, width: 4, height: 1 } });
  const graph = { format: 'ink-studio/graph-project', version: 1, nodes: {
    color: uniform([.3, .5, .7], { intent: 'color' }),
    gradient: uniform(1, { intent: 'data' }),
    mask: uniform(.5, { intent: 'mask' }),
    warp: { op: 'image.directionalWarp', inputs: { source: link('color'), map: link('gradient'), intensity: link('mask'),
      options: { amount: 2, border: 'transparent' } } },
    display: { op: 'image.toDisplay', inputs: { source: link('warp') } }
  }, outputs: { value: link('display') } };
  const editable = Ink.openMaterialGraph(graph, { id: 'warp' });
  const project = Ink.createGraphProject(JSON.parse(JSON.stringify(editable)));
  assert.deepEqual(Array.from(project.run().outputs.value.data.slice(0, 6)), [0, 0, 0, 77, 128, 179]);
});
