const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const core=require('..'),kit=core.load(),water=kit.KIT.procedural.waterBodies;
const body=(id,reflection,styled=false)=>water.create({id,bounds:{min:[0,0],max:[1,1]},
  sample:()=>({bed:-1,surface:0}),optics:{reflection,...(styled&&{deepTint:[0,0,0]})}});

test('water capture bindings use existing optics, stable plane slots and both GPU layouts',()=>{
  for(const styled of [false,true]){
    const binding={plane:'mirror',distortion:3,blur:.5},b=body('lake',binding,styled);
    binding.plane='changed';
    const scene=water.scene([b]),packed=scene.pack(),base=packed.uniforms.u_waterReflectionBase;
    assert.deepEqual(scene.reflectionPlanes,['mirror']);
    assert.deepEqual([...packed.data.slice(base*4,base*4+4)],[1,3,.5,0]);
    const mapped=scene.mapColors(()=>rgb=>rgb.map(v=>v*.5));
    assert.deepEqual(mapped.reflectionPlanes,['mirror']);
    assert.deepEqual([...mapped.pack().data.slice(base*4,base*4+4)],[1,3,.5,0]);
    assert.equal(Boolean(packed.uniforms.u_waterAtlas),styled);
  }
  for(const reflection of [{plane:''},{plane:'a',distortion:-1},{plane:'a',blur:17}])assert.throws(()=>body('a',reflection),/reflection/);
  const dry=water.scene([body('plain')]).pack();
  assert.equal(dry.uniforms.u_waterReflectionBase,undefined);
  const many=Array.from({length:5},(_,i)=>water.create({id:String(i),bounds:{min:[i,0],max:[i+1,1]},sample:()=>({bed:-1,surface:0}),optics:{reflection:{plane:String(i)}}}));
  assert.throws(()=>water.scene(many),/four/);
});

test('live capture planning mirrors cameras, skips back faces, caps size and validates bindings',async()=>{
  const {waterReflectionPlan,selectReflectionWorld}=await import('../src/webgl/reflections.mjs');
  const scene=water.scene([body('lake',{plane:'mirror'})]),camera={view:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,-3,-6,1]),eye:[0,3,6]};
  const B=kit.makeBuilder(1,[0,0xff0000]);B.iso(0,1,0,.1,B.P[1],1);
  const world=B.finish({water:scene,reflections:[kit.KIT.reflection.plane({id:'mirror',select:(i,x)=>x>0})]});
  const plan=waterReflectionPlan(world,{},camera,1800,1200,kit.KIT.reflection);
  assert.equal(plan.width,512);assert.equal(plan.height,341);assert.deepEqual(plan.captures[0].camera.eye,[0,-3,6]);
  assert.equal(plan.active[0],1);
  const selected=selectReflectionWorld(world,world.reflections[0],0,kit);
  assert.equal(selected.data[3],0);assert.equal(world.data[3],1);
  world.data[0]=2;assert.equal(selectReflectionWorld(world,world.reflections[0],0,kit).data[3],1);
  assert.equal(waterReflectionPlan(world,{reflections:false},camera,100,100,kit.KIT.reflection),null);
  assert.equal(waterReflectionPlan(world,{}, {...camera,eye:[0,-1,6]},100,100,kit.KIT.reflection).captures.length,0);
  assert.throws(()=>waterReflectionPlan({...world,reflections:[]},{},camera,100,100,kit.KIT.reflection),/Unknown/);
  assert.throws(()=>waterReflectionPlan(world,{reflectionScale:0},camera,100,100,kit.KIT.reflection),/scale/);
});

