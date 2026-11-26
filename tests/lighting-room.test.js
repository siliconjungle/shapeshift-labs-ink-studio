const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Ink = require('..');
const HDR = require('../src/hdr-environment.js');
const Rig = require('../src/lighting-room-rig.js');

function picture(header, bytes) {
  return Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + header + '\n'),Buffer.from(bytes)]);
}
function stripes() {
  const scan = y => [2,2,0,8, 136,128+y, 136,32, 136,64, 136,132];
  return picture('+Y 4 -X 8',[0,1,2,3].flatMap(scan));
}

test('decodes Radiance scanlines, orientation, legacy runs, and bounded portable radiance', () => {
  const image=HDR.radiance(stripes());
  assert.equal(image.width,8);
  assert.equal(image.height,4);
  assert.deepEqual(Array.from(image.pixels.slice(0,8)),[131,32,64,132,131,32,64,132]);
  assert.deepEqual(Array.from(image.pixels.slice(-4)),[128,32,64,132]);
  const legacy=HDR.radiance(picture('-Y 2 +X 4',[128,80,31,130,1,1,1,3, 64,32,17,129,1,1,1,3]));
  assert.deepEqual(Array.from(legacy.pixels.slice(12,20)),[128,80,31,130,64,32,17,129]);
  assert.throws(()=>HDR.radiance(stripes().subarray(0,-1)),/Truncated/);
  assert.throws(()=>HDR.radiance(picture('-Y 4 +X 8',[2,2,0,8,0])),/scanline run/);
  const source=HDR.embedded('Calibration panorama',image);
  assert.deepEqual(HDR.unembed(source),image);
  assert.throws(()=>HDR.unembed({...source,data:source.data.slice(0,-1)+'?'}),/Invalid/);
  const white=HDR.pack(128,64,(_,c)=>c.fill(4));
  const sh=HDR.diffuse(white);
  assert(Math.abs(sh[0]*.2820947918-4)<1e-5);
  assert(sh.slice(3).every(n=>Math.abs(n)<.001));
});

const ref = node => ({ node,port:'value' });
const uniform = (value, descriptor) => ({ op:'image.uniform',inputs:{width:4,height:3,value,descriptor} });
const graph = {
  format:'ink-studio/graph-project',version:1,
  nodes:{
    color:uniform([.7,.3,.2,.75],{intent:'color',layout:'rgba',alpha:'straight'}),
    normal:uniform([0,-.6,.8],{intent:'normal',normalSpace:'tangent',normalOrientation:'directx'}),
    rough:uniform(.625,{intent:'mask',precision:'float32'}),
    opacity:uniform(.8,{intent:'mask',precision:'float32'}),
    maps:{op:'data.record',inputs:{baseColor:ref('color'),normal:ref('normal'),roughness:ref('rough'),opacity:ref('opacity')}},
    material:{op:'material.pack',inputs:{maps:ref('maps')}}
  },
  outputs:{material:ref('material'),color:ref('color'),rough:ref('rough')},
  outputUsages:{ glaze:{usage:'roughness',label:'Glaze',order:0,source:{output:'rough'},format:{format:'json'},export:false} }
};
const plan={
  format:'ink-studio/lighting-room',version:1,label:'Room fixture',
  source:{output:'material'},view:{width:160,height:120,textureSize:32}
};

test('binds typed material channels and preserves neutral camera settings', async () => {
  const project=Ink.createGraphProject(graph);
  const result=await Ink.createLightingRoom(project,plan);
  assert.deepEqual(result.carriers.map(c=>c.kind),['sphere','plane','cube']);
  assert(result.carriers.every(c=>Buffer.from(c.data,'base64').length===32*c.count));
  const {maps}=result.material;
  assert.equal(Buffer.from(maps.baseColor,'base64')[3],153);
  assert.equal(Buffer.from(maps.finish,'base64')[0],159);
  assert(Buffer.from(maps.normal,'base64')[1]>128,'DirectX green was converted to OpenGL');
  assert.deepEqual(result.rigs.map(r=>r.id),Object.keys(Rig.presets));
  const {source,...rest}=plan;
  const usage=await Ink.createLightingRoom(project,{...rest,maps:{roughness:{map:'glaze'}}});
  assert.equal(usage.material.maps.finish,maps.finish);
  await assert.rejects(Ink.createLightingRoom(project,{...plan,selected:'absent'}),/Unknown selected room rig/);
  await assert.rejects(Ink.createLightingRoom(project,{...plan,rigs:[Rig.builtin('neutral-even')]}),/distinct/);
});

