const {test}=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');

function fixture({KIT:K,makeBuilder}) {
  const width=32,height=24, heights=new Float32Array(width*height), rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/(width-1),v=y/(height-1), i=y*width+x;
    heights[i]=.24*Math.exp(-((u-.5-v*.18)**2)*85)-.12*Math.exp(-((u-.27)**2)*110);
    rgba.set([157,115+Math.round(22*u),71,(x>26&&y>7&&y<13)?0:255],i*4);
  }
  const plan=K.procedural.lod.relief.create({id:'hewn-panel',objectId:'marker',partId:'carving',materialId:'limestone',
    origin:[-1,-.75,0],right:[2,0,0],up:[0,1.5,0],texture:{width,height,pixels:rgba},heights,
    featureSize:.25,normalPixels:2,geometryPixels:6,segments:[18,12],paintedSize:8,
    light:[-.53,.60,.6],ambient:.42
  });
  return {plan,world:makeBuilder(24,[0x223144]).finish({reliefLOD:[plan],dither:0,
    fog:{c:0,start:1,max:0},cam:{target:[0,0,0],dist:3,ortho:true,pitch:0,yaw:0,fov:.62}})};
}

const kit=ink.load();
const view={w:144,h:104,px:1,raw:true,dither:0,outline:false};
const distances=[3,10,30];
const tiers=['geometry','normal','painted'];
function render(world,settings) {
  let report;
  const image=ink.render(world,{...view,...settings,passes:['opaque-surface','partId'],reliefLODFrame:rows=>{report=rows;}});
  assert(report);
  return {image,report:report[0]};
}

test('headless selects the active tier on the native grid, preserves identity and draws real relief depth',()=>{
  const {world}=fixture(kit);
  const results=distances.map(dist=>render(world,{dist}));
  assert.deepEqual(results.map(({report})=>report.tier),tiers);
  assert.deepEqual(results.map(({report})=>report.triangles),[432,2,2]);
  assert.deepEqual(results.map(({report})=>report.normalTexels),[0,768,0]);
  assert(results[2].report.materialTexels<results[1].report.materialTexels);
  for(const {image} of results){
    const hit=ink.pickSurface(image.passes,73,52);
    assert.deepEqual([hit.object,hit.part,hit.material],['marker','carving','limestone']);
  }
  const close=render(world,{dist:3}), normal=render(world,{dist:3,reliefLOD:'normal'});
  const actual=ink.pickSurface(close.image.passes,73,52), proxy=ink.pickSurface(normal.image.passes,73,52);
  assert(Math.abs(actual.depth-proxy.depth)>.06,JSON.stringify({actual,proxy}));
  const hidden=render(world,{dist:3,reliefLOD:false});
  assert.equal(hidden.report.tier,null);
  assert.equal(ink.pickSurface(hidden.image.passes,73,52),null);
  const coarser=render(world,{dist:3,artGridScale:3});
  assert.equal(coarser.report.tier,'normal');
});

test('a grazing view keeps geometry for the projected profile and culls a relief outside the viewport',()=>{
  const {plan,world}=fixture(kit), preview=kit.KIT.procedural.lod.preview;
  const side=plan.inspect(preview.camera(world,{...view,dist:6,yaw:1.56}));
  assert(side.featurePixels<2);
  assert(side.profilePixels>=6);
  assert.equal(side.tier,'geometry');
  const outside=plan.select(preview.camera(world,{...view,target:[100,0,0]}));
  assert.equal(outside.report.reason,'visibility');
  assert.equal(outside.asset,null);
  assert.equal(plan.mesh('normal'),plan.mesh('normal'));
  assert.throws(()=>plan.inspect(preview.camera(world,view),'unknown'),/choose auto/);
});

test('an authored mesh and registered normal map feed the same three-tier contract',()=>{
  const {KIT:K}=kit;
  const normalMap=Uint8Array.from(Array.from({length:4},()=>[62,128,235,255]).flat());
  const geometry={positions:[0,0,0,1,0,0,0,1,.2,1,1,.2],uvs:[0,1,1,1,0,0,1,0],indices:[0,1,2,1,3,2]};
  const plan=K.procedural.lod.relief.create({id:'authored',origin:[0,0,0],right:[1,0,0],up:[0,1,0],
    texture:{width:2,height:2},geometry,normalMap,light:[1,0,.12]});
  const mid=K.sceneMeshes.layer(plan.mesh('normal')), far=K.sceneMeshes.layer(plan.mesh('painted'));
  assert.deepEqual(mid.normalPixels,normalMap);
  assert(far.pixels[0]<mid.pixels[0]);
  assert(K.sceneMeshes.layer(plan.mesh('geometry')).vertices.some((n,i)=>i%5===2&&n>.19));
});

test('WebGL uses the same screen tiers and picks the matching depth, including after a seek',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const result=require('../cli/look-webgl')({},fixture,(kit,build,backend,{view,distances})=>{
    const {world}=build(kit), gpu=backend(view.w,view.h,view), results=[];
    const ray={origin:[.06,0,4],direction:[0,0,-1],maxDistance:12};
    try {
      for(const dist of [...distances,distances[0]]){
        let report;
        const frame={dist,reliefLODFrame:rows=>{[report]=rows;}};
        gpu.draw(world,frame);
        const pick=gpu.pick(world,ray,frame).solid;
        results.push({tier:report.tier,triangles:report.triangles,depth:pick?.distance,target:pick?.target,
          center:gpu.sample({p:[73,52]}).p});
      }
      gpu.draw(world,{reliefLOD:false});
      return {results,hidden:gpu.pick(world,ray,{reliefLOD:false}).solid};
    } finally {gpu.close();}
  },{view,distances});
  assert.deepEqual(result.results.map(x=>x.tier),[...tiers,tiers[0]]);
  assert.deepEqual(result.results[0],result.results.at(-1));
  assert(result.results[0].depth<3.92);
  assert.equal(result.results[1].depth,4);
  assert.equal(result.results[2].depth,4);
  assert(result.results.every(row=>row.target.object==='marker'&&row.target.part==='carving'));
  assert.equal(result.hidden,null);
});
