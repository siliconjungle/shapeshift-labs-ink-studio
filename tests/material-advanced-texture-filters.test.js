const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { graphImages: image } = Ink.load().KIT.procedural;
const { bevel, emboss, heightShadow, heightFrequency, edgeWear } = image.advancedHeight;
const { slopeBlur, seamRepair, scanCleanup } = image.advancedTexture;

const grid = (values, width, intent, settings = {}) => image.declare({
  width, height: values.length / width, channels: 1, data: Float64Array.from(values) },
{ intent, ...(intent === 'height' && { units: 'art-px' }), ...settings });
const height = (...values) => grid(values, values.length, 'height');
const mask = (...values) => grid(values, values.length, 'mask');
const read = value => Array.from(value.raster.data);
const close = (got, expected, tolerance = 1e-6) => assert.ok(Math.abs(got - expected) <= tolerance, got + ' differs from ' + expected);

test('slope blur follows a signed path and supports mean, minimum and maximum accumulation', () => {
  const source = height(0, 2, 4, 6, 10, 16, 24), ramp = height(0, 1, 2, 3, 4, 5, 6);
  const options = { distance: 2, samples: 3, filter: 'nearest' };
  close(read(slopeBlur(source, ramp, options))[4], (10 + 6 + 4) / 3);
  assert.equal(read(slopeBlur(source, ramp, { ...options, mode: 'min' }))[4], 4);
  assert.equal(read(slopeBlur(source, ramp, { ...options, mode: 'max' }))[4], 10);
  close(read(slopeBlur(source, ramp, { ...options, distance: -2 }))[3], (6 + 10 + 16) / 3);
  assert.equal(slopeBlur(source, ramp, { distance: 0 }), source);
  const wrapped = read(slopeBlur(source, ramp, { ...options, distance: 4, border: 'wrap' }));
  close(wrapped[0], 16);
  assert.deepEqual(read(slopeBlur(source, height(5, 5, 5), options)), read(source));
});

test('bevel profiles have signed height, seam-aware centered distances and editable placement', () => {
  const source = mask(0, 1, 1, 1, 0);
  const linear = { width: 2, height: 4, profile: 'linear' };
  assert.deepEqual(read(bevel(source, linear)), [0, 1, 3, 1, 0]);
  assert.deepEqual(read(bevel(source, { ...linear, height: -4 })), [-0, -1, -3, -1, -0]);
  assert.deepEqual(read(bevel(source, { ...linear, side: 'outside' })), [3, 4, 4, 4, 3]);
  const wrapped = bevel(mask(1, 1, 0, 0, 1), { ...linear, border: { u: 'wrap' } });
  assert.deepEqual(read(wrapped), [3, 1, 0, 0, 1]);
  assert.ok(read(bevel(source, { ...linear, profile: 'round' }))[1] > 1);
  assert.equal(wrapped.descriptor.units, 'art-px');
});

test('emboss uses the selected light, normal spacing and a neutral baseline for flat areas', () => {
  assert.deepEqual(read(emboss(height(5, 5, 5))), [.5, .5, .5]);
  const rise = height(0, 1, 2, 3, 4);
  assert.ok(read(emboss(rise, { azimuth: 0, elevation: 0, strength: .5 }))[2] < .5);
  assert.ok(read(emboss(rise, { azimuth: 180, elevation: 0, strength: .5 }))[2] > .5);
  const shallow = read(emboss(rise, { azimuth: 0, elevation: 0, spacing: [10, 1] }))[2];
  assert.ok(shallow > .35 && shallow < .5);
});

test('seam repair matches opposing samples, keeps the interior and blends alpha in linear light', () => {
  const h = grid(Array.from({ length: 25 }, (_, i) => i / 7), 5, 'height', { pixelPitchMm: [.22,.32] });
  const result = seamRepair(h, { width: 1 });
  const data = read(result);
  for (let x = 0; x < 5; x++) assert.equal(data[x], data[20+x]);
  for (let y = 0; y < 5; y++) assert.equal(data[y*5], data[y*5+4]);
  assert.equal(data[12], read(h)[12]);
  assert.equal(result.descriptor, h.descriptor);
  assert.equal(seamRepair(h, { strength: 0 }), h);
  const rgba = image.declare({ width: 3, height: 1, data: Uint8Array.of(
    255,0,0,0, 10,20,30,255, 0,0,255,255) }, { intent: 'color' });
  assert.deepEqual(read(seamRepair(rgba, { axes: 'u' })), [0,0,255,128, 10,20,30,255, 0,0,255,128]);
});

