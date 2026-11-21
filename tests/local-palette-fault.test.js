const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { graph, pixelEffects } = KIT.procedural;

const palette = ['#1c242c', '#1c242c', '#d16f69', '#f3cd9e'];
const plane = data => ({ width: data.length, height: 1, channels: 1, data });

test('masked swaps preserve alpha and act on slot identity even for equal swatches', () => {
  const source = { ...plane([0, 1, 0, 2, 3, -1, 1]), pivot: [3, 1] };
  const mask = plane([255, 255, 127, 255, 255, 255, 255]);
  const alpha = plane([255, 104, 255, 255, 255, 255, 0]);
  const result = pixelEffects.paletteFault(source, { palette }, { swaps: [[0, 2]], mask, alpha });
  assert.deepEqual([...result.indices.data], [2, 1, 0, 0, 3, -1, 1]);
  assert.deepEqual([...result.value.data], [
    209, 111, 105, 255, 28, 36, 44, 104, 28, 36, 44, 255, 28, 36, 44, 255,
    243, 205, 158, 255, 0, 0, 0, 0, 28, 36, 44, 0
  ]);
  assert.deepEqual(result.value.pivot, source.pivot);
  assert.deepEqual(result.indices.pivot, source.pivot);
  assert.deepEqual(source.data, [0, 1, 0, 2, 3, -1, 1]);
});

test('stuck slots collapse selectively and combined rules read the original slots once', () => {
  const source = plane(Uint8Array.of(0, 1, 2, 3));
  const both = pixelEffects.paletteFault(source, palette, { swaps: [[0, 1]], stuck: { from: [2, 3], to: 0 } });
  assert.deepEqual([...both.indices.data], [1, 0, 0, 0]);
  const all = pixelEffects.paletteFault(source, palette, { stuck: { to: 2 }, mask: plane([255, 255, 0, 0]) });
  assert.deepEqual([...all.indices.data], [2, 2, 2, 3]);
  assert.throws(() => pixelEffects.paletteFault(source, palette, { swaps: [[0, 1], [1, 2]] }), /overlap/);
  assert.throws(() => pixelEffects.paletteFault(source, palette, { swaps: [[0, 4]] }), /palette slots/);
  assert.throws(() => pixelEffects.paletteFault(source, palette, { swaps: [[0, 1]], stuck: { from: [0], to: 3 } }), /overlap/);
  assert.throws(() => pixelEffects.paletteFault(source, palette, { stuck: { from: [1], to: -1 } }), /valid from and to/);
});

test('stock graph node applies the same slot mapping to an editable local mask', () => {
  const session = graph.create({
    inputs: { sprite: 'raster', mask: 'raster' },
    nodes: {
      controls: { op: 'data.record', inputs: { swaps: [[0, 3], [1, 2]], mask: { input: 'mask' } } },
      fault: { op: 'fx.paletteFault', inputs: { source: { input: 'sprite' },
        palette: { value: palette }, options: { node: 'controls' } } }
    },
    outputs: { indices: { node: 'fault', port: 'indices' }, image: { node: 'fault' } }
  });
  const sprite = plane([0, 1, 2, 3]);
  const sample = mask => session.evaluate({ sprite, mask: plane(mask) }).outputs;
  const left = sample([255, 255, 0, 0]);
  assert.deepEqual([...left.indices.data], [3, 2, 2, 3]);
  assert.deepEqual([...sample([0, 0, 255, 255]).indices.data], [0, 1, 1, 0]);
  assert.deepEqual(sample([255, 255, 0, 0]), left);
});
