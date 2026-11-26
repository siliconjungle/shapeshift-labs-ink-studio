const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readMaterialGraph,openMaterialGraph,writeMaterialGraph,createGraphProject,runBakeJob,inspectBakeJob,saveBakePreset}=require('..');
const {document}=require('../cli/glb-file.js');
const PNG=require('../cli/png.js');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-bake-jobs-')), at=name=>path.join(root,name);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const doc=document(),d=doc.gltf,add=(v,type)=>doc.accessor(Float32Array.from(v),type,{bounds:type==='VEC3'});
  const p=add([-1,-1,0,1,-1,0,1,1,0,-1,1,0],'VEC3'), uv0=add([0,1,1,1,1,0,0,0],'VEC2');
  const uv1=add([0,1,2,1,2,0,0,0],'VEC2'), idx=doc.accessor(Uint32Array.of(0,1,2,0,2,3),'SCALAR');
  const tex=doc.texture(PNG.encode(2,1,Uint8Array.of(225,82,43,48,114,180),3),'Dual glaze');
  Object.assign(d,{
    nodes:[{mesh:0,name:'Chart'},{mesh:1,name:'Cap'}],
    materials:[{name:'Glaze',pbrMetallicRoughness:{baseColorTexture:{index:tex},roughnessFactor:.27}},
      {name:'Bronze',pbrMetallicRoughness:{baseColorFactor:[.6,.32,.12,1]}}],
    meshes:[{name:'Chart',primitives:[
      {material:0,attributes:{POSITION:p,TEXCOORD_0:uv0,TEXCOORD_1:uv1},indices:idx},
      {material:1,attributes:{POSITION:p,TEXCOORD_0:uv0},indices:idx}]},
      {name:'Cap',primitives:[{material:1,attributes:{POSITION:p,TEXCOORD_0:uv0},indices:idx}]}]
  });
  d.scenes[0].nodes=[0,1];
  fs.writeFileSync(at('mesh.glb'),doc.finish());
  fs.mkdirSync(at('author'));
  const spare=PNG.encode(32,32,new Uint8Array(32*32*3).fill(88),3), tint=PNG.encode(1,1,Uint8Array.of(127,127,255),3);
  fs.writeFileSync(at('author/spare.png'),spare);
  const members=[1001,1002,1003].map(udim=>({udim,source:{file:'spare.png'}}));
  const source={format:'ink-studio/graph-project',version:1,inputs:{tile:{type:'vec2',default:[0,0]}},assets:{
    paint:{format:'bitmap',interpretation:{intent:'color',colorSpace:'srgb'},tiles:members},
    normal:{format:'bitmap',interpretation:{intent:'normal'},source:{base64:tint.toString('base64'),encoding:'png'}}
  },nodes:{
    paint:{op:'bitmapAsset',inputs:{name:'paint',tile:{input:'tile'}}},normal:{op:'bitmapAsset',inputs:{name:'normal',tile:{input:'tile'}}}
  },outputs:{paint:{node:'paint',port:'value'},normal:{node:'normal',port:'value'}}};
  writeMaterialGraph(at('author/seed.material.json'),openMaterialGraph(source,{id:'fixture'}));
  const preset={format:'ink-studio/bake-preset',version:1,label:'Fixture',defaults:{size:32,padding:0},
    maps:[{id:'normal',overrides:{size:16,orientation:'directx'}},{id:'pigment'},{id:'coverage',enabled:false}]};
  const targets=[{id:'chart',mesh:'Chart',submeshes:[0],slots:['Glaze'],uvSet:1,tiles:[1001,1002]}];
  const plan={format:'ink-studio/bake-job',version:1,label:'Fixture',source:'mesh.glb',preset:'preset.json',targets,
    refresh:{material:'author/seed.material.json',bindings:[
      {target:'chart',map:'pigment',resource:'paint',storage:'linked'},
      {target:'chart',map:'normal',resource:'normal',storage:'embedded'}
    ]}};
  saveBakePreset(at('preset.json'),preset);
  fs.writeFileSync(at('job.json'),JSON.stringify(plan));
  return {at,plan,preset,targets};
}

