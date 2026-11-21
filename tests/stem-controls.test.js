const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('..').load().KIT;
const { mediaGraph: A, graph } = K.procedural;
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, a + ' ~= ' + b);
const audio = (samples, sampleRate = 10, channels = 1) => ({ samples, sampleRate, channels });

test('stem followers respond independently and retain hysteresis across seeks', () => {
  const source = audio([.8, .8, .45, .45, .25, .8, 0]);
  const bank = A.stemControls({ drums: source, swell: source }, {
    drums: { envelope: { attack: 0, release: 0, threshold: .6, resetThreshold: .35 } },
    swell: { envelope: { attack: .2, release: .4, threshold: .48, resetThreshold: .4 } }
  }, { rate: 10 });
  const one = bank.sample({ time: .1 }), two = bank.sample({ time: .2 });
  near(one.value.drums.envelope, .8);
  near(one.value.swell.envelope, .8 * (1 - Math.exp(-.5)));
  near(two.value.swell.envelope, .8 * (1 - Math.exp(-1)));
  assert.deepEqual(bank.recording.events.map(row => [row.time, row.channel]), [
    [.1, 'stem:drums:envelope'], [.2, 'stem:swell:envelope'], [.6, 'stem:drums:envelope']
  ]);
  assert.equal(bank.sample({ time: .4 }).value.drums.gates.envelope, true);
  assert.equal(bank.sample({ time: .5 }).value.drums.gates.envelope, false);
  assert.equal(bank.sample({ time: .9 }).value.drums.envelope, 0);
  assert.ok(bank.sample({ time: .9 }).value.swell.envelope > 0);
  assert.deepEqual(bank.sample({ time: .2 }), two);
  assert.deepEqual(bank.sample({ time: .075 }).value.drums, { envelope: 0, bands: {}, gates: { envelope: false } });
});

test('trailing spectra isolate named bands and retain energy from opposite-phase channels', () => {
  const sampleRate = 1024, onset = 384;
  const makeTone = hz => audio(Float64Array.from({ length: 2 * sampleRate }, (_, i) => {
    const n = Math.floor(i / 2);
    return n < onset ? 0 : (i % 2 ? -1 : 1) * .8 * Math.sin(2 * Math.PI * n * hz / sampleRate);
  }), sampleRate, 2);
  const settings = channel => ({ channel, fft: { size: 128 }, bands: {
    low: { hz: [48, 82], threshold: .5, attack: 0, release: .1 },
    high: { hz: [230, 282], threshold: .4, attack: 0, release: .25 }
  } });
  const bank = A.stemControls({ bass: makeTone(64), hats: makeTone(256), mix: makeTone(64) }, {
    bass: settings('all'), hats: settings('all'), mix: settings('mix')
  }, { rate: 32 });
  const early = bank.sample({ time: .36 });
  assert.equal(early.value.bass.bands.low, 0);
  assert.equal(early.value.hats.bands.high, 0);
  const full = bank.sample({ time: .75 }).value;
  near(full.bass.bands.low, .8);
  near(full.hats.bands.high, .8);
  assert.ok(full.hats.bands.low < .002);
  assert.ok(full.bass.bands.high < .002);
  assert.equal(full.mix.envelope, 0);
  assert.equal(full.mix.bands.low, 0);
  assert.deepEqual(bank.recording.events.map(e => e.channel), ['stem:hats:high', 'stem:bass:low']);
  for (const trigger of bank.recording.events) assert.ok(trigger.time > onset / sampleRate);
});

test('a partial final block has an exact take boundary, and release continues past the source', () => {
  const take = K.timeDomains.take({ fps: { numerator: 30000, denominator: 1001 } });
  const bank = A.stemControls({ kick: audio([1], 30) }, { kick: {
    offset: { numerator: 1, denominator: 30000 },
    envelope: { threshold: .5, attack: 0, release: .2 }
  } }, { rate: 20 });
  const first = bank.sample({ take: take.at(0) }), next = bank.sample({ take: take.at(1) });
  assert.equal(first.value.kick.envelope, 0);
  assert.deepEqual(first.events, []);
  assert.equal(next.value.kick.envelope, 1);
  assert.deepEqual(next.events[0].timecode, { numerator: 1001, denominator: 30000 });
  assert.deepEqual(bank.sample({ take: take.at(2) }).events, []);
  near(bank.sample({ time: next.events[0].time + .2 }).value.kick.envelope, Math.exp(-1));
  assert.equal(bank.sample({ time: next.events[0].time + .2 }).value.kick.gates.envelope, false);
  assert.deepEqual(bank.sample({ take: take.at(1) }), next);
});

test('graph-linked stems expose native replay pulses and retain analysis across time changes', () => {
  const link = (node, port = 'value') => ({ node, port });
  const session = graph.create({ nodes: {
    bass: { op: 'audio.buffer', inputs: audio([.9, .9, 0]) },
    hats: { op: 'audio.buffer', inputs: audio([0, .5, 0]) },
    stems: { op: 'data.record', inputs: { bass: link('bass'), hats: link('hats') } },
    controls: { op: 'audio.stemControls', inputs: { stems: link('stems'), settings: {
      bass: { envelope: { attack: 0, release: 0, threshold: .7 } },
      hats: { envelope: { attack: 0, release: 0, threshold: .4 } }
    }, options: { rate: 10, fps: 10 } } },
    replay: { op: 'input.replay', inputs: { source: link('controls', 'recording'), options: { fps: 10 } } }
  }, outputs: { value: link('controls'), events: link('controls', 'events'), recording: link('controls', 'recording'),
    pulses: link('replay', 'pulses') } });
  const at = time => session.evaluate({}, { time }).outputs;
  const start = at(.1), end = at(.2);
  assert.equal(start.recording, end.recording);
  assert.equal(start.events[0].channel, 'stem:bass:envelope');
  assert.equal(end.events[0].channel, 'stem:hats:envelope');
  assert.deepEqual(end.events, end.pulses);
  assert.deepEqual(at(.1), start);
  assert.throws(() => A.stemControls({ bass: audio([0]) }, { hats: {} }), /named stems/);
  assert.throws(() => A.stemControls({ bass: audio([0]) }, { bass: { envelope: { threshold: .3, resetThreshold: .5 } } }),
    /thresholds/);
});
