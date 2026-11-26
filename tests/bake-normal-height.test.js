const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectBakeJob, runBakeJob } = require('../cli/bake-jobs.js');
const { readTexture } = require('../cli/texture-files.js');
const { createGraphProject } = require('../cli/graph-project.js');
const { openMaterialGraph, writeMaterialGraph, readMaterialGraph } = require('../cli/material-graph.js');
const PNG = require('../cli/png.js');
const { writeReference } = require('../examples/bake-normal-height/reference.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-normal-height-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=name=>path.join(root,name), expected=writeReference(root);
  const neutral=PNG.encode(2,2,new Uint8Array(12).fill(128)).toString('base64');
  const blank=PNG.encodeGray(2,2,new Uint8Array(4)).toString('base64');
  const interpretation={surface:{intent:'normal',normalSpace:'world'}, relief:{intent:'height'}};
  const assets=Object.fromEntries(Object.entries({surface:neutral,relief:blank}).map(([name,base64])=>
    [name,{format:'bitmap',interpretation:interpretation[name],source:{encoding:'png',base64}}]));
  const graph={format:'ink-studio/graph-project',version:1,inputs:{tile:{type:'vec2',default:[0,0]}},assets,
    nodes:Object.fromEntries(Object.keys(assets).map(name=>[name,{op:'bitmapAsset',inputs:{name,tile:{input:'tile'}}}])),
    outputs:Object.fromEntries(Object.keys(assets).map(node=>[node,{node,port:'value'}]))};
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'normal-height-check'}));
  const p={format:'ink-studio/bake-preset',version:1,label:'Known signed planes',defaults:{size:32,padding:2},maps:[
    {id:'normal',overrides:{encoding:'png16'}},{id:'world-normal',overrides:{encoding:'exr'}},
    {id:'height',overrides:{encoding:'png16',normalization:'minmax'}},{id:'cage-hit'}
  ]};
  const target={id:'plates',mesh:'low',tiles:[1001,1002],projection:{mode:'project',high:'detail',front:.2,back:.12,normals:'face'}};
  const job={format:'ink-studio/bake-job',version:1,label:'Mirrored planes',source:'low.glb',projectionSources:{detail:'high.glb'},
    preset:p,targets:[target],refresh:{material:'seed.material.json',bindings:[
      {target:'plates',map:'world-normal',resource:'surface',storage:'linked'},
      {target:'plates',map:'height',resource:'relief',storage:'embedded'}
    ]}};
  fs.writeFileSync(at('job.json'),JSON.stringify(job));
  return {at,p,target,expected};
}

function bytes(result,id,tile=1001) {
  const row=result.report.maps.find(map=>map.map===id&&map.tileLabel===String(tile));
  const file=path.join(path.dirname(result.file),row.file);
  return {row,file,image:readTexture(file)};
}
function pixel(image,x=16,y=16) {
  const {width,channels,data}=image,i=(y*width+x)*channels;
  return Array.from(data.slice(i,i+channels));
}
function close(actual,expected,epsilon=2e-6) {
  assert.equal(actual.length,expected.length);
  for(const [i,value] of actual.entries())assert(Math.abs(value-expected[i])<=epsilon,
    `component ${i}: expected ${expected[i]}, got ${value}`);
}

