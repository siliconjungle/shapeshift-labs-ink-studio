const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const ink = require('..');

function fixture({KIT:K, makeBuilder, SpriteSurface}) {
  const geometry = K.sceneMeshes;
  const colors = [0x143242,0x689a86,0xe6b296,0xf5deba];
  const tex = (r,g,b) => {
    const pixels = new Uint8Array(5*5*4);
    for(let i=0;i<25;i++) pixels.set([r,g,b,i>=10&&i<15?0:255],i*4);
    return {width:5,height:5,pixels};
  };
  const normal = new Uint8Array(5*5*4);
  for(let i=0;i<25;i++) normal.set([203,128,220,255],i*4);
  const rectangle = z => ({positions:[-1,1,z,1,1,z,-1,-1,z,1,-1,z],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3]});
  const front = geometry.create({id:'grille',...rectangle(.5),faceMaterials:[0,1],materials:[
    {id:'amber',texture:tex(136,70,51),normal},{id:'jade',texture:tex(41,114,97)}
  ]});
  const rear = geometry.create({id:'housing',...rectangle(-.18),materials:[{id:'slate',color:0x35496c}]});
  const sign = SpriteSurface.make(2);
  sign.face([1.12,-.44,.1],[.57,0,0],[0,.72,0],2,2,()=>0xe2947b,{id:'sign'});
  const B=makeBuilder(2,colors);
  B.disc(-1.49,.45,.4,[0,0,1],.21,.02,B.P[2],1);
  const world = B.finish({meshes:[front,rear],spriteSurfaces:sign.finish(),dither:0,
    cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  const view = {w:80,h:56,px:1,raw:true,passes:['opaque-surface']};
  const lights = x => [{id:'test light',shape:'disk',at:[x,.42,1.58],normal:[0,0,-1],
    size:[.1,.1],color:'#ffffff',intensity:6,radius:8,sampleGrid:1,visible:false,shadows:false}];
  const point = ([x,y]) => ({origin:[x,y,3],direction:[0,0,-1]});
  return {world,view,lights,front,rectangle,point};
}

const toolkit=ink.load();
const bytes = (frame,p) => Array.from(frame.rgb.subarray(p*3,p*3+3));
const close=(a,b)=>assert(Math.abs(a-b)<1e-4,JSON.stringify({a,b}));

test('indexed meshes share depth, textured normals, palette resolve and the art-pixel owner with existing surfaces',()=>{
  const {world,view,lights}=fixture(toolkit);
  const frame=ink.render(world,view), p=frame.passes;
  const amber=p.materialId.indexOf(p.materials.indexOf('amber'));
  const jade=p.materialId.indexOf(p.materials.indexOf('jade'));
  const slate=p.materialId.indexOf(p.materials.indexOf('slate'));
  assert(amber>=0&&jade>=0&&slate>=0);
  assert.deepEqual(bytes(frame,amber),[136,70,51]);
  assert.deepEqual(bytes(frame,jade),[41,114,97]);
  assert.deepEqual(bytes(frame,slate),[53,73,108]);
  const hit=ink.pickSurface(p,amber%p.w,Math.floor(amber/p.w));
  assert.equal(hit.object,'grille');
  assert.equal(hit.material,'amber');
  assert.equal(hit.kind,'mesh');
  assert.equal(hit.coverage,1);
  close(hit.position[2],.5);
  close(hit.restPosition[2],.5);
  hit.geometricNormal.forEach((value,index)=>close(value,Number(index===2)));
  assert(hit.shadingNormal[0]>.55);
  assert(hit.uv.every(n=>n>=0&&n<=1));
  const hole=ink.pickSurface(p,40,28);
  assert.equal(hole.object,'housing');
  assert(hole.depth>hit.depth);
  assert.deepEqual(bytes(frame,28*p.w+40),[53,73,108]);
  assert(p.objectId.includes(p.objects.indexOf('sign')));
  assert(p.surfaceKind.includes(3));
  const styled=ink.render(world,{...view,raw:false}), rgb=bytes(styled,amber);
  assert(world.pal.includes((rgb[0]<<16)|(rgb[1]<<8)|rgb[2]));
  assert.notDeepEqual(bytes(frame,amber),rgb);
  const lit=ink.render(world,{...view,areaLights:lights(1.6)});
  assert(bytes(lit,amber)[0]>136);
  const off=ink.render(world,{...view,meshes:false}).passes;
  assert(!off.objects.includes('grille')&&off.objectId.includes(off.objects.indexOf('sign')));
  const meshOnly=ink.render(world,{...view,spriteSurfaces:false}).passes;
  assert(!meshOnly.objects.includes('sign')&&meshOnly.objects.includes('grille'));
});

test('contribution picking skips transparent texels and follows indexed vertex updates',()=>{
  const {world,view,front,rectangle,point}=fixture(toolkit), K=toolkit.KIT;
  const pick=K.procedural.contributions.create(world);
  const ray=point([-.5,.45]), first=pick.ray(ray).solid;
  assert.equal(first.id,'grille');
  assert.equal(first.triangle,0);
  assert.equal(first.target.material,'amber');
  close(first.uv[0],.25);
  close(first.uv[1],.275);
  first.normal.forEach((value,index)=>close(value,Number(index===2)));
  assert.equal(pick.ray(point([-.5,0])).solid.id,'housing');
  assert.equal(pick.ray({...ray,accept:hit=>hit.id!=='grille'}).solid.id,'housing');
  assert.equal(pick.ray({...ray,meshes:false}).solid,null);
  const before=ink.render(world,{...view,captureSurfaceMotion:true,t:0});
  const shifted=rectangle(.5).positions.map((n,i)=>i%3===0?n+.55:n);
  K.sceneMeshes.pose(front,shifted);
  assert.equal(pick.ray(ray).solid.id,'housing');
  const moved=pick.ray(point([.05,.45])).solid;
  assert.equal(moved.id,'grille');
  close(moved.restPosition[0],-.5);
  const p=ink.render(world,{...view,t:.1,motionFrom:before.motionReference}).passes;
  const matched=p.objectId.findIndex((id,i)=>p.objects[id]==='grille'&&p.surfaceMotionValid[i]===255);
  assert(matched>=0 && p.surfaceMotion[matched*2]>2);
  close(p.position[matched*3]-p.objectPosition[matched*3],.55);
  assert.throws(()=>K.sceneMeshes.pose(front,[1,2,3]),/finite XYZ/);
  assert.equal(pick.ray(point([.05,.45])).solid.id,'grille');
  const invalid={id:'bad',...rectangle(.5),materials:[{id:'color'}]};
  assert.throws(()=>K.sceneMeshes.create({...invalid,uvs:new Array(8)}),/normalized UV/);
  assert.throws(()=>K.sceneMeshes.create({...invalid,indices:[0,1,4]}),/indexed triangles/);
  assert.throws(()=>ink.render({...world,meshes:[front,front]},view),/distinct IDs/);
});

test('CLI inspection reports the selected mesh and UV on the native grid',()=>{
  const scene=path.join(__dirname,'../examples/native-textured-mesh.js');
  const source=require(scene)(toolkit), world=source.build(source.seed), t=.6;
  require('../cli/diarama-pose.js').pose(world,t,{kit:toolkit});
  const frame=ink.render(world,{w:180,h:112,px:1,t,passes:['opaque-surface']});
  const p=frame.passes, index=p.objectId.indexOf(p.objects.indexOf('tidal-receiver'));
  assert(index>=0);
  const point=[index%p.w,Math.floor(index/p.w)];
  const json=execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'surface-pixel',scene,
    '--at',point.join(','),'--t',String(t),'--w','180','--h','112','--px','1'],{encoding:'utf8'});
  const {hit}=JSON.parse(json);
  assert.equal(hit.object,'tidal-receiver');
  assert.equal(hit.kind,'mesh');
  assert.equal(hit.uv.length,2);
});

