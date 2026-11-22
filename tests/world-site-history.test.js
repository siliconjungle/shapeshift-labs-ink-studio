const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/ridge-ford.world.json';
const reinforce = require('../examples/story-documents/ridge-ford.reinforce.actions.json');
const mark = require('../examples/story-documents/ridge-ford.mark.actions.json');
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const ford = 'ridge/ford', camp = 'ridge/camp';
const caravan = {kind:'faction',id:'ridge-caravan'}, guide = {kind:'actor',id:'ridge-caravan'};
const lookout = {kind:'actor',id:'crew/lookout'};
const clone = value=>JSON.parse(JSON.stringify(value));
const restore = saved=>R.create(saved.world,{checkpoint:clone(saved)});
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const site = (run,visitor=caravan)=>probe(run,'site-history',{site:ford,visitor});
const trace = (run,args={})=>run.query().trace('world/site-history',undefined,{site:ford,...args}).value;
const command = (tick,action,args)=>({tick,action:'world/'+action,args});
const visit = (tick,visitor,site=ford)=>command(tick,'visit-site',{site,visitor});
const change = (tick,args)=>command(tick,'change-site',{site:ford,outcome:'cache-updated',...args});
const fixture = extra=>({history:{enabled:false},siteHistory:{sites:{
  [ford]:{kind:'crossing',fields:{rations:'integer',safe:'boolean'},initial:{rations:0,safe:false}},
  [camp]:{kind:'camp'}
},...extra}});

test('different first-visit outcomes persist and unlock different quests on return',()=>{
  const authored = world(), built = R.create(authored), warning = R.create(authored);
  assert.equal(R.storyPreflight(authored).siteHistory.sites[ford].kind,'crossing');
  assert.equal(site(built).visitor.status,'unseen');
  built.schedule(reinforce);
  warning.schedule(mark);
  built.advance(2);
  assert.equal(site(built).visits,1);
  assert.equal(site(built).visitor.first,'2.0');
  built.advance(4);
  const after = site(built);
  assert.deepEqual(after.state,{safe:true,surface:'planked',rations:3});
  const recorded = after.consequences.safe;
  assert.equal(recorded.visit.id,'2.0');
  assert.equal(recorded.source.kind,'story-transition');
  assert.equal(recorded.outcome,'deck-reinforced');
  const causes = built.query().trace('world/cause',undefined,{event:recorded.id}).value;
  assert(causes.nodes.some(row=>row.event===recorded.source.id&&row.kind==='story-transition'));
  assert(causes.nodes.some(row=>row.event==='2.0'&&row.kind==='site-visited'));
  const resumed = restore(built.checkpoint());
  built.advance(8);
  assert.equal(site(built).visitor.count,2);
  assert.equal(probe(built,'story-lifecycle')['ridge-ford/cross-deck'].since,8);
  assert.deepEqual(trace(built).entries.map(row=>row.operation),['visit','change','visit']);
  assert.equal(trace(built).entries.at(-1).previous,'2.0');
  built.advance(9);
  resumed.advance(9);
  warning.advance(9);
  assert.deepEqual(site(warning).state,{safe:false,surface:'marked-unsafe',rations:0});
  assert.equal(probe(warning,'story-lifecycle')['ridge-ford/take-ridge'].outcome,'detoured');
  assert.equal(probe(warning,'story-lifecycle')['ridge-ford/cross-deck'],null);
  assert.equal(probe(built,'story-lifecycle')['ridge-ford/cross-deck'].outcome,'across');
  assert.equal(probe(built,'story-lifecycle')['ridge-ford/take-ridge'],null);
  assert.deepEqual(built.history,[]);
  assert.deepEqual(resumed.checkpoint(),built.checkpoint());
  assert.deepEqual(R.replay(clone(built.recording())).checkpoint(),built.checkpoint());
});

