const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const {KIT:K}=require('..').load(), W=K.world, P=W.presentationCues;
const clone=value=>JSON.parse(JSON.stringify(value));
const account=initial=>({resource:'cargo',units:'crate',type:'integer',initial});
const transfer=(tick,amount)=>({tick,action:'world/transfer',args:{from:'stock/pier',to:'stock/boat',amount,mode:'exact'}});
const world={format:W.format,version:1,id:'port',dt:.25,
  systems:{stock:{kind:'store',config:{accounts:{pier:account(3),boat:account(0)}}}},
  eventActions:{caption:{on:{kind:'receipt-caption'},
    actions:[{action:'world/event',args:{kind:'presentation-fed-back'}}]}}};
const actions=[transfer(1,2),transfer(2,5)];
const plan={format:P.planFormat,version:1,id:'port-receipts',rules:{
  success:{on:{kind:'transfer',where:{path:'/payload/applied',op:'gt',value:0}},
    cue:{kind:'receipt-caption',label:'Cargo loaded',target:'lower-third',
      detail:{quantity:0},bindings:{'/quantity':'/payload/applied'}}},
  blocked:{on:{kind:'transfer',where:{path:'/payload/status',value:'blocked'}},
    cue:{kind:'receipt-caption',label:'Cargo unavailable',delay:.25,detail:{limitedBy:[]},bindings:{'/limitedBy':'/payload/limitedBy'}}}
}};
const runToEnd=timeline=>{
  const run=W.runtime.create({...world,...(timeline&&{timeline})},{recordRun:true});
  run.schedule(actions);
  run.advance(4);
  return run;
};

test('queued requests produce cues only from committed receipts, and the cues stay out of world routing',()=>{
  const run=W.runtime.create(world,{recordRun:true});
  run.schedule(actions);
  assert.equal(run.checkpoint().pending.length,2);
  assert.deepEqual(P.project(W.storyEvents.envelopes(run.checkpoint()),plan).cues,[]);
  run.advance(4);
  const recording=run.recording(), before=clone(recording), sheet=P.project(W.storyEvents.envelopes(recording),plan);
  assert.deepEqual(clone(recording),before);
  const authored=clone(plan);
  authored.rules.success.cue.detail.style={color:'blue'};
  P.project(W.storyEvents.envelopes(recording),authored);
  assert.equal(Object.isFrozen(authored.rules.success.cue.detail.style),false);
  assert.deepEqual(sheet.cues.map(row=>[row.time,row.label,row.source.id,row.source.tick]),
    [[.25,'Cargo loaded','1.0',1],[.75,'Cargo unavailable','2.0',2]]);
  assert.equal(sheet.cues[0].detail.quantity,2);
  assert.deepEqual(sheet.cues[1].detail.limitedBy,['source']);
  assert.equal(sheet.cues[1].source.kind,'transfer');
  const presented=runToEnd({presentationCues:clone(sheet)});
  assert.deepEqual(presented.history,run.history);
  assert.deepEqual(presented.recording().evidence.actions,recording.evidence.actions);
  assert.deepEqual(presented.checkpoint().states,run.checkpoint().states);
  assert.equal(presented.checkpoint().eventActionCounts.caption,undefined);
  assert.deepEqual(presented.timeline.events,[]);
  assert.deepEqual(presented.timeline.presentationCues.map(row=>row.type),['presentation','presentation']);
  assert.equal(presented.timeline.between(.25,.75)[0].label,'Cargo unavailable');
  assert.equal(W.runtime.verify(clone(presented.recording())).status,'verified');
  assert.throws(()=>presented.schedule(sheet.cues),/Invalid scheduled command/);
  assert.throws(()=>K.timeline.compile({events:sheet.cues}),/Invalid timeline world event/);
});

test('retiming a cue in an exact nested sequence preserves its source receipt',()=>{
  const run=runToEnd(), sheet=P.project(W.storyEvents.envelopes(run.recording()),plan);
  const timeline=K.timeline.compile({
    sequences:{receipt:{duration:1,presentationCues:sheet}},
    clips:[{id:'cut',sequence:'receipt',time:1,in:.5,out:1,duration:1}]
  },{exact:true});
  const [cue]=timeline.presentationCues;
  assert.equal(cue.time,1.5);
  assert.deepEqual(cue.path,['cut']);
  assert.equal(cue.source.tick,2);
  const take=K.timeDomains.take({simulationRate:4,fps:4});
  assert.deepEqual(timeline.forTake(take.at(6)).cues.map(row=>[row.type,row.source.id]),[['presentation','2.0']]);
  const native=W.runtime.create({...world,dt:1/60});
  native.schedule(actions);
  native.advance(2);
  const exact=P.project(W.storyEvents.envelopes(native.checkpoint()),plan);
  assert.deepEqual(exact.cues[0].timecode,{numerator:1,denominator:60});
  const rated=K.timeline.compile({presentationCues:exact},{exact:true});
  const fastTake=K.timeDomains.take({simulationRate:60,fps:60});
  assert.equal(rated.forTake(fastTake.at(0)).cues.length,0);
  assert.equal(rated.forTake(fastTake.at(1)).cues[0].source.tick,1);
  const bad=clone(plan);
  bad.rules.success.cue.bindings['/quantity']='/payload/missing';
  assert.throws(()=>P.project(W.storyEvents.envelopes(run.recording()),bad),/needs event value payload\/missing/);
});

test('CLI projects the same cues from a recording and its exported envelopes',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-presentation-cues-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const save=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value));
  const story=(...args)=>spawnSync(process.execPath,[cli,'story',...args],{cwd:directory,encoding:'utf8'});
  save('source.run.json',runToEnd().recording());
  save('plan.json',plan);
  const fromRun=story('cues','source.run.json','plan.json');
  assert.equal(fromRun.status,0,fromRun.stderr);
  const exported=story('events','source.run.json','--format','envelopes','--out','facts.json');
  assert.equal(exported.status,0,exported.stderr);
  const fromFacts=story('cues','facts.json','plan.json','--format','timeline');
  assert.equal(fromFacts.status,0,fromFacts.stderr);
  assert.deepEqual(JSON.parse(fromFacts.stdout),{presentationCues:JSON.parse(fromRun.stdout)});
  const conflict=story('cues','facts.json','plan.json','--out','plan.json');
  assert.equal(conflict.status,1);
  assert.match(conflict.stderr,/different from its input files/);
});
