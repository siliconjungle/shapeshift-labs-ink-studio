const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, makeBuilder } = require('..').load();
const { animationGraph: A, graph } = K.procedural;
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, a + ' differs from ' + b);
const turn = () => [0, -1, 0, 1, 0, 0, 0, 0, 1];

function rows(time) {
  return [
    { id: 'west', position: [time, 0, 0], rotation: K.M.id(), scale: 1 + time, opacity: .7 },
    { id: 'east', position: [2 + time, 0, 0], rotation: turn(), scale: 2 + time, tint: '#72d4bb' },
    { id: 'guide', position: [0, time, 0], scale: 3 + time }
  ];
}
const edits = [
  { id: 'west', snapshot: 'hold', channels: ['position'] },
  { id: 'west', from: 'east', channels: ['rotation'] },
  { id: 'east', from: 'west', channels: ['position'] },
  { id: 'east', from: 'guide', snapshot: 'hold', channels: ['scale'] }
];

test('instance holds and duplicates use stable IDs and independent, simultaneous channels', () => {
  const earlier = rows(1), snapshot = A.captureTransforms(earlier);
  earlier[0].position[0] = 99;
  earlier[2].scale = 99;
  const live = rows(3);
  const { value, report } = A.staleTransforms(live, edits, { snapshots: { hold: snapshot } });
  assert.deepEqual(value, [
    { id: 'west', position: [1, 0, 0], rotation: turn(), scale: 4, opacity: .7 },
    { id: 'east', position: [3, 0, 0], rotation: turn(), scale: 4, tint: '#72d4bb' },
    live[2]
  ]);
  assert.equal(value[2], live[2]);
  assert.deepEqual(live, rows(3));
  assert.deepEqual(report, { applied: 4, skipped: 0 });
  assert.deepEqual(A.staleTransforms(live, edits.slice().reverse(), { snapshots: { hold: snapshot } }).value, value);
  assert.notEqual(value[0].position, snapshot[0].position);
});

test('identity defaults, missing IDs, nonoverlapping edits and anisotropic matrices are validated', () => {
  const source = [{ id: 'a', scale: [1, 2, 3] }, { id: 'b', rotation: turn() }];
  assert.deepEqual(A.captureTransforms(source)[1], { id: 'b', rotation: turn(), position: [0, 0, 0], scale: 1 });
  assert.deepEqual(A.instanceMatrix({ rotation: turn(), scale: [2, 3, 4] }), [0, -3, 0, 2, 0, 0, 0, 0, 4]);
  const absent = { id: 'a', from: 'recycled' };
  assert.throws(() => A.staleTransforms(source, [absent]), /Missing stale transform/);
  assert.deepEqual(A.staleTransforms(source, [absent], { missing: 'skip' }), { value: source, report: { applied: 0, skipped: 1 } });
  assert.throws(() => A.staleTransforms(source, [{ id: 'a', snapshot: 'absent' }], { missing: 'skip' }), /Unknown instance snapshot/);
  const duplicate = { id: 'a', from: 'b', channels: ['scale'] };
  assert.throws(() => A.staleTransforms(source, [duplicate, duplicate]), /Duplicate stale transform/);
  assert.throws(() => A.captureTransforms([source[0], source[0]]), /distinct IDs/);
  assert.throws(() => A.captureTransforms([{ id: 'a', rotation: Array(9).fill(0) }]), /Invalid instance rotation/);
});

test('stock graph nodes compose with named snapshots and direct seeks', () => {
  const session = graph.create({
    inputs: { current: 'array<record>', held: 'array<record>' },
    nodes: {
      hold: { op: 'anim.captureTransforms', inputs: { source: { input: 'held' } } },
      banks: { op: 'data.record', inputs: { hold: { node: 'hold' } } },
      fault: { op: 'anim.staleTransforms', inputs: { source: { input: 'current' }, snapshots: { node: 'banks' },
        edits: { value: edits } } }
    },
    outputs: { poses: { node: 'fault' }, report: { node: 'fault', port: 'report' } }
  });
  const held = rows(1);
  const at = time => session.evaluate({ current: rows(time), held }, { time }).outputs;
  const seek = at(7);
  assert.equal(seek.poses[0].scale, 8);
  assert.deepEqual(seek.poses[0].position, [1, 0, 0]);
  assert.deepEqual(seek.poses[1].position, [7, 0, 0]);
  assert.deepEqual(seek.report, { applied: 4, skipped: 0 });
  at(2);
  assert.deepEqual(at(7), seek);
});

test('shared splat instances apply transform batches atomically and flatten the edited positions', async () => {
  const { createSplatInstances, instancePlan } = await import('../src/webgl/instances.mjs');
  const B = makeBuilder(1);
  B.iso(0, 0, 0, .25, B.P[1], 3);
  const group = createSplatInstances({ marker: B.finish() }, rows(0).map(({ id, position, rotation, scale }) =>
    ({ id, prototype: 'marker', position, rotation, scale, opacity: .5 })));
  const live = rows(3).map(row => ({ ...row, opacity: 0 }));
  const { value } = A.staleTransforms(live, edits, { snapshots: { hold: A.captureTransforms(rows(1)) } });
  assert.equal(group.updateTransforms(value), 3);
  assert.equal(group.get('west').opacity, .5);
  assert.deepEqual(group.get('west').rotation, turn());
  assert.deepEqual(group.get('west').position, [1, 0, 0]);
  const plan = instancePlan(group), revision = plan.revision;
  assert.equal(group.updateTransforms(value), 0);
  assert.throws(() => group.updateTransforms([{ id: 'west', scale: 3 }, { id: 'east', scale: -1 }]), /Invalid splat instance/);
  assert.equal(plan.revision, revision);
  assert.equal(group.get('west').scale, 4);
  const flat = group.flatten(makeBuilder(2).finish());
  assert.deepEqual([flat.data[0], flat.data[16], flat.data[33]], [1, 3, 3]);
});

test('opt-in particle poses change display transforms while dynamics and recycled IDs advance', () => {
  const B = makeBuilder(1), pool = K.pool(B, 2), world = B.finish(), stage = K.stage(world);
  let fixed, held;
  const particles = stage.add(K.particles(stage, pool, {
    renderTransforms({ instances }) {
      held ??= A.captureTransforms(instances);
      return A.staleTransforms(instances, [{ id: fixed, snapshot: 'held', channels: ['position', 'scale'] }],
        { snapshots: { held }, missing: 'skip' }).value;
    }
  }));
  const one = particles.emit({ p: [0, 0, 0], v: [1, 0, 0], size: .1, streak: .2, grow: 2, life: 1 });
  const two = particles.emit({ p: [0, 1, 0], v: [1, 0, 0], size: .1, life: 1 });
  fixed = one.id;
  stage.update(0, 0);
  stage.update(.04, .04);
  near(one.p[0], .04);
  near(two.p[0], .04);
  near(world.data[0], 0);
  near(world.data[8], .01);
  near(world.data[16], .04);
  const fresh = particles.emit({ p: [5, 0, 0], v: [1, 0, 0], size: .1, life: 1 });
  assert.notEqual(fresh.id, fixed);
  stage.update(.04, .08);
  near(world.data[0], 5.04);
});
