const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const example = require('../examples/world-adaptive-music.json');
const acousticExample = require('../examples/world-acoustic-hatch.json');
const { runtime, scrub } = K.world;
const json = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('queued cues follow tempo changes and keep a stable order on a shared beat', () => {
  const machine = K.music.create({
    entry: 'still',
    sections: { still: { resource: 'still' }, storm: { resource: 'storm', tempo: 150 } },
    emotions: { tension: {} },
    cues: {
      signal: { resource: 'bell', quantize: 'bar' },
      refrain: { resource: 'refrain', quantize: 'phrase' },
      accent: { resource: 'accent', quantize: 'phrase' }
    },
    transitions: [{
      id: 'build', from: 'still', to: 'storm', when: { path: '/emotions/tension', value: 1 }, cue: 'accent'
    }]
  });
  const scheduled = machine.advance(machine.initial(), {
    time: .1, emotions: { tension: 1 },
    cues: [{ cue: 'signal', data: { from: 'A' } }, { cue: 'signal', data: { from: 'B' } }, { cue: 'refrain' }]
  });
  assert.deepEqual(scheduled.intents, []);
  const pending = machine.inspect(scheduled.state);
  assert.equal(pending.pendingTransition.beat, 4);
  assert.equal(pending.pendingCues[2].estimatedTime, 8);
  const result = machine.advance(json(scheduled.state), { time: 7 });
  assert.deepEqual(result.intents.map(row => [row.kind, row.cue, row.beat, row.data?.from]), [
    ['music-transition', undefined, 4, undefined],
    ['music-cue', 'accent', 4, undefined],
    ['music-cue', 'signal', 4, 'A'],
    ['music-cue', 'signal', 4, 'B'],
    ['music-cue', 'refrain', 16, undefined]
  ]);
  close(result.intents[4].time, 6.8);
  close(machine.inspect(result.state).beat, 16.5);
  assert.equal(new Set(result.intents.map(row => row.serial)).size, 5);
  assert.deepEqual(machine.advance(result.state, { time: 7 }).intents, []);
});

test('channel envelopes follow held targets and stale or superseded transitions are cancelled', () => {
  const machine = K.music.create({
    entry: 'calm',
    sections: { calm: { resource: 'calm' }, edge: { resource: 'edge' }, bright: { resource: 'bright' } },
    emotions: { tension: { default: 1, release: .4 }, relief: {} },
    transitions: [
      { id: 'resolve', from: 'calm', to: 'bright', quantize: 'half-bar',
        when: { path: '/emotions/relief', value: 1 } },
      { id: 'threat', from: 'calm', to: 'edge', quantize: 'bar',
        when: { path: '/emotions/tension', op: 'gt', value: .55 } }
    ]
  });
  const pending = machine.advance(machine.initial(), { time: .2, emotions: { tension: 0 } }).state;
  assert.equal(machine.inspect(pending).pendingTransition.rule, 'threat');
  const released = machine.advance(pending, { time: 2.2 }).state;
  assert.equal(released.section, 'calm');
  assert.equal(released.transition, null);
  close(machine.inspect(released).emotions.tension, Math.exp(-2 / .4));

  const replaced = machine.advance(pending, { time: .3, emotions: { relief: 1 } }).state;
  assert.equal(machine.inspect(replaced).pendingTransition.rule, 'resolve');
  const committed = machine.advance(replaced, { time: 1 });
  assert.equal(committed.state.section, 'bright');
  assert.equal(committed.intents[0].beat, 2);
  assert.throws(() => machine.advance(committed.state, { time: .9 }), /monotonically/);
  assert.throws(() => machine.advance(pending, { time: .3, emotions: { unknown: 1 } }), /invalid music emotions/);
  assert.throws(() => machine.validate({ ...pending, transition: { rule: 'unknown', beat: 4 } }), /pending music transition/);
});

test('beat quantization advances to the next grid when a cue is requested on a boundary', () => {
  const machine = K.music.create({
    entry: 'bed', sections: { bed: { resource: 'bed' } },
    cues: { beat: { resource: 'strike', quantize: 'beat' }, now: { resource: 'signal' } }
  });
  const atBoundary = machine.advance(machine.initial(), { time: .5, cues: [{ cue: 'beat' }, { cue: 'now' }] });
  assert.deepEqual(atBoundary.intents.map(row => [row.cue, row.time, row.beat]), [['now', .5, 1]]);
  const queued = machine.inspect(atBoundary.state).pendingCues[0];
  assert.equal(queued.estimatedTime, 1);
  assert.equal(queued.beat, 2);
  assert.equal(machine.advance(atBoundary.state, { time: 1 }).intents[0].cue, 'beat');
});

test('the world score reads spatial ambience and replays a timeline cue from a pending checkpoint', () => {
  const read = run => run.query().probe('score/state').value;
  const run = runtime.create(example);
  run.advance(20);
  const waiting = read(run);
  assert.equal(waiting.section, 'still');
  assert.equal(waiting.pendingTransition.estimatedTime, 2);
  assert(waiting.parameters.rain > .65 && waiting.parameters.rain < .8);
  assert.equal(waiting.targets.parameters.rain, .8);
  run.advance(53);
  assert.equal(read(run).pendingCues[0].beat, 6);
  const saved = json(run.checkpoint()), restored = runtime.create(saved.world, { checkpoint: saved });
  run.advance(100);
  restored.advance(100);
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
  const musicEvents = run.history.filter(row => row.system === 'score');
  assert.deepEqual(musicEvents.map(row => [row.cue ?? row.to, row.beat, row.time]), [
    ['storm', 4, 2], ['storm-entry', 4, 2], ['beacon-lit', 6, 2.8], ['still', 8, 3.6]
  ]);
  assert.deepEqual(musicEvents[2].emitter, { entity: 'beacon', socket: 'bell' });
  const log = json(run.recording());
  assert.deepEqual(runtime.replay(log).checkpoint(), run.checkpoint());
  const review = scrub.create(log, { checkpointEvery: 10 });
  review.seek(56);
  assert.equal(review.query().probe('score/intents').value[0].cue, 'beacon-lit');
  review.seek(53);
  assert.equal(review.query().probe('score/state').value.pendingCues[0].cue, 'beacon-lit');
  review.seek(100);
  assert.deepEqual(review.checkpoint(), run.checkpoint());
  assert(read(run).parameters.rain < .1);
});

test('listeners can query existing contact cues and score emitters against the same moving hatch', () => {
  const run = runtime.create(acousticExample);
  const options = { listener: { entity: 'listen-post' }, field: 'acoustics/audible' };
  const emitter = { entity: 'beacon', socket: 'speaker' };
  const opened = K.music.acoustics(run.query(), { cue: 'arrival', emitter }, options);
  assert.equal(opened.value.audible, true);
  assert(opened.value.delaySeconds > 0);
  assert.deepEqual(opened.value.direction, [1, 0, 0]);
  assert.deepEqual(K.music.acoustics(run.query(), { at: emitter }, options), opened);
  run.advance(8);
  const shut = K.music.acoustics(run.query(), { emitter }, options);
  assert.equal(shut.value.audible, false);
  assert(shut.value.bands.high.gain < opened.value.bands.high.gain);
  assert.equal(K.music.acoustics(run.query(), { cue: 'ambient' }, options).status, 'missing');
});
