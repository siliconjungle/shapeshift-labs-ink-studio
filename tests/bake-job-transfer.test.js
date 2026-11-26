const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { document } = require('../cli/glb-file.js');
const { runBakeJob, latestBakeJob } = require('../cli/bake-jobs.js');
const { readTexture } = require('../cli/texture-files.js');
const PNG = require('../cli/texture-png.js');
const EXR = require('../cli/texture-exr.js');
const { createGraphProject } = require('../cli/graph-project.js');
const { openMaterialGraph, readMaterialGraph, writeMaterialGraph } = require('../cli/material-graph.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-texture-transfer-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at = name => path.join(dir,name);
  const color = PNG.write({width:2,height:1,channels:4,alpha:'straight',
    data:Uint16Array.of(65535,0,0,65535,0,0,65535,0)},{srgb:0});
  const authored = PNG.write({width:2,height:1,channels:4,alpha:'straight',
    data:Uint16Array.of(62532,2152,300,32770,3221,9300,56423,25252)});
  const rgba = EXR.write({width:2,height:1,alpha:'premultiplied',planes:{
    R:Float32Array.of(.075,.1), G:Float32Array.of(.15,.2), B:Float32Array.of(.225,.3), A:Float32Array.of(.375,.5)
  }});
  const signed = EXR.write({width:2,height:1,planes:{Y:Float32Array.of(-1.5,2.75)}});
  fs.writeFileSync(at('paint.png'),color);
  fs.writeFileSync(at('associated.exr'),rgba);
  fs.writeFileSync(at('signed.exr'),signed);
  const doc = document(), {gltf} = doc, uv = (lo,hi)=>doc.accessor(Float32Array.of(lo,0,hi,0,hi,1,lo,1),'VEC2');
  gltf.meshes=[{name:'Transfer plate',primitives:[{material:0,indices:doc.accessor(Uint16Array.of(0,1,2,0,2,3),'SCALAR'),
    attributes:{POSITION:doc.accessor(Float32Array.of(-1,-1,0,1,-1,0,1,1,0,-1,1,0),'VEC3',{bounds:true}),
      TEXCOORD_0:uv(1,0),TEXCOORD_1:uv(0,1),TEXCOORD_2:uv(-1,0)}
  }]}];
  gltf.materials=[{name:'Ink',alphaMode:'BLEND',pbrMetallicRoughness:{
    baseColorFactor:[1,1,1,.5],baseColorTexture:{index:doc.texture(authored,'Ink')}
  }}];
  gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(at('plate.glb'),doc.finish());

  const assets=Object.fromEntries(['color','mask','signed'].map(name=>[name,{
    format:'bitmap',source:{encoding:'png',base64:color.toString('base64')}
  }]));
  const graph={format:'ink-studio/graph-project',version:1,assets,
    nodes:Object.fromEntries(Object.keys(assets).map(name=>[name,{op:'bitmapAsset',inputs:{name}}])),
    outputs:Object.fromEntries(Object.keys(assets).map(node=>[node,{node,port:'value'}]))};
  writeMaterialGraph(at('base.material.json'),openMaterialGraph(graph,{id:'transfer-fixture'}));
  const save=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value));
  const inputs={paint:{file:'paint.png'},associated:{file:'associated.exr'},
    relief:{tiles:[{tile:[-1,0],file:'signed.exr'}]}};
  function run(label,maps,{dir=label,refresh=false}={}) {
    const target={id:'plate',mesh:'Transfer plate',uvSet:1,tiles:[1001]};
    save(label+'.json',{format:'ink-studio/bake-job',version:1,label,source:'plate.glb',textureInputs:inputs,targets:[target],
      preset:{format:'ink-studio/bake-preset',version:1,label,defaults:{size:33,padding:0},
        maps:maps.map(([id,overrides])=>({id,overrides}))},
      ...(refresh&&{refresh:{material:'base.material.json',bindings:[
        {target:'plate',map:'pigment',resource:'color',storage:'embedded'},
        {target:'plate',map:'opacity',resource:'mask',storage:'linked'},
        {target:'plate',map:'texture-transfer',resource:'signed',storage:'linked'}
      ]}})});
    return runBakeJob(at(label+'.json'),{directory:at(dir)});
  }
  return {at,run};
}

