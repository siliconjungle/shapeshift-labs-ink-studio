const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const filename = path.resolve(__dirname, '../examples/story-documents/winter-crossing.world.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const example = () => embedStoryDocuments(read(filename), filename);
const json = value => JSON.parse(JSON.stringify(value));
const command = (tick, story, to, reason, outcome) => ({ tick, action: 'world/story-transition', args: {
  document: 'winter-crossing', story, to, reason, ...(outcome !== undefined && { outcome })
} });
const status = run => run.query().probe('world/story-lifecycle').value;
const story = (run, name) => status(run)['winter-crossing/' + name];
const events = (run, kind) => run.checkpoint().history.filter(event => event.kind === kind);

test('Winter Crossing exercises the lifecycle and keeps the reasons, trigger evidence and outcomes', () => {
  const run = R.create(example());
  assert.equal(story(run, 'repair'), null);
  run.advance(2);
  assert.equal(story(run, 'repair').status, 'available');
  assert.equal(events(run, 'story-started').some(row => row.story === 'repair'), false);
  run.advance(4);
  assert.equal(story(run, 'repair').status, 'suspended');
  assert.equal(story(run, 'repair').reason, 'ice-on-deck');
  assert.equal(story(run, 'escort').status, 'withdrawn');
  const checkpoint = json(run.checkpoint());
  const restored = R.create(checkpoint.world, { checkpoint }), branch = run.fork();
  run.advance(10);
  assert.deepEqual(story(run, 'repair').transitions.map(row => [row.tick, row.from, row.to, row.reason]), [
    [2, null, 'available', 'trigger-matched'], [3, 'available', 'active', 'crew-accepted'],
    [4, 'active', 'suspended', 'ice-on-deck'], [6, 'suspended', 'active', 'deck-cleared'],
    [8, 'active', 'completed', 'inspection-passed']
  ]);
  assert.equal(story(run, 'repair').outcome, 'done');
  assert.equal(story(run, 'scout').status, 'failed');
  assert.equal(story(run, 'scout').outcome, 'blocked');
  assert.equal(story(run, 'guest').status, 'expired');
  assert.equal(story(run, 'guest').since, 5);
  assert.equal(story(run, 'guest').reason, 'offer-timeout');
  assert.deepEqual(events(run, 'story-started').map(row => [row.story, row.tick]), [['escort', 1], ['scout', 1], ['repair', 3]]);
  assert.deepEqual(events(run, 'story-started').find(row => row.story === 'repair').evidence, { kind: 'event', events: ['2.0'] });
  assert.equal(events(run, 'story-transition').length, 13);
  assert(events(run, 'story-transition').every(row => row.reason.length > 0));
  for (const next of [restored, branch]) {
    next.advance(10);
    assert.deepEqual(next.checkpoint(), run.checkpoint());
  }
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
  checkpoint.storyLifecycleState['winter-crossing/repair'].transitions[1].from = 'completed';
  assert.throws(() => R.create(checkpoint.world, { checkpoint }), /Invalid saved story lifecycle/);
});

test('late, premature and terminal transitions are rejected at their tick without mutating the story', () => {
  const run = R.create(example());
  run.schedule([
    command(1, 'repair', 'active', 'too-early'),
    command(5, 'guest', 'active', 'at-deadline'),
    command(9, 'repair', 'failed', 'duplicate-result')
  ]);
  run.advance(10);
  assert.deepEqual(events(run, 'story-transition-rejected').map(row => [row.tick, row.from, row.to, row.requestedReason]), [
    [1, null, 'active', 'too-early'], [5, 'expired', 'active', 'at-deadline'], [9, 'completed', 'failed', 'duplicate-result']
  ]);
  assert.equal(story(run, 'repair').outcome, 'done');
  assert.equal(story(run, 'guest').reason, 'offer-timeout');
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
});

test('transition validation rejects invalid authored settings, unknown IDs, missing reasons and inappropriate outcomes', () => {
  const doc = example().storyDocuments[0];
  delete doc.stories.guest.lifecycle.activation;
  assert.throws(() => validateStoryDocument(doc), /offer duration in seconds for manual/);
  const run = R.create(example());
  for (const [args, pattern] of [
    [command(1, 'missing', 'active', 'accept'), /Unknown story with lifecycle/],
    [command(1, 'repair', 'available', 'offer'), /needs a destination/],
    [command(1, 'repair', 'active', ' '), /needs a destination, reason/],
    [command(1, 'repair', 'active', 'accept', 'done'), /valid outcome/],
    [command(1, 'repair', 'completed', 'result', 'missing'), /valid outcome/]
  ]) assert.throws(() => run.schedule([args]), pattern);
  assert.equal(run.commandCounts().pending, 9);
});

test('lifecycle reasons remain inspectable without retained event history and are bounded through repeated suspension', () => {
  const world = example();
  world.history = { enabled: false };
  world.commands = Array.from({ length: 70 }, (_, i) => command(i + 2, 'escort', i % 2 ? 'active' : 'suspended', 'change-' + i));
  delete world.eventActions;
  const run = R.create(world);
  run.advance(72);
  const escort = story(run, 'escort');
  assert.equal(escort.status, 'active');
  assert.equal(escort.reason, 'change-69');
  assert.equal(escort.transitions.length, 64);
  assert.equal(escort.dropped, 8);
  assert.deepEqual(run.checkpoint().history, []);
  const checkpoint = json(run.checkpoint());
  assert.deepEqual(story(R.create(checkpoint.world, { checkpoint }), 'escort'), escort);
});

test('the CLI records, replays and probes the lifecycle demo', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-lifecycle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'crossing.run.json'), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const call = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' }));
  call('sim', 'run', filename, '--ticks', '10', '--record', file);
  assert.equal(call('sim', 'replay', file).tick, 10);
  const statuses = call('probe', file, '--field', 'world/story-lifecycle');
  assert.equal(statuses.value['winter-crossing/guest'].status, 'expired');
  assert.equal(statuses.value['winter-crossing/repair'].reason, 'inspection-passed');
});
