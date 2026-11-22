const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime, story = 'signal-contract/repair';
const directory = path.resolve(__dirname,'../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const source = () => embedStoryDocuments(read('signal-contract.world.json'),path.join(directory,'signal-contract.world.json'));
const actions = () => read('signal-contract.actions.json');
const definition = world => world.storyDocuments[0].stories.repair;
const probe = (run,field,args) => run.query().probe(field,undefined,args).value;
const lifecycle = run => probe(run,'world/story-lifecycle')[story];
const settlement = run => probe(run,'world/story-settlements',{story});
const transfers = run => probe(run,'world/transfers').receipts;
const balance = (run,account) => probe(run,'world/account',{account}).balance;
const move = (tick,from,to,amount) => ({tick,action:'world/transfer',args:{from,to,amount,mode:'exact'}});
const resume = saved => R.create(saved.world,{checkpoint:JSON.parse(JSON.stringify(saved))});

test('exact fees, inventory, labor, restricted access, reputation and obligation settle through the native systems', () => {
  const world = source(), run = R.create(world,{recordRun:true});
  assert.equal(R.storyPreflight(world).settlements[story].outcomes.repaired.access.access.holder.agent,'mira');
  run.schedule(actions());
  run.advance(1);
  const {costs} = settlement(run);
  assert.equal(costs.tick,1);
  assert.deepEqual(costs.effects[0].detail.owner,lifecycle(run).commitment.order);
  assert.deepEqual(transfers(run),costs.effects.slice(1).map(effect=>effect.detail));
  assert.deepEqual(['funds/sponsor','funds/fees','stock/depot.timber','stock/yard.timber'].map(account=>balance(run,account)),[8,2,0,2]);
  run.advance(6);
  const {outcome} = settlement(run), byId = Object.fromEntries(outcome.effects.map(effect=>[effect.id,effect.detail]));
  assert.equal(lifecycle(run).status,'completed');
  assert.deepEqual(byId.labor.event,lifecycle(run).flow.route[0].objectives.built.receipt.event);
  assert.deepEqual(byId.labor.event.workers.map(worker=>worker.agent),['mira']);
  assert.deepEqual(['stock/yard.timber','stock/yard.frame','funds/treasury','funds/mira'].map(account=>balance(run,account)),[0,1,4,5]);
  assert.equal(probe(run,'standing/reputation',{subject:'mira',faction:'harbor'}).value,4);
  assert.equal(probe(run,'standing/obligations')['signal-inspection'].status,'open');
  run.advance(7);
  assert.equal(probe(run,'booking/claims')[0].reason,'not-offered');
  run.advance(14);
  assert.equal(probe(run,'booking/jobs')['priority-yard'].completedBy.agent,'mira');
  assert.equal(probe(run,'standing/obligations')['signal-inspection'].status,'fulfilled');
  assert.deepEqual(resume(run.checkpoint()).checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(run.recording()).checkpoint(),run.checkpoint());
  const damage = JSON.parse(JSON.stringify(run.checkpoint()));
  damage.storyLifecycleState[story].settlements.outcome.effects.find(effect=>effect.id==='pay').detail.applied = 7;
  assert.throws(()=>resume(damage),/Invalid saved story lifecycle/);
});

test('a failed inventory cost rolls back the fee, order and reservation until funding arrives', () => {
  const world = source();
  const {containers} = world.systems.stock.config;
  containers.depot.stocks.timber.initial = 0;
  containers.relief = {stocks:{timber:{initial:2,max:2}}};
  const run = R.create(world);
  run.schedule([move(3,'stock/relief.timber','stock/depot.timber',2)]);
  run.advance(1);
  assert.equal(lifecycle(run).status,'available');
  assert.equal(settlement(run).blocked.blocker.id,'materials');
  assert.deepEqual(settlement(run).blocked.blocker.detail.limitedBy,['source']);
  assert.equal(balance(run,'funds/fees'),0);
  assert.equal(probe(run,'crew/orders',{agent:'mira'}).serial,0);
  assert.deepEqual(probe(run,'booking/claims'),[]);
  assert(!run.history.some(row=>['transfer','order-issued','reservation-granted'].includes(row.kind)));
  const resumed = resume(run.checkpoint());
  run.advance(3);
  resumed.advance(3);
  assert.equal(lifecycle(run).status,'active');
  assert.equal(settlement(run).costs.tick,3);
  assert.equal(settlement(run).blocked,undefined);
  assert.equal(balance(run,'funds/fees'),2);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
});

test('blocked payout grants nothing and a retry pays once with the original work evidence', () => {
  const world = source();
  world.systems.funds.config.accounts.treasury.initial = 0;
  const run = R.create(world);
  const [choose] = actions();
  run.schedule([choose,move(9,'funds/sponsor','funds/treasury',5),{...choose,tick:10},{...choose,tick:11}]);
  run.advance(6);
  const original = lifecycle(run).flow.current.objectives.built.receipt.event;
  assert.equal(lifecycle(run).status,'active');
  assert.equal(settlement(run).blocked.blocker.id,'pay');
  assert.deepEqual(probe(run,'standing/obligations'),{});
  assert.deepEqual(probe(run,'standing/reputation'),{mira:{harbor:1}});
  assert.deepEqual(probe(run,'booking/jobs'),{});
  assert(!run.history.some(row=>['job-posted','obligation-opened','reputation-changed'].includes(row.kind)));
  const resumed = resume(run.checkpoint());
  run.advance(14);
  resumed.advance(14);
  assert.equal(lifecycle(run).since,10);
  assert.deepEqual(settlement(run).outcome.effects.find(effect=>effect.id==='labor').detail.event,original);
  assert.equal(balance(run,'funds/mira'),5);
  assert.equal(balance(run,'funds/fees'),2);
  assert.deepEqual(probe(run,'standing/reputation'),{mira:{harbor:4}});
  assert.equal(run.history.filter(row=>row.kind==='story-settlement').length,2);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
});

test('settlement validates native references and checks the exact worker generation', () => {
  const world = source(), {settlement:spec} = definition(world).lifecycle;
  const labor = spec.outcomes.repaired.labor.work;
  labor.site = 'stock/absent';
  assert.throws(()=>R.create(world),/Invalid story settlement.*Unknown worksite batch/);
  labor.site = 'stock/frame';
  labor.actor = {system:'crew',agent:'mira',generation:2};
  const run = R.create(world);
  run.schedule(actions().slice(0,1));
  run.advance(6);
  assert.equal(lifecycle(run).status,'active');
  assert.equal(settlement(run).blocked.blocker.reason,'work-proof-missing');
  assert.equal(balance(run,'funds/mira'),0);
  assert.deepEqual(probe(run,'booking/jobs'),{});
  spec.costs.materials.transfer.to = 'funds/fees';
  assert.throws(()=>R.storyPreflight(world),/Invalid story settlement.*Incompatible transfer accounts/);
});

test('manual activation charges once across suspension and a named direct outcome settles independently', () => {
  const world = source(), contract = definition(world), {settlement:spec} = contract.lifecycle;
  contract.lifecycle = {activation:'manual',settlement:spec};
  delete contract.stages.repair.objectives;
  delete spec.costs.bench;
  delete spec.outcomes.repaired.labor;
  const transition = (tick,to,extra) => ({tick,action:'world/story-transition',args:{
    document:'signal-contract',story:'repair',to,reason:'contract-test',...extra
  }});
  const run = R.create(world);
  run.schedule([
    transition(2,'active'),transition(3,'suspended'),transition(4,'active'),
    transition(5,'completed',{outcome:'repaired'})
  ]);
  run.advance(1);
  assert.equal(lifecycle(run).status,'available');
  assert.equal(balance(run,'funds/fees'),0);
  run.advance(5);
  assert.equal(settlement(run).costs.tick,2);
  assert.equal(settlement(run).outcome.tick,5);
  assert.equal(balance(run,'funds/fees'),2);
  assert.equal(balance(run,'funds/mira'),5);
  assert.deepEqual(resume(run.checkpoint()).checkpoint(),run.checkpoint());
});
