const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const file = path.join(directory, 'harbor-watch.world.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const world = () => embedStoryDocuments(read(file), file);
const actions = variant => read(path.join(directory, `harbor-watch-${variant}.actions.json`));
const key = story => 'harbor-watch/' + story;
const state = (run, story) => run.query().probe('world/story-lifecycle').value[key(story)];
const transition = (tick, story, to, reason = 'test') =>
  ({tick, action: 'world/story-transition', args: { document: 'harbor-watch', story, to, reason } });
const event = (tick, kind) => ({ tick, action: 'world/event', args: { kind } });
const json = value => JSON.parse(JSON.stringify(value));

test('world cutoff continues through suspension and an offer window starts on the actual offer tick', () => {
  const run = R.create(world());
  run.advance(2);
  assert.equal(state(run, 'tow-offer'), null);
  run.advance(3);
  assert.deepEqual(state(run, 'tow-offer').deadlines.offer,
    { budgetTicks: 3, offeredAt: 3, closedAt: null, dueTick: 6, remainingTicks: 3, status: 'running' });
  const earlier = run.fork();
  earlier.schedule([transition(5, 'tow-offer', 'active')]);
  run.advance(5);
  assert.equal(state(run, 'tide-survey').status, 'suspended');
  assert.deepEqual(state(run, 'tide-survey').deadlines.world, { dueTick: 7, remainingTicks: 2, status: 'running' });
  run.advance(8);
  const offer = state(run, 'tow-offer'), tide = state(run, 'tide-survey');
  assert.deepEqual([offer.status, offer.since, offer.reason, offer.deadline],
    ['expired', 6, 'offer-timeout', { clock: 'offer', offeredAt: 3, dueTick: 6 }]);
  assert.deepEqual([tide.status, tide.since, tide.reason, tide.deadline],
    ['expired', 7, 'world-deadline', { clock: 'world', dueTick: 7 }]);
  assert.deepEqual(run.history.filter(row => row.kind === 'story-transition-rejected').map(row => [row.story, row.tick, row.from]),
    [['tow-offer', 6, 'expired'], ['tide-survey', 7, 'expired']]);
  earlier.advance(10);
  assert.equal(state(earlier, 'tow-offer').status, 'active');
  assert.deepEqual(state(earlier, 'tow-offer').deadlines.offer,
    { budgetTicks: 3, offeredAt: 3, closedAt: 5, dueTick: 6, remainingTicks: 1, status: 'closed' });
  assert.deepEqual(R.replay(json(earlier.recording())).checkpoint(), earlier.checkpoint());
});

test('work time pauses, survives a checkpoint, and wins over a proof on the expiry tick', () => {
  const run = R.create(world());
  const work = branch => state(branch, 'pump-repair').deadlines.work;
  run.advance(1);
  assert.deepEqual(work(run), { budgetTicks: 4, spentTicks: 0, remainingTicks: 4, status: 'waiting' });
  run.advance(2);
  assert.deepEqual(work(run), { budgetTicks: 4, spentTicks: 0, remainingTicks: 4, status: 'running' });
  run.advance(4);
  const paused = { budgetTicks: 4, spentTicks: 2, remainingTicks: 2, status: 'paused' };
  assert.deepEqual(work(run), paused);
  run.advance(8);
  assert.deepEqual(work(run), paused);
  const source = json(run.checkpoint());
  const early = run.fork(), late = R.create(source.world, { checkpoint: source });
  early.schedule(actions('on-time'));
  late.schedule(actions('at-cutoff'));
  late.advance(9);
  assert.deepEqual(work(late), { ...paused, status: 'running' });
  early.advance(25);
  late.advance(25);
  assert.deepEqual([state(early, 'pump-repair').status, state(early, 'pump-repair').since],
    ['completed', 10]);
  assert.deepEqual(work(early), { budgetTicks: 4, spentTicks: 3, remainingTicks: 1, status: 'closed' });
  const last = state(late, 'pump-repair');
  assert.deepEqual([last.status, last.since, last.reason, last.deadline],
    ['expired', 11, 'work-timeout', { clock: 'work', budgetTicks: 4, spentTicks: 4 }]);
  assert.deepEqual(work(late), { budgetTicks: 4, spentTicks: 4, remainingTicks: 0, status: 'expired' });
  assert(late.history.some(row => row.kind === 'transfer' && row.tick === 11 && row.applied === 1));
  assert.deepEqual(last.flow.current.objectives, {});
  assert(late.history.some(row => row.kind === 'story-progress-rejected' && row.reason === 'story-not-active' && row.tick === 11));
  assert(late.history.some(row => row.kind === 'relief-crew-called' && row.tick === 12));
  for (const branch of [early, late]) {
    const saved = json(branch.checkpoint());
    assert.deepEqual(R.create(saved.world, { checkpoint: saved }).checkpoint(), branch.checkpoint());
    assert.deepEqual(R.replay(json(branch.recording())).checkpoint(), branch.checkpoint());
  }
  const corrupt = json(late.checkpoint());
  corrupt.storyLifecycleState[key('pump-repair')].deadlines.work.spentTicks--;
  assert.throws(() => R.create(corrupt.world, { checkpoint: corrupt }), /Invalid saved story lifecycle/);
});

test('a world cutoff preempts a same-tick trigger and takes priority over coincident clocks', () => {
  const input = world(), { stories } = input.storyDocuments[0];
  stories['tide-survey'].triggers = { notice: { event: { kind: 'survey-request' } } };
  stories['tow-offer'].lifecycle.deadlines.world = { at: 0.6 };
  stories['pump-repair'].lifecycle.deadlines = { world: { at: 0.4 }, work: { for: 0.2 } };
  const run = R.create(input);
  run.schedule([event(7, 'survey-request'), transition(7, 'tide-survey', 'active')]);
  run.advance(6);
  assert.equal(state(run, 'tide-survey'), null);
  run.advance(9);
  const tide = state(run, 'tide-survey');
  assert.deepEqual(tide.transitions, [{ from: null, to: 'expired', tick: 7, reason: 'world-deadline',
    deadline: { clock: 'world', dueTick: 7 } }]);
  assert.equal(tide.source, undefined);
  assert(!run.history.some(row => row.kind === 'story-started' && row.story === 'tide-survey'));
  assert.equal(state(run, 'tow-offer').deadline.clock, 'world');
  assert.equal(state(run, 'tow-offer').deadlines.offer.remainingTicks, 0);
  assert.equal(state(run, 'pump-repair').deadline.clock, 'world');
  assert.equal(state(run, 'pump-repair').deadlines.work.spentTicks, 2);
  const saved = json(run.checkpoint());
  assert.deepEqual(R.create(saved.world, { checkpoint: saved }).checkpoint(), run.checkpoint());
  saved.storyLifecycleState[key('tide-survey')] = null;
  assert.throws(() => R.create(saved.world, { checkpoint: saved }), /Invalid saved story lifecycle/);
});

test('work accounting survives truncated transitions and an accepted legacy offer window', () => {
  const input = world(), { stories } = input.storyDocuments[0];
  delete input.eventActions;
  delete stories['tide-survey'];
  delete stories['tow-offer'];
  stories['pump-repair'].lifecycle.deadlines = { work: { for: 6 } };
  stories['pump-repair'].lifecycle.offerFor = 0.2;
  input.history = { enabled: false };
  input.commands = [
    transition(1, 'pump-repair', 'active'),
    ...Array.from({length:70}, (_, i) => transition(i + 2, 'pump-repair', i % 2 ? 'active' : 'suspended'))
  ];
  const run = R.create(input);
  run.advance(72);
  const current = state(run, 'pump-repair');
  assert.equal(current.transitions.length, 64);
  assert.equal(current.dropped, 8);
  assert.deepEqual(current.deadlines.offer,
    { budgetTicks: 2, offeredAt: 1, closedAt: 1, dueTick: 3, remainingTicks: 2, status: 'closed' });
  assert.equal(current.deadlines.work.spentTicks, 36);
  const checkpoint = json(run.checkpoint()), resumed = R.create(checkpoint.world, { checkpoint });
  run.advance(100);
  resumed.advance(100);
  const end = state(run, 'pump-repair');
  assert.deepEqual([end.status, end.since, end.deadline.spentTicks], ['expired', 96, 60]);
  assert.deepEqual(resumed.checkpoint(), run.checkpoint());
  assert.deepEqual(run.history, []);
});

test('deadline authoring validates clocks and saved expiration receipts', () => {
  const input = world(), doc = input.storyDocuments[0];
  const rejects = (change, message) => {
    const candidate = json(doc);
    change(candidate.stories);
    assert.throws(() => validateStoryDocument(candidate), message);
  };
  rejects(stories => { stories['tide-survey'].lifecycle.deadlines = {}; }, /expected at least one clock/);
  rejects(stories => { stories['tide-survey'].lifecycle.deadlines.local = { for: 1 }; }, /unknown field/);
  rejects(stories => { stories['tide-survey'].lifecycle.deadlines.world.at = 0; }, /positive finite seconds/);
  rejects(stories => { delete stories['tow-offer'].lifecycle.activation; }, /requires manual activation/);
  rejects(stories => { stories['tow-offer'].lifecycle.offerFor = 1; }, /single offer window/);
  doc.stories['tide-survey'].lifecycle.deadlines.world.at = 10 ** 8;
  assert.throws(() => R.create(input), /Story deadline exceeds the world tick budget/);
  const run = R.create(world());
  run.advance(8);
  const checkpoint = json(run.checkpoint());
  checkpoint.storyLifecycleState[key('tow-offer')].transitions.at(-1).deadline.dueTick--;
  assert.throws(() => R.create(checkpoint.world, { checkpoint }), /Invalid saved story lifecycle/);
});
