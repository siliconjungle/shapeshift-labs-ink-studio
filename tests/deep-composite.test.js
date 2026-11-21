const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder, SpriteSurface, TexturedSurface } = ink.load();

const w = 49, h = 37, center = Math.floor(h / 2) * w + Math.floor(w / 2);
const view = { w, h, px: 1, raw: true, deepComposite: { layers: 6 } };
function stack({ blocker = false, fog = true, panes = 1 } = {}) {
  const B = makeBuilder(1, [0x142638, 0xe7ba6c, 0x3ebedb, 0xea613f, 0xffffff]);
  function disc(z, palette, opacity, object, flags = {}, radius = 1.1) {
    const first = B.count();
    B.disc(0, 0, z, [0, 0, 1], radius, .01, B.P[palette], opacity, flags);
    B.describeSplats(first, B.count(), { object, material: object + '-material' });
  }
  disc(-1, 1, 2, 'dial', {}, 2.1);
  for (let i = 0; i < panes; i++) disc(.6, 2, .55, 'pane', { gl: true, nd: true });
  disc(1.1, 3, .35, 'fleck');
  if (blocker) disc(1.7, 4, 2, 'shutter');
  const atmosphere = fog ? [K.atmosphere.box({ min: [-2,-2,-.9], max: [2,2,.3], density: .55, color: '#eef1df' })] : [];
  return B.finish({ cam: { target:[0,0,0], dist:4, yaw:0, pitch:0, ortho:true },
    atmosphere, radius:4, refract:0, look: { splatCoverage:'continuous' } });
}
const at = (raster, p = center) =>
  Array.from(raster.data.subarray(p * raster.channels, (p + 1) * raster.channels));

test('sorted fragment IDs, depth, and volume transfer survive behind glass', () => {
  const world = stack(), frame = ink.render(world, view);
  assert.equal(ink.render(world, { ...view, deepComposite: false }).deep, undefined);
  assert.equal(frame.deep.count[center], 3);
  const front = ink.graphDeepLayer(frame), pane = ink.graphDeepLayer(frame, { rank: 1 });
  const dial = ink.graphDeepLayer(frame, { view:'transmitted', material:'dial-material' });
  assert.deepEqual([front, pane, dial].map(layer => layer.report.objects[at(layer.ids)[2]]), ['fleck', 'pane', 'dial']);
  assert.deepEqual(at(pane.ids).slice(0, 2), [pane.report.kinds.glass, 2]);
  assert(at(front.depth)[0] < at(pane.depth)[0]);
  assert(at(pane.depth)[0] < at(dial.depth)[0]);
  assert(at(front.transmission)[0] > .99);
  assert(at(dial.transmission)[0] < .8);
  assert(at(dial.scatter)[0] > .15);
  assert.notDeepEqual(at(dial.value), at(dial.surface));
  assert(at(dial.mask)[0] > 0 && at(dial.mask)[0] < at(dial.value)[3] / 255);
  const obscured = ink.render(stack({ blocker:true }), view);
  assert.deepEqual(at(ink.graphDeepLayer(obscured, { view:'transmitted' }).valid), [0]);
  const limited = ink.render(world, { ...view, deepComposite: { layers: 1 } });
  assert.equal(limited.deep.count[center], 3);
  assert.deepEqual(at(ink.graphDeepLayer(limited, { rank: 1 }).valid), [0]);
  assert.deepEqual(limited.rgb, frame.rgb);
  assert.throws(() => ink.render(world, { ...view, fragmentBudget: 2 }), /fragment budget/);
  assert.throws(() => ink.render(world, { ...view, w: 500, h: 500, deepComposite: { layers: 16 } }), /slot budget/);
});

test('coincident dabs retain the rear hit without changing surface coverage', () => {
  const world = stack({ fog:false, panes:5 });
  const options = { ...view, deepComposite:{ layers:3 } };
  const grouped = ink.render(world, options);
  const individual = ink.render(world, { ...options, deepComposite:{ layers:3, coalesce:false } });
  assert.equal(grouped.deep.count[center], 3);
  assert.equal(individual.deep.count[center], 7);
  assert.equal(at(ink.graphDeepLayer(grouped, { view:'transmitted' }).valid)[0], 255);
  assert.equal(at(ink.graphDeepLayer(individual, { view:'transmitted' }).valid)[0], 0);
  assert.deepEqual(grouped.rgb, individual.rgb);
});