test('WebGL draws depth-tested mesh cutouts, palette and lights and picks posed geometry',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const {world,view}=fixture(toolkit), frame=ink.render(world,view), p=frame.passes;
  const sample=p.materialId.findIndex((id,i)=>p.materials[id]==='amber'&&i%p.w>=30&&Math.floor(i/p.w)>10);
  assert(sample>=0);
  const at=[sample%p.w,Math.floor(sample/p.w)];
  const browser=require('../cli/look-webgl.js')({},fixture,(kit,build,backend,at)=>{
    const {world,view,lights,front,rectangle,point}=build(kit);
    const painter=backend(view.w,view.h,{raw:true,dither:0});
    try {
      painter.draw(world);
      const raw=painter.sample({amber:at,hole:[40,28]});
      painter.draw(world,{areaLights:lights(1.6)});
      const lit=painter.sample({amber:at}).amber;
      painter.draw(world,{raw:false});
      const palette=painter.sample({amber:at}).amber;
      const r=point([-.5,.45]);
      const before=painter.pick(world,r).solid;
      kit.KIT.sceneMeshes.pose(front,rectangle(.5).positions.map((n,i)=>i%3===0?n+.55:n));
      painter.draw(world);
      const shifted=painter.sample({amber:at}).amber;
      return {raw,lit,palette,before,shifted,after:painter.pick(world,r).solid};
    } finally { painter.close(); }
  },at);
  assert.deepEqual(browser.raw.amber,[136,70,51]);
  assert.deepEqual(browser.raw.hole,[53,73,108]);
  assert(browser.lit[0]>136);
  assert(world.pal.includes((browser.palette[0]<<16)|(browser.palette[1]<<8)|browser.palette[2]));
  assert.equal(browser.before.id,'grille');
  assert.equal(browser.after.id,'housing');
  assert.notDeepEqual(browser.shifted,browser.raw.amber);
});
