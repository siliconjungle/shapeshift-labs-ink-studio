const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {document}=require('../cli/glb-file.js');
const {runBakeJob,inspectBakeJob}=require('../cli/bake-jobs.js');
const {readTexture}=require('../cli/texture-files.js');
const {createGraphProject}=require('../cli/graph-project.js');
const {openMaterialGraph,writeMaterialGraph,readMaterialGraph}=require('../cli/material-graph.js');
const PNG=require('../cli/png.js');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-bake-occlusion-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=file=>path.join(root,file), doc=document(), {gltf}=doc;
  function face(points,uv=false) {
    const attributes={POSITION:doc.accessor(Float32Array.from(points.flat()),'VEC3',{bounds:true})};
    if(uv)attributes.TEXCOORD_0=doc.accessor(Float32Array.of(0,1,1,1,1,0,0,0),'VEC2');
    return {attributes,indices:doc.accessor(Uint32Array.of(0,1,2,0,2,3),'SCALAR')};
  }
  const ground=face([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],true);
  const wall=face([[.27,-3,0],[.27,3,0],[.27,3,1.5],[.27,-3,1.5]]);
  const roof=face([[-5,-5,0],[-5,5,0],[5,5,0],[5,-5,0]]);
  gltf.meshes=[{name:'Deck',primitives:[ground,wall]},{name:'Roof',primitives:[roof]},{name:'Open',primitives:[ground]}];
  gltf.nodes=[{mesh:0,translation:[0,0,.5]},{mesh:1,translation:[0,0,.75]},{mesh:2,translation:[15,0,.5]}];
  gltf.scenes[0].nodes=[0,1,2];
  fs.writeFileSync(at('deck.glb'),doc.finish());

  const encoded=PNG.encode(1,1,Uint8Array.of(128,128,128)).toString('base64');
  const spec={direction:{intent:'data',layout:'xyz'},bent:{intent:'normal',normalSpace:'world'}};
  const assets=Object.fromEntries(Object.entries(spec).map(([id,interpretation])=>[id,{format:'bitmap',interpretation,
    source:{encoding:'png',base64:encoded}}]));
  const graph={format:'ink-studio/graph-project',version:1,assets,
    nodes:Object.fromEntries(Object.keys(spec).map(name=>[name,{op:'bitmapAsset',inputs:{name}}])),
    outputs:Object.fromEntries(Object.keys(spec).map(node=>[node,{node,port:'value'}]))};
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'occlusion-fixture'}));

  const same={rays:64,spread:90,range:2,bias:0,selfOcclusion:'only'};
  const preset={format:'ink-studio/bake-preset',version:1,label:'Wall and roof',defaults:{size:24,padding:0},maps:[
    {id:'ao',overrides:{...same,encoding:'png16'}},
    {id:'bent-normal',overrides:{...same,encoding:'exr'}},
    {id:'occlusion-direction',overrides:{...same,encoding:'png16'}},
    {id:'ao-contact',overrides:{...same,range:.07}},
    {id:'ao-directional',overrides:{rays:8,spread:0,range:1,bias:0,direction:[0,0,2],
      falloff:'linear',selfOcclusion:'exclude',encoding:'exr'}}
  ]};
  const targets=[{id:'deck',mesh:'Deck',submeshes:[0]},{id:'clear',mesh:'Open'}];
  const job={format:'ink-studio/bake-job',version:1,label:'Occlusion reference',source:'deck.glb',preset,targets,
    refresh:{material:'seed.material.json',bindings:[
      {target:'clear',map:'occlusion-direction',resource:'direction',storage:'embedded'},
      {target:'deck',map:'bent-normal',resource:'bent',storage:'linked'}
    ]}};
  fs.writeFileSync(at('job.json'),JSON.stringify(job));
  return {at,preset,targets};
}

function read(result,map,target='deck',x=11,y=11) {
  const row=result.report.maps.find(item=>item.map===map&&item.target===target);
  const image=readTexture(path.join(path.dirname(result.file),row.file)), i=(y*image.width+x)*image.channels;
  return {row,image,value:Array.from(image.data.slice(i,i+image.channels))};
}

