const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Ink = require('..');
const { prepare } = require('../cli/physical-reference-scene.js');
const { makeTracer } = require('../cli/physical-path-trace.js');
const Film = require('../cli/physical-reference-film.js');
const { random } = require('../cli/physical-reference-math.js');

const black={color:[0,0,0]};
const plane=(id,material,position=[0,0,0],scale=[1,1,1])=>({id,kind:'plane',material,position,scale});
const cube=(id,material,position,scale)=>({id,kind:'cube',material,position,scale});
const plan={
  format:'ink-studio/physical-reference',version:1,label:'Reference fixture',
  view:{width:26,height:18},settings:{samples:8,bounces:3,batch:4,seed:73},
  camera:{target:[0,0,0],yaw:0,pitch:0,distance:4,focalLength:48,projection:'orthographic'},
  environment:black,materials:{matte:{baseColor:[.6,.5,.4]},black:{baseColor:[0,0,0]}},
  lights:[{position:[1,0,2],intensity:[8,0,0]}],meshes:[plane('surface','matte')]
};
const toolkit=Ink.load(), make=plan=>prepare(plan,{},process.cwd(),toolkit,()=>{});
function directory(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-physical-reference-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
const camera={origin:[0,0,4],direction:[0,0,-1]};
test('path tracing respects a physical point-light shadow while keeping the primary hit', async () => {
  const open=makeTracer(await make(plan));
  const blocked=makeTracer(await make({...plan,meshes:[...plan.meshes,cube('occluder','black',[.5,0,1],[.16,.17,.16])]}));
  const rgb=open.path(camera,random(1,0,0));
  assert(rgb[0]>.2 && rgb[1]===0 && rgb[2]===0, rgb.join(','));
  assert.deepEqual(blocked.path(camera,random(1,0,0)),[0,0,0]);
  assert(open.stats.shadowRays>0 && blocked.stats.shadowRays>0);
});

test('closed mesh glass refracts and attenuates according to the actual interior length', async () => {
  const scene=await make({...plan,lights:[],materials:{
    glass:{glass:{ior:1.001,absorption:[1.25,.3,.12]}},
    panel:{baseColor:[0,0,0],emission:[3,3,3]}
  },meshes:[
    cube('thin','glass',[-.5,0,0],[.36,.4,.08]),cube('thick','glass',[.5,0,0],[.36,.4,.33]),
    plane('source','panel',[0,0,-1],[2,2,1])
  ]});
  const tracer=makeTracer(scene);
  const rgb=x=>tracer.path({origin:[x,0,4],direction:camera.direction},()=>.7);
  const thin=rgb(-.5), thick=rgb(.5);
  for(const [i,a] of [1.25,.3,.12].entries()) {
    assert(Math.abs(thin[i]-3*Math.exp(-a*.16))<1e-4,thin);
    assert(Math.abs(thick[i]-3*Math.exp(-a*.66))<1e-4,thick);
  }
  assert.equal(tracer.stats.transmittedEvents,4);
});

test('checkpoint resume agrees byte for byte with one run and preserves linear EXR independently of exposure', async t => {
  const dir=directory(t), input=path.join(dir,'plan.json'), file=(name,member)=>path.join(dir,name,member);
  fs.writeFileSync(input,JSON.stringify(plan));
  const render=(name,overrides={})=>Ink.writePhysicalReference(input,{directory:path.join(dir,name),...overrides});
  const complete=await render('whole',{samples:8});
  const partial=await render('split',{samples:3,batch:2});
  const resume=file('split','accumulation.bin');
  assert.deepEqual(partial.progress.map(row=>row.samples),[2,3]);
  const resumed=await render('split',{samples:5,batch:2,resume});
  assert.deepEqual(resumed.progress.map(row=>row.samples),[3,5,7,8]);
  assert.equal(resumed.signature,complete.signature);
  for(const name of ['accumulation.bin','raw.exr','raw.png','denoised.png','variance.png'])
    assert.deepEqual(fs.readFileSync(file('whole',name)),fs.readFileSync(file('split',name)),name);

  const processed=await render('retone',{samples:0,resume,exposure:1.25,denoise:'off'});
  assert.equal(processed.stats.cameraRays,0);
  assert.equal(processed.files.denoised,undefined);
  assert.deepEqual(fs.readFileSync(file('whole','raw.exr')),fs.readFileSync(file('retone','raw.exr')));
  assert.notDeepEqual(fs.readFileSync(file('whole','raw.png')),fs.readFileSync(file('retone','raw.png')));
  await assert.rejects(render('mismatch',{resume,bounces:2}),/does not match/);
  const corrupt=fs.readFileSync(resume);
  corrupt[76]^=16;
  fs.writeFileSync(file('split','corrupt.bin'),corrupt);
  await assert.rejects(render('corrupt',{resume:file('split','corrupt.bin')}),/damaged/);
});

test('the CLI publishes quality settings, studio images, diagnostics and a float reference', t => {
  const dir=directory(t), filename=path.join(dir,'plan.json'), out=path.join(dir,'reference');
  const {settings,...testPlan}=plan;
  fs.writeFileSync(filename,JSON.stringify(testPlan));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'physical-reference',filename,'--out',out,
    '--quality','draft','--batch','4','--denoise','off','--json'],{encoding:'utf8'}));
  assert.equal(result.file,path.join(out,'index.html'));
  assert.equal(result.settings.bounces,2);
  assert.equal(result.totalSamples,8);
  assert.equal(result.stats.cameraRays,26*18*8);
  assert.deepEqual(result.progress.map(row=>row.samples),[4,8]);
  for(const file of Object.values(result.files)) assert(fs.statSync(path.join(out,file)).size>50);
  const exr=Ink.readTexture(path.join(out,result.files.linear));
  assert.deepEqual([exr.width,exr.height,exr.bitDepth,exr.channels],[26,18,32,3]);
  assert(exr.data.some(value=>value>0));
  assert.match(fs.readFileSync(result.file,'utf8'),/Comparison split/);
});

