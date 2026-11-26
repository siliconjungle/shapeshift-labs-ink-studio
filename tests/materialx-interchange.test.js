const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const Ink=require('..');
const PNG=require('../cli/png.js');

const python=process.env.INK_SCENE_PYTHON??'python3';
const enabled=spawnSync(python,['-c','import MaterialX as mx; assert mx.getVersionIntegers()[:2] >= (1,39)'],
  {stdio:'ignore'}).status===0;
const skip={skip:!enabled&&'MaterialX 1.39 Python package is optional'};
const ref=(node,port='value')=>({node,port});
const close=(left,right,eps=2e-6)=>assert(Math.abs(left-right)<=eps,[left,right].join(' differed from '));
const text=(directory,name,value)=>{
  const file=path.join(directory,name);
  fs.writeFileSync(file,value);
  return file;
};
const setup=t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-materialx-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
};
const reopen=(dir,report)=>Ink.readGraphProject(path.join(dir,report.files[0].file)).run().outputs.surface;

test('official MaterialX validates exported OpenPBR uniforms, physical units and typed sampled maps',skip,async t=>{
  const dir=setup(t);
  const image=(value,descriptor)=>({op:'image.uniform',inputs:{width:3,height:2,value,descriptor}});
  const graph={format:'ink-studio/graph-project',version:1,nodes:{
    pigment:image([.49,.19,.059],{intent:'color',colorSpace:'srgb',precision:'unorm16'}),
    normal:image([-.31,.27,.92],{intent:'normal',normalSpace:'tangent',normalOrientation:'directx',
      precision:'float32',sampling:'linear',tiling:{u:'mirror',v:'wrap'}}),
    film:image(.63,{intent:'data',precision:'float32',units:'um'}),
    maps:{op:'data.record',inputs:{base_color:ref('pigment'),geometry_normal:ref('normal'),thin_film_thickness:ref('film')}},
    surface:{op:'material.openPbr',inputs:{parameters:{transmission_weight:.9,transmission_depth:1.27,
      transmission_dispersion_abbe_number:19.2,geometry_thin_walled:true,emission_luminance:140,
      coat_weight:.74,fuzz_weight:.43,thin_film_weight:.81},maps:ref('maps')}}
  },outputs:{surface:ref('surface'),settings:ref('surface','report')}};
  const native=Ink.openMaterialGraph(graph,{id:'sample'});
  native.label='Paint premium';
  const input=path.join(dir,'sample.material.json'), out=path.join(dir,'sample.mtlx');
  Ink.writeMaterialGraph(input,native);
  const report=await Ink.exportMaterialX(input,{output:'surface',out,strict:true});
  assert.equal(report.status,'written',JSON.stringify(report.entries.filter(r=>r.status==='dropped')));
  assert.equal(report.library.valid,true);
  assert.equal(report.roundTrip.passed,true);
  assert.equal(report.roundTrip.maps.length,3);
  assert(report.roundTrip.maps.every(row=>row.binding&&row.sameTexture));
  assert(report.entries.some(row=>row.input==='geometry_normal'&&row.reason.includes('DirectX')));

  const importDir=path.join(dir,'imported'), result=Ink.importMaterialX(out,{directory:importDir,strict:true});
  assert.equal(result.status,'written');
  assert.equal(result.materials[0].label,'Paint premium');
  const packet=reopen(importDir,result);
  assert.equal(packet.parameters.geometry_thin_walled,true);
  close(packet.parameters.transmission_depth,1.27);
  close(packet.parameters.transmission_dispersion_abbe_number,19.2);
  assert.equal(packet.parameters.emission_luminance,140);
  assert.equal(packet.maps.thin_film_thickness.descriptor.units,'um');
  assert.equal(packet.maps.geometry_normal.descriptor.normalOrientation,'opengl');
  assert.deepEqual(packet.maps.geometry_normal.descriptor.tiling,{u:'mirror',v:'wrap'});
  close(packet.maps.geometry_normal.raster.data[1],-.27);
  assert.equal(packet.maps.base_color.descriptor.colorSpace,'srgb-linear');
});

