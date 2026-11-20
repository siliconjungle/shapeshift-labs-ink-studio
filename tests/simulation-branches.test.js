const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const studio=require('..');
const {KIT:{world:W}}=studio.load();
const copy=value=>JSON.parse(JSON.stringify(value));

function source() {
  return {id:'branch-controls',dt:.1,systems:{
    pump:{kind:'control',config:{op:'scale',scale:2}}
  }};
}
const event=(kind,tick)=>({...(tick!==undefined&&{tick}),action:'world/event',args:{kind}});

test('paused branches preserve one exact checkpoint and keep independently replayable water outcomes',()=>{
  const world=require('../examples/world-watershed.json');
  const session=W.branches.create(world,{label:'Baseline'});
  session.queue({actions:[event('scheduled',55)]});
  session.advance(30);
  const anchor=session.mark('upstream');
  const bed={action:'river/bed',args:{bounds:{min:[-1.55,-.75],max:[-.55,.75]},height:-.25}};
  session.fork('open',{mark:'upstream',label:'Lower spillway'});
  assert.deepEqual(session.checkpoint(),anchor);
  session.queue({inputs:{'river/gate.sluice':1},actions:[bed],edits:[
    {op:'set',path:'/metadata/outcome',value:'lowered'}
  ]});
  session.advance(120);
  session.fork('closed',{mark:'upstream',label:'Hold gate'});
  assert.deepEqual(session.checkpoint(),anchor);
  session.queue({inputs:{'river/gate.sluice':0}});
  session.advance(120);
  assert.equal(session.query('closed').probe('water',{entity:'footbridge'}).status,'dry');
  assert(session.query('open').probe('water',{entity:'footbridge'}).value.depth>.15);
  assert.equal(session.checkpoint('open').world.metadata.outcome,'lowered');
  assert.equal(session.checkpoint('closed').world.metadata.outcome,undefined);
  assert(session.diff('closed','open').edits.some(row=>row.path.includes('depth')));
  assert.deepEqual(session.checkpoint('main'),anchor);
  assert.equal(session.status().branches.find(row=>row.id==='open').forkTick,30);
  for(const branch of ['main','open','closed']) {
    const checkpoint=session.checkpoint(branch);
    assert.deepEqual(W.runtime.replay(copy(session.recording(branch))).checkpoint(),checkpoint);
  }
  const restored=W.branches.create(copy(session.save()));
  assert.deepEqual(restored.status(),session.status());
  assert.deepEqual(copy(restored.save()),copy(session.save()));
  restored.fork('third',{mark:'upstream'});
  assert.deepEqual(restored.checkpoint(),copy(anchor));
  assert.deepEqual(restored.checkpoint().pending,[event('scheduled',55)]);
});

test('fixed-step playback pauses at committed boundaries, caps catch-up and follows only the selected branch',()=>{
  const live=W.runtime.create(source());
  live.advance(4);
  const session=W.branches.create(live,{maxStepsPerFrame:3});
  const history=[];
  const off=session.subscribe(state=>history.push([state.active,state.playing,state.tick]));
  session.play();
  session.update(.04);
  assert.equal(session.status().tick,4);
  session.update(.06);
  assert.equal(session.status().tick,5);
  session.update(20);
  assert.equal(session.status().tick,8);
  session.fork('alternative');
  assert.deepEqual(history.at(-1),['alternative',false,8]);
  session.update(1);
  assert.equal(session.status().tick,8);
  session.play();
  session.update(.2);
  session.select('main');
  assert.deepEqual(history.at(-1),['main',false,8]);
  assert.equal(session.view('alternative').tick,10);
  assert.equal(live.view().tick,4);
  assert.throws(()=>session.select(),/branch ID/);
  off();
  session.step();
  assert.deepEqual(history.at(-1),['main',false,8]);
});

test('a mixed queued edit is validated atomically and solver failures pause only the active branch',()=>{
  const session=W.branches.create(source());
  session.fork('broken');
  const before=session.checkpoint();
  assert.throws(()=>session.queue({inputs:{'pump/value':2,'pump/missing':3},actions:[event('ignore')]}),/Invalid value/);
  assert.equal(session.checkpoint(),before);
  session.queue({inputs:{'pump/value':3}});
  session.queue({edits:[{op:'remove',path:'/metadata/missing'}]},{tick:2});
  session.play();
  assert.throws(()=>session.update(.3),/Cannot remove missing path/);
  assert.equal(session.status().playing,false);
  assert.equal(session.view().tick,1);
  assert.equal(session.checkpoint().signals['pump/value'],6);
  assert.equal(session.checkpoint().pending[0].tick,2);
  session.select('main');
  session.advance(2);
  assert.equal(session.checkpoint().signals['pump/value'],0);
});

