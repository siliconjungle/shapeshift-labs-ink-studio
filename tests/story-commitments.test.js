const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime, story = 'dispatch/unload';
const directory = path.resolve(__dirname,'../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const source = () => embedStoryDocuments(read('dock-dispatch.world.json'),path.join(directory,'dock-dispatch.world.json'));
const actions = () => read('dock-dispatch.actions.json');
const query = (run,field,args) => run.query().probe(field,undefined,args).value;
const lifecycle = (run,key=story) => query(run,'world/story-lifecycle')[key];
const report = (run,key=story) => query(run,'world/story-commitments',{story:key}).decision;
const book = run => query(run,'crew/orders',{agent:'mira'});
const claims = run => query(run,'booking/claims');
const balance = (run,account) => query(run,'world/account',{account:'stores/'+account}).balance;
const json = value => JSON.parse(JSON.stringify(value));
const restore = saved => R.create(saved.world,{checkpoint:saved});
const reasons = value => value.checks.filter(row=>row.status!=='pass').map(row=>row.reason);

test('a manual request retains its terms and atomically takes the order and full bundle once ready', () => {
  const world = source(), run = R.create(world);
  assert.equal(R.storyPreflight(world).commitments[story].actor.generation,2);
  assert.equal(report(run),null);
  run.schedule(actions());
  run.advance(2);
  assert.equal(lifecycle(run).status,'available');
  assert.deepEqual(reasons(report(run)),['existing-order','outside-schedule','need-condition']);
  assert.equal(report(run).checks.find(row=>row.name==='availability').actual.active.id,'stocktake');
  run.advance(7);
  assert.deepEqual(reasons(report(run)),['outside-schedule']);
  run.advance(9);
  assert.deepEqual(reasons(report(run)),['capacity']);
  assert.equal(book(run).serial,1);
  assert.equal(book(run).active,null);
  assert.equal(query(run,'booking/pools',{pool:'landing'}).available,1);
  assert.deepEqual(claims(run).map(row=>row.owner.agent),['keeper']);
  assert.deepEqual(run.history.filter(row=>row.kind==='order-issued').map(row=>row.order),['crane-inspection','stocktake']);
  const saved = json(run.checkpoint()), resumed = restore(saved);
  run.advance(11);
  const accepted = report(run);
  assert.deepEqual([accepted.requestedAt,accepted.tick,accepted.decision],[2,11,'accepted']);
  assert.deepEqual(accepted.order,{system:'crew',agent:'mira',generation:2,sequence:2});
  assert.deepEqual(claims(run)[0].grants.map(row=>row.pool),['crane','landing']);
  assert.deepEqual(run.events.find(row=>row.kind==='story-started').commitment,accepted.order);
  const damaged = json(run.checkpoint());
  damaged.storyLifecycleState[story].commitment.order.generation++;
  assert.throws(() => restore(damaged),/Invalid saved story lifecycle/);
  run.advance(20);
  resumed.advance(20);
  assert.equal(lifecycle(run).outcome,'unloaded');
  assert.equal(balance(run,'pier'),2);
  assert.equal(balance(run,'operator-wallet'),8);
  assert.deepEqual(claims(run),[]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('unacceptable pay refuses the proposal, while an unavailable bundle can defer through expiry', () => {
  const low = source();
  low.storyTemplates[0].parameters = {rate:3};
  const refusal = R.create(low);
  refusal.schedule(actions());
  refusal.advance(20);
  assert.equal(lifecycle(refusal).status,'withdrawn');
  assert.equal(report(refusal).decision,'refused');
  assert.deepEqual(report(refusal).checks.find(row=>row.name==='term/minimum-pay').actual,
    {when:{path:'/terms/reward',op:'gte',value:6},value:3});
  assert.equal(balance(refusal,'operator-wallet'),0);
  assert.equal(book(refusal).serial,1);
  assert.deepEqual(restore(json(refusal.checkpoint())).checkpoint(),refusal.checkpoint());
  const expired = R.create(source());
  expired.schedule(actions().filter(row=>row.tick!==11));
  expired.advance(20);
  assert.equal(lifecycle(expired).status,'expired');
  assert.equal(report(expired).tick,15);
  assert.deepEqual(reasons(report(expired)),['capacity']);
  assert.equal(book(expired).serial,1);
  assert.equal(query(expired,'booking/pools',{pool:'landing'}).available,1);
  assert.deepEqual(restore(json(expired.checkpoint())).checkpoint(),expired.checkpoint());
});

test('a later proposal sees a same-tick accepted order and a pending withdrawal prevents dispatch', () => {
  const world = source(), extra = 'extra/unload';
  const first = world.storyTemplates[0];
  world.storyTemplates.push({...first,id:'extra',parameters:{orderId:'backlog-unload'}});
  world.storyBindings[extra] = world.storyBindings[story];
  const ask = {tick:3,action:'world/story-transition',args:{document:'extra',story:'unload',to:'active',reason:'request-backlog'}};
  const run = R.create(world);
  run.schedule([...actions(),ask]);
  run.advance(11);
  assert.equal(report(run).decision,'accepted');
  assert.deepEqual(reasons(report(run,extra)),['existing-order']);
  assert.deepEqual(claims(run).map(row=>row.owner.sequence),[2]);
  const cancelled = R.create(source());
  cancelled.schedule([...actions(),{tick:11,action:'world/story-transition',args:{
    document:'dispatch',story:'unload',to:'withdrawn',reason:'cancel-before-dispatch'
  }}]);
  cancelled.advance(12);
  assert.equal(lifecycle(cancelled).status,'withdrawn');
  assert.equal(report(cancelled).decision,'deferred');
  assert.equal(book(cancelled).serial,1);
  assert.deepEqual(claims(cancelled),[]);
});

test('closing the story releases only the native order recorded for its commitment', () => {
  const run = R.create(source());
  run.schedule([...actions(),
    {tick:12,action:'crew/issue-order',args:{agent:'mira',order:{id:'next-stocktake',task:'inventory'}}},
    {tick:12,action:'world/story-transition',args:{document:'dispatch',story:'unload',to:'withdrawn',reason:'dock-closed'}}
  ]);
  run.advance(13);
  assert.equal(book(run).active.id,'next-stocktake');
  assert.equal(book(run).outcomes.find(row=>row.id==='dock-dispatch').phase,'cancelled');
  assert(run.history.some(row=>row.kind==='story-commitment-released'&&row.order.sequence===2));
  assert.deepEqual(claims(run),[]);
  assert.equal(balance(run,'pier'),0);
});

test('native committed activities and pinned actor replacement produce explicit responses', () => {
  const busy = source();
  Object.assign(busy.systems.crew.config.decisions.activities.rest,{duration:8,commitment:'finish'});
  const run = R.create(busy);
  run.schedule(actions().filter(row=>row.args.order?.id!=='stocktake'));
  run.advance(2);
  assert(reasons(report(run)).includes('committed-activity'));
  assert.equal(book(run).serial,0);
  const replaced = R.create(source());
  replaced.schedule([
    {tick:1,action:'world/event',args:{kind:'dock-help-requested'}},
    {tick:2,action:'crew/despawn',args:{agent:'mira',generation:2}},
    {tick:2,action:'crew/spawn',args:{agent:'mira',position:[-1,0,0],species:'dockhand'}},
    actions().find(row=>row.action==='world/story-transition')
  ]);
  replaced.advance(2);
  assert.equal(lifecycle(replaced).status,'withdrawn');
  assert.deepEqual(reasons(report(replaced)),['actor-replaced']);
  assert.equal(report(replaced).checks[0].actual.generation,3);
  assert.equal(book(replaced).serial,0);
});
