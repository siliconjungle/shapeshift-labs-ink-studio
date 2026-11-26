const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ink = require('..');
const { prepare } = require('../cli/physical-reference-scene.js');
const { makeTracer } = require('../cli/physical-path-trace.js');
const { random } = require('../cli/physical-reference-math.js');
const { dielectric, effectiveIor, cauchy, film, thinSheet } = require('../cli/physical-openpbr-optics.js');

const kit=Ink.load(), {openPbr,graphImages}=kit.KIT.procedural;
const camera={target:[0,0,0],yaw:0,pitch:0,distance:4};
const ray={origin:[.071,.024,4],direction:[0,0,-1]};
const emitter={id:'emitter',kind:'plane',material:'light',position:[0,0,-2],scale:[3,3,1]};
const closed={id:'volume',kind:'cube',material:'surface',scale:[1,1,.5]};
const sheet={id:'sheet',kind:'plane',material:'surface'};
const clear={base_weight:0,specular_weight:0,specular_roughness:0,transmission_weight:1};
const plan=(material,carrier=closed,extra={})=>({
  format:'ink-studio/physical-reference',version:1,label:'OpenPBR highlight and transmission reference',
  view:{width:12,height:10},settings:{samples:3,bounces:12},camera,environment:{color:[0,0,0]},
  meshes:[carrier,emitter],materials:{surface:{openPbr:material},light:{baseColor:[0,0,0],emission:[1,1,1]}},
  ...extra
});
const trace=async scene=>makeTracer(await prepare(scene,{},process.cwd(),kit,()=>{}));
const close=(a,b,eps=1e-5)=>assert(Math.abs(a-b)<=eps,[a,b].join(' differs from '));
const vector=(a,b)=>a.forEach((v,i)=>close(v,b[i]));
const average=(tracer, count=500)=>{
  const sum=[0,0,0];
  for(let i=0;i<count;i++) tracer.path(ray,random(5,0,i)).forEach((v,c)=>{sum[c]+=v;});
  return sum.map(x=>x/count);
};

test('advanced packet adds the standard names, signed controls and physical units to an old core packet',()=>{
  const original=openPbr.define();
  const reopened=openPbr.read({...original,parameters:{base_weight:.8,geometry_thin_walled:true}});
  const p=reopened.parameters;
  const advanced={
    transmission_weight:0,transmission_color:[1,1,1],transmission_depth:0,
    transmission_scatter:[0,0,0],transmission_scatter_anisotropy:0,
    transmission_dispersion_scale:0,transmission_dispersion_abbe_number:20,
    subsurface_weight:0,subsurface_color:[.8,.8,.8],subsurface_radius:1,
    subsurface_radius_scale:[1,.5,.25],subsurface_scatter_anisotropy:0,
    fuzz_weight:0,fuzz_color:[1,1,1],fuzz_roughness:.5,
    thin_film_weight:0,thin_film_thickness:.5,thin_film_ior:1.4
  };
  assert.deepEqual(Object.fromEntries(Object.keys(advanced).map(id=>[id,p[id]])),advanced);
  assert.equal(p.base_weight,.8); assert.equal(p.geometry_thin_walled,true);
  const height=(v,units)=>graphImages.uniform(v,1,1,{intent:'data',units,precision:'float32'});
  const maps={transmission_depth:height(1.2,'cm'),thin_film_thickness:height(.65,'µm'),
    subsurface_scatter_anisotropy:height(-.7,'unitless')};
  const {fields}=openPbr.describe(openPbr.define({},maps));
  assert.equal(fields.transmission_depth.map.units,'cm');
  assert.equal(fields.thin_film_thickness.units,'um');
  assert.equal(fields.subsurface_radius.units,'cm');
  assert.throws(()=>openPbr.define({}, {subsurface_radius:height(.3,'mm')}),/units/);
  assert.throws(()=>openPbr.define({transmission_dispersion_abbe_number:0}),/abbe_number/);
});

test('closed transmission follows authored absorption distance and units; a thin window keeps direction and tint',async()=>{
  const color=[.5,.25,.125], mat={...clear,transmission_color:color,transmission_depth:1};
  const options={settings:{samples:1,bounces:2}};
  const normal=await trace(plan(mat,closed,options));
  vector(normal.path(ray,()=>.7),color);
  assert.equal(normal.stats.transmittedEvents,2);
  const double=await trace(plan(mat,closed,{...options,metersPerUnit:.02}));
  vector(double.path(ray,()=>.7),color.map(v=>v*v));
  const thin=await trace(plan({...mat,geometry_thin_walled:true,transmission_depth:37,
    transmission_scatter:[.5,.5,.5]},sheet,{settings:{samples:1,bounces:1}}));
  vector(thin.path(ray,()=>.7),color);
  assert.equal(thin.stats.thinSpecularEvents,1);
  assert.equal(thin.stats.volumeScatters,0);
});

