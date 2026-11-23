const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { prepare } = require('../src/selective-transparency.js');
const { create } = require('../cli/selective-transparency.js');

test('only visually relevant inversions consume the local sort budget', () => {
  assert.throws(()=>prepare({layers:1}),/layer/);
  const output = new Map();
  const pixel = create(prepare({layers:2,maxPixels:1}),8,4,10,null,(p,id)=>{
    if(!output.has(p))output.set(p,[]);
    output.get(p).push(id);
  });
  const red = id => [id,0,0,.7,1,0,0], blue = id => [id,0,0,.7,0,0,1];
  // Send the lower crossing first to verify that the spatial budget is stable.
  pixel.add(0,2,red(0));
  pixel.add(0,4,blue(1));
  pixel.add(25,2,red(2));
  pixel.add(25,4,blue(3));
  pixel.add(24,2,red(4));
  pixel.add(24,4,red(5));
  pixel.add(11,4,blue(6));
  pixel.add(11,2,red(7));
  const report = pixel.finish();
  assert.deepEqual(output.get(25),[3,2]);
  assert.deepEqual(output.get(0),[0,1]);
  assert.deepEqual(output.get(24),[4,5]);
  assert.deepEqual(output.get(11),[6,7]);
  assert.equal(report.overlapPixels,4);
  assert.equal(report.crossingPixels,2);
  assert.equal(report.sortAttempts,1);
  assert.equal(report.pixelBudgetPixels,1);
});

test('opaque geometry cuts off hidden fragments and crowded pixels fall back locally on the art grid', () => {
  const shot = require('../examples/selective-transparency.js')(ink.load()), world = shot.build(shot.seed);
  const options = { w:144,h:84,px:1,raw:true,splatOrder:'selective' };
  const tight = ink.render(world,{...options,selectiveTransparency:{layers:2}});
  const roomier = ink.render(world,{...options,selectiveTransparency:{layers:6}});
  const { transparencyReport:r } = tight;
  assert(r.culledFragments>1000);
  assert(r.sortedPixels>500 && r.sortedPixels<r.overlapPixels);
  assert(r.layerBudgetPixels>1000);
  assert(r.tiles.some(t=>t.sortedPixels>0 && t.layerBudgetPixels===0));
  assert(r.tiles.some(t=>t.layerBudgetPixels>0 && t.x>60));
  assert.equal(r.tiles.reduce((sum,t)=>sum+t.layerBudgetPixels,0),r.layerBudgetPixels);
  assert.equal(roomier.transparencyReport.layerBudgetPixels,0);
  assert(roomier.transparencyReport.sortedPixels>r.sortedPixels);
  assert.notDeepEqual(roomier.rgb,tight.rgb);
  const opaqueOnly = ink.render({...world,count:0,data:new Float32Array(),renderMetadata:undefined},
    {...options,splatOrder:'center'});
  // In front of both sheets the baffle has the same color as the opaque-only pass.
  const insideBaffle = (53*options.w+42)*3;
  assert.deepEqual(tight.rgb.slice(insideBaffle,insideBaffle+3),opaqueOnly.rgb.slice(insideBaffle,insideBaffle+3));
  const low = ink.render(world,{...options,fragmentBudget:16});
  assert(low.transparencyReport.fragmentBudgetPixels>0);
  assert(low.transparencyReport.peakFragments<=16);
});
