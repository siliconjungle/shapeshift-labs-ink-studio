const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { actionWindows, runtime } = KIT.world;
const json = value => JSON.parse(JSON.stringify(value));
const marker = (entity, name, at) => ({ op: 'marker', entity, name, at });
const start = (entity, action, at) => ({ op: 'start', entity, action, at });
const strike = (target, at, source = 'arm') => ({ source, target, kind: 'strike', at });
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, a + ' differs from ' + b);

function drill() {
  return actionWindows.create({
    recipes: {
      sweep: { phases: [
        { id: 'windup', until: 'open', cue: 'warning' },
        { id: 'active', until: 'close', onContact: [{ kind: 'strike', emit: 'hit', once: 'action' }] },
        { id: 'recovery', duration: .3, flags: ['exposed'] }
      ] },
      inspect: { phases: [
        { id: 'checking', duration: 1, onContact: [{ kind: 'inspect', emit: 'checked' }] }
      ] }
    },
    assign: {
      arm: { actions: ['sweep'], markers: { ready: 'sweep' }, receive: [
        { kind: 'inspect', during: { action: 'sweep', phase: 'recovery' },
          sourceDuring: { action: 'inspect', phase: 'checking' }, emit: 'service' }
      ] },
      spare: { actions: ['sweep'], markers: { ready: 'sweep' } },
      tool: { actions: ['inspect'] }
    }
  });
}

test('named clip markers open and close precise action phases and expose a recovery receiver', () => {
  const layout = KIT.anim.animationGraph.create({
    clips: { cycle: { dur: 1, events: [{ name: 'ready', time: 0 }, { name: 'open', time: .2 }, { name: 'close', time: .5 }] } },
    layers: [{ id: 'base', entry: 'run', states: [{ id: 'run', clip: 'cycle' }] }]
  });
  const program = drill();
  const first = program.step(program.initial(), { to: .65,
    commands: [...actionWindows.markers('arm', layout.advance(.65).events), start('tool', 'inspect', 0),
      marker('spare', 'ready', .1), marker('spare', 'open', .2)],
    contacts: [
      strike('one', .19), strike('one', .2), strike('one', .3), strike('two', .499), strike('three', .5),
      strike('one', .22, 'spare'), strike('one', .24, 'spare'),
      { ...strike('arm', .49, 'tool'), kind: 'inspect' },
      { ...strike('arm', .5, 'tool'), kind: 'inspect' },
      { ...strike('arm', .6, 'tool'), kind: 'inspect' }
    ]
  });
  assert.deepEqual(first.events.filter(row => row.entity === 'arm' && row.type === 'action-phase')
    .map(row => [row.phase, row.time, row.cue]), [['windup', 0, 'warning'], ['active', .2, undefined], ['recovery', .5, undefined]]);
  assert.deepEqual(first.outcomes.filter(row => row.signal === 'hit').map(row => [row.source, row.target, row.time]),
    [['arm', 'one', .2], ['spare', 'one', .22], ['arm', 'two', .499]]);
  assert.equal(first.outcomes.filter(row => row.signal === 'service').length, 1);
  assert.equal(first.flags['arm.exposed'], true);
  const next = program.step(json(first.state), { to: .81 });
  assert.equal(next.flags['arm.exposed'], false);
  near(next.events.find(row => row.entity === 'arm').time, .8);
});

test('sweeps are clipped at phase boundaries and use the defender’s relative motion', () => {
  const stepper = actionWindows.create({
    recipes: { tap: { phases: [
      { id: 'wait', duration: .44 }, { id: 'active', duration: .16, onContact: [{ kind: 'strike', emit: 'hit' }] },
      { id: 'finished', duration: .2 }
    ] } },
    assign: { arm: { actions: ['tap'] } }
  });
  const sweep = (target, from, to = from) => ({ source: 'arm', target, kind: 'strike',
    probe: { from: [-2, 0, 0], to: [2, 0, 0], radius: .12 },
    targetBody: { from, to, half: [.17, .2, .1] } });
  const hit = stepper.step(stepper.initial(), { to: 1, commands: [start('arm', 'tap', 0)], sweeps: [
    sweep('early', [-1.5, 0, 0]), sweep('ongoing', [-.16, 0, 0]),
    sweep('moving', [1.4, 0, 0], [-1.1, 0, 0]), sweep('late', [1.27, 0, 0]), sweep('miss', [0, 2, 0])
  ] });
  assert.deepEqual(hit.outcomes.map(row => row.target), ['ongoing', 'moving']);
  near(hit.outcomes[0].time, .44);
  assert(hit.outcomes[1].time > .44 && hit.outcomes[1].time < .6);
  near(hit.outcomes[1].speed, 6.5);
});

test('hit history persists across restore and restarts with a fresh activation after cancellation', () => {
  const program = drill();
  const first = program.step(program.initial(), { to: .3,
    commands: [marker('arm', 'ready', 0), marker('arm', 'open', .1)], contacts: [strike('a', .2)] });
  const second = program.step(json(first.state), { to: .8,
    commands: [{ op: 'cancel', entity: 'arm', at: .5 }, marker('arm', 'ready', .6), marker('arm', 'open', .65)],
    contacts: [strike('a', .4), strike('b', .49), strike('a', .7)] });
  assert.deepEqual(second.outcomes.map(row => [row.target, row.activation]), [['b', 1], ['a', 2]]);
  assert.equal(second.events[0].type, 'action-cancel');
  const malformed = json(first.state);
  malformed.active.arm.phase = 100;
  assert.throws(() => program.step(malformed, { to: .8 }), /Invalid active action/);
});

