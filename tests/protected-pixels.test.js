const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');

function fixture({KIT:K,makeBuilder}, baked) {
  const B=makeBuilder(27,[0x1a2635,0x48565d,0x788881]);
  const positions=[-.8,-.6,0,.8,-.6,0,-.8,.6,0,.8,.6,0];
  const rectangle={uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3]};
  const body=K.sceneMeshes.create({id:'body-plate',objectId:'relay',partId:'body',positions,...rectangle,
    materials:[{id:'iron',color:0x48565d}]});
  const hood=K.sceneMeshes.create({id:'shutter',positions:[-.75,-.18,.22,-.28,-.18,.22,-.75,.26,.22,-.28,.26,.22],...rectangle,
    materials:[{id:'shade',color:0x788881}]});
  B.disc(.16,-.33,.13,[0,0,1],.014,.005,B.P[1],.9);
  const look={protectedPixels:{budget:2,marks:[
    {id:'behind-hood',at:[-.55,.02,.024],color:'#fc11e9',priority:20},
    {id:'eye',at:{mesh:'body-plate',uv:[.74,.68],offset:.025},color:'#ffec92',priority:10},
    {id:'spark',at:{splat:0},color:'#88ffff',priority:8,active:[.2,2]},
    {id:'letter',at:{mesh:'body-plate',uv:[.51,.31],offset:.02},stamp:['##.','#.#','##.'],color:'#ff7256',priority:7},
    {id:'same-eye',at:{mesh:'body-plate',uv:[.74,.68],offset:.025},color:'#847bff',priority:6},
    {id:'wire',path:[[-.11,.40,.045],[.18,.47,.045],[.57,.41,.045]],color:'#82ffb2',priority:2,size:.012},
    {id:'near-detail',at:[.64,-.30,.04],color:'#ff4f79',size:.2}
  ]}};
  const camera={target:[0,0,0],dist:4.4,yaw:0,pitch:0,ortho:true,fov:2*Math.atan(.26)};
  const world=B.finish({id:'protected-relay',meshes:[body,hood],cam:camera,look,radius:5,dither:0,fog:{c:0,start:1,max:0}});
  if(baked){
    const R=K.sprite.reconstruction, atlas={metadata:baked.metadata,
      images:Object.fromEntries(Object.entries(baked.images).map(([key,data])=>[key,Uint8Array.from(data)]))};
    R.bindParts(world,[{object:'relay',part:'body',material:'iron',representation:'mesh',mesh:body,
      sprite:{asset:R.asset({atlas,range:[4,7]}),at:[0,0,0],lighting:false}}]);
  }
  return {world,body,positions,shift(dx){
    K.sceneMeshes.pose(body,positions.map((v,i)=>i%3===0?v+dx:v));
  }};
}

const width=78,height=64,view={w:width,h:height,px:1,t:.4,passes:['protected','depth']};
const kit=ink.load();
const swatch=(frame,hex)=>Array.from({length:frame.w*frame.h},(_,i)=>i)
  .filter(i=>frame.rgb[i*3]*65536+frame.rgb[i*3+1]*256+frame.rgb[i*3+2]===hex);
const reasons=frame=>Object.fromEntries(frame.protectedPixels.marks.map(mark=>[mark.id,mark.status]));

test('protected pixels charge only visible pixels, budget whole marks, and follow a posed mesh UV',()=>{
  const {world,shift}=fixture(kit), image=ink.render(world,view);
  assert.equal(image.protectedPixels.used,2);
  assert.deepEqual(reasons(image),{'behind-hood':'occluded',eye:'kept',spark:'kept',letter:'budget','same-eye':'overlap',wire:'budget','near-detail':'large'});
  const [eye]=swatch(image,0xffec92);
  assert(Number.isInteger(eye) && image.passes.protected[eye]===1);
  assert.equal(swatch(image,0xfc11e9).length,0);
  shift(.09);
  const posed=ink.render(world,view), [moved]=swatch(posed,0xffec92);
  assert(moved>eye && moved-eye<=4);
  const reassigned=ink.render(world,{...view,protectedPixels:{budget:7,priorities:{letter:50}}});
  assert.equal(reasons(reassigned).letter,'kept');
  assert.equal(swatch(reassigned,0xff7256).length,6);
  assert.equal(reassigned.protectedPixels.used,7);
  const none=ink.render(world,{...view,protectedPixels:{budget:0}});
  assert.equal(none.protectedPixels.used,0);
  assert.equal(swatch(none,0xffec92).length,0);
  assert.equal(reasons(ink.render(world,{...view,t:.1})).spark,'inactive');
  assert.throws(()=>ink.render(world,{...view,protectedPixels:{priorities:{missing:1}}}),/must name authored marks/);
});

test('directional atlas color excludes live budgeted accents by default',()=>{
  const {world}=fixture(kit), options={width,height,directions:1,times:[.4],maps:['depth']};
  const hasEye=({images})=>images.color.some((n,i)=>i%4===0 && n===255 && images.color[i+1]===236 && images.color[i+2]===146);
  assert(!hasEye(ink.spriteAtlas(world,options)));
  assert(hasEye(ink.spriteAtlas(world,{...options,view:{protectedPixels:true}})));
});

test('WebGL keeps marks at the same native pixels during a real mesh-to-impostor handoff',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const {world,body}=fixture(kit);
    const atlas=ink.spriteAtlas({...world,meshes:[body]},{width,height,directions:1,maps:['depth']});
    const baked={metadata:atlas.metadata,images:Object.fromEntries(Object.entries(atlas.images).map(([key,data])=>[key,[...data]]))};
    const result=require('../cli/look-webgl')({},fixture,(kit,build,backend,input)=>{
      const {world}=build(kit,input.baked), r=backend(input.width,input.height,{offscreen:true,colored:false,dither:0});
      try{
        const frames=[];
        for(const mode of ['geometry','sprite']){
          let report,representation;
          r.draw(world,{time:.4,spriteReconstruction:mode,protectedPixelsFrame:value=>{report=value;},
            spriteReconstructionFrame:value=>{representation=value.states[0];}});
          const rgb=atob(r.image()), found=[];
          for(let i=0;i<rgb.length;i+=3)if(rgb.charCodeAt(i)===255 && rgb.charCodeAt(i+1)===236 && rgb.charCodeAt(i+2)===146)found.push(i/3);
          frames.push({report,found,representation});
        }
        return {frames};
      }finally{r.close();}
    },{baked,width,height});
    const [near,far]=result.frames;
    assert.equal(far.representation.sprite,1);
    assert.equal(near.found.length,1,JSON.stringify(near));
    assert.deepEqual(far.found,near.found,JSON.stringify(far));
    assert.equal(far.report.used,2);
    assert.equal(far.report.marks[0].status,'occluded');
  });
