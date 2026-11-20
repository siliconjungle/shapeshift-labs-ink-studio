const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

test('perceptual error regions separate owners and transparent gaps on the art grid', () => {
  const w = 4, h = 2, graded = new Uint8Array(w*h*3).fill(255), resolved = graded.slice();
  for (const p of [0,1,2,4,7]) resolved.fill(0, p*3, p*3+3);
  const alpha = Uint8Array.of(255,0,255,255,128,255,255,255);
  const passes = {w,h,materialId:Uint32Array.of(1,1,2,2,1,2,2,1),materials:[null,'stone','wood']};
  const { report, heatmap, errors } = ink.measureQuantizationError({ w,h,graded,resolved,alpha },{ passes,regionLimit:3 });
  assert.equal(report.metric, 'oklab-distance');
  assert.equal(report.pixels, 7);
  assert.equal(report.transparentPixels, 1);
  assert.equal(report.highErrorPixels, 4);
  assert.equal(report.changedPixels, 4);
  assert.deepEqual(Array.from(errors), [1,0,1,0,1,0,0,1]);
  assert.ok(Math.abs(report.meanError-4/7) < 1e-8);
  assert.deepEqual(report.materials.map(row=>[row.material,row.pixels,row.highErrorPixels]), [['stone',3,3],['wood',4,1]]);
  assert.deepEqual(report.regions.map(row=>[row.material,row.pixels,row.bounds]), [
    ['stone',2,{x:0,y:0,width:1,height:2}],
    ['wood',1,{x:2,y:0,width:1,height:1}],
    ['stone',1,{x:3,y:1,width:1,height:1}]
  ]);
  assert.deepEqual(report.regions[0].worstPixel,{x:0,y:0,error:1,graded:'#ffffff',resolved:'#000000'});
  assert.deepEqual(Array.from(heatmap.rgb.subarray(0,3)), [255,66,76]);
  assert.deepEqual(heatmap.alpha,alpha);
  assert.throws(()=>ink.measureQuantizationError({w,h,graded,resolved},{passes:{...passes,w:w-1}}),/same art grid/);
});

const kit = ink.load();
const view = { w:120,h:72,px:2,ortho:true };
const paletteRule = stage => ({stage,select:{material:'cloth'},palette:{palette:['#662f14']}});

function sampleWorld(renderStages) {
  const { KIT:K,makeBuilder,makeSculpt } = kit;
  const b = makeBuilder(8,[0x141d2c,0xe88059,0x82a6b2]), s = K.sculpt(makeSculpt(b));
  s.box([-.73,.19,0],[.63,.57,.12],{r:[1],materialId:'cloth',em:true},{res:.08,rd:.05});
  s.box([.8,-.19,0],[.63,.57,.12],{r:[2],materialId:'stone',em:true},{res:.08,rd:.05});
  s.bake();
  return b.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0},dither:.4,
    look:{renderStages}});
}

test('the reference keeps frame grading and the resolved pass matches an undiagnosed render', () => {
  const grade = { stage:'frame',stack:{name:'Moonlight',steps:[{
    type:'channelMix',matrix:[[.8,0,0],[0,.8,0],[0,0,.8]],offset:[0,0,.08]
  }]} };
  const world = sampleWorld([grade,paletteRule('palette')]);
  const baseline = ink.render(sampleWorld([grade]),view);
  const resolved = ink.render(world,view);
  const report = ink.reviewQuantizationError(world,view);
  assert.deepEqual(report.graded.rgb,baseline.rgb);
  assert.deepEqual(report.resolved.rgb,resolved.rgb);
  assert.equal(report.report.materials.find(row=>row.material==='stone').maxError,0);
  assert(report.report.regions.some(row=>row.material==='cloth'));
  assert.equal(ink.reviewQuantizationError(sampleWorld([grade]),view).report.maxError,0);
  const framePolicy = ink.reviewQuantizationError(sampleWorld([paletteRule('frame'),grade]),view);
  assert.deepEqual(framePolicy.graded.rgb,baseline.rgb);
  assert(framePolicy.report.highErrorPixels > 0);
});

test('legacy native, coloured and coverage resolves capture aligned pixels unchanged by analysis', () => {
  const world = sampleWorld(undefined);
  for (const opts of [{}, {colored:true}, {stable:{resolve:'coverage'}}]) {
    const renderOptions = {...view, ...opts, transparent:true};
    const resolved = ink.render(world,renderOptions);
    const {report,graded,resolved:captured} = ink.reviewQuantizationError(world,renderOptions);
    assert.deepEqual(captured.rgb,resolved.rgb);
    assert.deepEqual(captured.alpha,resolved.alpha);
    assert.equal(report.stage,'legacy');
    assert.equal(report.width,graded.w);
    assert.equal(report.height,graded.h);
    assert(report.transparentPixels > 0);
    assert(report.materials.find(row=>row.material==='cloth').pixels > 0);
  }
});

test('CLI writes the three native PNGs and material report for the requested shot', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-error-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const scene = path.resolve(__dirname,'../examples/render-stages.js');
  execFileSync(process.execPath,[cli,'palette','error',scene,'--params','{"stage":"palette"}',
    '--w','120','--h','72','--px','2','--t','.25','--threshold','.05','--out',out]);
  const report = JSON.parse(fs.readFileSync(path.join(out,'error.json'),'utf8'));
  assert.deepEqual([report.width,report.height,report.time,report.threshold],[60,36,.25,.05]);
  assert(report.materials.some(row=>row.material && row.highErrorPixels > 0));
  for (const key of ['graded','resolved','heatmap']) {
    const image = PNG.raster(path.join(out,report.files[key]));
    assert.deepEqual([image.w,image.h],[60,36]);
  }
});
