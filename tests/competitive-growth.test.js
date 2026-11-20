const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const grow = KIT.procedural.growth.competitive;
const materials = [{ id: 'jade' }, { id: 'copper' }];

test('competitive growth commits by arrival time, with seed order breaking ties', () => {
  const model = grow({ width: 7, height: 1, cell: 1, materials: [{ id: 'jade', speed: 2 }, materials[1]],
    seeds: [{ at: [.5, .5], material: 'jade' }, { at: [6.5, .5], material: 'copper' }] });
  assert.deepEqual([...model.frame().data()], [0, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual([...model.frame().data('arrival')], [0, .5, 1, 1.5, 2, 1, 0]);
  assert.deepEqual([...model.frame(1.5).data()], [0, 0, 0, 0, -1, 1, 1]);
  assert.deepEqual(model.frame(1.5).seams(), []);
  assert.deepEqual(model.frame(2).seams(), [
    { a: [5, 0], b: [5, 1], cells: [4, 5], materials: ['jade', 'copper'], seeds: [0, 1], time: 2 }
  ]);
  assert.equal(model.frame(2).sample('age', .5, .5), 2);
  assert.deepEqual(model.frame(0).data('seed'), Int32Array.of(0, -1, -1, -1, -1, -1, 1));
  assert.deepEqual(model.frame(Infinity).data(), model.frame().data());
});

test('occupied cells block a later seed and already claimed territory stays fixed', () => {
  const model = grow({ width: 6, height: 1, cell: 1, materials,
    seeds: [{ at: [2.5, .5], material: 'copper', time: 3 }, { at: [.5, .5], material: 'jade' }] });
  assert.deepEqual([...model.frame().data('seed')], [1, 1, 1, 1, 1, 1]);
  assert.equal(model.frame(3).sample('material', 2.5, .5), 0);
  assert.equal(model.frame().seams().length, 0);
});

test('directional stretch and drift act in world units, with sampled pace', () => {
  const model = grow({ width: 3, height: 3, cell: [2, 1], origin: [-3, -1.5], neighbors: 4, pace: () => .5,
    materials: [{ id: 'jade', speed: 2, angle: 0, stretch: 2, drift: .5 }],
    seeds: [{ at: [0, 0], time: 1, material: 'jade' }] });
  const result = model.frame();
  assert.equal(result.sample('arrival', 2, 0), 1 + 2 / 3);
  assert.equal(result.sample('arrival', -2, 0), 3);
  assert.equal(result.sample('arrival', 0, 1), 2);
  assert.equal(result.source('arrival').sample(2, 0, 0), result.sample('arrival', 2, 0));
  const mounted = result.source('arrival', { bounds: { min: [-3,-1.5,0], max: [3,1.5,0] }, project: ([x,y]) => [x,y] });
  assert.equal(mounted.sample(0, 1, 0), 2);
});

test('masked corners stay sealed and unseeded islands keep their missing values', () => {
  const model = grow({ width: 2, height: 2, cell: 1, mask: (_x, _z, i) => i === 0 || i === 3,
    materials, seeds: [{ at: [.5, .5], material: 'copper' }] });
  const frame = model.frame();
  assert.deepEqual([...model.mask()], [1, 0, 0, 1]);
  assert.deepEqual([...frame.data('arrival')], [0, Infinity, Infinity, Infinity]);
  assert.equal(frame.sample('material', 1.5, 1.5), null);
  assert.equal(frame.source().sample(1.5, 0, .5), null);
  assert.deepEqual(frame.seams(), []);
  assert.throws(() => grow({ width: 2, height: 2, cell: 1, mask: () => false,
    materials, seeds: [{ at: [.5, .5], material: 'jade' }] }), /open cell/);
});

test('same-material grains optionally expose seams and output buffers cannot change replay', () => {
  const model = grow({ width: 3, height: 1, cell: 1, materials,
    seeds: [{ at: [.5, .5], material: 'jade' }, { at: [2.5, .5], material: 'jade' }] });
  const early = model.frame(0), final = model.frame();
  assert.deepEqual(final.seams(), []);
  assert.equal(final.seams({ by: 'seed' }).length, 1);
  assert.deepEqual(early.seams({ by: 'seed' }), []);
  assert.ok(Object.isFrozen(final.seams({ by: 'seed' })[0].a));
  final.data('seed').fill(24);
  model.mask().fill(0);
  assert.deepEqual([...model.frame().data('seed')], [0, 0, 1]);
  assert.equal(early.source('material').sample(1.5,0,.5), null);
  assert.throws(() => model.frame(-1), /nonnegative/);
  assert.throws(() => model.frame().source('missing'), /unknown growth channel/);
});
