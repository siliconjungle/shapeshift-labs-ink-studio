const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { graph, pixelEffects } = KIT.procedural;
const { blockSubstitute } = pixelEffects;
const plane = (width, height, data) => ({ width, height, channels: 1, data });

test('overlapping blocks read the original snapshot and later successful copies win', () => {
  const source = { ...plane(5, 1, Float64Array.of(-.5, 1, 2, 3, 4)), pivot: [2, 1] };
  const result = blockSubstitute(source, { blocks: [
    { rect: [1, 0, 3, 1], from: [0, 0] },
    { rect: [2, 0, 2, 1], from: [1, 0] }
  ] });
  assert.deepEqual([...result.value.data], [-.5, -.5, 1, 2, 4]);
  assert.deepEqual([...result.mask.data], [0, 255, 255, 255, 0]);
  assert.deepEqual(result.value.pivot, source.pivot);
  assert.deepEqual([...source.data], [-.5, 1, 2, 3, 4]);
});

test('a separate numeric bank preserves its samples and clips source and destination together', () => {
  const source = plane(4, 2, Uint8Array.of(10, 11, 12, 13, 14, 15, 16, 17));
  const bank = plane(2, 3, Float64Array.of(-1, -.5, 3, 3.5, 6, 6.5));
  const result = blockSubstitute(source, { banks: { bank }, blocks: [
    { rect: [-1, -1, 4, 3], from: [0, 0], bank: 'bank' },
    { rect: [1, 0, 2, 2], from: [-1, 0], bank: 'bank' },
    { rect: [2, 0, 1, 1], from: [3, 0], bank: 'bank' }
  ] });
  assert.ok(result.value.data instanceof Float64Array);
  assert.deepEqual([...result.value.data], [3.5, 11, -1, 13, 6.5, 15, 3, 17]);
  assert.deepEqual([...result.mask.data], [255, 0, 255, 0, 255, 0, 255, 0]);
});

test('masked replacements keep RGBA samples exact and reject invalid placements', () => {
  const source = { width: 2, height: 1, channels: 4, data: Uint8Array.of(12, 34, 56, 128, 78, 90, 10, 255) };
  const bank = { ...source, data: Uint8Array.of(111, 22, 33, 0, 44, 55, 66, 145) };
  const built = blockSubstitute(source, {
    blocks: [{ rect: [0, 0, 2, 1], bank: 'monitor' }], banks: { monitor: bank }, mask: plane(2, 1, [255, 127])
  });
  assert.deepEqual([...built.value.data], [111, 22, 33, 0, 78, 90, 10, 255]);
  assert.deepEqual([...built.mask.data], [255, 0]);
  assert.throws(() => blockSubstitute(source, { blocks: [{ rect: [0, 0, 1, 1], bank: 'missing' }] }), /Unknown .* bank/);
  assert.throws(() => blockSubstitute(source, { blocks: [{ rect: [0, 0, 1, 1], from: [.5, 0] }] }), /integer source/);
  assert.throws(() => blockSubstitute(source, { blocks: [{ rect: [0, 0, 1, 1], bank: 'x' }],
    banks: { x: plane(1, 1, [1]) } }), /matching channel counts/);
});

test('a graph can substitute an earlier sampled frame and a second feed in the same output', () => {
  const session = graph.create({
    inputs: { strip: 'array<raster>', monitor: 'raster' },
    nodes: {
      now: { op: 'anim.frame', inputs: { frames: { input: 'strip' }, options: { value: { fps: 2 } } } },
      then: { op: 'anim.frame', inputs: { frames: { input: 'strip' }, options: { value: { fps: 2, delay: .5 } } } },
      banks: { op: 'data.record', inputs: { replay: { node: 'then' }, monitor: { input: 'monitor' } } },
      patches: { op: 'fx.blockSubstitute', inputs: { source: { node: 'now' }, banks: { node: 'banks' },
        options: { value: { blocks: [
          { rect: [1, 0, 1, 1], bank: 'replay' },
          { rect: [2, 0, 1, 1], bank: 'monitor', from: [0, 0] }
        ] } } } }
    },
    outputs: { value: { node: 'patches' }, mask: { node: 'patches', port: 'mask' } }
  });
  const inputs = { strip: [plane(3, 1, [5, 6, 7]), plane(3, 1, [25, 26, 27])], monitor: plane(1, 1, [90]) };
  const at = time => session.evaluate(inputs, { time }).outputs;
  const first = at(.5);
  assert.deepEqual([...first.value.data], [25, 6, 90]);
  assert.deepEqual([...first.mask.data], [0, 255, 255]);
  assert.deepEqual([...at(0).value.data], [5, 6, 90]);
  assert.deepEqual(at(.5), first);
});
