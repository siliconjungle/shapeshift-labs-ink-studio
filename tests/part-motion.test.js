const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ink = require('..');
const { KIT:K, makeBuilder } = ink.load();
const PNG = require('../cli/png.js');

const cam = { target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true,sway:0 };
const view = { w:61,h:49,px:1,raw:true };
const index = (x,y) => y*view.w+x;
const at = (x,y) => index(30+x,24+y);

function occlusion() {
  const b = makeBuilder(2,[0x102034,0x355d70,0xefbe87]);
  b.disc(0,0,0,[0,0,1],.86,.02,b.P[1],3);
  b.describeSplats(0,1,{object:'machine', target:{part:'arm'}});
  b.disc(0,0,1,[0,0,1],.24,.02,b.P[2],3);
  // Both pieces have the same part ID so a successful rejection needs depth.
  b.describeSplats(1,2,{object:'machine', target:{part:'arm'}});
  return b.finish({cam,radius:4,dither:0});
}

test('reprojects rotating rig parts even when the splat center is stationary',()=>{
  const b = makeBuilder(2,[0x102034,0xefbe87]);
  const rig = K.rig(b,{});
  rig.own('needle',()=>b.disc(0,0,0,[0,0,1],.68,.02,b.P[1],3));
  const world = b.finish({cam,radius:4,dither:0});
  rig.bind(K.stage(world));
  const previous = ink.render(world,{...view,t:0,captureMotion:true,capturePartMotion:true,passes:['depth']});
  rig.set('needle',K.M.rot([0,0,1],Math.PI/2),[0,0,0],[0,0,0]);
  rig.apply();
  const { passes,motionReference } = ink.render(world,{...view,t:1,passes:['part-motion','motion'],motionFrom:previous.motionReference});
  for (const dx of [-5,5]) {
    const p = at(dx,0);
    assert.equal(passes.partMotionValid[p],255);
    assert.equal(passes.parts[passes.partId[p]].part,'needle');
    assert(Math.abs(passes.partMotion[2*p]-dx) < 1e-5);
    assert(Math.abs(passes.partMotion[2*p+1]+dx) < 1e-5);
    assert.equal(passes.motion[2*p],0);
    assert.equal(passes.previousDepth[p],previous.passes.depth[at(0,dx)]);
  }
  assert.equal(motionReference,undefined);
});

test('disoccluded pixels reject prior depth even when the part matches',()=>{
  for (const ortho of [true,false]) {
    const world = occlusion(), partMotionHistory = ink.createPartMotionHistory();
    const options = {...view,ortho,partMotionHistory,passes:['part-motion','depth']};
    const first = ink.render(world,{...options,t:0}).passes;
    world.data[16] = .76;
    const next = ink.render(world,{...options,t:.1,colored:true,raw:false}).passes;
    assert.equal(first.partId[at(0,0)],next.partId[at(0,0)]);
    assert.notEqual(first.depth[at(0,0)],next.depth[at(0,0)]);
    assert.equal(next.partMotionValid[at(0,0)],0);
    assert.equal(next.previousDepth[at(0,0)],Infinity);
    assert.equal(next.partMotionValid[at(-12,0)],255);
    assert.equal(next.previousDepth[at(-12,0)],first.depth[at(-12,0)]);
    const cut = ink.render(world,{...options,t:.2,resetRenderHistory:true}).passes;
    assert(!cut.partMotionValid.some(Boolean));
    assert(cut.partId.some(Boolean));
    assert(ink.render(world,{...options,t:.3}).passes.partMotionValid.some(Boolean));
    ink.render(world,{...options,t:.4,passes:false,resetPartMotion:true});
    assert(!ink.render(world,{...options,t:.5}).passes.partMotionValid.some(Boolean));
    assert(!ink.render(world,{...options,t:.1}).passes.partMotionValid.some(Boolean));
  }
});

test('layer export uses the previous emitted frame across feedback steps and writes exact buffers',t=>{
  const world = occlusion(), out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-part-motion-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const replay = K.renderGraph.replay({fps:12,cuts:[.4]});
  const { manifest } = ink.exportLayers(world,{out,view,times:[0,.25,.5,.75],native:true,partMotion:true,replay,
    pose(w,time) { w.data[2] = time; }
  });
  const sample = at(-12,0);
  for (const [i,frame] of manifest.frames.entries()) {
    const read = channel => fs.readFileSync(path.join(out,frame.files[channel]));
    assert.equal(read('partMotion').length,view.w*view.h*8);
    assert.equal(frame.parts.find(row=>row?.part === 'arm').object,'machine');
    const mask = PNG.raster(read('partMotionValid'));
    const before = read('previousDepth').readFloatLE(sample*4);
    assert.equal(mask.data[sample*4],i%2 ? 255 : 0);
    const expected = i%2 ? fs.readFileSync(path.join(out,manifest.frames[i-1].files.depthFloat)).readFloatLE(sample*4) : Infinity;
    assert.equal(before,expected);
  }
});

test('a graph sequence can read exact previous depth and its validity',()=>{
  const { createSceneSampler, graphRenderPass } = require('../cli/graph-render.js');
  const sample = createSceneSampler(ink.load()), world = occlusion(), sequence = {};
  const settings = { channels:['part-motion'], options:{width:view.w,height:view.h,raw:true}, sequence };
  sample(world,{ ...settings,time:0 });
  world.data[16] = .76;
  const next = sample(world,{ ...settings,time:.25 });
  const previous = graphRenderPass(next.frame,'previousDepth',{emptyDepth:-1});
  assert.equal(previous.valid.data[at(0,0)],0);
  assert.equal(previous.data.data[at(0,0)],-1);
  assert.equal(previous.valid.data[at(-12,0)],255);
  assert(previous.data.data[at(-12,0)] > 0);
  const cut = sample(world,{ ...settings,time:.5,options:{...settings.options,resetRenderHistory:true} });
  assert(!cut.frame.passes.partMotionValid.some(Boolean));
});
