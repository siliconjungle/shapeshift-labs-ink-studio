const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const {render,cameraCapture} = require('../cli/render.js');
const {pose} = require('../cli/diarama-pose.js');
const {bake} = require('../cli/traced-lighting.js');
const {fit} = require('../cli/splat-fit.js');
const {bind} = require('../cli/sdf-reference-field.js');
const {load} = ink;
const kit=load(), {KIT,makeBuilder,makeSculpt}=kit;
const base=[0x152033,0xe0deda,0xd12c19,0x408482];
const view={w:68,h:52,px:1,raw:true,transparent:true,
  passes:['objectId','splatId','depth','normal']};

function opening() {
  const B=makeBuilder(91,base), S=KIT.sculpt(makeSculpt(B)), tags=KIT.deform.tags(S);
  S.keepRenderSdf=S.keepReferenceSdf=true;
  const material={r:[1],fat:.36};
  S.box([0,0,0],[.87,.83,.16],material,{tag:'gate',objectId:'gate',res:.32});
  S.box([0,0,0],[.28,.36,.29],material,{tag:'gate',objectId:'gate',res:.19,neg:true});
  S.box([0,0,-.55],[.22,.3,.08],{r:[2]},{objectId:'marker',res:.18});
  S.bake();
  const world=B.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true,sway:0},radius:4,dither:0});
  KIT.puppet(world,{parts:{gate:{ids:tags.gate,pivot:[0,0,0]}},pose(t,_dt,actor){
    actor.pose.gate={pos:[t*.64,0,t*.30],rot:[0,t*18,0]};
  }});
  return world;
}

test('the carved opening and opaque depth follow the same bones as the pigment',()=>{
  const world=opening();
  const sample=t=>{
    pose(world,t,{kit});
    return render(world,{...view,t,sdfAssist:{posed:true}});
  };
  const zero=sample(0), moved=sample(1);
  const p=26*view.w+34;
  assert.equal(zero.passes.objects[zero.passes.objectId[p]],'marker');
  assert.equal(moved.passes.objects[moved.passes.objectId[p]],'gate');
  assert(moved.passes.depth[p]<zero.passes.depth[p]-.5);
  const backend=bind(world,.001,160,true);
  assert.equal(backend.intersect([0,0,2],[0,0,-1],0,5).owner.tag,'gate');
  assert.notEqual(backend.intersect([.64,0,2],[0,0,-1],0,5)?.owner.tag,'gate');
  assert(zero.passes.normal[p*3+2]>.98);
  assert(moved.passes.normal[p*3]>.25);
  assert.deepEqual(sample(0).rgb,zero.rgb);
});

test('secondary radiance is persisted and the live key remains editable',()=>{
  function room(withWall) {
    const B=makeBuilder(12,base), S=makeSculpt(B);
    S.keepReferenceSdf=S.captureAlbedo=true;
    S.box([0,-.13,0],[1.15,.13,.95],{r:[1]},{objectId:'floor',res:.22});
    if (withWall) S.box([0,.60,-.65],[1.0,.63,.07],{r:[2]},{objectId:'wall',res:.21});
    S.bake();
    return B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:.46,ortho:true,sway:0},radius:4,
      liveSun:{ambient:.32,intensity:.8,direction:[0,.8,1],shadows:false}});
  }
  function trace(world) {
    let camera;
    render(world,{...view,...cameraCapture(view,c=>{camera=c;})});
    return bake(world,view,camera,{samples:32,spacing:.22,select:{object:'floor'}});
  }
  const world=room(true), direct=room(false), original=render(world,view);
  const data=trace(world);
  const reflected=data.entries.some(({rgb})=>rgb[0]>.02 && rgb[0]>rgb[1]*2);
  assert(reflected);
  assert.equal(trace(direct).entries.length,0);
  assert.deepEqual(trace(world),data);
  const restored=JSON.parse(JSON.stringify(data));
  const lit=render(world,{...view,tracedLighting:restored});
  assert.notDeepEqual(lit.rgb,original.rgb);
  assert.deepEqual(render(world,{...view,tracedLighting:{asset:restored,strength:0}}).rgb,original.rgb);
  assert.notDeepEqual(render(world,{...view,tracedLighting:restored,liveSun:{intensity:.35}}).rgb,lit.rgb);
  assert.throws(()=>render(direct,{...view,tracedLighting:restored}),/does not match/);
});

