const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const directory = '../examples/story-documents/';
const sourceFile = directory+'breakwater-watch.world.json';
const source = () => embedStoryDocuments(copy(require(sourceFile)),path.resolve(__dirname,sourceFile));
const actions = name => require(directory+'breakwater-watch.'+name+'.actions.json');
const R = load().KIT.world.runtime;
const story = 'breakwater-watch/dispatch';
const read = (run,field,args) => run.query().probe(field,undefined,args).value;
const decisions = run => read(run,'world/story-decisions',{story});
const lifecycle = run => read(run,'world/story-lifecycle')[story];
const balance = (run,account) => read(run,'world/account',{account:'supplies/'+account}).balance;
const events = (run,kind) => run.history.filter(event=>event.kind===kind);
const copy = value => JSON.parse(JSON.stringify(value));
const restore = saved => R.create(saved.world,{checkpoint:copy(saved)});
const choose = (tick,stage,visit,branch) => ({tick,action:'world/story-choose',args:{
  document:'breakwater-watch',story:'dispatch',stage,visit,branch,reason:'player-request'
}});

test('an autonomous questlet waits for world evidence, then uses both intervention fallbacks', () => {
  const world = source(), run = R.create(world,{recordRun:true});
  assert.equal(R.storyPreflight(world).decisions[story]['plan-route'].windowTicks,3);
  run.schedule([choose(2,'stage-stock',1,'ready')]);
  run.advance(2);
  assert.equal(decisions(run).current.status,'autonomous');
  assert.equal(decisions(run).current.branches[0].rejected,'objectives-pending');
  assert.equal(events(run,'story-progress-rejected')[0].reason,'autonomous-stage');
  run.advance(3);
  assert.equal(decisions(run).current.status,'waiting');
  assert.equal(decisions(run).last.decision.by,'autonomous');
  run.advance(4);
  const {current} = decisions(run);
  assert.equal(current.status,'open');
  assert.equal(current.window.remainingTicks,3);
  assert.deepEqual(current.branches.map(({id,eligible,selectable})=>[id,eligible,selectable]),[
    ['coast',true,true],['ridge',false,false]
  ]);
  run.advance(14);
  const row = lifecycle(run);
  assert.equal(row.outcome,'standard-delivery');
  assert.deepEqual(row.flow.route.map(step=>[step.decision.by,step.leftAt]),[
    ['autonomous',3],['fallback',7],['fallback',10]
  ]);
  assert.deepEqual(events(run,'story-decision-opened').map(event=>event.tick),[4,8]);
  assert.deepEqual(events(run,'story-decision-elapsed').map(event=>event.tick),[7,10]);
  assert.deepEqual(events(run,'radio-route-committed').map(event=>event.route),['coast']);
  assert.deepEqual([balance(run,'pier'),balance(run,'shelter')],[2,0]);
  assert.deepEqual(R.replay(run.recording()).checkpoint(),run.checkpoint());
});

