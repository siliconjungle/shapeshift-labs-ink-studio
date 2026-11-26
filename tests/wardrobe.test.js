const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), {KIT:K}=kit;
const {compile}=require('../cli/character-rig-assembly.js');
const wardrobe=require('../cli/wardrobe.js');
const PNG=require('../cli/png.js');

const entry=path.resolve(__dirname,'../cli/ink-studio.js');
const front=z=>[[-.7,1,z],[.7,1,z],[-.7,0,z],[.7,0,z]];
function work(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-wardrobe-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const call=(...args)=>spawnSync(process.execPath,[entry,...args],{cwd:dir,encoding:'utf8'});
  const run=(...args)=>{
    const done=call(...args);
    assert.equal(done.status,0,done.stderr);
    return JSON.parse(done.stdout);
  };
  return {file,write,run,call};
}
const basic={format:'ink-studio/wardrobe-plan',version:1,id:'harness'};
function bake(w,name,plan) {
  const file=w.file(name);
  w.write(name,plan);
  const project=wardrobe.open(file,kit);
  const {artifacts,report}=project.bake();
  return {project,take:project.validate(JSON.parse(artifacts[0].bytes)),report};
}
const finalZ=panel=>Math.min(...panel.positions.filter((_,i)=>i%3===2));

test('seams join authored endpoints and ordered layers stop falling through lower panels',t=>{
  const w=work(t);
  const plan={...basic,simulation:{fps:30,frames:22,substeps:6,gravity:[0,0,-9.5],clearance:.025},
    panels:[
      {id:'liner',size:[5,6],layer:0,side:-1,corners:front(0),
        pins:[{vertices:[...Array.from({length:30},(_,i)=>i)]}]},
      {id:'left',size:[4,6],layer:1,side:-1,pins:[{edge:'top'}],corners:[[-.63,.95,.12],[-.025,.95,.12],[-.63,.05,.12],[-.025,.05,.12]]},
      {id:'right',size:[4,6],layer:1,side:-1,pins:[{edge:'top'}],corners:[[.025,.95,.12],[.63,.95,.12],[.025,.05,.12],[.63,.05,.12]]}],
    seams:[{id:'middle',a:{panel:'left',vertices:[7,11,15,19,23]},b:{panel:'right',vertices:[4,8,12,16,20]}}]};
  const withLayers=bake(w,'on.json',plan), without=bake(w,'off.json',{...plan,simulation:{...plan.simulation,collision:false}});
  const saved=withLayers.project.frame(withLayers.take,21), free=without.project.frame(without.take,21);
  assert(withLayers.report.collision.pushes>0);
  assert(finalZ(saved.panels[1])>.03);
  assert(finalZ(free.panels[1])<-.02);
  assert(withLayers.report.seams[0].initial>.04 && withLayers.report.seams[0].final<.012);
  assert.deepEqual(saved.panels[1].positions.slice(0,12),withLayers.take.frames[0].slice(90,102));
});

