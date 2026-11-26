const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), K=kit.KIT;
const {assemble,compile}=require('../cli/character-rig-assembly.js');
const {solve,openPose}=require('../cli/character-rig-solve.js');
const PNG=require('../cli/png.js');

const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const fixed={type:'fixed'}, hinge=(a,b)=>({type:'hinge',axis:[0,0,1],angle:[a,b]});
const plan=(components,templates={},placements={})=>({
  format:'ink-studio/character-rig-plan',version:1,id:'surveyor',templates,components,placements
});
const ik=(targets,settings={})=>({format:'ink-studio/character-ik',version:1,targets,...settings});
const base={joints:[{id:'root',at:[0,0,0],limit:fixed}]};
const baseRig=()=>assemble(plan([{id:'base',template:'base'}],{base}),K);
function work(t){
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-rig-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const file=name=>path.join(cwd,name);
  const write=(name,doc)=>fs.writeFileSync(file(name),JSON.stringify(doc));
  const read=name=>JSON.parse(fs.readFileSync(file(name)));
  function call(...args){return spawnSync(process.execPath,[cli,'character-rig',...args],{cwd,encoding:'utf8'});}
  function run(...args){
    const child=call(...args);
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout);
  }
  return {file,write,read,call,run};
}

test('component templates resolve out-of-order attachments, mirrored axes and edited placements',()=>{
  const link={joints:[
    {id:'tip',parent:'pivot',at:[.4,.1,0],limit:fixed},
    {id:'pivot',at:[0,0,0],limit:{type:'hinge',axis:[0,1,1],angle:[-5,95]}}
  ]};
  const description=plan([
    {id:'mirror',template:'link',attach:'base.root',mirror:'x',scale:2,joints:{tip:[.5,.1,0]}},
    {id:'base',template:'base'}
  ],{base,link},{'base.root':[.1,.2,.3]});
  const first=assemble(description,K), second=assemble(description,K);
  assert.deepEqual(first,second);
  assert.deepEqual(first.joints.map(joint=>joint.id),['base.root','mirror.pivot','mirror.tip']);
  assert.deepEqual(first.joints[1].at,[.1,.2,.3]);
  assert.deepEqual(first.joints[2].at,[-.9,.4,.3]);
  assert(first.joints[1].limit.axis.slice(1).every(v=>v<-.7));
  assert.deepEqual(first.joints[1].limit.angle,[-5,95]);
  assert.equal(compile(first,K).joints[1].length,0);
  const invalid=plan([{id:'base',template:'base'},{id:'mirror',template:'link',attach:'mirror.tip'}],{base,link});
  assert.throws(()=>assemble(invalid,K),/without cycles/);
});

test('whole-body IK respects lengths and angular bounds, including a straight neutral chain',t=>{
  const chain={joints:[
    {id:'shoulder',at:[0,0,0],limit:hinge(-110,110)},
    {id:'elbow',parent:'shoulder',at:[1,0,0],limit:hinge(0,135)},
    {id:'hand',parent:'elbow',at:[2,0,0],limit:hinge(-140,140)}
  ]};
  const document=assemble(plan([{id:'arm',template:'chain'}],{chain}),K), rig=compile(document,K);
  const target={id:'shorten',joint:'arm.hand',at:[1.55,0,0],tolerance:.002};
  const pose=solve(rig,ik([target]),K);
  assert(pose.solve.passed,JSON.stringify(pose.solve));
  assert(pose.solve.reseeds>0);
  assert(pose.maxBoneDrift<1e-10);
  assert(pose.joints['arm.elbow'].angles[0].degrees>0);
  const aimed=solve(rig,ik([{...target,direction:{local:[1,0,0],at:[1,0,0],tolerance:1}}],
    {initial:{angles:pose.angles}}),K);
  assert(aimed.solve.passed);
  assert(aimed.solve.targets[0].direction.residualDegrees<1);
  assert.deepEqual(openPose(rig,aimed,K).joints['arm.hand'].matrix,aimed.joints['arm.hand'].matrix);
  const w=work(t);
  w.write('rig.json',document);
  w.write('unreachable.json',ik([{id:'beyond',joint:'arm.hand',at:[0,5,0],tolerance:.002}],
    {iterations:32}));
  const process=w.call('solve','rig.json','unreachable.json','--out','limited.json','--require-solved');
  assert.equal(process.status,2,process.stderr);
  const report=w.run('inspect','rig.json','--pose','limited.json');
  assert.equal(report.solve.passed,false);
  assert(report.solve.targets[0].position.residual>2.99);
  assert(report.solve.targets[0].position.actual.every(Number.isFinite));
  assert(report.pose.maxBoneDrift<1e-10);
});

