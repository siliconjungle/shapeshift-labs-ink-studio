const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { document } = require('../cli/glb-file.js');
const { runBakeJob, latestBakeJob } = require('../cli/bake-jobs.js');
const { readTexture } = require('../cli/texture-files.js');

function fixture(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-debug-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const at=file=>path.join(folder,file);
  function source(file,overlap) {
    const doc=document(),{gltf}=doc;
    const a=[.625,.125],b=[1.375,.125],c=[1.375,.5],d=[.625,.5];
    const primitive=(uv,indices,z=0)=>({
      attributes:{
        POSITION:doc.accessor(Float32Array.from(uv.flatMap(([u,v])=>[u,v,z])),'VEC3',{bounds:true}),
        TEXCOORD_0:doc.accessor(Float32Array.from(uv.flat()),'VEC2')
      },
      indices:doc.accessor(Uint16Array.from(indices),'SCALAR')
    });
    const details=[
      primitive([a,b,c],[0,1,2]),primitive([a,c,d],[0,1,2]),
      primitive([[.125,.625],[.375,.625],[.375,.875],[.125,.875]],[0,2,1,0,3,2],1),
      primitive([[.001,.001],[.008,.001],[.001,.008]],[0,1,2],2)
    ];
    if(overlap)details.push(primitive([a,b,c,d],[0,1,2,0,2,3],3));
    gltf.meshes=[{name:'Workbench',primitives:details}];gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
    fs.writeFileSync(at(file),doc.finish());
  }
  source('normal.glb',false);source('overlap.glb',true);
  function run(name,maps,{source='normal.glb',directory=name}={}) {
    const job={format:'ink-studio/bake-job',version:1,label:name,source,
      targets:[{id:'panel',mesh:'Workbench',tiles:[1001,1002]}],
      preset:{format:'ink-studio/bake-preset',version:1,label:'UV review',defaults:{size:32,padding:2},maps}};
    fs.writeFileSync(at(name+'.json'),JSON.stringify(job));
    return runBakeJob(at(name+'.json'),{directory:at(directory)});
  }
  return {at,run};
}

const maps=['coverage','uv-outline'].map(id=>({id}));
const rgbaAt=(image,x,y)=>[...image.data.slice((y*image.width+x)*4,(y*image.width+x)*4+4)];

test('UV debug exports vector footprints and native ownership on both sides of a tile seam',async t=>{
  const {at,run}=fixture(t), baked=await run('review',[...maps,{id:'pigment',overrides:{size:64,padding:0}}]);
  const folder=path.dirname(baked.file), report=baked.report;
  assert.equal(report.uvDebug.length,4);
  const read=file=>readTexture(path.join(folder,file));
  const xml=file=>fs.readFileSync(path.join(folder,file),'utf8');
  const row=(map,tile)=>report.maps.find(r=>r.map===map&&r.tileLabel===String(tile));
  const debug=(map,tile)=>report.uvDebug[row(map,tile).uvDebug];
  const a=debug('coverage',1001), b=debug('coverage',1002), doubled=debug('pigment',1001);
  assert.equal(a.texels,12*12+8*8);
  assert.equal(b.texels,12*12);
  assert.equal(a.charts,3);assert.equal(b.charts,1);
  assert(a.gutters>0);assert.equal(doubled.gutters,0);
  assert.equal(a.files.coverageSvg,doubled.files.coverageSvg);
  assert.equal(a.files.outlineSvg,doubled.files.outlineSvg);
  assert.equal(a.files.coverage,row('coverage',1001).file);
  assert.equal(a.files.outline,row('uv-outline',1001).file);
  assert.equal(a.palette[0].id,b.palette[0].id);
  assert.equal(a.palette[0].color,b.palette[0].color);
  assert.equal(a.palette[2].texels,0);

  const coverage=read(a.files.coverage), owner=read(a.files.ownership), across=read(b.files.ownership);
  assert.equal(coverage.data[8*32+28],255);
  assert.equal(coverage.data[8*32+19],0);
  assert.equal(rgbaAt(owner,19,8)[3],110);
  assert.deepEqual(rgbaAt(owner,31,8),rgbaAt(across,0,8));
  const lines=xml(a.files.outlineSvg).match(/<path data-chart="1".*? d="([^"]+)"/)[1];
  assert.equal(lines.match(/M/g).length,3);
  assert.match(lines,/M0\.625 0\.125L1 0\.125/);
  assert(!lines.includes('M0.625 0.125L1 0.3125'));
  assert(!lines.includes('M1 0.125L1 0.5'));
  assert.match(xml(a.files.coverageSvg),/data-chart="3"/);
  const outline=read(a.files.outline);
  assert.equal(rgbaAt(outline,31,8)[3],0);
  assert.equal(rgbaAt(outline,31,4)[3],255);
  assert.equal(read(doubled.files.ownership).width,64);

  const toolkit=require('../index.js').load(), {KIT:K}=toolkit;
  const Meshes=require('../cli/bake-job-mesh.js'), sample=require('../cli/glb-bake.js');
  const model=Meshes.load(at('normal.glb'),folder);
  const selection=Meshes.meshFor(model,{id:'ref',mesh:0,uvSet:0,tiles:[[0,0],[1,0]]},K,new Map());
  for(const [i,tile] of selection.tiles.entries()) {
    const original=sample(tile.mesh,tile.faces,tile.uvs,tile.normals,32,2,K,
      {registered:true,chartBake:{state:{faceCharts:tile.faces.map(()=>0)}}}).registeredMaps.coverage;
    assert.deepEqual(fs.readFileSync(path.join(folder,[a,b][i].files.coverage)),original);
  }
});

test('UV-only inspection reports overlaps and a failing material bake keeps the last diagnostic revision',async t=>{
  const {at,run}=fixture(t);
  const diagnostic=await run('diagnostic',maps,{source:'overlap.glb'});
  const [row]=diagnostic.report.uvDebug;
  assert(row.overlaps>0);
  const owner=readTexture(path.join(path.dirname(diagnostic.file),row.files.ownership));
  assert.deepEqual(rgbaAt(owner,24,10),[255,77,117,255]);
  await assert.rejects(()=>run('material',[{id:'pigment'},...maps],{source:'overlap.glb',directory:'diagnostic'}),/UV islands overlap/);
  assert.equal(latestBakeJob(at('diagnostic')).revision,diagnostic.revision);
});
