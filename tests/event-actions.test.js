const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: K, makeBuilder } = require('..').load();
const storm = require('../examples/world-storm-canopy.json');
const W = K.world;
const json = value => JSON.parse(JSON.stringify(value));
const probe = (run, field, args) => run.query().probe(field, {}, args).value;
const route = (run, rule) => run.events.find(row => row.kind === 'event-action-scheduled' && row.rule === rule);

test('storm cue changes weather, then measured contact, deformation, release and spray share rewindable evidence', () => {
  const run = W.runtime.create(storm);
  const motion = () => probe(run, 'fabric/motion', { shape: 'canopy' });
  assert.equal(run.query().probe('weather/rain', [0, 1, 0]).value, 0);
  run.advance(4);
  assert.equal(route(run, 'drive-weight').due, 5);
  assert(run.events.some(row => row.timeline?.id === 'squall'));
  run.advance(5);
  assert.equal(run.query().probe('weather/rain', [0, 1, 0]).value, .045);

  let trigger;
  while (!trigger && run.view().tick < 45) {
    run.step();
    trigger = route(run, 'release-canopy');
  }
  assert(trigger);
  const contactTick = run.view().tick, contact = run.events.find(event => event.id === trigger.trigger);
  assert.equal(contact.kind, 'deformable-contact');
  const pending = json(run.checkpoint());
  assert(pending.pending.some(command => command.action === 'fabric/detach' && command.tick === trigger.due));
  assert.equal(pending.eventActionCounts['release-canopy'], 1);

  run.advance(trigger.due - 1);
  assert(Object.hasOwn(motion().attachments, 'east-mid'));
  assert(Math.min(...motion().positions.filter((_n, i) => i % 3 === 1)) < 1.5);
  assert(probe(run, 'fabric/water').canopy.captured > 0);
  run.step();
  const lost = run.events.filter(row => row.kind === 'deformable-detach');
  assert.deepEqual(lost.map(row => row.attachment), ['east-back', 'east-mid', 'east-front']);
  assert.deepEqual(Object.keys(motion().attachments), ['west-back', 'west-mid', 'west-front']);
  assert.equal(run.events.filter(row => row.kind === 'event-action-scheduled' && row.rule === 'shed-water').length, 3);
  assert.equal(probe(run, 'spray/frame').particles.length, 0);
  run.step();
  assert.deepEqual(probe(run, 'spray/contacts').map(row => row.point), lost.map(row => row.point));
  assert.equal(probe(run, 'spray/frame').particles.length, 90);
  const end = run.checkpoint();
  const resumed = W.runtime.create(pending.world, { checkpoint: pending });
  resumed.advance(end.tick);
  assert.deepEqual(resumed.checkpoint(), end);
  const log = json(run.recording());
  assert.deepEqual(W.runtime.replay(log).checkpoint(), end);
  const scrub = W.scrub.create(log, { checkpointEvery: 5, checkpointCache: 3 });
  scrub.seek(end.tick);
  assert.equal(scrub.query().probe('spray/frame').value.particles.length, 90);
  scrub.seek(contactTick);
  assert.equal(scrub.query().probe('spray/frame').value.particles.length, 0);
  scrub.seek(end.tick);
  assert.deepEqual(scrub.checkpoint(), end);
});

test('bindings, repeat budgets and pending commands stay deterministic across clips and slower systems', () => {
  const scene = { id: 'routed-bursts', dt: .1,
    systems: { spray: { kind: 'contact-effects', schedule: { every: 4 }, config: { fallback: { spray: { count: 4 } } } } },
    timeline: { duration: 1, sequences: { wet: { duration: .2, events: [
      { id: 'tap', time: .05, kind: 'tap', detail: { at: [2,3,4] } }
    ] } }, clips: [{ id: 'first', time: 0, sequence: 'wet' }, { id: 'again', time: .25, sequence: 'wet' }] },
    eventActions: {
      spray: { on: { kind: 'tap', system: 'world' }, limit: 2, actions: [
        { action: 'spray/impact', args: { point: [0,0,0], speed: 2 }, bindings: { '/point': '/at' } }
      ] }
    }
  };
  const run = W.runtime.create(scene);
  run.advance(2);
  const saved = json(run.checkpoint());
  assert.equal(saved.states.spray.pending.length, 1);
  const loaded = W.runtime.create(saved.world, { checkpoint: saved });
  run.advance(8);
  loaded.advance(8);
  assert.deepEqual(run.checkpoint(), loaded.checkpoint());
  assert.equal(run.checkpoint().eventActionCounts.spray, 2);

  const broken = json(scene);
  broken.eventActions.spray.actions[0].bindings['/point'] = '/absent';
  const bad = W.runtime.create(broken), before = bad.checkpoint();
  assert.throws(() => bad.step(), /needs event value absent/);
  assert.deepEqual(bad.checkpoint(), before);
  broken.eventActions.spray.on.system = 'missing';
  assert.throws(() => W.runtime.create(broken), /Unknown event action source/);
});

