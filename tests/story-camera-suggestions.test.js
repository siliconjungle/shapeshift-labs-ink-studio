const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();

const W = K.world, api = W.storyCamera;
function recording() {
  const run = W.runtime.create({
    id: 'camera-harbor', dt: .1, history: { enabled: false },
    entities: {
      pilot: { position: [-1, .5, 0], visual: { half: [.2, .3, .16] } },
      keeper: { position: [1, .5, 0], visual: { half: [.2, .3, .16] } }
    },
    visual: { bounds: { min: [-2, -.5, -2], max: [2, 2, 2] }, ground: -.2, resolution: .12 },
    commands: [
      { tick: 1, action: 'world/event', args: { kind: 'arrival', actor: 'unmapped-skiff' } },
      { tick: 2, action: 'world/event', args: { kind: 'argument', subjects: {
        pilot: { kind: 'actor', id: 'pilot' }, keeper: { kind: 'actor', id: 'keeper' }
      } } },
      { tick: 3, action: 'world/patch', args: { edits: [{ op: 'set', path: '/entities/keeper/position', value: [1.5, .5, 1] }] } },
      { tick: 4, action: 'world/event', args: { kind: 'choice', actor: 'keeper' } }
    ]
  });
  run.advance(8);
  return run.recording();
}

test('camera suggestions use committed poses, pair evidence and turning points', async () => {
  const tape = recording(), draft = await api.suggest(tape);
  const [arrival, argument, choice] = draft.beats;
  assert.deepEqual(arrival.shots, []);
  assert.equal(arrival.missing[0].ref, 'unmapped-skiff');
  assert.equal(argument.selected, 'pair');
  assert.equal(argument.relationship.distance, 2);
  assert.deepEqual(argument.subjects.map(row => row.point), [[-1, .5, 0], [1, .5, 0]]);
  assert(argument.shots.find(shot => shot.id === 'insert'));
  assert.equal(choice.turningPoint, true);
  assert.deepEqual(choice.subjects[0].point, [1.5, .5, 1]);
  const limited = await api.suggest(tape, { limit: 1 });
  assert.equal(limited.beats[0].beatId, choice.beatId);
  assert.equal(limited.omitted, 2);
});

test('edited marker placements preserve poses and editable cut choices', async () => {
  const tape = recording(), imported = await W.storySceneTimeline.replay(tape);
  const marker = imported.markers.find(row => row.category === 'argument');
  const plan = await api.suggest(tape, { definition: {
    duration: 3, sequences: { argument: { duration: .6, markers: [{ ...marker, time: .3 }] } },
    clips: [
      { id: 'review', sequence: 'argument', time: 1 },
      { id: 'recap', sequence: 'argument', time: 2, duration: .3 }
    ]
  } });
  assert.deepEqual(plan.beats.map(row => [row.time, row.source.tick, row.path[0]]), [[1.3, 2, 'review'], [2.15, 2, 'recap']]);
  assert(plan.beats.every(row => row.beatId === marker.beatId));
  const edited = structuredClone(plan);
  edited.beats[0].selected = 'insert';
  edited.beats[0].time = 1.5;
  assert.deepEqual(api.read(edited).rig.sequence, [
    { time: 0, shot: 'opening' }, { time: 1.5, shot: 'beat-1-insert' }, { time: 2.15, shot: 'beat-2-pair' }
  ]);
  edited.beats[1].time = 1.5;
  assert.throws(() => api.read(edited), /share a cut time/);
});

test('CLI review renders matching fixed-size frames and preserves edited cut time separately', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-shots-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  save('harbor.run.json', recording());
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const command = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
  const drafted = command('story', 'shots', 'harbor.run.json', '--from-tick', '2', '--to-tick', '2', '--out', 'plan.json');
  assert.equal(drafted.status, 0, drafted.stderr);
  const plan = read('plan.json'), [beat] = plan.beats;
  plan.duration = .8;
  beat.selected = 'insert';
  beat.time = .5;
  save('plan.json', plan);
  const reviewed = command('story', 'shots-review', 'harbor.run.json', 'plan.json', '--all',
    '--w', '96', '--h', '64', '--out', 'cards');
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const report = read('cards/report.json');
  assert.deepEqual(report.cuts.map(row => [row.tick, row.time, row.beatId]), [[2, .5, beat.beatId]]);
  assert.deepEqual(report.previews.map(row => row.cell), [1, 2, 3]);
  for (const row of report.previews) {
    const image = fs.readFileSync(file('cards/' + row.file));
    assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [96, 64]);
  }
  const contact = fs.readFileSync(file('cards/contact.png'));
  assert.deepEqual([contact.readUInt32BE(16), contact.readUInt32BE(20)], [3 * 96, 64]);
  plan.recording = 'other';
  save('plan.json', plan);
  const wrong = command('story', 'shots-review', 'harbor.run.json', 'plan.json', '--out', 'stale');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /different recording/);
  assert(!fs.existsSync(file('stale')));
});
