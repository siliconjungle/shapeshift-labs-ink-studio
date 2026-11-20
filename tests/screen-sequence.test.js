const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load();

function smallScene({ KIT, makeBuilder }, mode = 'hold') {
  const builder = makeBuilder(3, [0x070e18, 0xff0000, 0x00ff00, 0xffff00]);
  for (const [i, [x, z, name]] of [[-.7, 0, 'relay'], [.7, 0, 'beacon'], [-3, .35, 'foreground']].entries()) {
    builder.disc(x, 0, z, [0, 0, 1], .45, .04, builder.P[i + 1], 3);
    builder.describeSplats(i, i + 1, { object: name });
  }
  const world = builder.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 3,
    look: { composite: { world: { resolution: [18, 12] } } } });
  const paint = { id: 'blue', type: 'composite', enabled: false, select: { object: 'relay' },
    layer: { draw: [{ type: 'rect', rect: [0, 0, 36, 24], color: '#0000ff' }] } };
  const editor = KIT.renderGraph.create({ passes: [
    paint, { id: 'shutter', type: 'mask' },
    { id: 'memory', type: 'history', mode, halfLife: 1, select: { object: 'relay' }, mask: 'shutter' }
  ] });
  const revealer = KIT.renderGraph.create({ passes: [
    { id: 'beam', type: 'mask', volume: { at: [-.7, 0, 0], extent: [.64, 1, 1] } },
    { id: 'darkness', type: 'mask', mask: 'beam', invert: true },
    { id: 'shade', type: 'composite', mask: 'darkness', layer: {
      draw: [{ type: 'rect', rect: [0, 0, 36, 24], color: '#000000' }]
    } }
  ] });
  return { world, editor, revealer };
}

const pixel = (frame, x, y) => Array.from(frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3));
const opts = { w: 36, h: 24, raw: true, outline: false };
const relay = [11, 12], beacon = [24, 12];

test('screen hold is captured once, scoped by visible owner, and resets on a seek or graph bypass', () => {
  const { world, editor } = smallScene(kit), memory = kit.KIT.renderGraph.history();
  const draw = (t, options) => ink.render(world, { ...opts, t, renderHistory: memory, renderGraph: editor, ...options });
  const first = draw(0);
  editor.update('blue', { enabled: true });
  editor.update('shutter', { enabled: false });
  let output = draw(.2);
  assert.deepEqual(pixel(output, ...relay), pixel(first, ...relay));
  assert.deepEqual(pixel(output, ...beacon), pixel(first, ...beacon));
  world.data[32] = -.7;
  output = draw(.3);
  assert.deepEqual(pixel(output, ...relay), pixel(draw(.3, { renderHistory: undefined, renderGraph: false }), ...relay));
  assert(pixel(output, ...relay)[1] > 245);
  world.data[32] = -3;
  assert.deepEqual(pixel(draw(.4), ...relay), pixel(first, ...relay));
  assert.deepEqual(pixel(draw(.1), ...relay), [0, 0, 255]);

  editor.update('blue', { enabled: false });
  editor.update('shutter', { enabled: true });
  draw(.5);
  editor.update('blue', { enabled: true });
  editor.update('shutter', { enabled: false });
  assert.deepEqual(pixel(draw(.6, { resetRenderHistory: true }), ...relay), [0, 0, 255]);
  editor.update('shutter', { enabled: true });
  editor.update('blue', { enabled: false });
  draw(.7);
  draw(.75, { renderGraph: false });
  editor.update('blue', { enabled: true });
  editor.update('shutter', { enabled: false });
  assert.deepEqual(pixel(draw(.8), ...relay), [0, 0, 255]);
});

test('persistence decays in scene seconds and camera cuts obey the history policy', () => {
  for (const keep of [false, true]) {
    const { world, editor } = smallScene(kit, 'persistence'), history = kit.KIT.renderGraph.history();
    if (keep) editor.update('memory', { cameraMotion: 'keep' });
    const draw = (t, yaw) => ink.render(world, { ...opts, t, yaw, renderHistory: history, renderGraph: editor });
    draw(0, 0);
    editor.update('blue', { enabled: true });
    editor.update('shutter', { enabled: false });
    const half = draw(1, 0), resample = draw(1, 0);
    assert.deepEqual(half.rgb, resample.rgb);
    const color = pixel(half, ...relay);
    assert(color[0] >= 120 && color[0] <= 129 && color[2] >= 125 && color[2] <= 132, color);
    const cut = pixel(draw(1.1, .014), ...relay);
    if (keep) assert(cut[0] > 90 && cut[2] > 120, cut);
    else assert.deepEqual(cut, [0, 0, 255]);
  }
  assert.throws(() => kit.KIT.renderGraph.prepare({ passes: [{ id: 'any', type: 'history' }] }), /target selector/);
});

test('world volume masks use native depth at mixed resolution and keep requested passes', () => {
  const { world, revealer } = smallScene(kit);
  const draw = () => ink.render(world, { ...opts, renderGraph: revealer, passes: ['objectId'] });
  const left = draw();
  assert(pixel(left, ...relay)[0] > 240, pixel(left, ...relay));
  assert.deepEqual(pixel(left, ...beacon), [0, 0, 0]);
  assert.deepEqual(left.worldSize, [18, 12]);
  assert.deepEqual(Object.keys(left.passes).sort(), ['h', 'objectId', 'objects', 'w']);
  revealer.update('beam', { volume: { at: [.7, 0, 0], extent: [.64, 1, 1] } });
  const right = draw();
  assert.deepEqual(pixel(right, ...relay), [0, 0, 0]);
  assert(pixel(right, ...beacon)[1] > 240, pixel(right, ...beacon));
});

