const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({KIT,makeBuilder}, edge = 'hard') {
  const B = makeBuilder(6,[0x172635,0xec8250,0x42a9ee,0x97ccb7]);
  const draw = (z,y,object,color) => KIT.curveSplats.draw(B,[[-1.1,y,z],[1.1,y,z]],{
    edge,width:.36,opacity:edge==='hard' ? 1 : .83,color,object,material:'reed',target:{part:'stem'}
  });
  draw(.38,.42,'woven','#ec8250');
  draw(-.36,-.42,'woven','#ec8250');
  draw(.5,1.4,'other','#97ccb7');
  B.disc(0,0,.6,[0,0,1],.28,.01,B.P[2],1);
  return B.finish({id:'curve-bake-test',radius:5,cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,fov:.85,ortho:true},
    fog:{c:0,start:1,max:0},dither:0,look:{curveSubdivision:true}});
}

test('finite curve bake isolates a named part and registers surviving soft alpha with depth and optional normals',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-curve-bake-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const world = fixture(ink.load(),'beta'), original = world.data.slice();
  const bake = ink.bakeCurves(world,{object:'woven',part:'stem',width:54,height:42,directions:4,normals:true,
    ribbon:{alphaCutoff:.23,depthTolerance:.011}});
  const { metadata,images } = bake.atlas;
  assert.deepEqual(world.data,original);
  assert.deepEqual([metadata.curveBake.object,metadata.curveBake.part,metadata.curveBake.sourceSpans],['woven','stem',2]);
  assert.equal(metadata.frames.length,4);
  let occupied = 0, partial = 0, validNormals = 0;
  for (let p=0; p<bake.coverage.length; p++){
    const alpha = bake.coverage[p], at = p*4;
    assert.equal(alpha,images.color[at+3]);
    assert.equal(images.depth[at+3],alpha ? 255 : 0);
    if (alpha) {
      occupied++;
      assert.deepEqual(Array.from(images.color.subarray(at,at+3)),[236,130,80]);
    }
    if (alpha > 0 && alpha < 254) partial++;
    validNormals += images.normal[at+3] > 0;
  }
  assert(occupied>400 && partial>200 && validNormals>50);
  assert(bake.ribbon.maxDepthError<=.011 && bake.ribbon.mesh.triangles===2*bake.ribbon.strips);
  ink.writeCurveBake(dir,bake);
  const loaded = ink.readSpriteAtlas(path.join(dir,'atlas.json'));
  assert(loaded.hasDepth);
  const standalone = require('../cli/png.js').raster(path.join(dir,'coverage.png'));
  assert(standalone.data.every((n,i)=>(i%4===3 ? n===255 : n===bake.coverage[Math.floor(i/4)])));
  assert.deepEqual(loaded.snapshot().images.depth,images.depth);
  const ribbon = ink.load().KIT.curveSplats.bakedRibbon(loaded);
  assert.equal(ribbon.strips,bake.ribbon.strips);
  assert.deepEqual([ribbon.mesh.objectId,ribbon.mesh.partId,ribbon.mesh.materials[0]],['woven','stem','reed']);
  const card = ink.bakeCurves(world,{object:'woven',directions:1,ribbon:false});
  assert(card.atlas.images.depth && !card.atlas.images.normal && !card.ribbon);
  assert.throws(()=>ink.bakeCurves(world,{object:'missing'}),/No finite curve spans/);
});

