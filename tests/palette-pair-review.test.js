const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT, ColorSpace } = ink.load();

const palette = ['#151925','#161925',0x151925,'#ff0000','#00a600','#f5e4b8'];
const at = (pairs,a,b) => pairs.find(({indices})=>indices[0]===a && indices[1]===b);

test('pair review detects exact RGB8 duplicates and ranks perceptual and lightness separation independently', () => {
  const { report } = KIT.palette.reviewPairs({palette});
  assert.equal(report.counts.pairs,15);
  assert.equal(report.counts.duplicate,1);
  assert.deepEqual(report.duplicateGroups,[{swatch:'#151925',indices:[0,2]}]);
  assert.deepEqual(report.pairs.slice(0,3).map(row=>row.indices),[[0,2],[0,1],[1,2]]);
  assert.deepEqual(report.pairs.slice(0,3).map(row=>row.classification),['duplicate','close','close']);
  const chromatic = at(report.pairs,3,4);
  const red = ColorSpace.toOKLab([1,0,0]), green = ColorSpace.toOKLab([0,166/255,0]);
  assert.equal(chromatic.distance,Math.hypot(...red.map((v,i)=>v-green[i])));
  assert.equal(chromatic.lightnessDelta,Math.abs(red[0]-green[0]));
  assert.equal(chromatic.classification,'distinct');
  assert.equal(chromatic.lowLightnessSeparation,true);
  assert(chromatic.lightnessRank<chromatic.distanceRank);
  const byLightness = KIT.palette.reviewPairs({palette,sort:'lightness',maxDistance:0}).report;
  assert(byLightness.pairs.every((row,i)=>row.lightnessRank===i+1));
  assert.equal(byLightness.counts.close,0);
  assert.equal(byLightness.counts.duplicate,1);
  assert.equal(byLightness.duplicateGroups[0].swatch,'#151925');
});

test('native and scaled comparisons retain palette bytes on both sides of every pair', () => {
  const review = KIT.palette.reviewPairs({palette,limit:5,columns:2});
  const pixel = (image,x,y) => [...image.rgb.subarray((y*image.w+x)*3,(y*image.w+x)*3+3)];
  const native = review.preview(), viewing = review.preview(8);
  assert.deepEqual([native.w,native.h,viewing.w,viewing.h],[5,5,40,40]);
  assert.equal(native.alpha[2],0);
  for (const {indices,bounds:[x,y,w,h]} of review.report.cells) {
    assert.deepEqual([w,h],[2,1]);
    for (const s of [0,1]) {
      const color = review.report.palette[indices[s]], bytes = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
      assert.deepEqual(pixel(native,x+s,y),bytes);
      assert.equal(native.alpha[y*native.w+x+s],255);
      for (let dy=0;dy<8;dy++) for (let dx=0;dx<8;dx++)
        assert.deepEqual(pixel(viewing,(x+s)*8+dx,y*8+dy),bytes);
    }
  }
});

test('pair review handles empty palettes and analyzes all slots in a 256-entry palette', () => {
  const empty = KIT.palette.reviewPairs({palette:[]});
  assert.equal(empty.report.counts.pairs,0);
  assert.deepEqual([...empty.preview().alpha],[0]);
  const many = KIT.palette.reviewPairs({palette:Array.from({length:256},(_,i)=>i),limit:2});
  assert.equal(many.report.counts.pairs,32640);
  assert.equal(many.report.cells.length,2);
  assert.throws(()=>KIT.palette.reviewPairs({palette,maxDistance:-.1}),/thresholds/);
  assert.throws(()=>many.preview(0),/scale/);
});

test('palette pairs reads an extracted palette report and emits matched native and viewing PNGs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pal-pairs-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const reference = path.join(dir,'reference.png'), source = path.join(dir,'extracted.json');
  const cols = [[21,25,37],[22,25,37],[21,25,37],[255,0,0],[0,166,0]];
  PNG.writeIndexed(reference,5,1,[0,1,2,3,4],cols);
  fs.writeFileSync(source,JSON.stringify(ink.readReferencePalette(reference)));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), out = path.join(dir,'review');
  execFileSync(process.execPath,[cli,'palette','pairs',source,'--sort','lightness','--limit','4','--scale','3','--out',out]);
  const report = JSON.parse(fs.readFileSync(path.join(out,'pairs.json'),'utf8'));
  assert.equal(report.sort,'lightness');
  assert.equal(report.counts.duplicate,1);
  assert.equal(report.cells.length,4);
  const native = PNG.raster(path.join(out,report.previews.native.file));
  const large = PNG.raster(path.join(out,report.previews.viewing.file));
  assert.deepEqual([native.w,native.h],[report.previews.native.width,report.previews.native.height]);
  assert.deepEqual([large.w,large.h],[3*native.w,3*native.h]);
  for (let y=0;y<large.h;y++) for (let x=0;x<large.w;x++) {
    const a = (y*large.w+x)*4, b = (Math.floor(y/3)*native.w+Math.floor(x/3))*4;
    assert.deepEqual(large.data.subarray(a,a+4),native.data.subarray(b,b+4));
  }
});
