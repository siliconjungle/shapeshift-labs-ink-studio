const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const W = load().KIT.world, R = W.runtime;
const file = '../examples/story-documents/river-callbacks.world.json';
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const casting = require('../examples/story-documents/river-callbacks.casting.json');
const honored = require('../examples/story-documents/river-callbacks.honored.actions.json');
const broken = require('../examples/story-documents/river-callbacks.broken.actions.json');
const aya = {system:'crew',agent:'aya',generation:1}, ivo = {system:'crew',agent:'ivo',generation:2};
const watch = {kind:'faction',id:'river-watch'};
const full = story=>'river-callbacks/'+story;
const json = value=>JSON.parse(JSON.stringify(value));
const probe = (run,field,args)=>run.query().probe(field,undefined,args).value;
const callback = (run,name,actor=aya,withParty=watch)=>probe(run,'world/story-callbacks',{callback:name,actor,with:withParty});
const cast = run=>probe(run,'world/story-candidates',casting);
const decision = (run,story)=>probe(run,'world/story-commitments',{story:full(story)}).decision;
const term = report=>report.checks.find(row=>row.name.startsWith('term/'));
const restore = saved=>R.create(saved.world,{checkpoint:json(saved)});
const negotiation = world=>world.storyDocuments[0].stories.negotiate.lifecycle.commitment;

test('a rescue changes casting and native volunteering with proof from the earlier outcome',()=>{
  const authored = world(), run = R.create(authored);
  assert.equal(R.storyPreflight(authored).callbacks['past-rescue'].field,'world/memories');
  assert.equal(cast(run).qualified,0);
  assert.equal(callback(run,'past-rescue').status,'missed');
  run.advance(5);
  const [candidate,other] = cast(run).candidates;
  assert.equal(cast(run).qualified,1);
  assert.deepEqual(candidate.binding.value,aya);
  assert.equal(other.agent,'ivo');
  assert.equal(other.checks['remembers-rescue'].reason,'callback-condition-mismatch');
  const recalled = candidate.checks['remembers-rescue'].actual;
  assert.equal(recalled.evidence[0].data.outcome,'aya-safe');
  assert.equal(recalled.evidence[0].holder.id,'crew/aya/1');
  const cause = run.query().trace('world/cause',undefined,{event:recalled.evidence[0].id}).value;
  assert(cause.nodes.some(node=>node.event===recalled.evidence[0].source&&node.kind==='story-transition'));
  assert.equal(callback(run,'past-rescue',ivo).status,'missed');
  assert.equal(callback(run,'past-rescue',aya,{kind:'faction',id:'other-watch'}).status,'missed');
  run.advance(6);
  assert.equal(decision(run,'aya-volunteers').decision,'accepted');
  assert.deepEqual(term(decision(run,'aya-volunteers')).actual,{callback:recalled,applied:false});
  assert.equal(decision(run,'ivo-volunteers').decision,'refused');
  assert.equal(term(decision(run,'ivo-volunteers')).actual.applied,true);
  assert.equal(probe(run,'crew/orders',aya).active.id,'aya-volunteers');
  assert.equal(probe(run,'crew/orders',ivo).active,null);
});

