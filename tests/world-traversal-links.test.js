const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { characters, traversalLinks } = KIT.world;
const dt = 1 / 60, tuning = { height: 1, radius: .15, gravity: 0, airAcceleration: 0 };
const controller = characters.create({ tuning });
const air = { supports: () => [], clearance: () => Infinity };
const close = (a, b, epsilon = 1e-5) => assert(Math.abs(a - b) < epsilon, `${a} should be near ${b}`);
const rail = (path, options = {}) => ({ kind: 'route', path, motion: { speed: 3 }, ...options });
const shuttle = KIT.anim.route(KIT.anim.path([[0, 1, 0], [0, 4, 0]]), {
  mode: 'pingpong', speed: 2, stops: [{ at: 0, duration: .4 }, { at: 3, duration: .5 }]
});
const lift = { kind: 'scheduled', route: shuttle, exit: { offset: [.3, 0, 0] } };

function advance(network, actor, { time = 0, duration, input = () => ({}), world = air, enabled } = {}) {
  const events = [];
  for (let i = 0; i < Math.round(duration / dt); i++) {
    const result = network.step(actor, input(i, actor), dt, world, { time: time + i * dt, enabled });
    actor = result.actor;
    events.push(...result.events);
  }
  return { actor, events };
}

test('a gated rail can be grabbed, switched at a junction, and exited with its tangent velocity', () => {
  const links = {
    rail: rail([[0, 1, 0], [4, 1, 0]], { entry: { modes: ['air'], minSpeed: 1, radius: .25 },
      switches: [{ at: 1.02, link: 'branch', radius: .01 }], enabled: ({ world }) => !world.locked }),
    branch: rail([[1.02, 1, 0], [1.02, 1, 2]], { exit: { boost: [0, 1.3, 0] } })
  };
  const net = traversalLinks.create({ controller, links });
  const actor = net.state({ position: [0, 1, 0], velocity: [1.5, 0, 0], inventory: ['ticket'] });
  assert.equal(net.step(actor, { traverse: 'rail' }, dt, { ...air, locked: true }).actor.traversal, undefined);
  assert.equal(net.step(actor, { traverse: 'rail' }, dt, air, { enabled: () => false }).actor.traversal, undefined);
  const ride = advance(net, actor, { duration: .4, input: i => ({ traverse: i === 0 ? 'rail' : 'branch' }) });
  assert(ride.events.some(event => event.type === 'traversal-enter' && event.link === 'rail'));
  assert(ride.events.some(event => event.type === 'traversal-switch' && event.from === 'rail' && event.link === 'branch'));
  const complete = advance(net, ride.actor, { time: .4, duration: .8 });
  const exit = complete.events.find(event => event.type === 'traversal-exit');
  assert.equal(exit.link, 'branch');
  assert.equal(exit.cause, 'arrival');
  assert.deepEqual(exit.velocity, [0, 1.3, 3]);
  assert.deepEqual(complete.actor.inventory, ['ticket']);
});

test('a blocked rail retries at a safe pose and an obstructed exit waits for clear space', () => {
  const net = traversalLinks.create({ controller, links: {
    rail: rail([[0, 1, 0], [1, 1, 0]], { exit: { offset: [0, 0, 1], inherit: 0 } })
  } });
  const barrier = { ...air, clearance: p => Math.abs(p[0] - .55) - .045 };
  const start = net.state({ position: [0, 1, 0] });
  const blocked = advance(net, start, { duration: .7, input: () => ({ traverse: 'rail' }), world: barrier });
  assert(blocked.events.some(event => event.stage === 'motion'));
  assert(blocked.actor.position[0] < .4);
  const exitBarrier = { ...air, clearance: p => Math.abs(p[2] - .55) - .045 };
  const held = advance(net, blocked.actor, { duration: .7, world: exitBarrier });
  assert(held.events.some(event => event.stage === 'exit'));
  assert.deepEqual(held.actor.position, [1, 1, 0]);
  const resumed = net.step(held.actor, {}, dt, air);
  assert.deepEqual(resumed.actor.position, [1, 1, 1]);
  assert.equal(resumed.events[0].cause, 'arrival');

  const detached = net.step(blocked.actor, { detach: true }, dt, air);
  assert.equal(detached.events[0].cause, 'detach');
  assert.deepEqual(detached.actor.position, blocked.actor.position);
  assert.deepEqual(detached.actor.velocity, [0, 0, 0]);
});

