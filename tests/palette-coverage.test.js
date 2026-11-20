const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('..');
const { KIT:K, ColorSpace, SplatEffects } = load();
const close = (a,b) => assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const gray = ['#000000','#ffffff'];

test('the boundary is the true distance to the bisector inside the slice', () => {
  const field = K.palette.coverage({palette:gray});
  const row = field.measure(.3,.2);
  assert.equal(row.index,0);
  close(row.error,Math.sqrt(.3*.3**2+.55*.2**2+.15*.5**2));
  close(row.boundary,(.3*.4+.55*.6)/(2*Math.sqrt(.85)));
  assert.equal(field.index(.5,.5),0);
  close(field.measure(.5,.5).boundary,0);
  assert.equal(field.index(.9,.9),1);
  const parallel = K.palette.coverage({palette:['#000000','#0000ff','#000000']});
  assert.equal(parallel.measure(.3,.4).boundary,Infinity);
  assert.equal(parallel.index(.3,.4),0);
  assert.throws(()=>K.palette.coverage({palette:gray,slice:{origin:[0,0,0],along:[1,0,0],across:[2,0,0]}}),/span a plane/);
});

test('boundary distance examines all competitors even when the second-nearest cannot overtake', () => {
  const field = K.palette.coverage({
    palette:['#000000','#000080','#ff0000'],
    slice:{origin:[0,0,.245],along:[1,0,0],across:[0,1,0]}
  });
  const row = field.measure(.49,.03);
  assert.equal(row.index,0);
  close(row.boundary,.01*Math.sqrt(.3));
});

test('an OKLab slice reuses the perceptual conversion and retains indices under visual changes', () => {
  const red = ColorSpace.toOKLab([1,0,0]);
  const def = {palette:['#ff0000','#001147'],space:'oklab',slice:{origin:red,along:[0,.4,0],across:[0,0,.4]}};
  const field = K.palette.coverage(def);
  assert.equal(field.index(0,0),0);
  close(field.measure(0,0).error,0);
  const nearest = field.raster(7,7), report = K.palette.coverage({...def,view:'error',ramp:gray}).raster(7,7);
  assert.deepEqual(nearest.indices,report.indices);
  assert.deepEqual(nearest.errors,report.errors);
  assert.deepEqual(nearest.boundaries,report.boundaries);
  assert.notDeepEqual(nearest.rgb,report.rgb);
});

test('material lead lines and diagnostic ramps use the same boundary readings as the chart', () => {
  const resolve = value => value === undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const def = {palette:gray,edge:{color:'#ff0000',width:.003},size:[2,2]};
  const make = coverage => SplatEffects.layer({pattern:'palette-coverage',coverage},undefined,resolve);
  const layer=make(def), read = (effect,x,z) => Array.from(effect.sample({position:[x,0,z]}));
  assert.deepEqual(read(layer,1,1).slice(0,3),[1,0,0]);
  assert.deepEqual(read(layer,.15,.15).slice(0,3),[0,0,0]);
  assert.equal(read(layer,-1,0)[3],0);
  const boundary = make({...def,view:'boundary',ramp:['#ff0000','#0000ff']});
  assert.deepEqual(boundary.palette,[[1,0,0],[0,0,1]]);
  assert.deepEqual(read(boundary,1,1).slice(0,3),[1,0,0]);
});
