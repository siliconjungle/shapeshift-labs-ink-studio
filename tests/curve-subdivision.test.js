const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const subdivision = require('../src/curve-subdivision.js');
const fixture = require('../examples/curve-subdivision-review.js');

const settings = subdivision.prepare(true);
const camera = { view:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-6,1],
  focal:44, near:.25, ortho:true };
const color = '#ff9c55';
function strands(shape, style = {}) {
  const { KIT,makeBuilder } = ink.load(), B = makeBuilder(2,[0x162534,0xff9c55,0x48a8ac]);
  const points = Array.from({ length:65 }, (_,i)=>shape(i/64));
  KIT.curveSplats.draw(B,points,{ edge:'hard',width:.15,color,...style });
  return B.finish({ radius:5,cam:{ target:[0,0,0],dist:6,ortho:true },fog:{ start:1,max:0 } });
}

test('projected subdivision spends spans on position, axial depth, and profile separately',()=>{
  const x = u => -2 + 4*u, wave = u => .32*Math.sin(u*Math.PI*2);
  const straight = strands(u=>[x(u),0,0]);
  const bend = strands(u=>[x(u),wave(u),0]);
  const depth = strands(u=>[x(u),0,wave(u)]);
  const roll = strands(u=>[x(u),0,0],{
    section:'flattened', width:.35, aspect:.18, twist:[[0,0],[.22,0],[.5,Math.PI],[.78,2*Math.PI],[1,2*Math.PI]]
  });
  const straightPlan = subdivision.frame(straight,camera,settings);
  assert.equal(straightPlan.stats.retainedSpans,1);
  assert.equal(straightPlan.geometry.get(0).endIndex,63);
  for (const [world, reason] of [[bend,'position'],[depth,'depth'],[roll,'profile']]) {
    const original = world.data.slice();
    const near = subdivision.frame(world,camera,settings).stats;
    const far = subdivision.frame(world,{...camera,focal:12},settings).stats;
    const doubled = subdivision.frame(world,{...camera,focal:88,artScale:2},settings).stats;
    assert(near.splits[reason] > 0,JSON.stringify(near));
    assert(near.retainedSpans < near.sourceSpans,JSON.stringify({reason,near}));
    assert(near.retainedSpans > far.retainedSpans);
    assert(near.maxAcceptedPosition <= settings.pixels && near.maxAcceptedDepth <= settings.depthPixels);
    assert.deepEqual(doubled,near);
    assert.deepEqual(world.data,original);
  }
  assert(subdivision.frame(depth,camera,{...settings,depthPixels:.04}).stats.retainedSpans >
    subdivision.frame(depth,camera,settings).stats.retainedSpans);
  assert.throws(()=>subdivision.prepare({pixels:0}),/pixel budgets/);
  assert.throws(()=>subdivision.prepare({pixels:.25,frameScale:1}),/pixel budget/);
});

test('subdivision respects cap planes, cuts, timing, material boundaries, and selected gaps',()=>{
  const x = u => [-2+4*u,0,0];
  const straight = strands(x,{caps:{start:'blunt',end:'rounded'}});
  const capped = subdivision.frame(straight,camera,settings);
  assert(!capped.geometry.has(0));
  assert(!capped.hidden.has(0));
  const plain = strands(x);
  const clipped = subdivision.frame(plain,camera,settings,{planes:[[0,0,1,6]]});
  assert.equal(clipped.stats.retainedSpans,plain.count);
  const near = subdivision.frame(plain,{...camera,near:5.97},settings);
  assert.equal(near.stats.retainedSpans,plain.count);
  const selected = subdivision.frame(plain,camera,settings,{keep:i=>i!==24});
  assert.equal(selected.geometry.get(0).endIndex,23);
  assert.equal(selected.geometry.get(25).endIndex,63);
  const reveal = strands(x,{reveal:{end:.65}}), patterned = strands(x,{pattern:{dash:{spacing:.5,duty:.5}}});
  for (const world of [reveal,patterned]) assert.equal(subdivision.frame(world,camera,settings).stats.removedSpans,0);
  const pigment = strands(x,{color:({u})=>u<.5 ? color : '#48a8ac'});
  const tinted = subdivision.frame(pigment,camera,settings);
  assert.equal(tinted.geometry.get(0).endIndex,31);
  assert.equal(tinted.geometry.get(32).endIndex,63);
});

test('headless subdivision uses the target art grid and keeps a straight strand pixel identical',()=>{
  const world = strands(u=>[-2+4*u,0,0]);
  const options = { w:128,h:92,px:1,raw:true,renderStats:true };
  const dense = ink.render(world,options);
  const adaptive = ink.render(world,{ ...options,curveSubdivision:true });
  assert.equal(dense.renderStats.curveSegments,64);
  assert.equal(adaptive.renderStats.curveSegments,1);
  assert.deepEqual(adaptive.rgb,dense.rgb);
  const near = fixture(ink.load(),6.6), far = fixture(ink.load(),20);
  const counts = [near,far].map(({world,width,height})=>ink.render(world,{...options,w:width,h:height}).renderStats.curveSegments);
  assert(counts[0] > counts[1] && counts[0] < 200,String(counts));
  assert.throws(()=>ink.render(world,{...options,curveSubdivision:{pixels:10}}),/pixel budgets/);
});

test('WebGL and headless share the accepted curve spans in matched native art captures',
  { skip:!process.env.INK_TEST_CHROME },t=>{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-subdivision-review-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const { run } = require('../cli/curve-subdivision-review.js');
    const report = run(dir);
    const [near,far] = report.views;
    assert(near.webgl.adaptive.segments > far.webgl.adaptive.segments);
    for (const {webgl,headless,rendererError,files} of report.views) {
      assert(webgl.adaptive.segments < webgl.dense.segments/3);
      assert(webgl.adaptive.tileReferences < webgl.dense.tileReferences/2);
      assert.equal(webgl.adaptive.segments,headless.adaptive);
      assert(webgl.error.mean < .25 && webgl.error.changed < 40,JSON.stringify(webgl.error));
      assert(rendererError.mean < .06);
      for (const file of Object.values(files)) assert(fs.statSync(path.join(dir,file)).size > 100);
    }
  });
