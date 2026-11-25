const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const kit=ink.load();
const {KIT:K}=kit;
const baseCamera={target:[0,0,0],dist:3.2,yaw:.45,pitch:.16,fov:.68,ortho:true};

function fixture({KIT:K,makeBuilder},change=0,paintedTexels){
  const width=24,height=18,heights=new Float32Array(width*height);
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,u=x/(width-1),v=y/(height-1);
    heights[i]=-.28*Math.exp(-((u-.33-v*.23)**2)*120)+.17*Math.exp(-((u-.70)**2)*140);
    pixels.set([136+change,152,111,255],i*4);
  }
  const relief=K.procedural.lod.relief.create({id:'coupon',objectId:'panel',partId:'mark',origin:[-1,-.7,0],
    right:[2,0,0],up:[0,1.4,0],texture:{width,height,pixels},heights,paintedSize:10,segments:[20,16],
    featureSize:.25,normalPixels:2,geometryPixels:3,paintedTexels});
  return makeBuilder(9,[0x192c3c]).finish({reliefLOD:[relief],cam:{target:[0,0,0],dist:3.2,yaw:.45,pitch:.16,
    fov:.68,ortho:true},dither:0,radius:4});
}

const plan={format:'ink-studio/relief-review',version:1,asset:'coupon',width:72,height:52,
  ranges:[{id:'near',frames:3,from:baseCamera,to:{...baseCamera,dist:3.45,yaw:.69}},
    {id:'wide',frames:3,from:{...baseCamera,dist:9,yaw:.32},to:{...baseCamera,dist:10,yaw:.38}}]};
const camera=sequence=>sequence[Math.floor(sequence.length/2)].camera;

function selection(world,settings){
  let selected;
  const image=ink.render(world,{w:plan.width,h:plan.height,px:1,raw:true,...settings,
    reliefLODFrame:rows=>{[selected]=rows;}});
  return {image,selected};
}

test('matched native review isolates shape, moving key response, motion and representation work',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-relief-review-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const report=ink.reviewRelief(()=>fixture(kit),plan,{kit,directory});
  const near=report.ranges[0], {geometry,normal,painted}=near.summary.light;
  assert.equal(geometry.diagnosticMismatches,0);
  assert(normal.silhouetteErrorMax>0);
  assert(geometry.lightResponseRmseMax>1&&normal.lightResponseRmseMax>1);
  assert.equal(painted.lightResponseRmseMax,0);
  assert(normal.lightResponseErrorMax>0);
  assert(near.summary.motion.painted.motionResidualRmseMax>0);
  assert(geometry.triangles>normal.triangles && normal.triangles===painted.triangles);
  assert(normal.normalTexels>0&&painted.normalTexels===0&&painted.materialTexels<normal.materialTexels);
  assert.deepEqual(report.artGrid,{width:72,height:52,pixelSize:1});
  for(const row of report.ranges)for(const seq of Object.values(row.frames))for(const frame of seq)
    assert(report.tiers.every(tier=>frame.lanes[tier].work.diagnosticMatchesTimedPicture));
  const art=PNG.read(path.join(directory,near.frames.motion[1].lanes.normal.image));
  assert.deepEqual([art.w,art.h],[72,52]);
  assert(fs.existsSync(path.join(directory,report.animation)));

  const approval=ink.approveRelief(report,{near:'painted',wide:'normal'},{kit});
  assert(approval.choices.every(row=>row.evidence.sha256.length===64&&row.evidence.frames===6));
  const world=fixture(kit), settings={...camera(near.frames.light),reliefApproval:approval};
  assert.equal(selection(world,settings).selected.tier,'painted');
  assert.equal(selection(world,settings).selected.approvedRange,'near');
  assert.equal(selection(world,{...settings,reliefLOD:'geometry'}).selected.reason,'override');
  assert.equal(selection(world,{...settings,yaw:1.3}).selected.reason,'screen-size');
  assert.equal(selection(world,{...settings,h:53}).selected.reason,'screen-size');
  assert.equal(selection(fixture(kit,2),settings).selected.reason,'screen-size');
  assert.equal(selection(world,{...settings,protectedLOD:{format:'ink-studio/protected-lod-guard',version:1,
    holds:[{object:'panel',part:'mark',transition:'relief-painted',features:['profile']}]}}).selected.tier,'geometry');
  world.reliefApproval=approval;
  assert.equal(selection(world,camera(report.ranges[1].frames.light)).selected.tier,'normal');
  assert.throws(()=>ink.approveRelief(report,{other:'painted'},{kit}),/no reviewed camera range/);
  const damaged=JSON.parse(JSON.stringify(report));
  damaged.ranges[0].frames.motion[0].lanes.painted.work.diagnosticMatchesTimedPicture=false;
  assert.throws(()=>ink.approveRelief(damaged,{near:'painted'},{kit}),/visible geometry and candidate evidence/);
  const a=approval.choices[0];
  assert.throws(()=>K.procedural.lod.reliefApproval.prepare({ ...approval,
    choices:[a,{...a,tier:'normal',range:{...a.range,id:'overlap'}}]}),/conflicting relief camera ranges/);
});

test('the painted lane can use an object-local texel bake without inheriting its lighting maps',async()=>{
  const {bakeObjectTexels}=await import('../src/object-texels.mjs');
  const mesh={points:[-1,-.7,0,1,-.7,0,1,.7,0,-1,.7,0],triangles:[0,1,2,0,2,3]};
  const bake=bakeObjectTexels(mesh,{origin:[0,0,-1],resolution:8,
    paint:({point})=>point[0]>.14?0x796649:0xcbac79,fallback:0x6c664e});
  const world=fixture(kit,0,bake), settings={...baseCamera,reliefLOD:'painted'};
  const left=selection(world,{...settings,liveSun:{direction:[-.7,.4,.5],shadows:false}});
  const right=selection(world,{...settings,liveSun:{direction:[.7,.4,.5],shadows:false}});
  assert.equal(left.selected.paintSource,'object-texels');
  assert(left.selected.triangles>2);
  assert.equal(left.selected.normalTexels,0);
  assert.deepEqual(left.image.rgb,right.image.rgb);
});

test('WebGL applies reviewed ranges and moves the live key only on shaded tiers',{skip:!process.env.INK_TEST_CHROME},()=>{
  const report=ink.reviewRelief(()=>fixture(kit),{...plan,ranges:plan.ranges.slice(0,1)},{kit});
  const approval=ink.approveRelief(report,{near:'normal'},{kit});
  const result=require('../cli/look-webgl')({},fixture,(toolkit,build,backend,{camera,approval,width,height})=>{
    const world=build(toolkit), renderer=backend(width,height,{raw:true,px:1,offscreen:true});
    try {
      function draw(tier,direction) {
        let selected;
        renderer.draw(world,{camera,reliefApproval:approval,reliefLOD:tier,liveSun:{direction,shadows:false},
          reliefLODFrame:rows=>{[selected]=rows;}});
        return {selected,bytes:renderer.image()};
      }
      const a=[-.8,.38,.45], b=[.79,.48,.38];
      const start=draw(undefined,a), end=draw(undefined,b), painted=draw('painted',a), next=draw('painted',b);
      return {tier:start.selected.tier,range:start.selected.approvedRange,normalChanged:start.bytes!==end.bytes,
        paintChanged:painted.bytes!==next.bytes};
    } finally {renderer.close();}
  },{camera:camera(report.ranges[0].frames.light),approval,width:plan.width,height:plan.height});
  assert.equal(result.tier,'normal');
  assert.equal(result.range,'near');
  assert(result.normalChanged);
  assert.equal(result.paintChanged,false);
});