test('consequences and returning-visitor counts outlive the detailed timeline',()=>{
  const authored = world();
  authored.siteHistory.historyLimit = 1;
  const run = R.create(authored);
  run.schedule(reinforce);
  run.advance(9);
  assert.deepEqual(site(run).state,{safe:true,surface:'planked',rations:3});
  assert.deepEqual(site(run).visitor,{holder:caravan,status:'tracked',count:2,first:'2.0',last:'8.0'});
  assert.equal(site(run).consequences.surface.visit.id,'2.0');
  assert.equal(trace(run).dropped,2);
  assert.equal(trace(run).entries[0].operation,'visit');
  assert.equal(trace(run).status,'partial');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  run.schedule([change(10,{set:{rations:2},visit:'2.0'})]);
  run.advance(10);
  assert.equal(site(run).consequences.rations.visit.id,'2.0');
  assert.equal(site(run).state.rations,2);
  assert.equal(site(run).state.safe,true);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('bounded visitor records preserve site totals and distinguish actor and faction identities',()=>{
  const run = R.create(fixture({visitorLimit:2}));
  run.schedule([visit(1,caravan),visit(1,guide),visit(1,caravan,camp),
    visit(2,caravan),visit(3,lookout),visit(4,guide)]);
  run.advance(2);
  assert.equal(site(run,guide).visitor.count,1);
  assert.equal(site(run,caravan).visitor.count,2);
  assert.equal(probe(run,'site-history',{site:camp}).visits,1);
  assert.equal(probe(run,'site-history',{kind:'crossing'}).matched,1);
  run.advance(3);
  assert.equal(site(run,guide).visitor.status,'untracked');
  assert.equal(site(run).visits,4);
  assert.equal(site(run).visitor.count,2);
  run.advance(4);
  assert.equal(site(run,guide).visitor.count,1);
  assert.equal(site(run).visits,5);
  assert.equal(site(run).visitorEvictions,2);
  assert.equal(trace(run,{limit:2}).omitted,3);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('changes are atomic and reject a mismatched expected state, unrelated visits, or missing sources',()=>{
  const run = R.create(fixture());
  run.schedule([
    visit(1,caravan),visit(1,caravan,camp),
    change(2,{set:{rations:6},expect:{rations:0},visit:'1.0'}),
    change(2,{set:{rations:9,safe:true},expect:{rations:0},visit:'1.0'}),
    change(2,{set:{safe:true},visit:'1.1'}),
    change(2,{set:{safe:true},source:'3.0'})
  ]);
  run.advance(2);
  assert.deepEqual(run.events.map(row=>row.reason??row.kind),['site-changed','state-mismatch','visit-unavailable','source-unavailable']);
  assert.deepEqual(site(run).state,{rations:6,safe:false});
  assert.equal(site(run).consequences.safe,undefined);
  assert.equal(site(run).consequences.rations.visit.id,'1.0');
});

test('site schemas, reserved events, and saved consequences and visit links are validated',()=>{
  const run = R.create(fixture());
  assert.throws(()=>run.schedule([change(1,{set:{rations:'six'}})]),/typed state changes/);
  assert.throws(()=>run.schedule([change(1,{set:{spare:0}})]),/typed state changes/);
  assert.throws(()=>run.schedule([visit(1,caravan,'ridge/unknown')]),/Invalid site history action/);
  assert.throws(()=>run.schedule([command(1,'event',{kind:'site-visited'})]),/Use site history actions/);
  run.schedule([visit(1,caravan),change(2,{set:{rations:3},visit:'1.0'}),visit(3,caravan)]);
  run.advance(3);
  let saved = clone(run.checkpoint());
  saved.siteHistoryState.records[ford].consequences.rations.value = 5;
  assert.throws(()=>restore(saved),/Invalid saved site history/);
  saved = clone(run.checkpoint());
  saved.siteHistoryState.records[ford].history[1].visit.visitor = guide;
  assert.throws(()=>restore(saved),/Invalid saved site history/);
  saved = clone(run.checkpoint());
  saved.siteHistoryState.records[ford].visitors[0].count = 1;
  assert.throws(()=>restore(saved),/Invalid saved site history/);
});
