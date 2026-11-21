const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const { mediaGraph: A, graph } = K.procedural;
const exact = (numerator, denominator) => ({ numerator, denominator });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + ' ≈ ' + b);

test('capture aligns dissimilar samples on one clock and records analyser features, not PCM', () => {
  let now = 10, level = .5;
  const capture = A.modulationCapture({ now: () => now, initial: { 'midi:ch1:cc74': .1 } });
  const analyser = { context: { sampleRate: 3200 }, fftSize: 32, frequencyBinCount: 16,
    getFloatTimeDomainData(buffer) { buffer.fill(level); },
    getFloatFrequencyData(buffer) {
      buffer.fill(-Infinity);
      buffer[1] = -20; buffer[2] = -40; buffer[5] = 0;
    } };
  const sample = capture.microphone(analyser, { bands: { low: [100, 300], quiet: [800, 1200] } });
  now = 10.325;
  sample();
  capture.midi([0xb0, 74, 100], { at: 10.2 });
  capture.gesture({ phase: 'start', x: .25, y: .6, pressure: .7 }, { at: 10.2 });
  level = .25;
  now = 10.6;
  analyser.fftSize = 64;
  analyser.frequencyBinCount = 32;
  sample();
  capture.gesture({ phase: 'end', x: .95, y: .2, pressure: .5 }, { at: 10.6 });
  const recording = capture.snapshot(), replay = A.inputReplay(recording);
  assert.deepEqual(recording.events.slice(0, 2).map(row => row.channel), ['midi:ch1:cc74', 'gesture:x']);
  assert.ok(recording.events.filter(row => row.channel.startsWith('mic:')).every(row => typeof row.value === 'number'));
  const at = replay.sample({ time: .325 }).value;
  close(at['mic:rms'], .5);
  close(at['mic:peak'], .5);
  close(at['mic:band:low'], .1);
  close(at['mic:band:quiet'], 0);
  close(at['midi:ch1:cc74'], 100 / 127);
  assert.equal(at['gesture:active'], true);
  const end = replay.sample({ time: .6, from: .325 });
  assert.equal(end.value['gesture:pressure'], 0);
  assert.equal(end.value['gesture:active'], false);
  assert.deepEqual(end.pulses.map(row => row.channel), ['gesture:end']);
  assert.deepEqual(replay.sample({ time: .325 }).value, at);
  assert.deepEqual(recording.events.find(row => row.channel === 'mic:rms').timecode, exact(13, 40));
});

test('MIDI channels preserve controller, note-on, pressure and bend semantics without partial packets', () => {
  const capture = A.modulationCapture({ origin: 0 });
  capture.midi(Uint8Array.of(0xb2, 74, 127), { at: .1 });
  capture.midi([0x92, 64, 96], { at: .2 });
  capture.midi([0xd2, 32], { at: .2 });
  capture.midi([0x92, 64, 0], { at: .3 });
  capture.midi([0xe2, 0, 0], { at: .35 });
  capture.midi([0xe2, 127, 127], { at: .4 });
  assert.deepEqual(capture.midi([0xf8], { at: .42 }), []);
  const before = capture.snapshot();
  assert.throws(() => capture.midi([0xb0, 74], { at: .5 }), /Malformed MIDI/);
  assert.throws(() => capture.write([{ channel: 'test:valid', value: 1 }, { channel: 'test:invalid', value: Infinity }], .7), /finite JSON/);
  assert.throws(() => capture.write([{ channel: 'early', value: 1 }], -.5), /capture origin/);
  assert.deepEqual(capture.snapshot(), before);
  const replay = A.inputReplay(before);
  const played = replay.sample({ time: .25, from: .1 });
  close(played.value['midi:ch3:note64'], 96 / 127);
  close(played.value['midi:ch3:pressure'], 32 / 127);
  assert.deepEqual(played.pulses.map(row => row.channel), ['midi:ch3:note64:on']);
  assert.equal(replay.sample({ time: .35 }).value['midi:ch3:note64'], 0);
  assert.equal(replay.sample({ time: .35 }).value['midi:ch3:bend'], -1);
  assert.equal(replay.sample({ time: .4 }).value['midi:ch3:bend'], 1);
});

