const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const PNG = require('../cli/png.js');
const {KIT:K,ColorSpace,SplatEffects} = require('..').load();
const complementary = {type:'complementary',color:'#d97a40'};
const close = (a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,a+' vs '+b);
const achromatic = color => {
  close(color[0],color[1]);
  close(color[1],color[2]);
};

test('complements oppose the source hue and can pass through a specific neutral',()=>{
  const field = K.palette.chromaField({...complementary,neutralLightness:.64});
  assert.deepEqual(field.sample(0,1),[217/255,122/255,64/255]);
  const [start,a,b] = ColorSpace.toOKLab(field.sample(0,1));
  const [end,c,d] = ColorSpace.toOKLab(field.sample(1,1));
  close(start,end);
  close((a*c+b*d)/(Math.hypot(a,b)*Math.hypot(c,d)),-1);
  const neutral = field.sample(.5,1);
  achromatic(neutral);
  close(ColorSpace.toOKLab(neutral)[0],.64);
  const shadow = K.palette.chromaField({...complementary,shade:[1,0],shadow:'#132b50'});
  assert.deepEqual(shadow.sample(.3,-1),[19/255,43/255,80/255]);
  assert.deepEqual(shadow.sample(.9,0),shadow.sample(.3,0));
});

test('directed hue arcs retain chroma and meet the same two authored endpoints',()=>{
  const options = {...complementary,opposite:'#3f97ad'};
  const neutral = K.palette.chromaField(options);
  const a = K.palette.chromaField({...options,route:'increasing'});
  const b = K.palette.chromaField({...options,route:'decreasing'});
  for (const field of [a,b]) {
    assert.deepEqual(field.sample(0,1),neutral.sample(0,1));
    assert.deepEqual(field.sample(1,1),[63/255,151/255,173/255]);
    const [,chromaA,chromaB] = ColorSpace.toOKLab(field.sample(.5,1));
    assert(Math.hypot(chromaA,chromaB) > .06);
  }
  assert.notDeepEqual(a.sample(.5,1),b.sample(.5,1));
  assert.throws(()=>K.palette.chromaField({...options,route:'increasing',neutralLightness:.3}),/neutral lightness/);
});

test('desaturation preserves lightness by default and exports indexed bands when constrained',()=>{
  const options = {type:'desaturation',color:'#21ab83'};
  const field = K.palette.chromaField(options);
  const pale = field.sample(1,1);
  achromatic(pale);
  close(ColorSpace.toOKLab(pale)[0],ColorSpace.toOKLab(field.sample(0,1))[0]);
  const constrained = K.palette.chromaField({...options,steps:[5,3],
    palette:['#19233c','#35af86','#ffffff'],neutralLightness:.94,shade:[1,0]});
  const {rgb,indices,palette} = constrained.raster(10,6);
  for (let y=0;y<6;y++) for (let x=0;x<10;x++) {
    const at = y*10+x, slot = constrained.index((x+.5)/10,1-(y+.5)/6);
    assert.equal(indices[at],slot);
    assert.deepEqual([...rgb.subarray(at*3,at*3+3)],palette[slot].map(n=>Math.round(n*255)));
    assert.equal(indices[at],indices[(y-y%2)*10+x-x%2]);
  }
  assert(new Set(indices).size > 1);
  assert.throws(()=>K.palette.chromaField({...options,steps:[1,4]}),/steps/);
  assert.throws(()=>K.palette.chromaField({...options,opposite:'#000000'}),/controls/);
});

test('projected finishes share the standalone field coordinates and palette',()=>{
  const definition = {...complementary,palette:['#5c2a22','#dd9d58','#36909c','#9da3aa']};
  const field = K.palette.chromaField(definition);
  const resolve = value => value === undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const layer = SplatEffects.layer({type:'projected',pattern:'chroma-field',
    projection:{origin:[1,2,3],across:[0,1,0]},chromaField:{...definition,size:[2,4]}},undefined,resolve);
  assert.deepEqual(layer.palette,field.outputPalette);
  assert.deepEqual([...layer.sample({position:[1.5,5,3]}).slice(0,3)],field.sample(.25,.75));
  assert.equal(layer.sample({position:[.5,5,3]})[3],0);
});

test('CLI textures match both reusable field definitions',()=>{
  const dest = mkdtempSync(join(tmpdir(),'ink-chroma-field-'));
  const cli = join(__dirname,'../cli/ink-studio.js');
  try {
    for (const type of ['complementary','desaturation']) {
      const path = join(__dirname,'../examples',type+'-field.json'), out = join(dest,type+'.png');
      execFileSync(process.execPath,[cli,'palette','field',path,'--w','24','--h','12','--out',out]);
      const {w,h,rgb} = PNG.read(out), field = K.palette.chromaField(require(path));
      assert.deepEqual([w,h],[24,12]);
      assert.deepEqual([...rgb],[...field.raster(w,h).rgb]);
    }
  } finally {
    rmSync(dest,{recursive:true,force:true});
  }
});
