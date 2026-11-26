const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {document}=require('../cli/glb-file.js');
const {runBakeBatch,latestBakeBatch}=require('../cli/bake-batch.js');
const {readTexture}=require('../cli/texture-files.js');
const {openMaterialGraph,readMaterialGraph,writeMaterialGraph}=require('../cli/material-graph.js');
const PNG=require('../cli/png.js');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-batch-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=name=>path.join(root,name), save=(name,json)=>fs.writeFileSync(at(name),JSON.stringify(json));
  const doc=document(),{gltf}=doc;
  function tile(u) {
    const points=[[u+.1,.1],[u+.9,.1],[u+.9,.9],[u+.1,.9]];
    return {attributes:{
      POSITION:doc.accessor(Float32Array.from(points.flatMap(([x,y])=>[x,y,0])),'VEC3',{bounds:true}),
      TEXCOORD_0:doc.accessor(Float32Array.from(points.flat()),'VEC2')
    },indices:doc.accessor(Uint16Array.of(0,1,2,0,2,3),'SCALAR')};
  }
  gltf.meshes=[{name:'Triptych',primitives:[-1,0,1].map(tile)}];gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(at('plate.glb'),doc.finish());
  function texture(file,rgb) {
    fs.writeFileSync(at(file),PNG.encode(2,2,Uint8Array.from([...rgb,...rgb,...rgb,...rgb]),3,{srgb:true}));
  }
  texture('west.png',[220,132,37]);texture('axis.png',[167,33,79]);texture('east.png',[26,141,204]);
  const bindings=[{target:'panels',map:'pigment',resource:'enamel',storage:'linked'}];
  const blank=fs.readFileSync(at('axis.png')).toString('base64');
  const graph={format:'ink-studio/graph-project',version:1,assets:{
    enamel:{format:'bitmap',source:{encoding:'png',base64:blank},interpretation:{intent:'color',colorSpace:'srgb'}}
  },nodes:{sample:{op:'bitmapAsset',inputs:{name:'enamel'}}},outputs:{enamel:{node:'sample',port:'value'}}};
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'batch-fixture'}));
  const plan={format:'ink-studio/bake-job',version:1,source:'plate.glb',label:'Painted triptych',
    targets:[{id:'panels',mesh:0}],textureInputs:{glaze:{tiles:[
      {tile:[-1,0],file:'west.png'},{tile:1001,file:'axis.png'},{tile:1002,file:'east.png'}
    ]}},preset:{format:'ink-studio/bake-preset',version:1,label:'Triptych maps',defaults:{size:32,padding:2},
      maps:[{id:'pigment',overrides:{textureInput:'glaze',width:17,height:13,antialiasing:2,mipmaps:1}},{id:'coverage'}]}};
  save('enamel.bake.json',{...plan,refresh:{material:'seed.material.json',bindings}});
  save('edge.bake.json',{...plan,label:'Reference tile'});
  const batch={format:'ink-studio/bake-batch',version:1,label:'Tile bake',workers:3,memoryMb:600,
    tileSets:{trim:[[ -1,0],1001,1002],reference:[1001]},jobs:[
      {id:'wide',job:'enamel.bake.json',heapMb:128,tiles:{panels:'trim'},
        aliases:[{name:'glaze',target:'panels',map:'pigment'}]},
      {id:'sample',job:'edge.bake.json',heapMb:128,tiles:{panels:'reference'},
        aliases:[{name:'control',target:'panels',map:'coverage'}]}
    ]};
  async function run(changes={},options={}) {
    save('batch.json',{...batch,...changes});
    return runBakeBatch(at('batch.json'),{directory:at('output'),...options});
  }
  return {at,save,plan,batch,run,texture};
}
const read=(result,file)=>JSON.parse(fs.readFileSync(path.join(path.dirname(result.file),file),'utf8'));
const pixels=(result,row)=>readTexture(path.join(path.dirname(result.file),row.file)).data;

