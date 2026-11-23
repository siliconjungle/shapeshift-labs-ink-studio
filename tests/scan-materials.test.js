const assert=require('node:assert/strict');
const {test}=require('node:test');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const {readGlb}=require('../cli/glb-file.js');

function fixture({rough=false,flat=false}={}) {
  const width=20,height=20,count=width*height, depth=new Float32Array(count).fill(3);
  const data=new Uint8Array(count*4), diffuse=new Uint8Array(count*4), normal=new Uint8Array(count*4);
  const roughness=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const x=i%width,y=Math.floor(i/width), a=i*4;
    if (x<3 && y<3)depth[i]=0;
    data.set([174,74,28,255],a);
    diffuse.set([48,88,128,255],a);
    normal.set(flat || x<10 ? [128,128,255,255]:[192,128,237,255],a);
    roughness[i]=rough?255:x<10?40:100;
  }
  const image=data=>({width,height,channels:4,data});
  return {input:{width,height,depth,camera:{type:'orthographic',height:2},image:image(data)},
    options:{residualLimit:0,materials:{diffuse:image(diffuse),normal,roughness,captured:true,
      daylight:{ambient:.55,light:[.72,.1,.68],specular:.9}}}};
}
const view={w:96,h:96,px:1,raw:true,ortho:true,target:[0,0,-3],dist:3.35,yaw:0,pitch:0};
const light=x=>({id:'lamp',shape:'disk',at:[x,0,-2.25],normal:[0,0,-1],
  size:[.12,.12],color:'#ffe7bc',intensity:2.5,radius:1.2,sampleGrid:1,visible:false,shadows:false});
const pixel=(im,x,y)=>Array.from(im.rgb.subarray(3*(y*im.w+x),3*(y*im.w+x+1)));

async function scan(config) {
  const {input,options}=fixture(config);
  const result=await ink.scanToMesh(input,options);
  return {result,world:await result.world()};
}

test('default-view captured appearance is independent of native geometry and relightable material maps',async()=>{
  const {result,world}=await scan();
  const {gltf}=readGlb(result.glb), material=gltf.materials[0];
  assert.equal(gltf.images.length,4);
  assert(material.normalTexture.index!==material.pbrMetallicRoughness.metallicRoughnessTexture.index);
  assert.equal(world.gltfParts.parts[0].capturedAppearance,true);
  const passes=['opaque-surface'];
  const layers=[0,.5,1].map(scanAppearance=>ink.render(world,{...view,scanDaylight:false,passes,scanAppearance}));
  const [base,blend,captured]=layers.map(im=>pixel(im,48,48));
  assert(base[2]>base[0]*2);
  assert.deepEqual(captured,[174,74,28]);
  assert(blend[0]>base[0]&&blend[0]<captured[0]);
  assert.deepEqual(layers[0].passes.depth,layers[2].passes.depth);
  assert.deepEqual(layers[0].passes.objectId,layers[2].passes.objectId);
  const far={...view,yaw:1.12};
  assert.deepEqual(ink.render(world,far).rgb,ink.render(world,{...far,scanAppearance:1}).rgb);
  assert.throws(()=>ink.render(world,{...view,scanAppearance:1.5}),/appearance weight/);
  const {world:flat}=await scan({flat:true});
  const aligned=pixel(ink.render(world,view),60,46), unmapped=pixel(ink.render(flat,view),60,46);
  assert(aligned[2]>unmapped[2]+5);
});

test('a moving area-light highlight responds to registered roughness in the headless renderer',async()=>{
  const {world}=await scan({flat:true}), {world:matte}=await scan({flat:true,rough:true});
  const base={...view,scanDaylight:false};
  const render=(subject,x)=>ink.render(subject,{...base,areaLights:[light(x)]});
  const left=render(world,-.44),right=render(world,.44),leftMatte=render(matte,-.44);
  assert(pixel(left,31,48)[0]>pixel(right,31,48)[0]+15);
  assert(pixel(right,65,48)[0]>pixel(left,65,48)[0]+15);
  assert(pixel(left,31,48)[0]>pixel(leftMatte,31,48)[0]+12);
});