test('edge-aware denoising preserves a material boundary and reduces isolated noise', () => {
  const width=18,height=8,pixels=width*height, rgb=new Float32Array(pixels*3), variance=new Float32Array(pixels).fill(.2);
  const depth=new Float32Array(pixels).fill(3), normal=new Float32Array(pixels*3), albedo=new Float32Array(pixels*3);
  const material=new Uint16Array(pixels);
  for(let p=0;p<pixels;p++) {
    const left=p%width<width/2, c=left?0:2;
    rgb[p*3+c]=.5;
    albedo[p*3+c]=.75;
    normal[p*3+2]=1;
    material[p]=left?1:2;
  }
  const spike=3*width+4;
  rgb[spike*3]=1.6;
  const image=Film.denoise({rgb,variance},{depth,normal,albedo,material},width,height,'strong');
  assert(image[spike*3]<1.0);
  assert.equal(image[(width/2-1)*3+2],0);
  assert.equal(image[(width/2)*3],0);
  assert.equal(Film.denoise({rgb,variance},{depth,normal,albedo,material},width,height,'off'),rgb);
});

test('rotated HDRI lookup and sampling use the same azimuth and preserve values above white', async t => {
  const dir=directory(t), filename=path.join(dir,'calibration.pfm'), width=8,height=4;
  const data=new Float32Array(width*height*3);
  data.set([12,2,.5],(1*width+4)*3);
  const color=toolkit.KIT.procedural.graphImages.declare({width,height,channels:3,data},
    {intent:'color',colorSpace:'srgb-linear',precision:'float32'});
  fs.writeFileSync(filename,Ink.encodeTexture(color,{encoding:'pfm',bitDepth:32}));
  const env=rotation=>make({...plan,environment:{file:filename,rotation,background:false}});
  const [a,b]=await Promise.all([env(0),env(90)]);
  const sample=a.sky.sample(()=>.5);
  const rotated=[sample.dir[2],sample.dir[1],-sample.dir[0]];
  assert(sample.radiance[0]>8);
  assert.equal(a.sky.pdf(sample.dir),sample.pdf);
  assert(Math.abs(a.sky.pdf(sample.dir)-b.sky.pdf(rotated))<1e-10);
  assert.deepEqual(a.sky.eval(sample.dir),b.sky.eval(rotated));
});

test('additional bounces carry light from a pigment card to a directly unlit receiver', async () => {
  const bouncePlan={...plan,lights:[{position:[.35,0,-.55],intensity:[4,4,4]}],
    materials:{receiver:{baseColor:[.75,.75,.75]},red:{baseColor:[.8,.02,.01]}},
    meshes:[plane('receiver','receiver',[0,0,0],[.45,1,1]),
      {...plane('red-card','red',[.8,0,.35],[1.22,1.55,1]),rotation:[0,-90,0]}]};
  const unlit=makeTracer(await make({...bouncePlan,settings:{...plan.settings,bounces:0}}));
  const lit=makeTracer(await make(bouncePlan));
  assert.deepEqual(unlit.path(camera,random(47,0,1)),[0,0,0]);
  const sum=[0,0,0];
  for(let i=0;i<200;i++) {
    const value=lit.path(camera,random(47,0,i));
    for(let c=0;c<3;c++) sum[c]+=value[c]/200;
  }
  assert(sum[0]>.02 && sum[0]>sum[1]*3 && sum[0]>sum[2]*3,sum.join(','));
});
