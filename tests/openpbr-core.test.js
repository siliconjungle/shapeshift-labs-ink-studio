const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ink = require('..');
const { prepare } = require('../cli/physical-reference-scene.js');
const { surface } = require('../cli/physical-reference-geometry.js');
const { makeTracer } = require('../cli/physical-path-trace.js');
const { openPbrBrdf } = require('../cli/physical-openpbr-brdf.js');

const toolkit = Ink.load(), { graphImages, openPbr } = toolkit.KIT.procedural;
const ray = x => ({origin:[x, .06, 4],direction:[0, 0, -1]});
const environment = {color:[0,0,0]};
const camera = {target:[0,0,0],yaw:0,pitch:0,distance:4};
const mesh = (id, material, position) => ({id,kind:'plane',material,position});
const testPlan = materials => ({
  format:'ink-studio/physical-reference',version:1,label:'Core',
  view:{width:8,height:8},settings:{samples:2,bounces:0}, camera,environment,materials,
  meshes:[mesh('face','front',[0,0,0]),mesh('under','back',[0,0,-1])]
});
const ref = node => ({node,port:'value'});
const close = (a,b) => assert(Math.abs(a-b)<1e-6,[a,b].join(' ≠ '));

test('OpenPBR core resolves standard values and rejects unit, range, and binding mismatches', () => {
  const { parameters:p } = openPbr.define();
  const core = {
    base_weight:1,base_color:[.8,.8,.8],base_metalness:0,base_diffuse_roughness:0,
    specular_weight:1,specular_color:[1,1,1],specular_roughness:.3,specular_roughness_anisotropy:0,specular_ior:1.5,
    coat_weight:0,coat_color:[1,1,1],coat_roughness:0,coat_roughness_anisotropy:0,coat_ior:1.6,coat_darkening:1,
    emission_luminance:0,emission_color:[1,1,1],geometry_opacity:1,geometry_thin_walled:false,
    geometry_normal:null,geometry_coat_normal:null,geometry_tangent:null,geometry_coat_tangent:null
  };
  assert.deepEqual(Object.fromEntries(Object.keys(core).map(name=>[name,p[name]])),core);
  const nits=graphImages.uniform(275,1,1,{intent:'data',units:'nits',precision:'float32'});
  const normal=graphImages.uniform([0,0,1],1,1,{intent:'normal',normalOrientation:'opengl'});
  const surface=openPbr.define({specular_weight:3,emission_color:[1.25,.2,.4]}, {emission_luminance:nits,geometry_normal:normal});
  const { fields }=openPbr.describe(openPbr.read(surface));
  assert.equal(fields.emission_luminance.units,'nits');
  assert.equal(fields.emission_luminance.map.precision,'float32');
  assert.deepEqual(fields.emission_color.value,[1.25,.2,.4]);
  assert.throws(()=>openPbr.define({baseColor:[0,0,0]}),/Unknown OpenPBR input baseColor/);
  assert.throws(()=>openPbr.define({coat_ior:0}),/coat_ior/);
  assert.throws(()=>openPbr.define({geometry_opacity:1.1}),/geometry_opacity/);
  assert.throws(()=>openPbr.define({geometry_normal:[0,0,0]}),/geometry_normal/);
  assert.throws(()=>openPbr.define({}, {emission_luminance:graphImages.uniform(1,1,1,{intent:'mask'})}),/units/);
  assert.throws(()=>openPbr.define({}, {geometry_tangent:normal}),/vector3/);
  assert.throws(()=>openPbr.define({}, {geometry_thin_walled:nits}),/boolean/);
});

test('physical reference reopens an editable graph and applies HDR emission and coverage by texel', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-openpbr-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const descriptor={intent:'mask',precision:'float32'};
  const project={format:'ink-studio/graph-project',version:1,nodes:{
    coverage:{op:'image.declare',inputs:{source:{width:2,height:1,channels:1,data:[0,.25]},descriptor}},
    light:{op:'image.uniform',inputs:{width:1,height:1,value:250,descriptor:{intent:'data',units:'nits'}}},
    maps:{op:'data.record',inputs:{geometry_opacity:ref('coverage'),emission_luminance:ref('light')}},
    core:{op:'material.openPbr',inputs:{parameters:{base_weight:0,specular_weight:0,emission_color:[1.2,.3,0]},maps:ref('maps')}}
  },outputs:{face:ref('core')}};
  Ink.writeMaterialGraph(path.join(dir,'face.json'),Ink.openMaterialGraph(project,{id:'core',baseDir:dir}));
  const plan=testPlan({front:{graph:{file:'face.json',output:'face'}},back:{emission:[0,0,1]}});
  const scene=await prepare(plan,{},dir,toolkit,()=>{});
  const trace=makeTracer(scene);
  assert.deepEqual(trace.path(ray(-.5),()=>.1),[0,0,1]);
  assert.deepEqual(trace.path(ray(.5),()=>.7),[0,0,1]);
  const radiance=trace.path(ray(.5),()=>.1);
  close(radiance[0],3); close(radiance[1],.75); close(radiance[2],0);
  const input=path.join(dir,'plan.json');
  fs.writeFileSync(input,JSON.stringify(plan));
  const report=await Ink.writePhysicalReference(input,{directory:path.join(dir,'review'),toolkit});
  assert.equal(report.openPbr.whiteNits,100);
  assert.equal(report.openPbr.materials.front.fields.geometry_opacity.map.sampling,'nearest');
  assert.equal(report.openPbr.materials.front.fields.emission_luminance.map.units,'nits');
});

test('base and coat frames are independent and change the traced lobe response', async () => {
  const front={base_weight:0,specular_weight:0,coat_weight:1,coat_roughness:.46,coat_roughness_anisotropy:.75,
    geometry_normal:[.4,0,1],geometry_coat_normal:[0,.3,1],geometry_coat_tangent:[1,0,0]};
  const hit=async parameters=>{
    const s=await prepare(testPlan({front:{openPbr:parameters},back:{baseColor:[0,0,0]}}),{},process.cwd(),toolkit,()=>{});
    const {origin,direction}=ray(.2);
    return surface(s.geometry.intersect(origin,direction),origin,direction);
  };
  const a=await hit(front), b=await hit({...front,geometry_coat_tangent:[0,1,0]});
  assert(a.n[0]>.3 && a.coatNormal[1]>.2 && a.coatNormal[0]===0);
  assert.deepEqual(a.coatTangent,[1,0,0]);
  close(b.coatTangent[1]*b.coatNormal[1]+b.coatTangent[2]*b.coatNormal[2],0);
  const look=[0,0,1], out=[.34,.54,Math.sqrt(1-.34**2-.54**2)];
  const alobe=openPbrBrdf(a,look).evaluate(out), blobe=openPbrBrdf(b,look).evaluate(out);
  assert(alobe.pdf>0 && blobe.pdf>0 && Math.abs(alobe.weight[0]-blobe.weight[0])>.01, JSON.stringify([alobe,blobe]));
  const off=openPbrBrdf(await hit({...front,coat_weight:0}),look).evaluate(out);
  assert.deepEqual(off.weight,[0,0,0]);
});
