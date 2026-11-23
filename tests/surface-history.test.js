const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');

function fixture({KIT:K,makeBuilder}) {
  const B=makeBuilder(13,[0x101010,0x3c3c3c,0x595959,0x747474,0x909090,0xb0b0b0,0xe0e0e0,0xffffff]);
  const corners=(l,r,b,t,z)=>[l,b,z,r,b,z,l,t,z,r,t,z];
  const rectangle=(id,positions,color)=>K.sceneMeshes.create({id,positions,uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],
    materials:[{id:'paint',color}]});
  const wall=rectangle('wall',corners(-2,2,-1.3,1.3,0),0x595959);
  const panel=rectangle('panel',corners(-.9,-.1,-.55,.55,.31),0xb0b0b0);
  const world=B.finish({id:'history-fixture',meshes:[wall,panel],radius:5,dither:0,
    cam:{target:[0,0,0],dist:5,fov:2*Math.atan(.32),yaw:0,pitch:0,ortho:true},fog:{c:0,start:1,max:0}});
  function pose(x,z=.31) {K.sceneMeshes.pose(panel,corners(x,x+.8,-.55,.55,z));}
  function lights(intensity) {return [{id:'work light',shape:'disk',at:[0,.2,1.3],normal:[0,0,-1],
    color:'#ffffff',intensity,size:[.1,.1],radius:30,sampleGrid:1,visible:false,shadows:false}];}
  return {world,pose,lights,w:88,h:64};
}

const kit=ink.load();
const equalPixels=(a,b,mask,code)=>{
  let matched=0,changed=0;
  for(let i=0;i<mask.length;i++)if(mask[i]===code){
    matched++;
    for(let c=0;c<3;c++)if(a[i*3+c]!==b[i*3+c]){changed++;break;}
  }
  return {matched,changed};
};

test('software history reuses lighting on the same surface and rejects disocclusions and changed depth',()=>{
  const {world,pose,lights,w,h}=fixture(kit), state=ink.createSurfaceHistory();
  const settings={w,h,px:1,surfaceHistory:{weight:.8},surfaceHistoryState:state,captureSurfaceHistory:true};
  const first=ink.render(world,{...settings,areaLights:lights(.12),t:0});
  assert.equal(first.surfaceHistory.reset,'first');
  pose(.26);
  const joined=ink.render(world,{...settings,areaLights:lights(6),t:.032});
  const fresh=ink.render(world,{w,h,px:1,areaLights:lights(6),t:.032});
  const gate=joined.surfaceHistory;
  assert(gate.counts.accepted>100 && gate.counts.owner>50,JSON.stringify(gate.counts));
  assert(equalPixels(joined.rgb,fresh.rgb,gate.mask,1).changed>100);
  assert.equal(equalPixels(joined.rgb,fresh.rgb,gate.mask,4).changed,0);
  pose(.26,.67);
  const deeper=ink.render(world,{...settings,areaLights:lights(3),t:.064});
  assert(deeper.surfaceHistory.counts.depth>80,JSON.stringify(deeper.surfaceHistory.counts));
  const shifted=ink.render(world,{...settings,target:[.1,0,0],areaLights:lights(3),t:.096});
  assert(shifted.surfaceHistory.counts.accepted>100);
  const cut=ink.render(world,{...settings,areaLights:lights(.8),t:.128,resetRenderHistory:true});
  assert.equal(cut.surfaceHistory.reset,'cut');
  assert.deepEqual(cut.rgb,ink.render(world,{w,h,px:1,areaLights:lights(.8),t:.128}).rgb);
  const rewind=ink.render(world,{...settings,t:.095});
  assert.equal(rewind.surfaceHistory.reset,'time');
});

test('WebGL validates history with actual mesh, depth and palette reads on the native art grid',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const run=require('../cli/look-webgl');
    const result=run({},fixture,(kit,build,backend)=>{
      const {world,pose,lights,w,h}=build(kit), r=backend(w,h,{offscreen:true,colored:false,dither:0}),
        baseline=backend(w,h,{offscreen:true,colored:false,dither:0});
      let report;
      const settings={surfaceHistory:{weight:.80},surfaceHistoryFrame:value=>{report=value;}};
      function draw(time,intensity,extra={}){
        r.draw(world,{...settings,time,areaLights:lights(intensity),...extra});
        baseline.draw(world,{time,areaLights:lights(intensity),...extra,surfaceHistory:false});
        const a=atob(r.image()), b=atob(baseline.image()), different={};
        for(let p=0;p<w*h;p++)if(a.slice(3*p,3*p+3)!==b.slice(3*p,3*p+3))
          different[report.mask[p]]=(different[report.mask[p]]??0)+1;
        return {counts:report.counts,reset:report.reset,different};
      }
      try{
        const first=draw(0,.12);
        pose(.26);
        const moved=draw(.032,6);
        pose(.26,.67);
        const depth=draw(.064,3);
        const pan=draw(.096,3,{camera:{...world.cam,target:[.1,0,0]}});
        const cut=draw(.128,.8,{resetRenderHistory:true});
        return {first,moved,depth,pan,cut};
      }finally{r.close();baseline.close();}
    });
    assert.equal(result.first.reset,'first');
    assert(result.moved.counts.owner>50 && result.moved.counts.accepted>100,JSON.stringify(result.moved));
    assert(result.moved.different[1]>80,JSON.stringify(result.moved));
    assert.equal(result.moved.different[4],undefined);
    assert(result.depth.counts.depth>70,JSON.stringify(result.depth));
    assert(result.pan.counts.accepted>100,JSON.stringify(result.pan));
    assert.equal(result.cut.reset,'cut');
    assert.deepEqual(result.cut.different,{});
  });
