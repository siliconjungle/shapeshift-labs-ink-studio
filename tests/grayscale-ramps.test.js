const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {execFileSync} = require('node:child_process');
const PNG = require('../cli/png.js');
const {KIT:K, SurfaceLook, ColorSpace} = require('..').load();
const definition = {type:'grayscale',palette:['#707070','#ff0000','#ffffff','#111111','#707070']};

test('grayscale matching separates neutral color distance from perceived lightness',()=>{
  const nearest = K.palette.ramp(definition);
  const lightness = K.palette.ramp({...definition,metric:'lightness'});
  assert.equal(nearest.index(.53),0);
  assert.equal(lightness.index(.53),1);
  const measured = lightness.measure(.53);
  assert.deepEqual(measured.color,[1,0,0]);
  assert.equal(measured.gray,.53);
  assert.equal(measured.swatchLightness,ColorSpace.toOKLab([1,0,0])[0]);
  assert.equal(measured.error,Math.abs(measured.targetLightness-measured.swatchLightness));
  assert.equal(nearest.measure(.53).error,.53-112/255);
  assert.equal(nearest.index(112/255),0);
  assert.equal(lightness.index(112/255),0);
  assert.deepEqual(nearest.sample(-2),[17/255,17/255,17/255]);
  assert.deepEqual(nearest.sample(2),[1,1,1]);
  const restricted = K.palette.ramp({...definition,range:[.53,.53],metric:'lightness'});
  assert.equal(restricted.index(0),1);
  assert.equal(restricted.index(1),1);
  assert.throws(()=>K.palette.ramp({...definition,range:[1,0]}),/gray endpoints/);
  assert.throws(()=>nearest.index(NaN),/finite/);
});

test('material color curves reuse the ramp for both lit luminance and authored scalar inputs',()=>{
  const paletteRamp = {...definition,metric:'lightness'};
  const surface = source => ({layers:{ink:{type:'colorCurve',paletteRamp,source}}});
  const sample = {position:[0,.53,0],depth:.53,normal:[0,0,1],view:[0,0,1]};
  const gray = [.53,.53,.53], dark = [.10,.10,.10];
  const shade = (source,base) => SurfaceLook.shade(SurfaceLook.prepare(surface(source)),sample,base);
  assert.deepEqual(shade('luminance',gray).slice(0,3),[1,0,0]);
  assert.deepEqual(shade('height',dark).slice(0,3),[1,0,0]);
  assert.deepEqual(shade('depth',dark).slice(0,3),[1,0,0]);
  assert.deepEqual(shade('luminance',gray)[5],K.palette.ramp(paletteRamp).outputPalette);
  assert.deepEqual(SurfaceLook.shade(SurfaceLook.prepare(surface(),[],undefined,undefined,{colorCurves:false}),sample,gray).slice(0,3),gray);
  assert.throws(()=>SurfaceLook.prepare({layers:{ink:{...surface().layers.ink,ramp:{stops:[]}}}}),/own color and ramp controls/);
});

test('the CLI strip and JSON report agree about every swatch band and omitted duplicate',()=>{
  const width = 64, height = 2;
  const temp = mkdtempSync(join(tmpdir(),'ink-grayscale-test-'));
  try {
    const file = join(temp,'ramp.png'), cli = join(__dirname,'../cli/ink-studio.js');
    const example = join(__dirname,'../examples/grayscale-ramp.json');
    const run = (...args)=>execFileSync(process.execPath,[cli,'palette','field',example,'--w',width,...args],{encoding:'utf8'});
    run('--out',file,'--h',height);
    const {w,h,rgb} = PNG.read(file);
    assert.deepEqual([w,h],[width,height]);
    const report = JSON.parse(run('--format','data'));
    assert.equal(report.metric,'nearest');
    assert.equal(report.swatches.reduce((sum,row)=>sum+row.pixels,0),width);
    assert(report.swatches.some(row=>row.pixels===0));
    let x = 0;
    for (const {startPixel,endPixel,index} of report.bands) {
      assert.equal(startPixel,x);
      const expected = report.swatches[index].rgb.map(n=>Math.round(n*255));
      for (;x<endPixel;x++) for (let y=0;y<height;y++) {
        const at = 3*(y*width+x);
        assert.deepEqual([...rgb.subarray(at,at+3)],expected);
      }
    }
    assert.equal(x,width);
    const duplicates = K.palette.ramp(definition).report(32);
    assert.equal(duplicates.swatches.at(-1).pixels,0);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});
