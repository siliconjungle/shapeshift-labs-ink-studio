const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { graphImages: image } = Ink.load().KIT.procedural;
const { transform, crop, symmetry, polar, perspective } = image.spatial;

function plane(width, height, data, spec = {}, pivot) {
  return image.declare({ width, height, channels: 1, data: Float64Array.from(data), pivot },
    { intent: 'data', ...spec });
}
const samples = value => Array.from(value.raster.data);
const row = (data, spec, pivot) => plane(data.length, 1, data, spec, pivot);
const close = (got, want) => assert.ok(Math.abs(got - want) <= 1e-10, got + ' differs from ' + want);

test('pixel-space transforms use clockwise rotation, reflections, authored pivots and forward matrices', () => {
  const source = plane(5, 5, Array.from({ length: 25 }, (_, i) => i === 8 ? 1 : 0));
  const at = (options, point) => samples(transform(source, options))[point];
  assert.equal(at({ rotation: 90 }, 18), 1);
  assert.equal(at({ rotation: 90, pivot: [2.5, 1.5] }, 12), 1);
  assert.equal(at({ scale: [-1, 1] }, 6), 1);
  assert.equal(at({ matrix: [[1, 0, -1], [0, 1, 1]], offset: [-1, 0] }, 11), 1);
  assert.equal(at({ units: 'normalized', offset: [0, .4] }, 18), 1);
  assert.equal(at({ matrix: [[1, 0, 1], [0, 1, 0]], rotation: 90, offset: [-1, 0] }, 22), 1);
  assert.throws(() => transform(source, { matrix: [[1, 1, 0], [1, 1, 1]] }), /invertible/);
  assert.throws(() => transform(source, { scale: [1, 0] }), /nonzero scale/);
  assert.deepEqual(samples(transform(plane(5, 3, Array.from({ length: 15 }, (_, i) => i === 4 ? 1 : 0)),
    { rotation: 90, border: 'transparent' })), Array(15).fill(0));
});

test('read borders address taps independently and nearest preserves stored RGBA codes', () => {
  const source = plane(3, 2, [1, 2, 3, 4, 5, 6], { tiling: { u: 'wrap', v: 'clamp' } });
  const offset = [1, 1];
  assert.deepEqual(samples(transform(source, { offset })), [3, 1, 2, 3, 1, 2]);
  assert.deepEqual(samples(transform(source, { offset, border: 'mirror' })), [1, 1, 2, 1, 1, 2]);
  assert.deepEqual(samples(transform(source, { offset, border: { u: 'clamp', v: 'wrap' } })), [4, 4, 5, 1, 1, 2]);
  assert.deepEqual(samples(transform(source, { offset, border: 'transparent' })), [0, 0, 0, 0, 1, 2]);
  assert.throws(() => transform(source, { border: { x: 'wrap' } }), /border policy/);
  const rgba = image.declare({ width: 2, height: 1, channels: 4,
    data: Uint16Array.of(55555, 43114, 1, 0, 16, 510, 48590, 65535) }, { intent: 'color' });
  const shifted = transform(rgba, { offset: [1, 0], border: 'wrap' });
  assert.deepEqual(samples(shifted), [16, 510, 48590, 65535, 55555, 43114, 1, 0]);
  assert.deepEqual(shifted.descriptor, rgba.descriptor);
  const odd = image.declare({ width: 5, height: 1, channels: 4,
    data: Uint16Array.from({ length: 20 }, (_, i) => i % 4 === 3 ? 0 : i * 2) }, { intent: 'color' });
  assert.deepEqual(samples(transform(odd, { mip: 'linear' })), samples(odd));
});

test('bilinear and mip reads use linear-light associated color and preserve signed HDR', () => {
  const color = codes => image.declare({ width: 2, height: 1, channels: 4, data: Uint8Array.from(codes) },
    { intent: 'color' });
  const blackWhite = color([0, 0, 0, 255, 255, 255, 255, 255]);
  const blueAndHidden = color([0, 0, 255, 255, 255, 0, 0, 0]);
  for (const resampling of [{ filter: 'linear' }, { mip: 1 }]) {
    const apply = source => samples(transform(source, { width: 1, ...resampling }));
    assert.deepEqual(apply(blackWhite), [188, 188, 188, 255]);
    assert.deepEqual(apply(blueAndHidden), [0, 0, 255, 128]);
  }
  const hdr = image.declare({ width: 2, height: 1, channels: 4,
    data: Float64Array.of(4, -.25, 2, .5, 0, 0, 0, 0) },
  { intent: 'color', alpha: 'premultiplied', colorSpace: 'srgb-linear' });
  assert.deepEqual(samples(transform(hdr, { width: 1, mip: 1 })), [2, -.125, 1, .25]);
  const encoded = image.declare({ width: 2, height: 1, channels: 4, data: Uint16Array.of(0, 0, 34001, 34001, 0, 0, 0, 0) },
    { intent: 'color', alpha: 'premultiplied' });
  const midpoint = transform(encoded, { width: 1, mip: 1 });
  assert.ok(image.valid(midpoint));
  assert.deepEqual(samples(midpoint), [0, 0, 17001, 17001]);
});

