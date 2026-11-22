const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const file = path.join(directory, 'canal-camp.world.json');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const world = () => embedStoryDocuments(read(file), file);
const actions = name => read(path.join(directory, `canal-camp-${name}.actions.json`));
const key = 'canal-camp/commission';
const json = value => JSON.parse(JSON.stringify(value));
const sample = (run, field, args) => run.query().probe(field, undefined, args).value;
const lifecycle = run => sample(run, 'world/story-lifecycle')[key];
const site = run => sample(run, 'workshop/worksite', {process:'frames'});
const notice = run => sample(run, 'notices/offers', {offer:'camp-help'});
const balance = (run, account) => sample(run, 'world/account', {account}).balance;
const claims = run => sample(run, 'booking/claims');
const command = (tick, action, args) => ({tick, action, args});
const transfer = (tick, from, to) => command(tick,'world/transfer',{from,to,amount:2,mode:'exact'});

test('a withdrawal releases the exact claim, refunds the offer and retires the yard while a named ending keeps it', () => {
  const run = R.create(world());
  run.advance(3);
  assert.equal(claims(run)[0].status, 'held');
  assert.equal(notice(run).status, 'open');
  assert.equal(balance(run, 'notices/escrow'), 5);
  assert.equal(sample(run, 'workshop/ledger').wood.inProgress, 2);
  const stopped = run.fork(), kept = run.fork();
  stopped.schedule(actions('withdraw'));
  kept.schedule(actions('permanent'));
  stopped.advance(4);
  assert.deepEqual(lifecycle(stopped).cleanup, {dueTick:5, actions:{
    'bench-claim':{status:'pending'}, 'public-notice':{status:'pending'}, 'temporary-yard':{status:'pending'}
  }});
  assert.equal(lifecycle(stopped).status, 'withdrawn');
  assert.equal(claims(stopped).length, 1);
  const saved = json(stopped.checkpoint()), restored = R.create(saved.world, {checkpoint:saved});
  for (const branch of [stopped, kept, restored]) {
    branch.advance(18);
    assert.deepEqual(claims(branch), []);
    assert.equal(notice(branch).status, 'withdrawn');
    assert.equal(balance(branch, 'notices/escrow'), 0);
    assert.equal(balance(branch, 'stock/treasury'), 12);
    assert.equal(balance(branch, 'stock/shelter'), 1);
    assert(branch.history.some(row => row.kind === 'reservation-released' && row.tick === 5 && row.reason === 'story-ended'));
  }
  assert.deepEqual(restored.checkpoint(), stopped.checkpoint());
  assert.deepEqual([site(stopped).retiredAt, site(stopped).refundPending, site(stopped).position], [5,false,null]);
  assert.equal(balance(stopped, 'workshop/yard.wood'), 2);
  assert.equal(sample(stopped, 'crew/orders', {agent:'maintainer'}).outcomes[0].reason, 'site-retired');
  assert.equal(lifecycle(kept).outcome, 'permanent');
  assert.equal(lifecycle(kept).cleanup.actions['temporary-yard'].status, 'kept');
  assert.equal(site(kept).retiredAt, undefined);
  assert.equal(site(kept).completed, 1);
  assert.equal(balance(kept, 'workshop/yard.frame'), 1);
  assert.deepEqual(stopped.history.filter(row => row.kind === 'story-cleanup-resolved').map(({tick,rule}) => [tick,rule]),
    [[5,'bench-claim'],[5,'public-notice'],[5,'temporary-yard']]);
  for (const branch of [stopped, kept]) assert.deepEqual(R.replay(json(branch.recording())).checkpoint(), branch.checkpoint());
});

test('a blocked worksite refund remains in the ledger and settles once room opens', () => {
  const input = world();
  input.history = { enabled:false };
  const run = R.create(input);
  run.schedule([...actions('withdraw'), transfer(4,'stock/spare-planks','workshop/yard.wood'),
    transfer(7,'workshop/yard.wood','stock/spare-planks')]);
  run.advance(6);
  assert.equal(site(run).retiredAt, 5);
  assert.equal(site(run).refundPending, true);
  assert.deepEqual([sample(run, 'workshop/ledger').wood.inProgress, balance(run,'workshop/yard.wood')], [2,2]);
  assert.equal(sample(run, 'workshop/ledger').wood.error, 0);
  const saved = json(run.checkpoint()), restored = R.create(saved.world,{checkpoint:saved});
  restored.advance(8);
  run.advance(8);
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
  assert.equal(site(run).refundPending, false);
  assert.deepEqual([sample(run, 'workshop/ledger').wood.inProgress, balance(run,'workshop/yard.wood')], [0,2]);
  assert.equal(sample(run, 'workshop/ledger').wood.error, 0);
});

