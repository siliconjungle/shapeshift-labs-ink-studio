const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT:K, makeBuilder, SilhouetteProtection, SceneOptics }=ink.load();
const {traceMedia}=require('../cli/scene-optics.js');
const camera={target:[0,0,0],dist:6,pitch:0,yaw:0};
const view={w:88,h:60,px:1,raw:true,captureSilhouetteProtection:true,captureFog:true,passes:['objectId']};
const pal=[0x203042,0xb9653b,0x4e6680,0xdcb87c];
const protectedRule={targets:[{id:'hero',select:{object:'actor'},fogScale:.12,contrast:1.6,pivot:.45}]};
const rgb=(frame,p)=>Array.from(frame.rgb.subarray(p*3,p*3+3));

function scene({cover=false, aerial=false, fog=true}={}) {
  const B=makeBuilder(1,pal);
  function disc(x,z,color,object) {
    const start=B.count();
    B.disc(x,0,z,[0,0,1],.31,.04,B.P[color],3);
    B.describeSplats(start,B.count(),{object,material:object});
  }
  disc(-.98,0,1,'actor');
  disc(.98,0,2,'prop');
  if (cover) disc(-.98,.5,3,'wall');
  return B.finish({
    cam:camera,radius:7,atmosphere:fog?[K.atmosphere.fog({density:.31,color:'#a7bfcb'})]:[],
    aerialPerspective:aerial && {start:.05,density:.12,contrast:.1},
    skyEnvironment:{defaults:{zenith:'#576885',horizon:'#9cb7c8',ground:'#354659',sunStrength:0}},
    look:{silhouetteProtection:protectedRule},volumeQuality:{scale:3}
  });
}

test('named protection clears only the selected visible subject on both volume render paths',()=>{
  for (const aerial of [false,true]) {
    const w=scene({aerial});
    const off=ink.render(w,{...view,silhouetteProtection:false});
    const on=ink.render(w,view);
    let changed=0, compared=0;
    for(let p=0;p<on.w*on.h;p++) {
      const name=on.passes.objects[on.passes.objectId[p]];
      if (on.silhouetteMask[p]===1) {
        assert.equal(name,'actor');
        assert(on.fog[p]<off.fog[p]);
        if (rgb(on,p).some((v,i)=>v!==rgb(off,p)[i])) changed++;
      } else if (name==='prop') {
        assert.deepEqual(rgb(on,p),rgb(off,p));
        assert.equal(on.fog[p],off.fog[p]);
        compared++;
      }
    }
    assert(changed>40 && compared>40);
    assert.deepEqual(rgb(on,0),rgb(off,0));
  }
});

test('protection follows depth ownership and can change contrast without fog',()=>{
  const w=scene({cover:true,fog:false});
  const config={targets:[{select:{object:'actor'},contrast:2,pivot:.68}]};
  const opts={...view,silhouetteProtection:config};
  for (const splatOrder of ['center','surface']) {
    const on=ink.render(w,{...opts,splatOrder});
    const off=ink.render(w,{...opts,splatOrder,silhouetteProtection:false});
    let checked=0;
    for(let p=0;p<on.w*on.h;p++) {
      const name=on.passes.objects[on.passes.objectId[p]];
      if(name==='wall') {assert.equal(on.silhouetteMask[p],0);checked++;}
    }
    assert(checked>40);
    const behind=30*88+29;
    assert(rgb(on,behind).every((value,i)=>Math.abs(value-rgb(off,behind)[i])<=2));
  }
  const visible=scene({fog:false});
  const on=ink.render(visible,opts),off=ink.render(visible,{...opts,silhouetteProtection:false});
  assert(on.silhouetteMask.some((id,p)=>id && rgb(on,p)[0]!==rgb(off,p)[0]));
});