test('IOR weight, Cauchy dispersion, and thin-film energy follow the expected optical relationships',()=>{
  close(effectiveIor(1.6,1,0),1);
  close(effectiveIor(1.6,1,1),1.6);
  close(dielectric(1,1,effectiveIor(1.5,1,.5)),.02);
  assert.equal(dielectric(.25,1.5,1),1);
  const wavelengths=[0,1,2].map(c=>cauchy(1.63,1,10,c));
  assert(wavelengths[0]<wavelengths[1] && wavelengths[1]<wavelengths[2]);
  close(cauchy(1.63,0,10,0),1.63);
  const p=openPbr.define({thin_film_weight:1,thin_film_thickness:.38,thin_film_ior:1.85}).parameters;
  const sheen=film(p,.74,1,1.48), shifted=film({...p,thin_film_thickness:.47},.74,1,1.48);
  assert(Math.max(...sheen)-Math.min(...sheen)>.025);
  assert.notDeepEqual(sheen,shifted);
  const neutral=film({...p,thin_film_thickness:0},.74,1,1.48);
  vector(neutral,Array(3).fill(dielectric(.74,1,1.48)));
  for(const {reflection,transmission} of thinSheet(p,sheen,1)) close(reflection+transmission,1);
});

test('advanced lobes respond together on a closed reference and on backlit paper',async()=>{
  const mixture={base_color:[.11,.35,.48],specular_roughness:.08,specular_ior:1.47,
    transmission_weight:.54,transmission_depth:.8,transmission_color:[.89,.95,.98],
    transmission_scatter:[.36,.30,.25],transmission_scatter_anisotropy:.65,
    transmission_dispersion_scale:1,transmission_dispersion_abbe_number:11,
    subsurface_weight:.95,subsurface_radius:.27,subsurface_color:[.96,.72,.52],
    coat_weight:.32,coat_ior:1.29,coat_color:[.92,.76,.59],coat_roughness:.11,
    thin_film_weight:.62,thin_film_thickness:.35,thin_film_ior:1.7,
    fuzz_weight:.25,fuzz_color:[.93,.58,.31],fuzz_roughness:.38};
  const layered=await trace(plan(mixture));
  const changed=await trace(plan({...mixture,transmission_dispersion_scale:0,transmission_scatter:[0,0,0],
    subsurface_weight:0,fuzz_weight:0,coat_weight:0,thin_film_weight:0}));
  const left=average(layered,1000), right=average(changed,1000);
  assert(left.every(Number.isFinite) && left[0]>0);
  assert(Math.hypot(...left.map((v,i)=>v-right[i]))>.08,JSON.stringify([left,right]));
  assert(layered.stats.dispersionPaths>100 && layered.stats.volumeScatters>50 && layered.stats.subsurfaceScatters>300);
  assert.equal(changed.stats.volumeScatters,0);
  assert.equal(changed.stats.subsurfaceScatters,0);
  assert.equal(changed.stats.dispersionPaths,0);

  const paper={base_weight:0,specular_weight:0,geometry_thin_walled:true,subsurface_weight:1,
    subsurface_color:[.8,.5,.2],subsurface_scatter_anisotropy:.9};
  const light={position:[.071,.024,-1],intensity:[1,1,1]};
  const lit=await trace(plan(paper,sheet,{meshes:[sheet],lights:[light],settings:{samples:1,bounces:0}}));
  const reversed=await trace(plan({...paper,subsurface_scatter_anisotropy:-.9},sheet,
    {meshes:[sheet],lights:[light],settings:{samples:1,bounces:0}}));
  const a=lit.path(ray,()=>.75),b=reversed.path(ray,()=>.75);
  assert(a[0]>.2 && a[0]>a[1] && a[1]>a[2]);
  close(a[0]/b[0],19);
});

test('advanced checkpoints resume with byte-identical dispersed and volume paths',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-openpbr-advanced-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const input=path.join(dir,'scene.json');
  fs.writeFileSync(input,JSON.stringify(plan({transmission_weight:1,transmission_depth:1,
    transmission_scatter:[.25,.19,.15],transmission_dispersion_scale:1,
    thin_film_weight:.4,coat_weight:.3,fuzz_weight:.1})));
  const run=(name,samples,options={})=>Ink.writePhysicalReference(input,{directory:path.join(dir,name),samples,toolkit:kit,...options});
  const full=await run('full',6);
  await run('split',2);
  const split=await run('split',4,{resume:path.join(dir,'split','accumulation.bin')});
  assert.equal(full.signature,split.signature);
  assert(full.stats.dispersionPaths>0 && full.stats.volumeScatters>0);
  assert.deepEqual(fs.readFileSync(path.join(dir,'full','raw.exr')),fs.readFileSync(path.join(dir,'split','raw.exr')));
});