test('UV grooms retain their frame and seeded clumps, and feather hinges keep their roots attached',t=>{
  const w=work(t);
  const rig={format:'ink-studio/character-rig',version:1,id:'hinge',components:[],joints:[
    {id:'wing.base',parent:null,at:[1,1,0],limit:{type:'hinge',axis:[0,0,1],angle:[-90,90]}}
  ]};
  w.write('rig.json',rig);
  w.write('motion.json',{format:'ink-studio/character-motion',version:1,id:'motion',rigHash:compile(rig,K).hash,
    clips:{open:{type:'curves',duration:1,joints:{'wing.base':[{time:0,value:[0]},{time:1,value:[45]}]}}}});
  const plan={...basic,seed:1234,simulation:{fps:24,frames:25,gravity:[0,0,0]},
    rig:{file:'rig.json',motion:'motion.json',clip:'open'},
    panels:[{id:'cape',size:[2,2],side:-1,corners:front(.5),pins:[{edge:'top',joint:'wing.base'},{edge:'bottom',joint:'wing.base'}]}],
    grooms:[{id:'fringe',anchor:{panel:'cape',uv:[.5,.5]},guide:[[0,0,0],[0,.05,.1],[0,.12,.24]],
      count:6,clumps:2,frizz:.6,samples:8}],
    feathers:[{id:'flight',joint:'wing.base',from:[2,1,0],to:[2.15,1,0],direction:[0,-1,0],normal:[0,0,1],
      count:3,action:{axis:[0,0,1],stagger:.2,keys:[{time:0,value:0},{time:1,value:60,ease:'linear'}]}}]};
  const {project,take}=bake(w,'plan.json',plan), rest=project.frame(take,0), pose=project.frame(take,24);
  assert.deepEqual(project.frame(take,24),pose);
  assert.equal(new Set(pose.grooms[0].plan.strands.map(row=>row.clump)).size,2);
  assert.deepEqual(pose.grooms[0].plan.strands.map(row=>row.id),rest.grooms[0].plan.strands.map(row=>row.id));
  assert.deepEqual(rest.grooms[0].origin,[0,.5,.5]);
  const vertices=pose.panels[0].positions, center=K.V.lerp(vertices.slice(3,6),vertices.slice(6,9),.5);
  assert(K.V.dist(pose.grooms[0].origin,center)<1e-8);
  const first=pose.feathers[0], last=pose.feathers.at(-1);
  assert(K.V.dist(first.root,[1+Math.sqrt(.5),1+Math.sqrt(.5),0])<1e-8);
  assert.deepEqual(first.shaft.points[0],first.root);
  assert(first.angle>last.angle);
  assert(K.V.dist(rest.feathers[0].tip,first.tip)>.25);
  const noFrizz=bake(w,'flat.json',{...plan,grooms:plan.grooms.map(row=>({...row,frizz:0}))});
  assert.notDeepEqual(noFrizz.project.frame(noFrizz.take,24).grooms[0].plan.strands,pose.grooms[0].plan.strands);
});

test('CLI caches identical bakes, rebuilds corrupt entries and reopens native renders',t=>{
  const w=work(t);
  const plan={...basic,simulation:{frames:4},
    panels:[{id:'bib',size:[4,4],side:-1,pins:[{edge:'top'}],corners:front(0),color:'#86aa94'}],
    grooms:[{id:'tassel',anchor:{panel:'bib',uv:[.5,.9]},guide:[[0,0,0],[0,-.22,.07]],count:3,clumps:1,samples:8}],
    feathers:[{id:'trim',from:[.1,.82,.12],to:[.65,.82,.12],direction:[0,-1,0],normal:[0,0,1],count:4}]};
  w.write('plan.json',plan);
  const args=['wardrobe','bake','plan.json','--cache','cache','--out'];
  const first=w.run(...args,'cold.json'), second=w.run(...args,'warm.json');
  assert.equal(first.artifactCache.status,'miss');
  assert.equal(second.artifactCache.status,'hit');
  assert.equal(first.takeSha256,second.takeSha256);
  assert(fs.readFileSync(w.file('cold.json')).equals(fs.readFileSync(w.file('warm.json'))));
  const cache=w.file('cache/ink-graph-artifacts-v1/'+second.artifactCache.key+'.bin');
  fs.writeFileSync(cache,'broken');
  assert.equal(w.run(...args,'again.json').artifactCache.status,'miss');
  assert.equal(w.run('wardrobe','sample','plan.json','cold.json','--frame','3').feathers.length,4);
  const preview=w.run('wardrobe','preview','plan.json','cold.json','--frame','3','--out','frame.png');
  const image=PNG.raster(w.file('frame.png'));
  assert.equal(image.w,preview.w);
  assert(new Set(image.data).size>20);
  w.write('plan.json',{...plan,seed:4});
  assert.notEqual(w.call('wardrobe','sample','plan.json','cold.json').status,0);
});
