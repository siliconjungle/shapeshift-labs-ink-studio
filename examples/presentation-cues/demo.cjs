const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/out/presentation-cues');
fs.mkdirSync(out,{recursive:true});
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
function run(...args) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
const plan=(id,rules)=>({format:'ink-studio/presentation-cue-plan',version:1,id,rules});
const account=initial=>({resource:'cargo',units:'crate',type:'integer',initial});
const world={format:'ink-studio/world',version:1,id:'receipt-dock',dt:.25,
  systems:{stock:{kind:'store',config:{accounts:{pier:account(3),boat:account(0)}}}},
  eventActions:{feedback:{on:{kind:'receipt-caption'},
    actions:[{action:'world/event',args:{kind:'unexpected-cue-feedback'}}]}}};
const actions=[2,5].map((amount,index)=>({tick:index+1,action:'world/transfer',
  args:{from:'stock/pier',to:'stock/boat',amount,mode:'exact'}}));
save('dock.world.json',world);
save('dock.actions.json',actions);
save('dock.plan.json',plan('dock-receipts',{
  loaded:{on:{kind:'transfer',where:{path:'/payload/status',value:'full'}},
    cue:{kind:'receipt-caption',label:'Cargo loaded',target:'lower-third',
      detail:{crates:0},bindings:{'/crates':'/payload/applied'}}},
  blocked:{on:{kind:'transfer',where:{path:'/payload/status',value:'blocked'}},
    cue:{kind:'receipt-caption',label:'Cargo unavailable',target:'lower-third',delay:.25,
      detail:{limitedBy:[]},bindings:{'/limitedBy':'/payload/limitedBy'}}}
}));
run('sim','run','dock.world.json','--actions','dock.actions.json','--ticks','4','--record','dock.run.json');
run('story','events','dock.run.json','--format','envelopes','--out','dock.facts.json');
run('story','cues','dock.facts.json','dock.plan.json','--format','timeline','--out','dock.timeline.json');
save('dock.presentation.world.json',{...world,timeline:read('dock.timeline.json')});
run('timeline','dock.presentation.world.json','--out','dock.timeline-report.json');
run('sim','run','dock.presentation.world.json','--actions','dock.actions.json','--ticks','4','--record','dock.presentation.run.json');
const original=read('dock.run.json'), presented=read('dock.presentation.run.json');
assert.deepEqual(presented.end.history,original.end.history);
assert.deepEqual(presented.end.states,original.end.states);
assert.deepEqual(presented.evidence.actions,original.evidence.actions);
assert.equal(presented.end.eventActionCounts.feedback,undefined);
assert.deepEqual(read('dock.timeline-report.json').cues.map(row=>[row.time,row.label]),
  [[.25,'Cargo loaded'],[.75,'Cargo unavailable']]);

const stories=path.resolve(__dirname,'../story-documents');
run('sim','run',path.join(stories,'quay-candidates.world.json'),'--actions',
  path.join(stories,'quay-candidates.actions.json'),'--ticks','6','--record','quay.run.json');
run('sim','fixture','quay.run.json','--from','2','--ticks','6','--out','quay.fixture.json');
run('sim','verify','quay.fixture.json','--out','quay.verify.json');
const on={kind:'story-stage-entered',story:'quay-opportunities/repair-shift',stage:'provision'};
save('quay.caption.plan.json',plan('quay-caption',{stage:{on,cue:{
  kind:'caption',label:'Supply the repair crew',target:'lower-third'
}}}));
save('quay.audio.plan.json',plan('quay-audio',{stage:{on,cue:{
  kind:'audio',target:'effects',delay:.5,detail:{asset:'crew-call',gain:.7}
}}}));
for(const style of ['caption','audio'])
  run('story','cues','quay.fixture.json','quay.'+style+'.plan.json','--out','quay.'+style+'.cues.json');
const [caption]=read('quay.caption.cues.json').cues, [audio]=read('quay.audio.cues.json').cues;
assert.deepEqual(caption.source,audio.source);
assert.equal(audio.time-caption.time,.5);
console.log('Dock: 2 scheduled requests, 2 committed receipts, 2 cues, 0 feedback commands.');
console.log(`Quay: two presentations of event ${caption.source.id} at ${caption.time}s and ${audio.time}s.`);
