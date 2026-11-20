const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const { createArtPasses } = require('../cli/art-passes.js');
const { surfaceGrid, trackSurfacePixels, trackSwatches } = require('../cli/palette-shimmer.js');

function raster(colors,{shift=0,motion=0,material=1}={}) {
  const w=colors.length, h=1;
  return {w,h,rgb:Uint8Array.from(colors.flatMap(value=>[value,value,value])),
    passes:{splatId:new Uint32Array(w).fill(1),objectId:new Uint32Array(w).fill(1),
      materialId:new Uint32Array(w).fill(material),coverage:new Float32Array(w).fill(1),
      objectPosition:Float32Array.from(colors.flatMap((_,x)=>[x-shift,0,0])),
      motion:Float32Array.from(colors.flatMap(()=>[motion,0]))}};
}

function analyze(frames,window=3) {
  let grid,state;
  const pairs=new Map();
  const results=frames.map(frame=>{
    const current=surfaceGrid(frame,.8), tracking=trackSurfacePixels(grid,current);
    state=trackSwatches(frame,current,grid,state,tracking.links,{window,minDelta:.025},()=>.4,pairs);
    grid=current;
    return {state,tracking};
  });
  return {results,pairs:[...pairs.values()]};
}

test('motion links follow a translated surface and exclude pixels that have no earlier sample', () => {
  const before=raster([10,50,80,120,160]);
  const moved=raster([200,10,50,80,120],{shift:1,motion:1});
  const again=raster([240,200,10,50,80],{shift:2,motion:1});
  const {results}=analyze([before,moved,again]);
  assert.deepEqual([...results[1].tracking.links],[-1,0,1,2,3]);
  assert.equal(results[2].tracking.count,4);
  assert.equal(results[2].state.counts.changes,0);
  assert.equal(results[2].state.counts.reversals,0);
  const foreign=raster([200,10,50,80,120],{shift:1,motion:1,material:2});
  assert.equal(analyze([before,foreign,again]).results[2].tracking.count,0);
});

test('surface tracking and authored smear can use different reference frames', () => {
  const art=createArtPasses(['motion','emissionMotion'],1,1);
  art.fragment(0,0,1,true,2,true,1,1,1);
  const reference=x=>({w:1,h:1,centers:Float32Array.of(x,0)});
  const current=reference(8);
  const passes=art.finalize({},0,{centers:current.centers,motionReference:current,
    motionFrom:reference(6),emissionMotionFrom:reference(2)});
  assert.deepEqual([...passes.motion],[2,0]);
  assert.deepEqual([...passes.emissionMotion],[6,0]);
});

test('reversals honor dwell window and distinguish boundaries from uniform changes', () => {
  const still=[raster([10,50]),raster([180,50]),raster([180,50]),raster([10,50])];
  const review=analyze(still,2);
  assert.deepEqual([...review.results[3].state.mask],[1,0]);
  assert.equal(review.results[3].state.counts.boundary,1);
  assert.deepEqual(review.results[3].state.counts.boundaryBounds,{x:0,y:0,width:1,height:1});
  assert.deepEqual(review.pairs,[{colors:['#0a0a0a','#b4b4b4'],reversals:1,boundary:1}]);
  assert.equal(analyze(still,1).results[3].state.counts.reversals,0);
  const uniform=[raster([10,10]),raster([180,180]),raster([10,10])];
  assert.deepEqual([...analyze(uniform).results[2].state.mask],[2,2]);
  const hidden=raster([180,50]);
  hidden.passes.coverage[0]=.2;
  assert.equal(analyze([still[0],hidden,still[3]]).results[2].state.counts.reversals,0);
});

