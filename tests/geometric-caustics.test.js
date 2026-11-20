const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..'), kit = ink.load(), {KIT:K,LightCookies:C} = kit;
const Volume = require('../src/volume-light.js');
const Area = require('../src/area-lights.js');
const sampleSetup = {width:64,height:64,angle:18,focus:4.6,samples:[72,72],blur:1,incident:'parallel'};
function measure(cookie,time=0,channel=0) {
  const {rgb,width,height} = cookie.frame(time);
  let mass=0, cx=0, cy=0, area=0, peak=0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const n=rgb[(y*width+x)*3+channel];
    mass+=n; cx+=n*x; cy+=n*y; area+=Number(n>10); peak=Math.max(peak,n);
  }
  return {cx:cx/mass,cy:cy/mass,area,peak};
}

test('an authored convex profile concentrates a parallel beam at the receiving plane', () => {
  const lens = {size:[1.45,1.45],distance:1,thickness:.78,sagLimit:.34,ior:1.48};
  const flat = measure(C.geometric({...sampleSetup,lens}));
  const curved = measure(C.geometric({...sampleSetup,lens:{...lens,front:(x,y)=>.29*(x*x+y*y),
    back:(x,y)=>-.11*(x*x+y*y)}}));
  assert(curved.area < flat.area*.65, JSON.stringify({flat,curved}));
  assert(curved.peak > flat.peak);
  assert(Math.abs(curved.cx-31.5)<.1 && Math.abs(curved.cy-31.5)<.1);
});

test('surface geometrics disperse a prism in RGB and rotate the whole aperture', () => {
  const cookie=C.geometric({...sampleSetup,period:4,lens:{size:[1.15,1],distance:1,thickness:.58,
    aperture:'rectangle',front:x=>.29*x,rotation:t=>t*Math.PI/2,ior:[1,1.34,1.67]}});
  const red=measure(cookie), green=measure(cookie,0,1), blue=measure(cookie,0,2);
  assert(blue.cx+2<green.cx && green.cx+2<red.cx);
  const rotated=measure(cookie,1,2);
  assert(rotated.cy>blue.cy+5);
  assert(Math.abs(rotated.cx-31.5)<.2);
  assert.deepEqual(cookie.frame(4).rgb,cookie.frame(0).rgb);
});

test('generated maps seek, serialize as ordinary cookies, and invalidate across toolkit instances', () => {
  let shift=.2;
  const cookie=K.lightEmitters.caustic({...sampleSetup,lens:{size:[1.1,1],center:t=>[t*shift,0]}});
  const a=cookie.frame(1), moduleCookies=require('../src/light-cookies.js');
  assert.equal(cookie.frame(1),a);
  const compiled=moduleCookies.prepare(cookie,1);
  const exported=JSON.parse(JSON.stringify(a));
  assert.deepEqual(compiled.data,moduleCookies.prepare(exported).data);
  cookie.frame(0);
  assert.deepEqual(cookie.frame(1).rgb,a.rgb);
  shift=.42;
  moduleCookies.invalidate(cookie);
  assert.notDeepEqual(cookie.frame(1).rgb,a.rgb);
  assert.throws(()=>C.geometric({...sampleSetup,lens:{sagLimit:.03,front:.05}}),/invalid lens/);
  assert.throws(()=>C.geometric({...sampleSetup,lens:{front:()=>3}}).frame(),/sag/);
});

test('the existing spot and area preparation paths both sample animated lens time', () => {
  const cookie=C.geometric({...sampleSetup,lens:{size:[.45,.42],center:t=>[t*.62,0]}});
  const lamp={id:'glass',at:[0,0,0],normal:[0,0,1],direction:[0,0,1],
    color:'#ffffff',size:[.1,.1],cookie,outerAngle:37,surfaceIntensity:14};
  const spot={at:lamp.at,direction:lamp.direction,color:lamp.color,outerAngle:37,surfaceIntensity:14,cookie};
  const settings={spots:[spot]}, color=()=>[1,1,1];
  const a=Volume.lighting(settings,color,[],{time:0});
  const b=Volume.lighting(settings,color,[],{time:1});
  assert(a.animatedLocals && b.animatedLocals);
  assert(a.surfaceSpots[0].cookie([0,0,-1])>.1);
  assert.equal(b.surfaceSpots[0].cookie([0,0,-1]),0);
  const {direction,outerAngle,surfaceIntensity,...area}=lamp;
  const ap=Area.prepare([area],{time:0})[0], bp=Area.prepare([area],{time:1})[0];
  assert(ap.cookie.animated && bp.cookie.animated);
  assert(Area.transmission(ap,[0,0,4.6])[0]>.1);
  assert.equal(Area.transmission(bp,[0,0,4.6])[0],0);
});

function room(bundle) {
  const {KIT:K,makeBuilder,makeSculpt} = bundle;
  const B=makeBuilder(16,[0x101a29,0x686368]), S=K.sculpt(makeSculpt(B));
  S.box([0,0,0],[1.6,1.2,.12],{r:[1]},{res:.087});
  S.bake();
  const cookie=K.lightEmitters.caustic({width:64,height:64,samples:[46,46],focus:3,angle:24,exposure:2.4,
    incident:'parallel',lens:{size:[.88,.78],center:t=>[.62*t,0],rotation:t=>t,
      aperture:(x,y)=>Math.abs(x*.88+y*.67)<.19 ? 1 : 0,front:(x,y)=>.095*(x*x+y*y),ior:[1.38,1.49,1.64]}});
  return B.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0},radius:4,detail:18,look:{pixelSize:1},
    volumeLighting:{spots:[{at:[0,0,3],direction:[0,0,-1],innerAngle:28,outerAngle:34,
      radius:8,color:'#ffffff',intensity:0,surfaceIntensity:25,castsShadow:false,cookie}]}});
}
test('headless receivers change color at their world position when the lens animates', () => {
  const world=room(kit), options={w:126,h:94,px:1,raw:true};
  const off=ink.render(world,{...options,volumeLighting:{},t:0}).rgb;
  const a=ink.render(world,{...options,t:0}).rgb, b=ink.render(world,{...options,t:1}).rgb;
  assert(Buffer.compare(a,off)!==0,'the geometric projector must light the receiver');
  assert(Buffer.compare(a,b)!==0,'the lens pose must change the projected light');
  assert.equal(Buffer.compare(ink.render(world,{...options,t:0}).rgb,a),0);
});
test('WebGL receivers use the animated geometric map and seek deterministically', {skip:!process.env.INK_TEST_CHROME}, () => {
  const result=require('../cli/look-webgl.js')({},room,(kit,fixture,backend)=>{
    const world=fixture(kit), renderer=backend(126,94,{raw:true});
    try {
      renderer.draw(world,{t:0}); const a=renderer.image();
      renderer.draw(world,{t:1}); const b=renderer.image();
      renderer.draw(world,{t:0}); const again=renderer.image();
      return {moved:a!==b,sought:a===again};
    } finally { renderer.close(); }
  });
  assert.equal(result.moved,true);
  assert.equal(result.sought,true);
});
