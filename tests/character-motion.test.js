const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { KIT:K } = require('..').load();
const { compile, sha } = require('../cli/character-rig-assembly.js');
const { compileCatalog, sample, timeline } = require('../cli/character-motion.js');
const { retarget } = require('../cli/character-motion-retarget.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const key = (time,value,ease) => ({time,value,...(ease&&{ease})});
const hinge = {type:'hinge',axis:[0,0,1],angle:[-180,180]};
const close = (a,b,tolerance=1e-8) => assert(Math.abs(a-b)<=tolerance, a+' versus '+b);
function rig(id, scale=1, prefix='body', sign=1) {
  return compile({format:'ink-studio/character-rig',version:1,id,components:[],joints:[
    {id:prefix+'.hip',parent:null,at:[0,0,0],limit:hinge},
    {id:prefix+'.knee',parent:prefix+'.hip',at:[0,-scale,0],limit:{...hinge,axis:[0,0,sign]}},
    {id:prefix+'.heel',parent:prefix+'.knee',at:[0,-2*scale,0],limit:{type:'fixed'}},
    {id:prefix+'.head',parent:prefix+'.hip',at:[0,scale,0],limit:hinge}
  ]},K);
}
function doc(source, clips, rootAllowance) {
  return {format:'ink-studio/character-motion',version:1,id:'cue',rigHash:source.hash,clips,
    ...(rootAllowance&&{rootAllowance})};
}
function work(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-motion-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const file = name => path.join(cwd,name);
  const write = (name,data) => fs.writeFileSync(file(name),JSON.stringify(data));
  const open = name => JSON.parse(fs.readFileSync(file(name)));
  function call(...args) {
    return spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'});
  }
  function run(...args) {
    const result = call(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  }
  return {file,write,open,call,run};
}

test('nested trims, eased weights, additive masks and sparse curves share a reproducible time',()=>{
  const source = rig('source');
  const clips = {
    lean:{type:'curves',duration:2,root:[key(0,[.1,0,0]),key(2,[.3,0,0])],
      joints:{'body.hip':[key(0,[20],'step'),key(2,[40])]}},
    glance:{type:'curves',duration:1,joints:{'body.hip':[key(0,[30])],'body.head':[key(0,[15])]}},
    base:{type:'mix',duration:2,layers:[
      {id:'lean',clip:'lean',at:0},
      {id:'glance',clip:'glance',at:.5,mask:['body.head'],mode:'add',weight:[key(0,0),key(1,1)]}
    ]},
    final:{type:'mix',duration:1,layers:[{id:'trim',clip:'base',at:0,in:.5,out:1.5,speed:2}]}
  };
  const catalog = compileCatalog(source,doc(source,clips),K), pose = sample(catalog,'final',.25,K);
  close(pose.rootTranslation[0],.2); // Root stays at the authored nonzero value with a locked contact allowance.
  close(pose.angles['body.hip'][0],20);
  close(pose.angles['body.head'][0],7.5);
  assert.deepEqual(pose.motion.layers.map(({layer,time})=>[layer,time]),
    [['final/trim',1],['final/trim/lean',1],['final/trim/glance',.5]]);
  assert.deepEqual(sample(catalog,'final',.25,K),pose);
  assert.throws(()=>compileCatalog(source,doc(source,{cycle:{type:'mix',duration:1,layers:[{id:'self',clip:'cycle',at:0}]}}),K),
    /Cyclic motion/);
});

test('CLI animation erasers reveal the preceding pose on selected controls and preserve the source keys',t=>{
  const w = work(t), source = rig('source');
  const motion = doc(source,{
    base:{type:'curves',duration:2,joints:{'body.head':[key(0,[10])],'body.hip':[key(0,[5])]}},
    pose:{type:'curves',duration:1,joints:{'body.head':[key(0,[50])],'body.hip':[key(0,[25])]}},
    take:{type:'mix',duration:2,layers:[{id:'base',clip:'base',at:0},{id:'pose',clip:'pose',at:.5}]}
  });
  w.write('rig.json',source.document);
  w.write('motion.json',motion);
  function edit(from,to,...changes) {
    w.write('edit.json',{format:'ink-studio/character-motion-edit',version:1,
      operations:changes.map(([eraser,patch])=>({op:'set-eraser',clip:'take',layer:'pose',eraser,patch}))});
    return w.run('character-motion','edit','rig.json',from+'.json','edit.json','--out',to+'.json');
  }
  const window = {start:.2,end:.8,controls:['body.head']};
  const edited = edit('motion','erased',['settle',{...window,
    strength:[key(.2,0),key(.4,1),key(.55,.5),key(.8,0)]}],['boost',{...window,strength:.5}]);
  assert.deepEqual(edited.clips.pose,motion.clips.pose);
  assert.deepEqual(w.open('motion.json'),motion);
  const catalog = compileCatalog(source,edited,K), clip = catalog.clips.get('take');
  const poseAt = time => sample(catalog,'take',time,K);
  close(poseAt(.65).angles['body.head'][0],50);
  close(poseAt(.9).angles['body.head'][0],10);
  close(poseAt(1.05).angles['body.head'][0],20);
  close(poseAt(1.05).angles['body.hip'][0],25);
  assert.deepEqual(poseAt(1.05).motion.layers.at(-1).erasers,[
    {id:'settle',strength:.5,controls:['body.head']},{id:'boost',strength:.5,controls:['body.head']}
  ]);
  assert(timeline(catalog,clip,true).boundaries.has(1.05));
  const index = w.run('character-motion','catalog','rig.json','erased.json');
  assert.equal(index.clips.find(row=>row.id==='take').layers[1].erasers.length,2);
  const disabled = edit('erased','disabled',['settle',{enabled:false}],['boost',{enabled:false}]);
  assert.deepEqual(sample(compileCatalog(source,disabled,K),'take',1.05,K),
    sample(compileCatalog(source,motion,K),'take',1.05,K));
  assert.deepEqual(edit('disabled','removed',['settle',null],['boost',null]),motion);
  assert.throws(()=>compileCatalog(source,{...edited,clips:{...edited.clips,take:{...edited.clips.take,
    layers:[edited.clips.take.layers[0],{...edited.clips.take.layers[1],mask:['body.hip']}]
  }}},K),/inside the layer mask/);
});

test('retargeted nested contact windows anchor a larger rig between bake keys',()=>{
  const source = rig('source'), target = rig('large',1.4,'new',-1);
  const planted = {id:'sole',joint:'body.heel',start:.23,end:1.4,at:[0,-1.82,.05],offset:[0,-.1,.05],
    direction:{local:[0,0,1],at:[0,0,1]},tolerance:.003,weight:4};
  const clips = {
    dip:{type:'curves',duration:2,root:[key(0,[.15,-.17,0]),key(2,[-.1,-.18,0])],
      joints:{'body.hip':[key(0,[12]),key(2,[-10])],'body.knee':[key(0,[-26]),key(2,[-26])]},contacts:[planted]},
    nested:{type:'mix',duration:1.5,layers:[{id:'placement',clip:'dip',at:.125,in:.43,out:1.63}]}
  };
  const catalog = compileCatalog(source,doc(source,clips,[.02,0,0]),K);
  const mapping = source.joints.map(({id})=>({source:id,target:id.replace('body.','new.')}));
  const plan = {format:'ink-studio/character-motion-retarget',version:1,id:'baked',fps:6,scale:[1.4,1.4,1.4],joints:mapping};
  const {result,report} = retarget(catalog,'nested',target,plan,K);
  assert.deepEqual(retarget(catalog,'nested',target,plan,K),{result,report});
  assert(report.passed,JSON.stringify(report.samples.filter(frame=>!frame.passed)));
  assert(report.samples.some(frame=>frame.initialError>.01));
  assert.deepEqual(report.mapping.find(row=>row.source==='body.knee').signs,[-1]);
  const [window] = result.clips.nested.contacts;
  close(window.start,.125);
  close(window.end,1.095);
  close(window.at[1],-1.82*1.4);
  assert.equal(report.contacts[0].ref,'nested/placement/sole');
  const baked = compileCatalog(target,result,K);
  const hold = sample(baked,'nested',.583,K);
  assert.equal(hold.solve.targets[0].joint,'new.heel');
  assert(hold.solve.passed);
  assert(hold.solve.targets[0].position.residual<=planted.tolerance);
  assert(hold.maxBoneDrift<1e-9);
  assert.equal(sample(baked,'nested',1.13,K).solve.targets.length,0);
  assert.throws(()=>retarget(catalog,'nested',target,{...plan,joints:mapping.slice(0,2)},K),/No target joint mapped/);
});

test('CLI edits and keys native rig poses, protects source files and reports failed contacts',t=>{
  const w = work(t), source = rig('source');
  const motion = doc(source,{take:{type:'curves',duration:1,
    joints:{'body.head':[key(0,[0]),key(1,[45])]},
    contacts:[{id:'too-far',joint:'body.heel',start:.9,end:1,at:[50,0,0]}]}});
  w.write('rig.json',source.document);
  w.write('motion.json',motion);
  const index = w.run('character-motion','catalog','rig.json','motion.json');
  assert.equal(index.revision,sha(fs.readFileSync(w.file('motion.json'))));
  const start = w.run('character-motion','sample','rig.json','motion.json','take','--at','.25');
  w.write('ik.json',{format:'ink-studio/character-ik',version:1,targets:[],
    root:{max:[.2,0,0]},initial:{root:[.2,0,0],angles:{...start.angles,'body.head':[35]}}});
  w.run('character-rig','solve','rig.json','ik.json','--out','pose.json');
  const operations = [
    {op:'key-pose',clip:'take',time:.25,pose:'pose.json',controls:['root','body.head']},
    {op:'upsert',clip:'take',control:'body.head',time:.6,value:[52],ease:[.3,0,.7,1]},
    {op:'move',clip:'take',control:'body.head',time:.6,to:.65},
    {op:'remove',clip:'take',control:'body.head',time:1}
  ];
  w.write('edits.json',{format:'ink-studio/character-motion-edit',version:1,revision:index.revision,operations});
  const edited = w.run('character-motion','edit','rig.json','motion.json','edits.json','--out','edited.json');
  assert.deepEqual(edited.clips.take.joints['body.head'].map(key=>key.time),[0,.25,.65]);
  assert.deepEqual(w.open('motion.json'),motion);
  const sample = w.run('character-motion','sample','rig.json','edited.json','take','--at','.25');
  close(sample.angles['body.head'][0],35);
  close(sample.rootTranslation[0],.2);
  assert(w.call('character-motion','edit','rig.json','edited.json','edits.json','--out','next.json').status!==0);
  assert(w.call('character-motion','edit','rig.json','motion.json','edits.json','--out','pose.json').status!==0);
  const unmet = w.call('character-motion','sample','rig.json','motion.json','take','--at','1','--out','unmet.json','--require-solved');
  assert.equal(unmet.status,2,unmet.stderr);
  assert.equal(w.open('unmet.json').solve.passed,false);
  assert(w.run('character-motion','sample','rig.json','motion.json','take','--at','1','--free').solve.passed);
  w.write('retarget.json',{format:'ink-studio/character-motion-retarget',version:1,id:'bake',fps:4});
  const bake = w.call('character-motion','retarget','rig.json','motion.json','take','rig.json','retarget.json',
    '--out','baked.json','--report','bake-report.json','--require-solved');
  assert.equal(bake.status,2,bake.stderr);
  assert(w.open('bake-report.json').samples.some(frame=>!frame.passed));
  assert.equal(w.open('baked.json').clips.take.contacts[0].joint,'body.heel');
});
