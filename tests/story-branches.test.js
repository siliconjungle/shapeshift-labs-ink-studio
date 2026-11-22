const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const filename = path.join(directory, 'signal-vault.world.json');
const world = () => embedStoryDocuments(read(filename), filename);
const actions = route => read(path.join(directory, `signal-vault-${route}.actions.json`));
const json = value => JSON.parse(JSON.stringify(value));
const state = run => run.query().probe('world/story-lifecycle').value['signal-vault/open-vault'];
const history = (run, kind) => run.checkpoint().history.filter(event => event.kind === kind);
const command = (tick, action, args) => ({ tick, action: 'world/story-' + action,
  args: { document: 'signal-vault', story: 'open-vault', reason: 'test', ...args } });
const choose = (tick, stage, visit, branch) => command(tick, 'choose', { stage, visit, branch });
const objective = (tick, stage, visit, objective, result = 'completed') => command(tick, 'objective', { stage, visit, objective, result });

test('two branches fork from the same parallel objectives, converge and resolve authored endings', () => {
  const run = R.create(world());
  run.advance(3);
  const checkpoint = json(run.checkpoint());
  assert.deepEqual(Object.keys(state(run).flow.current.objectives), ['map', 'power']);
  const lower = run.fork(), upper = R.create(checkpoint.world, { checkpoint });
  lower.schedule(actions('lower'));
  upper.schedule(actions('upper'));
  lower.advance(7);
  upper.advance(10);
  assert.equal(state(lower).status, 'completed');
  assert.equal(state(lower).outcome, 'beacon-lit');
  assert.equal(state(upper).status, 'failed');
  assert.equal(state(upper).outcome, 'vault-sealed');
  const low = state(lower).flow, high = state(upper).flow;
  assert.equal(low.current, null);
  assert.equal(high.current, null);
  assert.deepEqual(low.route.map(row => row.stage), ['survey', 'tunnel', 'alignment']);
  assert.deepEqual(high.route.map(row => row.stage), ['survey', 'gantry', 'service-bay', 'alignment']);
  assert.deepEqual(low.route[0].skipped, ['service-key']);
  assert.deepEqual(high.route[0].skipped, []);
  assert.equal(high.route[2].objectives['test-receiver'].result, 'skipped');
  assert.deepEqual(history(upper, 'story-stage-entered').map(row => [row.stage, row.visit]),
    [['survey', 1], ['gantry', 2], ['service-bay', 3], ['alignment', 4]]);
  for (const branch of [lower, upper]) {
    assert.deepEqual(R.replay(json(branch.recording())).checkpoint(), branch.checkpoint());
    const saved = json(branch.checkpoint());
    assert.deepEqual(R.create(saved.world, { checkpoint:saved }).checkpoint(), saved);
  }
  const bad = json(lower.checkpoint());
  delete bad.storyLifecycleState['signal-vault/open-vault'].flow.route[0].objectives.power;
  assert.throws(() => R.create(bad.world, { checkpoint:bad }), /Invalid saved story lifecycle/);
});

test('branches report unmet requirements and suspended or stale requests do not mutate objectives', () => {
  const run = R.create(world());
  run.schedule([
    objective(1, 'survey', 1, 'map', 'skipped'), choose(1, 'survey', 1, 'lower-route'),
    command(3, 'transition', { to:'suspended' }), choose(3, 'survey', 1, 'lower-route'),
    command(4, 'transition', { to:'active' }), choose(4, 'survey', 1, 'upper-route'),
    objective(4, 'survey', 1, 'map'), choose(5, 'survey', 1, 'lower-route'),
    objective(6, 'survey', 1, 'service-key')
  ]);
  run.advance(6);
  const rejected = history(run, 'story-progress-rejected');
  assert.deepEqual(rejected.map(row => row.reason), [
    'objective-required', 'objectives-pending', 'story-not-active', 'objectives-pending', 'objective-already-resolved', 'stale-stage-visit'
  ]);
  assert.deepEqual(rejected[1].pending, ['map', 'power']);
  assert.deepEqual(rejected[3].pending, ['service-key']);
  assert.equal(state(run).flow.current.stage, 'tunnel');
  assert.deepEqual(state(run).flow.current.objectives, {});
  assert.equal(state(run).flow.route[0].objectives.map.reason, 'survey-received');
  assert.equal(history(run, 'story-started').length, 1);
});

test('loops open fresh visit IDs, reject old choices and keep a bounded replayable route', () => {
  const input = world(), definition = input.storyDocuments[0].stories['open-vault'];
  delete input.eventActions;
  definition.stages = { survey: { title:'Survey again', next: { retry:{stage:'survey'}, finish:{outcome:'beacon-lit'} } } };
  input.commands = Array.from({length:70}, (_, i) => choose(i + 1, 'survey', i + 1, 'retry'));
  const run = R.create(input);
  run.schedule([choose(2, 'survey', 1, 'finish')]);
  run.advance(70);
  const { flow } = state(run);
  assert.equal(flow.current.visit, 71);
  assert.equal(flow.route.length, 64);
  assert.equal(flow.dropped, 6);
  assert.equal(flow.route[0].visit, 7);
  assert.equal(history(run, 'story-progress-rejected')[0].reason, 'stale-stage-visit');
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
  const saved = json(run.checkpoint());
  assert.deepEqual(R.create(saved.world, { checkpoint:saved }).checkpoint(), saved);
});

test('validation checks objective references, ending status and stage command shape', () => {
  const doc = world().storyDocuments[0], def = doc.stories['open-vault'];
  def.stages.survey.next['upper-route'].requires = ['missing'];
  assert.throws(() => validateStoryDocument(doc), /unknown objective/);
  def.stages.survey.next['upper-route'].requires = ['service-key'];
  def.outcomes['vault-sealed'].status = 'suspended';
  assert.throws(() => validateStoryDocument(doc), /expected completed or failed/);
  def.outcomes['vault-sealed'].status = 'failed';
  def.lifecycle.progression = false;
  assert.throws(() => validateStoryDocument(doc), /unknown field/);
  const run = R.create(world());
  for (const [request, pattern] of [
    [choose(1, 'survey', 0, 'lower-route'), /positive visit number/],
    [choose(1, 'survey', 1, 'absent'), /Unknown branch/],
    [objective(1, 'tunnel', 1, 'map'), /known objective/],
    [command(1, 'transition', {to:'completed'}), /Select an ending branch/]
  ]) assert.throws(() => run.schedule([request]), pattern);
});

test('CLI demo forks and replays a portable branch recording', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-branching-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const call = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd:dir, encoding:'utf8' }));
  call('sim', 'run', filename, '--ticks', '3', '--checkpoint', 'start.json');
  call('sim', 'fork', 'start.json', '--ticks', '10', '--actions', path.join(directory,'signal-vault-upper.actions.json'),
    '--record', 'upper.run.json');
  assert.equal(call('sim', 'replay', 'upper.run.json').tick, 10);
  const { value } = call('probe', 'upper.run.json', '--field', 'world/story-lifecycle');
  assert.equal(value['signal-vault/open-vault'].outcome, 'vault-sealed');
});
