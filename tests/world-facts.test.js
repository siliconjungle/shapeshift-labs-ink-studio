const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const W = load().KIT.world;
const R = W.runtime;
const file = '../examples/story-documents/pier-facts.world.json';
const full = require('../examples/story-documents/pier-facts.full.actions.json');
const partial = require('../examples/story-documents/pier-facts.partial.actions.json');
const copy = value=>JSON.parse(JSON.stringify(value));
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const factList = (run,args)=>run.query().probe('world/facts',undefined,args).value;
const lineage = (run,id,options={})=>run.query().trace('world/fact-causes',undefined,{id,...options}).value;
const causal = (run,event)=>run.query().trace('world/cause',undefined,{event}).value;
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const story = 'pier-facts/open-watch';
const action = (tick,type,causes=[])=>({tick,action:'world/fact',args:{type,at:{place:'harbor/pier'},causes}});

test('native event routing publishes typed facts with place, subjects, clock and verified earlier receipts',()=>{
  const world = source(), run = R.create(world);
  assert.deepEqual(R.storyPreflight(world).facts.types['delivery-confirmed'].fields,{crates:'integer'});
  run.schedule(copy(full));
  run.advance(2);
  const delivery = factList(run,{type:'delivery-confirmed',role:'courier',subject:'crew/mira',place:'harbor/pier'}).facts[0];
  assert.deepEqual(delivery,{
    id:'2.0',tick:2,time:0.2,type:'delivery-confirmed',
    at:{entity:'south-pier',place:'harbor/pier',point:[-1,0.2,4]},
    subjects:{courier:{kind:'character',id:'crew/mira'},recipient:{kind:'place',id:'harbor/pier'}},
    data:{crates:2},causes:[{id:'1.0',tick:1,system:'world',kind:'transfer',causal:delivery.causes[0].causal}]
  });
  assert.deepEqual(run.history,[]);
  assert.equal(run.checkpoint().incidentCandidateState[story].terminal.tick,2);
  assert.equal(run.checkpoint().storyFeasibilityState[story].report.checks['known-courier'].actual.value,1);
  const checkpoint = run.checkpoint(), resumed = restore(checkpoint);
  run.advance(6);
  resumed.advance(6);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  const approval = factList(run,{type:'watch-approved'}).facts[0];
  const objective = run.checkpoint().storyLifecycleState[story].flow.route[0].objectives.approval;
  assert.equal(objective.receipt.event.fact.id,approval.id);
  const trace = lineage(run,approval.id);
  assert.equal(trace.status,'complete');
  assert.deepEqual(trace.edges,[{effect:'3.0',cause:'2.0'},{effect:'2.0',cause:'1.0'}]);
  assert.deepEqual(trace.nodes.map(row=>row.factType??row.kind),['watch-approved','delivery-confirmed','transfer']);
  assert(causal(run,approval.id).nodes.some(row=>row.event==='1.0'&&row.kind==='transfer'));
  assert.deepEqual(lineage(run,approval.id,{maxDepth:0}).gaps,[{id:'2.0',reason:'depth'}]);
  assert.equal(factList(run,{role:'recipient',subject:'crew/mira'}).matched,0);
  assert.equal(factList(run,{before:2,where:{path:'/data/crates',value:2}}).matched,1);
});

test('a partial delivery remains a typed occurrence while the story waits for full evidence',()=>{
  const run = R.create(source());
  run.schedule(copy(partial));
  run.advance(6);
  assert.deepEqual(factList(run).facts.map(row=>[row.type,row.data]),[['delivery-confirmed',{crates:1}]]);
  assert.equal(run.checkpoint().storyLifecycleState[story],null);
  assert.equal(run.checkpoint().storyTriggerState[story].start,null);
  assert.deepEqual(lineage(run,'2.0').edges,[{effect:'2.0',cause:'1.0'}]);
});

test('fact eviction retains the direct earlier event and reports the unavailable lineage',()=>{
  const world = source();
  world.facts.limit = 1;
  const run = R.create(world);
  run.schedule(copy(full));
  run.advance(6);
  assert.equal(factList(run).dropped,1);
  assert.deepEqual(factList(run).facts.map(row=>row.type),['watch-approved']);
  const report = lineage(run,'3.0');
  assert.equal(report.status,'partial');
  assert.deepEqual(report.edges,[{effect:'3.0',cause:'2.0'}]);
  assert.deepEqual(report.gaps,[{id:'2.0',reason:'fact-retention'}]);
  assert.equal(report.nodes[1].factType,'delivery-confirmed');
  assert.equal(causal(run,'3.0').status,'complete');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('same-tick links and retained fact IDs work independently of raw receipt retention',()=>{
  const world = {causality:true,facts:{limit:4,eventLimit:1,types:{notice:{}}},commands:[
    {tick:1,action:'world/event',args:{kind:'signal'}},
    action(1,'notice',['1.0']),
    {tick:2,action:'world/event',args:{kind:'intervening-event'}},
    action(3,'notice',['1.1'])
  ]};
  const run = R.create(world);
  run.advance(3);
  assert.deepEqual(lineage(run,'3.0').edges,[{effect:'3.0',cause:'1.1'},{effect:'1.1',cause:'1.0'}]);
  assert(causal(run,'3.0').nodes.some(row=>row.event==='1.0'&&row.kind==='signal'));
  assert.equal(factList(run).eventReceiptsDropped,3);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  const bad = copy(run.checkpoint());
  bad.worldFactState.records[1].causes[0].id = '3.0';
  bad.worldFactState.records[1].causes[0].tick = 3;
  assert.throws(()=>restore(bad),/Invalid saved world fact or earlier event link/);
});

test('fact schemas reject invalid values, spoofed envelopes and unknown or forward event references',()=>{
  const base = {facts:{types:{count:{subjects:{courier:'person'},fields:{total:'integer'}},notice:{}}}};
  const wrong = {tick:1,action:'world/fact',args:{type:'count',at:{point:[1,2,3]},
    subjects:{courier:'crew/mira'},data:{total:1.5}}};
  assert.throws(()=>R.create({...base,commands:[wrong]}),/Invalid data for world fact count/);
  wrong.args.data.total = 2;
  wrong.args.subjects = {recipient:'crew/mira'};
  assert.throws(()=>R.create({...base,commands:[wrong]}),/Invalid subjects for world fact count/);
  const spoof = {tick:1,action:'world/event',args:{kind:'world-fact',fact:{type:'notice'}}};
  assert.throws(()=>R.create({...base,commands:[spoof]}),/Use world\/fact/);
  const legacy = R.create({commands:[spoof]});
  legacy.advance(1);
  assert.equal(legacy.checkpoint().worldFactState,undefined);
  for (const cause of ['1.0','1.9','2.0']) {
    const run = R.create({...base,commands:[action(1,'notice',[cause])]});
    const before = run.checkpoint();
    assert.throws(()=>run.advance(1),/needs a retained earlier event/);
    assert.deepEqual(run.checkpoint(),before);
  }
});
