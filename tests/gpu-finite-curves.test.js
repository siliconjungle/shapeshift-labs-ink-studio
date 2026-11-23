const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function crossing({ KIT, makeBuilder }, scene) {
  const B = makeBuilder(7,[0x142333,0xf2aa59,0x52c9cb]);
  const draw = (source, color, options) => KIT.curveSplats.draw(B,source,{ width:.35, color, ...options });
  if (scene.startsWith('cross')) {
    const edge = scene === 'cross-hard' ? 'hard' : 'beta';
    draw([[-1.8,0,1],[1.8,0,-1]],'#f2aa59',{ edge, caps:'blunt', opacity:.83 });
    draw([[-1.8,0,-1],[1.8,0,1]],'#52c9cb',{ edge, caps:'blunt', opacity:.83 });
  } else {
    const points = scene === 'split' ? [[-1.3,0,0],[0,0,0],[1.3,0,0]] : [[-1.3,0,0],[1.3,0,0]];
    draw(points,'#f2aa59',{ edge:'hard',caps:scene === 'rounded' ? 'rounded' : 'blunt',
      opacity:scene === 'owner' ? 1 : .53 });
  }
  return B.finish({ radius:5,cam:{ target:[0,0,0],dist:4,fov:.70,ortho:scene !== 'cross-perspective' },fog:{ start:1,max:0 },dither:0 });
}

const points = { left:[29,36], right:[67,36], center:[48,36], cap:[14,36] };
const view = { width:96,height:72,raw:true,edges:false };

test('GPU hard and compact curves change local crossing order and match cap and join coverage',
  { skip:!process.env.INK_TEST_CHROME },()=>{
    const scenes = ['cross-hard','cross-beta','cross-perspective','split','unsplit','rounded','owner'];
    const result = runWebGL({},crossing,(kit,make,backend,{ scenes,points,view })=>{
      const painter = backend(view.width,view.height,view);
      try {
        return { images:Object.fromEntries(scenes.map(scene=>{
          const world = make(kit,scene);
          let stats, atCenter;
          painter.draw(world,{ curveFrame:x=>{ stats=x; },
            hybridDepthFrame:x=>{ atCenter=x.depth[points.center[1]*view.width+points.center[0]]; } });
          const image = painter.image();
          const samples = painter.sample(points);
          if (scene === 'owner') {
            painter.draw(world,{ curveMode:'splats' });
            const carrier = painter.image();
            painter.draw(world,{ curveMode:'curves' });
            if (painter.image() !== image || carrier === image) throw new Error('Curve mode did not switch live');
          }
          return [scene,{ samples,stats,depth:atCenter }];
        })) };
      } finally { painter.close(); }
    },{ scenes,points,view });
    const { images } = result;
    for (const name of scenes) {
      const { rgb,passes } = ink.render(crossing(ink.load(),name),{ w:view.width,h:view.height,px:1,raw:true,passes:['depth'] });
      for (const [key,[x,y]] of Object.entries(points)) {
        const at = (y*view.width+x)*3;
        const expected = [...rgb.subarray(at,at+3)];
        const actual = images[name].samples[key];
        assert(actual.every((v,i)=>Math.abs(v-expected[i])<=2),JSON.stringify({name,key,expected,actual}));
      }
      assert(images[name].stats.segments >= 1);
      if (name === 'owner')
        assert(Math.abs(images[name].depth-passes.depth[points.center[1]*view.width+points.center[0]])<.002);
    }
    for (const name of ['cross-hard','cross-beta']) {
      assert(images[name].samples.left[0] > images[name].samples.right[0]+25);
      assert(images[name].samples.right[2] > images[name].samples.left[2]+25);
    }
    assert.deepEqual(images.split.samples,images.unsplit.samples);
    assert.notDeepEqual(images.rounded.samples.cap,images.unsplit.samples.cap);
  });

test('matched hard, compact, elliptical and ribbon captures agree with headless across the mesh-backed scene',
  { skip:!process.env.INK_TEST_CHROME },t=>{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-finite-curves-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const { run } = require('../cli/finite-curve-review.js');
    const report = run(directory);
    assert.equal(report.frames.length,3);
    for (const frame of report.frames) {
      assert(frame.curves.segments >= 500);
      assert(frame.error.mean < .20,JSON.stringify(frame));
      assert(frame.error.changed < 40,JSON.stringify(frame));
      for (const file of Object.values(frame.files)) assert(fs.statSync(path.join(directory,file)).size > 100);
    }
  });

test('portal clipping keeps the foreground curve, clips the arrival ray, and preserves the destination depth',
  { skip:!process.env.INK_TEST_CHROME },()=>{
    const result = runWebGL({},function portalFixture({ KIT,makeBuilder }) {
      const source = makeBuilder(1,[0x101818,0xee6041]);
      const dest = makeBuilder(2,[0x162038,0x26d6a7,0xffeb00]);
      const draw = (b,z,color,edge,opacity=1) => KIT.curveSplats.draw(b,[[-.7,0,z],[.7,0,z]],
        { edge,opacity,width:.4,color,caps:'blunt' });
      draw(source,.6,'#ee6041','beta',.48);
      draw(dest,-.5,'#26d6a7','hard');
      draw(dest,.5,'#ffeb00','hard');
      const world = source.finish({
        radius:4,cam:{ target:[0,0,0],dist:4,ortho:true },fog:{ start:1,max:0 },
        atmosphere:[KIT.atmosphere.box({ min:[-.9,-.6,.1],max:[.9,.6,1],density:.3,color:'#6092ab' })]
      });
      const destination = dest.finish({ radius:4,fog:{ start:1,max:0 } });
      const opening = KIT.world.portals.doorway({ from:{ origin:[0,0,0],normal:[0,0,1] },
        to:{ origin:[0,0,0],normal:[0,0,-1] }, halfWidth:1,halfHeight:1 });
      return { world,portal:{ source:world,destination,opening } };
    },(kit,make,backend)=>{
      const { world,portal } = make(kit);
      const painter = backend(81,81,{ width:81,height:81,raw:true });
      try {
        const depths = [];
        const hybridDepthFrame = frame => depths.push([frame.view,Number.isFinite(frame.depth[40*81+40])]);
        painter.draw(world,{ portal,hybridDepthFrame });
        const withFog = painter.sample({ center:[40,40] }).center;
        painter.draw(world,{ portal,atmosphere:false });
        return { depths,withFog, clear:painter.sample({ center:[40,40] }).center };
      } finally { painter.close(); }
    });
    assert.deepEqual(result.depths,[['portal',true],['camera',false]]);
    assert(result.clear[0] > 90 && result.clear[1] > 105 && result.clear[2] > 70,JSON.stringify(result.clear));
    assert.notDeepEqual(result.withFog,result.clear);
  });