test('a broken obligation activates a bond requirement and persists through checkpoint and replay',()=>{
  const accepted = R.create(world()), refused = R.create(world()), fundedWorld = world();
  negotiation(fundedWorld).terms.bond = 4;
  const funded = R.create(fundedWorld);
  accepted.schedule(honored);
  refused.schedule(broken);
  funded.schedule(broken);
  refused.advance(5);
  assert.equal(probe(refused,'standing/obligations',{obligation:'lantern-pledge'}).status,'broken');
  const recalled = callback(refused,'broken-pledge');
  assert.equal(recalled.evidence[0].data.obligation,'lantern-pledge');
  const cause = refused.query().trace('world/cause',undefined,{event:recalled.evidence[0].id}).value;
  assert(cause.nodes.some(node=>node.event===recalled.evidence[0].source&&node.kind==='obligation-resolved'));
  const resumed = restore(refused.checkpoint());
  for (const run of [accepted,refused,resumed,funded]) run.advance(14);
  assert.equal(decision(accepted,'negotiate').decision,'accepted');
  assert.equal(term(decision(accepted,'negotiate')).actual.applied,false);
  assert.equal(decision(refused,'negotiate').decision,'refused');
  const bond = term(decision(refused,'negotiate'));
  assert.equal(bond.reason,'terms-unmet');
  assert.equal(bond.actual.value,0);
  assert.deepEqual(bond.actual.callback,recalled);
  assert.equal(term(decision(funded,'negotiate')).actual.value,4);
  assert.equal(decision(funded,'negotiate').decision,'accepted');
  assert.deepEqual(refused.history,[]);
  assert.deepEqual(resumed.checkpoint(),refused.checkpoint());
  assert.deepEqual(R.replay(json(refused.recording())).checkpoint(),refused.checkpoint());
  const saved = json(refused.checkpoint());
  term(saved.storyLifecycleState[full('negotiate')].commitment).actual.applied = false;
  assert.throws(()=>restore(saved),/Invalid saved story lifecycle/);
});

test('a renewed actor lifetime does not inherit callbacks from the earlier holder',()=>{
  const run = R.create(world());
  run.schedule([
    {tick:10,action:'crew/despawn',args:{agent:'aya',generation:1}},
    {tick:10,action:'crew/spawn',args:{agent:'aya',species:'walker',position:[0,0,0]}}
  ]);
  run.advance(10);
  assert.equal(callback(run,'past-rescue',aya).status,'matched');
  const newAya = cast(run).candidates.find(row=>row.agent==='aya');
  assert.equal(newAya.generation,3);
  assert.equal(newAya.qualifies,false);
  assert.equal(newAya.checks['remembers-rescue'].actual.status,'missed');
});

test('unavailable callback evidence defers a proposal and lets it retry against later world state',()=>{
  const authored = world();
  authored.storyCallbacks['broken-pledge'] = {field:'standing/obligations',args:{obligation:'later-entry'},
    select:'/status',when:{value:'broken'},evidence:'/terms'};
  const run = R.create(authored);
  run.schedule([{tick:13,action:'standing/open-obligation',args:{
    obligation:'later-entry',category:'promise',debtor:'river-watch',creditor:'crew/aya/1',terms:{deliverable:'Return a key'}
  }}]);
  run.advance(12);
  assert.equal(decision(run,'negotiate').decision,'deferred');
  assert.equal(term(decision(run,'negotiate')).reason,'callback-unavailable');
  assert.equal(term(decision(run,'negotiate')).actual.callback.reason,'source-unavailable');
  run.advance(13);
  assert.equal(decision(run,'negotiate').decision,'accepted');
  assert.equal(term(decision(run,'negotiate')).actual.applied,false);
  assert.equal(term(decision(run,'negotiate')).actual.callback.value,'open');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('callback configuration, counterpart requirements and source recursion validate before use',()=>{
  const unknown = world();
  negotiation(unknown).consider['bond-after-breach'].callback.id = 'typo';
  assert.throws(()=>R.create(unknown),/Unknown story callback typo/);
  const missing = world();
  delete negotiation(missing).consider['bond-after-breach'].callback.with;
  assert.throws(()=>R.create(missing),/needs a counterpart/);
  const invalid = world();
  invalid.storyCallbacks['past-rescue'].field = 'world/story-candidates';
  assert.throws(()=>R.create(invalid),/Unavailable source field/);
  const run = R.create(world());
  assert.equal(probe(run,'world/story-callbacks',{callback:'past-rescue',actor:aya}).reason,'counterpart-required');
  assert.equal(probe(run,'world/story-callbacks',{callback:'past-rescue'}).reason,'actor-required');
  assert.equal(run.query().probe('world/story-callbacks',undefined,{callback:'missing'}).status,'missing');
});
