const CameraLens = require('../src/camera-lens.js');
const CameraStaging = require('../src/camera-staging.js');
const ArtStability = require('../src/art-stability.js');
const RenderContract = require('../src/render-contract.js');
const CameraImpulses = require('../src/camera-impulses.js');
const {trace} = require('./sdf-path-trace.js');

const integer = (n,a,b)=>Number.isSafeInteger(n) && n>=a && n<=b;
const number = (n,a,b)=>Number.isFinite(n) && n>=a && n<=b;

function settings(value, frames=1) {
  const {width=176,height=128,samples=32,bounces=1,epsilon=.001,steps=144,seed=1,exposure=1,posed=true}=value;
  if (!integer(width,8,512) || !integer(height,8,512) || !integer(samples,4,256) || samples%2 ||
      !integer(frames,1,96) || width*height*samples*frames>12e6)
    throw new RangeError('Path ink needs an 8–512 pixel native grid, 4–256 even samples, and at most 12 million primary samples');
  if (!integer(bounces,0,6) || !number(epsilon,.0001,.02) || !integer(steps,32,512) ||
      !integer(seed,0,0xffffffff) || !number(exposure,.05,8) || typeof posed!=='boolean')
    throw new RangeError('Invalid path ink trace settings');
  return {width,height,samples,bounces,epsilon,steps,seed,exposure,posed};
}

function renderPathInk(world,options={},traceSettings={}) {
  const {KIT}=require('../index.js').load();
  const plan=settings(traceSettings);
  const {width,height,posed}=plan;
  const look=world.look ?? {};
  options=RenderContract.options(world,options,KIT.timeDomains.frame);
  const staging=CameraStaging.prepare(options.cameraStaging ?? look.cameraStaging);
  const lens=CameraLens.frame(world,options,width,height,{orbit:staging?.orbit,impulse:CameraImpulses.frame});
  const view=CameraLens.artView(lens,height,ArtStability.prepare(look.stable,options.stable,options.ditherSpaceOverride));
  const camera={width,height,view,eye:CameraLens.fromView(view).eye,
    ortho:lens.ortho,tangent:lens.tangent*(lens.ortho ? lens.dist : 1),clipNear:lens.clipNear,clipFar:lens.clipFar};
  if (posed && world.anim?.bones) {
    const rest=world.rest ?? world.data;
    const source=KIT.viewPoses.forWorld(world);
    if (source?.active) world=KIT.viewPoses.frame(world,{...lens.pose,ortho:lens.ortho},
      {enabled:options.viewPoses!==false,headless:true});
    if (!world.rest) world={...world,rest};
  }
  return {...trace(world,options,camera,{...plan,pathInk:options.pathInk ?? look.pathInk}),px:1};
}

module.exports = {renderPathInk,settings};