test('the CLI authors registered scan maps and can toggle the captured layer from GLB',async t=>{
  const {input,options:{materials}}=fixture();
  const dir=mkdtempSync(join(tmpdir(),'ink-scan-materials-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const paths=Object.fromEntries(['depth','image','diffuse','normal','roughness','glb','off','on'].map(key=>
    [key,join(dir,key+(key==='depth'?'.json':key==='glb'?'.glb':'.png'))]));
  const {width,height,depth,camera}=input;
  writeFileSync(paths.depth,JSON.stringify({width,height,camera,depth:Array.from(depth)}));
  for(const [key,data] of Object.entries({image:input.image.data,diffuse:materials.diffuse.data,normal:materials.normal}))
    writeFileSync(paths[key],PNG.encode(width,height,data,4));
  writeFileSync(paths.roughness,PNG.encodeGray(width,height,materials.roughness));
  const cli=(...args)=>execFileSync(process.execPath,[resolve(__dirname,'../cli/ink-studio.js'),...args],{stdio:'pipe'});
  cli('scan-mesh',paths.depth,'--image',paths.image,'--diffuse',paths.diffuse,'--normal',paths.normal,
    '--roughness',paths.roughness,'--capture-layer','--residual-limit','0','--out',paths.glb);
  const expected={diffuse:'supplied',normal:'tangent-map',roughness:'texture',captured:true};
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'glb.scan.json'))).material,expected);
  for(const [weight,key] of [['0','off'],['1','on']])
    cli('render',paths.glb,'--w','96','--h','96','--px','1','--scan-appearance',weight,'--yaw','0','--pitch','0','--out',paths[key]);
  assert(!readFileSync(paths.off).equals(readFileSync(paths.on)),'capture layer should affect the CLI render');
});

test('WebGL applies the same normal, roughness and angle-sensitive capture channels',{
  skip:!process.env.INK_TEST_CHROME
},async()=>{
  const {result}=await scan(), {result:flat}=await scan({flat:true}), {result:rough}=await scan({rough:true});
  const input={assets:[result,flat,rough].map(scan=>scan.glb.toString('base64')),lights:[light(-.44),light(.44)]};
  const images=require('../cli/look-webgl.js')({hardware:true,asyncFixture:true},async(kit,assets)=>
    Promise.all(assets.map(asset=>kit.gaussianGltfWorld(Uint8Array.from(atob(asset),c=>c.charCodeAt(0)),{toolkit:kit}))),
  async (kit,build,backend,{assets,lights})=>{
    const [world,flat,rough]=await build(kit,assets);
    const b=backend(96,96,{offscreen:true,camera:{target:[0,0,-3]},dist:3.35,yaw:0,pitch:0,ortho:true,raw:true});
    function render(world,frame) {
      b.draw(world,frame);
      return b.sample({left:[31,48],right:[65,48]});
    }
    try {
      return {day:render(world,{}),flat:render(flat,{}),captured:render(world,{scanAppearance:1}),
        offAxis:render(world,{scanAppearance:1,yaw:1.12}),axisBase:render(world,{yaw:1.12}),
        left:render(world,{scanDaylight:false,areaLights:[lights[0]]}),
        right:render(world,{scanDaylight:false,areaLights:[lights[1]]}),
        rough:render(rough,{scanDaylight:false,areaLights:[lights[0]]})};
    } finally {b.close();}
  },input);
  assert(images.day.right[2]>images.flat.right[2]+4,JSON.stringify(images));
  assert.deepEqual(images.captured.left,[174,74,28]);
  assert.deepEqual(images.offAxis,images.axisBase);
  assert(images.left.left[0]>images.right.left[0]+8);
  assert(images.left.left[0]>images.rough.left[0]+7,JSON.stringify(images));
});
