const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT } = ink.load();

const fixture={w:5,h:1,rgba:Uint8Array.from([
  0,0,128,255, 255,255,0,255, 255,0,0,255, 123,125,122,128, 0,255,0,0
])};
const total=rows=>rows.reduce((sum,row)=>sum+row.pixels,0);
const family=(report,id)=>report.hue.find(row=>row.family===id);

test('distributions count visible pixels in shared bins and attribute each tonal group to hue families', () => {
  const report=KIT.palette.distributions(fixture,{bins:8});
  assert.deepEqual(report.alpha,{mode:'visible',opaque:3,partial:1,transparent:1,included:4,excluded:1});
  assert.equal(report.brightness.length,8);
  for (const key of ['brightness','hue','saturation']) assert.equal(total(report[key]),4);
  for (const id of ['blue','yellow','red','neutral']) assert.equal(family(report,id).pixels,1);
  assert.equal(family(report,'green').pixels,0);
  assert.deepEqual(report.tones.shadows.families,[{family:'blue',swatch:'#000080',pixels:1,share:1}]);
  assert.deepEqual(report.tones.highlights.families,[{family:'yellow',swatch:'#ffff00',pixels:1,share:1}]);
  assert.equal(report.tones.midtones.pixels,2);
  assert.equal(report.tones.accents.pixels,3);
  assert.equal(total(report.tones.accents.families),3);
  assert.equal(KIT.palette.distributions(fixture,{alpha:'opaque'}).alpha.included,3);
  assert.equal(family(KIT.palette.distributions(fixture,{alpha:'all'}),'green').pixels,1);
  assert.equal(KIT.palette.distributions({w:1,h:1,rgba:Uint8Array.of(255,0,0,0)}).tones.accents.share,0);
});

test('comparison deltas use shares across resolutions and read straight RGB and separate alpha', () => {
  const reference={w:1,h:1,rgb:Uint8Array.of(255,255,255)};
  const studio={w:3,h:1,rgb:Uint8Array.of(255,0,0,255,0,0,0,255,0),alpha:Uint8Array.of(255,255,0)};
  const report=KIT.palette.compareDistributions(reference,studio);
  assert.equal(report.reference.alpha.included,1);
  assert.equal(report.studio.alpha.included,2);
  assert.equal(report.differences.tones.highlights,-1);
  assert.equal(report.differences.tones.midtones,1);
  assert.equal(report.differences.tones.accents,1);
  assert.equal(report.differences.hue.find(row=>row.family==='red').change,1);
  const sum=rows=>rows.reduce((sum,row)=>sum+row.change,0);
  for (const key of ['brightness','hue','saturation']) assert.equal(sum(report.differences[key]),0);
  assert.throws(()=>KIT.palette.distributions(reference,{shadow:.8,highlight:.2}),/below highlight/);
});

test('indexed distributions use actual slot counts and merge identical RGB', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-distributions-indexed-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'indexed.png');
  PNG.writeIndexed(file,6,1,[0,0,1,2,null,null],[[255,0,0],[255,0,0],[5,35,159],[255,255,255]]);
  const decoded=PNG.paletteSource(file);
  const report=KIT.palette.distributions(decoded);
  assert.equal(report.sourceSwatches,2);
  assert.equal(report.alpha.included,4);
  assert.equal(family(report,'red').pixels,3);
  assert.deepEqual(report,KIT.palette.distributions({...PNG.raster(file),bitDepth:decoded.bitDepth}));
});

test('the CLI compares a PNG to an exported frame or a scene and writes the review sheet', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-distributions-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'input.png'), png=path.join(dir,'png'), scene=path.join(dir,'scene');
  fs.writeFileSync(source,PNG.encode(fixture.w,fixture.h,fixture.rgba,4));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), fixtureScene=path.resolve(__dirname,'../examples/palette-remap.json');
  const run=(out,...args)=>execFileSync(process.execPath,[cli,'palette','distributions',source,'--out',out,...args]);
  run(png,'--render',source,'--bins','8');
  run(scene,'--scene',fixtureScene,'--w','110','--h','60','--px','2','--t','.25');
  const read=out=>JSON.parse(fs.readFileSync(path.join(out,'distributions.json'),'utf8'));
  const matched=read(png), shot=read(scene);
  assert(matched.differences.hue.every(row=>row.change===0));
  assert(matched.differences.saturation.every(row=>row.change===0));
  assert.deepEqual([shot.studio.width,shot.studio.height,shot.studio.shot.time],[55,30,.25]);
  const preview=PNG.raster(path.join(scene,shot.preview.file));
  assert.deepEqual([preview.w,preview.h],[shot.preview.width,shot.preview.height]);
  assert(preview.data.some((n,i)=>i%4===0 && n>180));
  assert.deepEqual(KIT.palette.distributions(fixture,{bins:8}).hue,matched.reference.hue);
});