test('a timed lift keeps its waiting state across JSON restore and boards the returning shuttle', () => {
  const net = traversalLinks.create({ controller, links: { lift } });
  const start = net.state({ position: [0, 1, 0] });
  const waiting = net.step(start, { traverse: 'lift' }, dt, air, { time: .75 });
  assert.equal(waiting.actor.traversal.phase, 'waiting');
  assert.equal(waiting.events[0].type, 'traversal-wait');
  const restored = net.state(JSON.parse(JSON.stringify(waiting.actor)));
  const walk = advance(net, restored, { time: .75 + dt, duration: 6 });
  const boarded = walk.events.find(event => event.type === 'traversal-enter');
  const arrived = walk.events.find(event => event.type === 'traversal-exit');
  close(boarded.time, shuttle.nextEvent(.75, [{ at: 0 }]).time);
  close(arrived.time, shuttle.nextEvent(boarded.time, [{ at: 3 }]).time);
  assert.deepEqual(arrived.position, [.3, 4, 0]);
  assert.deepEqual(walk, advance(net, waiting.actor, { time: .75 + dt, duration: 6 }));

  const down = traversalLinks.create({ controller, links: { down: { kind: 'scheduled', route: shuttle, from: 3, to: 0 } } });
  const descending = advance(down, down.state({ position: [0, 4, 0] }), {
    time: .7, duration: 5, input: i => i === 0 ? { traverse: 'down' } : {}
  });
  assert(descending.events.some(event => event.type === 'traversal-exit' && event.position[1] === 1));
});

test('a directional ring uses swept entry, debounces launch, and composes with a bounded fan', () => {
  const net = traversalLinks.create({ controller, links: {
    ring: { kind: 'impulse', entry: { at: [0, 1, 0], radius: .25, normal: [1, 0, 0] }, velocity: [8, 0, 0] },
    fan: { kind: 'flow', volume: { min: [.48, .65, -.4], max: [2, 2.8, .4] }, acceleration: [0, 15, 0], speedLimit: 3.5 }
  } });
  const start = net.state({ position: [-.3, 1, 0], velocity: [36, 0, 0] });
  const result = advance(net, start, { duration: .44 });
  assert.equal(result.events.filter(event => event.type === 'traversal-enter' && event.link === 'ring').length, 1);
  assert(result.events.some(event => event.type === 'traversal-enter' && event.link === 'fan'));
  assert(result.events.some(event => event.type === 'traversal-exit' && event.link === 'fan'));
  assert(result.actor.position[1] > 1.15);
  assert(result.actor.velocity[1] <= 3.5);
  const wrongWay = net.step({ position: [.3, 1, 0], velocity: [-36, 0, 0] }, {}, dt, air);
  const missed = net.step({ position: [-.3, 1, .3], velocity: [36, 0, 0] }, {}, dt, air);
  assert(!wrongWay.events.length && !missed.events.length);
});

test('the characters system runs authored traversal links and resumes a moving lift from checkpoints', () => {
  const source = { dt, systems: {
    g: { kind: 'gravity', config: { frame: { kind: 'uniform', acceleration: [0, -10, 0] } } },
    rig: { kind: 'mechanics', config: { bodies: { floor: { half: [4, .25, 4], position: [0, .25, 0] } } } },
    crew: { kind: 'characters', config: {
      gravity: 'g/frame', clearance: 'rig/clearance', support: 'rig/ray',
      characters: { traveler: { position: [0, 1, 0], tuning } },
      traversalLinks: { lift: { kind: 'scheduled', path: [[0, 1, 0], [0, 4, 0]], entry: { auto: true },
        motion: { mode: 'pingpong', speed: 2, stops: [{ at: 0, duration: .3 }, { at: 3, duration: .3 }] },
        exit: { offset: [.8, 0, 0] } } }
    } }
  } };
  const run = KIT.world.runtime.create(source);
  run.advance(30);
  const read = session => session.query().probe('crew/actors').value.traveler;
  assert.equal(read(run).traversal.phase, 'riding');
  assert(read(run).position[1] > 1);
  const checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
  const restored = KIT.world.runtime.create(checkpoint.world, { checkpoint });
  restored.advance(94);
  run.advance(94);
  assert.deepEqual(read(restored), read(run));
});