test('occlusion variants separate same-mesh and neighboring blockers and share vector rays',async t=>{
  const {at}=fixture(t), baked=await runBakeJob(at('job.json'),{directory:at('review')});
  const ao=read(baked,'ao'), bent=read(baked,'bent-normal'), direction=read(baked,'occlusion-direction');
  assert(ao.value[0]>32767&&ao.value[0]<60000);
  assert.equal(ao.image.bitDepth,16);
  assert(bent.value[0]<-.2);
  assert(Math.abs(Math.hypot(...bent.value)-1)<1e-6);
  assert(direction.value[0]/65535*2-1>.55);
  assert.deepEqual(bent.row.occlusion,ao.row.occlusion);
  assert.deepEqual(direction.row.occlusion,ao.row.occlusion);
  assert.equal(ao.row.occlusion.rayCount,24*24*64);
  assert(ao.row.occlusion.blockedRays>0);
  assert.deepEqual(read(baked,'ao-contact').value,[255]);
  assert.deepEqual(read(baked,'ao','clear').value,[65535]);
  assert.deepEqual(read(baked,'bent-normal','clear').value.map(n=>Math.abs(n)<1e-7?0:n),[0,0,1]);
  assert.deepEqual(read(baked,'occlusion-direction','clear').value,[32768,32768,32768]);
  assert.deepEqual(read(baked,'ao-directional').value,[.25]);
  assert.deepEqual(read(baked,'ao-directional').row.occlusion.direction,[0,0,1]);
  const baseDir=path.dirname(baked.file), doc=readMaterialGraph(path.join(baseDir,baked.report.material));
  const graph=await createGraphProject(doc,{baseDir}).previewFrame({
    direction:{output:'direction'},bent:{output:'bent'}
  },{},{encodeArtifacts:false});
  assert.equal(graph.values.direction.descriptor.layout,'xyz');
  assert.equal(graph.values.direction.descriptor.intent,'data');
  assert.deepEqual(Array.from(graph.values.direction.raster.data.slice(0,3)),[0,0,0]);
  assert.equal(graph.values.bent.descriptor.normalSpace,'world');
});

test('a known roof verifies spread, bias, range, falloff and neutral empty-hemisphere behavior',async t=>{
  const {at,preset}=fixture(t);
  const beam={rays:8,spread:0,direction:[0,0,1],range:1,bias:0,selfOcclusion:'all',encoding:'exr'};
  const replan=maps=>({...preset,maps}), bake=(folder,maps)=>runBakeJob(at('job.json'),{
    directory:at(folder),presetValue:replan(maps)});
  const ranged=await bake('range', [
    {id:'ao',overrides:{...beam,range:.125}},
    {id:'ao-contact',overrides:{...beam,bias:.1,falloff:'smooth'}},
    {id:'ao-directional',overrides:{...beam,direction:[0,0,-1]}},
    {id:'bent-normal',overrides:beam},{id:'occlusion-direction',overrides:beam}
  ]);
  assert.deepEqual(read(ranged,'ao').value,[1]);
  assert(Math.abs(read(ranged,'ao-contact').value[0]-.06075)<2e-7);
  const empty=read(ranged,'ao-directional');
  assert.deepEqual(empty.value,[1]);
  assert.equal(empty.row.occlusion.emptyLobes,24*24);
  assert.equal(empty.row.occlusion.rejectedRays,8*24*24);
  assert.deepEqual(read(ranged,'bent-normal').value,[0,0,1]);
  assert.deepEqual(read(ranged,'occlusion-direction').value,[0,0,1]);
  const clip=await inspectBakeJob(at('job.json'),{presetValue:replan([{id:'ao',overrides:{rays:128,spread:90}}])});
  assert.equal(clip.preset.maps[0].overrides.rays,128);
  await assert.rejects(()=>inspectBakeJob(at('job.json'),{presetValue:replan([{id:'ao',overrides:{bias:1,range:.1}}])}),
    /bias below range/);
});
