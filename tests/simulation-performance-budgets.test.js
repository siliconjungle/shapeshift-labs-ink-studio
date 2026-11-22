const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const kit=require('..').load(),K=kit.KIT,W=K.world,B=W.performanceBudgets;
const prepared=require('../examples/simulation-prepared/vent.model.json');
const voice=require('../examples/simulation-fast-checkpoints/voice.model.json');
const plan=cases=>({format:B.format,version:1,id:'benchmark',cases});
const fakeClock=()=>{let now=0;return ()=>++now/100;};

test('measures host step tail latency and counts misses carried from a slow step',()=>{
  W.runtime.register('budget-test-source',()=>({initial:()=>0,step:state=>state+1,outputs:{pulse:'event'},
    output:tick=>({pulse:tick?[{kind:'pulse',tick}]:[]}),estimate:()=>({workPerStep:{pulses:1},workspaceBytes:16})}));
  W.runtime.register('budget-test-sink',()=>({initial:()=>0,inputs:{notes:'event'},step:(state,ctx)=>state+ctx.input.notes.length}));
  const world={format:W.format,version:1,id:'scheduled',dt:.01,
    systems:{producer:{kind:'budget-test-source'},sink:{kind:'budget-test-sink',schedule:{every:3}}},
    connections:[{from:'producer/pulse',to:'sink/notes',sample:'events'}],
    commands:[{tick:3,action:'world/event',args:{kind:'marker'}}]};
  const values=[0,17,30,34,40,52,60,62];
  let rss=98;
  const {cases:{host},passed}=B.run(plan({host:{mode:'world',source:'host',steps:4,detail:true,
    limits:{maxStepMs:18,maxMissedDeadlines:2,maxPendingCommands:1}}}),{resolve:()=>world,now:()=>values.shift(),
    memory:()=>({rss:++rss,heapUsed:17})});
  assert.equal(passed,false);
  assert.equal(host.completedSteps,4);
  assert.equal(host.steps.p95Ms,17);
  assert.equal(host.steps.p50Ms,4);
  assert.equal(host.steps.deadlines.operationOverruns,2);
  assert.equal(host.steps.deadlines.missed,3);
  assert.equal(host.steps.deadlines.firstMiss.tick,1);
  assert.equal(host.steps.deadlines.peakDebtMs,7);
  assert.deepEqual(host.steps.rows.map(row=>row.latenessMs),[7,1,3,0]);
  assert.equal(host.queues.queues['events/sink/notes'].capacity,W.rates.maxEvents);
  assert.ok(host.queues.queues['events/sink/notes'].peak>=2);
  assert.equal(host.queues.queues.commands.peak,1);
  assert.equal(host.queues.queues.commands.pending,0);
  assert.equal(host.memory.host.sampledPeak.rss,100);
  assert.equal(host.systems.producer.maxCallsPerTick,1);
  assert.equal(host.work.planned.maxSolverVisitsPerTick,2);
  assert.equal(host.work.declared.producer.boundPerTick.pulses,1);
  assert.equal(host.memory.declaredWorkspaceBytes,16);
});

test('measures actual partitioned blocks, worst prepared work and preallocated memory',()=>{
  require('../examples/simulation-prepared/vent-network.js')(K);
  const {cases:{play}}=B.run(plan({play:{mode:'blocks',source:'vent',samples:288,requests:[128],
    detail:true,limits:{maxMissedDeadlines:0,maxPreparedBytes:1496,maxWorkPerBlock:1152}}}),
    {resolve:()=>prepared,now:fakeClock()});
  assert.equal(play.passed,true);
  assert.equal(play.requests.count,3);
  assert.deepEqual(play.requests.rows.map(row=>row.requestedSamples),[128,128,32]);
  assert.deepEqual(play.blocks.rows.map(row=>row.samples),[96,32,96,32,32]);
  assert.equal(play.blocks.completed,5);
  assert.equal(play.completedSamples,288);
  assert.equal(play.memory.typedStateBytes,48);
  assert.equal(play.memory.preparedAllocatedBytes,1496);
  assert.equal(play.work.largestBlockSamples,96);
  assert.equal(play.work.observedPeakPreparedUnits,1152);
  assert.equal(play.native.kernels.kernel.workBound.baseUnitsAtEffectiveBlock,1152);
  assert.equal(play.native.kernels.kernel.observed.timedBlocks,5);
});