test('WebGL preserves selected history and reveals world-space targets without CPU readback', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const report = runWebGL({}, smallScene, (kit, fixture, backend) => {
    const { world, editor, revealer } = fixture(kit);
    const draw = backend(36, 24, { raw: true, outline: false, offscreen: true });
    const pick = () => draw.sample({ relay: [11, 12], beacon: [24, 12] });
    const frame = (t, renderGraph, settings) => draw.draw(world, { time: t, renderGraph, ...settings });
    try {
      frame(0, editor);
      const first = pick();
      editor.update('blue', { enabled: true });
      editor.update('shutter', { enabled: false });
      frame(.1, editor);
      const hold = pick();
      world.data[32] = -.7;
      frame(.2, editor, { changedRows: [0] });
      const occluded = pick();
      world.data[32] = -3;
      frame(.3, editor, { changedRows: [0], resetRenderHistory: true });
      const reset = pick();
      editor.update('blue', { enabled: false });
      editor.update('shutter', { enabled: true });
      editor.update('memory', { mode: 'persistence' });
      frame(0, editor);
      editor.update('blue', { enabled: true });
      editor.update('shutter', { enabled: false });
      frame(1, editor);
      const half = pick();
      frame(0, revealer);
      const left = pick();
      revealer.update('beam', { volume: { at: [.7, 0, 0], extent: [.64, 1, 1] } });
      frame(1, revealer);
      const right = pick();
      return { first, hold, occluded, reset, half, left, right };
    } finally { draw.close(); }
  });
  assert.deepEqual(report.hold, report.first);
  assert(report.occluded.relay[0] > 240 && report.occluded.relay[1] > 240, JSON.stringify(report));
  assert.deepEqual(report.reset.relay, [0, 0, 255]);
  assert(report.half.relay[0] >= 120 && report.half.relay[0] <= 129 && report.half.relay[2] >= 125, JSON.stringify(report));
  assert(report.left.relay[0] > 240);
  assert.deepEqual(report.left.beacon, [0, 0, 0]);
  assert.deepEqual(report.right.relay, [0, 0, 0]);
  assert(report.right.beacon[1] > 240);
});

test('named presentation channels follow reusable clip timing, camera and audio on the scene clock', () => {
  const { KIT: K } = kit;
  const source = require('../examples/signal-observatory.json');
  const world = K.diorama.build(source);
  const settingsAt = t => K.presentationTimeline.sample(world, t);
  const first = settingsAt(1.38), returned = settingsAt(6.28);
  const wave = frame => frame.renderGraph.passes.find(pass => pass.id === 'wave');
  assert(Math.abs(wave(first).volume.at[0] - wave(returned).volume.at[0]) < 1e-9);
  const target = first.inspection.targets.find(row => row.id === 'relay-callout');
  assert.equal(target.active, true);
  assert.equal(target.magnify.enabled, true);
  assert.equal(target.detail, 'PULSE FOUND');
  assert.equal(settingsAt(.8).inspection.targets[0].magnify.enabled, false);
  assert.equal(K.presentationTimeline.sample(world, 1, { inspection: false }).inspection, undefined);
  assert(world.timeline.between(4.9, 7).some(cue => cue.type === 'audio' &&
    cue.cue === 'signal.relay-pulse' && cue.path[0] === 'return-sweep'));
  assert(world.timeline.sample(3.15).audio.some(cue => cue.cue === 'signal.carrier'));
  world.anim.update(0, 0);
  world.anim.update(0, 3.4);
  assert(world.cam.yaw > -0.17 && world.cam.yaw < -0.04);
  const frame = ink.render(world, { w: 270, h: 160, px: 1, t: 3.4 });
  assert(frame.inspection.targets.some(row => row.id === 'receiver-callout' && row.visibility > .5));
  assert.throws(() => K.diorama.build({ ...source, timeline: { tracks: [
    { target: '/renderGraph/unknown/opacity', keys: [{ time: 0, value: 1 }] }
  ] } }), /Unsupported timeline target/);
});

test('simulation snapshots expose the same named presentation channels', () => {
  const { KIT: K } = kit;
  const world = { id: 'sequence-world', dt: .25, timeline: { tracks: [
    { target: '/renderGraph/reveal/volume/at', keys: [{ time: 0, value: [0, 0, 0], ease: 'linear' }, { time: 1, value: [4, 0, 0] }] }
  ] }, visual: { look: { renderGraph: { passes: [
    { id: 'reveal', type: 'mask', volume: { at: [0,0,0], extent: [1,1,1] } },
    { id: 'screen', type: 'distortion', offset: [1,0], mask: 'reveal' }
  ] } } } };
  const run = K.world.runtime.create(world);
  run.advance(2);
  const frame = K.world.visual(kit, run.view(), run.query());
  const { renderGraph } = K.presentationTimeline.sample(frame, .5);
  assert.deepEqual(renderGraph.passes[0].volume.at, [2, 0, 0]);
});
