const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load();

function fixture({ makeBuilder }) {
  const w = 52, h = 36, B = makeBuilder(3,[0x1d2130,0x4e8987,0x9d5d63]);
  B.disc(0,0,0,[0,0,1],.92,.012,B.P[1],1);
  B.describeSplats(0,1,{object:'brooch',material:'enamel'});
  B.disc(-3,0,.8,[0,0,1],.18,.012,B.P[2],1);
  B.describeSplats(1,2,{object:'clasp',material:'enamel'});
  const world = B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,fov:.6},radius:3,dither:0});
  world.splatIds = ['enamel/center','clasp/center'];
  const hook = [[0,0,'#fff1bc'],[1,0,'#fff1bc'],[0,-1,'#fff1bc']];
  return { w,h,world,hook };
}
const { prepare, paint } = kit.KIT.shotCorrections;
const color = (frame,x,y) => [...frame.rgb.slice((y*frame.w+x)*3,(y*frame.w+x)*3+3)];
const cream = [255,241,188];

test('the correction pins a painted native hook over exactly four frames and retains owner/depth passes', () => {
  const {world,w,h,hook}=fixture(kit);
  const settings={w,h,px:1,raw:true,passes:['splatId','depth']};
  const first=ink.render(world,{...settings,captureShotCorrectionSurface:true});
  const anchor=first.shotCorrectionSurface.pin(26,18);
  assert.equal(anchor.splat,'enamel/center');
  assert.deepEqual(anchor.target,{object:'brooch',material:'enamel'});
  assert.equal(first.shotCorrectionSurface.pin(0,0),null);
  const plan=paint({size:[w,h],fps:12,startTime:2},{id:'hook',frames:[3,6],anchor,pixels:hook});
  const read=(frame,target)=>ink.render(world,{...settings,t:2+frame/12,target,shotCorrections:plan});
  let originalAnchor;
  for(const index of [2,3,4,5,6,7,4]){
    const target=[index*.04,0,0], view=read(index,target);
    const base=ink.render(world,{...settings,target});
    const { frame,corrections }=view.shotCorrections;
    assert.equal(frame,index);
    assert.deepEqual(view.passes.splatId,base.passes.splatId);
    assert.deepEqual(view.passes.depth,base.passes.depth);
    if(index<3||index>6){
      assert.deepEqual(corrections,[]);
      assert.deepEqual(view.rgb,base.rgb);
      continue;
    }
    const [{at,painted,clipped}]=corrections;
    assert.equal(painted,3);
    assert.equal(clipped,0);
    originalAnchor??=at;
    if(index===6)assert.notDeepEqual(at,originalAnchor);
    for(const [dx,dy] of hook)assert.deepEqual(color(view,at[0]+dx,at[1]+dy),cream);
    assert.equal(view.rgb.filter((n,i)=>i%3===0&&n===255).length,3);
  }
  assert.deepEqual(prepare(JSON.parse(JSON.stringify(plan))),plan);
  assert.throws(()=>ink.render(world,{...settings,px:2,t:2.3,shotCorrections:plan}),/native frame/);
  assert.throws(()=>paint(plan,{id:'hook',frames:[6,3],anchor,pixels:hook}),/inclusive shot frames/);
});

test('an occluding owner holds back the paint, including another part of the same material', () => {
  const {world,w,h,hook}=fixture(kit), settings={w,h,px:1,raw:true,captureShotCorrectionSurface:true};
  const anchor=ink.render(world,settings).shotCorrectionSurface.pin(26,18);
  const plan=paint({size:[w,h],fps:12},{id:'hook',frames:[0,3],anchor,pixels:hook});
  world.data[16]=0;
  const frame=ink.render(world,{...settings,shotCorrections:plan});
  assert.deepEqual(frame.shotCorrections.corrections[0],{id:'hook',at:[26,18],painted:0,clipped:3});
  assert.deepEqual(frame.rgb,ink.render(world,settings).rgb);
  assert.deepEqual(frame.shotCorrectionSurface.pin(26,18).target,{object:'clasp',material:'enamel'});
});

test('native paint remains exact after integrating a multi-sample shutter', () => {
  const {world,w,h,hook}=fixture(kit), settings={w,h,px:1,raw:true,t:.25};
  const anchor=ink.render(world,{...settings,captureShotCorrectionSurface:true}).shotCorrectionSurface.pin(26,18);
  const plan={size:[w,h],fps:24,corrections:[{id:'hook',frames:[6,6],anchor,pixels:hook}]};
  const view=ink.render(world,{...settings,shutter:{duration:.20,samples:6},shotCorrections:plan});
  assert(view.shutter.samples>1);
  assert.equal(view.shotCorrections.corrections[0].painted,3);
  for(const [dx,dy] of hook) assert.deepEqual(color(view,26+dx,18+dy),cream);
  const outside={...settings,t:7/24,shutter:{duration:.20,samples:6}};
  assert.deepEqual(ink.render(world,{...outside,shotCorrections:plan}).rgb,ink.render(world,outside).rgb);
});

