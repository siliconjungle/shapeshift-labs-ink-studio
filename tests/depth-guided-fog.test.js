const assert=require('node:assert/strict');
const test=require('node:test');
const { execFileSync }=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ink=require('..');
const toolkit=ink.load(), { KIT:K }=toolkit;
const { pose }=require('../cli/diarama-pose.js');
const { applyAtmosphere, atmosphereQuality }=require('../cli/scene-optics.js');

test('native extinction keeps a narrow clear gap clear between coarse lighting samples',()=>{
  const width=25,height=9,depth=new Float32Array(width*height).fill(3);
  const field=K.procedural.density.bounded({
    bounds:{min:[0,0,1],max:[width,height,2]},
    sample:x=>Math.floor(x)===4?0:.65
  });
  const scene=K.atmosphere.prepare([K.atmosphere.field({field,density:2,step:.05,color:'#5ed0f9'})],[]);
  const ray=(x,y)=>({origin:[x,y,0],direction:[0,0,1],axial:1});
  function draw(scale,reconstruction) {
    const col=new Float32Array(width*height*3);
    const lighting=K.atmosphere.lighting({ambient:.7,spots:[
      {at:[2,height/2,0],direction:[0,0,1],radius:36,innerAngle:7,outerAngle:48,intensity:1.4,castsShadow:false}
    ]},[]);
    return {...applyAtmosphere(scene,col,depth,ray,width,height,5,atmosphereQuality({scale,reconstruction,stats:true}),
      0,lighting,true),col};
  }
  const native=draw(1,'lighting'), old=draw(4,'depth'), guided=draw(4,'lighting');
  const p=4*width+4;
  assert(old.fog[p]>.5 && old.col[p*3+2]>.05);
  assert.equal(guided.fog[p],0);
  assert.deepEqual(Array.from(guided.col.subarray(p*3,p*3+3)),[0,0,0]);
  assert.deepEqual(guided.fog,native.fog);
  assert(guided.stats.lightingSamples<native.stats.lightingSamples*.2);
  assert(guided.stats.extinctionRays>width*height*.8);
});

test('coarse scattering matches full resolution at the mesh doorway and moving cart edges',()=>{
  const example=require('../examples/depth-aware-fog/aperture-works.js')(toolkit), world=example.build(example.seed);
  const width=128,height=80,seen=new Set();
  let leaked=0;
  for(const t of [.62,1.46,2.03]){
    pose(world,t,{kit:toolkit});
    const options={w:width,h:height,px:1,t,raw:true,captureFog:true,passes:['opaque-surface','fogTransmittance']};
    const render=(scale,reconstruction,composition='depth')=>ink.render(world,{...options,
      volumeQuality:{scale,reconstruction,composition,stats:true}});
    const full=render(1,'lighting'), old=render(4,'depth'), guided=render(4,'lighting','auto');
    assert.equal(guided.volumeStats.mode,'lighting');
    if(t===.62){
      const legacy=render(1,'object','auto');
      assert.equal(legacy.volumeStats.mode,'layered');
      assert.deepEqual(full.rgb,legacy.rgb);
      assert.deepEqual(full.fog,legacy.fog);
    }
    assert.deepEqual(guided.fog,full.fog);
    assert.deepEqual(guided.passes.fogTransmittance,full.passes.fogTransmittance);
    assert.deepEqual(guided.passes.depth,full.passes.depth);
    assert.deepEqual(guided.passes.objectId,full.passes.objectId);
    assert(guided.volumeStats.boundaryRejectedTaps>0);
    assert(guided.volumeStats.lightingSamples<full.volumeStats.lightingSamples*.44);
    const {objectId,objects}=full.passes, cart=objects.indexOf('cart'), gate=objects.indexOf('doorway');
    const cartPixels=[], jamb=[];
    for(let y=1;y<height-1;y++)for(let x=1,p=y*width+1;x<width-1;x++,p++){
      const ids=[p-1,p+1,p-width,p+width].map(i=>objectId[i]);
      if(objectId[p]===cart&&ids.some(id=>id!==cart))cartPixels.push(p);
      if(objectId[p]===gate&&ids.some(id=>id===objects.indexOf('chamber')))jamb.push(p);
    }
    assert(cartPixels.length>16&&jamb.length>20);
    seen.add(cartPixels[Math.floor(cartPixels.length/2)]%width);
    for(const p of [...cartPixels,...jamb]) {
      assert.deepEqual(guided.rgb.subarray(p*3,p*3+3),full.rgb.subarray(p*3,p*3+3));
      if (old.fog[p]>full.fog[p]+.035) leaked++;
    }
  }
  assert.equal(seen.size,3);
  assert(leaked>10);
});

test('requesting lighting reconstruction keeps mixed aerial and native fog on the layered path',()=>{
  const example=require('../examples/depth-aware-fog/aperture-works.js')(toolkit), world=example.build(example.seed);
  world.aerialPerspective={start:0,density:.14,contrast:.16};
  const o={w:64,h:44,px:1,raw:true,captureFog:true,volumeQuality:{scale:4,reconstruction:'lighting',stats:true}};
  const active=ink.render(world,o);
  const reference=ink.render(world,{...o,volumeQuality:{scale:1,stats:true,reconstruction:'object'}});
  assert.equal(active.volumeStats.mode,'layered');
  assert.deepEqual(active.rgb,reference.rgb);
  assert.deepEqual(active.fog,reference.fog);
});

test('translucent splats request layered fog even when no meshes or water are present',()=>{
  const B=toolkit.makeBuilder(1,[0x171d28,0x7faeb1]);
  for(const z of [.6,-.8])B.disc(0,0,z,[0,0,1],.42,.02,B.P[1],.42);
  const world=B.finish({atmosphere:[K.atmosphere.box({min:[-2,-2,-2],max:[2,2,1],density:.65,color:'#53788b'})],
    cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  const options={w:48,h:32,px:1,raw:true,captureFog:true,volumeQuality:{scale:4,reconstruction:'lighting',stats:true}};
  const active=ink.render(world,options);
  assert.equal(active.volumeStats.mode,'layered');
  const native=ink.render(world,{...options,volumeQuality:{...options.volumeQuality,scale:1}});
  assert.deepEqual(native.rgb,active.rgb);
  assert.deepEqual(native.fog,active.fog);
});

test('the fog review compares light work and reports the doorway and cart edges',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-depth-guided-fog-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cwd=path.resolve(__dirname,'..'), out=path.join(dir,'review');
  execFileSync(process.execPath,['cli/ink-studio.js','fog-reconstruction','review','examples/depth-aware-fog/aperture-works.js',
    '--out',out,'--subject','cart','--w','96','--h','56','--from','.6','--to','.85','--fps','8','--raw'],{cwd});
  const report=JSON.parse(fs.readFileSync(path.join(out,'review.json')));
  assert.equal(report.reconstruction,'lighting');
  assert.equal(report.samples.length,2);
  for(const frame of report.samples){
    assert.equal(frame.renderStats.object.mode,'lighting');
    assert(frame.renderStats.object.lightingSamples<frame.renderStats.native.lightingSamples);
    for(const id of ['cart','doorway']){
      const edge=frame.objectsAtEdges[id];
      assert(edge.edgePixels>0);
      assert.equal(edge.guidedRGB,0);
      assert.equal(edge.guidedOpacity,0);
    }
  }
});