test('shot focus grades a nearby backdrop, preserves a nearer obstruction, and attenuates only nearby rain',()=>{
  const B=makeBuilder(17,[0x162335,0xc47f46,0x268da2,0x61abc3,0xbbdfed]);
  function disc(x,z,r,color,object) {
    const first=B.count();
    B.disc(x,0,z,[0,0,1],r,.026,B.P[color],3);
    B.describeSplats(first,B.count(),{object});
  }
  disc(0,-1.3,2.45,2,'wall');
  disc(-.64,0,.31,1,'produce');
  disc(.20,.5,.15,3,'post');
  for (const [x,kind] of [[-.64,2],[-.64,15],[1.76,2]]) {
    const first=B.count();
    if (kind===2) B.stick(x,0,.95,[0,1,0],.18,.035,B.P[4],.9,{k:kind,sp:2,rg:4,ph:0,nd:true});
    else B.disc(x,.125,.95,[0,0,1],.054,.032,B.P[4],.9,{k:kind,sp:2,rg:4,ph:.06,nd:true});
    B.describePrecipitation(first,B.count());
  }
  const focus={subjects:['produce'],radius:19,depthBias:.12,background:{saturation:0,contrast:.62},rain:{subject:0,surroundings:1}};
  const config={targets:[{id:'produce',select:{object:'produce'}}],focus};
  const world=B.finish({cam:camera,radius:7,dither:0,look:{silhouetteProtection:config}});
  const settings={...view,t:0,passes:['objectId','precipitation','foregroundCoverage']};
  for (const ortho of [false,true]) {
    const baseline=ink.render(world,{...settings,ortho,silhouetteProtection:{...config,focus:false}});
    const framed=ink.render(world,{...settings,ortho});
    const gradeOnly=ink.render(world,{...settings,ortho,silhouetteProtection:{...config,focus:{...focus,rain:{}}}});
    const rainAlpha=(frame,p)=>frame.passes.precipitation[p*4+3];
    const label=(frame,p)=>frame.passes.objects[frame.passes.objectId[p]];
    assert.deepEqual(framed.passes.foregroundCoverage,baseline.passes.foregroundCoverage);
    let graded=0, localRain=0, farRain=0, obstruction=0, subject=0;
    for (let p=0;p<framed.w*framed.h;p++) {
      const x=p%framed.w, rain=rainAlpha(baseline,p);
      if (label(framed,p)==='wall' && !rain && rgb(framed,p).some((v,i)=>v!==rgb(baseline,p)[i])) graded++;
      if (framed.silhouetteMask[p] && rainAlpha(framed,p)<rain) localRain++;
      if (framed.silhouetteMask[p] && !rain) { assert.deepEqual(rgb(framed,p),rgb(baseline,p)); subject++; }
      if (label(framed,p)==='post') { assert.deepEqual(rgb(framed,p),rgb(baseline,p)); obstruction++; }
      if (x>framed.w*.70 && rain) { assert.equal(rainAlpha(framed,p),rain); farRain++; }
      assert.equal(rainAlpha(gradeOnly,p),rain);
    }
    assert(graded>20 && localRain>2 && farRain>2 && obstruction>4 && subject>12);
  }
  const resolved={...settings,raw:false,colored:true};
  const native=ink.render(world,resolved);
  assert(native.silhouetteMask.some(Boolean));
  assert.notDeepEqual(native.rgb,ink.render(world,{...resolved,silhouetteProtection:{...config,focus:false}}).rgb);
  assert.throws(()=>SilhouetteProtection.prepare({...config,focus:{subjects:['missing']}}),/unique IDs/);
  assert.throws(()=>SilhouetteProtection.prepare({...config,focus:{rain:{subject:2}}}),/rain visibility/);
});

test('focused detail smoothing stays within background surfaces and preserves visible precipitation',()=>{
  const Focus=require('../cli/subject-focus.js');
  const w=7,h=3,size=w*h;
  const config=SilhouetteProtection.prepare({targets:[{select:{object:'produce'}}],focus:{radius:8,background:{detail:0}}}).focus;
  const passes={w,h,depth:new Float32Array(size).fill(6),objectId:new Uint32Array(size).fill(2),
    materialId:new Uint32Array(size).fill(1),emission:new Float32Array(size*3)};
  const silhouetteMask=new Uint16Array(size);
  silhouetteMask[w]=1;
  passes.depth[w]=4;
  const dot=w+2, rain=w+4, otherSurface=dot-w;
  passes.objectId[dot+w]=3;
  const field=Focus.frame(config,{passes,silhouetteMask});
  const color=new Float32Array(size*3).fill(.3), precipitation=new Float32Array(size);
  color[dot*3]=.95;
  color[rain*3]=.95;
  color[otherSurface*3]=.95;
  precipitation[rain]=1;
  Focus.grade(color,w,h,field,Focus.raster(field,w,h),precipitation);
  assert(color[dot*3]<.8);
  assert(Math.abs(color[rain*3]-.95)<1e-6);
  assert(Math.abs(color[otherSurface*3]-.95)<1e-6);
  assert.equal(Focus.frame(config,{passes,silhouetteMask:new Uint16Array(size)}),null);
});

