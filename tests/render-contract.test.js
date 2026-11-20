const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT;

const close = (a, b, tolerance = 1e-7) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert(Math.abs(a[i] - b[i]) <= tolerance, [a[i], b[i]].join(' / '));
};
const fixedColor = rgb => ({
  name: 'Contract swatch',
  steps: [{ type: 'channelMix', matrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], offset: rgb }]
});

function fixture(api) {
  const { KIT: K, makeBuilder } = api;
  const palette = [0x182536, 0x606060, 0xcccccc, 0x52ba9b];
  const builder = makeBuilder(8, palette);
  const swatch = rgb => ({
    name: 'Contract swatch',
    steps: [{ type: 'channelMix', matrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], offset: rgb }]
  });
  const lookId = 'contract/led';
  const packs = K.authoring.assetPacks.create({ packs: [{ format: 'ink-studio/asset-pack', id: 'contract',
    title: 'Contract', version: 1, revision: 1, looks: [{ id: lookId, label: 'Sensor', stage: 'lit', stack: swatch([1, .55, .08]) }] }] });
  const look = K.authoring.looks.scene({ artDirection: { cadence: { scene: 4, environment: 2, rain: 5, water: 8 } },
    renderStages: [
      { stage: 'material', stack: swatch([.16, .58, .92]), select: { entity: 'ceramic' } },
      { asset: { asset: lookId, strength: 0, inputs: { strength: { source: 'time', keys: [[0, 0], [1, 1]] } } },
        select: { entity: 'sensor' } }
    ] }, packs);
  for (const [i, id] of ['ceramic', 'sensor', 'control'].entries()) {
    builder.disc(-1 + i, 0, 0, [0, 0, 1], .29, .025, builder.P[1], 3);
    builder.describeAlbedo(i, i + 1, '#cccccc');
    builder.describeSplats(i, i + 1, { object: id, material: 'panel', target: { entity: id } });
  }
  const world = builder.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true }, look,
    fog: { c: 0, start: 1, max: 0 }, dither: 0, radius: 8 });
  return world;
}

test('the same clock and camera sample drive the headless camera and WebGL projection', async () => {
  const { makeCamera, cameraPose } = await import('../src/webgl/view.mjs');
  const world = fixture(kit), calls = [];
  world.timeDomains = K.timeDomains.create({ domains: { animation: { fps: 12 }, camera: { fps: 20 }, interface: { fps: 9 } } });
  world.timeDomains.advance(.583);
  const before = world.timeDomains.snapshot();
  world.cameraRig = { sample(time, options) {
    calls.push([time, options.shot]);
    return { camera: { target: [time, .2, 0], dist: 6, yaw: time + .1, pitch: .24,
      focalLength: 38, sensorHeight: 26, composition: [.37, .58], ortho: true } };
  } };
  world.anim = { zoom: 1.15, kick: [.07, -.04, .02] };
  const common = { w: 117, h: 89, px: 1, cameraShot: 'rail', lensScale: 1.18, zoom: 1.1,
    cameraStaging: { orbit: { yaw: [-.35, .35], pitch: [0, .2] } } };
  for (const extra of [{}, { projection: 'perspective', yaw: -.27, pitch: .14, target: [.11, .23, .35], time: .81 },
    { cameraTime: .33, focalLength: 52, composition: [.64, .37], ortho: true, lockCamera: true,
      stable: { snap: true, anchor: [.19, .32, -.22] } }]) {
    const frame = { ...common, ...extra };
    let cpuCamera;
    studio.render(world, { ...frame, cameraFrame: sample => { cpuCamera = sample; } });
    const browser = makeCamera(world, frame, frame.w, frame.h);
    const expected = studio.describeRenderFrame(world, frame);
    const posed = cameraPose(browser);
    for (const key of ['eye', 'right', 'up', 'back']) {
      close(cpuCamera.pose[key], posed[key]);
      close(cpuCamera.pose[key], expected.camera.pose[key]);
    }
    assert.equal(cpuCamera.time, expected.camera.time);
    assert.equal(browser.ortho, expected.camera.ortho);
    assert.equal(browser.clipNear, expected.camera.clipNear);
    assert.equal(browser.setback, 0);
    assert.equal(expected.clocks.scene, extra.time ? .75 : .5);
    assert.equal(expected.clocks.environment, .5);
    assert(calls.every(([, shot]) => shot === 'rail'));
  }
  assert.deepEqual(world.timeDomains.snapshot(), before);
});

