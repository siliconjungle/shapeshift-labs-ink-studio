'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const {KIT:K}=require('..').load();
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

const move='/poses/blade/translation', light='/effects/0/strength', yaw='/camera/yaw';
const scene={id:'poses',solids:[{id:'panel',kind:'box',at:[0,0,0],half:[.25,.4,.15],mat:'stone',res:.09,part:'blade'}],
  parts:{blade:{joint:[0,0,0]}},camera:{yaw:.15,dist:4,sway:0,target:[0,0,0]},
  effects:[{do:'lamp',at:[0,1,1]}],timeline:{duration:2,markers:[{id:'pause',time:.7}],
    tracks:[{target:light,keys:[{time:0,value:.5,ease:'linear'},{time:2,value:1.5}]}]}};
const value=(source,time,target)=>{
  const row=K.diorama.scene(source).build().timeline.sample(time).edits
    .find(({path})=>'/'+path.join('/')===target);
  return row?.value;
};
const edits=(...pairs)=>({changes:pairs.map(([target,value])=>({target,value}))});
const near=(x,y)=>assert(Math.abs(x-y)<1e-8,JSON.stringify({x,y}));

test('capture skips unchanged properties and takes current authored camera, light and keyed prop edits',()=>{
  const desc=K.diorama.scene(scene), baseline=desc.poseCapture(.4);
  const dry=baseline.capture(edits([move,[0,0,0]],[yaw,.15],[light,.7]),{duration:2});
  assert.deepEqual(dry.key.changes,[]);
  const revised={...scene,camera:{...scene.camera,yaw:.55},effects:[{...scene.effects[0],strength:1.2}],
    timeline:{...scene.timeline,tracks:[...scene.timeline.tracks,{target:move,keys:[{time:0,value:[.15,.10,0]}]}]}};
  const capture=baseline.capture(K.diorama.scene(revised).poseCapture(.4),{id:'first',duration:2});
  const values=Object.fromEntries(capture.key.changes.map(row=>['/'+row.target.join('/'),row.value]));
  assert.deepEqual(values,{[move]:[.15,.10,0],[yaw]:.55,[light]:1.2});
  assert.throws(()=>baseline.capture(edits(['/poses/missing/scale',1])),/distinct editable/);
});

test('camera defaults come from the current playhead after an earlier nested camera clip ends',()=>{
  const {yaw:_,...camera}=scene.camera;
  const prior={...scene,camera,timeline:{...scene.timeline,
    sequences:{look:{duration:.25,tracks:[{target:yaw,keys:[{time:0,value:1.2}]}]}},
    clips:[{id:'look',sequence:'look',time:0}]}};
  const capture=K.diorama.scene(prior).poseCapture(.5);
  assert.equal(capture.current(['camera','yaw']),.4);
  assert.deepEqual(capture.capture(edits([yaw,.4])).key.changes,[]);
});

test('explicit holds, eased common channels and empty ranges keep the underlying timeline exact',()=>{
  const desc=K.diorama.scene(scene);
  const first=desc.poseCapture(.1).capture(edits([move,[.3,0,0]],[light,2]),{id:'gesture',duration:1.65,hold:.15,blend:'linear'});
  const next=desc.poseCapture(.55).capture(edits([move,[.9,0,0]]),{sequence:first.sequence,blend:'step'});
  const blank=desc.poseCapture(.7).capture(edits(),{sequence:next.sequence});
  const late=desc.poseCapture(1.11).capture(edits([move,[-.4,0,0]]),{sequence:blank.sequence,blend:'step'});
  const final=desc.poseCapture(1.39).capture(edits([move,[-.1,0,0]]),{sequence:late.sequence});
  const applied=desc.poseCapture().apply(final.sequence);
  const s=applied.scene;
  assert.deepEqual(s.timeline.markers,scene.timeline.markers);
  assert.deepEqual(s.timeline.tracks,scene.timeline.tracks);
  assert.deepEqual(applied.ranges[2].targets,[]);
  assert.equal(value(s,.09,move),undefined);
  near(value(s,.24,move)[0],.3);
  near(value(s,.4,move)[0],.6);
  near(value(s,.549,light),2);
  near(value(s,.55,light),value(scene,.55,light));
  assert.equal(value(s,.7,move),undefined);
  assert.equal(value(s,1,move),undefined);
  near(value(s,1.11,move)[0],-.4);
  near(value(s,1.38,move)[0],-.4);
  near(value(s,1.39,move)[0],-.1);
  assert.equal(value(s,1.65,move),undefined);
  assert.throws(()=>desc.poseCapture(.3).capture(edits([move,[1,0,0]]),{sequence:first.sequence,hold:2}),/bounded hold|holds must fit/);
});

test('exclusive overlay ends survive retiming while markers remain available at the edge',()=>{
  const timeline={duration:2,clips:[{id:'outer',sequence:'mid',time:.1,until:.7,endExclusive:true}],
    sequences:{mid:{duration:1,clips:[{id:'inner',sequence:'take',time:0}]},
      take:{duration:1,markers:[{id:'boundary',time:1}],tracks:[{target:yaw,keys:[{time:0,value:.8}]}]}}};
  for(const exact of [false,true]) {
    const p=K.timeline.compile(timeline,{exact});
    assert.equal(p.sample(.69).edits.length,1);
    assert.equal(p.sample(.7).edits.length,0);
    assert.deepEqual(p.markers.map(row=>row.time),[.7]);
  }
});

test('CLI appends or replaces sparse keys, then writes an editable scene with blank ranges',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-scene-poses-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name);
  const put=(name,val)=>fs.writeFileSync(at(name),JSON.stringify(val));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'scene-pose',...args],{cwd:dir,stdio:'pipe',encoding:'utf8'}));
  put('base.json',scene);
  put('move.json',edits([move,[.5,0,0]],[yaw,.15]));
  put('empty.json',edits());
  const a=run('capture','base.json','move.json','--id','rehearse','--at','.2','--duration','1.25','--hold','.2','--out','start.json');
  assert.deepEqual(a.changes.map(row=>row.target),[['poses','blade','translation']]);
  run('capture','base.json','empty.json','--sequence','start.json','--at','.75','--out','all.json');
  const b=run('apply','base.json','all.json','--out','play.json');
  assert.deepEqual(b.ranges.map(row=>[row.from,row.to,row.targets.length]),[[.2,.75,1],[.75,1.25,0]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(at('base.json'))),scene);
});