test('WebGL captures a surface pin and preserves the exact painted RGB through a frame range', {
  skip:!process.env.INK_TEST_CHROME
}, () => {
  const { rows,gloss,corrected }=runWebGL({},fixture,(kit,build,backend)=>{
    const { world,w,h,hook }=build(kit), render=backend(w,h,{raw:true,offscreen:true});
    let anchor;
    try {
      render.draw(world,{captureShotCorrectionSurface:true,shotCorrectionSurfaceFrame:surface=>{anchor=surface.pin(26,18);}});
      if(!anchor)throw new Error('The enamel did not supply a visible anchor');
      const corrections={size:[w,h],fps:12,corrections:[{id:'hook',frames:[3,6],anchor,pixels:hook}]};
      const rows=[2,3,6,7].map(shotCorrectionFrame=>{
        let report;
        render.draw(world,{shotCorrectionFrame,shotCorrections:corrections,shotCorrectionsFrame:frame=>{report=frame;}});
        return {report,pixels:render.sample({corner:[26,18],tip:[27,18],arm:[26,17]})};
      });
      const K=kit.KIT;
      world.areaLights=[K.lightEmitters.disc({id:'lamp',at:[0,0,2],normal:[0,0,-1],
        size:[.1,.1],radius:6,sampleGrid:1,intensity:2,color:'#ffffff',shadows:false,visible:false})];
      world.highlightCels=[{id:'gloss',at:[0,0,0],bias:.025,light:'lamp',family:{minLight:0,
        sizes:[{id:'native',minPixels:0,cels:[{id:'white',stamp:{
          width:1,height:1,rows:['0'],palette:['#ffffff']
        }}]}]}}];
      const colorClusters={targets:[{select:{material:'enamel'},minPixels:1}]};
      render.draw(world,{raw:false,colorClusters,shotCorrections:corrections,shotCorrectionFrame:2});
      const gloss=render.sample({pixel:[26,18]}).pixel;
      render.draw(world,{raw:false,colorClusters,shotCorrections:corrections,shotCorrectionFrame:3});
      const corrected=render.sample({pixel:[26,18]}).pixel;
      return {rows,gloss,corrected};
    } finally {render.close();}
  });
  assert.equal(rows[0].report.corrections.length,0);
  assert.equal(rows[3].report.corrections.length,0);
  for(const {report,pixels} of rows.slice(1,3)){
    assert.equal(report.corrections[0].painted,3);
    assert.deepEqual(Object.values(pixels),[cream,cream,cream]);
  }
  assert.notDeepEqual(Object.values(rows[3].pixels),[cream,cream,cream]);
  assert.deepEqual(gloss,[255,255,255]);
  assert.deepEqual(corrected,cream);
});

test('WebGL applies exact tracked shot keys and skips the gaps',{ skip:!process.env.INK_TEST_CHROME },()=>{
  const { rows } = runWebGL({},fixture,(kit,build,backend)=>{
    const { world,w,h } = build(kit), render = backend(w,h,{ raw:true,offscreen:true });
    try {
      let anchor;
      render.draw(world,{ captureShotCorrectionSurface:true,shotCorrectionSurfaceFrame:surface=>{ anchor = surface.pin(26,18); } });
      const shotCorrections = { size:[w,h],fps:12,corrections:[{ id:'keyed',frames:[0,3],
        keys:[{ frame:0,pixels:[{ anchor,color:'#fff1bc' }] },{ frame:2,pixels:[{ anchor,color:'#de6c55' }] }] }] };
      const baseline = render.sample({ pixel:[26,18] }).pixel;
      return { rows:[0,1,2,3].map(shotCorrectionFrame=>{
        let report;
        render.draw(world,{ shotCorrections,shotCorrectionFrame,shotCorrectionsFrame:sample=>{ report = sample; } });
        return { report,pixel:render.sample({ pixel:[26,18] }).pixel,baseline };
      }) };
    } finally { render.close(); }
  });
  for (const [i,row] of rows.entries()) {
    if (i % 2) {
      assert.deepEqual(row.report.corrections,[]);
      assert.deepEqual(row.pixel,row.baseline);
    } else {
      assert.equal(row.report.corrections[0].key,i);
      assert.equal(row.report.corrections[0].painted,1);
      assert.deepEqual(row.pixel.slice(0,3),i === 0 ? cream : [222,108,85]);
    }
  }
});
