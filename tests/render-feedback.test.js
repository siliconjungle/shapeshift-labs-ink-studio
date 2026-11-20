const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const runWebGL = require('../cli/look-webgl');

function fixture({ makeBuilder, KIT }) {
  const world = makeBuilder(42, [0]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  let injections = 0;
  const layer = {
    resolution: [8, 6],
    source({ w, h, time }) {
      injections++;
      const rgba = new Uint8Array(w * h * 4);
      if (time === 0) {
        rgba.set([255, 0, 0, 255], (2 * w + 1) * 4);
        rgba.set([0, 0, 255, 255], (3 * w + 1) * 4);
        rgba.set([255, 255, 255, 255], (2 * w + 6) * 4);
      }
      return { w, h, rgba };
    }
  };
  const declaration = { passes: [
    { id: 'emitter', type: 'mask', rect: [0, 0, 3, 6] },
    { id: 'echo', type: 'feedback', layer, mask: 'emitter', filter: 'nearest', halfLife: 1,
      warp: { velocity: [2, 0] } }
  ] };
  return { world, declaration, graph: KIT.renderGraph.create(declaration), injections: () => injections };
}

const kit = ink.load();
const pixel = (img, x, y) => Array.from(img.rgb.subarray(3 * (y * img.w + x), 3 * (y * img.w + x) + 3));
const black = [0, 0, 0];
const view = { w: 8, h: 6, px: 1, raw: true };
function playback({ world, graph }) {
  const renderHistory = kit.KIT.renderGraph.history();
  return (t, override = {}) => ink.render(world, { ...view, t, renderGraph: graph, renderHistory, ...override });
}

test('feedback advects and fades its own signal after injection stops, with no same-time updates', () => {
  const scene = fixture(kit), render = playback(scene);
  const first = render(0);
  assert.deepEqual(pixel(first, 1, 2), [255, 0, 0]);
  assert.deepEqual(pixel(first, 6, 2), black);
  const next = render(1);
  assert.deepEqual(pixel(next, 1, 2), black);
  assert.deepEqual(pixel(next, 3, 2), [127, 0, 0]);
  assert.deepEqual(pixel(next, 3, 3), [0, 0, 127]);
  assert.deepEqual(render(1).rgb, next.rgb);
  assert.equal(scene.injections(), 2);
  assert.deepEqual(pixel(render(2), 5, 2), [63, 0, 0]);
  assert.deepEqual(pixel(render(2, { resetRenderHistory: true }), 5, 2), black);
  assert.deepEqual(pixel(render(0), 1, 2), [255, 0, 0]);
});

test('feedback supports earlier image branches, threshold, live warp edits and camera policies', () => {
  const { world, graph } = fixture(kit);
  const paint = { id: 'lamp', type: 'composite', layer: { draw: [
    { type: 'rect', rect: [1, 2, 1, 1], color: '#e00000' },
    { type: 'rect', rect: [1, 3, 1, 1], color: '#151515' }
  ] } };
  graph.replace({ passes: [paint, { id: 'echo', type: 'feedback', input: 'scene', source: 'lamp',
    threshold: [.2, .6], gain: .5, halfLife: 1, blend: 'over', filter: 'linear',
    warp: { velocity: [1.5, 0] } }] });
  const render = playback({ world, graph });
  assert.deepEqual(pixel(render(0), 1, 2), [112, 0, 0]);
  assert.deepEqual(pixel(render(0), 1, 3), black);
  graph.update('echo', { gain: 0 });
  assert.deepEqual(pixel(render(1), 2, 2), [28, 0, 0]);
  assert.deepEqual(pixel(render(1), 3, 2), [28, 0, 0]);
  assert.deepEqual(pixel(render(2, { yaw: .4 }), 3, 2), black);

  const scene = fixture(kit), keep = playback(scene);
  scene.graph.update('echo', { cameraMotion: 'keep' });
  keep(0);
  assert.deepEqual(pixel(keep(1, { yaw: .4 }), 3, 2), [127, 0, 0]);
  scene.graph.update('echo', { enabled: false });
  assert.deepEqual(pixel(keep(2), 5, 2), black);
  scene.graph.update('echo', { enabled: true });
  assert.deepEqual(pixel(keep(2), 5, 2), black);
  assert.throws(() => scene.graph.update('echo', { source: 'scene' }), /image source or an emission layer/);
  assert.throws(() => scene.graph.update('echo', { warp: { zoom: 0 } }), /positive zoom/);
});

test('fixed replay captures the same ticks regardless of presentation rate or trim', () => {
  const { replay } = kit.KIT.renderGraph, clock = replay({ fps: 4, cuts: [.6] }), ticks = [];
  const draw = (t, reset) => (ticks.push([t, reset]), t);
  assert.equal(clock.sample(.61, draw), .5);
  assert.equal(clock.sample(.67, draw), .5);
  assert.equal(clock.sample(1.2, draw), 1);
  assert.deepEqual(ticks, [[0, true], [.25, false], [.5, false], [.75, true], [1, false]]);
  ticks.length = 0;
  assert.equal(clock.sample(.5, draw), .5);
  assert.deepEqual(ticks, [[0, true], [.25, false], [.5, false]]);
  assert.throws(() => replay({ fps: 0 }), /rate/);
  assert.throws(() => replay({ fps: 4, maxSteps: 2 }).sample(1, draw), /step budget/);
});

test('CLI feedback clips preroll from the scene origin and hold fixed steps between output frames', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-feedback-'));
  try {
    const scene = path.join(directory, 'scene.js');
    fs.writeFileSync(scene, `module.exports = kit => {
      const f = (${fixture})(kit);
      f.graph.update('echo', { warp: { velocity: [4, 0] }, mask: undefined });
      f.world.look = { renderGraph: f.graph };
      return { id: 'pulse', build: () => f.world };
    };`);
    const result = [];
    for (const [fps, cut] of [[4], [11], [4, '1']]) {
      const out = path.join(directory, 'clip-' + fps + (cut ?? '') + '.png');
      execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'clip', scene,
        '--from', '1', '--to', '1.5', '--fps', String(fps), '--feedback-fps', '4', '--raw',
        '--w', '8', '--h', '6', '--out', out, ...(cut ? ['--feedback-cuts', cut] : [])], { stdio: 'pipe' });
      result.push(require('../cli/png').read(out));
    }
    assert.deepEqual(result[0].rgb, result[1].rgb);
    const retained = pixel(result[0], 5, 2);
    assert(retained[0] > 115 && retained[0] < 130 && retained[1] === 0);
    assert.deepEqual(pixel(result[2], 5, 2), black);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('WebGL ping-pongs feedback, preserves the held timestamp and resets explicitly', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, build, backend) => {
    const { world, graph } = build(kit), gpu = backend(8, 6, { raw: true, offscreen: true });
    const sites = { source: [1, 2], echo: [3, 2], blue: [3, 3] };
    try {
      const draw = (time, resetRenderHistory) => {
        gpu.draw(world, { time, renderGraph: graph, resetRenderHistory });
        return gpu.sample(sites);
      };
      return { first: draw(0), decay: draw(1), held: draw(1), cut: draw(1, true), rewind: draw(0) };
    } finally {
      gpu.close();
    }
  });
  assert.deepEqual(result.first.source, [255, 0, 0]);
  assert.deepEqual(result.decay, { source: black, echo: [127, 0, 0], blue: [0, 0, 127] });
  assert.deepEqual(result.held, result.decay);
  assert.deepEqual(result.cut, { source: black, echo: black, blue: black });
  assert.deepEqual(result.rewind, result.first);
});
