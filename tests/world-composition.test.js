const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: { world: W } } = studio.load();

const meter = () => ({
  initial: () => 0,
  contract: { emits: ['increment'] },
  inputs: { rate: { type: 'number', default: 1 } },
  outputs: { level: 'number', pulse: 'event' },
  combinational: true,
  step(state, ctx) {
    const level = state + ctx.input.rate;
    ctx.emit('increment', { level });
    return level;
  },
  output: state => ({ level: state, pulse: state ? [state] : [] }),
  viewState: state => ({ level: state })
});
const observer = ({ meter = 'meter' } = {}) => ({
  initial: () => ({}),
  contract: { emits: ['sample'] },
  inputs: { pulse: 'event', level: 'number' },
  outputs: { previous: 'number' },
  output: (_, ctx) => ({ previous: ctx.read('before').level }),
  step(_, ctx) {
    const result = {
      previous: ctx.read('before').level,
      current: ctx.read('latest').level,
      snapshot: ctx.states[meter].level,
      pulse: ctx.input.pulse,
      level: ctx.input.level
    };
    ctx.emit('sample', result);
    return result;
  }
});
const options = { implementations: { meter, observer } };
function manifest(schedule) {
  return {
    systems: {
      a: { kind: 'observer', contract: { reads: { before: 'meter', latest: { system: 'meter', sample: 'current' } } } },
      meter: { kind: 'meter', ...(schedule && { schedule }) },
      z: { kind: 'meter', contract: { after: ['a'] } }
    },
    connections: [{ from: 'meter/pulse', to: 'a/pulse' }, { from: 'meter/level', to: 'a/level', delay: 1 }]
  };
}

test('contracts resolve named state reads, typed writes, events and an inspectable execution order', () => {
  const run = W.runtime.create(manifest(), options);
  const plan = run.composition();
  assert.deepEqual(plan.order, ['meter', 'a', 'z']);
  assert.deepEqual(plan.systems.a.reads.state, {
    before: { system: 'meter', sample: 'previous' }, latest: { system: 'meter', sample: 'current' }
  });
  assert.equal(plan.systems.a.reads.inputs.pulse.type, 'event');
  assert.equal(plan.systems.meter.writes.state, 'meter');
  assert.equal(plan.systems.meter.writes.outputs.pulse.type, 'event');
  assert.deepEqual(plan.systems.meter.emits, ['increment']);
  assert.deepEqual(plan.dependencies.map(edge => edge.kind).sort(), ['after','signal','state']);
  assert.equal(plan.connections.find(edge => edge.to === 'a/level').delay, 1);
  assert(Object.isFrozen(plan.systems.a.reads.state.latest));
  run.step();
  assert.deepEqual(run.view().states.a, { previous: 0, current: 1, snapshot: 0, pulse: [1], level: 0 });
  assert.deepEqual(run.events.map(({ system, kind }) => [system, kind]),
    [['meter', 'increment'], ['a', 'sample'], ['z', 'increment']]);
  run.step();
  assert.deepEqual(run.view().states.a, { previous: 1, current: 2, snapshot: 1, pulse: [2], level: 1 });
  assert.equal(run.fork().composition().order.join(), plan.order.join());
  const replay = W.runtime.replay(JSON.parse(JSON.stringify(run.recording())), options);
  assert.deepEqual(replay.checkpoint(), run.checkpoint());
});

test('current reads use same-phase updates, carry held state when a source is idle and replay with mixed rates', () => {
  const fast = W.runtime.create(manifest({ substeps: 3 }), options);
  fast.step();
  assert.deepEqual(fast.view().states.a, { previous: 2, current: 3, snapshot: 2, pulse: [1, 2, 3], level: 0 });
  const slow = W.runtime.create(manifest({ every: 2 }), options);
  slow.step();
  assert.deepEqual(slow.view().states.a, { previous: 0, current: 0, snapshot: 0, pulse: [], level: 0 });
  const branch = slow.fork();
  slow.step();
  branch.step();
  assert.deepEqual(slow.view().states.a, { previous: 0, current: 1, snapshot: 0, pulse: [1], level: 0 });
  assert.deepEqual(slow.checkpoint(), branch.checkpoint());
});

test('current reads use the same detail projection as snapshot reads across representation changes', () => {
  const estuary = require('../examples/world-aggregate-estuary.json');
  const sample = state => state.fluid.depth;
  const world = { ...estuary, systems: { ...estuary.systems, sensor: {
    kind: 'sensor', contract: { reads: { lagoon: { system: 'lagoon', sample: 'current' } } }
  } } };
  const run = W.runtime.create(world, { implementations: { sensor: () => ({
    initial: () => [],
    step: (_, ctx) => sample(ctx.read('lagoon'))
  }) } });
  for (const tick of [1, 5, 17, 24, 31]) {
    run.advance(tick);
    assert.deepEqual(run.view().states.sensor, sample(run.view().states.lagoon));
  }
});

