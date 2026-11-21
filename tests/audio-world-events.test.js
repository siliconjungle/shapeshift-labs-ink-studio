const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const K = ink.load().KIT, W = K.world, A = K.procedural.mediaGraph;
const copy = value => JSON.parse(JSON.stringify(value));
const ratio = (numerator, denominator) => ({ numerator, denominator });

test('named sources preserve cue identity and pulse payloads through filtering, offsets, and exact trims', () => {
  const score = A.makeMusicalEvents([
    { id: 'before', name: 'Offstage', time: 0 }, { id: 'seed', name: 'Seed', timecode: ratio(1, 3) }
  ]);
  const stems = A.recording({ events: [
    { time: .1, channel: 'stem:other:envelope', kind: 'pulse', value: 1 },
    { time: .2, channel: 'stem:drums:envelope', kind: 'set', value: .1 },
    { time: .5, channel: 'stem:drums:envelope', kind: 'pulse', value: { level: .8 } }
  ] });
  const timeline = K.timeline.compile({
    cueTracks: { first: { source: score, offset: ratio(-1, 6) } },
    sequences: { part: { duration: 1, cueTracks: {
      score: { source: score }, drums: { source: stems, channels: ['stem:drums:envelope'] }
    } } },
    clips: [{ id: 'cut', sequence: 'part', time: .5, in: .25, out: .75, duration: 1 }]
  }, { exact: true });
  assert.deepEqual(timeline.events.map(row => [row.id, row.kind, row.path, row.time]), [
    ['seed', 'music-cue', ['first'], 1 / 6],
    ['seed', 'music-cue', ['cut', 'score'], 2 / 3],
    ['pulse-2', 'audio-trigger', ['cut', 'drums'], 1]
  ]);
  assert.deepEqual(timeline.events[0].detail, { cueTrack: 'first', cueId: 'seed', name: 'Seed',
    sourceTime: 1 / 3, sourceTimecode: ratio(1, 3) });
  assert.deepEqual(timeline.events.at(-1).detail.value, { level: .8 });
  const take = K.timeDomains.take({ fps: 6 });
  assert.deepEqual(timeline.forTake(take.at(0)).cues, []);
  assert.equal(timeline.forTake(take.at(1)).cues[0].id, 'seed');
});

function cueRule(name, ...actions) {
  return { on: { kind: 'music-cue', system: 'world', where: { path: '/name', value: name } }, actions };
}
function world() {
  const track = A.editMusicalEvents(A.makeMusicalEvents([
    { id: 'spawn', name: 'Spawn', time: .1 }, { id: 'growth', name: 'Grow', time: .18 },
    { id: 'stain', name: 'Paint', time: .3 }
  ]), [{ op: 'move', id: 'growth', time: .2 }]).value;
  const samples = Array.from({ length: 20 }, (_, i) => i === 7 ? .8 : 0);
  const recorded = A.stemControls({ drums: { sampleRate: 20, channels: 1, samples } }, {
    drums: { envelope: { attack: 0, release: 0, threshold: .5 } }
  }, { rate: 20 }).recording;
  return {
    format: 'ink-studio/world', id: 'cue-terrarium', dt: .05, takeClock: { simulationRate: 20, fps: 20 },
    systems: {
      flock: { kind: 'agents', config: { bounds: { min: [-6, -1, -6], max: [6, 8, 6] },
        species: { seed: { mode: 'fly', speed: 1 } }, agents: {} } },
      growth: { kind: 'control', config: { op: 'timer', ticks: 20 } },
      rig: { kind: 'mechanics', config: { bodies: {
        tile: { fixed: true, position: [0, .2, 0], half: [.5, .2, .5] },
        bead: { position: [2, .2, 0], half: [.12, .12, .12], mass: 1 }
      } } }
    },
    timeline: { duration: 1, cueTracks: { score: { source: track },
      drums: { source: recorded, channels: ['stem:drums:envelope'] } } },
    eventActions: {
      spawn: cueRule('Spawn', { action: 'flock/spawn', args: { agent: 'seed', species: 'seed', position: [0, 2, 0] } }),
      grow: cueRule('Grow', { action: 'world/input', args: { port: 'growth/enabled', value: true } }),
      paint: cueRule('Paint', { action: 'rig/surface-stamp', args: { body: 'tile', face: '+z',
        stamp: { channel: 'paint', value: '#ef7c46', brush: { kind: 'rect', min: [0, 0], max: [1, 1] } } } }),
      bounce: { on: { kind: 'audio-trigger', where: { path: '/channel', value: 'stem:drums:envelope' } },
        actions: [{ action: 'rig/impulse', args: { body: 'bead', linear: [0, 1, 0] },
          bindings: { '/linear/1': '/value/level' } }] }
    }
  };
}

test('embedded audio drives native spawning, growth, paint and physics across checkpoints and replay', () => {
  const run = W.runtime.create(world(), { recordRun: true });
  run.advance(2);
  const spawnCue = run.events.find(row => row.kind === 'music-cue');
  assert.equal(spawnCue.cueId, 'spawn');
  assert.deepEqual(spawnCue.timeline.path, ['score']);
  assert.equal(run.events.find(row => row.rule === 'spawn').due, 3);
  run.advance(3);
  assert.ok(run.query().probe('flock/agents').value.seed);
  run.advance(4);
  assert.equal(run.checkpoint().states.growth.value, 0);
  run.advance(5);
  assert.equal(run.checkpoint().states.growth.value, 1);
  run.advance(7);
  const paint = run.query().probe('rig/surface-state', {}, { body: 'tile', face: '+z', uv: [.5, .5] }).value.values.paint;
  assert.equal(paint.coverage, 1);
  run.advance(8);
  assert.equal(run.events.find(row => row.kind === 'audio-trigger').value.level, .8);
  assert.equal(run.events.find(row => row.rule === 'bounce').due, 9);
  const snapshot = copy(run.checkpoint());
  assert.deepEqual(snapshot.pending.find(row => row.tick === 9).args.linear, [0, .8, 0]);
  run.advance(9);
  assert.ok(run.events.some(row => row.kind === 'impulse'));
  run.advance(17);
  const expected = run.checkpoint(), recording = copy(run.recording());
  const restored = W.runtime.create(snapshot.world, { checkpoint: snapshot });
  restored.advance(17);
  assert.deepEqual(restored.checkpoint(), expected);
  assert.deepEqual(W.runtime.replay(recording).checkpoint(), expected);
  const scrub = W.scrub.create(recording, { checkpointEvery: 4 });
  scrub.seek(17);
  scrub.seek(2);
  assert.equal(scrub.checkpoint().states.growth.value, 0);
  scrub.seek(17);
  assert.deepEqual(scrub.checkpoint(), expected);
});

test('invalid cue sources and ambiguous clip paths are rejected before the world advances', () => {
  const track = A.makeMusicalEvents([{ id: 'hit', name: 'Hit', time: 0 }]);
  assert.throws(() => K.timeline.compile({ cueTracks: { score: { source: track, channels: ['music:cue'] } } }), /channels/);
  assert.throws(() => K.timeline.compile({ cueTracks: { score: { source: { format: 'raw', version: 1, events: [] } } } }), /portable/);
  assert.throws(() => K.timeline.compile({ cueTracks: { score: { source: track } },
    sequences: { a: { duration: 1 } }, clips: [{ id: 'score', sequence: 'a', time: 0 }] }), /distinct names/);
});
