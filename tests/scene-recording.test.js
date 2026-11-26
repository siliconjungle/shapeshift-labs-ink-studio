'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {once}=require('node:events');
const {test}=require('node:test');
const {KIT:K}=require('..').load();
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const {planFormat}=K.sceneRecording;

const pose='/poses/cart/translation', lamp='/effects/0/strength', camera='/camera/yaw';
const scene={id:'capture',solids:[{id:'carriage',kind:'box',at:[0,.5,0],half:[.32,.24,.25],mat:'stone',part:'cart'}],
  parts:{cart:{joint:[0,.5,0]}},camera:{yaw:.1,dist:4,target:[0,.4,0]},
  effects:[{do:'lamp',at:[.3,1.4,.8],strength:.9,r:3}],timeline:{duration:2,markers:[{id:'cut',time:1}],
    tracks:[{target:pose,keys:[{time:0,value:[-.1,0,0],ease:'linear'},{time:2,value:[.1,0,0]}]},
      {target:lamp,keys:[{time:0,value:.5},{time:2,value:1.2}]}],
    sequences:{original:{duration:1,tracks:[{target:camera,keys:[{time:0,value:.1},{time:1,value:.6}]}]}},
    clips:[{id:'base-camera',sequence:'original',time:.5}]}};
const plan=(id,channels,extra)=>({format:planFormat,version:1,id,channels,from:0,to:2,...extra});
const packet=(...rows)=>({changes:rows.map(([target,value])=>({target,value}))});
const read=(source,t,target)=>K.diorama.scene(source).build().timeline.sample(t).edits
  .find(row=>'/'+row.path.join('/')===target)?.value;
const compare=(a,b,t,targets)=>{
  for(const target of targets) assert.deepEqual(read(a,t,target),read(b,t,target));
};

test('count-in coalesces clock-aligned gestures and an overdub leaves earlier lanes in place',()=>{
  const rec=K.diorama.scene(scene).recording();
  const take=rec.capture(plan('move',[pose,camera],{from:.25,to:1.75,countIn:.5}));
  take.push(packet([pose,[9,0,0]]),.25);
  take.push(packet([camera,.35],[lamp,5]),.5);
  take.push(packet([pose,[.4,0,0]]),.75);
  take.push(packet([pose,[.6,.1,0]],[camera,.25]),.75);
  take.push(packet([pose,[.2,0,0]]),2);
  const captured=take.finish();
  assert.deepEqual(captured.stats,{packets:5,keys:3,coalesced:1,ignored:{countIn:1,outside:1,unarmed:1}});
  assert.deepEqual(captured.take.tracks[0].keys,[{time:.5,value:[.6,.1,0]}]);
  const edited=rec.apply(captured.take).scene;
  assert.deepEqual(edited.timeline.tracks,scene.timeline.tracks);
  assert.deepEqual(edited.timeline.sequences.original,scene.timeline.sequences.original);
  assert.deepEqual(edited.timeline.markers,scene.timeline.markers);
  compare(scene,edited,.375,[pose,lamp]);
  compare(scene,edited,1.85,[pose,lamp,camera]);
  assert.deepEqual(read(edited,.6,pose),[.6,.1,0]);
  assert.equal(read(edited,.6,camera),.25);
  assert.throws(()=>K.diorama.scene(edited).recording().apply(captured.take),/already in use/);
});

test('punch-in supersedes a nested overdub only on touched channels inside the punch range',()=>{
  const start=K.diorama.scene(scene).recording();
  const baseline=start.capture(plan('light',[lamp]));
  baseline.push(packet([lamp,.8]),.1);
  baseline.push(packet([lamp,2.1]),1.8);
  const prior=start.apply(baseline.finish().take).scene;
  const recorder=K.diorama.scene(prior).recording(), punch=recorder.capture(plan('fix',[lamp,camera],{
    mode:'punch',punch:[.75,1.25],countIn:.25
  }));
  punch.push(packet([lamp,11]),.75);
  punch.push(packet([lamp,.3],[pose,[8,0,0]]),1);
  punch.push(packet([lamp,1.4]),1.25);
  punch.push(packet([lamp,12]),1.5);
  const {take,stats}=punch.finish();
  assert.deepEqual(stats.ignored,{countIn:0,outside:2,unarmed:1});
  const edited=recorder.apply(take).scene;
  for(const time of [.749999,.9,1.249999,1.250001,1.9]) compare(prior,edited,time,[camera,pose]);
  for(const time of [.749999,1.250001,1.9]) compare(prior,edited,time,[lamp]);
  assert.equal(read(edited,.75,lamp),.3);
  assert.equal(read(edited,1,lamp),1.4);
  assert.equal(read(edited,1.25,lamp),1.4);
  assert.throws(()=>recorder.capture(plan('stale',['/effects/0/box'])),/Unknown/);
  const invalid=recorder.capture(plan('invalid',[lamp]));
  assert.throws(()=>invalid.push(packet([lamp,-1]),.5),/does not match/);
});

test('the live CLI signals the transport and saves timestamped keys from stdin before its deadline',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-live-scene-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name);
  fs.writeFileSync(at('source.json'),JSON.stringify(scene));
  fs.writeFileSync(at('plan.json'),JSON.stringify(plan('live',[lamp],{to:1.0,countIn:.15,mode:'punch',punch:[.15,.8]})));
  const child=spawn(process.execPath,[cli,'scene-record','capture','source.json','plan.json','--out','take.json'],{cwd:dir});
  const timeout=setTimeout(()=>child.kill(),12000);
  let stdout='', stderr='', pending='';
  const states=[];
  child.stdin.on('error',()=>{});
  child.stdout.on('data',value=>stdout+=value);
  child.stderr.on('data',chunk=>{
    stderr+=chunk;
    pending+=chunk;
    const lines=pending.split('\n');
    pending=lines.pop();
    for(const event of lines.filter(row=>row.startsWith('{'))) {
      const {state}=JSON.parse(event);
      states.push(state);
      if(state==='punch-in') child.stdin.write(JSON.stringify(packet([lamp,1.8]))+'\n');
    }
  });
  const [code]=await once(child,'close');
  clearTimeout(timeout);
  assert.equal(code,0,stderr);
  assert.deepEqual(states,['count-in','rolling','punch-in','punch-out']);
  assert.equal(JSON.parse(stdout).keys,1);
  const saved=JSON.parse(fs.readFileSync(at('take.json'))), [key]=saved.tracks[0].keys;
  assert(key.time>=.15&&key.time<.8);
  const receipt=JSON.parse(execFileSync(process.execPath,[cli,'scene-record','apply','source.json','take.json','--out','taped.json'],
    {cwd:dir,encoding:'utf8',stdio:'pipe'}));
  assert.equal(receipt.clips[0].from,.15);
  const applied=JSON.parse(fs.readFileSync(at('taped.json')));
  compare(scene,applied,.85,[lamp,pose,camera]);
  assert.equal(read(applied,.5,lamp),1.8);
});
