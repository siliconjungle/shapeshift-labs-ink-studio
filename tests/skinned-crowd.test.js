const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), {KIT:K}=kit;
const {compile}=require('../cli/character-rig-assembly.js');
const {buildBinding}=require('../cli/character-rig-bind.js');
const {prepare}=require('../cli/tissue-solver.js');
const {open}=require('../cli/skinned-crowd.js');
const PNG=require('../cli/png.js');

const cli=path.resolve(__dirname,'../cli/ink-studio.js'), V=K.V, fixed={type:'fixed'};
const hinge={type:'hinge',axis:[0,0,1],angle:[-90,90]};
const clock=24, I=[1,0,0,0,1,0,0,0,1,0,0,0];
const skeleton={format:'ink-studio/character-rig',version:1,id:'worker',components:[],joints:[
  {id:'body.hip',parent:null,at:[0,1,0],limit:fixed},
  {id:'body.chest',parent:'body.hip',at:[0,1.48,0],limit:hinge},
  {id:'leg.knee',parent:'body.hip',at:[0,.58,.13],limit:{type:'hinge',axis:[1,0,0],angle:[-42,135]}},
  {id:'leg.foot',parent:'leg.knee',at:[0,.11,.02],limit:fixed}
]};
const rig=compile(skeleton,K), rest={matrices:rig.joints.flatMap(()=>I),angles:{'body.chest':[0]}};
const model={
  format:'ink-studio/tissue-model',version:1,id:'chest-volume',
  nodes:{a:{at:[0,1,0],weights:{'body.hip':1},pin:true}, b:{at:[1,1,0],weights:{'body.hip':1}},
    c:{at:[0,2,0],weights:{'body.hip':1}},d:{at:[0,1,1],weights:{'body.hip':1}}},
  cells:[{nodes:['a','b','c','d'],compliance:0}],
  muscles:[{id:'active-fiber',from:'a',to:'b',contraction:.32,compliance:0,
    driver:{joint:'body.chest',axis:0,range:[0,60]}}],
  edgeCompliance:.004, skin:{gain:1,maxOffset:.6}
};
function workspace(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-crowd-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name),write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const run=(...args)=>{
    const child=call(...args);
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout);
  };
  return {dir,file,write,call,run};
}
function fixture(w){
  w.write('rig.json',skeleton); w.write('tissue.json',model);
  const points=[[0,1,0],[.8,1,0],[0,1.8,0],[0,1,.8]], faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
  w.write('skin.json',{points,faces,mats:[{name:'cream',rgb:'#e7b66b'}],tmat:[0,0,0,0]});
  const binding={format:'ink-studio/character-bind-plan',version:1,carriers:[{id:'coat',type:'mesh',file:'skin.json',joint:'body.hip'}]};
  w.write('bind.json',buildBinding(rig,binding,w.dir,w.dir,K).document);
  const keys=(end)=>[{time:0,value:[0]},{time:1,value:[end]}];
  w.write('motion.json',{format:'ink-studio/character-motion',version:1,id:'loader',rigHash:rig.hash,clips:{
    start:{type:'curves',duration:1,joints:{'body.chest':keys(22)}},
    lift:{type:'curves',duration:1,joints:{'body.chest':keys(70)}}}});
  const terrain=K.procedural.terrainSet.bake({format:'ink-studio/terrain-set',version:1,id:'hill',
    grid:{origin:[-4,-4],cell:2,tileCells:4,size:[1,1]},tiles:[{at:[0,0],
      heights:Array.from({length:25},(_,i)=>i%5*.07)}]}).tiles[0];
  w.write('hill.json',terrain);
  const plan={format:'ink-studio/skinned-crowd-plan',version:1,id:'test-crew',fps:clock,frames:30,terrain:{tile:'hill.json'},
    view:{w:120,h:90,camera:{target:[0,1,0],dist:9,yaw:.08,pitch:.12,ortho:true,fov:.65}},
    budget:{visible:2,skinned:1,tissue:1,triangles:500},
    templates:{loader:{rig:'rig.json',binding:'bind.json',motion:'motion.json',tissue:'tissue.json',
      feet:[{joint:'leg.foot',offset:[0,-.10,0],always:true,tolerance:.016}]}},
    actors:[
      {id:'hero',template:'loader',at:[0,0,.2],clip:'start',priority:9,
        transitions:[{frame:4,clip:'lift',phase:.54,blend:6}],loop:false},
      {id:'fall',template:'loader',at:[1.1,0,.2],velocity:[.10,0,0],clip:'start',
        ragdoll:{frame:15,joint:'body.chest',velocity:[1.65,.20,.15]}},
      {id:'outside',template:'loader',at:[32,0,0],clip:'start'}
    ]};
  w.write('plan.json',plan);
  return plan;
}