test('import follows NodeGraph outputs and packed texture lanes, preserves value math, and converts explicit units',skip,t=>{
  const dir=setup(t);
  fs.writeFileSync(path.join(dir,'packed.png'),PNG.encode(2,1,Uint8Array.of(75,119,29,191,101,31)));
  const input=text(dir,'external.mtlx',`<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <nodegraph name="surface_textures">
    <image name="packed" type="color3">
      <input name="file" type="filename" value="packed.png" />
      <input name="filtertype" type="string" value="closest" />
    </image>
    <separate3 name="separate" type="multioutput">
      <input name="in" type="color3" nodename="packed" />
    </separate3>
    <multiply name="roughness_scale" type="float">
      <input name="in1" type="float" nodename="separate" output="outg" />
      <input name="in2" type="float" value="0.5" />
    </multiply>
    <output name="rough" type="float" nodename="roughness_scale" />
  </nodegraph>
  <open_pbr_surface name="external" type="surfaceshader">
    <input name="specular_roughness" type="float" nodegraph="surface_textures" output="rough" />
    <input name="transmission_depth" type="float" value="0.028" unit="meter" unittype="distance" />
  </open_pbr_surface>
  <surfacematerial name="paint" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="external" />
  </surfacematerial>
</materialx>`);
  const out=path.join(dir,'in'), report=Ink.importMaterialX(input,{directory:out,strict:true});
  assert.equal(report.status,'written',JSON.stringify(report.library.messages.concat(report.entries.filter(r=>r.status==='dropped'))));
  assert(report.entries.some(row=>row.input==='specular_roughness'&&row.status==='baked'));
  assert(report.dependencies.some(row=>row.file==='packed.png'&&row.sha256.length===64));
  const surface=reopen(out,report), rough=surface.maps.specular_roughness;
  close(surface.parameters.transmission_depth,2.8);
  assert.equal(rough.descriptor.sampling,'nearest');
  close(rough.raster.data[0],119/510);
  close(rough.raster.data[1],101/510);
});

test('valid procedural loss is reported by input and strict mode stages only the report',skip,t=>{
  const dir=setup(t);
  const input=text(dir,'procedural.mtlx',`<materialx version="1.39">
  <noise3d name="surface_grain" type="float" />
  <open_pbr_surface name="physical" type="surfaceshader">
    <input name="coat_roughness" type="float" nodename="surface_grain" />
    <input name="coat_weight" type="float" value="0.53" />
  </open_pbr_surface>
  <surfacematerial name="sign" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="physical" />
  </surfacematerial>
</materialx>`);
  const strictDir=path.join(dir,'strict'), result=Ink.importMaterialX(input,{directory:strictDir,strict:true});
  assert.equal(result.library.valid,true);
  assert.equal(result.status,'blocked');
  assert.deepEqual(fs.readdirSync(strictDir),['materialx-report.json']);
  const lost=result.entries.find(row=>row.input==='coat_roughness');
  assert.equal(lost.status,'dropped');
  assert.equal(lost.path,'physical/coat_roughness');
  assert.match(lost.reason,/noise3d.*surface_grain/);
  const partialDir=path.join(dir,'partial'), partial=Ink.importMaterialX(input,{directory:partialDir});
  assert.equal(partial.status,'written');
  const packet=reopen(partialDir,partial);
  close(packet.parameters.coat_weight,.53);
  assert.equal(packet.parameters.coat_roughness,0);
});

test('Standard Surface translation reports model differences and unsupported RGB coverage',skip,t=>{
  const dir=setup(t);
  const input=text(dir,'standard.mtlx',`<materialx version="1.39">
  <standard_surface name="material" type="surfaceshader">
    <input name="base_color" type="color3" value="0.2, 0.16, 0.07" />
    <input name="opacity" type="color3" value="0.5, 0.7, 0.3" />
    <input name="specular_IOR" type="float" value="1.43" />
  </standard_surface>
</materialx>`);
  const out=path.join(dir,'in'), result=Ink.importMaterialX(input,{directory:out});
  assert.equal(result.status,'written');
  const coverage=result.entries.find(row=>row.input==='geometry_opacity');
  assert.equal(coverage.status,'dropped');
  assert.match(coverage.reason,/RGB opacity/);
  assert.equal(result.summary.approximated,1);
  close(reopen(out,result).parameters.specular_ior,1.43);
});

test('official validation catches broken connections and legacy MDL and Iray stay reference records',t=>{
  const dir=setup(t);
  const mdl=text(dir,'paint.mdl','mdl 1.7;\n// Retained migration reference.\n');
  assert.equal(Ink.materialMigration(mdl).engine,'MDL');
  const iray=text(dir,'view.mi','// Iray renderer reference\n');
  assert.equal(Ink.materialMigration(iray).status,'reference');
  assert.equal(Ink.materialMigration(iray).engine,'Iray');
  if(!enabled) return;
  const invalid=text(dir,'bad.mtlx','<materialx version="1.39"><surfacematerial name="bad" type="material"><input name="surfaceshader" type="surfaceshader" nodename="missing" /></surfacematerial></materialx>');
  const report=Ink.inspectMaterialX(invalid);
  assert.equal(report.library.valid,false);
  assert(report.library.messages.length>0);
});