test('a bake job clips selected tiles and preserves authored UVs, order and per-map settings',async t=>{
  const {at}=fixture(t), out=at('out'), progress=[];
  const inspection=await inspectBakeJob(at('job.json'));
  assert.deepEqual(inspection.catalog.map(m=>m.name),['Chart','Cap']);
  assert.deepEqual(inspection.catalog[0].submeshes.map(row=>row.uvSets),[[0,1],[0]]);
  const result=await runBakeJob(at('job.json'),{directory:out,onProgress:e=>progress.push(e)});
  assert.equal(result.status,'completed');
  assert.deepEqual(result.report.maps.map(row=>[row.map,row.tileLabel,row.settings.size]),
    [['normal','1001',16],['normal','1002',16],['pigment','1001',32],['pigment','1002',32]]);
  assert.deepEqual(progress.filter(e=>e.event==='map-finished').map(e=>e.completed),[1,2,3,4]);
  assert(result.report.maps.every(row=>row.coverage>.99));
  const revision=path.dirname(result.file);
  const pixel=row=>{
    const image=PNG.raster(path.join(revision,row.file)), p=(16*image.w+16)*4;
    return Array.from(image.data.slice(p,p+3));
  };
  assert.deepEqual(pixel(result.report.maps[2]),[225,82,43]);
  assert.deepEqual(pixel(result.report.maps[3]),[48,114,180]);
  const material=path.join(revision,result.report.material), doc=readMaterialGraph(material);
  const members=doc.resources.paint.definition.tiles;
  assert.deepEqual(members.map(row=>row.udim),[1001,1002,1003]);
  assert.equal(path.resolve(revision,members[2].source.file),at('author/spare.png'));
  assert(members[0].source.file.startsWith('maps/'));
  const embedded=doc.resources.normal.definition.tiles[0].source;
  assert(embedded.base64&&embedded.origin.startsWith('maps/'));
  const preview=await createGraphProject(doc,{baseDir:revision}).previewFrame({
    p:{output:'paint'},n:{output:'normal'}
  },{inputs:{tile:[1,0]}},{encodeArtifacts:false});
  assert.equal(preview.values.n.descriptor.normalOrientation,'directx');
  assert.equal(preview.values.n.raster.channels,3);
  assert.equal(preview.values.p.raster.width,32);
  assert.equal(preview.values.n.raster.width,16);
});

test('cancellation and an invalid edit preserve the last committed revision',async t=>{
  const {at,preset,targets}=fixture(t), out=at('out');
  const first=await runBakeJob(at('job.json'),{directory:out});
  const pointer=fs.readFileSync(at('out/latest.json')), controller=new AbortController();
  const next=await runBakeJob(at('job.json'),{directory:out,presetValue:{...preset,defaults:{size:512,padding:0}},
    signal:controller.signal,onProgress:e=>{if(e.event==='map-started')controller.abort(new Error('Stop'));}});
  assert.deepEqual(next,{status:'cancelled',latest:first.revision});
  assert.deepEqual(fs.readFileSync(at('out/latest.json')),pointer);
  assert.deepEqual(fs.readdirSync(at('out/revisions')),[first.revision]);
  await assert.rejects(runBakeJob(at('job.json'),{directory:out,targetValues:[{...targets[0],submeshes:[1],slots:['Bronze']}]}),
    /lacks TEXCOORD_1/);
  assert.deepEqual(fs.readFileSync(at('out/latest.json')),pointer);
});

test('a preset can be reordered and applied to one mesh slot without touching the other jobs',async t=>{
  const {at,preset,targets,plan}=fixture(t);
  const ordered={...preset,maps:[{id:'coverage',overrides:{size:24}},{id:'roughness',overrides:{padding:2}},
    {id:'pigment',enabled:false}]};
  saveBakePreset(at('diagnostic.json'),ordered);
  const next={...plan,targets:[{...targets[0],mesh:'Cap',slots:['Bronze'],uvSet:0,tiles:[1001]}]};
  fs.writeFileSync(at('alternate.json'),JSON.stringify(next));
  const result=await runBakeJob(at('alternate.json'),{directory:at('out'),presetFile:at('diagnostic.json')});
  assert.deepEqual(result.report.maps.map(row=>[row.map,row.mesh,row.settings.size,row.settings.padding]),
    [['coverage','Cap',24,0],['roughness','Cap',32,2]]);
  assert(result.report.refresh.every(row=>row.status==='disabled'));
});

test('an active writer owns the publication pointer until its job settles',async t=>{
  const {at}=fixture(t), directory=at('out');
  const first=runBakeJob(at('job.json'),{directory});
  await assert.rejects(runBakeJob(at('job.json'),{directory}),/Another bake job/);
  assert.equal((await first).status,'completed');
});