test('stage playback replays a deforming puppet, materialisation release and emitted particles', () => {
  let builds = 0, disposed = 0;
  const timeline = { tracks: [{ target: '/flex', keys: [
    { time: 0, value: 0 }, { time: .4, value: 1 }
  ] }] };
  const actions = {
    release: { on: { kind: 'leaf-contact', system: 'puppet' }, delay: .1, actions: [
      { action: 'surface/release', args: { velocity: [.5, .4, 0] } }
    ] },
    spray: { on: { kind: 'shell-released', system: 'surface' }, actions: [
      { action: 'particles/spray', args: { point: [0,0,0] }, bindings: { '/point': '/point' } }
    ] }
  };
  const control = K.eventActions.playback({ dt: 1/60, timeline, eventActions: actions, build() {
    builds++;
    const B = makeBuilder(19);
    B.iso(0, 1.2, 0, .07, B.P[3], 2.6);
    B.iso(.15, 1.4, 0, .09, B.P[4], 2.6);
    const pool = K.pool(B, 4), world = B.finish(), stage = K.stage(world);
    const particles = K.particles(stage, pool);
    let flex = 0, touched = false;
    const puppet = K.puppet(world, { parts: { wing: { ids: [0,1], pivot: [0,1.4,0] } },
      pose(_time,_dt, p) {
        p.pose.wing = { pos: [0,-.55*flex,0], scale: [1+.2*flex,1-.25*flex,1] };
      } });
    const fx = stage.add(K.materialisation.bind(stage, { ids: [0,1], drag: 0 }));
    return { world, dispose() { disposed++; }, step(dt, time, { sample, emit }) {
      flex = sample.edits[0].value;
      stage.update(dt, time);
      particles.update(dt, time);
      const contact = puppet.point('wing', [0,1.2,0]);
      if (!touched && contact[1] <= .93) {
        touched = true;
        emit('leaf-contact', { point: contact }, 'puppet');
      }
    }, actions: {
      'surface/release'({ velocity }, ctx) {
        fx.release({ velocity, normalImpulse: 0 });
        ctx.emit('shell-released', { point: fx.inspect(0).position }, 'surface');
      },
      'particles/spray'({ point }) {
        particles.emit({ p: point, v: [0,.55,0], life: 1, cols: [4] });
      }
    } };
  } });
  const snapshot = ({ world }) => Array.from(world.data);
  const start = snapshot(control.frame());
  const forward = control.seek(.66), effect = snapshot(forward);
  assert.equal(forward.world.anim.geometryOwned[0], 1);
  assert(effect[2*16 + 3] > 0);
  assert.notDeepEqual(effect, start);
  assert.deepEqual(snapshot(control.seek(0)), start);
  assert.deepEqual(snapshot(control.seek(.66)), effect);
  assert.equal(builds, 2);
  control.dispose();
  assert.equal(disposed, 2);
});

test('CLI sim scrub can review an earlier pending release in a storm recording', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-event-actions-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), recording = path.join(folder, 'shot.json');
  const source = path.resolve(__dirname, '../examples/world-storm-canopy.json');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  run('sim', 'run', source, '--ticks', '35', '--record', recording);
  const report = JSON.parse(run('sim', 'scrub', recording, '--ticks', '29,20,28', '--json'));
  assert.match(JSON.stringify(report), /release-canopy/);
  assert.match(JSON.stringify(report), /deformable-detach/);
});