test('saved bindings move native meshes, splats and proxies with the same solve and render the moved splat',t=>{
  const w=work(t), joint='base.root';
  w.write('rig.json',baseRig());
  w.write('mesh.json',K.meshTopology.create({id:'mesh',skin:{joints:[joint]},
    vertices:[[0,0,0],[.23,.03,0],[.05,.29,0]].map((position,i)=>({id:'v'+i,position,weights:{[joint]:1}})),
    faces:[{id:'f0',material:'patch',corners:['v0','v1','v2'].map((vertex,i)=>({id:'c'+i,vertex}))}]}));
  w.write('proxy.json',{points:[[0,0,0],[.23,.03,0],[.05,.29,0]],faces:[[0,1,2]]});
  w.write('cloud.json',{format:'ink-studio/character-splats',version:1,splats:[[0,0,0],[0,.55,.16]].map(at=>({
    at,normal:[0,0,1],radius:.045,thickness:.012,color:'#ff4821',opacity:2.8}))});
  w.write('bind-plan.json',{format:'ink-studio/character-bind-plan',version:1,carriers:[
    {type:'mesh',id:'shell',file:'mesh.json',materials:[{id:'patch',color:'#599e88'}]},
    {type:'splats',id:'cloud',file:'cloud.json',joint},
    {type:'proxy',id:'depth',file:'proxy.json',joints:[joint]}]});
  const binding=w.run('bind','rig.json','bind-plan.json','--out','binding.json');
  assert.deepEqual(binding.carriers.map(carrier=>carrier.mode),['native','rigid','automatic']);
  w.write('zero-targets.json',ik([]));
  w.write('targets.json',ik([{id:'travel',joint,at:[.38,.08,0],tolerance:.0001}],
    {root:{min:[0,0,0],max:[.5,.5,0]}}));
  w.run('solve','rig.json','zero-targets.json','--out','rest.json');
  const pose=w.run('solve','rig.json','targets.json','--out','pose.json','--require-solved');
  assert(pose.solve.passed && pose.rootTranslation[0]>.37);
  w.write('view.json',{w:88,h:88,camera:{target:[.2,.42,0],yaw:0,pitch:0,dist:2,fov:.65,ortho:true}});
  function render(poseName,out){
    return w.run('preview','rig.json','binding.json',poseName,'--view','view.json','--out',out);
  }
  const still=render('rest.json','rest'), posed=render('pose.json','posed');
  const geometry=w.read('posed/'+posed.geometry), report=w.read('posed/'+posed.report);
  const anchors=geometry.carriers.map(row=>row.positions.slice(0,3));
  assert.deepEqual(anchors[0],anchors[1]);
  assert.deepEqual(anchors[0],anchors[2]);
  assert(anchors[0][0]>.37);
  assert(report.carriers.every(row=>row.moved===row.points));
  assert(report.depthProxyPixels>0);
  function redCenter(file){
    const {w:width,h,data}=PNG.raster(file);
    let sum=0,count=0;
    for(let y=0;y<h/2;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(data[i]>190&&data[i+1]<127&&data[i+2]<100){sum+=x;count++;}
    }
    assert(count>3);
    return sum/count;
  }
  assert(redCenter(w.file('posed/'+posed.image))>redCenter(w.file('rest/'+still.image))+8);
  w.write('cloud.json',{format:'ink-studio/character-splats',version:1,splats:[]});
  const failed=w.call('preview','rig.json','binding.json','pose.json','--out','posed');
  assert.equal(failed.status,1);
  assert.match(failed.stderr,/rest asset changed/);
  assert.deepEqual(w.read('posed/latest.json'),posed);
});
