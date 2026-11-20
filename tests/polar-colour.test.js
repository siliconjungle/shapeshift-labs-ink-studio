const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('..');
const { KIT:K, SplatEffects } = load();
const palette = ['#000000','#ffffff','#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff'];

test('angle selects hue and either brightness or saturation can grow outward', () => {
  const value = K.palette.polar({palette});
  assert.equal(value.index(.5,.5),0);
  assert.equal(value.index(1,.5),2);
  assert.equal(value.index(0,.5),5);
  assert.equal(value.index(.75,.5-Math.sqrt(3)/4),7);
  assert.equal(K.palette.polar({palette,rotation:.5}).index(1,.5),5);
  const inverse = K.palette.polar({palette,range:[1,0],saturation:0});
  assert.equal(inverse.index(.5,.5),1);
  assert.equal(inverse.index(1,.5),0);
  const sat = K.palette.polar({palette,radial:'saturation'});
  assert.equal(sat.index(.5,.5),1);
  assert.equal(sat.index(1,.5),2);
  assert.equal(sat.index(0,.5),5);
  assert.throws(()=>K.palette.polar({palette,radial:'saturation',saturation:.5}),/only the fixed axis/);
  assert.throws(()=>K.palette.polar({palette,range:[-.1,1]}),/radial endpoints/);
});

test('export keeps a round disk in a wide raster and distinguishes black paint from transparency', () => {
  const field = K.palette.polar({palette});
  const out = [1,2,3];
  assert.equal(field.sample(0,0,out),null);
  assert.deepEqual(out,[1,2,3]);
  const a = field.raster(17,9), b = field.raster(9,9);
  const channels = (frame,x,y) => [frame.indices[y*frame.w+x],frame.alpha[y*frame.w+x]];
  for (let y=0;y<9;y++) for(let x=0;x<9;x++) assert.deepEqual(channels(a,x+4,y),channels(b,x,y));
  assert.deepEqual(channels(a,0,4),[-1,0]);
  assert.deepEqual(channels(a,8,4),[0,255]);
  assert.deepEqual(channels(a,8,0),[4,255]);
  assert.deepEqual(channels(a,12,4),[2,255]);
  assert.equal(a.alpha[4],0);
});

test('the projected disk clips corners and keeps a physical circle when the tile is rectangular', () => {
  const projection = { origin:[3,4,0], across:[0,1,0] };
  const polar = { palette, radial:'saturation', size:[4,2] };
  const resolveColor = value => value === undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const layer = SplatEffects.layer({ type:'projected', pattern:'polar-colour', projection, polar },undefined,resolveColor);
  const hit = (x,y) => Array.from(layer.sample({position:[x,y,0],worldPosition:[9,9,9]}));
  assert.equal(hit(3.5,5)[3],0);
  assert.equal(hit(5,5)[3],1);
  assert.deepEqual(hit(6,5).slice(0,3),[1,0,0]);
  assert.equal(hit(6,6)[3],0);
  assert.throws(()=>SplatEffects.layer({pattern:'polar-colour'},undefined,resolveColor),/polar definition/);
});
