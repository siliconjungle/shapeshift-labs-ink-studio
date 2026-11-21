const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT:K, makeBuilder, SpriteSurface, TexturedSurface } = ink.load();
const PNG = require('../cli/png.js');

const view = {w:61,h:49,px:1,raw:true};
const center = 24*61+30;
function basic() {
  const B = makeBuilder(3,[0x000000,0x7b7773,0xffebc6]);
  return { B, finish:extras=>B.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true},
    radius:4,dither:0,...extras}) };
}
function disc(B,x,y,z,radius,palette,alpha,object,flags) {
  const first=B.count();
  B.disc(x,y,z,[0,0,1],radius,.009,B.P[palette],alpha,flags);
  B.describeSplats(first,B.count(),{object});
}
const matte = (frame,object,view) => ink.objectMatte(frame,{object,view}).data;

test('combines every visible selected fragment through a pane, independent of the retained deep rank',()=>{
  const {B,finish}=basic();
  disc(B,0,0,-.5,.68,2,.55,'dial',{nd:true});
  disc(B,0,0,0,.62,2,.55,'dial',{nd:true});
  disc(B,0,0,.5,.45,0,.4,'pane',{nd:true,gl:true});
  disc(B,.62,0,.95,.16,1,3,'shutter');
  const world=finish({refract:0});
  const expected = (1-.40)*(.55+.55*(1-.55));
  const frame=ink.render(world,{...view,objectMattes:['dial','missing'],deepComposite:{layers:1}});
  assert(frame.deep.count[center] > frame.deep.layers);
  assert(Math.abs(matte(frame,'dial')[center]-expected)<1e-6);
  assert(!matte(frame,'missing').some(Boolean));
  assert(!matte(frame,'dial','reflected').some(Boolean));
  assert.deepEqual(frame.rgb,ink.render(world,{...view,deepComposite:{layers:1}}).rgb);
  world.refract = 18;
  const refracted=ink.render(world,{...view,objectMattes:['dial'],stableTransparency:{mode:'blend',depthTolerance:.1}});
  assert.notDeepEqual(matte(refracted,'dial'),matte(frame,'dial'));
  assert(matte(refracted,'dial').every(amount=>amount>=0&&amount<=1));
});

test('reflection mattes include filtered taps at water pixels',()=>{
  const {B,finish}=basic();
  disc(B,.12,1,-1.7,.47,2,1.7,'beacon');
  disc(B,-.69,1,-1.5,.49,1,2.1,'neighbor');
  const ground=SpriteSurface.make();
  ground.mesh(TexturedSurface.heightfield({bounds:[-2,2,-3,3],segments:[1,1],height:()=>-.8}),1,1,()=>0x202027);
  const pool=blur=>K.procedural.waterBodies.scene([K.procedural.waterBodies.create({id:'pool',
    bounds:{min:[-2,-3],max:[2,3]},resolution:[12,12],sample:()=>({bed:-1,surface:0}),
    optics:{ tint:[0,0,0],extinction:[0,0,0],surfaceColor:[1,1,1],surface:1,refraction:0,foam:0,caustics:0,
      reflection:{plane:'mirror',distortion:1.5,blur} }})]);
  const world=finish({spriteSurfaces:ground.finish(),water:pool(2.4),reflections:[K.reflection.plane({id:'mirror'})],
    cam:{target:[0,0,0],dist:6,pitch:.48,yaw:0}});
  const opts={...view,w:78,h:63,objectMattes:['beacon'],deepComposite:{layers:3,reflections:['mirror']}};
  const frame=ink.render(world,opts);
  const legacy=ink.graphDeepLayer(frame,{view:'reflected',plane:'mirror',object:'beacon'}).mask.data;
  const reflection=matte(frame,'beacon','reflected');
  assert(reflection.some(value=>value>.04));
  assert(reflection.some((value,p)=>value>.002 && !legacy[p]));
  const total=matte(frame,'beacon'), camera=matte(frame,'beacon','camera');
  assert(total.some((n,p)=>n>camera[p] && !camera[p]));
  assert(!matte(ink.render(world,{...opts,reflections:false}),'beacon','reflected').some(Boolean));
});