test('glass addressing follows the eligible refracted donor at pane edges', () => {
  const world = stack({ fog:false });
  world.refract = 48;
  const frame = ink.render(world, view);
  const routed = ink.graphDeepLayer(frame, { view:'transmitted', object:'dial' });
  const dial = ink.graphDeepLayer(frame, { object:'dial' });
  let count = 0;
  for (let p = 0; p < frame.deep.donor.length; p++) {
    const donor = frame.deep.donor[p];
    if (donor < 0 || !routed.valid.data[p]) continue;
    assert.equal(routed.ids.data[p * 4 + 1], dial.ids.data[donor * 4 + 1]);
    assert.equal(routed.depth.data[p], dial.depth.data[donor]);
    count++;
  }
  assert(count > 3);
});

test('reflected fragments reach water pixels through the sampled plane and stop at foreground geometry', () => {
  const B = makeBuilder(4, [0x111928, 0xe85a39, 0x78e8ec]);
  B.disc(0, 1, -2, [0,0,1], .8, .01, B.P[1], 1);
  B.describeSplats(0, B.count(), { object: 'beacon' });
  const terrain = SpriteSurface.make();
  terrain.mesh(TexturedSurface.heightfield({ bounds:[-2,2,-3,2], segments:[1,1], height:()=>-.8 }), 1, 1, () => 0x181e2c);
  const pool = K.procedural.waterBodies.create({ id:'lake', bounds:{ min:[-2,-3], max:[2,2] }, resolution:[16,16],
    sample:()=>({ bed:-1, surface:0 }), optics:{ tint:[0,0,0], extinction:[0,0,0], surfaceColor:[1,1,1],
      surface:1, refraction:0, foam:0, caustics:0, reflection:{ plane:'mirror', distortion:2, blur:.5 } } });
  const world = B.finish({ spriteSurfaces:terrain.finish(), water:K.procedural.waterBodies.scene([pool]), radius:8,
    cam:{ target:[0,0,0], dist:Math.sqrt(45), pitch:Math.atan(.5), yaw:0 }, reflections:[K.reflection.plane({ id:'mirror' })] });
  const options = { ...view, w: 73, h: 63, deepComposite: { layers:4, reflections:['mirror'] } };
  const frame = ink.render(world, options);
  const reflected = ink.graphDeepLayer(frame, { view:'reflected', plane:'mirror', object:'beacon' });
  const capture = ink.graphDeepLayer(frame, { view:'reflection', plane:'mirror', object:'beacon' });
  assert(capture.valid.data.some(Boolean));
  assert(reflected.mask.data.some(value => value > .05));
  let shifted = 0;
  const route = frame.deep.reflections.mirror;
  for (let p = 0; p < route.source.length; p++) if (reflected.valid.data[p] && route.source[p] !== p) shifted++;
  assert(shifted > 3);
  assert.deepEqual(ink.graphDeepLayer(ink.render(world, { ...options, reflections:false }),
    { view:'reflected', plane:'mirror' }).mask.data, new Float32Array(options.w * options.h));
  const sprite = ink.graphDeepLayer(frame, { kind:'sprite' });
  assert(sprite.mask.data.some(Boolean));
});

test('a deep layer and its optical mask feed ordinary CLI graph operations', () => {
  const link = (node, port = 'value') => ({ node, port });
  const project = ink.createGraphProject({ format:'ink-studio/graph-project', version:1, nodes: {
    world: { op:'fixture' },
    scene: { op:'scene.render', inputs: { source:link('world'), options:{ width:w, height:h, raw:true, deepComposite:true } } },
    rear: { op:'scene.deepLayer', inputs: { frame:link('scene','frame'), options:{ view:'transmitted', object:'dial' } } },
    mask: { op:'raster.resize', inputs: { source:link('rear','mask'), options:{ width:11, height:7 } } }
  }, outputs: { rear:link('rear'), depth:link('rear','depth'), mask:link('mask') } },
  { operations:{ fixture:{ outputs:{ value:'world' }, run:()=>({ value:stack({ fog:false }) }) } } });
  const { outputs } = project.run();
  assert.deepEqual(at(outputs.rear), [231,186,108,255]);
  assert(at(outputs.depth)[0] > 4);
  assert.equal(outputs.mask.width, 11);
});

test('a render graph mask reads the transmitted geometry on the same render', () => {
  const world = stack({ fog:false });
  const options = { ...view, deepComposite: { slots:{ behind:{ view:'transmitted', object:'dial', channel:'mask' } } },
    renderGraph:{ passes:[
      { id:'behind-glass', type:'mask', raster:{ slot:'behind', range:[0,1] } }
    ] }, renderGraphCapture:['behind-glass'] };
  const frame = ink.render(world, options);
  const picked = ink.graphDeepLayer(frame, { view:'transmitted', object:'dial' });
  assert.equal(frame.renderGraphPasses['behind-glass'].data[center], Math.round(picked.mask.data[center] * 255));
  assert(frame.renderGraphPasses['behind-glass'].data[center] > 0);
});