test('an imported recording keeps prior commands, and marks from a live custom solver still fork',()=>{
  const implementation=()=>({initial:()=>0,step:count=>count+1,inputs:{amount:'number'}});
  const assigned={implementations:{custom:implementation}};
  const live=W.runtime.create({systems:{counter:{kind:'custom'}}},assigned);
  live.schedule([event('early',2)]);
  live.advance(6);
  const session=W.branches.create(live);
  session.mark('saved');
  session.advance(9);
  session.fork('other',{mark:'saved'});
  assert.equal(session.view().states.counter,6);
  assert.equal(session.view('main').states.counter,9);
  const original=W.branches.create(copy(live.recording()),{runtime:assigned});
  original.queue({actions:[event('later')]});
  original.step();
  assert.deepEqual(original.recording().commands.map(row=>row.args.kind),['early','later']);
  const duplicate=copy(original.save());
  duplicate.active='absent';
  assert.throws(()=>W.branches.create(duplicate,{runtime:assigned}),/Unknown simulation branch/);
  assert.throws(()=>original.fork('main'),/duplicate/);
  assert.throws(()=>original.fork('bad',{mark:'absent'}),/Unknown checkpoint mark/);
});

test('optional browser controls pin and fork, stage parameters and actions, and keep the preview slot styleable',
  {skip:!process.env.INK_TEST_CHROME}, t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-branch-mount-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const file=path.join(temp,'index.html'), url=pathToFileURL(path.join(__dirname,'../webgl.mjs')).href;
  fs.writeFileSync(path.join(temp,'kit.js'),studio.bundle());
  fs.writeFileSync(file,`<!doctype html><div id="host"><canvas id="preview"></canvas></div><pre id="result">pending</pre>
<script src="kit.js"></script><script type="module">
import { mountSimulationBranches } from ${JSON.stringify(url)};
const report=document.querySelector('#result');
try {
  const session=KIT.world.branches.create(${JSON.stringify(source())});
  const host=document.querySelector('#host');
  const mount=mountSimulationBranches(host,{session,clock:false,defaultStyles:false,labels:{title:'Flow runs'},
    stylesheet:'[part="title"]{color:rgb(9, 72, 88)}',inputs:[{port:'pump/value',min:0,max:10,label:'Pump'}],
    actions:[{label:'Mark event',action:'world/event',args:{kind:'button'}}]});
  const root=host.shadowRoot, part=name=>root.querySelector('[part="'+name+'"]');
  part('playback').click();session.update(.2);part('playback').click();
  part('mark-name').value='before';part('mark').click();
  part('origin').value='before';part('fork-name').value='open';part('fork').click();
  part('input').value='4';part('apply').click();part('action').click();
  const queued=session.checkpoint().pending.map(row=>row.action);
  part('step').click();
  const edited=session.checkpoint().signals['pump/value'], emitted=session.checkpoint().events[0].kind;
  part('branch').value='main';part('branch').dispatchEvent(new Event('change'));
  const result={queued,edited,emitted,tick:session.view().tick,playing:session.status().playing,
    input:part('input').value,title:part('title').textContent,color:getComputedStyle(part('title')).color,
    slot:root.querySelector('slot').assignedElements()[0].id,otherTick:session.view('open').tick};
  mount.destroy();
  const second=mountSimulationBranches(host,{session,controls:{playback:false,mark:false}});
  result.hidden=part('playback').hidden&&part('mark-controls').hidden;
  second.destroy();
  result.destroyed=!root.childElementCount;
  report.textContent=encodeURIComponent(JSON.stringify(result));
} catch(error) { report.textContent=encodeURIComponent(JSON.stringify({error:error.stack})); }
</script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless=new','--no-first-run','--allow-file-access-from-files',
    '--user-data-dir='+path.join(temp,'profile'),'--dump-dom',pathToFileURL(file).href],
  {encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000,stdio:['ignore','pipe','ignore']});
  const result=JSON.parse(decodeURIComponent(/<pre id="result">([^<]+)<\/pre>/.exec(html)[1]));
  assert.equal(result.error,undefined);
  assert.deepEqual(result,{queued:['world/input','world/event'],edited:8,emitted:'button',tick:2,playing:false,
    input:'0',title:'Flow runs',color:'rgb(9, 72, 88)',slot:'preview',otherTick:3,hidden:true,destroyed:true});
});