test('LOD handles box-integrated odd extents, fractional blends and local minification', () => {
  const source = row([0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(samples(transform(source, { width: 2 })), [0, 0]);
  assert.deepEqual(samples(transform(source, { width: 2, mip: 'nearest' })), [.5, .5]);
  assert.deepEqual(samples(transform(source, { width: 2, mip: 'linear' })), [.5, .5]);
  assert.deepEqual(samples(transform(source, { width: 2, mip: .5 })), [.25, .25]);
  assert.deepEqual(samples(transform(source, { width: 2, mip: 'nearest', mipBias: -2 })), [0, 0]);
  close(samples(transform(row([1, 2, 3, 4, 6, 8, 11]), { mip: 100 }))[0], 5);
  const odd = row([0, 0, 1, 0, 1]);
  samples(transform(odd, { width: 2, mip: 1 })).forEach((v, i) => close(v, [.2, .6][i]));
  const wide = plane(64, 64, Array.from({ length: 4096 }, (_, i) => (i % 64 + Math.floor(i / 64)) & 1));
  const corners = [[.33, 0], [.67, 0], [1, 1], [0, 1]];
  const warped = samples(perspective(wide, { corners, mip: 'nearest' }));
  assert.equal(warped[32], .5);
  assert.ok([0, 1].includes(warped[63 * 64 + 32]));
  assert.throws(() => transform(source, { mip: 'wrong' }), /mip/);
});

test('cropping updates physical pitch and canvas pivot, and can address beyond the source', () => {
  const source = row([100, 200, 300, 400], { pixelPitchMm: [.4, .8], materialSeed: 13 }, [1.5, .5]);
  const cropped = crop(source, { rect: [1, 0, 2, 1] });
  assert.deepEqual(samples(cropped), [200, 300]);
  assert.deepEqual(cropped.raster.pivot, [.5, .5]);
  assert.deepEqual(cropped.descriptor.pixelPitchMm, [.4, .8]);
  assert.equal(cropped.descriptor.materialSeed, 13);
  const resampled = crop(source, { units: 'normalized', rect: [-.25, 0, .5, 1], width: 4, border: { u: 'wrap' } });
  assert.deepEqual(samples(resampled), [400, 400, 100, 100]);
  assert.deepEqual(resampled.raster.pivot, [5, .5]);
  assert.deepEqual(resampled.descriptor.pixelPitchMm, [.2, .8]);
  assert.throws(() => crop(source, { rect: [0, 0, -1, 1] }), /positive/);
  assert.throws(() => crop(source, { rect: [0, 0, Number.MIN_VALUE, 1] }), /degenerate/);
});

test('symmetry folds into the chosen side on each requested axis', () => {
  const source = plane(4, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(samples(symmetry(source)), [1, 2, 2, 1, 5, 6, 6, 5, 9, 10, 10, 9]);
  assert.deepEqual(samples(symmetry(source, { axis: 'both', side: 'high' })), [12, 11, 11, 12, 8, 7, 7, 8, 12, 11, 11, 12]);
  assert.deepEqual(samples(symmetry(source, { axis: 'x', pivot: [.25, .5], border: 'wrap' })).slice(0, 4), [1, 1, 4, 3]);
});

test('polar directions use circular radii, clockwise angles, and a continuous angular seam', () => {
  const strip = row([1, 2, 3, 4]);
  const disc = polar(strip, { mode: 'fromPolar', width: 9, height: 5, radius: .5, filter: 'linear' });
  const value = samples(disc);
  close(value[2 * 9 + 6], 2.5); // East lies between the first and last column.
  close(value[4 * 9 + 4], 1.5);
  close(value[2 * 9 + 2], 2.5);
  close(value[0 * 9 + 4], 3.5);
  assert.equal(value[2 * 9 + 1], 0);
  assert.equal(samples(polar(strip, { mode: 'fromPolar', width: 9, height: 5, rotation: 90 }))[2 * 9 + 6], 4);
  const coordinate = plane(9, 5, Array.from({ length: 45 }, (_, i) => i + 1));
  const flat = polar(coordinate, { mode: 'toPolar', width: 4, height: 1, radius: .8, rotation: -45 });
  assert.deepEqual(samples(flat), [25, 41, 21, 5]);
});

test('perspective preserves identity, maps an analytic trapezoid, and clips beyond the convex quad', () => {
  const source = plane(5, 5, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.deepEqual(samples(perspective(source)), samples(source));
  const corners = [[1, 0], [4, 0], [5, 5], [0, 5]];
  const projected = samples(perspective(source, { corners, units: 'pixels' }));
  assert.equal(projected[0], 0);
  assert.equal(projected[4], 0);
  assert.equal(projected[20], 21);
  assert.equal(projected[24], 25);
  assert.equal(projected[12], 18);
  assert.notEqual(samples(perspective(source, { corners, units: 'pixels', clip: false }))[0], 0);
  assert.throws(() => perspective(source, { corners: [[0, 0], [1, 1], [0, 1], [1, 0]] }), /convex/);
});

test('editable material graphs preserve transform options and refine connected color ports', () => {
  const op = (op, inputs) => ({ op, inputs });
  const graph = { format: 'ink-studio/graph-project', version: 1, nodes: {
    source: op('image.uniform', { value: [1, .5, .1], width: 5, height: 3, descriptor: { intent: 'color' } }),
    shifted: op('image.transform', { source: { node: 'source', port: 'value' }, options: { offset: [1, 0] } }),
    trimmed: op('image.crop', { source: { node: 'shifted', port: 'value' }, options: { rect: [2, 0, 2, 3] } }),
    preview: op('image.toDisplay', { source: { node: 'trimmed', port: 'value' } })
  }, outputs: { result: { node: 'preview', port: 'value' } } };
  const editable = Ink.openMaterialGraph(graph, { id: 'transformed' });
  const result = Ink.createGraphProject(JSON.parse(JSON.stringify(editable))).run();
  assert.equal(result.outputs.result.width, 2);
  assert.equal(result.outputs.result.height, 3);
  assert.deepEqual(Array.from(result.outputs.result.data.slice(0, 3)), [255, 128, 26]);
});
