const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();
const Exposure = K.programmableExposure;
const width = 64, height = 48, center = 24 * width + 32;
const view = { w: width, h: height, px: 1, raw: true, t: 1 };
const pixel = (frame, p) => Array.from(frame.rgb.subarray(p * 3, p * 3 + 3));
const jade = (frame, p) => {
  const [r,g,b] = pixel(frame, p);
  return r < 140 && g > 210 && b > 176;
};

function build({ tall = false, two = false } = {}) {
  const B = makeBuilder(2, [0x101627, 0xff703e, 0x66f2d0]);
  if (tall) B.axial(0, 0, 0, [0,1,0], 1.55, .12, B.P[1], 2);
  else B.disc(0, 0, 0, [0,0,1], .48, .01, B.P[1], 2);
  B.describeSplats(0, 1, { object:'lamp', material:'orange' });
  if (two) {
    B.disc(0, 0, .8, [0,0,1], .25, .01, B.P[2], 2);
    B.describeSplats(1, 2, { object:'lens', material:'jade' });
  }
  const world = B.finish({ cam:{ target:[0,0,0], dist:4, yaw:0, pitch:0, ortho:true }, radius:3, dither:0 });
  world.anim = { update(_dt, t) {
    world.data[0] = (t - 1) * 4;
    if (two) world.data[16] = -(t - 1) * 6;
  } };
  return world;
}

test('curves integrate by energy, stepped samples collapse, and masks scan on the selected axis', () => {
  const plans = ['box', 'triangle', [[0,0],[.5,0],[1,4]]].map(curve =>
    Exposure.prepare({ duration:1, samples:4, curve }));
  const offsets = plans.map(plan => Exposure.schedule(plan,[plan.main],1)[0].entries.map(sample => sample.times[0] - 1));
  assert.deepEqual(offsets[0], [-.375,-.125,.125,.375]);
  assert(offsets[1][0] > offsets[0][0] && offsets[1][3] < offsets[0][3]);
  assert(offsets[2].every(offset => offset > 0));
  assert.throws(() => Exposure.prepare({ curve:[[0,0],[1,0]] }), /must open/);
  const stepped = Exposure.prepare({ duration:1, steps:2, samples:8 });
  assert.deepEqual(Exposure.schedule(stepped,[stepped.main],1)[0].entries,
    [{ times:[.75],weight:.5 }, { times:[1.25],weight:.5 }]);
  const scan = Exposure.prepare({ rolling:{ duration:.6,bands:2,direction:'right' } });
  const buffer = Exposure.accumulate(4, 1, 1, scan);
  for (const [band, intensity] of [[0,32],[1,224]])
    buffer.add({ width:4,height:1,channels:1,data:new Uint8Array(4).fill(intensity) }, band, 1);
  assert.deepEqual(Array.from(buffer.finish().data), [32,32,224,224]);
  const light = Exposure.accumulate(1,1,4,Exposure.prepare(true));
  light.add({ width:1,height:1,channels:4,data:Uint8Array.of(255,255,255,255) },0,.5);
  light.add({ width:1,height:1,channels:4,data:Uint8Array.of(0,0,0,255) },0,.5);
  assert.deepEqual(Array.from(light.finish().data), [188,188,188,255]);
});

test('a material hold keeps its silhouette and occludes blurred geometry across the shutter', () => {
  const world = build({ two:true }), saved = world.data.slice(), reference = ink.render(world, view);
  const frame = ink.render(world, { ...view, shutter:{ duration:.7, samples:9,
    targets:[{ select:{ material:'jade' }, shutter:false }] }, passes:['splatId'] });
  assert(frame.shutter.samples > 1);
  assert(pixel(frame, center).every((value, channel) => Math.abs(value - pixel(reference, center)[channel]) <= 1));
  assert.equal(frame.passes.splatId[center], 2);
  for (let p = 0; p < width * height; p++) assert.equal(jade(frame, p), jade(reference, p));
  assert.notDeepEqual(frame.rgb, reference.rgb);
  assert.deepEqual(world.data, saved);
  assert.equal(world.clock, undefined);
});

test('rolling exposure skews moving geometry in opposite directions without blurring a held row', () => {
  const scene = build({ tall:true });
  const sample = direction => ink.render(scene, { ...view, shutter:{ curve:'hold', rolling:{ duration:.5,bands:8,direction } } });
  function xAt(frame, y) {
    const row = Array.from({length:width}, (_,x)=>x).filter(x=>pixel(frame,y*width+x)[0]>220);
    return row.reduce((sum,x)=>sum+x,0)/row.length;
  }
  const down = sample('down'), up = sample('up');
  assert(xAt(down, 15) + 5 < xAt(down, 33));
  assert(xAt(up, 15) > xAt(up, 33) + 5);
  assert.equal(down.shutter.samples, 8);
});

test('a named pass holds its own time and its downstream graph reads that exposure', () => {
  const graph = { passes:[
    { id:'stamp', type:'composite', isolated:true, layer:{ source:{ slot:'white' }, rect:[28,12,3,22] } },
    { id:'swing', type:'distortion', source:'stamp', offset:[-9,0], amplitude:[10,0], period:6, rate:1 },
    { id:'over', type:'composite', input:'scene', source:'swing' }
  ] };
  const world = build();
  const renderGraphInputs = { white: { width:1,height:1,channels:4,data:Uint8Array.of(255,255,255,255) } };
  const cfg = { ...view, renderGraph:graph, renderGraphInputs, renderGraphCapture:['swing','over'] };
  const nominal = ink.render(world, cfg);
  const late = ink.render(world, { ...cfg, t:1.25 });
  const exposed = ink.render(world, { ...cfg, shutter:{ curve:'hold', passes:{ swing:{ curve:'hold', offset:.25 } } } });
  assert.notDeepEqual(nominal.renderGraphPasses.swing.data, late.renderGraphPasses.swing.data);
  assert.deepEqual(exposed.renderGraphPasses.swing.data, late.renderGraphPasses.swing.data);
  assert.notDeepEqual(exposed.rgb, nominal.rgb);
  const chained = ink.render(world, { ...cfg, shutter:{ curve:'hold', passes:{
    over:{ curve:'hold', offset:-.25 }, swing:{ curve:'hold', offset:.25 }
  } } });
  const heldEarlier = ink.render(world, { ...cfg, t:.75, shutter:{ curve:'hold', passes:{
    swing:{ curve:'hold', offset:.5 }
  } } });
  assert.deepEqual(chained.renderGraphPasses.over.data, heldEarlier.renderGraphPasses.over.data);
  const retained = { passes:[...graph.passes, { id:'echo', type:'history', input:'over', select:{object:'lamp'} }] };
  assert.throws(() => ink.render(world, { ...cfg, renderGraph:retained, shutter:{ passes:{ echo:false } } }), /retained graph history/);
});

test('independent world sampling supports stateful snapshots without advancing the caller', () => {
  const world = build();
  world.anim.stateful = true;
  const options = { ...view, shutter:{ duration:.5,samples:4 } };
  assert.throws(() => ink.render(world, options), /requires a shutterWorld/);
  const times = [];
  const frame = ink.render(world, { ...options, shutterWorld(time) {
    times.push(time);
    const snapshot = build();
    snapshot.anim.update(0,time);
    return snapshot;
  } });
  assert.deepEqual(times, [1,.8125,.9375,1.0625,1.1875]);
  assert.equal(frame.shutter.samples, 4);
  assert.equal(world.clock, undefined);
  assert.equal(world.data[0], 0);
});