test('fog scale preserves independent water, cloud, and solid occlusion',()=>{
  const volume=K.atmosphere.field({field:K.procedural.density.bounded({
    bounds:{min:[-1,-1,-1],max:[6,1,1]},sample:()=>1}),density:.5,lit:false,color:'#bcd6ca'});
  const fog=SceneOptics.prepareVolumes([volume]);
  const thin=SceneOptics.trace(fog,[0,0,0],[1,0,0],4,[0,0,0,1],{fogScale:.25});
  assert(Math.abs(thin[3]-Math.exp(-.5))<1e-9);
  const water={extinction:[.22,.35,.49],tint:[.11,.23,.31],deepTint:[.08,.16,.25],depthRange:[0,3]};
  const cloud={trace(_o,_d,_start,_stop,out){out[0]=.07;out[1]=.12;out[2]=.19;out[3]=.64;}};
  const sample=(volumes,scale)=>traceMedia(volumes,[[1,3,water,0]],[0,0,0],[1,0,0],5,new Float64Array(8),
    [0,0,0,1],{cloud,fogScale:scale},{start:0,density:.18,contrast:.2,color:[.3,.5,.7]});
  const clear=sample(fog,0);
  assert.equal(clear[6],0);
  assert(clear[7]>.05 && clear[3]<.6);
  assert(sample(fog,1)[6]>.3);
  assert.deepEqual(clear,sample([],0));
});

test('named atlas placements can use the same protected silhouette lookup',()=>{
  const B=makeBuilder(1,pal);
  const atlas={metadata:{width:1,height:1,unitsPerPixel:1,frames:[{rect:{x:0,y:0,width:1,height:1}}]},
    images:{color:Uint8Array.of(195,96,44,255)}};
  const w=B.finish({cam:camera,atmosphere:[K.atmosphere.fog({density:.57,color:'#afc4d2'})],
    spriteAtlases:[K.sprite.placeAtlas({atlas,objectId:'actor',at:[0,0,0]})]});
  const p=30*88+44;
  const on=ink.render(w,{...view,silhouetteProtection:protectedRule});
  const off=ink.render(w,{...view,silhouetteProtection:false});
  assert.equal(on.silhouetteMask[p],1);
  assert(on.fog[p]<off.fog[p]);
  assert.notDeepEqual(rgb(on,p),rgb(off,p));
});

test('review uses every sprite export heading and pitch and measures visible edge contrast at native size',()=>{
  const w=scene();
  const width=36,height=34,directions=4,pitches=[.06,.25];
  const {image,report}=ink.silhouetteReview(w,{width,height,directions,pitches,view:{raw:true}});
  const exported=require('../cli/sprite-atlas.js').spriteAtlas(w,{width,height,directions,pitches});
  assert.equal(report.views.length,8);
  assert.deepEqual(report.views.map(({yaw,pitch})=>[yaw,pitch]),exported.metadata.frames.map(({yaw,pitch})=>[yaw,pitch]));
  assert.equal(report.width,width);
  assert.equal(report.height,height);
  assert(report.views.some(({targets:[row]})=>row.edgeSamples>0&&row.protected>row.before));
  assert(image.rgb.some(Boolean));
  assert.throws(()=>SilhouetteProtection.prepare({targets:[{select:{medium:'fog'}}]}),/scene subject/);
  assert.throws(()=>SilhouetteProtection.prepare({targets:[{select:{object:'actor'},fogScale:-1}]}),/fog scale/);
});