test('validation catches broken contracts and mixed cycles while snapshot feedback can run', () => {
  const source = manifest();
  assert.throws(() => W.runtime.create({ ...source, systems: {
    ...source.systems, meter: { kind: 'meter', contract: { after: ['a'] } }
  }}, options), /dependency cycle.*a, meter/);
  assert.throws(() => W.runtime.create({ ...source, systems: {
    ...source.systems, z: { kind: 'meter', contract: { reads: { weather: 'missing' } } }
  }}, options), /Unknown or self state source missing for z\/weather/);
  assert.throws(() => W.runtime.create({ systems: { z: { kind: 'meter', contract: { emits: ['again', 'again'] } } } }, options),
    /Invalid system contract emits for z/);
  assert.throws(() => W.runtime.create({ systems: { z: { kind: 'meter', contract: { after: ['z'] } } } }, options),
    /Unknown or self system dependency z for z/);
  const a = { kind: 'swap', contract: { reads: { peer: 'b' } } };
  const b = { kind: 'swap', contract: { reads: { peer: 'a' } } };
  const handles = { implementations: { swap: () => ({
    initial: ctx => ctx.id === 'a' ? 1 : 2,
    step: (_, ctx) => ctx.read('peer')
  }) } };
  const feedback = W.runtime.create({ systems: { b, a } }, handles);
  assert.deepEqual(feedback.step().states, { a: 2, b: 1 });
  assert.deepEqual(feedback.composition().dependencies, []);
});

test('a forbidden event or undeclared state read leaves the committed tick and pending commands intact', () => {
  const source = manifest();
  source.systems.meter.contract = { emits: [] };
  source.commands = [{ tick: 1, action: 'world/input', args: { port: 'meter/rate', value: 2 } }];
  const run = W.runtime.create(source, options);
  const before = run.checkpoint();
  assert.throws(() => run.step(), /Undeclared simulation event increment from meter/);
  assert.deepEqual(run.checkpoint(), before);
  const hidden = W.runtime.create({ systems: { sensor: { kind: 'sensor', contract: {} } } }, {
    implementations: { sensor: () => ({ initial: () => 0, step: (_, ctx) => ctx.read('hidden') }) }
  });
  assert.throws(() => hidden.step(), /Undeclared system state read sensor\/hidden/);
  assert.equal(hidden.view().tick, 0);
});

test('prefab instances resolve isolated dependencies and capture them as local references', () => {
  const { systems } = manifest();
  const prefab = { systems: {
    meter: systems.meter,
    a: { ...systems.a, config: { meter: { $local: 'meter' } }, contract: { reads: {
      before: { $local: 'meter' }, latest: { system: { $local: 'meter' }, sample: 'current' }
    } } },
    z: { kind: 'meter', contract: { after: [{ $local: 'a' }] } }
  } };
  let world = W.manifest({ prefabs: { assembly: prefab } });
  world = W.stamp(W.stamp(world, 'assembly', 'west').world, 'assembly', 'east').world;
  const run = W.runtime.create(world, options);
  assert.equal(run.composition().systems['west.a'].reads.state.latest.system, 'west.meter');
  assert.deepEqual(run.composition().systems['east.z'].after, ['east.a']);
  run.schedule([{ tick: 1, action: 'world/input', args: { port: 'east.meter/rate', value: 3 } }]);
  run.step();
  assert.equal(run.view().states['east.a'].current, 3);
  assert.equal(run.view().states['west.a'].current, 1);
  const captured = W.capture(world, 'west', 'captured').world;
  assert.deepEqual(captured.prefabs.captured.systems.a.contract.reads.latest.system, { $local: 'meter' });
});

test('worker execution keeps ordered effects and peer reads agree with in-process execution', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ink-composition-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const moduleFile = join(directory, 'factories.cjs');
  writeFileSync(moduleFile, `
    const meter = ${meter.toString()};
    const observer = ${observer.toString()};
    module.exports = {
      meter: () => ({ ...meter(), partitionStep: true }),
      observer: () => ({ ...observer(), partitionStep: true })
    };
  `);
  const workerPool = studio.createSimulationWorkers(2, { modules: [moduleFile] });
  t.after(() => workerPool.close());
  for (const schedule of [undefined, { substeps: 2 }]) {
    const host = W.runtime.create(manifest(schedule), options);
    const workers = W.runtime.create(manifest(schedule), { workerPool });
    host.advance(3);
    workers.advance(3);
    assert.deepEqual(host.checkpoint(), workers.checkpoint());
    assert.deepEqual(workers.partitions().systems, { meter: schedule ? 6 : 3, z: 3 });
    assert.equal(workers.partitions().batches, schedule ? 9 : 6);
  }
});

test('the CLI reports the compiled graph and spatial declarations without advancing the world', () => {
  const report = JSON.parse(execFileSync(process.execPath, [
    resolve(__dirname, '../cli/ink-studio.js'), 'sim', 'plan', resolve(__dirname, '../examples/world-watershed.json')
  ], { encoding: 'utf8' }));
  assert(report.order.includes('river'));
  assert(report.systems.river.writes.fields.length > 0);
  assert(report.systems.river.reads.fields.length > 0);
});