test('native depth ribbons keep the empty gaps and distinct front depths in the reference projection',()=>{
  const kit = ink.load(), world = fixture(kit), source = ink.bakeCurves(world,{object:'woven',directions:1,normals:true});
  const { metadata,images } = source.atlas, view = metadata.frames[0], { width,height } = view.rect;
  const dist = view.unitsPerPixel*height*.5 / Math.tan(kit.CameraLens.defaultFov*.5);
  const bakedMesh = { ...world,count:0,data:new Float32Array(0),meshes:[source.ribbon.mesh],curveSplats:false,
    cam:{target:metadata.pivot,dist,yaw:0,pitch:0,ortho:true} };
  const frame = ink.render(bakedMesh,{w:width,h:height,px:1,raw:true,transparent:true,passes:['depth','normal']});
  let count = 0;
  for(let i=0;i<frame.alpha.length;i++){
    const alpha = images.color[i*4+3];
    assert.equal(frame.alpha[i],alpha ? 255 : 0);
    if(alpha) {
      const at = i*4, [near,far] = metadata.encodings.depth.range;
      const packed = images.depth[at]*65536+images.depth[at+1]*256+images.depth[at+2];
      const expected = near+(far-near)*packed/0xffffff-view.depthOrigin;
      assert(Math.abs(frame.passes.depth[i]-(dist+2*world.radius+4)-expected)<.021);
      count++;
    }
  }
  assert(count>400);
});

test('GPU finite curves and depth cards use complementary coverage throughout the distance handoff',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const kit = ink.load(), world = fixture(kit);
    const { atlas } = ink.bakeCurves(world,{object:'woven',directions:1,width:64,height:64,ribbon:false});
    for(let p=0;p<atlas.images.color.length;p+=4)if(atlas.images.color[p+3])atlas.images.color.set([17,91,255],p);
    const sprites=kit.KIT.sprite.reconstruction;
    const bind=(kit,world,atlas)=>{
      const source=kit.KIT.sprite.reconstruction;
      source.bindParts(world,[{object:'woven',part:'stem',material:'reed',representation:'curves',
        sprite:{asset:source.asset({atlas,range:[4,8]}),at:atlas.metadata.pivot,lighting:false}}]);
    };
    bind(kit,world,atlas);
    const serialized = {metadata:atlas.metadata,images:Object.fromEntries(Object.entries(atlas.images)
      .map(([map,value])=>[map,Array.from(value)]))};
    const result=runWebGL({},fixture,(kit,make,backend,{atlas})=>{
      const world=make(kit);
      for(const name of Object.keys(atlas.images)) atlas.images[name]=Uint8Array.from(atlas.images[name]);
      const api=kit.KIT.sprite.reconstruction;
      api.bindParts(world,[{object:'woven',part:'stem',material:'reed',representation:'curves',
        sprite:{asset:api.asset({atlas,range:[4,8]}),at:atlas.metadata.pivot,lighting:false}}]);
      const painter=backend(128,88,{width:128,height:88,raw:true,edges:false});
      try {
        return { captures:['geometry','auto','sprite'].map(spriteReconstruction=>{
          let state;
          painter.draw(world,{camera:{...world.cam,dist:6},spriteReconstruction,
            spriteReconstructionFrame:value=>{state=value;}});
          return { rgb:painter.image(),state:{parts:state.states,geometryRows:state.geometryRows} };
        }) };
      } finally { painter.close(); }
    },{atlas:serialized});
    const [near,mix,far]=result.captures;
    assert.equal(mix.state.parts[0].geometry,.5);
    assert.equal(far.state.parts[0].geometry,0);
    const cpu=ink.render(world,{w:128,h:88,px:1,raw:true,edges:false,dist:6}).rgb;
    const gpu=Buffer.from(mix.rgb,'base64');
    const reference = Buffer.from(near.rgb,'base64');
    const card = Buffer.from(far.rgb,'base64');
    let mixedRed=0,mixedBlue=0,total=0;
    for(let y=28;y<52;y++)for(let x=43;x<85;x++){
      const p=(y*128+x)*3;
      if (reference[p]!==236 || card[p+2]!==255) continue;
      total++;
      if (gpu[p]===236) mixedRed++;
      if (gpu[p+2]===255) mixedBlue++;
      assert(gpu.subarray(p,p+3).every((v,i)=>Math.abs(v-cpu[p+i])<=3),
        JSON.stringify({x,y,gpu:[...gpu.subarray(p,p+3)],cpu:[...cpu.subarray(p,p+3)]}));
    }
    assert(total>140 && mixedRed>.35*total && mixedBlue>.35*total,JSON.stringify({total,mixedRed,mixedBlue}));
    assert(sprites.labels(world).some(row=>row.part==='stem'));
  });
