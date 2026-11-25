'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const {KIT}=ink.load();

const width=24,height=22,camera={type:'orthographic',height:2.2};
const config={resolution:.08,truncation:.26,supportTolerance:.105,conflictTolerance:.10};
const approval={by:'Set artist',reason:'Use the approved construction profile'};
const fill={id:'insert',vertices:[[-.20,-.20,0],[.10,-.20,0],[.10,.17,0],[-.20,.17,0]],
  triangles:[[0,1,2],[0,2,3]],color:[224,152,68],approval};

function flatInputs({conflicting=true}={}) {
  return ['left','right'].map((id,view)=>{
    const position=[view*.1,0,3], rotation=[0,0,0,1];
    const depth=new Float32Array(width*height), colors=new Uint8Array(width*height*4);
    for (let i=0;i<depth.length;i++) {
      const x=position[0]+(i%width-(width-1)/2)*.1;
      const y=((height-1)/2-Math.floor(i/width))*.1;
      if (Math.abs(x+.05)<.38&&Math.abs(y)<.38) continue;
      depth[i]=3+(view&&conflicting&&x<-.63 ? .155 : 0);
      colors.set(x>.55&&Math.abs(y-.1)<.06 ? [250,196,87,255] : [42,129,113,255],i*4);
    }
    return {id,pose:{position,rotation},capture:{width,height,depth,camera,maxDepthJump:.20,
      image:{width,height,data:colors,channels:4}}};
  });
}

function cast(world,x,y) {
  const ray={origin:[x,y,2],direction:[0,0,-1],maxDistance:4};
  return world.meshes.map(mesh=>KIT.sceneMeshes.rayQuery(mesh,KIT)(ray)).filter(Boolean);
}

test('fusion retains disagreements, open boundaries, and approved fill in an editable proxy',async()=>{
  const inputs=flatInputs(), original=await ink.scanFusion(inputs,config);
  const fused=await ink.scanFusion(inputs,{...config,fills:[fill]});
  assert(fused.report.faces.observed>0);
  assert(fused.report.faces.conflict>0);
  assert(fused.report.openBoundaryEdges>0);
  assert(fused.report.fieldSamples.multiView>0);
  assert(fused.report.fieldSamples.unsupported>0);
  assert.equal(fused.report.faces['approved-fill'],2);
  const evidence=fused.evidence.faces.filter(face=>face.status==='conflict');
  assert(evidence.some(face=>face.views.length===2&&
    Math.max(...face.views.map(v=>v.delta))-Math.min(...face.views.map(v=>v.delta))>.1));
  assert.deepEqual(fused.evidence.faces.filter(face=>face.status==='approved-fill').map(face=>face.approval),[approval,approval]);
  const ids=new Set(fused.proxy.faces.map(face=>face.id));
  assert(fused.evidence.boundaries.every(edge=>edge.status==='unobserved'&&ids.has(edge.face)));
  assert.deepEqual(fused.proxy.faces.slice(0,original.proxy.faces.length),original.proxy.faces);
  assert.equal(cast(await original.world('mesh'),0,0).length,0);
  const hybrid=await fused.world(), proxyOnly=await fused.world('mesh'), diagnostic=await fused.world('evidence');
  assert.equal(cast(proxyOnly,0,0).length,1);
  assert.equal(cast(proxyOnly,.27,0).length,0,'untouched opening remains unmeasured');
  assert.equal(proxyOnly.count,0);
  assert(fused.report.residualSplats>0);
  assert.equal(hybrid.count,fused.report.residualSplats);
  assert.equal((await fused.world('source')).count,fused.report.sourceSplats);
  assert.equal(diagnostic.meshes.length,4);
  const proxy=KIT.meshTopology.create(JSON.parse(JSON.stringify(fused.proxy)));
  const vertex=proxy.vertices[0], position=vertex.position.map((value,i)=>i===2 ? value+.012 : value);
  assert.deepEqual(KIT.meshTopology.edit(proxy,{vertices:[{id:vertex.id,position}]}).vertices[0].position,position);
  const reordered=await ink.scanFusion(inputs.slice().reverse(),{...config,fills:[fill]});
  assert.deepEqual(reordered.glb,fused.glb);
  assert.deepEqual(reordered.evidence,fused.evidence);
});