test('optical matte follows the same backdrop replacement as monochrome color through stacked glass',()=>{
  const B=makeBuilder(1,[0,0xffffff]);
  disc(B,.22,0,-.3,.62,1,2,'subject');
  disc(B,.08,0,.16,.53,0,.46,'rear',{nd:true,gl:true});
  disc(B,-.17,0,.36,.29,0,3,'occluder');
  disc(B,.13,0,.68,.58,0,.53,'front',{nd:true,gl:true});
  const world=B.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true},radius:4,dither:0,refract:12,
    look:{splatCoverage:'continuous'}});
  for (const stableTransparency of [false,{mode:'blend',depthTolerance:.1}]) {
    const frame=ink.render(world,{...view,objectMattes:['subject'],stableTransparency});
    const coverage=matte(frame,'subject');
    assert(coverage.some(value=>value > .2 && value < .8));
    for (let p=0;p<coverage.length;p++) assert(Math.abs(coverage[p]-frame.rgb[p*3]/255) <= .5/255+1e-6);
  }
});

test('a planar surface finish carries the reflected object through its roughness filter',()=>{
  const scene=require('../examples/reflection-detail.js')(ink.load()), world=scene.build(scene.seed);
  const opts={w:92,h:65,px:1,t:.65,objectMattes:['lantern-flame','lantern-frame'],fragmentBudget:1_000_000};
  const frame=ink.render(world,opts);
  const reflected=matte(frame,'lantern-frame','reflected');
  assert(reflected.some(value=>value>.005));
  assert(!matte(ink.render(world,{...opts,reflections:false}),'lantern-frame','reflected').some(Boolean));
});

const groups=[{id:'warm',lights:['area:lamp']},{id:'cool',lights:['shot:fill']}];
function litWorld() {
  const {B,finish}=basic();
  disc(B,0,0,0,.95,1,3,'dial');
  return finish({areaLights:[{id:'lamp',at:[-.4,.1,1.1],normal:[0,0,-1],color:'#ff9b54',
    size:[.9,.8],radius:3,intensity:4,visible:false,shadows:false}],
    shotLighting:{fill:{at:[.55,.1,1.4],normal:[0,0,-1],color:'#68b8ff',size:[.8,.8],radius:3,intensity:3}}});
}

test('named lighting plates reconstruct the reference with signed float additions',()=>{
  const world=litWorld();
  const result=ink.captureLightGroups(world,{groups,view});
  assert(result.groups[0].value.data[center*4] > 0);
  assert(result.groups[1].value.data[center*4+2] > 0);
  const reversed=ink.captureLightGroups(world,{groups:[...groups].reverse(),view});
  assert.deepEqual(reversed.reference.data,result.reference.data);
  for (let i=0;i<result.reference.data.length;i++)
    assert(Math.abs(result.reference.data[i] - result.base.data[i] - result.groups[0].value.data[i] -
      result.groups[1].value.data[i])<1e-7);
  assert.throws(()=>ink.captureLightGroups(world,{groups:[{id:'bad',lights:['area:missing']}],view}),/configured light/);
});

test('layers write 16-bit selected mattes and float group files with their native grid', t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ink-compositing-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const {manifest}=ink.exportLayers(litWorld(),{out,view,native:true,compositing:{objectMattes:['dial'],lightGroups:groups}});
  const [frame]=manifest.frames;
  assert.equal(manifest.encodings.lightGroups.colorSpace,'srgb-linear');
  const png=PNG.raster(path.join(out,frame.objectMattes[0].files.combined));
  assert.equal(png.max,65535);
  assert(png.data[center*4]>64000);
  const ref=frame.lighting.reference, file=fs.readFileSync(path.join(out,ref.file));
  assert.equal(file.length,ref.width*ref.height*16);
  assert(frame.lighting.groups.every(layer=>fs.statSync(path.join(out,layer.file)).size===file.length));
});
