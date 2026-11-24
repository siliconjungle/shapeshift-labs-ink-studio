const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');
const AreaRaster=require('../cli/area-lights.js');

const box=(x,y,z,hx,hy,hz)=>{
  const a=Math.abs(x)-hx,b=Math.abs(y)-hy,c=Math.abs(z)-hz;
  return Math.hypot(Math.max(0,a),Math.max(0,b),Math.max(0,c))+Math.min(0,Math.max(a,b,c));
};
const camera={target:[0,0,0],dist:6,yaw:0,pitch:0,ortho:true};
const ray={origin:[0,0,4],direction:[0,0,-1]};
const centerBox={min:[-.07,-.07,-.10],max:[.07,.07,.10]};
const cut={operation:'subtract',bounds:{min:[-.64,-.64,-.60],max:[.64,.64,.60]},
  sdf:(x,y,z)=>box(x,y,z,.38,.45,.86),material:'trim'};

function fixture({KIT:K,makeBuilder},bakePaint) {
  const P=K.procedural;
  const bricks=P.sparseBricks.create({cell:.125,brickSize:8,base:(x,y,z)=>box(x-.028,y,z-.015,1.65,.74,.26)});
  const options={bricks,objectId:'gate',bounds:{min:[-2,-1,-.75],max:[2,1,.75]},
    materials:[{id:'stone',color:0x645344},{id:'trim',color:0xa16e42}],derived:{depthProxy:true,shadow:true,splats:true,bakePaint}};
  const controller=P.brickMeshes.create(options);
  const world=makeBuilder(1,undefined,{initialCapacity:1}).finish({cam:camera,brickMeshes:[controller]});
  return {controller,world,P,K};
}

const renderOptions={w:101,h:75,px:1,raw:true,transparent:true,passes:['opaque-surface','proxyDepth']};
const center=37*101+50;
const coat=(source,revision=source.revision)=>({
  uvs:new Float32Array(source.positions.length/3*2),
  materials:source.materials.map(({id},i)=>({id,texture:{width:1,height:1,
    pixels:Uint8Array.of(revision===1 ? 90 : 185,40+i*55,28,255)}}))
});

test('one cut publishes the matching proxy, bake, splats, shadow, pick and collision assets',()=>{
  const {controller,world,P,K}=fixture(ink.load(),coat), before=controller.current();
  const oldFrame=ink.render(world,renderOptions);
  const after=controller.edit(cut), newFrame=ink.render(world,renderOptions);
  assert.equal(after.revision,before.revision+1);
  assert.equal(newFrame.passes.depth[center],Infinity);
  assert(Number.isFinite(oldFrame.passes.depth[center]));
  assert(Number.isFinite(oldFrame.passes.proxyDepth[center]));
  assert.equal(newFrame.passes.proxyDepth[center],Infinity);
  assert.equal(before.assets.pick(ray).target.object,'gate');
  assert.equal(after.assets.pick(ray),null);
  assert.equal(P.brickMeshes.clearance([before]).probe(centerBox).clear,false);
  assert.equal(P.brickMeshes.clearance([after]).probe(centerBox).clear,true);
  assert(before.assets.collision.distance([0,0,0])<0);
  assert(after.assets.collision.distance([0,0,0])>0);
  assert(K.areaLights.occludes([before.assets.shadow],[0,0,-.65],[0,0,1],2));
  assert(!K.areaLights.occludes([after.assets.shadow],[0,0,-.65],[0,0,1],2));

  const light=K.areaLights.prepare([{id:'lamp',shape:'disk',at:[0,0,1.2],normal:[0,0,-1],size:[.15,.15],
    color:'#ffffff',intensity:5,radius:6,sampleGrid:1,shadows:true}]);
  const lit=snapshot=>AreaRaster.createLighting(light,world,world.data,undefined,{derived:[snapshot.assets.shadow]})
    (0,[0,0,-.65],[0,0,1],[.2,.2,.2])[0];
  assert(lit(after)>lit(before)+.05);

  const updated=after.chunks.find((chunk,i)=>chunk.mesh && before.chunks[i].mesh && chunk!==before.chunks[i]);
  const old=before.chunks.find(chunk=>chunk.key===updated.key);
  assert.notEqual(updated.depthProxy,old.depthProxy);
  assert.notEqual(K.sceneMeshes.layer(updated.mesh),K.sceneMeshes.layer(old.mesh));
  const body=K.sceneMeshes.trianglePigment(updated.mesh,0).color;
  assert.equal(body>>16,185);
  assert.equal(updated.splats.data[7]&255,185);
  assert(after.chunks.some((chunk,i)=>chunk.mesh && chunk===before.chunks[i]));

  const oldSplats=P.brickMeshes.splatWorld(before,{cam:camera});
  const newSplats=P.brickMeshes.splatWorld(after,{cam:camera});
  assert.equal(newSplats.brickSnapshot,after);
  assert.equal(newSplats.count,after.assets.splats.reduce((n,chunk)=>n+chunk.count,0));
  assert(ink.render(oldSplats,renderOptions).alpha[center]>0);
  assert.equal(ink.render(newSplats,renderOptions).alpha[center],0);
});