test('software water captures shade textured beds, move with geometry and honor source selection',()=>{
  const {render}=require('../cli/render.js'),{KIT:K,makeBuilder,SpriteSurface,TexturedSurface}=kit;
  const B=makeBuilder(4,[0,0xff0000]);B.disc(0,1,-2,[0,0,1],.65,.01,B.P[1],1);
  const atlas=SpriteSurface.make();atlas.mesh(TexturedSurface.heightfield({bounds:[-1,1,-3,2],segments:[1,1],height:()=>-.8}),1,1,()=>0);
  const pool=water.create({id:'lake',bounds:{min:[-1,-3],max:[1,2]},resolution:[16,16],sample:()=>({bed:-1,surface:0}),
    optics:{tint:[0,0,0],extinction:[0,0,0],surfaceColor:[1,1,1],surface:1,refraction:0,foam:0,caustics:0,reflection:{plane:'mirror',distortion:0}}});
  const world=B.finish({spriteSurfaces:atlas.finish(),water:water.scene([pool]),radius:8,
    cam:{target:[0,0,0],dist:Math.sqrt(45),pitch:Math.atan(.5),yaw:0},reflections:[K.reflection.plane({id:'mirror'})]});
  const options={w:97,h:97,px:1,samples:true,colored:false,edges:false};
  const pixel=()=>{const frame=render(world,options),i=(48*97+48)*3;return [...frame.color.slice(i,i+3)];};
  const first=pixel();assert(first[0]>50&&first[1]<5,String(first));
  world.data[0]=2;const moved=pixel();assert(moved[0]<first[0]/2,String(moved));
  world.data[0]=0;world.reflections=[K.reflection.plane({id:'mirror',select:()=>false})];
  assert(pixel()[0]<first[0]/2);
});