test('mirrored UV frames flip only their tangent axis and use shared physical height normalization',async t=>{
  const {at,expected}=fixture(t);
  const baked=await runBakeJob(at('job.json'),{directory:at('range')});
  for(const [i,tile] of expected.tiles.entries()) {
    const tangent=bytes(baked,'normal',tile), world=bytes(baked,'world-normal',tile), height=bytes(baked,'height',tile);
    assert.equal(tangent.image.bitDepth,16);
    assert.deepEqual(world.image.names,['X','Y','Z']);
    assert.equal(world.image.bitDepth,32);
    close(pixel(tangent.image).map(n=>n/65535*2-1),expected.tangentNormals[i],1/65535);
    close(pixel(world.image),expected.worldNormal);
    close(pixel(world.image,0,0),[0,0,1]);
    assert.equal(height.image.bitDepth,16);
    assert.deepEqual(height.row.output.range,[-.0625,.125]);
    assert.deepEqual(pixel(height.image),[i?0:65535]);
    assert.deepEqual(pixel(height.image,0,0),[21845]);
    assert.equal(height.row.output.measured.min,expected.heights[i]);
    assert.equal(height.row.output.clippedHigh+height.row.output.clippedLow,0);
    assert.equal(fs.existsSync(path.join(path.dirname(baked.file),world.row.previewFile)),true);
  }
  const baseDir=path.dirname(baked.file), doc=readMaterialGraph(path.join(baseDir,baked.report.material));
  assert.deepEqual(doc.resources.relief.definition.interpretation.heightRange,[-.0625,.125]);
  assert.equal(doc.resources.relief.definition.tiles[0].source.encoding,'png');
  assert.equal(doc.resources.surface.definition.tiles[0].source.encoding,'exr');
  const evaluated=await createGraphProject(doc,{baseDir}).previewFrame(
    {h:{output:'relief'},n:{output:'surface'}},{inputs:{tile:[1,0]}},{encodeArtifacts:false});
  assert.equal(evaluated.values.h.descriptor.intent,'height');
  assert.equal(evaluated.values.h.raster.data[16*32+16],-.0625);
  assert.equal(evaluated.values.n.descriptor.normalSpace,'world');
  assert.equal(evaluated.values.n.descriptor.domain,'signed-unit');
});

test('raw EXR keeps signed offsets while manual ranges report clipped valid texels',async t=>{
  const {at,p,target,expected}=fixture(t);
  const bake=(folder,maps)=>runBakeJob(at('job.json'),{directory:at(folder),presetValue:{...p,maps}});
  const raw=await bake('raw',[
    {id:'normal',overrides:{orientation:'directx',encoding:'exr'}},{id:'height',overrides:{encoding:'exr'}}
  ]);
  for(const [i,tile] of expected.tiles.entries()) {
    const height=bytes(raw,'height',tile), normal=bytes(raw,'normal',tile);
    assert.equal(height.row.output.range,null);
    assert.equal(height.row.output.normalization,'none');
    assert.deepEqual(pixel(height.image),[expected.heights[i]]);
    assert.deepEqual(pixel(height.image,0,0),[0]);
    const [x,y,z]=expected.tangentNormals[i];
    close(pixel(normal.image),[x,-y,z]);
  }
  const clipped=await bake('manual',[{id:'height',overrides:{encoding:'png8',normalization:'manual',range:[-.03125,.0625]}}]);
  const near=bytes(clipped,'height'), rear=bytes(clipped,'height',1002);
  assert.deepEqual(pixel(near.image),[255]);
  assert.deepEqual(pixel(rear.image),[0]);
  assert.equal(near.row.output.clippedHigh,near.row.output.measured.samples);
  assert.equal(rear.row.output.clippedLow,rear.row.output.measured.samples);

  const direct=await runBakeJob(at('job.json'),{directory:at('direct'),
    targetValues:[{...target,id:'plates',mesh:'Tilted',tiles:[1001],projection:undefined}],
    presetValue:{...p,maps:[{id:'normal',overrides:{space:'world',encoding:'exr'}},{id:'height',overrides:{encoding:'exr'}}]}});
  close(pixel(bytes(direct,'normal').image),[0,.3,Math.sqrt(.91)]);
  assert.deepEqual(pixel(bytes(direct,'height').image),[0]);

  const invalid={...p,maps:[{id:'height',overrides:{encoding:'png16',normalization:'none'}}]};
  await assert.rejects(()=>inspectBakeJob(at('job.json'),{presetValue:invalid}),/unnormalized OpenEXR/);
});