test('material edits retain the shape derivatives and a failed bake cannot advance any asset',()=>{
  let fail=false, reenter=false, controller;
  const fixtureOut=fixture(ink.load(),source=>{
    if (fail) throw new Error('paint fixture rejected');
    if (reenter) controller.update(source.bricks);
    return coat(source);
  });
  ({controller}=fixtureOut);
  const before=controller.current();
  const paint={bounds:{min:[-.07,-.32,.24],max:[.44,.32,.31]},material:'trim'};
  const after=controller.edit(paint);
  assert(after.work.recolored.length>0);
  assert.deepEqual(after.work.rebuilt,[]);
  assert.equal(after.assets.shadow,before.assets.shadow);
  assert.equal(after.assets.collision,before.assets.collision);
  assert(after.assets.depthProxies.every((handle,i)=>handle===before.assets.depthProxies[i]));
  assert(after.assets.paintBakes.some((layer,i)=>layer!==before.assets.paintBakes[i]));
  assert(after.assets.splats.some((part,i)=>part!==before.assets.splats[i]));

  fail=true;
  assert.throws(()=>controller.edit(cut),/paint fixture rejected/);
  assert.equal(controller.current(),after);
  fail=false;
  reenter=true;
  assert.throws(()=>controller.edit(cut),/while deriving/);
  assert.equal(controller.current(),after);
  reenter=false;
  const cutSnapshot=controller.edit(cut);
  assert.equal(cutSnapshot.revision,after.revision+1);
  const restored=controller.update(before.bricks);
  assert(restored.assets.pick(ray));
  assert(restored.assets.collision.distance([0,0,0])<0);
  assert.equal(cutSnapshot.assets.pick(ray),null);
});

test('WebGL can draw the old and new packed splat representations with their own depth proxies',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const result=require('../cli/look-webgl.js')({},({KIT})=>{
      const P=KIT.procedural, box=(x,y,z,a,b,c)=>Math.max(Math.abs(x)-a,Math.abs(y)-b,Math.abs(z)-c);
      const bricks=P.sparseBricks.create({cell:.125,brickSize:6,base:(x,y,z)=>box(x,y,z,1.20,.76,.26)});
      const field=P.brickMeshes.create({bricks,objectId:'gate',bounds:{min:[-1.6,-1.2,-.65],max:[1.6,1.2,.65]},
        materials:[{id:'stone',color:0xa67361}],derived:{depthProxy:true,splats:true}});
      const camera={target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true};
      const before=P.brickMeshes.splatWorld(field.current(),{cam:camera});
      const after=P.brickMeshes.splatWorld(field.edit({operation:'subtract',
        bounds:{min:[-.6,-.6,-.6],max:[.6,.6,.6]},sdf:(x,y,z)=>box(x,y,z,.38,.45,.8)}),{cam:camera});
      return {before,after};
    },(kit,make,backend)=>{
      const {before,after}=make(kit), view=backend(97,65,{raw:true});
      const spots={hole:[48,32],wall:[64,32]};
      try {
        view.draw(after);
        const opened=view.sample(spots);
        view.draw(before);
        return {opened,sealed:view.sample(spots)};
      } finally {view.close();}
    });
    assert.notDeepEqual(result.opened.hole,result.sealed.hole);
    assert.deepEqual(result.opened.wall,result.sealed.wall);
  });
