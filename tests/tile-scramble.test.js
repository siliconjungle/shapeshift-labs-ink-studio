const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { pixelEffects, graph } = KIT.procedural;

const plane = (width, height, values) => ({ width, height, channels: 1, data: Float64Array.from(values) });

test('swaps whole tiles from the original raster and preserves clipped edge cells', () => {
  const source = {
    ...plane(5, 3, [-3, 1.25, 3, 4, 9, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15]),
    pivot: [2.5, 3]
  };
  const { value, addresses } = pixelEffects.tileScramble(source, { tileSize: [2, 2], amount: 1 });
  assert.deepEqual([...addresses.data], [1, 0, 2, 3, 4, 5]);
  assert.deepEqual([...value.data], [3, 4, -3, 1.25, 9, 7, 8, 5, 6, 9, 11, 12, 13, 14, 15]);
  assert.deepEqual(value.pivot, source.pivot);
  assert.equal(source.data[0], -3);
  assert.equal(value.channels, 1);
});

test('omits complete RGBA tiles and respects every pixel in the target mask', () => {
  const source = {
    width: 4, height: 1, channels: 4,
    data: Uint8Array.of(1, 2, 3, 125, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255)
  };
  const mask = plane(4, 1, [255, 127, 255, 255]);
  const options = { tileSize: [2, 1], mode: 'omit', amount: 1, mask };
  const { value, addresses } = pixelEffects.tileScramble(source, options);
  assert.deepEqual([...addresses.data], [0, -1]);
  assert.deepEqual(value.data, Uint8Array.of(1, 2, 3, 125, 4, 5, 6, 255, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.throws(() => pixelEffects.tileScramble(source, { ...options, mask: plane(1, 1, [255]) }), /align/);
  assert.throws(() => pixelEffects.tileScramble(source, { tileSize: [0, 1] }), /settings/);
  assert.throws(() => pixelEffects.tileScramble(source, { time: Number.MAX_VALUE, rate: 2 }), /tick range/);
  assert.deepEqual(pixelEffects.tileScramble(source, { tileSize: [8, 8] }).value, source);
});

test('repeat keeps donors intact and never samples outside its mask', () => {
  const source = plane(4, 1, [11, 22, 33, 44]);
  const mask = plane(4, 1, [0, 255, 255, 0]);
  const { value, addresses } = pixelEffects.tileScramble(source, { tileSize: [1, 1], mode: 'repeat', amount: 1, mask });
  const map = [...addresses.data];
  assert.equal(map[0], 0);
  assert.equal(map[3], 3);
  assert.equal(map[1], map[2]);
  assert.ok([1, 2].includes(map[1]));
  assert.deepEqual([...value.data], map.map(address => source.data[address]));
});

test('the stock graph node holds an address map until its next tick and seeks deterministically', () => {
  const source = plane(8, 2, Array.from({ length: 16 }, (_, i) => i + 10));
  const options = { tileSize: [1, 1], mode: 'swap', amount: 1, seed: 28, rate: 4 };
  const graphSpec = {
    inputs: { image: 'raster' },
    nodes: { tiles: { op: 'fx.tileScramble', inputs: { source: { input: 'image' }, options: { value: options } } } },
    outputs: { image: { node: 'tiles' }, addresses: { node: 'tiles', port: 'addresses' } }
  };
  const session = graph.create(graphSpec);
  const at = time => session.evaluate({ image: source }, { time }).outputs;
  const start = at(.01);
  assert.deepEqual(at(.24), start);
  const next = at(.25);
  assert.notDeepEqual(next.addresses, start.addresses);
  assert.deepEqual(next.image, pixelEffects.tileScramble(source, { ...options, time: .25 }).value);
  assert.deepEqual(at(.01), start);
  const sorted = [...next.addresses.data].sort((a, b) => a - b);
  assert.deepEqual(sorted, Array.from({ length: 16 }, (_, i) => i));
});