test('two intervention choices lead to a player stage that waits for an explicit decision', () => {
  const run = R.create(source());
  run.schedule([choose(4,'plan-route',2,'ridge'),...actions('intervene')]);
  run.advance(7);
  const {current,last} = decisions(run);
  assert.equal(current.status,'player');
  assert.equal(current.choices.destination.selectable,true);
  assert.equal(last.branch,'review');
  assert.equal(last.decision.by,'player');
  assert.equal(events(run,'story-progress-rejected')[0].reason,'objectives-pending');
  run.advance(11);
  assert.equal(lifecycle(run).status,'active');
  assert.equal(balance(run,'shelter'),0);
  run.advance(14);
  const row = lifecycle(run);
  assert.equal(row.outcome,'night-delivery');
  assert.deepEqual(row.flow.route.map(step=>[step.branch,step.decision.by,step.leftAt]),[
    ['ready','autonomous',3],['ridge','player',5],['review','player',7],['night','player',12]
  ]);
  assert.equal(row.flow.route[1].objectives.route.receipt.option,'ridge');
  assert.equal(events(run,'story-decision-elapsed').length,0);
  assert.deepEqual(events(run,'radio-intervention-available').map(event=>[event.stage,event.visit]),[
    ['plan-route',2],['dispatch-stock',3]
  ]);
  assert.equal(events(run,'radio-route-committed')[0].route,'ridge');
  assert.deepEqual([balance(run,'pier'),balance(run,'shelter')],[0,3]);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('suspension and checkpoint restore preserve the clock, and cutoff precedes player commands', () => {
  const run = R.create(source());
  run.schedule([...actions('pause'),choose(12,'plan-route',2,'ridge')]);
  run.advance(6);
  const {current} = decisions(run);
  assert.equal(current.status,'suspended');
  assert.equal(current.window.openedAt,4);
  assert.equal(current.window.remainingTicks,2);
  const saved = run.checkpoint(), resumed = restore(saved);
  const damage = copy(saved);
  damage.storyLifecycleState[story].flow.current.intervention.elapsedTicks = 5;
  assert.throws(()=>restore(damage),/Invalid saved story lifecycle/);
  run.advance(14);
  resumed.advance(14);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(events(run,'story-progress-rejected').map(event=>event.reason),[
    'intervention-window-closed','stale-stage-visit'
  ]);
  assert.deepEqual(lifecycle(run).flow.route[1].intervention,{openedAt:4,elapsedTicks:3,closedAt:11});
  assert.equal(lifecycle(run).since,14);
});

test('the elapsed fallback retries a blocked settlement without reopening the visit', () => {
  const world = source(), accounts = world.systems.supplies.config.accounts;
  accounts.pier.initial = 2;
  accounts.pier.max = 2;
  const run = R.create(world);
  run.schedule([choose(11,'dispatch-stock',3,'review'),
    {tick:12,action:'world/transfer',args:{from:'supplies/pier',to:'supplies/shelter',amount:2,mode:'exact'}}]);
  run.advance(10);
  assert.equal(decisions(run).current.status,'elapsed');
  assert.equal(lifecycle(run).settlements.blocked.blocker.id,'dispatch');
  assert.equal(balance(run,'staging'),4);
  run.advance(12);
  assert.equal(lifecycle(run).since,12);
  assert.equal(lifecycle(run).outcome,'standard-delivery');
  assert.equal(lifecycle(run).flow.route.at(-1).intervention.closedAt,10);
  assert.equal(events(run,'story-decision-opened').length,2);
  assert.deepEqual(events(run,'story-progress-rejected').map(event=>event.reason),['intervention-window-closed']);
});

test('preflight rejects missing fallbacks, automatic player gates, and excessive windows', () => {
  const world = source(), stages = world.storyDocuments[0].stories.dispatch.stages;
  delete stages['plan-route'].next.coast.auto;
  assert.throws(()=>R.storyPreflight(world),/needs an automatic fallback/);
  stages['plan-route'].next.coast.auto = true;
  stages['plan-route'].next.ridge.auto = true;
  assert.throws(()=>R.storyPreflight(world),/automatic branch cannot require a player choice/);
  delete stages['plan-route'].next.ridge.auto;
  stages['plan-route'].decision.for = 1e9;
  assert.throws(()=>R.storyPreflight(world),/intervention duration exceeds/);
  stages['plan-route'].decision.for = 0.3;
  stages['review-dispatch'].next.night.auto = true;
  assert.throws(()=>R.storyPreflight(world),/disagrees with the stage decision mode/);
});

test('returning to an intervention stage opens a fresh visit and rejects commands for the old visit', () => {
  const world = source(), stages = world.storyDocuments[0].stories.dispatch.stages;
  stages['review-dispatch'].objectives.destination.optional = true;
  stages['review-dispatch'].next.revisit = {stage:'plan-route'};
  const run = R.create(world);
  run.schedule([...actions('intervene').slice(0,3),choose(8,'review-dispatch',4,'revisit'),
    choose(9,'plan-route',2,'coast')]);
  run.advance(9);
  const {current} = decisions(run);
  assert.deepEqual([current.stage,current.visit,current.window.openedAt,current.window.remainingTicks],['plan-route',5,9,3]);
  assert.equal(lifecycle(run).flow.route[1].objectives.route.receipt.option,'ridge');
  assert.equal(events(run,'story-progress-rejected')[0].reason,'stale-stage-visit');
  run.advance(15);
  const route = lifecycle(run).flow.route;
  assert.equal(route[4].branch,'coast');
  assert.equal(route[4].intervention.closedAt,12);
  assert.equal(lifecycle(run).outcome,'standard-delivery');
});
