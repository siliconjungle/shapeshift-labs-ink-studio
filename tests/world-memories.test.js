const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/river-memories.world.json';
const rescue = require('../examples/story-documents/river-memories.rescue.actions.json');
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const wardens = {kind:'faction',id:'river-wardens'}, ilya = {kind:'actor',id:'crew/ilya'};
const contract = 'river-memories/crossing-contract';
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const relation = (run,holder=wardens,counterpart=ilya)=>probe(run,'relationship',{holder,with:counterpart});
const memories = (run,args)=>probe(run,'memories',args);
const remember = (tick,type,args)=>({tick,action:'world/remember',args:{type,holder:wardens,...args}});
const clone = value=>JSON.parse(JSON.stringify(value));
const restore = saved=>R.create(saved.world,{checkpoint:clone(saved)});

test('native story outcomes become durable memories and decaying trust releases a blocked candidate',()=>{
  const run = R.create(world()), alternate = R.create(world());
  run.schedule(rescue);
  run.advance(2);
  assert.equal(relation(run).scores.trust,-40);
  const resumed = restore(run.checkpoint());
  run.advance(3);
  assert.equal(relation(run).scores.trust,-5);
  assert.deepEqual(relation(run).contributors.map(row=>row.effects.trust),[-35,30]);
  assert.equal(relation(run,ilya,wardens).status,'unknown');
  assert.equal(relation(run,{...wardens,kind:'actor'}).scores.trust,0);
  const formative = memories(run,{holder:wardens,about:ilya,type:'river-rescue'}).records[0];
  assert.deepEqual(formative.data,{document:'river-memories',story:'rescue',outcome:'crew-safe'});
  assert.equal(formative.durable,true);
  assert.equal(formative.strength,100);
  const trace = run.query().trace('world/cause',undefined,{event:formative.id}).value;
  assert(trace.nodes.some(row=>row.event===formative.source&&row.kind==='story-transition'));
  assert.equal(probe(run,'story-lifecycle')[contract],null);
  run.advance(5);
  assert.equal(relation(run).scores.trust,5);
  assert.equal(probe(run,'story-lifecycle')[contract],null);
  run.advance(6);
  assert.equal(relation(run).scores.trust,10);
  assert.equal(probe(run,'story-lifecycle')[contract].since,6);
  run.advance(13);
  resumed.advance(13);
  alternate.advance(13);
  assert.equal(probe(run,'story-lifecycle')[contract].outcome,'hired');
  assert.equal(probe(alternate,'story-lifecycle')[contract],null);
  assert.equal(relation(run).scores.trust,30);
  assert.equal(relation(alternate).status,'unknown');
  assert.equal(relation(alternate).scores.trust,0);
  assert.deepEqual(run.history,[]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('expiry is inclusive and ordinary overflow preserves durable memories independently',()=>{
  const run = R.create(world());
  run.schedule(rescue);
  run.advance(9);
  assert.equal(relation(run).scores.trust,25);
  const fading = memories(run,{type:'missed-signal'}).records[0];
  assert.equal(fading.expires,10);
  assert.equal(fading.strength,13);
  run.advance(10);
  assert.equal(relation(run).scores.trust,30);
  assert.equal(memories(run,{id:fading.id}).matched,0);
  assert.equal(memories(run).expired,1);
  assert.equal(memories(run).evicted,0);
  run.advance(13);
  const snapshot = memories(run);
  assert.deepEqual(snapshot.records.map(row=>row.type),['river-rescue','supply-log','supply-log']);
  assert.deepEqual(snapshot.records.slice(1).map(row=>row.data.bundles),[5,7]);
  assert.equal(snapshot.evicted,1);
  assert.equal(snapshot.expired,1);
  assert.equal(memories(run,{limit:0}).matched,3);
  run.advance(5000);
  assert.equal(memories(run).expired,3);
  assert.equal(memories(run).matched,1);
  assert.equal(relation(run).scores.trust,30);
});

test('repeated sources, future references and full durable storage leave established memories intact',()=>{
  const authored = world();
  authored.memories.durableLimit = 1;
  const run = R.create(authored), data = {document:'river-memories',story:'rescue',outcome:'crew-safe'};
  run.schedule(rescue);
  run.advance(3);
  const rescueMemory = memories(run,{type:'river-rescue'}).records[0];
  run.schedule([
    remember(4,'river-rescue',{about:ilya,data,source:rescueMemory.source}),
    remember(4,'river-rescue',{about:ilya,data}),
    remember(4,'missed-signal',{about:ilya,source:'9.0'}),
    remember(4,'missed-signal',{about:ilya,source:'1.0'}),
    remember(4,'missed-signal',{holder:ilya,about:wardens,source:'1.0'})
  ]);
  run.advance(4);
  assert.deepEqual(run.events.map(event=>event.reason??event.kind),['durable-capacity','source-not-earlier','memory-recorded']);
  assert.deepEqual(memories(run,{type:'river-rescue'}).records,[rescueMemory]);
  assert.equal(relation(run,ilya,wardens).scores.trust,-40);
  assert.equal(relation(run).scores.trust,0);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('memory schema, owned event kinds and checkpoint retention are validated',()=>{
  const conflicting = world();
  conflicting.memories.types['river-rescue'].decayTicks = 1;
  assert.throws(()=>R.create(conflicting),/Invalid memory decay/);
  const run = R.create(world());
  assert.throws(()=>run.schedule([remember(1,'missed-signal',{})]),/need a subject/);
  assert.throws(()=>run.schedule([remember(1,'supply-log',{data:{bundles:'three'}})]),/Invalid memory data/);
  assert.throws(()=>run.schedule([{tick:1,action:'world/event',args:{kind:'memory-recorded'}}]),/Use world\/remember/);
  run.schedule(rescue);
  run.advance(3);
  let saved = clone(run.checkpoint());
  const oldMemory = saved.memoryState.fading[0];
  saved.memoryState.durable[0].data.outcome = 'different';
  assert.throws(()=>restore(saved),/Invalid saved world memory/);
  saved = clone(run.checkpoint());
  saved.memoryState.nextExpiry++;
  assert.throws(()=>restore(saved),/Invalid saved memory expiry/);
  saved = clone(run.checkpoint());
  delete saved.memoryState;
  assert.throws(()=>restore(saved),/Invalid saved world memory ledger/);
  run.advance(10);
  saved = clone(run.checkpoint());
  saved.memoryState.fading.push(oldMemory);
  assert.throws(()=>restore(saved),/Invalid saved world memory/);
});
