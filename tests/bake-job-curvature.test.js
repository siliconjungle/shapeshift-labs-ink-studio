const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {document}=require('../cli/glb-file.js');
const {runBakeJob,inspectBakeJob}=require('../cli/bake-jobs.js');
const {readTexture}=require('../cli/texture-files.js');
const EXR=require('../cli/texture-exr.js');
const PNG=require('../cli/texture-png.js');
const {createGraphProject}=require('../cli/graph-project.js');
const {openMaterialGraph,writeMaterialGraph,readMaterialGraph}=require('../cli/material-graph.js');

const names=['curvature','curvature-convex','curvature-concave'];
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-curvature-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=file=>path.join(root,file), doc=document(), {gltf}=doc;
  function face(p,u0,u1,v0=0,v1=1) {
    const attributes={POSITION:doc.accessor(Float32Array.from(p.flat()),'VEC3',{bounds:true})};
    if(u0!==undefined)attributes.TEXCOORD_0=doc.accessor(Float32Array.of(u0,v1,u1,v1,u1,v0,u0,v0),'VEC2');
    return {indices:doc.accessor(Uint32Array.of(0,1,2,0,2,3),'SCALAR'),attributes};
  }
  const faces=[];
  function fold(offset,height,u) {
    for(const [i,[x,y]] of [[-1,0],[0,1]].entries()) {
      const z=x===0?height:0,w=y===0?height:0;
      faces.push(face([[offset+x,-1,z],[offset+y,-1,w],[offset+y,1,w],[offset+x,1,z]],
        u+.013+i*.158,u+.156+i*.158,.08,.92));
    }
  }
  fold(-3,.55,0);fold(0,-.55,1/3);
  const flat=[[2,-1,0],[4,-1,0],[4,1,0],[2,1,0]];
  faces.push(face(flat,.68,.99,.08,.92),face(flat.map(([x,y])=>[x,y,.125])));
  gltf.meshes=[{name:'Fold set',primitives:faces},
    {name:'Datum',primitives:[face([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],0,1),
      face([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],1,2)]},
    {name:'Adjacent UV islands',primitives:[
      face([[-1,-1,0],[0,-1,0],[0,1,0],[-1,1,0]],0,.5),
      face([[2,-1,0],[3,-1,0],[3,1,0],[2,1,0]],.5,1)]}];
  gltf.nodes=gltf.meshes.map((_,mesh)=>({mesh}));gltf.scenes[0].nodes=[0,1,2];
  fs.writeFileSync(at('reference.glb'),doc.finish());

  const size=64;
  for(const [file,xSign,ySign,format] of [
    ['bulge.exr',1,1,'exr'],['dimple.exr',-1,-1,'exr'],['saddle.exr',1,-1,'exr'],['directx.png',0,-1,'png'],
    ['step.exr',0,0,'exr']
  ]) {
    const X=new Float32Array(size*size),Y=X.slice(),Z=X.slice();
    for(let i=0;i<X.length;i++) {
      X[i]=file==='step.exr'?(i%size<size/2?-.25:.25):xSign*.4*((i%size+.5)/size-.5);
      Y[i]=ySign*.4*((Math.floor(i/size)+.5)/size-.5);
      Z[i]=Math.sqrt(1-X[i]**2-Y[i]**2);
    }
    const bytes=format==='exr'?EXR.write({width:size,height:size,planes:{X,Y,Z}}):
      PNG.write({width:size,height:size,channels:3,alpha:'none',
        data:Uint16Array.from({length:size*size*3},(_,i)=>Math.round((.5+.5*[X,Y,Z][i%3][Math.floor(i/3)])*65535))});
    fs.writeFileSync(at(file),bytes);
  }
  const normalInputs={
    two:{tiles:[{tile:1001,file:'bulge.exr'},{tile:1002,file:'dimple.exr'}]},
    saddle:{file:'saddle.exr'},
    mirroredY:{file:'directx.png',orientation:'directx'},
    step:{file:'step.exr'}
  };
  const p={format:'ink-studio/bake-preset',version:1,label:'Reference',defaults:{size:48,padding:2},maps:[]};
  const ordinary={format:'ink-studio/bake-job',version:1,label:'Curvature reference',source:'reference.glb',normalInputs};
  const bmp=PNG.write({width:2,height:2,channels:1,data:new Uint16Array(4),alpha:'none'}).toString('base64');
  const graph={format:'ink-studio/graph-project',version:1,assets:{values:{format:'bitmap',source:{base64:bmp,encoding:'png'},
    interpretation:{intent:'data',units:'inverse-shape-units'}}},nodes:{value:{op:'bitmapAsset',inputs:{name:'values'}}},
    outputs:{value:{node:'value',port:'value'}}};
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'curvature-reference'}));
  function plan(filename,targets,maps,refresh=false) {
    fs.writeFileSync(at(filename),JSON.stringify({...ordinary,targets,preset:{...p,maps},
      ...(refresh&&{refresh:{material:'seed.material.json',bindings:[{target:targets[0].id,map:'curvature',resource:'values',storage:'linked'}]}})}));
    return runBakeJob(at(filename),{directory:at(filename+'-review')});
  }
  return {at,plan};
}
function output(baked,map,tile='1001') {
  const row=baked.report.maps.find(r=>r.map===map&&r.tileLabel===tile);
  const {width,height,data,bitDepth}=readTexture(path.join(path.dirname(baked.file),row.file));
  return {row,bitDepth,at:(u,v)=>data[Math.floor(v*height)*width+Math.floor(u*width)]};
}
const maps=overrides=>names.map(id=>({id,overrides}));
const equal=(a,b,tolerance=2e-5)=>assert(Math.abs(a-b)<=tolerance,'Expected '+b+' but got '+a);