test('cleanup skips a recycled agent and a reposted offer', () => {
  const input = world(), rules = input.storyDocuments[0].stories.commission.lifecycle.cleanup;
  delete rules['temporary-yard'];
  const run = R.create(input);
  run.schedule([
    command(3,'crew/despawn',{agent:'builder',generation:1}),
    command(3,'crew/spawn',{agent:'builder',species:'wright',position:[0,0,0]}),
    {...input.commands[0],tick:3},
    command(3,'notices/withdraw',{offer:'camp-help'}),
    command(4,'notices/post',{offer:'camp-help',template:'wright',reward:5}),
    ...actions('withdraw')
  ]);
  run.advance(5);
  const result = lifecycle(run).cleanup.actions;
  assert.deepEqual(result['bench-claim'], {status:'skipped',reason:'owner-unavailable',tick:5});
  assert.deepEqual(result['public-notice'], {status:'skipped',reason:'offer-revision-unavailable',tick:5});
  assert.deepEqual([claims(run)[0].owner.generation, claims(run)[0].owner.sequence], [3,1]);
  assert.deepEqual([notice(run).status, notice(run).revision], ['open',2]);
  assert.equal(balance(run, 'notices/escrow'), 5);
});

test('expiry uses the same cleanup and a terminal-status keep rule preserves a claim', () => {
  const input = world(), setup = input.storyDocuments[0].stories.commission.lifecycle;
  setup.deadlines = {world:{at:0.4}};
  setup.cleanup['bench-claim'].keepOn = ['expired'];
  setup.cleanup['temporary-yard'].keepOn = ['expired'];
  const run = R.create(input);
  run.advance(5);
  assert.equal(lifecycle(run).status, 'expired');
  assert.equal(lifecycle(run).cleanup.actions['bench-claim'].status, 'kept');
  assert.equal(claims(run)[0].status, 'held');
  assert.equal(site(run).retiredAt, undefined);
  assert.equal(notice(run).status, 'withdrawn');
});

test('aggregated agent and logistics representations accept cleanup through their native providers', () => {
  const input = world();
  input.simulationChunks = { grid:{size:16}, levels:[
    {id:'detail',within:2,every:1}, {id:'far',within:40,every:1,
      systems:{agents:{aggregate:{model:'cohorts',cell:4}},logistics:{aggregate:{model:'ledger'}}}},
    {id:'sleep',sleep:true}
  ], chunks:{yard:{index:[0,0],systems:['workshop','crew']}},focus:{camera:{at:[4,0,4]}} };
  const run = R.create(input);
  run.schedule([command(3,'world/chunk-focus',{id:'camera',at:[30,0,4]}), ...actions('withdraw')]);
  run.advance(4);
  assert.equal(run.checkpoint().states.workshop.model, 'ledger');
  assert.equal(run.checkpoint().states.crew.model, 'cohorts');
  run.advance(5);
  assert.equal(site(run).retiredAt, 5);
  assert.equal(balance(run,'workshop/yard.wood'), 2);
  assert.deepEqual(claims(run), []);
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(), run.checkpoint());
});

test('authoring rejects ambiguous targets and restore rejects malformed cleanup progress', () => {
  const input = world(), doc = input.storyDocuments[0];
  const rule = doc.stories.commission.lifecycle.cleanup['temporary-yard'];
  rule.keepOutcomes = ['missing'];
  assert.throws(() => validateStoryDocument(doc), /unknown outcome/);
  rule.keepOutcomes = ['permanent'];
  rule.claim = {system:'crew',agent:'builder',generation:1,sequence:1};
  assert.throws(() => validateStoryDocument(doc), /exactly one claim, offer, or site/);
  delete rule.claim;
  rule.site.process = 'missing';
  assert.throws(() => R.create(input), /Unknown story cleanup site target/);

  const run = R.create(world());
  run.schedule(actions('withdraw'));
  run.advance(5);
  const saved = json(run.checkpoint());
  saved.storyLifecycleState[key].cleanup.actions['bench-claim'] = {status:'pending'};
  assert.throws(() => R.create(saved.world, {checkpoint:saved}), /Invalid saved story lifecycle/);
});
