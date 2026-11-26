const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {runBakeJob,inspectBakeJob}=require('../cli/bake-jobs.js');
const {readTexture}=require('../cli/texture-files.js');
const {createGraphProject}=require('../cli/graph-project.js');
const {openMaterialGraph,writeMaterialGraph,readMaterialGraph}=require('../cli/material-graph.js');
const PNG=require('../cli/png.js');
const {writeCoupons}=require('../examples/bake-thickness/coupons.cjs');

function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-thickness-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=file=>path.join(root,file), fixture=writeCoupons(at('coupons.glb'));
  const p={format:'ink-studio/bake-preset',version:1,label:'Measure coupons',defaults:{size:64,padding:2},
    maps:[{id:'thickness',overrides:{encoding:'exr',thicknessScale:.25}},{id:'thickness-valid'}]};
  const target={id:'coupons',mesh:'Test coupons',submeshes:fixture.selected,thicknessParts:fixture.labels};
  const bmp=PNG.encodeGray(2,2,new Uint8Array(4)).toString('base64');
  const interpretation={length:{intent:'height'},known:{intent:'mask'}};
  const graph={format:'ink-studio/graph-project',version:1,
    assets:Object.fromEntries(Object.entries(interpretation).map(([id,value])=>[id,{
      format:'bitmap',interpretation:value,source:{base64:bmp,encoding:'png'}
    }])),nodes:Object.fromEntries(Object.keys(interpretation).map(name=>[name,{op:'bitmapAsset',inputs:{name}}])),
    outputs:Object.fromEntries(Object.keys(interpretation).map(node=>[node,{node,port:'value'}]))};
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'thickness-fixture'}));
  fs.writeFileSync(at('job.json'),JSON.stringify({format:'ink-studio/bake-job',version:1,label:'Coupons',source:'coupons.glb',
    preset:p,targets:[target],refresh:{material:'seed.material.json',bindings:[
      {target:'coupons',map:'thickness',resource:'length',storage:'linked'},
      {target:'coupons',map:'thickness-valid',resource:'known',storage:'embedded'}
    ]}}));
  const bake=(name,overrides,targetValues=[target],includeValidity=true)=>runBakeJob(at('job.json'),{directory:at(name),targetValues,
    presetValue:{...p,maps:[{id:'thickness',overrides},...(includeValidity?[{id:'thickness-valid'}]:[])]}});
  return {at,bake,p,target,fixture};
}
function channel(baked,id='thickness',companion=false) {
  const row=baked.report.maps.find(row=>row.map===id), dir=path.dirname(baked.file);
  const file=path.join(dir,companion?row.validityFile:row.file), image=readTexture(file);
  const sample=i=>{
    const x=Math.floor(((i%4)+.5)/4*image.width),y=Math.floor((Math.floor(i/4)+.5)/2*image.height);
    return image.data[y*image.width+x];
  };
  return {row,image,sample};
}

test('raw EXR and normalized PNG16 keep paired validity and explain invalid shells',async t=>{
  const {bake,fixture}=setup(t);
  const run=await bake('exact',{encoding:'exr',size:72,thicknessScale:.25});
  const thickness=channel(run), validity=channel(run,'thickness',true), independent=channel(run,'thickness-valid');
  assert.equal(thickness.image.bitDepth,32);
  assert.deepEqual(thickness.image.names,['Y']);
  assert.equal(thickness.row.output.range,null);
  assert.equal(thickness.row.output.clipped,0);
  assert(thickness.row.geometry.thickness.clipped>0);
  assert.equal(validity.image.width,72);
  assert.equal(validity.image.bitDepth,8);
  assert.equal(independent.row.sha256,thickness.row.validitySha256);
  for(const [i,{thickness:known,reason}] of fixture.coupons.entries()) {
    assert.equal(thickness.sample(i),known??0);
    assert.equal(validity.sample(i),known?255:0);
    if(reason)assert(thickness.row.geometry.thickness.rejected[reason]>0,reason);
  }
  const stats=thickness.row.geometry.thickness;
  assert.equal(stats.valid+stats.unknown,thickness.row.texels);
  assert.equal(Object.values(stats.rejected).reduce((a,b)=>a+b),stats.unknown);
  assert(stats.valid>0);
  const baseDir=path.dirname(run.file), doc=readMaterialGraph(path.join(baseDir,run.report.material));
  const evaluation=await createGraphProject(doc,{baseDir}).previewFrame({
    length:{output:'length'},known:{output:'known'}
  },{},{encodeArtifacts:false});
  assert.equal(evaluation.values.length.descriptor.intent,'height');
  assert.equal(evaluation.values.length.raster.data[18*72+9],.375);
  assert.equal(evaluation.values.known.raster.data[18*72+9],255);

  const normalized=await bake('packed',{encoding:'png16',thicknessScale:.5},undefined,false);
  const packed=channel(normalized);
  assert.equal(packed.image.bitDepth,16);
  assert.equal(packed.sample(0),49151);
  assert.equal(packed.sample(6),32768);
  assert.equal(channel(normalized,'thickness',true).sample(1),0);
  const normalizedGraph=readMaterialGraph(path.join(path.dirname(normalized.file),normalized.report.material));
  assert.deepEqual(normalizedGraph.resources.length.definition.interpretation.heightRange,[0,.5]);
});

test('ray direction, hard search range and bias keep the first eligible physical boundary',async t=>{
  const {at,bake,p,target}=setup(t);
  const axis={encoding:'exr',thicknessDirection:'axis',thicknessAxis:[.6,0,.8],thicknessRange:.6};
  const angled=channel(await bake('angle',axis));
  assert.equal(angled.sample(0),.46875);
  const shading=channel(await bake('shading',{encoding:'exr',thicknessDirection:'shading',thicknessRange:.6}));
  assert.equal(shading.sample(0),.46875);
  assert.equal(shading.sample(6),.25);
  const exact=await bake('strict',{encoding:'exr',thicknessRange:.25});
  assert.equal(channel(exact).sample(0),0);
  assert.equal(channel(exact,'thickness',true).sample(0),0);
  assert.equal(channel(exact).sample(6),.25);
  assert(channel(exact).row.geometry.thickness.rejected.rangeMiss>0);
  const biased=channel(await bake('bias',{encoding:'exr',thicknessRange:.8,rayBias:.4}));
  assert.equal(biased.sample(0),0);
  assert(biased.row.geometry.thickness.rejected.bias>0);
  const grazing=channel(await bake('grazing',{...axis,thicknessAxis:[1,0,0]}));
  assert.equal(grazing.sample(0),0);
  assert(grazing.row.geometry.thickness.rejected.grazing>0);
  const scene=channel(await bake('scene',{encoding:'exr'},[{...target,projection:{mode:'self'}}]));
  assert.equal(scene.sample(0),.75);
  const joined=channel(await bake('joined',{encoding:'exr'},[{...target,thicknessParts:undefined}]));
  assert(joined.row.geometry.thickness.rejected.shell>0);
  const split=channel(await bake('part-labels',{encoding:'exr'},[{
    ...target,thicknessParts:{...target.thicknessParts,0:'separate-top'}
  }]));
  assert.equal(split.sample(0),0);
  assert(split.row.geometry.thickness.rejected.open>joined.row.geometry.thickness.rejected.open);
  await assert.rejects(()=>inspectBakeJob(at('job.json'),{presetValue:{...p,maps:[
    {id:'thickness',overrides:{thicknessDirection:'axis',thicknessAxis:[0,0,0]}}]}}),/nonzero axis/);
});