test('mesh folds carry opposite signed curvature across UV seams, and a flat covered plate only has cavity',async t=>{
  const {at,plan}=setup(t), targets=[{id:'folds',mesh:'Fold set',submeshes:[0,1,2,3,4]}];
  const job=await plan('mesh.json',targets,[...maps({encoding:'exr'}),{id:'cavity',overrides:{cavityRadius:.65,samples:24}}]);
  const convex=output(job,'curvature-convex'), concave=output(job,'curvature-concave'), signed=output(job,'curvature');
  assert(signed.at(.135,.5)>.08);
  assert(signed.at(.467,.5)<-.08);
  assert.equal(concave.at(.135,.5),0);
  assert.equal(convex.at(.467,.5),0);
  assert.equal(signed.at(.82,.5),0);
  assert(output(job,'cavity').at(.82,.5)>100);
  assert(signed.row.curvature.boundaryEdges>0);
  const separated=await plan('charts.json',targets,maps({encoding:'exr',edgePolicy:'chart'}));
  assert.equal(output(separated,'curvature').at(.135,.5),0);
  const smooth=await plan('smooth.json',targets,maps({encoding:'exr',curvatureScale:2}));
  assert(output(smooth,'curvature-convex').row.curvature.peak<convex.row.curvature.peak);
  const packed=await plan('normalize.json',targets,maps({encoding:'png16',normalization:'manual',curvatureRange:.08}),true);
  const encoded=output(packed,'curvature');
  assert.equal(encoded.at(.135,.5),65535);
  assert.equal(encoded.at(.467,.5),0);
  assert(encoded.row.output.clipped>0);
  const baseDir=path.dirname(packed.file), material=readMaterialGraph(path.join(baseDir,packed.report.material));
  assert.deepEqual(material.resources.values.definition.interpretation.valueRange,[-.08,.08]);
  const graph=await createGraphProject(material,{baseDir}).previewFrame({v:{output:'value'}},{},{encodeArtifacts:false});
  assert.equal(graph.values.v.descriptor.units,'inverse-shape-units');
  assert(graph.values.v.raster.data.some(v=>v<-.079));
  await assert.rejects(()=>inspectBakeJob(at('mesh.json'),{presetValue:{...job.report.preset,maps:maps({
    curvatureSource:'normal',normalInput:'missing'
  })}}),/Unknown curvature normal input/);
});

test('normal input computes principal lobes, shares tile normalization, and protects chart edges',async t=>{
  const {plan}=setup(t), targets=[{id:'datum',mesh:'Datum',tiles:[1001,1002]}];
  const from=normalInput=>({curvatureSource:'normal',normalInput,curvatureScale:2});
  const job=await plan('normal.json',targets,maps({...from('two'),encoding:'png16'}));
  const signed=output(job,'curvature'), other=output(job,'curvature','1002');
  assert.deepEqual(signed.row.output.range,other.row.output.range);
  assert.deepEqual(signed.row.output.range[1],output(job,'curvature-concave','1002').row.output.range[1]);
  equal(signed.row.output.range[1],.2);
  assert(signed.at(.5,.5)>65530);
  assert(other.at(.5,.5)<5);
  assert.equal(signed.row.curvature.unknown,0);

  const saddle=await plan('saddle.json',[{id:'saddle',mesh:'Datum',tiles:[1001]}],maps({...from('saddle'),encoding:'exr'}));
  equal(output(saddle,'curvature').at(.5,.5),0);
  equal(output(saddle,'curvature-convex').at(.5,.5),.1);
  equal(output(saddle,'curvature-concave').at(.5,.5),.1);

  const dx=await plan('dx.json',[{id:'dx',mesh:'Datum',tiles:[1001]}],maps({...from('mirroredY'),encoding:'exr',edgePolicy:'strict'}));
  const data=output(dx,'curvature');
  equal(data.at(.5,.5),.1,.002);
  assert.equal(data.at(0,.5),0);
  assert.equal(data.row.curvature.unknown,48*48-44*44);

  const islands=await plan('islands.json',[{id:'islands',mesh:'Adjacent UV islands'}],maps({...from('step'),encoding:'exr'}));
  assert.equal(output(islands,'curvature').at(.49,.5),0);
  assert.equal(output(islands,'curvature').at(.51,.5),0);
});
