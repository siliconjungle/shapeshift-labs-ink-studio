const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const filename = path.join(directory, 'highwater-beacon.world.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const world = () => embedStoryDocuments(read(filename), filename);
const actions = variant => read(path.join(directory, `highwater-beacon-${variant}.actions.json`));
const key = 'highwater-beacon/relief';
const state = run => run.query().probe('world/story-lifecycle').value[key];
const stage = input => input.storyDocuments[0].stories.relief.stages.response;
const json = value => JSON.parse(JSON.stringify(value));
const command = (tick, action, args) => ({ tick, action: 'world/story-' + action,
  args: { document: 'highwater-beacon', story: 'relief', reason: 'test', ...args } });
const visit = { stage: 'response', visit: 1 };
const select = (tick, option, id = 1) => command(tick, 'select', { ...visit, visit: id, objective: 'choose-route', option });

test('all ten types and a custom objective resolve through the world and the selected route gates the ending', () => {
  const source = R.create(world());
  source.advance(3);
  assert.equal(state(source).flow.current.objectives['read-rescue-code'], undefined);
  assert.equal(source.history.find(row => row.kind === 'transponder-read').data.channel, 'weather');
  const run = source.fork();
  run.schedule(actions('ridge'));
  run.advance(24);
  const row = state(run), visit = row.flow.route[0], facts = visit.objectives;
  assert.deepEqual([row.status, row.outcome, visit.branch], ['completed', 'ridge-relief', 'send-ridge']);
  assert.deepEqual(Object.values(facts).map(change => change.type).sort(),
    ['acquire', 'build', 'choose', 'decode-transponder', 'deliver', 'maintain', 'negotiate', 'observe', 'protect', 'reach', 'survive']);
  assert.ok(Object.values(facts).every(change => change.result === 'completed' && change.receipt));
  assert.equal(facts['load-cases'].receipt.value.balance, 4);
  assert.equal(facts['deliver-cases'].receipt.event.applied, 4);
  assert.equal(facts['observe-warning'].receipt.value, true);
  assert.equal(facts['build-relay'].receipt.event.kind, 'construction-built');
  assert.equal(facts['secure-access'].receipt.event.paid, 6);
  assert.ok(facts['reach-ridge'].receipt.value[0] >= 1.15);
  assert.equal(facts['read-rescue-code'].receipt.event.data.channel, 'rescue');
  assert.deepEqual(facts['maintain-power'].receipt.interval, { since: 5, ticks: 3 });
  assert.deepEqual(facts['protect-seal'].receipt.interval, { since: 2, ticks: 5 });
  assert.deepEqual(facts['survive-hold'].receipt.interval, { since: 2, ticks: 6 });
  assert.deepEqual(facts['choose-route'].receipt, { kind: 'choice', option: 'ridge', tick: 20 });
  assert.deepEqual(run.history.find(row => row.kind === 'story-progress-rejected').pending, ['choose-route']);
  const choice = run.history.find(row => row.kind === 'story-objective-resolved' && row.type === 'choose');
  assert.deepEqual(choice.receipt, facts['choose-route'].receipt);
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());

  for (const mutate of [
    values => { values['choose-route'].receipt.option = 'river'; },
    values => { values['maintain-power'].receipt.interval.since--; },
    values => { values['read-rescue-code'].receipt.event.data.verified = false; },
    values => { values['reach-ridge'].receipt.value[1] = 2; }
  ]) {
    const saved = json(run.checkpoint());
    mutate(saved.storyLifecycleState[key].flow.route[0].objectives);
    assert.throws(() => R.create(saved.world, { checkpoint: saved }), /Invalid saved story lifecycle/);
  }
});

test('a known protect or survive violation is final and a failed-objective branch can use the receipt', () => {
  const input = world();
  input.commands.push({ tick: 7, action: 'world/transfer',
    args: { from: 'stores/air', to: 'stores/used-air', amount: 1 } });
  stage(input).next['report-breach'].requiresFailed.push('survive-hold');
  const run = R.create(input);
  run.schedule(actions('breach'));
  run.advance(24);
  const row = state(run), facts = row.flow.route[0].objectives;
  assert.deepEqual([row.status, row.outcome], ['failed', 'seal-breach']);
  assert.deepEqual(facts['protect-seal'], { type: 'protect', result: 'failed', reason: 'condition-violated', tick: 4,
    receipt: { kind: 'state', tick: 4, field: 'world/signal', args: { port: 'sensors/seal' }, value: false } });
  assert.equal(run.query().probe('world/signal', undefined, { port: 'sensors/seal' }).value, true);
  assert.deepEqual([facts['survive-hold'].result, facts['survive-hold'].tick, facts['survive-hold'].receipt.value],
    ['failed', 7, 0]);
  assert.deepEqual(run.history.find(row => row.kind === 'story-progress-rejected').pending, ['protect-seal', 'survive-hold']);
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
  const saved = json(run.checkpoint());
  saved.storyLifecycleState[key].flow.route[0].objectives['protect-seal'].receipt.value = true;
  assert.throws(() => R.create(saved.world, { checkpoint: saved }), /Invalid saved story lifecycle/);
});