test('a full unread queue reports attempted depth and keeps the committed cursor',()=>{
  require('../examples/simulation-fast-checkpoints/ink-studio.config.js').register(kit);
  const shared={mode:'blocks',path:'offline',source:'voice',samples:1800,requests:[400],detail:true};
  const {cases:{held,drained}}=B.run(plan({
    held:{...shared,events:{capacity:1,drainEvery:0}},
    drained:{...shared,events:{capacity:1,drainEvery:1}}
  }),{resolve:()=>voice,now:fakeClock()});
  assert.equal(held.passed,false);
  assert.equal(held.completedSamples,1200);
  assert.equal(held.fault.atSample,1200);
  assert.match(held.fault.message,/queue is full/);
  assert.equal(held.blocks.rows.at(-1).status,'event-capacity');
  assert.deepEqual(held.queues.queues.notes,{pending:1,capacity:1,unit:'events',peak:1,attemptedPeak:2,overflows:1});
  assert.equal(held.queues.overflows,1);
  assert.equal(drained.passed,true);
  assert.equal(drained.completedSamples,1800);
  assert.equal(drained.queues.drainedEvents,2);
  assert.equal(drained.queues.queues.notes.pending,0);
  assert.equal(drained.native.nativeMisses,null);
});

test('CLI saves a measured report before returning a failed budget exit code',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-budget-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const file=name=>path.join(temp,name), save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const world={format:W.format,version:1,id:'minimal',dt:.02};
  save('world.json',world);
  const invoke=(limits,out='report.json')=>{
    save('bench.json',plan({world:{mode:'world',source:'world.json',steps:3,limits}}));
    return spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','budget',
      file('bench.json'),'--out',file(out),'--require-budget'],{cwd:temp,encoding:'utf8'});
  };
  const good=invoke({maxPendingCommands:0});
  assert.equal(good.status,0,good.stderr);
  assert.equal(invoke({maxStepMs:0}).status,2);
  const report=JSON.parse(fs.readFileSync(file('report.json'),'utf8')),limit=report.cases.world.limits.maxStepMs;
  assert.equal(report.host.clock,'performance.now');
  assert.equal(report.passed,false);
  assert.ok(limit.actual>0);
  assert.ok(report.cases.world.memory.host.sampledPeak.rss>0);
  const denied=invoke({},'world.json');
  assert.equal(denied.status,1,denied.stderr);
  assert.match(denied.stderr,/separate from its source assets/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('world.json'),'utf8')),world);
});

const delivery={tick:5,action:'world/transfer',args:{from:'stock/input',to:'stock/output',amount:1}};
const control={format:W.format,version:1,id:'stockroom',seed:12,dt:.1,history:{limit:2},
  systems:{stock:{kind:'store',config:{accounts:{
    input:{resource:'seed',units:'bag',type:'integer',initial:1},
    output:{resource:'seed',units:'bag',type:'integer',initial:0}
  }}}},commands:[delivery]};
const storyDoc={format:'ink-studio/story',version:1,id:'repairs',title:'Repairs',stories:{
  request:{kind:'incident',title:'Repair request',incident:{category:'opportunity',intensity:1},
    triggers:{notice:{event:{kind:'notice'}}},
    lifecycle:{progression:true,candidate:{for:.2,release:'manual'},deadlines:{world:{at:.4}}},
    entry:'offer',stages:{offer:{title:'Offer assistance',next:{accept:{outcome:'accepted'}}}},
    outcomes:{accepted:{title:'Offer accepted'}}}
}};
const storyWorld={...control,storyDocuments:[storyDoc],
  commands:[{tick:1,action:'world/event',args:{kind:'notice'}},delivery]};
const outputProbe={field:'world/account',args:{account:'stock/output'},select:'/balance'};

test('keeps exact queue and retention peaks and separate deadline receipts between samples',()=>{
  const spec={mode:'world',source:'story',steps:7,stories:{sampleEvery:5},detail:true,limits:{
    maxPendingStoryCandidates:1,maxRetainedHistoryEvents:2,maxStoryDeadlineMisses:1,
    maxCandidateExpirations:1,maxStoryEvaluationMs:.04
  }};
  const {cases:{world}}=B.run(plan({world:spec}),{resolve:()=>storyWorld,now:fakeClock()});
  assert.equal(world.passed,true);
  const {stories}=world;
  assert.deepEqual(stories.samples.map(row=>row.tick),[0,5,7]);
  assert.deepEqual(stories.queues.candidates,{initial:0,ending:0,peak:1,peakAt:1,netGrowth:0});
  assert.equal(stories.retention.worldEvents.ending,2);
  assert.ok(stories.retention.dropped.worldEvents>0);
  assert.equal(stories.retention.storyRecords.ending,2);
  assert.equal(stories.deadlines.candidates.first.tick,3);
  assert.deepEqual(stories.deadlines.candidates.byReason,{'candidate-timeout':1});
  assert.deepEqual(stories.deadlines.stories.first,{story:'repairs/request',tick:4,
    reason:'world-deadline',deadline:{clock:'world',dueTick:4}});
  assert.equal(world.steps.deadlines.missed,0);
  assert.deepEqual(Object.entries(stories.evaluation.phases).map(([name,row])=>[name,row.calls]),
    [['triggers',7],['scheduler',7],['lifecycle',7]]);
  assert.equal(stories.evaluation.rows.length,7);
  assert.ok(Math.abs(stories.evaluation.maxMs-.03)<1e-9);
});

