const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime, story = 'quay-relay/delivery';
const directory = path.resolve(__dirname,'../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const source = () => embedStoryDocuments(read('quay-relay.world.json'),path.join(directory,'quay-relay.world.json'));
const actions = () => read('quay-relay.actions.json');
const definition = world => world.storyDocuments[0].stories.delivery;
const query = (run,field,args) => run.query().probe(field,undefined,args).value;
const lifecycle = run => query(run,'world/story-lifecycle')[story];
const handoffs = run => query(run,'world/story-handoffs',{story});
const orders = (run,agent) => query(run,'crew/orders',{agent});
const claims = run => query(run,'booking/claims');
const balance = (run,account) => query(run,'world/account',{account:'supplies/'+account}).balance;
const json = value => JSON.parse(JSON.stringify(value));
const restore = saved => R.create(saved.world,{checkpoint:saved});
const command = (tick,type,args) => ({tick,action:'world/'+type,args:{document:'quay-relay',story:'delivery',...args}});
const blockers = report => report.checks.filter(row=>row.status!=='pass').map(row=>row.reason);

test('a pending handoff preserves the whole old assignment and accepted work credits both participants', () => {
  const world = source(), run = R.create(world);
  assert.deepEqual(R.storyPreflight(world).handoffs[story].relief.requires,['staged']);
  run.schedule(actions());
  run.advance(2);
  assert.deepEqual(blockers(handoffs(run).last),['objectives-pending']);
  run.advance(3);
  const staged = lifecycle(run).flow.current.objectives.staged;
  assert.equal(staged.credit.agent,'mira');
  assert.deepEqual(blockers(handoffs(run).last),['existing-order']);
  run.advance(7);
  const before = handoffs(run);
  assert.equal(before.last.decision,'deferred');
  assert.deepEqual(blockers(before.last),['capacity']);
  assert.equal(orders(run,'mira').active.id,'load-medicine');
  assert.equal(orders(run,'niko').serial,1);
  assert.equal(claims(run).find(claim=>claim.grants[0].pool==='lift').owner.agent,'mira');
  assert.equal(balance(run,'staging'),2);
  assert(!run.history.some(row=>row.kind==='order-cancelled'&&row.order==='load-medicine'));
  const saved = json(run.checkpoint()), resumed = restore(saved);
  run.advance(8);
  const report = handoffs(run), [exchange] = report.transfers;
  assert.equal(report.revision,1);
  assert.equal(report.assignment.agent,'niko');
  assert.deepEqual(query(run,'world/story-commitments',{story}).assignment,report.assignment);
  assert.deepEqual(exchange.from,staged.credit);
  assert.equal(exchange.release.status,'cancelled');
  assert.equal(exchange.release.work.results[0].receipt.applied,2);
  assert.deepEqual(lifecycle(run).flow.current.objectives.staged,staged);
  assert.deepEqual(claims(run)[0].grants.map(row=>row.pool),['lift','landing']);
  assert.deepEqual(claims(run)[0].owner,report.assignment);
  assert.equal(orders(run,'mira').queue[0].id,'next-stocktake');
  run.advance(17);
  resumed.advance(17);
  assert(run.history.some(row=>row.kind==='story-handoff-rejected'&&row.reason==='stale-assignment-revision'));
  const done = lifecycle(run);
  assert.equal(done.status,'completed');
  assert.deepEqual(done.flow.route[0].objectives.staged,staged);
  assert.deepEqual(done.flow.route[0].objectives.received.credit,report.assignment);
  assert.deepEqual(['depot','staging','pier'].map(account=>balance(run,account)),[0,0,2]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
  const damage = json(run.checkpoint());
  damage.storyLifecycleState[story].flow.route[0].objectives.staged.credit.agent = 'niko';
  assert.throws(() => restore(damage),/Invalid saved story lifecycle/);
});

test('refusal leaves the original assignment active, and expiration cancels a deferred handoff', () => {
  const world = source(), spec = definition(world).lifecycle.handoffs.relief.commitment;
  spec.terms.rate = 1;
  spec.consider = {pay:{when:{path:'/terms/rate',op:'gte',value:5},otherwise:'refuse'}};
  const refused = R.create(world);
  refused.schedule(actions().slice(0,6));
  refused.advance(8);
  assert.equal(handoffs(refused).last.decision,'refused');
  assert(blockers(handoffs(refused).last).includes('terms-unmet'));
  assert.equal(lifecycle(refused).status,'active');
  assert.equal(orders(refused,'mira').active.id,'load-medicine');
  const expired = R.create(source());
  expired.schedule(actions().filter(row=>row.tick!==8&&row.tick!==9));
  expired.advance(17);
  assert.deepEqual([lifecycle(expired).status,handoffs(expired).last.decision],['expired','cancelled']);
  assert.deepEqual(blockers(handoffs(expired).last),['story-closed']);
  assert.equal(orders(expired,'niko').serial,1);
  assert.equal(balance(expired,'staging'),2);
  assert.deepEqual(claims(expired).map(claim=>claim.owner.agent),['keeper']);
  assert.deepEqual(restore(json(expired.checkpoint())).checkpoint(),expired.checkpoint());
});

test('explicit cancellation and leaving a stage each stop a pending handoff', () => {
  const cancelled = R.create(source());
  cancelled.schedule([...actions().slice(0,6),command(7,'story-cancel-handoff',{revision:0,reason:'change-of-plan'})]);
  cancelled.advance(9);
  assert.deepEqual(blockers(handoffs(cancelled).last),['change-of-plan']);
  assert.equal(handoffs(cancelled).assignment.agent,'mira');
  const world = source(), {stages} = definition(world);
  stages.transfer.objectives.received.optional = true;
  stages.transfer.next.review = {stage:'review'};
  stages.review = {title:'Review the shipment',next:{done:{outcome:'delivered'}}};
  const moved = R.create(world);
  moved.schedule([...actions().slice(0,6),command(5,'story-choose',{
    stage:'transfer',visit:1,branch:'review',reason:'switch-goal'
  })]);
  moved.advance(9);
  assert.deepEqual(blockers(handoffs(moved).last),['stage-changed']);
  assert.equal(lifecycle(moved).flow.current.stage,'review');
  assert.equal(handoffs(moved).revision,0);
});

test('terminal cleanup releases the incoming assignment and leaves both actors’ unrelated work', () => {
  const run = R.create(source());
  run.schedule([...actions().slice(0,6),
    {tick:9,action:'crew/issue-order',args:{agent:'niko',order:{id:'next-inspection',task:'stocktake'}}},
    command(9,'story-transition',{to:'withdrawn',reason:'dock-closed'})
  ]);
  run.advance(10);
  assert.equal(handoffs(run).assignment.agent,'niko');
  assert.equal(orders(run,'niko').active.id,'next-inspection');
  assert.equal(orders(run,'mira').active.id,'next-stocktake');
  assert.deepEqual(claims(run),[]);
  assert(run.history.some(row=>row.kind==='story-commitment-released'&&row.order.agent==='niko'));
  assert.equal(balance(run,'staging'),2);
});

test('a later revision can hand back settled work while preserving both prior credits', () => {
  const world = source(), spec = definition(world).lifecycle.handoffs;
  delete world.eventActions;
  spec.review = {stage:'transfer',requires:['received'],commitment:{
    actor:{system:'crew',agent:'mira',generation:2},order:{id:'review-relay',task:'stocktake'}
  }};
  const run = R.create(world);
  run.schedule([...actions().filter(row=>row.tick!==7&&row.tick!==9),
    command(14,'story-handoff',{proposal:'review',revision:1,reason:'review-shipment'})
  ]);
  run.advance(14);
  const report = handoffs(run);
  assert.equal(report.revision,2);
  assert.equal(report.assignment.agent,'mira');
  assert.equal(report.last.release.status,'settled');
  assert.equal(report.last.release.work.results.at(-1).receipt.applied,2);
  assert.deepEqual(Object.values(lifecycle(run).flow.current.objectives).map(row=>row.credit.agent),['mira','niko']);
  assert.deepEqual(restore(json(run.checkpoint())).checkpoint(),run.checkpoint());
});
