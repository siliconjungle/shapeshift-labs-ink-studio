const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const file = path.join(directory, 'lantern-pass.world.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const world = () => embedStoryDocuments(read(file), file);
const actions = variant => read(path.join(directory, `lantern-pass-${variant}.actions.json`));
const key = id => 'lantern-pass/' + id;
const story = (run, id = 'corridor') => run.query().probe('world/story-lifecycle').value[key(id)];
const report = (tick, questlet, finding) => ({tick, action: 'world/event', args: {kind:'survey-reported', questlet, finding}});
const choose = (tick, branch, visit = 1) => ({ tick, action:'world/story-choose',
  args: {document:'lantern-pass', story:'corridor', stage:'survey', visit, branch, reason:'test-choice'} });
const json = value => JSON.parse(JSON.stringify(value));

test('the arc opens child questlets and follows any and all waits in distinct replayable forks', () => {
  const run = R.create(world());
  run.advance(2);
  assert.deepEqual(story(run).flow.current.children.pending, ['ford-report','ridge-report']);
  assert.equal(story(run, 'supply-run'), null);
  for (const id of ['ford-report','ridge-report']) {
    assert.equal(story(run, id).status, 'active');
    assert.deepEqual(story(run, id).parent, {document:'lantern-pass', story:'corridor', stage:'survey', visit:1, tick:1});
  }
  const start = json(run.checkpoint());
  const ford = run.fork(), ridge = R.create(start.world, {checkpoint:start});
  ford.schedule(actions('ford'));
  ridge.schedule(actions('ridge'));
  ford.advance(4);
  assert.equal(story(ford).flow.current.stage, 'prepare-ford');
  assert.deepEqual(story(ford).flow.route[0].children, {
    'ford-report':{status:'completed', tick:4, reason:'reading-confirmed', outcome:'clear'}
  });
  assert.equal(story(ford, 'ridge-report').status, 'active');
  assert.equal(story(ford, 'beacon-watch').status, 'available');
  assert.equal(story(ford, 'beacon-watch').deadlines.offer.dueTick, 8);
  ford.advance(11);
  assert.deepEqual(story(ford).flow.current.children.pending, ['ridge-report']);
  ridge.advance(4);
  assert.equal(story(ridge).flow.current.stage, 'survey');
  assert.equal(story(ridge).flow.current.children.ready, true);
  assert.equal(story(ridge, 'ford-report').status, 'failed');
  assert.equal(story(ridge, 'supply-run'), null);
  for (const [branch, ending, stage, tick] of [[ford,'ford-corridor','prepare-ford',12], [ridge,'ridge-corridor','prepare-ridge',11]]) {
    branch.advance(14);
    const arc = story(branch), route = arc.flow.route[1];
    assert.deepEqual([arc.status, arc.outcome, route.stage, route.leftAt], ['completed',ending,stage,tick]);
    assert.equal(story(branch, 'supply-run').parent.stage, stage);
    assert.equal(story(branch, 'supply-run').flow.route[0].objectives['move-cases'].receipt.event.applied, 4);
    assert.equal(route.children['supply-run'].outcome, 'landed');
    assert.equal(route.children['beacon-watch'].outcome, 'lit');
    assert.equal(Object.keys(route.children).length, 4);
    assert.deepEqual(branch.history.find(event => event.kind === 'story-branch-chosen' && event.story === 'corridor' &&
      event.stage === stage).children, route.children);
    assert.deepEqual(R.replay(json(branch.recording())).checkpoint(), branch.checkpoint());
  }
  assert(ford.history.some(event => event.reason === 'children-pending' && event.stage === 'prepare-ford'));
  assert(ridge.history.some(event => event.reason === 'child-outcome-mismatch' && event.mismatchedChildren[0] === 'ford-report'));
});

test('child expiry blocks a simultaneous opening and its terminal status can route the arc', () => {
  const input = world(), {stories} = input.storyDocuments[0];
  stories['ridge-report'].lifecycle.deadlines = { world: {at:0.1} };
  stories.corridor.stages.survey.next['fall-back'] = {outcome:'stranded', auto:true,
    requiresChildren:{'ridge-report':{status:'expired'}}};
  const run = R.create(input);
  run.advance(1);
  assert.equal(story(run, 'ridge-report').status, 'expired');
  assert.equal(story(run, 'ridge-report').parent, undefined);
  assert.equal(story(run).flow.current.stage, 'survey');
  run.advance(2);
  assert.equal(story(run).status, 'failed');
  assert.equal(story(run).flow.route[0].children['ridge-report'].status, 'expired');
  assert.equal(story(run, 'ford-report').status, 'active');
  const saved = json(run.checkpoint());
  assert.deepEqual(R.create(saved.world, {checkpoint:saved}).checkpoint(), run.checkpoint());
});

test('when both routes qualify on one tick the arc picks the first branch ID, and siblings can finish after an any exit', () => {
  const input = world(), { survey } = input.storyDocuments[0].stories.corridor.stages;
  input.commands = [];
  survey.next['use-ford'] = { ...survey.next['use-ford'], outcome:'ford-corridor' };
  delete survey.next['use-ford'].stage;
  const run = R.create(input);
  run.schedule([report(3,'ridge-report','clear'), report(3,'ford-report','clear')]);
  run.advance(4);
  assert.equal(story(run).outcome, 'ford-corridor');
  assert.equal(story(run).flow.route[0].branch, 'use-ford');
  assert.equal(story(run).flow.route[0].children['ridge-report'].tick, 4);

  input.history = {enabled:false};
  const delayed = R.create(input);
  delayed.schedule([report(3,'ford-report','clear'), report(6,'ridge-report','clear')]);
  delayed.advance(8);
  assert.equal(story(delayed).outcome, 'ford-corridor');
  assert.equal(story(delayed, 'ridge-report').outcome, 'clear');
  assert.equal(story(delayed).flow.route[0].children['ridge-report'], undefined);
  assert.deepEqual(delayed.history, []);
  assert.deepEqual(R.replay(json(delayed.recording())).checkpoint(), delayed.checkpoint());
});

test('repeat visits reuse child instances and validate retained receipts and opening links', () => {
  const input = world(), { survey } = input.storyDocuments[0].stories.corridor.stages;
  input.commands = [];
  survey.next = { retry:{ stage:'survey' } };
  const run = R.create(input);
  run.schedule([report(3,'ford-report','clear'), ...Array.from({length:70}, (_, i) => choose(i + 5,'retry',i + 1))]);
  run.advance(75);
  assert.equal(story(run).flow.current.visit, 71);
  assert.equal(story(run).flow.dropped, 6);
  assert.equal(story(run, 'ford-report').parent.visit, 1);
  assert.equal(run.history.filter(event => event.story === 'ford-report' && event.to === 'available').length, 1);
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
  for (const breakLink of [
    state => { state[key('ford-report')].parent.visit = 71; },
    state => { state[key('ridge-report')] = null; },
    state => { state[key('corridor')].flow.route[0].children['ford-report'].outcome = 'blocked'; },
    state => { state[key('corridor')].flow.route[0].children['ford-report'] = null; }
  ]) {
    const checkpoint = json(run.checkpoint());
    breakLink(checkpoint.storyLifecycleState);
    assert.throws(() => R.create(checkpoint.world, {checkpoint}), /Invalid saved story lifecycle/);
  }
});

test('nested story documents check child ownership, wait groups, and terminal outcome references', () => {
  const doc = world().storyDocuments[0];
  const rejects = (patch, message) => {
    const copy = json(doc), arc = copy.stories.corridor;
    patch(copy.stories, arc.stages.survey);
    assert.throws(() => validateStoryDocument(copy), message);
  };
  rejects((_, stage) => { stage.children.open = ['corridor']; }, /needs a questlet lifecycle/);
  rejects(stories => { stories.duplicate = json(stories.corridor); }, /already has an owning arc/);
  rejects((_,stage) => { stage.children.wait.all = ['ford-report']; }, /exactly one of any or all/);
  rejects((_,stage) => { stage.children.wait.any = ['unopened']; }, /unknown child questlet/);
  rejects((_,stage) => { stage.next['use-ford'].requiresChildren['ford-report'].outcome = 'unknown'; }, /unknown child outcome/);
  rejects((_,stage) => { stage.next['use-ford'].requiresChildren['ford-report'] = {status:'active'}; }, /terminal story status/);
  rejects(stories => { stories['ford-report'].triggers = {notice:{event:{kind:'notice'}}}; }, /takes its start from the arc/);
  rejects((_,stage) => {
    delete stage.children.wait;
    delete stage.next['use-ford'].requiresChildren;
  }, /child wait or outcome condition/);
});
