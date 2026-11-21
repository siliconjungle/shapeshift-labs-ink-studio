const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { graph, pixelEffects } = KIT.procedural;
const { tileStrideSlip } = pixelEffects;
const plane = (width, height, data) => ({ width, height, channels: 1, data: Float64Array.from(data) });

test('a wrong read stride accumulates across rows and wraps through the same tile bank', () => {
  const source = plane(3, 3, [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  const options = { tileSize: [1, 1] };
  assert.deepEqual(tileStrideSlip(source, options).value, source);
  const slipped = tileStrideSlip(source, { ...options, stride: 4 });
  assert.deepEqual([...slipped.addresses.data], [0, 1, 2, 4, 5, 6, 8, 0, 1]);
  assert.deepEqual([...slipped.value.data], [10, 11, 12, 14, 15, 16, 18, 10, 11]);
  const early = tileStrideSlip(source, { ...options, wrapAt: 5 });
  assert.deepEqual([...early.addresses.data], [0, 1, 2, 3, 4, 0, 1, 2, 3]);
  const reverse = tileStrideSlip(source, { ...options, offset: 6, stride: -3 });
  assert.deepEqual([...reverse.addresses.data], [6, 7, 8, 3, 4, 5, 0, 1, 2]);
  const repeat = tileStrideSlip(source, { ...options, offset: -1, stride: 0 });
  assert.deepEqual([...repeat.addresses.data], [8, 0, 1, 8, 0, 1, 8, 0, 1]);
});

test('boundary policy chooses whether an out-of-range read repeats, keeps, or clears a pixel', () => {
  const source = { width: 3, height: 1, channels: 4, data: Uint8Array.of(10, 20, 30, 100, 11, 21, 31, 200, 12, 22, 32, 255) };
  const options = { tileSize: [1, 1], offset: 1, wrapAt: 2 };
  const expected = {
    wrap: { map: [1, 0, 1], tail: [11, 21, 31, 200] },
    keep: { map: [1, 1, 2], tail: [12, 22, 32, 255] },
    omit: { map: [1, -1, -1], tail: [0, 0, 0, 0] }
  };
  for (const [boundary, { map, tail }] of Object.entries(expected)) {
    const result = tileStrideSlip(source, { ...options, boundary });
    assert.deepEqual([...result.addresses.data], map);
    assert.deepEqual([...result.value.data.slice(-4)], tail);
    assert.deepEqual([...result.value.data.slice(0, 4)], [11, 21, 31, 200]);
  }
  assert.deepEqual([...source.data.slice(-4)], [12, 22, 32, 255]);
});

test('mask protects whole destination tiles and partial edge cells stay outside the read bank', () => {
  const source = { ...plane(5, 3, [-1, .25, 3, 4, 9, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15]), pivot: [2.5, 3] };
  const mask = plane(5, 3, [255, 255, 127, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const options = { tileSize: [2, 2], offset: 1, mask };
  const result = tileStrideSlip(source, options);
  assert.deepEqual([...result.value.data], [3, 4, 3, 4, 9, 7, 8, 7, 8, 9, 11, 12, 13, 14, 15]);
  assert.deepEqual([...result.addresses.data], [1, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.value.pivot, source.pivot);
  assert.deepEqual(tileStrideSlip(source).value, source);
  assert.throws(() => tileStrideSlip(source, { ...options, wrapAt: 3 }), /wrap point/);
  assert.throws(() => tileStrideSlip(source, { ...options, stride: .5 }), /stride/);
});

test('the graph can step the stride and snap back to the source on a cue', () => {
  const source = plane(3, 2, [10, 11, 12, 13, 14, 15]);
  const session = graph.create({
    inputs: { source: 'raster' },
    nodes: {
      options: { op: 'data.record', inputs: { tileSize: [1, 1], stride: { keys: [
        { time: 0, value: 3, ease: 'step' }, { time: .5, value: 4, ease: 'step' }, { time: 1, value: 3 }
      ] } } },
      slip: { op: 'fx.tileStrideSlip', inputs: { source: { input: 'source' }, options: { node: 'options' } } }
    },
    outputs: { image: { node: 'slip' } }
  });
  const at = time => session.evaluate({ source }, { time }).outputs.image;
  assert.deepEqual(at(.49), source);
  assert.deepEqual([...at(.5).data], [10, 11, 12, 14, 15, 10]);
  assert.deepEqual(at(.75), at(.5));
  assert.deepEqual(at(1), source);
  assert.deepEqual(at(.49), source);
});
