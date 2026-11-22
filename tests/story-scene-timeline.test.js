const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();

const W = K.world, api = W.storySceneTimeline;
const clock = { numerator: 30000, denominator: 1001 }, dt = 1001 / 30000;
const timed = (tick, kind, payload = {}) => ({ tick, action: 'world/event', args: { kind, ...payload } });

function recording() {
  const run = W.runtime.create({
    id: 'scene-markers', dt, takeClock: { fps: clock, simulationRate: clock },
    history: { enabled: false }, custody: { objects: { 'archive/chart': {} } },
    facts: { types: { argument: { fields: { topic: 'string' } } } },
    commands: [
      timed(1, 'arrival', { entity: 'survey-skiff', timing: { format: 'ink-studio/event-time', time: .025 } }),
      { tick: 2, action: 'world/discover-object', args: {
        object: 'archive/chart', to: { kind: 'actor', id: 'surveyor' }, at: { place: 'quay' }
      } },
      { tick: 3, action: 'world/fact', args: { type: 'argument', at: { place: 'quay' }, data: { topic: 'Safe channel' } } },
      timed(4, 'story-branch-chosen', { branch: 'detour' }),
      timed(5, 'story-transition', { to: 'active' }),
      timed(6, 'story-transition', { to: 'completed', outcome: 'safe' })
    ]
  });
  run.advance(8);
  return run.recording();
}

test('verified replay recovers scene markers that native history did not retain', async () => {
  const tape = recording();
  assert.deepEqual(tape.end.history, []);
  assert.deepEqual(api.project(tape).markers, []);
  const timeline = await api.replay(tape);
  assert.deepEqual(timeline.markers.map(row => [row.category, row.source.tick, row.source.kind]), [
    ['arrival', 1, 'arrival'], ['discovery', 2, 'custody-changed'], ['argument', 3, 'world-fact'],
    ['choice', 4, 'story-branch-chosen'], ['outcome', 6, 'story-transition']
  ]);
  assert.equal(timeline.markers[0].time, .025);
  assert.deepEqual(timeline.markers[1].source.timecode, { numerator: 1001, denominator: 15000 });
  assert.match(timeline.markers[1].label, /archive\/chart/);
  assert.match(timeline.markers[2].label, /Safe channel/);
  const changed = structuredClone(tape);
  changed.end.world = { ...changed.end.world, seed: changed.end.world.seed + 1 };
  await assert.rejects(api.replay(changed), /diverg|checkpoint|seed/i);
});

test('rules, inclusive ranges and story filters keep stable marker identity for imported branches', () => {
  const log = {
    format: W.storyEvents.envelopeFormat, version: 1, world: 'lane', dt: .1, from: 1, to: 4, coverage: 'complete',
    dropped: 0, events: ['east', 'west'].map(branch => ({
      version: 1, world: 'lane', branch, id: '2.0', tick: 2, kind: 'council-motion', system: 'council',
      story: 'relay/route', stage: 'forum', visit: 1, subjects: [], causes: [], payload: { disagreement: branch === 'east' }
    }))
  };
  const plan = { format: api.planFormat, version: 1, rules: [
    { on: { kind: 'council-motion', where: { path: '/payload/disagreement', value: true } },
      category: 'argument', label: 'East council objects' },
    { on: { kind: 'council-motion' }, category: 'motion' }
  ] };
  const baseline = api.project(log, { plan });
  assert.deepEqual(baseline.markers.map(row => [row.category, row.label, row.source.branch]), [
    ['argument', 'East council objects', 'east'], ['motion', 'Motion', 'west']
  ]);
  assert.notEqual(baseline.markers[0].id, baseline.markers[1].id);
  assert.equal(baseline.markers[0].source.story, 'relay/route');
  assert.deepEqual(api.project(log, { plan, fromTick: 2, toTick: 2, story: 'relay/route' }).markers, baseline.markers);
  assert.deepEqual(api.project(log, { plan, fromTick: 3 }).markers, []);
  assert.deepEqual(api.project(log, { plan, story: 'relay/other' }).markers, []);
  assert.throws(() => api.project(log, { plan, fromTick: 4, toTick: 3 }), /ordered tick range/);
});

test('scene markers retain source time and links when renamed or placed in two edited clips', async () => {
  const definition = await api.replay(recording());
  const marker = definition.markers[1], seconds = 1001 / 15000;
  assert.equal(K.timeline.compile(definition).markers[1].time, seconds);
  assert.deepEqual(K.timeline.compile(definition, { exact: true }).markers[1].timecode, marker.source.timecode);
  const changed = { ...marker, time: .15, label: 'First look at the chart' };
  const sequence = { duration: .4, markers: [changed] };
  const timeline = K.timeline.compile({
    sequences: { survey: sequence }, clips: [
      { id: 'first', sequence: 'survey', time: 1, duration: .8 },
      { id: 'repeat', sequence: 'survey', time: 2, duration: .4 }
    ]
  }, { exact: true });
  assert.deepEqual(timeline.events, []);
  assert.deepEqual(timeline.markers.map(row => [row.label, row.time, row.beatId, row.source.timecode, row.path]), [
    [changed.label, 1.3, marker.beatId, marker.source.timecode, ['first']],
    [changed.label, 2.15, marker.beatId, marker.source.timecode, ['repeat']]
  ]);
  assert.throws(() => K.timeline.compile({ markers: [{ ...marker, source: { ...marker.source, branch: 'other' } }] }),
    /marker.*source/);
});

test('the CLI exports, inspects and resolves an exact marker from a verified recording', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-markers-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const tape = path.join(folder, 'world.run.json'), exported = path.join(folder, 'markers.json');
  fs.writeFileSync(tape, JSON.stringify(recording()));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const command = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
  const built = command('story', 'timeline', tape, '--from-tick', '2', '--to-tick', '2', '--out', exported);
  assert.equal(built.status, 0, built.stderr);
  const output = JSON.parse(fs.readFileSync(exported));
  assert.deepEqual(Object.keys(output), ['duration', 'markers']);
  const [marker] = output.markers;
  assert.equal(marker.category, 'discovery');
  const timeline = command('timeline', exported);
  assert.equal(timeline.status, 0, timeline.stderr);
  assert.equal(JSON.parse(timeline.stdout).cues[0].beatId, marker.beatId);
  const found = command('beat', marker.beatId, 'markers.json');
  assert.equal(found.status, 0, found.stderr);
  assert.deepEqual(JSON.parse(found.stdout).matches[0],
    { report: 'markers.json', pointer: '/markers/0', time: 1001 / 15000, tick: 2 });
  fs.linkSync(tape, path.join(folder, 'alias.json'));
  const protectedInput = command('story', 'timeline', tape, '--out', 'alias.json');
  assert.equal(protectedInput.status, 1);
  assert.match(protectedInput.stderr, /separate from source files/);
});