const input = (tick, port, value) => ({ tick, action: 'world/input', args: { port, value } });

test('measured character landings drive a puzzle switch and fracture a qualified floor through typed ports', () => {
  const world = {
    systems: {
      gravity: { kind: 'gravity', config: { frame: { kind: 'uniform', acceleration: [0, -14, 0] } } },
      rig: { kind: 'mechanics', config: {
        bodies: {
          plate: { position: [-1, .53, 0], half: [.65, .13, .6], fixed: true },
          slab: { position: [1, .53, 0], half: [.65, .13, .6], fixed: true }
        },
        fractureOn: { slab: { parts: 3, minSpeed: 4, impactMass: 2 } }
      } },
      people: { kind: 'characters', config: { gravity: 'gravity/frame', clearance: 'rig/clearance', support: 'rig/ray',
        landingContacts: true,
        characters: { left: { position: [-1, 2.7, 0] }, right: { position: [1, 2.7, 0] } }
      } },
      triggers: { kind: 'action-windows', config: {
        contactChannels: ['manual'], assign: {
          plate: { receive: [{ kind: 'landing', minSpeed: 4, emit: 'press' }] },
          slab: { receive: [{ kind: 'landing', minSpeed: 4, emit: 'break', once: true }] }
        }
      } },
      lock: { kind: 'puzzle', config: {
        inputs: { press: 'event' }, nodes: { latched: { op: 'latch', set: 'press' } }, outputs: { open: 'latched' }
      } }
    },
    connections: [
      { from: 'people/landings', to: 'triggers/contacts' },
      { from: 'triggers/signal.press', to: 'lock/press' },
      { from: 'triggers/signal.break', to: 'rig/fracture-contacts' }
    ]
  };
  const run = runtime.create(world);
  run.schedule([input(1, 'triggers/manual', [{ kind: 'landing', source: 'left', target: 'plate', speed: 1 },
    { kind: 'landing', source: 'right', target: 'slab', speed: 1 }])]);
  run.advance(3);
  assert.ok(run.query().probe('rig/bodies').value.slab);
  assert.equal(run.query().trace('lock/why').value.active, false);
  const fork = runtime.create(world, { checkpoint: json(run.checkpoint()) });
  const notes = [];
  run.advance(60, { onTick: () => notes.push(...run.query().probe('triggers/outcomes').value) });
  fork.advance(60);
  assert.deepEqual(fork.checkpoint(), run.checkpoint());
  const bodies = run.query().probe('rig/bodies').value;
  assert.equal(bodies.slab, undefined);
  assert.equal(Object.keys(bodies).filter(name => name.startsWith('slab.')).length, 3);
  assert.equal(run.query().trace('lock/why').value.active, true);
  assert(notes.some(event => event.signal === 'break' && event.speed >= 4));
  assert.deepEqual(run.query().probe('triggers/state').value.spent, { slab: [0] });
});

test('mechanical impact ports publish swept body contact pairs for assigned scene IDs', () => {
  const dt = .2;
  const run = runtime.create({ dt, systems: {
    rig: { kind: 'mechanics', config: { gravity: [0, 0, 0], impactEvents: true, bodies: {
      ball: { entity: 'runner', half: [.16, .16, .16], position: [-3, 1, 0], velocity: [28, 0, 0] },
      gate: { entity: 'sensor', half: [.12, .7, .6], position: [0, 1, 0], fixed: true }
    } } },
    acts: { kind: 'action-windows', config: {
      assign: { sensor: { receive: [{ kind: 'impact', sources: ['runner'], minSpeed: 20, emit: 'touch', once: true }] } }
    } }
  }, connections: [{ from: 'rig/impacts', to: 'acts/contacts' }] });
  const rows = [];
  run.advance(3, { onTick: () => rows.push(...run.query().probe('acts/outcomes').value) });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].target, rows[0].signal], ['runner', 'sensor', 'touch']);
});

test('fracture contact energy respects the material threshold and accepts the assigned entity ID', () => {
  const pack = require('../examples/physical-materials.pack.json');
  const run = runtime.create({ assetPacks: [pack], systems: {
    rig: { kind: 'mechanics', config: {
      bodies: { brick: { entity: 'floor', half: [.6, .18, .5], position: [0, .7, 0], fixed: true,
        materialAsset: 'earthworks/clay', materialWetness: 1 } },
      fractureOn: { brick: { impactMass: 1, parts: 2 } }
    } }
  } });
  run.schedule([
    input(1, 'rig/fracture-contacts', [{ target: 'floor', speed: 3 }]),
    input(2, 'rig/fracture-contacts', [{ target: 'floor', speed: 3, energy: 10 }]),
    input(3, 'rig/fracture-contacts', [{ target: 'floor', speed: 8 }])
  ]);
  run.advance(1);
  assert.ok(run.query().probe('rig/bodies').value.brick);
  assert(run.history.some(row => row.kind === 'fracture-resisted' && row.energy === 4.5));
  run.advance(3);
  const bodies = run.query().probe('rig/bodies').value;
  assert.equal(bodies.brick, undefined);
  assert.equal(run.history.filter(row => row.kind === 'fracture').length, 1);
  assert.equal(bodies['brick.0'].materialAsset, 'earthworks/clay');
});