test('a missing sample and a suspension clear timed progress, and a fresh interval restores from a checkpoint', () => {
  const input = world();
  const watch = { position: [1, 0, 0] };
  input.entities.watch = watch;
  const goal = stage(input).objectives['maintain-power'];
  goal.params = { for: 0.2, state: { field: 'world/position', at: { entity: 'watch' }, select: [0], when: { value: 1 } } };
  const run = R.create(input);
  const edit = (tick, args) => ({ tick, action: 'world/patch', args: { edits: [{ path: '/entities/watch', ...args }] } });
  run.schedule([
    edit(3, { op:'remove' }),
    edit(4, { op:'set', value:watch }),
    command(5, 'transition', { to:'suspended' }),
    command(7, 'transition', { to:'active' })
  ]);
  const progress = () => state(run).flow.current.progress?.['maintain-power'];
  run.advance(2);
  assert.deepEqual(progress(), { since: 2, tick: 2 });
  run.advance(3);
  assert.equal(progress(), undefined);
  run.advance(4);
  assert.deepEqual(progress(), { since: 4, tick: 4 });
  run.advance(7);
  assert.equal(progress(), undefined);
  run.advance(9);
  assert.deepEqual(progress(), { since: 8, tick: 9 });
  const saved = json(run.checkpoint()), restored = R.create(saved.world, { checkpoint:saved });
  run.advance(10);
  restored.advance(10);
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
  assert.deepEqual(state(run).flow.current.objectives['maintain-power'].receipt.interval, { since: 8, ticks: 2 });
  saved.storyLifecycleState[key].flow.current.progress['maintain-power'].since = 1;
  assert.throws(() => R.create(saved.world, { checkpoint:saved }), /Invalid saved story lifecycle/);
});

test('choices reject unknown options, manual completion, revisions and stale visits', () => {
  const input = world();
  stage(input).next['try-again'] = { stage:'response', requiresChoice: { 'choose-route':'ridge' } };
  const run = R.create(input);
  assert.throws(() => run.schedule([select(1, 'bridge')]), /known option/);
  for (const [objective, message] of [['choose-route', /story-select/], ['build-relay', /world evidence/]]) {
    assert.throws(() => run.schedule([command(1, 'objective', { ...visit, objective, result:'completed' })]), message);
  }
  run.schedule([
    select(20, 'ridge'),
    select(20, 'river'),
    command(21, 'choose', { ...visit, branch:'try-again' }),
    select(22, 'river'),
    select(22, 'river', 2)
  ]);
  run.advance(22);
  assert.deepEqual(run.history.filter(row => row.kind === 'story-progress-rejected').map(row => [row.reason, row.option]),
    [['objective-already-resolved','river'], ['stale-stage-visit','river']]);
  assert.equal(state(run).flow.current.objectives['choose-route'].receipt.option, 'river');
  assert.equal(state(run).flow.route[0].objectives['choose-route'].receipt.option, 'ridge');
});

test('custom query match parameters bind the selected value and document validation checks schemas', () => {
  const input = world(), doc = input.storyDocuments[0], goals = stage(input).objectives;
  const spec = { evidence: { state: {
    field: 'world/transfers', select: '/receipts/0', when: { path: '/to', value: 'stores/shelter' }
  } }, match: { count: '/applied' } };
  doc.objectiveTypes['count-cases'] = spec;
  goals['count-cases'] = { title: 'Read the transfer', type: 'count-cases', params: { count: 4 } };
  const run = R.create(input);
  run.advance(3);
  assert.equal(state(run).flow.current.objectives['count-cases'], undefined);
  run.advance(4);
  assert.equal(state(run).flow.current.objectives['count-cases'].receipt.value.applied, 4);

  const rejects = (change, expected) => {
    const candidate = json(input);
    change(candidate, stage(candidate));
    assert.throws(() => validateStoryDocument(candidate.storyDocuments[0]), expected);
  };
  rejects((_, s) => { s.objectives['count-cases'].params = {}; }, /count: required field/);
  rejects((d) => { d.storyDocuments[0].objectiveTypes.build = spec; }, /built-in objective type/);
  rejects((_, s) => { s.objectives['reach-ridge'].params.max[0] = -2; }, /ordered finite XYZ/);
  rejects((_, s) => { s.objectives['protect-seal'].params.for = 0; }, /positive finite/);
  rejects((_, s) => { s.objectives['load-cases'].type = 'unknown'; }, /unknown objective type/);
  rejects((_, s) => { s.next['send-ridge'].requiresChoice['choose-route'] = 'tunnel'; }, /unknown choice option/);
  rejects((_, s) => { s.next['report-breach'].requiresFailed = ['build-relay']; }, /expected a failing objective/);
});
