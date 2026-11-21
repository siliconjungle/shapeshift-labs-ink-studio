const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const K = ink.load().KIT, { graph, mediaGraph: A } = K.procedural;
const sampleRate = 12000;
const timecode = (numerator, denominator) => ({ numerator, denominator });

function soundtrack() {
  const samples = new Float64Array(sampleRate * 2 * 2);
  for (let i = 0; i < samples.length / 2; i++) {
    samples[i * 2] = .08 * Math.sin(i * 2 * Math.PI * 220 / sampleRate);
    samples[i * 2 + 1] = -samples[i * 2];
  }
  function strike(time, hz, amount, duration) {
    const first = Math.round(time * sampleRate), count = Math.round(duration * sampleRate);
    for (let i = 0; i < count; i++) {
      const value = amount * Math.exp(-4 * i / count) * Math.cos(i * 2 * Math.PI * hz / sampleRate);
      samples[(first + i) * 2] += value;
      samples[(first + i) * 2 + 1] -= value;
    }
  }
  strike(.25, 80, .8, .15);
  strike(.8, 2810, .43, .045);
  strike(1.20, 550, .22, .065);
  strike(1.235, 1600, .68, .045);
  return { sampleRate, channels: 2, samples };
}

test('spectral attacks separate stereo transients from a sustained tone, group nearby hits, and keep sample coordinates', () => {
  const source = soundtrack(), baseline = A.detectTransients(source, { name: 'Accent' });
  assert.deepEqual(baseline.events.map(row => row.time), [1 / sampleRate, .25, .8, 1.235]);
  for (const row of baseline.events) {
    assert.equal(row.name, 'Accent');
    assert.equal(row.detected.channel, 0);
    assert.equal(row.id, 'hit-' + row.detected.sample);
    assert.deepEqual(row.timecode, timecode(Math.round(row.time * sampleRate), sampleRate));
  }
  assert.deepEqual(A.detectTransients(source, { minGap: .02 }).events.map(row => row.time),
    [1 / sampleRate, .25, .8, 1.2, 1.235]);
  assert.ok(A.detectTransients(source, { channel: 1 }).events.every(row => row.detected.channel === 1));
  assert.deepEqual(A.detectTransients(source, { channel: 'mix' }).events, []);
});

test('the detector handles silence, final-sample strikes, and invalid analysis settings', () => {
  const source = { sampleRate, channels: 1, samples: new Float32Array(sampleRate) };
  assert.deepEqual(A.detectTransients(source).events, []);
  source.samples[source.samples.length - 1] = .9;
  assert.deepEqual(A.detectTransients(source).events.map(row => row.detected.sample), [source.samples.length - 1]);
  assert.deepEqual(A.detectTransients({ ...source, samples: [] }).events, []);
  assert.throws(() => A.detectTransients(source, { size: 100 }), /settings/);
  assert.throws(() => A.detectTransients(source, { channel: 2 }), /channels/);
});

test('an edit list moves, renames, deletes, and adds cues without mutating its source', () => {
  const reference = A.makeMusicalEvents([
    { id: 'a', name: 'Hit', timecode: timecode(5, 12), detected: { sample: 5000, sampleRate, strength: .7, channel: 0 } },
    { id: 'b', name: 'Hit', time: .75 },
    { id: 'c', name: 'Hit', time: 1 }
  ]);
  const before = JSON.stringify(reference);
  const result = A.editMusicalEvents(JSON.parse(before), [
    { op: 'move', id: 'a', time: 1.25 }, { op: 'rename', id: 'a', name: 'Glass accent' },
    { op: 'delete', id: 'b' }, { op: 'add', id: 'opening', name: 'Opening', time: 0 }
  ]);
  assert.deepEqual(result.events.map(({ id, time, name }) => [id, time, name]),
    [['opening', 0, 'Opening'], ['c', 1, 'Hit'], ['a', 1.25, 'Glass accent']]);
  assert.deepEqual(result.events.at(-1).detected, reference.events[0].detected);
  assert.equal(result.events.at(-1).timecode, undefined);
  assert.deepEqual(K.timeline.compile(result.timeline).between(1, 1.25).map(row => row.type), ['marker', 'event']);
  assert.deepEqual(A.inputReplay(result.recording).sample({ from: 1, time: 1.25 }).pulses
    .map(row => [row.channel, row.value.name]), [['music:cue', 'Glass accent']]);
  assert.equal(JSON.stringify(reference), before);
  assert.throws(() => A.editMusicalEvents(reference, [{ op: 'delete', id: 'a' },
    { op: 'delete', id: 'unknown' }]), /edit or ID/);
  assert.equal(JSON.stringify(reference), before);
  assert.throws(() => A.editMusicalEvents(reference, [{ op: 'add', id: 'a', name: 'Duplicate', time: 2 }]), /edit or ID/);
  assert.deepEqual(A.musicalEventTrack(JSON.parse(JSON.stringify(result.value))), result.value);
});

test('take and timeline clocks agree at an edited fractional frame boundary and after a seek', () => {
  const boundary = timecode(1001, 30000), take = K.timeDomains.take({ fps: timecode(30000, 1001) });
  const track = A.makeMusicalEvents([{ id: 'downbeat', name: 'Downbeat', time: .01 }]);
  const edits = [{ op: 'move', id: 'downbeat', timecode: boundary }];
  const nodes = {
    edit: { op: 'audio.editEvents', inputs: { source: track, edits, options: { exact: true } } },
    playback: { op: 'input.replay', inputs: { source: { node: 'edit', port: 'recording' } } }
  };
  const session = graph.create({ nodes, outputs: { value: { node: 'edit' }, timeline: { node: 'edit', port: 'timeline' },
    cues: { node: 'playback', port: 'pulses' } } });
  const at = frame => session.evaluate({}, { take: take.at(frame) }).outputs;
  assert.deepEqual(at(0).cues, []);
  const first = at(1);
  assert.deepEqual(first.cues.map(row => row.value.name), ['Downbeat']);
  assert.deepEqual(first.value.events[0].timecode, boundary);
  assert.deepEqual(at(2).cues, []);
  assert.deepEqual(at(1), first);
  assert.deepEqual(K.timeline.compile(first.timeline, { exact: true }).forTake(take.at(1)).cues
    .map(row => row.id), ['downbeat', 'downbeat']);
});