test('multi-view fitting improves native coverage and replays the same row edits',()=>{
  const world=opening(), options={...view,w:52,h:42};
  const basePose=(scene,time)=>pose(scene,time,{kit});
  const exact={posed:true};
  const views=[-.17,.16,.03].map((yaw,i)=>{
    const time=i*.16;
    basePose(world,time);
    const reference=render(world,{...options,t:time,yaw,sdfAssist:exact});
    const data=new Uint8Array(reference.w*reference.h*4);
    for (let p=0;p<reference.alpha.length;p++) {
      data.set(reference.rgb.subarray(p*3,p*3+3),p*4);
      data[p*4+3]=reference.alpha[p];
    }
    return {time,camera:{yaw},reference:{w:reference.w,h:reference.h,max:255,data},holdout:i===2};
  });
  const asset=fit(world,{width:options.w,height:options.h,sdfAssist:exact,rounds:3,prune:.08,views,
    view:extra=>({...options,...extra}),pose:basePose,select:{object:'gate'}});
  assert(asset.report.lossBefore>asset.report.lossAfter);
  assert(asset.report.resized>0);
  assert(asset.report.frames[2].after.loss<=asset.report.frames[2].before.loss+.05);
  basePose(world,0);
  const saved=JSON.parse(JSON.stringify(asset));
  const fitted=render(world,{...options,yaw:-.17,splatFit:saved,sdfAssist:false});
  const baseline=render(world,{...options,yaw:-.17,splatFit:false,sdfAssist:false});
  assert.notDeepEqual(fitted.alpha,baseline.alpha);
  assert.throws(()=>render(world,{...options,splatFit:{...saved,edits:[[world.count,1.2]]}}),/Invalid/);
});

test('channel fitting chooses a rotated footprint and pigment while preserving pins and reserving holdouts',()=>{
  const {signature}=require('../cli/render-row-assets.js');
  const {format}=require('../cli/splat-fit-asset.js');
  const B=makeBuilder(10,base);
  B.disc(-.42,0,0,[0,0,1],.47,.015,B.P[2],1.2);
  B.describeSplats(0,1,{object:'medallion',material:'enamel'});
  B.describeFootprint(0,1,{shape:'circle',softness:.08});
  B.disc(.64,0,.12,[0,0,1],.17,.015,B.P[1],1.6);
  B.describeSplats(1,2,{object:'medallion',material:'badge'});
  B.describeFootprint(1,2,{shape:'square',softness:.03});
  const world=B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true},radius:4,dither:0});
  const settings={...view,w:50,h:40,passes:[...view.passes,'pigment']};
  const footprint={shape:'square',stretch:[.74,.74],softness:.04};
  const approved={format,version:1,rows:world.count,signature:signature(world),edits:[],
    attributes:[[0,{footprint:{...footprint,rotation:Math.PI/4},pigment:base[3]}]]};
  const entry=(yaw,time,holdout=false)=>{
    const before=render(world,{...settings,yaw,t:time});
    const target=render(world,{...settings,yaw,t:time,splatFit:approved});
    const data=new Uint8Array(settings.w*settings.h*4), pins=data.slice();
    for (let p=0;p<target.alpha.length;p++){
      data.set(target.rgb.subarray(p*3,p*3+3),p*4);
      data[p*4+3]=target.alpha[p];
      if (before.passes.splatId[p]===2 && before.alpha[p]>250) pins.set([255,255,255,255],p*4);
    }
    assert(pins.some(Boolean));
    return {time,camera:{yaw},reference:{w:settings.w,h:settings.h,max:255,data},holdout,
      depth:target.passes.depth,normal:target.passes.normal,pigment:target.passes.pigment,
      pins:{w:settings.w,h:settings.h,max:255,data:pins}};
  };
  const seen=[];
  const views=[entry(-.13,0),entry(.14,.2),entry(.31,.4,true)];
  const fitted=fit(world,{width:settings.w,height:settings.h,views,pose:(_,t)=>seen.push(t),view:()=>settings,
    pins:{material:'badge'},search:{footprints:[footprint],rotations:[Math.PI/4,0],trials:36},
    rounds:3,prune:0,sdfAssist:false});
  assert.deepEqual(seen.slice(-2),[.4,.4]);
  assert(!seen.slice(0,-2).includes(.4));
  assert.deepEqual(fitted.attributes,approved.attributes);
  assert(fitted.report.frames.every(({before,after})=>after.pinChanges===0 &&
    after.silhouette<before.silhouette && after.pigment<before.pigment));
  assert.deepEqual(fitted.report.validation,{views:1,passed:true});
  const replay=render(world,{...settings,yaw:.31,splatFit:JSON.parse(JSON.stringify(fitted))});
  const expected=render(world,{...settings,yaw:.31,splatFit:approved});
  assert.deepEqual(replay.rgb,expected.rgb);
  assert.deepEqual(replay.passes.pigment,expected.passes.pigment);
});