test('a rotated calibrated perspective view adds coverage in the shared frame without inventing a conflict',async()=>{
  const z=3, angle=.34, {V,M,Q}=KIT;
  const rotation=Q.fromAxisAngle([0,1,0],angle), matrix=Q.toMatrix(rotation), position=[.65,0,z];
  const optics={type:'perspective',fx:34,fy:32,cx:11.2,cy:10.3};
  const depth=Float32Array.from({length:width*height},(_,i)=>{
    const ray=M.app(matrix,[(i%width-optics.cx)/optics.fx,(optics.cy-Math.floor(i/width))/optics.fy,-1]);
    const d=-z/ray[2], p=V.mad(position,ray,d);
    return Math.abs(p[0])<1.19&&Math.abs(p[1])<1.03 ? d : 0;
  });
  const [first]=flatInputs({conflicting:false});
  const {capture}=first;
  for (let i=0;i<capture.depth.length;i++) if (i%width>=15) capture.depth[i]=0;
  const second={id:'perspective',pose:{position,rotation},capture:{width,height,depth,
    camera:optics,maxDepthJump:.15}};
  const result=await ink.scanFusion([first,second],{...config,residualLimit:0});
  assert(result.report.fieldSamples.multiView>0);
  const fused=await result.world('hybrid');
  const hit=cast(fused,.60,.65);
  assert(hit.some(row=>Math.abs(row.point[2])<.018));
  assert(result.evidence.faces.some(face=>face.primary==='perspective'&&face.views.some(v=>v.id==='perspective'&&v.aligned)));
  assert.equal(result.report.faces.conflict,0);
  assert.equal(fused.count,0);
});

test('guards approved patches, registered poses, and reconstruction work',async()=>{
  const inputs=flatInputs();
  await assert.rejects(ink.scanFusion(inputs,{...config,fills:[{...fill,approval:undefined}]}),/approval/);
  await assert.rejects(ink.scanFusion(inputs,{...config,fills:[{...fill,vertices:
    fill.vertices.map(p=>[p[0]+.75,p[1],p[2]])}]}),/known free space/);
  await assert.rejects(ink.scanFusion([inputs[0],{...inputs[1],pose:{position:[0,0,3],rotation:[0,0,0,2]}}],config),/registered scan view/);
  await assert.rejects(ink.scanFusion(inputs,{...config,maxCells:12}),/cell budget/);
});

test('CLI writes a registered hybrid, diagnostic GLB, atlas and restorable topology from relative capture paths',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-scan-fusion-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const views=flatInputs().map(({id,capture,pose})=>{
    const {depth,image,...opts}=capture;
    fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({...opts,depth:Array.from(depth)}));
    fs.writeFileSync(path.join(dir,id+'.png'),require('../cli/png.js').encode(width,height,image.data,4));
    return {id,pose,depth:id+'.json',image:id+'.png'};
  });
  const manifest={format:'ink-studio/scan-fusion',version:1,name:'Test survey',views,
    fills:[fill],options:{...config,residualLimit:10}};
  fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(manifest));
  const output=path.join(dir,'hatch.glb');
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'scan-fuse',path.join(dir,'plan.json'),'--out',output]);
  const read=ext=>JSON.parse(fs.readFileSync(path.join(dir,'hatch.'+ext+'.json'),'utf8'));
  const main=await ink.readGaussianGltf(output);
  const diagnostic=await ink.readGaussianGltf(path.join(dir,'hatch.evidence.glb'));
  assert.equal(diagnostic.meshes.length,4);
  assert.equal(main.count,read('scan').residualSplats);
  assert.equal(KIT.meshTopology.create(read('proxy')).faces.length,read('evidence').faces.length);
  assert(fs.statSync(path.join(dir,'hatch.atlas.png')).size>100);
});
