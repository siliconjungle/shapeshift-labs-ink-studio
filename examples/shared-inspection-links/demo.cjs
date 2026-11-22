const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const folder = path.resolve(process.argv[2]);
const repo = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(__dirname, '../..');
const { world: W } = require(repo).load().KIT;
const cli = path.join(repo, 'cli/ink-studio.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const file = name => path.join(folder, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
  cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']
});

fs.mkdirSync(folder, { recursive: true });
const story = path.join(repo, 'examples/story-documents/low-bank-sluice');
const world = read(story + '.world.json');
world.storyDocuments = [read(story + '.json')];
world.causality = { limit: 4096 };
world.entities = Object.fromEntries([
  ['west-pier', [-1.4, .32, 0], [.48, .56, 1.15], [19, 20, 21, 22, 23]],
  ['east-pier', [1.4, .32, 0], [.48, .56, 1.15], [19, 20, 21, 22, 23]],
  ['gate', [0, .22, .24], [.94, .45, .13], [20, 21, 22, 23]],
  ['walkway', [0, .84, 0], [1.88, .12, .34], [19, 20, 21, 22, 23]],
  ['channel', [0, -.17, 0], [.91, .03, 2.6], [12, 13, 14, 15]],
  ['beacon', [-1.44, 1.15, .12], [.16, .28, .16], [20, 21, 22, 23]]
].map(([id, position, half, ramp]) => [id, { position, visual: { half, ramp } }]));
world.visual = {
  bounds: { min: [-3, -1, -2.6], max: [3, 2, 2.6] }, ground: -.25, resolution: .13,
  camera: { target: [0, .24, 0], dist: 7.3, yaw: .52, pitch: .66 }
};
save('sluice.world.json', world);
run('sim', 'run', 'sluice.world.json', '--ticks', '13', '--record', 'sluice.run.json');
run('story', 'events', 'sluice.run.json', '--format', 'envelopes', '--out', 'committed.json');
const event = read(file('committed.json')).events.find(row =>
  row.kind === 'story-beat-entered' && row.payload.beat?.kind === 'commitment');
assert(event, 'The crew commitment should appear in the source recording');
const { tick } = event;
const beatId = W.inspectionLinks.identify(event);

run('trace', 'sluice.run.json', 'world/cause', '--beat', beatId, '--out', 'causal.json');
assert.equal(read(file('causal.json')).value.nodes[0].beatId, beatId);
run('story', 'events', 'sluice.run.json', '--format', 'timeline', '--out', 'story.timeline.json');
run('sim', 'render', 'sluice.run.json', '--beat', beatId, '--out', 'sluice.png', '--w', '384', '--h', '256', '--colored',
  '--recipe', 'sluice.shot.json');
assert.equal(read(file('sluice-beat.json')).event.id, event.id);
run('shot', 'replay', 'sluice.shot.json', '--out', 'sluice-replayed.png');
assert.equal(read(file('sluice-replayed-beat.json')).file, 'sluice-replayed.png');

const clock = { fps: 10, simulationRate: 10, sampleRate: 48000 };
save('clock.json', clock);
save('patch.graph.json', {
  format: 'ink-studio/graph-project', version: 1,
  inputs: { color: { type: 'rgb8', default: [35, 71, 88, 255] } },
  assets: { recording: { format: 'json', file: 'sluice.run.json' } },
  nodes: {
    source: { op: 'jsonAsset', inputs: { name: 'recording' } },
    world: { op: 'sim.world', inputs: { source: { node: 'source' } } },
    beat: { op: 'sim.worldPulse', inputs: { source: { node: 'world' }, options: { kind: 'story-beat-entered' } } },
    canvas: { op: 'raster.canvas', inputs: { width: 128, height: 64, color: { input: 'color' } } }
  },
  outputs: { picture: { node: 'canvas' }, pulse: { node: 'beat' } }
});
const watch = run('patch', 'run', 'patch.graph.json', '--fps', '10', '--frames', String(tick + 2),
  '--out', 'watches', '--keep', '--progress', '--watch', 'event=$pulse,picture=$picture');