test('frame descriptions expose effective palettes and flag material features outside the shared path', () => {
  const world = fixture(kit), frames = K.renderContract;
  world.anim = { grade: Float32Array.from(world.pal.flatMap(() => [1, 0, 1])) };
  const frame = { width: 96, height: 64, time: .83 };
  const baseline = studio.describeRenderFrame(world, frame);
  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.issues, []);
  assert.deepEqual(baseline.stages, ['material', 'lit']);
  assert.equal(baseline.paletteMode, 'stages');
  assert.deepEqual(baseline.palette, world.pal.map(() => 0xff00ff));
  assert.deepEqual(studio.describeRenderFrame(world, { ...frame, time: undefined, t: .83 }), baseline);
  assert.deepEqual(studio.describeRenderFrame(world, { ...frame, ignoreLookGrade: true }).palette, world.pal);
  const grade = { ...frame, ignoreLookGrade: true, colorStack: { name: 'Night', steps: [{ type: 'exposure', stops: -1 }] } };
  assert.notDeepEqual(studio.describeRenderFrame(world, grade).palette, world.pal);
  assert.deepEqual(studio.describeRenderFrame(world, { ...grade, colorStack: false }).palette, world.pal);
  assert.equal(baseline.clocks.scene, .75);
  assert.equal(baseline.clocks.environment, .5);
  assert.equal(baseline.clocks.rain, .8);
  const authored = [{ stage: 'frame', stack: fixedColor([0, 0, 1]) }];
  assert.deepEqual(frames.compatibility(world, { renderStages: authored }), ['post-stage']);
  assert.throws(() => studio.render(world, { ...frame, strictContract: true, renderStages: authored }), /post-stage/);
  const masks = [{ stage: 'lit', stack: fixedColor([1, 0, 0]), mask: { type: 'axis', axis: 'x', range: [-1, 1] } }];
  assert.deepEqual(frames.compatibility(world, { renderStages: masks }), ['spatial-stage-mask']);
  assert.deepEqual(frames.compatibility(world, { renderStages: false }), []);
  assert.deepEqual(frames.compatibility({ ...world, pal: new Array(65).fill(0) }, { renderStages: false }), ['palette-limit']);
  assert.deepEqual(frames.compatibility({ ...world, look: {}, surfaces: [{ settings: {
    layers: { paint: { type: 'projected', stage: 'material' } }
  } }] }), ['surface-finish']);

  const legacy = { ...world, look: { pixel: true } };
  assert.equal(frames.clock(legacy, { t: .83, stepAnimation: true }).scene, .8);
  assert.equal(frames.clock(legacy, { t: .83 }).scene, .83);
});

test('WebGL and headless apply shared material stages and palette grades at the same sample times', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const world = fixture(kit), opts = { w: 119, h: 85, px: 1, colored: false, outline: false, dither: 0 };
  const positions = { ceramic: [34, 42], sensor: [59, 42], control: [84, 42], background: [1, 1] };
  const palette = { renderStages: false, colorStack: { name: 'Dim', steps: [{ type: 'exposure', stops: -1 }] } };
  const stagePalette = { renderStages: [{ stage: 'lit', select: { entity: 'control' }, palette: { palette: ['#32c4ac'] } }] };
  const cases = [{ time: .31 }, { t: .48 }, { time: .78 }, palette, { renderStages: false }, stagePalette];
  const output = runWebGL({}, fixture, (kit, build, backend, input) => {
    const world = build(kit), view = backend(119, 85, { colored: false, outline: false, dither: 0, offscreen: true });
    const original = world.data.slice();
    try {
      const samples = input.cases.map(frame => {
        view.draw(world, { ...frame, strictContract: true });
        return view.sample(input.positions);
      });
      const off = world.data.every((n, i) => n === original[i]);
      return { samples, off };
    } finally { view.close(); }
  }, { cases, positions });
  const cpu = cases.map(frame => {
    const image = studio.render(world, { ...opts, ...frame, strictContract: true });
    return Object.fromEntries(Object.entries(positions).map(([id, [x, y]]) =>
      [id, Array.from(image.rgb.slice((y * image.w + x) * 3, (y * image.w + x) * 3 + 3))]));
  });
  for (let i = 0; i < cases.length; i++)
    for (const key of Object.keys(positions)) close(output.samples[i][key], cpu[i][key], 3);
  assert.deepEqual(cpu[0], cpu[1]);
  assert(cpu[2].sensor[0] > cpu[0].sensor[0] + 40);
  assert(cpu[0].ceramic[2] > cpu[0].ceramic[0] + 50);
  assert(cpu[3].control[0] < cpu[4].control[0]);
  close(cpu[5].control, [50, 196, 172], 2);
  assert(output.off);
});
