const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const {prepare,solve} = require('../cli/pixel-boundaries.js');

function lane(w,h,at) {
  const n=w*h, depth=new Float32Array(n), key=new Float32Array(n), objectId=new Uint32Array(n);
  const materialId=new Uint32Array(n), splatId=new Uint32Array(n), partId=new Uint32Array(n);
  const excluded=new Uint8Array(n), motionValid=new Uint8Array(n).fill(255);
  for (let p=0;p<n;p++) {
    const [object,material,lit,skip]=at(p%w,Math.floor(p/w));
    depth[p]=object ? 2 : Infinity;
    objectId[p]=object;
    materialId[p]=material ?? 0;
    key[p]=lit ?? 0;
    excluded[p]=skip ?? 0;
  }
  return {w,h,key,value:key,excluded,entries:[],passes:{depth,objectId,materialId,splatId,partId,
    coverage:new Float32Array(n),protected:new Uint8Array(n),motion:new Float32Array(n*2),motionValid,
    objects:[null,'left','right'],materials:[null,'cloth','metal']}};
}

test('motion-linked boundary choices use evidence on both sides of the current frame',()=>{
  const frames=[1,0,1].map(owner=>({
    native:lane(8,8,(x,y)=>[x===3&&y===3 ? owner : Number(x<3)]),
    detail:lane(16,16,(x,y)=>[Number(x<7 || x===7&&y===6&&owner===1)])
  }));
  const plan=prepare({types:['silhouette'],temporal:.9,spatial:0,steps:3},8,8);
  const solved=solve(frames,plan);
  assert(solved.transitions.before>0);
  assert.equal(solved.transitions.after,0);
  assert(solved.frames[1].edits.some(([p])=>p===27));
  for (let i=0;i<3;i++) for (const [pixel,source] of solved.frames[i].edits) {
    assert.equal(Math.floor(source%16/2),pixel%8);
    assert.equal(Math.floor(source/32),Math.floor(pixel/8));
  }
});

test('a supported gap stays open and a protected pixel is immutable',()=>{
  const native=lane(8,8,(x,y)=>[y===3&&x===2 ? 1 : y===3&&x===3 ? 2 : 0]);
  const detail=lane(16,16,(x,y)=>[y===6&&(x===4||x===5) ? 1 : y===6&&x===7 ? 2 : 0]);
  const settings=prepare({constraints:[{id:'gap',kind:'gap',bounds:[2,3,2,1],
    between:[{object:'left'},{object:'right'}]}]},8,8);
  const solved=solve([{native,detail}],settings);
  assert.equal(solved.frames[0].constraints[0].status,'active');
  // One coarse cell per side leaves no cell in which to represent the gap.
  assert.equal(solved.frames[0].constraints[0].after,1);

  const wider=lane(8,8,(x,y)=>[y===3&&(x===2||x===3) ? 1 : y===3&&x===4 ? 2 : 0]);
  const samples=lane(16,16,(x,y)=>[(y===6||y===7)&&(x===4||x===5) || y===6&&x===6 ? 1 : (y===6||y===7)&&x>=8&&x<10 ? 2 : 0]);
  const expanded=prepare({constraints:[{id:'gap',kind:'gap',bounds:[2,3,3,1],
    between:[{object:'left'},{object:'right'}]}]},8,8);
  assert.equal(solve([{native:wider,detail:samples}],expanded).frames[0].constraints[0].after,0);
  wider.passes.protected[27]=1;
  const locked=solve([{native:wider,detail:samples}],expanded).frames[0];
  assert(!locked.edits.some(([p])=>p===27));
  assert.equal(locked.constraints[0].after,1);
});

test('material seams, occlusion edges and a physical key band have distinct boundary classes',()=>{
  const native=lane(8,8,(x,y)=>[1,1,y===3&&x!==3 ? 1 : 0]);
  const detail=lane(16,16,(x,y)=>[
    y===2&&x===2 ? 2 : 1,
    y===4&&x===4 ? 2 : 1,
    y===6 || y===7&&x!==7 ? 1 : 0
  ]);
  const plan=prepare({bands:[{id:'rim',threshold:.5}],
    constraints:[{id:'highlight',kind:'connected',band:'rim',bounds:[1,3,6,1]}]},8,8);
  const result=solve([{native,detail}],plan).frames[0];
  assert(result.kinds.seam>0 && result.kinds.overlap>0 && result.kinds.light>0);
  assert.deepEqual(result.constraints,[{id:'highlight',status:'active',before:1,after:0}]);
});

test('the headless shot applies native edits before palette resolution and delivers matching owner passes',()=>{
  const kit=ink.load(), B=kit.makeBuilder(1,[0x142637,0xe5bd56,0xcb5e46]), S=kit.makeSculpt(B);
  S.keepRenderSdf=true;
  S.box([0,0,0],[.53,.62,.15],{r:[1],materialId:'gold'},{objectId:'door',res:.14,rd:.04});
  S.box([.19,.18,-.35],[.64,.42,.14],{r:[2],materialId:'red'},{objectId:'wall',res:.12});
  S.bake();
  const world=B.finish({cam:{target:[0,0,0],ortho:true,dist:2.75,yaw:.11,pitch:.13,sway:0},radius:3,dither:0,
    look:{sdfAssist:true}});
  const width=38,height=31,count=3, baseline=[], output=[];
  const render=(i,options,passes)=>ink.render(world,{w:width,h:height,px:1,t:i/12,yaw:.11+i*.05,
    transparent:true,...options,passes});
  const report=ink.renderBoundaryShot({width,height,count,settings:{spatial:.40,temporal:.8},
    draw(i,options,lane,passes) {
      const frame=render(i,options,passes);
      if (lane==='native') baseline[i]=frame;
      return frame;
    },
    output(i,options) { output[i]=render(i,options,['depth','objectId']); }
  });
  assert(report.frames.some(frame=>frame.changedPixels>0));
  for (const [i,frame] of output.entries()) {
    let changed=0;
    for (let p=0;p<width*height;p++) {
      if (frame.passes.objectId[p]!==baseline[i].passes.objectId[p]) changed++;
      if (!frame.alpha[p]) assert.equal(frame.passes.depth[p],Infinity);
    }
    assert.equal(changed,report.frames[i].changedPixels);
    for (let p=0;p<width*height;p++) if (frame.alpha[p]) {
      const q=p*3, rgb=frame.rgb[q]*65536+frame.rgb[q+1]*256+frame.rgb[q+2];
      assert(world.pal.includes(rgb));
    }
  }
});
