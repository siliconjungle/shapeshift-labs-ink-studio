const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('..').load().KIT;
const { musicTiming, graph } = K.procedural;
const ratio = (numerator, denominator) => ({ numerator, denominator });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, actual + ' ~= ' + expected);
const map = { tempo: 120, beatsPerBar: 4, barsPerPhrase: 2, swing: ratio(2, 3),
  changes: [{ beat: 8, tempo: 150 }, { beat: 12, swing: .5 }] };

test('beat, bar and phrase positions resolve continuously through tempo changes and swung half-beats', () => {
  const clock = musicTiming.compile(map);
  assert.deepEqual(clock.timecodeAt({ beat: .5 }), ratio(1, 3));
  assert.deepEqual(clock.timecodeAt({ beat: .75 }), ratio(5, 12));
  assert.equal(clock.timeAt({ phrase: 1 }), 4);
  assert.equal(clock.timeAt({ phrase: 1, bar: 1 }), 5.6);
  assert.equal(clock.timeAt({ phrase: 1, beat: 4 }), 5.6);
  assert.deepEqual(clock.timecodeAt({ bar: 2, beat: .5 }), ratio(64, 15));
  assert.deepEqual(clock.timecodeAt({ bar: 2, beat: .5, offset: ratio(-1, 30) }), ratio(127, 30));
  assert.deepEqual(clock.sample(4), { time: 4, beat: 8, beatInBar: 0, bar: 2, barInPhrase: 0, phrase: 1,
    tempo: 150, swing: 2 / 3 });
  assert.equal(clock.sample(5.6).swing, .5);
  for (const beat of [0, .23, .5, 3.75, 7.9, 8, 8.5, 8.75, 11.25, 12, 15.875]) {
    near(clock.sample(clock.timeAt({ beat })).beat, beat);
    near(clock.sample(clock.timecodeAt({ beat })).beat, beat);
  }
  const displaced = musicTiming.compile({ origin: 2, tempo: 140 });
  assert.equal(displaced.sample(displaced.timeAt({ bar: 1 })).bar, 1);
  assert.equal(displaced.sample(1).bar, -1);
});

test('scene timing mixes seconds and music and resolves nested trim points on their source clock', () => {
  const timeline = K.timeline.compile({
    tempoMap: map, duration: { phrase: 2 },
    tracks: [{ target: '/look/glow', keys: [
      { time: 0, value: 0 }, { time: { phrase: 1 }, value: 1 }, { time: { bar: 2, beat: .5, offset: .04 }, value: .5 }
    ] }],
    markers: [{ id: 'chorus', time: { phrase: 1 } }],
    audio: [{ id: 'accent', time: { beat: 8.5 }, cue: 'click' }],
    sequences: {
      slow: { tempoMap: { tempo: 60 }, duration: { beat: 4 }, events: [{ id: 'show', time: { beat: 2 }, kind: 'reveal' }] },
      shared: { markers: [{ id: 'half', time: { beat: .5 } }] }
    },
    clips: [
      { id: 'nested', sequence: 'slow', time: { phrase: 1 }, in: { beat: 1 }, out: { beat: 3 }, duration: 1 },
      { id: 'inherit', sequence: 'shared', time: 1 }
    ]
  });
  assert.equal(timeline.duration, 7.2);
  near(timeline.markers.find(row => row.id === 'half').time, 1 + 1 / 3);
  assert.equal(timeline.markers.find(row => row.id === 'chorus').time, 4);
  assert.equal(timeline.events[0].time, 4.5);
  assert.deepEqual(timeline.events[0].path, ['nested']);
  assert.equal(timeline.sample(4).edits[0].value, 1);
  near(timeline.sample(64 / 15 + .04).edits[0].value, .5);
  near(timeline.between(4, 4.5).find(row => row.id === 'accent').time, 64 / 15);
});

test('exact take boundaries deliver a swung cue once and the graph clock agrees on rewind', () => {
  const rate = ratio(30000, 1001);
  const tempoMap = { tempo: ratio(225000, 1001), swing: .625, changes: [{ beat: 1, tempo: 100 }] };
  const clock = K.timeDomains.take({ fps: rate });
  const timeline = K.timeline.compile({ tempoMap, markers: [{ id: 'offbeat', time: { beat: .5 } }] }, { exact: true });
  const session = graph.create({
    nodes: { music: { op: 'music.clock', inputs: { map: tempoMap } } }, outputs: { value: { node: 'music' } }
  });
  const at = n => session.evaluate({}, { take: clock.at(n) }).outputs.value;
  assert.deepEqual(timeline.forTake(clock.at(4)).cues, []);
  assert.equal(timeline.forTake(clock.at(5)).cues[0].frame, 5);
  assert.deepEqual(timeline.forTake(clock.at(6)).cues, []);
  assert.equal(at(5).beat, .5);
  assert.equal(at(8).tempo, 100);
  assert.equal(at(8).beat, 1);
  assert.equal(at(5).beat, .5);
});

test('resolved graph keys feed the existing animation node and malformed positions are rejected', () => {
  const links = { node: 'resolved' };
  const session = graph.create({ nodes: {
    resolved: { op: 'music.resolve', inputs: { map, items: [
      { time: 0, value: { exposure: 0 } },
      { time: { beat: .5, offset: .05 }, value: { exposure: 1 } }
    ] } },
    animate: { op: 'anim.keyframes', inputs: { channels: { exposure: 'number' }, keys: links } }
  }, outputs: { keys: links, visual: { node: 'animate' } } });
  const t = 1 / 3 + .05;
  near(session.evaluate({}, { time: t / 2 }).outputs.visual.exposure, .5);
  const after = session.evaluate({}, { time: t }).outputs;
  assert.equal(after.visual.exposure, 1);
  assert.deepEqual(after.keys[1].value, { exposure: 1 });
  assert.throws(() => musicTiming.compile({ changes: [{ beat: 4, tempo: 120 }, { beat: 4, tempo: 150 }] }), /increasing/);
  assert.throws(() => musicTiming.compile(map).timeAt({ phrase: 0, bar: 2 }), /outside its range/);
  assert.throws(() => K.timeline.compile({ markers: [{ id: 'cue', time: { beat: 2 } }] }), /needs a tempo map/);
  assert.throws(() => K.timeline.compile({ tempoMap: {}, markers: [{ id: 'cue', time: { beat: 0, offset: -.1 } }] }), /timeline time/);
});