const library=ink.load(), {KIT,makeBuilder,makeSculpt,ArtStability,PixelLook}=library;
const view={w:96,h:64,px:1,ortho:true};
const colors=['#34475d','#a5b3c2'];
const stagedAnchor = space => [{ stage:'palette',select:{material:'plate'},palette:{
  palette:colors,dither:{space,spacing:.13,origin:[.02,0,0],pattern:'bayer',strength:1}
} }];
function plate() {
  const b=makeBuilder(73,[0x101926,0x8392a4]), s=KIT.sculpt(makeSculpt(b));
  s.amb=1; s.sunK=0; s.sky=0;
  s.box([0,0,0],[1.1,.7,.1],{r:[1],materialId:'plate'},{res:.08,objectId:'print'});
  s.bake();
  return b.finish({cam:{target:[0,0,0],yaw:0,pitch:0,sway:0,dist:5},look:{
    renderStages:stagedAnchor('object'),stable:{dither:'world',targets:[{material:'plate',dither:'object',spacing:.13}]}
  }});
}

test('forced anchors change authored palette rules while preserving each pattern cell setting', () => {
  const world=plate();
  for (const space of ['screen','world','object']) {
    const forced=ink.render(world,{...view,ditherSpaceOverride:space});
    const authored=ink.render(world,{...view,renderStages:stagedAnchor(space),stable:{dither:space,targets:[]}});
    assert.deepEqual(forced.rgb,authored.rgb);
  }
  assert.notDeepEqual(ink.render(world,{...view,ditherSpaceOverride:'screen'}).rgb,
    ink.render(world,{...view,ditherSpaceOverride:'world'}).rgb);
  const policy=PixelLook.preparePalette(stagedAnchor('object')[0].palette,{ditherSpaceOverride:'world'});
  assert.deepEqual(policy.anchor,{dither:'world',origin:[.02,0,0],spacing:.13});
  const stable=ArtStability.prepare(world.look.stable,undefined,'screen');
  assert.equal(stable.rules[0].dither,'screen');
  assert.equal(stable.rules[0].spacing,.13);
});

test('a matched sequence samples pose once and marks a lightness reversal before screen overlays', () => {
  const world=plate(), times=[], seen=[];
  const {report,image}=ink.reviewPaletteShimmer(world,{from:0,to:1,fps:4,
    width:128,height:80,view:{px:2,ortho:true},
    camera:phase=>({target:[.08*phase,0,0]}),
    pose(_world,time) {
      times.push(time);
      const light=time===.25 || time===.5 ? .82 : .22;
      world.look={...world.look,renderStages:[
        {stage:'frame',stack:{name:'Light pulse',steps:[{type:'channelMix',
          matrix:[[0,0,0],[0,0,0],[0,0,0]],offset:[light,light,light]}]}},
        {stage:'palette',palette:{palette:colors}}
      ]};
    },
    onFrame(_image,frame) { seen.push(frame.time); }
  });
  assert.deepEqual(times,[0,.25,.5,.75]);
  assert.deepEqual(seen,times);
  assert.deepEqual([report.width,report.height,report.pixelSize],[64,40,2]);
  assert.deepEqual(report.variants.map(row=>row.space),['screen','world','object']);
  assert(report.variants.every(row=>row.reversals>0 && row.boundary===0));
  assert(report.variants.every(row=>row.trackedPixels===report.variants[0].trackedPixels));
  assert.equal(report.comparison.time,.75);
  assert(image.rgb.some((value,i)=>i%3===0 && value===246));
});

test('palette shimmer CLI exports JSON, a still, and native animated evidence', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-shimmer-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), scene=path.resolve(__dirname,'../examples/palette-remap.json');
  execFileSync(process.execPath,[cli,'palette','shimmer',scene,'--from','0','--to','.75','--fps','4',
    '--camera-pan','.1,0,0','--w','60','--h','40','--px','2','--animate','--out',dir]);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'review.json')));
  assert.deepEqual([report.width,report.height,report.frameCount],[30,20,3]);
  const still=PNG.raster(path.join(dir,report.files.comparison));
  const playback=fs.readFileSync(path.join(dir,report.files.playback));
  const first=PNG.raster(playback);
  assert.deepEqual([first.w,first.h],[still.w,still.h]);
  const animation=playback.indexOf('acTL');
  assert(animation>0);
  assert.equal(playback.readUInt32BE(animation+4),3);
});