test('muscle activation shortens a fiber, preserves signed tissue volume and moves bound skin',()=>{
  const tissue=prepare(model,rig,K), dt=1/clock, work=tissue.open(rest,dt);
  const initial=work.capture();
  let result;
  for(let i=1;i<=48;i++)result=work.step({...rest,angles:{'body.chest':[60]}},i*dt);
  assert.equal(result.muscles[0].activation,1);
  assert(result.muscles[0].length<initial.muscles[0].length*.86,JSON.stringify(result));
  assert.equal(result.volume.inverted,0);
  assert(Math.abs(result.volume.min-1)<.05,JSON.stringify(result.volume));
  const points=Float32Array.from([.20,1.18,.15,3,1,0]);
  const skin=tissue.bind(points), posed=skin.apply(points.slice(),result.offsets);
  assert.equal(skin.count,1);
  assert(posed.maxOffset>.02);
  assert.deepEqual(Array.from(posed.positions.slice(3)),[3,1,0]);
});

test('crowd clips blend, planted points stay on native terrain, and ragdoll keeps moving through LOD',t=>{
  const w=workspace(t), plan=fixture(w), project=open(w.file('plan.json'),kit), take=project.bake();
  assert.deepEqual(project.bake(),take);
  const key=(i,id)=>take.frames[i].actors.find(row=>row.id===id);
  assert.equal(key(4,'hero').blend,0);
  assert.equal(key(7,'hero').blend,.5);
  assert.equal(key(10,'hero').from,null);
  assert.equal(take.diagnostics.missedContacts,0);
  assert(take.diagnostics.contactSamples>20);
  const anchor=key(0,'hero').contacts[0].target;
  assert.deepEqual(key(29,'hero').contacts[0].target,anchor);
  assert(Math.abs(anchor[1]-.14)<1e-8);
  assert.equal(key(15,'fall').tier,'proxy');
  assert.equal(key(15,'fall').handoff.snap,0);
  assert(key(15,'fall').handoff.inheritedSpeed>0);
  assert(key(15,'fall').handoff.launchSpeed>key(15,'fall').handoff.inheritedSpeed);
  assert.equal(key(29,'fall').mode,'ragdoll');
  assert(V.dist(key(29,'fall').points.slice(0,3),key(15,'fall').points.slice(0,3))>.10);
  assert.equal(key(29,'outside').tier,'culled');
  assert.deepEqual(take.frames[18].budget,{visible:2,skinned:1,tissue:1,triangles:48,texels:1,meshCount:2});
  assert(project.sample(take,20).surfaces.some(row=>row.type==='skin'&&row.skinOffset>.01));
  const uncapped={...plan,budget:{...plan.budget,visible:0,skinned:0,tissue:0}};
  w.write('hidden.json',uncapped);
  const hidden=open(w.file('hidden.json'),kit).bake();
  assert.deepEqual(hidden.frames[29].actors[1].matrices,key(29,'fall').matrices);
  const walking={...plan,actors:plan.actors.map(row=>row.id==='fall'?{...row,ragdoll:undefined}:row)};
  w.write('walking.json',walking);
  const reference=open(w.file('walking.json'),kit).bake();
  assert.deepEqual(reference.frames[15].actors[1].matrices,key(15,'fall').matrices);
  assert.deepEqual(reference.frames[15].actors[1].points,key(15,'fall').points);
});

test('CLI exports revisitable geometry and renders shared mesh IDs independently',t=>{
  const w=workspace(t), plan=fixture(w);
  plan.budget.skinned=2;
  w.write('plan.json',plan);
  const report=w.run('skinned-crowd','bake','plan.json','--out','take.json','--require-contacts');
  assert.equal(report.frames,30);
  const frame=w.run('skinned-crowd','sample','plan.json','take.json','--frame','21');
  assert.deepEqual(frame.surfaces.map(row=>row.id),['hero/coat','fall/coat']);
  assert.notDeepEqual(frame.surfaces[0].positions,frame.surfaces[1].positions);
  const preview=w.run('skinned-crowd','preview','plan.json','take.json','--frame','21','--out','frame.png');
  assert.equal(preview.surfaces.length,2);
  assert.equal(PNG.raster(w.file('frame.png')).w,120);
  assert.notEqual(w.call('skinned-crowd','preview','plan.json','take.json','--out','plan.json').status,0);
});
