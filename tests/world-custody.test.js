const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/survey-seal.world.json';
const recovery = require('../examples/story-documents/survey-seal.recovery.actions.json');
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const object = 'archive/survey-seal', spare = 'archive/wax-die', story = 'survey-seal/open-vault';
const surveyor = {kind:'actor',id:'crew/surveyor'}, chest = {kind:'container',id:'barge/chest'};
const diver = {kind:'actor',id:'crew/diver'}, archive = {kind:'faction',id:'river-archive'};
const clone = value=>JSON.parse(JSON.stringify(value));
const restore = saved=>R.create(saved.world,{checkpoint:clone(saved)});
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const custody = (run,id=object)=>probe(run,'custody',{object:id});
const trace = (run,args={})=>run.query().trace('world/custody',undefined,{object,...args}).value;
const command = (tick,name,args)=>({tick,action:'world/'+name,args:{object,...args}});
const event = (tick,kind)=>({tick,action:'world/event',args:{kind}});
const place = {place:'river/ruin'};

test('the same object survives discovery, transfer, loss, recovery, and inherited custody',()=>{
  const authored = world(), run = R.create(authored), lost = R.create(authored);
  assert.equal(R.storyPreflight(authored).custody.objects[object].entity,'seal');
  assert.equal(custody(run).status,'undiscovered');
  run.schedule(recovery);
  run.advance(2);
  assert.deepEqual(custody(run).holder,surveyor);
  assert.deepEqual(trace(run).origin.source,{id:'1.0',tick:1,kind:'world-fact',system:'world'});
  run.advance(3);
  assert.deepEqual(custody(run).holder,chest);
  assert.equal(probe(run,'custody',{holder:chest}).matched,1);
  run.advance(4);
  const missing = custody(run);
  assert.equal(missing.status,'lost');
  assert.equal(missing.holder,undefined);
  assert.deepEqual(missing.lastKnown,{event:'4.0',at:{place:'river/eddy'}});
  const resumed = restore(run.checkpoint());
  run.advance(6);
  assert.deepEqual(custody(run).holder,diver);
  run.advance(8);
  assert.deepEqual(custody(run).holder,archive);
  assert.equal(probe(run,'story-lifecycle')[story].since,8);
  const lineage = trace(run);
  assert.equal(lineage.status,'complete');
  assert.deepEqual(lineage.steps.map(step=>step.operation),['transfer','lose','recover','inherit']);
  assert.deepEqual(lineage.steps.map(step=>step.previous),['2.0','3.0','4.0','6.0']);
  assert.deepEqual(lineage.steps.at(-1).source,{id:'7.0',tick:7,kind:'agent-despawned',system:'crew'});
  const causes = run.query().trace('world/cause',undefined,{event:lineage.latest}).value;
  assert(causes.nodes.some(node=>node.event==='7.0'&&node.kind==='agent-despawned'));
  assert(causes.nodes.some(node=>node.event==='6.0'&&node.kind==='custody-changed'));
  run.advance(9);
  resumed.advance(9);
  lost.advance(8);
  assert.equal(lost.events.find(row=>row.kind==='custody-rejected').reason,'object-lost');
  assert.equal(custody(lost).status,'lost');
  assert.equal(probe(lost,'story-lifecycle')[story],null);
  assert.equal(probe(run,'story-lifecycle')[story].outcome,'vault-open');
  assert.equal(probe(run,'memories',{type:'seal-returned'}).records[0].source,'8.0');
  assert.equal(custody(run,spare).status,'undiscovered');
  assert.deepEqual(run.history,[]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('stale moves, mismatched holders, repeated discoveries and premature recovery are rejected without minting custody',()=>{
  const run = R.create({custody:{objects:{[object]:{}}}});
  run.schedule([
    command(1,'transfer-object',{from:surveyor,to:chest}),
    command(1,'discover-object',{to:surveyor,at:place}),
    command(1,'discover-object',{to:diver,at:place}),
    command(2,'recover-object',{to:diver,at:place}),
    command(2,'transfer-object',{from:diver,to:chest}),
    command(2,'transfer-object',{from:surveyor,to:chest,previous:'1.1'}),
    command(2,'lose-object',{from:chest,previous:'1.1'}),
    command(2,'lose-object',{from:chest}),
    command(2,'inherit-object',{from:chest,to:archive})
  ]);
  run.advance(1);
  assert.deepEqual(run.events.map(row=>row.reason??row.kind),['not-discovered','custody-changed','already-discovered']);
  run.advance(2);
  assert.deepEqual(run.events.map(row=>row.reason??row.kind),
    ['not-lost','holder-mismatch','custody-changed','stale-custody','custody-changed','object-lost']);
  assert.equal(custody(run).status,'lost');
  assert.equal(trace(run).steps.length,2);
});

test('source references require earlier retained events and their copies survive source eviction',()=>{
  const authored = {history:{enabled:false},custody:{objects:{[object]:{}}}};
  const run = R.create(authored);
  run.schedule([event(1,'found'),command(3,'discover-object',{to:diver,at:place,source:'1.0'}),
    event(3,'spotted'),command(3,'discover-object',{to:diver,at:place,source:'3.1'}),
    command(4,'inherit-object',{from:diver,to:archive,source:'5.0'}),
    command(4,'inherit-object',{from:diver,to:archive,source:'3.1'})]);
  run.advance(3);
  assert.equal(run.events[0].reason,'source-unavailable');
  assert.deepEqual(trace(run).origin.source,{id:'3.1',tick:3,kind:'spotted',system:'world'});
  run.advance(4);
  assert.equal(run.events[0].reason,'source-unavailable');
  assert.deepEqual(trace(run).steps[0].source,trace(run).origin.source);
  run.advance(10);
  assert.equal(trace(run).steps[0].source.kind,'spotted');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('history trimming preserves the origin, actual last known place, and an explicit gap',()=>{
  const run = R.create({custody:{objects:{[object]:{}},historyLimit:1}});
  run.schedule([
    command(1,'discover-object',{to:surveyor,at:place}),
    command(2,'transfer-object',{from:surveyor,to:chest,at:{place:'river/barge'}}),
    command(2,'transfer-object',{from:chest,to:diver}),
    command(2,'lose-object',{from:diver})
  ]);
  run.advance(2);
  const chain = trace(run);
  assert.equal(chain.origin.id,'1.0');
  assert.equal(chain.status,'partial');
  assert.equal(chain.dropped,2);
  assert.equal(chain.steps[0].previous,'2.1');
  assert.deepEqual(custody(run).lastKnown,{event:'2.0',at:{place:'river/barge'}});
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('catalog, reserved events, checkpoint links and trace limits are validated',()=>{
  const run = R.create(world());
  assert.throws(()=>run.schedule([command(1,'discover-object',{object:'undeclared',to:surveyor,at:place})]),/Invalid discover-object/);
  assert.throws(()=>run.schedule([command(1,'transfer-object',{from:chest,to:chest})]),/Invalid transfer-object/);
  assert.throws(()=>run.schedule([command(1,'recover-object',{to:chest})]),/Invalid recover-object/);
  assert.throws(()=>run.schedule([event(1,'custody-changed')]),/Use world custody actions/);
  run.schedule(recovery);
  run.advance(9);
  assert.equal(trace(run,{limit:2}).omitted,2);
  assert.equal(trace(run,{limit:2}).status,'partial');
  let saved = clone(run.checkpoint());
  saved.custodyState.records[object].changes[0].previous = '1.0';
  assert.throws(()=>restore(saved),/Invalid saved object custody/);
  saved = clone(run.checkpoint());
  saved.custodyState.records[object].lastKnown.at.place = 'elsewhere';
  assert.throws(()=>restore(saved),/Invalid saved object custody/);
  saved = clone(run.checkpoint());
  saved.custodyState.records[object].changes.at(-1).source.id = '9.0';
  assert.throws(()=>restore(saved),/Invalid saved object custody/);
});