fs.writeFileSync(file('watches/watch.ndjson'), watch);
run('graph', 'clip', 'patch.graph.json', '--clock', 'clock.json', '--output', 'picture',
  '--from', String(tick - 1), '--to', String(tick + 2), '--format', 'frames', '--out', 'clip');

const clip = { source: 'sluice', in: { tick: tick - 1 }, out: { tick: tick + 2 }, duration: { frame: 6 } };
save('edit.json', {
  format: 'ink-studio/clock-map', version: 1, id: 'sluice-edit', clock,
  sources: { sluice: { clock, events: { file: 'committed.json' } } },
  clips: [{ ...clip, id: 'first-cut', at: { frame: 0 } }, { ...clip, id: 'repeat', at: { frame: 7 } }],
  cues: { callCrew: { source: 'sluice', at: { beatId }, preset: 'amber' } }
});
run('take', 'map', 'edit.json', '--out', 'edit.map.json');
run('take', 'map', 'edit.json', '--format', 'timeline', '--out', 'edit.timeline.json');
const placements = read(file('edit.map.json')).cues.filter(cue => cue.beatId === beatId);
assert.deepEqual(placements.map(cue => [cue.anchor.event.tick, cue.at.showFrame]), [[tick, 2], [tick, 9]]);

save('show.json', {
  format: 'ink-studio/patch-show', version: 1, patch: 'patch.graph.json', output: 'picture',
  fps: 10, frames: 11, cueMap: 'edit.map.json', initial: 'blue', slowMs: 1000,
  cues: [{ frame: 6, preset: 'blue' }],
  presets: { blue: { color: [35, 71, 88, 255] }, amber: { color: [226, 139, 41, 255] } },
  projector: { port: 0 }
});
run('patch', 'show', 'show.json', '--rehearse', '--report', 'rehearsal.json');
const rehearsal = read(file('rehearsal.json'));
assert.deepEqual(rehearsal.beatLinks.filter(row => row.beatId === beatId && row.status === 'applied')
  .map(row => row.scheduledFrame), [2, 9]);

const reports = ['causal.json', 'watches/watch.ndjson', 'story.timeline.json', 'edit.map.json', 'edit.timeline.json',
  'clip/report.json', 'sluice-beat.json', 'sluice-replayed-beat.json', 'rehearsal.json', 'committed.json'];
run('beat', beatId, ...reports, '--out', 'inspection.json');
const inspection = read(file('inspection.json'));
assert.deepEqual(inspection.unmatched, []);
for (const match of inspection.matches) {
  if (match.artifact) assert(fs.existsSync(file(match.artifact)), match.artifact);
}
run('sim', 'run', 'sluice.world.json', '--ticks', String(tick), '--checkpoint', 'decision.checkpoint.json');
const forks = ['reinforce', 'evacuate'].map(branch => {
  run('sim', 'fork', 'decision.checkpoint.json', '--branch', branch, '--ticks', '13', '--record', branch + '.run.json');
  run('story', 'events', branch + '.run.json', '--format', 'envelopes', '--out', branch + '.events.json');
  const events = read(file(branch + '.events.json')).events;
  const consequence = events.find(row => row.branch === branch && row.payload.beat?.kind === 'consequence');
  assert(consequence);
  run('trace', branch + '.run.json', 'world/cause', '--beat', beatId, '--out', branch + '.inherited.json');
  return { branch, id: consequence.id, beatId: W.inspectionLinks.identify(consequence) };
});
assert.equal(forks[0].id, forks[1].id);
assert.notEqual(forks[0].beatId, forks[1].beatId);
run('beat', beatId, 'reinforce.inherited.json', 'evacuate.inherited.json', '--out', 'inherited.inspection.json');
assert.equal(read(file('inherited.inspection.json')).matches.length, 2);
run('beat', forks[0].beatId, 'reinforce.events.json', 'evacuate.events.json', '--out', 'fork.inspection.json');
assert.deepEqual(read(file('fork.inspection.json')).unmatched, ['evacuate.events.json']);

console.log(JSON.stringify({ beatId, tick, editedFrames: [2, 9], index: file('inspection.json'), forks }, null, 2));