test('batch aliases, bounded parallelism, incremental UDIM refresh and cache integrity',async t=>{
  const {at,run,texture,batch,save,plan}=fixture(t), events=[];
  const cold=await run({},{onProgress:row=>events.push(row)});
  assert.deepEqual(cold.data.totals,{units:4,baked:4,cached:0});
  assert.equal(cold.data.limits.peakWorkers,2);
  assert(cold.data.limits.peakReservedMiB<=600);
  assert(events.filter(row=>row.event==='unit-started').every(row=>row.reservedMiB<=600));
  const [wide]=cold.data.jobs, [alias]=wide.aliases;
  assert.deepEqual(alias.tiles.map(row=>path.basename(row.file)),['glaze.u-1_v0.png','glaze.1001.png','glaze.1002.png']);
  assert.match(alias.tiles[2].mips[0].file,/glaze\.1002\.mip-1\.png$/);
  const report=read(cold,wide.report);
  assert.deepEqual(report.maps.map(row=>row.tileLabel),['[-1, 0]','1001','1002','[-1, 0]','1001','1002']);
  assert(report.maps.every(row=>report.uvDebug[row.uvDebug].tileLabel===row.tileLabel));
  assert(report.maps.every(row=>row.previewFile===undefined));
  const materialPath=path.join(path.dirname(cold.file),'jobs/wide/material.material.json');
  const material=readMaterialGraph(materialPath);
  assert.deepEqual(material.resources.enamel.definition.tiles.map(tile=>tile.uv),[[-1,0],[0,0],[1,0]]);
  for(const tile of material.resources.enamel.definition.tiles)
    assert(fs.existsSync(path.resolve(path.dirname(materialPath),tile.source.file)));

  // The effective source recipe survives whitespace and a different alias.
  save('enamel.bake.json',{refresh:{material:'seed.material.json',bindings:[
    {target:'panels',map:'pigment',resource:'enamel',storage:'linked'}
  ]},...plan});
  const named=batch.jobs.map(job=>job.id==='wide'?{...job,aliases:[{name:'renamed',target:'panels',map:'pigment'}]}:job);
  const warm=await run({jobs:named,memoryMb:256});
  assert.deepEqual(warm.data.totals,{units:4,baked:0,cached:4});
  assert.equal(warm.data.limits.peakWorkers,0);
  assert.deepEqual(warm.data.jobs[0].aliases[0].tiles.map(row=>row.sha256),alias.tiles.map(row=>row.sha256));

  texture('east.png',[8,245,122]);
  const update=await run({jobs:named});
  assert.deepEqual(update.data.totals,{units:4,baked:1,cached:3});
  assert.deepEqual(update.data.jobs[0].units.map(row=>row.status),['cached','cached','baked']);
  const changed=update.data.jobs[0].aliases[0].tiles;
  assert.deepEqual(changed.slice(0,2).map(row=>row.sha256),alias.tiles.slice(0,2).map(row=>row.sha256));
  assert.notEqual(changed[2].sha256,alias.tiles[2].sha256);
  assert(pixels(update,changed[2]).some((n,i)=>i%4===1&&n>50000));
  assert.equal(latestBakeBatch(at('output')).revision,update.revision);

  const cacheDir=at('output/ink-bake-cache-v1');
  const key=fs.readdirSync(cacheDir).find(key=>/^[a-f0-9]{64}$/.test(key));
  const receipt=JSON.parse(fs.readFileSync(path.join(cacheDir,key,'cache.json'),'utf8'));
  const artifact=receipt.files.find(row=>row.name.endsWith('.png'));
  fs.writeFileSync(path.join(cacheDir,key,artifact.name),'damaged');
  const repaired=await run({jobs:named});
  assert.deepEqual(repaired.data.totals,{units:4,baked:1,cached:3});
  assert.deepEqual(repaired.data.jobs[0].aliases[0].tiles.map(row=>row.sha256),changed.map(row=>row.sha256));

  await assert.rejects(()=>run({cache:{policy:'off'},memoryMb:256}),/exceeds.*memory budget/);
  const controller=new AbortController();
  const cancelled=await run({cache:{policy:'off'}},{signal:controller.signal,
    onProgress:row=>{if(row.event==='unit-started')controller.abort(new Error('Cancelled in test'));}});
  assert.equal(cancelled.status,'cancelled');
  assert.equal(latestBakeBatch(at('output')).revision,repaired.revision);
});

test('tile sets with target-wide normalization remain together in one work unit',async t=>{
  const {save,run,plan}=fixture(t);
  const preset={...plan.preset,maps:[{id:'curvature',overrides:{encoding:'png16'}}]};
  save('curve.bake.json',{...plan,preset});
  const baked=await run({jobs:[{id:'shape',job:'curve.bake.json',heapMb:128,tiles:{panels:'trim'}}]});
  assert.deepEqual(baked.data.totals,{units:1,baked:1,cached:0});
  assert.equal(baked.data.jobs[0].units[0].targets[0].tiles.length,3);
  assert.equal(read(baked,baked.data.jobs[0].report).maps.length,3);
});
