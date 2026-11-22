const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/channel-beliefs.world.json';
const disclosure = require('../examples/story-documents/channel-beliefs.evidence.actions.json');
const source = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const actor = id=>({kind:'actor',id});
const niko = actor('crew/niko'), mira = actor('crew/mira'), lookout = actor('crew/lookout');
const watch = {kind:'faction',id:'harbor-watch'}, topic = 'east-channel', story = 'channel-beliefs/reroute-convoy';
const command = (tick,action,args)=>({tick,action:'world/'+action,args});
const claim = (tick,holder,value,confidence)=>command(tick,'claim-belief',{topic,holder,source:mira,value,confidence});
const relay = (tick,from,to,account,confidence)=>command(tick,'relay-belief',{topic,from,to,account,...(confidence!==undefined&&{confidence})});
const verify = (tick,holder,fact)=>command(tick,'verify-belief',{topic,holder,fact});
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const beliefs = (run,holder)=>probe(run,'beliefs',{holder,topic});
const trace = (run,event)=>run.query().trace('world/cause',undefined,{event}).value;
const restore = saved=>R.create(saved.world,{checkpoint:structuredClone(saved)});

test('conflicting accounts retain values, confidence and provenance without granting fact knowledge',()=>{
  const world = source(), run = R.create(world);
  assert.deepEqual(R.storyPreflight(world).beliefs.topics[topic],{type:'channel-inspection',field:'data/state'});
  assert.equal(beliefs(run,niko).status,'unknown');
  run.advance(1);
  assert.equal(beliefs(run,niko).belief.value,'open');
  assert.equal(beliefs(run,niko).belief.confidence,70);
  run.advance(2);
  const conflict = beliefs(run,niko).belief, faction = beliefs(run,watch).belief;
  assert.equal(conflict.status,'contested');
  assert.equal(conflict.value,undefined);
  assert.deepEqual(conflict.accounts.map(account=>[account.value,account.confidence]),[['open',70],['closed',70]]);
  assert.equal(faction.status,'believed');
  assert.equal(faction.value,'open');
  assert.deepEqual(faction.accounts[0],{event:'2.1',origin:'1.0',source:actor('crew/ferryman'),from:niko,via:'1.0',value:'open',confidence:55});
  assert(trace(run,'2.1').nodes.some(node=>node.event==='1.0'&&node.kind==='belief-updated'));
  assert.equal(beliefs(run,actor(watch.id)).status,'unknown');
  assert.equal(probe(run,'knowledge',{holder:watch,fact:'3.0'}).status,'unknown');
  assert.equal(probe(run,'beliefs',{topic,limit:1}).matched,2);
});

test('only the disclosed field can revise beliefs and dispatch the story at the current tick',()=>{
  const answered = R.create(source()), withheld = R.create(source());
  answered.schedule(structuredClone(disclosure));
  answered.advance(3);
  assert.equal(answered.events.find(event=>event.kind==='belief-rejected').reason,'holder-lacks-evidence');
  assert.equal(probe(answered,'knowledge',{holder:watch,fact:'3.0'}).status,'partial');
  assert.equal(beliefs(answered,watch).belief.value,'open');
  assert.equal(probe(answered,'story-lifecycle')[story],null);
  const resumed = restore(answered.checkpoint());
  answered.advance(4);
  const verified = beliefs(answered,watch).belief;
  assert.equal(verified.value,'closed');
  assert.equal(verified.confidence,100);
  assert.equal(verified.status,'verified');
  assert.equal(verified.accounts[0].value,'open');
  assert.equal(verified.evidence.fact,'3.0');
  assert.equal(verified.evidence.receipt.event,'4.0');
  assert.deepEqual(verified.evidence.receipt.from,mira);
  assert.equal(beliefs(answered,niko).status,'contested');
  assert.equal(probe(answered,'story-lifecycle')[story].since,4);
  const update = answered.events.find(event=>event.kind==='belief-updated').belief;
  assert.equal(update.before.value,'open');
  assert.equal(update.after.value,'closed');
  assert(trace(answered,verified.event).nodes.some(node=>node.event==='3.0'&&node.kind==='world-fact'));
  answered.advance(5);
  withheld.advance(5);
  resumed.advance(5);
  assert.equal(probe(answered,'story-lifecycle')[story].status,'completed');
  assert.equal(beliefs(withheld,watch).status,'believed');
  assert.equal(probe(withheld,'story-lifecycle')[story],null);
  assert.deepEqual(answered.history,[]);
  assert.deepEqual(resumed.checkpoint(),answered.checkpoint());
  assert.deepEqual(R.replay(structuredClone(answered.recording())).checkpoint(),answered.checkpoint());
});