test('paired world runs report lost output even with identical solver call counts',()=>{
  const story={...storyWorld,commands:storyWorld.commands.slice(0,1)};
  const spec={mode:'world',source:'story',steps:7,stories:{baseline:'control',sampleEvery:3,
    systems:['stock'],probes:{output:outputProbe}},limits:{maxUnrelatedCallLoss:0,maxUnrelatedChangedProbes:0}};
  const compare=(primary,probe=outputProbe,baseline=control)=>B.run(plan({world:{
    ...spec,stories:{...spec.stories,probes:{output:probe}}
  }}),{resolve:file=>file==='story'?primary:baseline,now:fakeClock()}).cases.world;
  assert.equal(compare(storyWorld).passed,true);
  const world=compare(story), unrelated=world.stories.unrelated, {output}=unrelated.probes;
  assert.equal(world.passed,false);
  assert.deepEqual(world.limits.maxUnrelatedCallLoss,{max:0,actual:0,available:true,passed:true});
  assert.equal(unrelated.systems.stock.primary.calls,7);
  assert.equal(unrelated.baseline.completedSteps,7);
  assert.equal(unrelated.changedProbes,1);
  assert.equal(output.samples,4);
  assert.equal(output.firstDifference.tick,6);
  assert.equal(output.ending.delta,-1);
  assert.equal(compare(story,{...outputProbe,tolerance:1}).passed,true);
  const missing=compare(story,{...outputProbe,select:'/bad'});
  assert.equal(missing.limits.maxUnrelatedChangedProbes.available,false);
  assert.equal(missing.passed,false);
  assert.throws(()=>compare(story,outputProbe,{...control,seed:13}),/same seed and timestep/);
});

test('a fault in the baseline is reported with its attempted tick and leaves comparison gates unavailable',()=>{
  W.runtime.register('budget-test-fault',()=>({initial:()=>0,step:(state,ctx)=>{
    if(ctx.tick===2)throw new Error('Bench fault');
    return state+1;
  }}));
  const baseline={...control,systems:{...control.systems,fault:{kind:'budget-test-fault'}}};
  const spec={mode:'world',source:'story',steps:5,stories:{baseline:'control',systems:['stock']},
    limits:{maxUnrelatedCallLoss:0}};
  const {cases:{world}}=B.run(plan({world:spec}),{resolve:file=>file==='story'?storyWorld:baseline,now:fakeClock()});
  assert.equal(world.passed,false);
  assert.equal(world.fault.scope,'baseline');
  assert.equal(world.fault.tick,2);
  assert.match(world.fault.message,/Bench fault/);
  assert.equal(world.completedSteps,2);
  assert.equal(world.stories.unrelated.baseline.completedSteps,1);
  assert.equal(world.stories.unrelated.status,'incomplete');
  assert.equal(world.limits.maxUnrelatedCallLoss.available,false);
});

test('CLI includes linked story documents as protected budget inputs',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-budget-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const file=name=>path.join(temp,name), save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  save('story.json',storyDoc);
  save('world.json',{...storyWorld,storyDocuments:[{file:'story.json'}]});
  save('plan.json',plan({world:{mode:'world',source:'world.json',steps:5,stories:{},
    limits:{maxStoryDeadlineMisses:0}}}));
  const invoke=out=>spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','budget',
    file('plan.json'),'--out',file(out),'--require-budget'],{cwd:temp,encoding:'utf8'});
  const result=invoke('report.json');
  assert.equal(result.status,2,result.stderr);
  const {cases:{world}}=JSON.parse(fs.readFileSync(file('report.json'),'utf8'));
  assert.equal(world.limits.maxStoryDeadlineMisses.actual,1);
  assert.equal(world.limits.maxStoryDeadlineMisses.passed,false);
  const collision=invoke('story.json');
  assert.equal(collision.status,1,collision.stderr);
  assert.match(collision.stderr,/separate from its source assets/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('story.json'),'utf8')),storyDoc);
});
