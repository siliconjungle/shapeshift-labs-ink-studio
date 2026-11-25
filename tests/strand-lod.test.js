const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({KIT:K,makeBuilder}, atlas) {
  const B = makeBuilder(4,[0x141e2a,0xe89a63]);
  for (const [center,gap,width] of [[-1,.022,.029],[0,.48,.029],[1,.022,.083]]) {
    K.curveSplats.draw(B,{kind:'textile',plan:{threads:[-1,1].map(side=>({
      path:{points:Array.from({length:13},(_,i)=>[center+side*gap*.5,-1+i/6,0])}
    }))}},{object:'ropes',material:'cord',target:{part:'ropes'},width,edge:'hard',color:'#e89a63',
      lod:{aggregate:{samples:4,color:'#175ad9',coverage:{width:[.66,1],spacing:[.49,.78]}}}});
  }
  const world = B.finish({radius:4,dither:0,fog:{c:0,start:1,max:0},
    cam:{target:[0,0,0],dist:8,yaw:0,pitch:0,fov:.7,ortho:true}});
  if (atlas) {
    const api = K.sprite.reconstruction;
    api.bindParts(world,[{object:'ropes',part:'ropes',material:'cord',representation:'curves',
      sprite:{asset:api.asset({atlas,projectedRange:[.51,.92]}),at:atlas.metadata.pivot,lighting:false}}]);
  }
  return world;
}

const options = {w:144,h:96,px:1,raw:true,edges:false,renderStats:true};
const row = (rgb,y) => rgb.subarray((y*144+71)*3,(y*144+73)*3);

test('strand groups require unresolved width and spacing and keep the authored gap open',()=>{
  const world = fixture(ink.load());
  const original = world.data.slice();
  const full = ink.render(world,{...options,curveLod:false});
  const grouped = ink.render(world,options);
  assert.equal(full.renderStats.curveSegments,72);
  assert.equal(grouped.renderStats.curveSegments,52);
  assert.deepEqual(grouped.renderStats.strandLod,
    {groups:3,grouped:1,blending:0,individual:2,proxySpans:4,replacedSpans:24});
  assert.deepEqual(world.data,original);
  for (let y=39;y<59;y++) {
    assert.deepEqual(row(grouped.rgb,y),Uint8Array.from([20,30,42,20,30,42]));
    assert.deepEqual(row(grouped.rgb,y),row(full.rgb,y));
  }
  const near = ink.render(world,{...options,dist:3.8});
  assert.equal(near.renderStats.strandLod.individual,3);
  const between = ink.render(world,{...options,dist:5.2});
  assert.equal(between.renderStats.strandLod.blending,1);
  for (let step=1;step<16;step++) {
    const {visible} = ink.load().KIT.curveSplats.strandLod;
    const pixels = Array.from({length:16},(_,i)=>[i%4,i>>2]);
    assert.equal(pixels.filter(([x,y])=>visible(step,x,y)).length,step);
    assert(pixels.every(([x,y])=>visible(step,x,y)!==visible(-step,x,y)));
  }
});

const strandGuard = {format:'ink-studio/protected-lod-guard',version:1,holds:[
  {object:'ropes',part:'ropes',transition:'strand',features:['weave']}
]};

test('a strand feature hold keeps individual spans and reports the requested grouping',()=>{
  const world = fixture(ink.load());
  world.protectedLOD = strandGuard;
  let decisions;
  const guarded=ink.render(world,{...options,strandLODFrame:rows=>{decisions=rows;}});
  const unguarded=ink.render(world,{...options,protectedLOD:false});
  const full=ink.render(world,{...options,curveLod:false});
  assert.equal(guarded.renderStats.curveSegments,full.renderStats.curveSegments);
  assert.deepEqual(guarded.rgb,full.rgb);
  assert.equal(unguarded.renderStats.strandLod.grouped,1);
  assert.deepEqual(decisions.filter(row=>row.reason),[
    {object:'ropes',part:'ropes',group:24,grouped:0,reason:'protected-feature',features:['weave'],requestedGrouped:1}
  ]);
});

test('a coverage-mipped strand card uses projected texel size and keeps the gap',()=>{
  const kit=ink.load();
  const {atlas} = ink.bakeCurves(fixture(kit),{object:'ropes',width:80,height:72,directions:1,ribbon:false,cutoutMipmaps:true});
  assert.equal(atlas.metadata.curveBake.sourceSpans,72);
  const world = fixture(kit,atlas);
  let state;
  const capture = spriteReconstructionFrame=>{state=spriteReconstructionFrame.states[0];};
  ink.render(world,{...options,h:208,spriteReconstructionFrame:capture});
  assert.equal(state.sprite,0);
  const render = ink.render(world,{...options,h:96,dist:12,spriteReconstructionFrame:capture});
  assert.equal(state.sprite,1);
  assert(state.cutoutLevel>=1);
  assert.equal(render.renderStats.curveSegments,0);
  for (let y=41;y<57;y++) assert.deepEqual(row(render.rgb,y),Uint8Array.from([20,30,42,20,30,42]));
});

test('WebGL and headless choose the same strand masks and card handoffs',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const kit=ink.load(), source=fixture(kit);
    const {atlas}=ink.bakeCurves(source,{object:'ropes',width:80,height:72,directions:1,ribbon:false,cutoutMipmaps:true});
    const serialized={metadata:atlas.metadata,images:Object.fromEntries(Object.entries(atlas.images)
      .map(([name,bytes])=>[name,Buffer.from(bytes).toString('base64')]))};
    const result=runWebGL({},fixture,(kit,make,backend,{atlas,strandGuard})=>{
      for (const [name,bytes] of Object.entries(atlas.images)) atlas.images[name]=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0));
      const world=make(kit,atlas), painter=backend(144,96,{width:144,height:96,raw:true,edges:false});
      try {
        return {frames:[4,5.2,8,12,8].map((dist,i)=>{
          let curves,cards;
          painter.draw(world,{camera:{...world.cam,dist},protectedLOD:i===4?strandGuard:undefined,curveFrame:value=>{curves=value;},
            spriteReconstructionFrame:value=>{cards=value.states;}});
          return {curves,cards,rgb:painter.image()};
        })};
      } finally { painter.close(); }
    },{atlas:serialized,strandGuard});
    const world=fixture(kit,atlas);
    for (const [i,dist] of [4,5.2,8,12,8].entries()) {
      let cards;
      const cpu=ink.render(world,{...options,dist,protectedLOD:i===4?strandGuard:undefined,spriteReconstructionFrame:value=>{cards=value.states;}});
      const gpu=result.frames[i];
      assert.deepEqual(gpu.curves.strandLod,cpu.renderStats.strandLod);
      assert.equal(gpu.curves.segments,cpu.renderStats.curveSegments);
      assert.equal(gpu.cards[0].sprite,cards[0].sprite);
      const image=Buffer.from(gpu.rgb,'base64');
      for (let y=41;y<57;y++) assert.deepEqual([...row(image,y)],[...row(cpu.rgb,y)]);
      if (dist===5.2) {
        let proxies=0;
        for (let y=29;y<67;y++) for (let x=42;x<52;x++) {
          const at=(y*144+x)*3;
          if (image[at+2]===217) proxies++;
          assert.deepEqual([...image.subarray(at,at+3)],[...cpu.rgb.subarray(at,at+3)]);
        }
        assert(proxies>5,'the mixed shot must sample the blue guide');
      }
    }
  });