function output(baked,map) {
  const root=path.dirname(baked.file), row=baked.report.maps.find(row=>row.map===map);
  const {data,width,channels,bitDepth,alpha}=readTexture(path.join(root,row.file));
  return {row,bitDepth,alpha,pixel(x,y=16) {const start=(x+y*width)*channels;return [...data.slice(start,start+channels)];}};
}
const close = (actual,expected)=>actual.forEach((n,i)=>assert(Math.abs(n-expected[i])<2e-6, 'Expected '+expected[i]+' but got '+n));

test('source UVs move pigment, preserve precision, and filter straight alpha without transparent color bleed',async t=>{
  const {at,run}=fixture(t), paint={textureInput:'paint',sourcePrecision:'unorm16'};
  const baked=await run('aligned',[
    ['pigment',{...paint,encoding:'exr',sourceAlpha:'straight'}],
    ['opacity',{...paint,encoding:'png16'}],
    ['roughness',{...paint,sourceChannel:'b',encoding:'png16'}],
    ['texture-transfer',{textureInput:'relief',sourceUV:2,filter:'nearest',encoding:'exr',sourcePrecision:'float32'}]
  ],{refresh:true});
  const pigment=output(baked,'pigment'), opacity=output(baked,'opacity'), roughness=output(baked,'roughness');
  assert.equal(pigment.alpha,'straight');
  assert.deepEqual(pigment.pixel(0),[0,0,0,0]);
  assert.deepEqual(pigment.pixel(32),[1,0,0,1]);
  close(pigment.pixel(16),[1,0,0,.5]);
  assert.equal(opacity.bitDepth,16);
  assert.deepEqual(opacity.pixel(16),[32768]);
  assert.deepEqual(roughness.pixel(0),[65535]);
  assert.deepEqual(roughness.pixel(32),[0]);
  const relief=output(baked,'texture-transfer');
  assert.deepEqual(relief.pixel(0),[-1.5]);
  assert.deepEqual(relief.pixel(32),[2.75]);
  assert.deepEqual(relief.row.textureTransfer.sources,[{tile:'-1,0',precision:'float32'}]);
  assert.deepEqual(relief.row.textureTransfer.range,[-1.5,2.75]);
  assert(baked.report.inputs.some(row=>row.file==='paint.png'));
  assert(baked.report.inputs.some(row=>row.file==='signed.exr'));
  await assert.rejects(()=>run('bad',[['pigment',{...paint,sourcePrecision:'unorm8'}]],{dir:'aligned'}),/expects unorm8/);
  assert.equal(latestBakeJob(at('aligned')).revision,baked.revision);

  const baseDir=path.dirname(baked.file), material=readMaterialGraph(path.join(baseDir,baked.report.material));
  const graph=await createGraphProject(material,{baseDir}).previewFrame({
    color:{output:'color'},mask:{output:'mask'},signed:{output:'signed'}
  },{},{encodeArtifacts:false});
  const center=16*33+16;
  assert.equal(graph.values.color.descriptor.colorSpace,'srgb-linear');
  close([...graph.values.color.raster.data.slice(center*4,(center+1)*4)],[1,0,0,.5]);
  assert.equal(graph.values.mask.raster.data[center],32768);
  assert.equal(graph.values.signed.descriptor.intent,'data');
  assert.equal(graph.values.signed.raster.data[16*33],-1.5);
});

test('alpha association, ignore and cutout are explicit and authored opacity keeps its native precision',async t=>{
  const {run}=fixture(t);
  const baked=await run('policy',[
    ['pigment',{textureInput:'paint',encoding:'exr',alphaPolicy:'ignore'}],
    ['emission',{textureInput:'associated',sourceAlpha:'premultiplied',encoding:'exr'}],
    ['opacity',{textureInput:'paint',encoding:'png16',alphaPolicy:'cutout',alphaCutoff:.6}]
  ]);
  close(output(baked,'pigment').pixel(16),[.5,0,.5,1]);
  close(output(baked,'emission').pixel(16),[.2,.4,.6,.4375]);
  assert.deepEqual(output(baked,'opacity').pixel(16),[0]);
  assert.deepEqual(output(baked,'opacity').pixel(32),[65535]);
  const native=await run('native',[['opacity',{encoding:'png16'}],['pigment',{encoding:'exr'}]]);
  assert.deepEqual(output(native,'opacity').pixel(32),[16385]);
  assert.deepEqual(output(native,'opacity').pixel(0),[12626]);
  close(output(native,'pigment').pixel(32).slice(3),[32770/65535*.5]);
  const legacy=await run('legacy',[['opacity',{}]]);
  assert.equal(output(legacy,'opacity').bitDepth,8);
});