test('explicit listeners preserve event timestamps and release or ignore detached sources', () => {
  class Port extends EventTarget {
    send(type, fields) { this.dispatchEvent(Object.assign(new Event(type), fields)); }
  }
  let time = 1;
  const capture = A.modulationCapture({ now: () => time });
  const input = new Port(), surface = new Port();
  surface.getBoundingClientRect = () => ({ left: 10, top: 20, width: 30, height: 40 });
  let active;
  surface.setPointerCapture = key => { active = key; };
  surface.hasPointerCapture = key => key === active;
  surface.releasePointerCapture = () => { active = undefined; };
  const detachMIDI = capture.attachMIDI(input, { time: e => e.at });
  const detachPointer = capture.attachPointer(surface, { time: e => e.at });
  input.send('midimessage', { data: [0xb0, 7, 127], at: 1.1 });
  surface.send('pointerdown', { pointerId: 4, button: 0, at: 1.1, clientX: 25, clientY: 30, pressure: .6 });
  surface.send('pointermove', { pointerId: 6, at: 1.2, clientX: 40, clientY: 58 });
  assert.equal(active, 4);
  time = 1.3; detachPointer(); detachMIDI();
  assert.equal(active, undefined);
  input.send('midimessage', { data: [0xb0, 7, 0], at: 1.4 });
  surface.send('pointerdown', { pointerId: 5, button: 0, at: 1.4, clientX: 40, clientY: 58 });
  const replay = A.inputReplay(capture.snapshot());
  assert.equal(replay.sample({ time: .2 }).value['pointer:active'], true);
  const end = replay.sample({ time: .4, from: .2 });
  close(end.value['pointer:x'], .5);
  close(end.value['pointer:y'], .25);
  assert.equal(end.value['pointer:active'], false);
  assert.equal(end.value['midi:ch1:cc7'], 1);
  assert.deepEqual(end.pulses.map(row => row.channel), ['pointer:cancel']);
});

test('editing imported recordings changes only addressed rows and honors exact takes after rewind', () => {
  const capture = A.modulationCapture({ origin: exact(3, 1) });
  capture.write([{ channel: 'one', value: .3 }, { channel: 'cue', kind: 'pulse', value: true }], exact(301, 100));
  const original = capture.snapshot(), before = JSON.stringify(original);
  const boundary = exact(1001, 30000), take = K.timeDomains.take({ fps: exact(30000, 1001) });
  const session = graph.create({ nodes: {
    edited: { op: 'input.editRecording', inputs: { source: original, edits: [
      { op: 'move', index: 1, timecode: boundary }, { op: 'set', index: 0, value: .8 },
      { op: 'add', event: { channel: 'new', value: 1, time: .017 } }
    ] } },
    replay: { op: 'input.replay', inputs: { source: { node: 'edited' } } }
  }, outputs: { value: { node: 'replay' }, pulses: { node: 'replay', port: 'pulses' } } });
  const at = n => session.evaluate({}, { take: take.at(n) }).outputs;
  assert.deepEqual(at(0).pulses, []);
  assert.deepEqual(at(1).value, { one: .8, new: 1 });
  assert.deepEqual(at(1).pulses[0].timecode, boundary);
  assert.deepEqual(at(2).pulses, []);
  assert.equal(at(1).pulses.length, 1);
  assert.deepEqual(A.editRecording(original, [{ op: 'delete', index: 1 }]).events.map(row => row.channel), ['one']);
  assert.throws(() => A.editRecording(original, [{ op: 'delete', index: 0 }, { op: 'set', index: 0, value: .5 }]), /row index/);
  assert.equal(JSON.stringify(original), before);
});
