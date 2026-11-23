const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const Atlas = require('../src/atlas-sprites.js');
const { KIT } = ink.load();

function scene(kit, { direct = false, cutout = true, atlasMode = 'depth-reprojected' } = {}) {
  const { KIT: K, makeBuilder } = kit;
  const width=64,height=32,unit=.05,depth=-.65;
  const color=new Uint8Array(width*height*4), depthMap=new Uint8Array(color.length),
    normal=new Uint8Array(color.length), emission=new Uint8Array(color.length);
  const headings=[-.52,.52];
  for (const [j,yaw] of headings.entries()) {
    // A planar cutout at z=.65 appears at a different tile address in each view.
    for (let y=0; y<height; y++) for (let x=0; x<32; x++) {
      const u=(x+.5-16)*unit, v=(16-y-.5)*unit;
      const p=(u-depth*Math.sin(yaw))/Math.cos(yaw);
      if (Math.abs(p)>.54 || Math.abs(v)>.54 || cutout && j===0 && Math.abs(p)<.16 && Math.abs(v)<.19) continue;
      const i=(y*width+j*32+x)*4;
      color.set(j===0?[216,66,28,255]:[32,77,211,255],i);
      // Camera axis depth for a point on the plane z=.65.
      const axial=-(Math.sin(yaw)*p-depth*Math.cos(yaw));
      const d=Math.round(Math.max(0,Math.min(1,(axial+2)/3))*0xffffff);
      depthMap.set([d>>16,d>>8&255,d&255,255],i);
      normal.set([Math.round(127.5*(1-Math.sin(yaw))),128,
        Math.round(127.5*(1+Math.cos(yaw))),255],i);
      if (j===0) emission.set([0,120,22,255],i);
      else emission.set([0,24,91,255],i);
    }
  }
  const atlas=K.sprite.atlas({metadata:{width,height,unitsPerPixel:unit,depthRange:[-2,1],
    viewBlend:atlasMode,normalSpace:'view',emissionMode:'add',
    frames:headings.map((yaw,i)=>({yaw,rect:{x:i*32,y:0,width:32,height}}))},
    images:{color,depth:depthMap,normal,emission}});
  const B=makeBuilder(1,[0x101820,0xffffff]);
  const placement={atlas,at:[0,0,0],objectId:'beacon'};
  if (!direct) K.surfacePatches.triangle(B,[[-.5,-.5,0],[.5,-.5,0],[0,.5,0]],{object:'beacon',color:[255,240,40]});
  const world=B.finish({cam:{target:[0,0,0],dist:5,yaw:-.04,pitch:0,sway:0},radius:3,dither:0,
    ...(direct&&{spriteAtlases:[K.sprite.placeAtlas(placement)]})});
  if (!direct) K.sprite.reconstruction.bind(world,[
    {asset:K.sprite.reconstruction.asset({atlas}),at:placement.at,object:'beacon'}
  ]);
  return { world, atlas, placement:K.sprite.placeAtlas(placement) };
}

test('aligns color, depth and normals to the same surface and preserves the nearest cutout', () => {
  const {atlas,placement}=scene(ink.load());
  const {normal:direction}=Atlas.basis(-.04,0);
  const primary=atlas.select(0,'impostor',direction);
  const resolved=Atlas.reproject(placement,primary,direction,{distance:Infinity,pixelsPerTexel:2});
  assert(resolved.report.blended>140);
  assert(resolved.report.filteredCutouts>0);
  assert(resolved.report.weight>.4);
  const {view:{pivot,unitsPerPixel},axes}=resolved;
  const out={color:[0,0,0],normal:[0,0,0],emission:[0,0,0]};
  const sample=(x,y)=>Atlas.sampleReprojected(resolved,pivot.x+x/unitsPerPixel,pivot.y-y/unitsPerPixel,placement,out);
  assert.equal(sample(0,0),false,'The far view may not fill the closest view’s hole');
  assert(sample(.28,.25));
  assert(out.color[0]>.4&&out.color[0]<.7&&out.color[2]>.3&&out.color[2]<.6);
  assert(out.hasNormal&&out.normal[2]>.98&&Math.abs(out.normal[0])<.01);
  assert(out.hasEmission&&out.emission[1]>.24&&out.emission[2]>.15);
  const x=(Math.floor(pivot.x+.28/unitsPerPixel)+.5-pivot.x)*unitsPerPixel;
  const z=axes.right[2]*x-axes.normal[2]*out.depth;
  assert(Math.abs(z-.65)<.018,'target depth must describe the same surface: '+z);
  assert.equal(Atlas.reproject(placement,primary,direction,{distance:Infinity,pixelsPerTexel:2}),resolved);
  assert.equal(Atlas.reproject(placement,primary,direction,{blend:'nearest'}),null);
  assert.equal(Atlas.reproject(placement,primary,primary.basis.normal,{distance:Infinity}),null);
  const perspective=Atlas.reproject(placement,primary,direction,{distance:2.9,pixelsPerTexel:2});
  assert(perspective && perspective.view.rect.width>resolved.view.rect.width);
});