test('directional height shadows trace occluders, bound the reach and cross wrapped seams', () => {
  const ridge = height(0,0,3,0,0), light = { azimuth: 0, elevation: 35, filter: 'nearest', bias: 0, reach: 6 };
  assert.deepEqual(read(heightShadow(ridge, light)), [1,1,0,0,0]);
  assert.deepEqual(read(heightShadow(ridge, { ...light, azimuth: 180 })), [0,0,0,1,1]);
  assert.deepEqual(read(heightShadow(ridge, { ...light, reach: 1 })), [0,1,0,0,0]);
  assert.equal(read(heightShadow(height(4,0,0,0,0), light))[4], 0);
  assert.equal(read(heightShadow(height(4,0,0,0,0), { ...light, border: { u: 'wrap' } }))[4], 1);
  assert.deepEqual(read(heightShadow(height(-20,-20,-20), { ...light, border: 'transparent' })), [0,0,0]);
  const penumbra = read(heightShadow(height(0,1,0), { ...light, elevation: 45, softness: 10 }))[0];
  assert.ok(penumbra > 0 && penumbra < 1);
});

test('height bands reconstruct exactly by default and independently retain signed detail', () => {
  const source = grid([0, 2, -2, 4, -1, 0], 6, 'height', { units:'mm', pixelPitchMm:[.2,.4] });
  const options = { fineRadius:1, coarseRadius:3, border:'wrap' };
  const result = heightFrequency(source, options);
  assert.deepEqual(read(result.value), read(source));
  for (let p = 0; p < 6; p++) close(result.fine.raster.data[p] + result.mid.raster.data[p] + result.coarse.raster.data[p], source.raster.data[p]);
  assert.ok(read(result.fine).some(x => x < 0));
  assert.deepEqual(read(heightFrequency(source, { ...options, fineGain:0, midGain:0 }).value), read(result.coarse));
  assert.equal(result.fine.descriptor.units, 'mm');
});

test('scan cleanup removes isolated dust while preserving connected marks and authored protection', () => {
  const values = Array(49).fill(.2);
  for (let y = 0; y < 7; y++) values[y*7+1] = .85;
  values[3*7+5] = 1;
  const scan = grid(values, 7, 'data', { tiling:{v:'wrap'} });
  const result = scanCleanup(scan);
  assert.equal(result.repaired.raster.data[26],1);
  assert.equal(result.value.raster.data[26],.2);
  assert.equal(result.value.raster.data[22],.85);
  const protect = Array(49).fill(1);
  protect[26] = 0;
  assert.equal(scanCleanup(scan, {}, grid(protect,7,'mask')).value.raster.data[26],1);
});

test('scan cleanup applies measured linear illumination without changing alpha or HDR contract', () => {
  const source = image.declare({width:2,height:1,data:Float64Array.of(.5,.2,1.5,.5,4,0,0,0)},
    {intent:'color',colorSpace:'srgb-linear'});
  const corrected = scanCleanup(source, {amount:0}, null, grid([.5,1],2,'data'));
  assert.deepEqual(read(corrected.value),[1,.4,3,.5,4,0,0,0]);
  assert.deepEqual(read(corrected.repaired),[0,0]);
  assert.equal(corrected.value.descriptor,source.descriptor);
});

test('wear distinguishes convex and concave edges and exposes the actual depth cut', () => {
  const relief = height(0,0,2,0,0,-2,0,0);
  const options = {radius:1,threshold:.12,softness:0,depth:.5};
  const convex = edgeWear(relief, options);
  const concave = edgeWear(relief, {...options,edge:'concave'});
  assert.equal(convex.value.raster.data[2],1);
  assert.equal(concave.value.raster.data[2],0);
  assert.equal(concave.value.raster.data[5],1);
  assert.equal(convex.height.raster.data[2],1.5);
  assert.deepEqual(read(edgeWear(height(.3,.3,.3),{threshold:0,softness:0}).value),[0,0,0]);
  assert.equal(edgeWear(relief,options,mask(1,1,0,1,1,1,1,1)).height.raster.data[2],2);
});

test('the advanced filters replay as an editable graph with height, normal and mask outputs', () => {
  const op = (op,inputs) => ({op,inputs}), node = (node,port='value') => ({node,port});
  const graph = {format:'ink-studio/graph-project',version:1,nodes:{
    mask:op('image.uniform',{value:1,width:5,height:5,descriptor:{intent:'mask'}}),
    relief:op('image.bevel',{source:node('mask'),options:{border:'transparent',height:2}}),
    freq:op('image.heightFrequency',{source:node('relief'),options:{fineRadius:1,coarseRadius:3}}),
    chips:op('image.edgeWear',{source:node('freq'),options:{depth:.5}}),
    normal:op('image.heightToNormal',{source:node('chips','height')}),
    shadow:op('image.heightShadow',{source:node('chips','height')})
  },outputs:{normal:node('normal'),shadow:node('shadow'),fine:node('freq','fine')}};
  const project = Ink.createGraphProject(JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph,{id:'advanced'}))));
  const {outputs} = project.run();
  assert.equal(outputs.normal.descriptor.intent,'normal');
  assert.equal(outputs.shadow.descriptor.intent,'mask');
  assert.equal(outputs.fine.descriptor.units,'art-px');
});