async function browserProbe(createRenderer){
  const kit={KIT,PixelLook,RenderStages,SpriteSurface},gl=document.querySelector('canvas').getContext('webgl2');
  const renderer=createRenderer(document.querySelector('canvas'),{toolkit:kit});
  const size=97,mid=48;
  function mesh(x,y,z0=-3,z1=2){return TexturedSurface.heightfield({bounds:[x-1,x+1,z0,z1],segments:[1,1],height:()=>y});}
  const atlas=SpriteSurface.make();atlas.mesh(mesh(-2,-.8),1,1,()=>0x000000);atlas.mesh(mesh(2,.2),1,1,()=>0x000000);
  const B=makeBuilder(3,[0,0xff0000,0x00ff00]);
  B.disc(-2,1,-2,[0,0,1],.65,.01,B.P[1],1);
  B.disc(2,2,-2,[0,0,1],.65,.01,B.P[2],1);
  const optics={tint:[0,0,0],extinction:[0,0,0],surfaceColor:[1,1,1],surface:1,refraction:0,foam:0,caustics:0};
  const volumes=(holes,styled=false)=>[-2,2].map((x,i)=>KIT.procedural.waterBodies.create({id:'pool'+i,
    bounds:{min:[x-1,-3],max:[x+1,2]},resolution:[16,16],
    sample:(px,pz)=>holes&&i===0&&Math.abs(px-x)<.3&&Math.abs(pz)<.4?null:{bed:i-.8,surface:i},
    optics:{...optics,...(styled&&{deepTint:[0,0,0]}),reflection:{plane:'mirror'+i,distortion:0}}}));
  const world=B.finish({spriteSurfaces:atlas.finish(),water:KIT.procedural.waterBodies.scene(volumes(false)),radius:8,
    reflections:[0,1].map(i=>KIT.reflection.plane({id:'mirror'+i,at:[0,i,0]}))});
  function draw(x,y,options={}){
    renderer.render(world,{width:size,height:size,raw:true,dither:0,damp:false,reflectionScale:1,
      camera:{target:[x,y,0],dist:Math.sqrt(45),pitch:Math.atan(.5),yaw:0},...options});
    const rgba=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    if(gl.getError()!==0)throw Error('WebGL error');
    return {rgba,center:[...rgba.slice((mid*size+mid)*4,(mid*size+mid)*4+3)]};
  }
  const first=draw(-2,0),second=draw(2,1),disabled=draw(-2,0,{reflections:false});
  if(first.center[0]<50||first.center[1]>5)throw Error('red reflection behind textured bed: '+first.center);
  if(second.center[1]<50||second.center[0]>5)throw Error('second elevated pool: '+second.center);
  if(disabled.center[1]<50||first.center[1]>5)throw Error('reflection toggle: '+disabled.center);
  const blit=gl.blitFramebuffer.bind(gl), scaledCaptures=[];
  gl.blitFramebuffer=(...args)=>{scaledCaptures.push(args.slice(0,8));return blit(...args);};
  const passQuality={reflections:{primary:['mirror0'],secondaryScale:.5}};
  const sharp=draw(-2,0,{passQuality}).center, scaled=draw(2,1,{passQuality}).center;
  const culled=draw(2,1,{passQuality:{reflections:{primary:['mirror0'],maxSecondary:0}}}).center;
  gl.blitFramebuffer=blit;
  if(sharp.some((n,i)=>n!==first.center[i])||scaled[1]-Math.max(scaled[0],scaled[2])<50||
    culled[1]-Math.max(culled[0],culled[2])>10)
    throw Error('secondary reflection quality changed the primary or lost the fallback: '+[sharp,scaled,culled]);
  if(scaledCaptures.length!==2||scaledCaptures.some(copy=>copy[2]!==49||copy[3]!==49))
    throw Error('secondary reflection did not use a half-size framebuffer: '+scaledCaptures);
  world.water=KIT.procedural.waterBodies.scene(volumes(false,true));
  const atlasFirst=draw(-2,0).center,atlasSecond=draw(2,1).center;
  if(atlasFirst.some((v,i)=>Math.abs(v-first.center[i])>1)||atlasSecond.some((v,i)=>Math.abs(v-second.center[i])>1))
    throw Error('atlas water reflection layout disagrees with uniform layout');
  world.data[0]+=.8;
  const moved=draw(-2,0);
  if(moved.center[0]>first.center[0]*.5)throw Error('reflection did not follow live source: '+moved.center);
  world.data[0]-=.8;
  world.water=KIT.procedural.waterBodies.scene(volumes(true));
  const hole=draw(-2,0).center;const clearHole=draw(-2,0,{water:false}).center;if(hole.some((v,i)=>Math.abs(v-clearHole[i])>1))throw Error('reflection leaked into dry shoreline hole: '+hole+' / '+clearHole);
  world.water=KIT.procedural.waterBodies.scene(volumes(false));
  const panel=SpriteSurface.make();panel.mesh(mesh(-2,-.8),1,1,()=>0);
  panel.mesh(TexturedSurface.grid({segments:[1,1],point:(u,v)=>[-2.7+u*1.4,.3+v*1.4,-2]}),1,1,()=>0x0000ff);
  world.spriteSurfaces=panel.finish();world.data[3]=0;
  const reflectedPanel=draw(-2,0).center;
  if(reflectedPanel[2]<50||reflectedPanel[0]>5)throw Error('atlas mesh did not reflect: '+reflectedPanel);
  world.data[3]=1;
  // Keep both meshes in one atlas so receiver and occluder use the same depth buffer.
  const combined=SpriteSurface.make();combined.mesh(mesh(-2,-.8),1,1,()=>0);combined.mesh(mesh(2,.2),1,1,()=>0);
  combined.mesh(mesh(-2,.5,.6,1.5),1,1,()=>0x2040ff);world.spriteSurfaces=combined.finish();
  const occluded=draw(-2,0).center;
  if(occluded[2]<240||occluded[0]>40)throw Error('foreground textured bank failed to occlude water: '+occluded);
  // The underwater texture itself must receive the same absorption as splats.
  const floor=SpriteSurface.make();floor.mesh(mesh(-2,-.8),1,1,()=>0xffffff);world.spriteSurfaces=floor.finish();
  const absorbing=KIT.procedural.waterBodies.create({id:'dark',bounds:{min:[-3,-3],max:[-1,2]},sample:()=>({bed:-1,surface:0}),
    optics:{...optics,surface:0,extinction:[1,1,1]}});
  world.water=KIT.procedural.waterBodies.scene([absorbing]);
  const wet=draw(-2,0).center,dry=draw(-2,0,{water:false}).center;
  if(wet[0]>dry[0]*.5||wet[0]<20)throw Error('textured terrain did not receive water absorption: '+wet+' / '+dry);
  renderer.dispose();return {first:first.center,second:second.center,moved:moved.center,occluded,wet,dry};
}

test('WebGL captures moving sources in separate pools and clips against shorelines and textured terrain',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reflections-'));
  try{
    fs.writeFileSync(path.join(temp,'bundle.js'),core.bundle());
    fs.writeFileSync(path.join(temp,'index.html'),`<!doctype html><canvas></canvas><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
try{window.samples=await (${browserProbe.toString()})(createRenderer);document.querySelector('#result').textContent='PASS';}
catch(e){document.querySelector('#result').textContent=e.stack;}</script>`);
    const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking','--allow-file-access-from-files',
      '--enable-unsafe-swiftshader','--use-angle=swiftshader','--user-data-dir='+path.join(temp,'profile'),'--dump-dom',pathToFileURL(path.join(temp,'index.html')).href],
      {timeout:90000,encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});
    assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