test('headless authored placements and reconstruction agree on the baked hole and emissive paint', () => {
  const settings={w:112,h:112,px:1,raw:true,ortho:true,spriteReconstruction:'sprite',passes:['depth','normal','emission']};
  const normalRender=ink.render(scene(ink.load(),{direct:true}).world,settings);
  const lod=ink.render(scene(ink.load()).world,settings);
  assert.deepEqual(normalRender.rgb,lod.rgb);
  const at=(x,y)=>(y*settings.w+x)*3;
  assert.deepEqual(Array.from(lod.rgb.subarray(at(56,56),at(56,56)+3)),[16,24,32]);
  assert(lod.rgb[at(64,49)]>110&&lod.rgb[at(64,49)+2]>85);
  assert(lod.passes.emission.some(n=>n>.18));
  assert(lod.passes.normal.some(n=>n>.98));
  const nearest=ink.render(scene(ink.load()).world,{...settings,impostorBlend:'nearest'});
  assert.notDeepEqual(nearest.rgb,lod.rgb);
});

test('a conflicting depth keeps the closest surface and its registered mip', () => {
  const source=scene(ink.load()).atlas.snapshot();
  source.metadata.cutoutMipmaps={mode:'coverage'};
  const {width,height}=source.metadata;
  // Behind the source plane, the alternate view carries the wrong surface.
  for (let y=0; y<height; y++) for (let x=width/2; x<width; x++) {
    const i=(y*width+x)*4;
    source.images.depth[i]=32;
    source.images.depth[i+1]=source.images.depth[i+2]=0;
  }
  const atlas=KIT.sprite.atlas(source), placement=KIT.sprite.placeAtlas({atlas,at:[0,0,0]});
  const direction=Atlas.basis(-.04,0).normal, primary=atlas.select(0,'impostor',direction);
  const resolved=Atlas.reproject(placement,primary,direction,{pixelsPerTexel:.5});
  assert.equal(resolved.view.unitsPerPixel,.1);
  assert.equal(resolved.report.blended,0);
  assert(resolved.report.nearest>70);
  const {pivot}=resolved.view;
  const out={color:[0,0,0],normal:[0,0,0],emission:[0,0,0]};
  assert.equal(Atlas.sampleReprojected(resolved,pivot.x,pivot.y,placement,out),false);
  assert(Atlas.sampleReprojected(resolved,pivot.x+3,pivot.y-2,placement,out));
  assert(Math.abs(out.color[0]-216/255)<.001);
  assert(Math.abs(out.emission[1]-120/255)<.001);
});

test('nearest-view fallback is explicit when no registered depth was baked', () => {
  const source=scene(ink.load()).atlas.snapshot();
  delete source.images.depth;
  const atlas=KIT.sprite.atlas(source), placement=KIT.sprite.placeAtlas({atlas,at:[0,0,0]});
  const direction=Atlas.basis(0,0).normal, view=atlas.select(0,'impostor',direction);
  assert.equal(Atlas.reproject(placement,view,direction,{distance:Infinity}),null);
});

test('WebGL draws and picks the same cutout and registered relief', {skip: !process.env.INK_TEST_CHROME}, () => {
  const out=require('../cli/look-webgl')({hardware:true},scene,(kit,build,backend)=>{
    const {world}=build(kit);
    const b=backend(112,112,{raw:true,ortho:true,spriteReconstruction:'sprite'});
    const ray = x => ({origin:[x,0,5],direction:[0,0,-1]});
    const find = x => b.pick(world,ray(x),{ortho:true,spriteReconstruction:'sprite'}).solid;
    let report;
    try {
      b.draw(world,{spriteReconstructionFrame:frame=>report=frame.states[0].reprojection});
      const samples=b.sample({hole:[56,56],covered:[64,49]});
      const visible=find(.31), hole=find(0);
      b.draw(world,{liveSun:{direction:[0,0,-1],ambient:.35,intensity:1}});
      const shaded=b.sample({covered:[64,49]}).covered;
      return {samples,shaded,visible,hole,report};
    } finally {b.close();}
  });
  assert(out.report.blended>100);
  assert.deepEqual(out.samples.hole,[16,24,32]);
  assert(out.samples.covered[0]>110&&out.samples.covered[2]>85,JSON.stringify(out.samples));
  assert(out.shaded[0]<out.samples.covered[0]*.55);
  assert.equal(out.hole,null);
  assert.equal(out.visible.target.object,'beacon');
  assert(Math.abs(out.visible.point[2]-.65)<.03);
});