test('relays preserve the original source across hops and reject missing or inflated accounts',()=>{
  const run = R.create(source());
  run.schedule([relay(4,niko,watch,'1.0',70),relay(4,mira,lookout,'1.0'),relay(4,watch,lookout,'1.0',50),
    relay(4,niko,lookout,'1.0',60)]);
  run.advance(4);
  assert.deepEqual(run.events.map(event=>event.reason??event.kind),['source-lacks-account','belief-updated']);
  assert.deepEqual(beliefs(run,lookout).belief.accounts,[{
    event:'4.1',origin:'1.0',source:actor('crew/ferryman'),from:watch,via:'2.1',value:'open',confidence:50
  }]);
  run.schedule([relay(5,watch,niko,'1.0',56)]);
  run.advance(5);
  assert.equal(run.events[0].reason,'confidence-exceeds-source');
  assert.equal(beliefs(run,niko).belief.accounts.length,2);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('newer known facts supersede earlier evidence and remain after independent retention',()=>{
  const world = source();
  world.facts.limit = 1;
  world.knowledge = {limit:2};
  world.beliefs.accountLimit = 2;
  const run = R.create(world);
  const inspected = (tick,value,holder)=>command(tick,'fact',{
    type:'channel-inspection',at:{place:'harbor/east-channel'},data:{state:value},witnesses:[{holder}]
  });
  run.schedule([...structuredClone(disclosure),
    claim(5,watch,'wrecked',100),claim(5,watch,'restricted',99),verify(5,watch,'3.0'),
    inspected(6,'reopened',watch),verify(6,watch,'6.0'),verify(6,watch,'3.0'),
    inspected(7,'restricted',mira),inspected(8,'closed',mira)]);
  run.advance(5);
  assert.equal(beliefs(run,watch).belief.value,'closed');
  assert.deepEqual(beliefs(run,watch).belief.accounts.map(account=>account.value),['wrecked','restricted']);
  run.advance(6);
  assert.equal(run.events.filter(event=>event.kind==='belief-updated').length,1);
  assert.equal(beliefs(run,watch).belief.value,'reopened');
  run.advance(8);
  assert.equal(probe(run,'knowledge',{holder:watch,fact:'6.0'}).status,'unknown');
  assert.equal(probe(run,'facts',{id:'6.0'}).matched,0);
  assert.equal(beliefs(run,watch).belief.evidence.receipt.value,'reopened');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('topic, action and checkpoint validation protect evidence and account provenance',()=>{
  const world = source();
  delete world.knowledge;
  assert.throws(()=>R.create(world),/require world knowledge/);
  world.knowledge = true;
  world.beliefs.topics[topic].field = 'data/absent';
  assert.throws(()=>R.create(world),/Invalid world belief topic/);
  const run = R.create(source());
  assert.throws(()=>run.schedule([claim(4,niko,42,70)]),/typed value/);
  assert.throws(()=>run.schedule([claim(4,niko,'open',101)]),/integer confidence/);
  assert.throws(()=>run.schedule([command(4,'event',{kind:'belief-updated'})]),/Use world belief actions/);
  run.schedule(structuredClone(disclosure));
  run.advance(4);
  let saved = structuredClone(run.checkpoint());
  const evidence = saved.beliefState.records[1].evidence;
  evidence.receipt = {...evidence.receipt,value:'open'};
  assert.throws(()=>restore(saved),/Invalid saved belief record/);
  saved = structuredClone(run.checkpoint());
  saved.beliefState.records[1].accounts[0].source = mira;
  assert.throws(()=>restore(saved),/Invalid saved belief relay/);
  saved = structuredClone(run.checkpoint());
  saved.beliefState.records[1].accounts[0].confidence = 101;
  assert.throws(()=>restore(saved),/Invalid saved belief record/);

  const bounded = source();
  bounded.beliefs.limit = 1;
  const small = R.create(bounded);
  small.advance(2);
  assert.equal(beliefs(small,niko).status,'unknown');
  assert.equal(beliefs(small,watch).dropped,1);
  assert.deepEqual(restore(small.checkpoint()).checkpoint(),small.checkpoint());
});
