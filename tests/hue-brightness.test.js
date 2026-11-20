const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, SplatEffects } = ink.load();
const palette = ['#000000','#ffffff','#777777','#ff0000','#00ff00','#0000ff'];

test('hue–brightness samples exact swatches, wraps hue and gives neutral saturation a uniform row', () => {
  const field = K.palette.hueBrightness({palette});
  assert.deepEqual([0,1/3,2/3,1].map(hue => field.index(hue,1)),[3,4,5,3]);
  assert.deepEqual(field.sample(.45,0),[0,0,0]);
  const seam = K.palette.hueBrightness({palette,hue:[.8,1.2]});
  assert.equal(seam.index(.5,1),3);
  const neutral = K.palette.hueBrightness({palette,saturation:0});
  const chart = neutral.raster(16,8);
  for (let y=0; y<8; y++) assert.equal(new Set(chart.indices.slice(y*16,(y+1)*16)).size,1);
  assert.equal(chart.indices[0],1);
  assert.equal(chart.indices.at(-1),0);
  const dark = K.palette.hueBrightness({palette,saturation:0,brightness:[.1,.2]});
  assert(dark.raster(4,4).indices.every(index=>index===0));
  assert.throws(()=>K.palette.hueBrightness({palette,saturation:1.1}),/saturation/);
  assert.throws(()=>K.palette.hueBrightness({palette:new Array(2)}),/swatch/);
  assert.throws(()=>field.raster(1024,1025),/1,048,576/);
});

test('a projected field reuses the chart sampler, masks its rectangle and can repeat in rest space', () => {
  const definition = {palette,hue:[.2,.8],saturation:.45};
  const field = K.palette.hueBrightness(definition);
  const projection = {origin:[3,4,1],across:[0,1,0]};
  const resolveColor = value => value === undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const layer = wrap => SplatEffects.layer({
    type:'projected', pattern:'hue-brightness', projection, hueBrightness:{...definition, size:[2,3], wrap}
  },undefined,resolveColor);
  const sample = position => ({position,worldPosition:[30,30,30]});
  const panel = layer(false);
  const pixel = panel.sample(sample([3.5,6.25,1]));
  assert.deepEqual(Array.from(pixel.slice(0,3)),field.sample(.25,.75));
  assert.equal(pixel[3],1);
  assert.equal(panel.sample(sample([5.5,6.25,1]))[3],0);
  assert.deepEqual(Array.from(layer(true).sample(sample([5.5,6.25,1])).slice(0,3)),field.sample(.25,.75));
  assert.throws(()=>SplatEffects.layer({pattern:'hue-brightness'},undefined,resolveColor),/hueBrightness definition/);
});