test('graph lighting-room imports relative HDRI and exports reusable self-contained rigs', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-lighting-room-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'graph.json'), filename=path.join(dir,'plan.json'), out=path.join(dir,'review');
  fs.mkdirSync(path.join(dir,'setups'));
  fs.writeFileSync(source,JSON.stringify(graph));
  const panorama=path.join(dir,'setups','stage.hdr');
  fs.writeFileSync(panorama,stripes());
  const rig={format:Rig.format,version:1,id:'photo',label:'Photo studio',environment:{file:'stage.hdr',rotation:67,background:true},
    camera:{framing:[.4,.66],projection:'orthographic',focalLength:46,exposureEV:.8}};
  fs.writeFileSync(path.join(dir,'setups','photo.json'),JSON.stringify(rig));
  fs.writeFileSync(filename,JSON.stringify({...plan,selected:'photo',rigs:['setups/photo.json']}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'graph','lighting-room',source,filename,'--out',out,'--json'],
    {encoding:'utf8'}));
  assert.equal(result.file,path.join(out,'index.html'));
  assert.equal(result.selected,'photo');
  assert.equal(result.material.maps,undefined);
  assert.match(result.rigs.at(-1).environment.source.sha256,/^[a-f0-9]{64}$/);
  for(const file of ['index.html','live.js','renderer.js','shaders.js','camera-lens.js','hdr-environment.js','rig.js','data.js'])
    assert(fs.statSync(path.join(out,file)).size>50,file);
  const saved=JSON.parse(fs.readFileSync(path.join(out,'rigs','photo.json'),'utf8'));
  assert.deepEqual(Rig.prepare(saved,HDR.unembed),saved);
  assert.deepEqual(HDR.unembed(saved.environment.source),HDR.radiance(stripes()));
  assert.deepEqual(saved.camera.framing,[.4,.66]);
  assert.equal(saved.camera.focalLength,46);
  assert.equal(saved.environment.background,true);
  const pkg=await Ink.createLightingRoom(Ink.createGraphProject(graph),{...plan,rigs:[saved],selected:saved.id});
  assert.deepEqual(pkg.rigs.at(-1),saved);
  const collision=path.join(dir,'room.json');
  fs.copyFileSync(filename,collision);
  await assert.rejects(Ink.writeLightingRoom(Ink.createGraphProject(graph),collision,{directory:dir}),/source files intact/);
  assert.deepEqual(fs.readFileSync(filename),fs.readFileSync(collision));
});

test('imports floating-point OpenEXR and PFM without clipping radiance to display white', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-room-float-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const data=Float32Array.from({length:24},(_,i)=>[4.5,2,.25][i%3]);
  const color=Ink.load().KIT.procedural.graphImages.declare({width:4,height:2,channels:3,data},
    {intent:'color',precision:'float32',colorSpace:'srgb-linear'});
  const expected=[144,64,8,131];
  for(const encoding of ['exr','pfm']) {
    const file=path.join(dir,'exposure.'+encoding);
    fs.writeFileSync(file,Ink.encodeTexture(color,{encoding,bitDepth:32}));
    assert.deepEqual(Array.from(Ink.readRoomEnvironment(file).pixels.slice(0,4)),expected,encoding);
  }
});

test('WebGL renders rotated HDRI lighting independently from the panorama', {
  skip: !process.env.INK_TEST_CHROME
}, async t => {
  const {pathToFileURL}=require('node:url');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-room-webgl-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'plan.json');
  fs.writeFileSync(filename,JSON.stringify(plan));
  const {file}=await Ink.writeLightingRoom(Ink.createGraphProject(graph),filename,{directory:dir});
  fs.writeFileSync(file,`<!doctype html><canvas id="view"></canvas><pre id="result">pending</pre>
<script src="data.js"></script><script src="camera-lens.js"></script><script src="hdr-environment.js"></script>
<script src="shaders.js"></script><script src="renderer.js"></script>
<script>
try {
  const canvas=document.getElementById('view'), renderer=RoomRenderer.create(canvas,lightingRoom);
  const gl=canvas.getContext('webgl2');
  const rig=structuredClone(lightingRoom.rigs[0]), environment=rig.environment;
  const pixel=(x,y)=>{
    const value=new Uint8Array(4);
    gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);
    return value;
  };
  renderer.render(rig,'sphere');
  const subject=pixel(80,60), corner=pixel(0,0);
  environment.background=true;
  renderer.render(rig,'sphere');
  const sameLight=String(pixel(80,60))===String(subject), visible=String(pixel(0,0))!==String(corner);
  environment.background=false;
  environment.rotation=140;
  renderer.render(rig,'sphere');
  const turns=String(pixel(80,60))!==String(subject), clean=String(pixel(0,0))===String(corner);
  document.getElementById('result').textContent=JSON.stringify({sameLight,visible,turns,clean,error:gl.getError()});
} catch(error) { document.getElementById('result').textContent=JSON.stringify({error:error.message}); }
</script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--enable-unsafe-swiftshader',
    '--disable-background-networking','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],
    {encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore']});
  const result=/<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1];
  assert(result && result!=='pending','WebGL fixture did not render');
  assert.deepEqual(JSON.parse(result),{sameLight:true,visible:true,turns:true,clean:true,error:0});
});
