const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT } = require('..').load();
const { pixelEffects, graph, raster } = KIT.procedural;

const plane = (width, height, values) => ({ width, height, channels: 1, data: Float64Array.from(values) });

test('bleed reads complete donor tiles using the donor stride and preserves protected target pixels', () => {
  const source = { ...plane(5, 3, Array.from({ length: 15 }, (_, i) => i + 1)), pivot: [2.5, 3] };
  const bank = plane(3, 4, [20, 21, 50, 22, 23, 51, -11, .25, 52, 24, 25, 53]);
  const mask = plane(5, 3, [255, 255, 255, 127, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const bankMask = plane(3, 4, [0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 255]);
  const { value, addresses } = pixelEffects.tileBleed(source, bank, { tileSize: [2, 2], amount: 1, mask, bankMask });
  assert.deepEqual([addresses.width, addresses.height], [3, 2]);
  assert.deepEqual([...addresses.data], [2, -1, -1, -1, -1, -1]);
  assert.deepEqual([...value.data], [-11, .25, 3, 4, 5, 24, 25, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(value.pivot, source.pivot);
  assert.equal(source.data[0], 1);
  assert.equal(bank.data[6], -11);
});

test('bleed copies donor alpha exactly and handles empty donor selections', () => {
  const make = color => raster.canvas({ width: 2, height: 1, color });
  const source = make([20, 40, 60, 255]), bank = make([100, 80, 60, 0]);
  const options = { tileSize: [1, 1], amount: 1 };
  assert.deepEqual(pixelEffects.tileBleed(source, bank, options).value, bank);
  const protectedBank = { ...options, bankMaskChannel: 'alpha', bankMask: bank };
  const result = pixelEffects.tileBleed(source, bank, protectedBank);
  assert.deepEqual([...result.addresses.data], [-1, -1]);
  assert.deepEqual(result.value, source);
  assert.throws(() => pixelEffects.tileBleed(source, plane(1, 1, [0]), options), /channel counts/);
  assert.throws(() => pixelEffects.tileBleed(source, bank, { ...options, bankMask: plane(1, 1, [0]) }), /align/);
});

test('graph node holds the donor address map while a live bank updates and replays on seek', () => {
  const source = plane(16, 1, Array.from({ length: 16 }, (_, i) => i + 10));
  const bank = plane(4, 1, [100, 200, 300, 400]);
  const later = plane(4, 1, [105, 205, 305, 405]);
  const options = { tileSize: [1, 1], amount: .5, seed: 9, rate: 4 };
  const session = graph.create({
    inputs: { image: 'raster', donor: 'raster' },
    nodes: { effect: { op: 'fx.tileBleed', inputs: { source: { input: 'image' }, bank: { input: 'donor' },
      options: { value: options } } } },
    outputs: { image: { node: 'effect' }, addresses: { node: 'effect', port: 'addresses' } }
  });
  const at = (time, donor = bank) => session.evaluate({ image: source, donor }, { time }).outputs;
  const original = at(0), update = at(.24, later), next = at(.25);
  assert.deepEqual(update.addresses, original.addresses);
  assert.notDeepEqual(next.addresses, original.addresses);
  assert.equal(original.addresses.data.filter(address => address >= 0).length, 8);
  assert.deepEqual([...update.image.data], [...original.addresses.data].map((address, index) =>
    address < 0 ? source.data[index] : later.data[address]));
  assert.deepEqual(at(0), original);
  assert.deepEqual(next.image, pixelEffects.tileBleed(source, bank, { ...options, time: .25 }).value);
});
