const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const kit = ink.load(), P = kit.KIT.procedural;
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
const color = (rgba, width = 4, height = 1) => P.raster.canvas({ width, height, color: rgba });
const row = (...data) => ({ width: data.length, height: 1, channels: 1, data });
const pixel = (value, index) => [...value.data.slice(index * 4, index * 4 + 4)];
const node = (id, port) => ({ node: id, ...(port && { port }) });

test('an opt-in bank retains real observations and protects history from caller edits', () => {
  const settings = { fps: 4, regions: [{ every: 2 }], refresh: 'brush' };
  const bank = P.frameBanks.create({ ...settings, history: 2 });
  const start = bank.sample(color(red), 5);
  const masks = { brush: row(255, 0, 255, 0) };
  const mixed = bank.sample(color(green), 5.125, { masks });
  assert.deepEqual(mixed.history.times, [0, .125]);
  assert.deepEqual(pixel(mixed.history.frames[1], 1), red);
  assert.deepEqual(pixel(mixed.history.frames[1], 2), green);
  mixed.value.data[0] = 200;
  mixed.history.frames[1].data[1] = 0;
  assert.deepEqual(bank.sample(color(blue), 5.125), bank.sample(color(red), 5.125));
  assert.deepEqual(pixel(mixed.history.frames[1], 0), green);
  assert.throws(() => bank.sample(color(blue), 5.25), /brush/);
  const recent = bank.sample(color(blue), 5.75, { masks }).history;
  assert.deepEqual([recent.origin, ...recent.times], [5.125, 0, .625]);
  assert.deepEqual(pixel(recent.frames[1], 1), blue);
  assert.deepEqual(start.history.times, [0]);
  assert.deepEqual(bank.sample(color(red), 5.25).history.times, [0]);
  assert.deepEqual(bank.sample(color(green, 3), 6).history.times, [0]);
  assert.deepEqual(bank.sample(color(blue, 3), 6, { reset: true }).history.times, [0]);
  assert.deepEqual(bank.sample(color(blue, 3), 6).history.frames[0].data, color(blue, 3).data);
  bank.clear();
  assert.equal(bank.sample(color(blue), 6).history.frames.length, 1);
  assert.equal(P.frameBanks.create(settings).sample(color(red), 0).history, null);
  assert.throws(() => P.frameBanks.create({ ...settings, history: 513 }), /capacity/);
  assert.throws(() => P.frameBanks.create({ ...settings, history: 512 }).sample(color(red, 256, 256), 0), /budget/);
});

test('coverage blends times, depth validity falls back to the clock, and motion magnitude can drive delays', () => {
  const { timeRemap } = P.rasterWarp;
  const frames = [color(red), color(green), color(blue)];
  const history = { frames, origin: 5, times: [0, 1, 2] };
  const mask = row(0, 127.5, 255, 255), valid = row(255, 255, 255, 0);
  const remapped = timeRemap(history, row(1e9, 0, 0, 1e9), { time: 7, mask, valid, scale: 2, mode: 'absolute' });
  assert.deepEqual([0, 1, 2, 3].map(i => pixel(remapped, i)), [blue, green, red, blue]);
  const motion = { width: 4, height: 1, channels: 2, data: new Float32Array([0,0, 3,-4, -6,8, 3,4]) };
  const lag = timeRemap(history, motion, { time: 7, channel: 'magnitude', scale: -.2, valid });
  assert.deepEqual([0, 1, 2, 3].map(i => pixel(lag, i)), [blue, green, red, blue]);
  assert.throws(() => timeRemap(history, motion, { mask: row(1, 2) }), /aligned/);
  assert.throws(() => timeRemap(history, motion, { valid: row(0, 0, 0, 256) }), /finite samples/);
  assert.throws(() => timeRemap(history, row(0), { channel: 'magnitude' }), /two-channel/);
});

test('masked time maps consume aligned native depth and validity on non-geometry pixels', () => {
  const builder = kit.makeBuilder(18, [0x142638, 0xdd7436]);
  builder.disc(0, 0, 0, [0, 0, 1], .5, .04, builder.P[1], 3);
  const world = builder.finish({ radius: 2, cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4 } });
  const render = ink.renderGraphScene(world, { channels: ['depth'], options: { width: 32, height: 24, raw: true }, kit });
  const depth = ink.graphRenderPass(render.frame, 'depth', { kit });
  const frames = [color(red, 32, 24), color(blue, 32, 24)];
  const value = P.rasterWarp.timeRemap(frames, depth.data, { fps: 1, time: 1, scale: -.5, valid: depth.valid });
  const present = Array.from(depth.valid.data).findIndex(n => n !== 0);
  const empty = depth.valid.data.indexOf(0);
  assert(present >= 0 && empty >= 0);
  assert.deepEqual(pixel(value, present), red);
  assert.deepEqual(pixel(value, empty), blue);
});

test('a graph clip retimes bank history under a moving ID mask and clears it on cuts', () => {
  const colors = [red, green, blue, [255, 255, 255, 255]];
  const frames = colors.map(rgba => ({ width: 2, height: 1, channels: 4, data: [...rgba, ...rgba] }));
  const labels = colors.map((_, i) => ({ width: 2, height: 1, channels: 1,
    data: [i % 2 ? 0 : 513, i % 2 ? 513 : 0] }));
  const project = ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1, nodes: {
    source: { op: 'anim.frame', inputs: { frames, options: { fps: 4 } } },
    labels: { op: 'anim.frame', inputs: { frames: labels, options: { fps: 4 } } },
    match: { op: 'raster.math', inputs: { a: node('labels'), b: 513, op: 'equal' } },
    mask: { op: 'raster.math', inputs: { a: node('match'), b: 255, op: 'multiply' } },
    bank: { op: 'anim.frameBank', inputs: { source: node('source'), options: { history: 4, fps: 4, regions: [{}] } } },
    remap: { op: 'warp.timeRemap', inputs: { history: node('bank', 'history'), mask: node('mask'), map: row(-.25, -.25) } }
  }, outputs: { value: node('remap') } }, { kit });
  const { artifacts } = project.clip({ output: 'value', to: 4, format: 'frames',
    clock: { fps: 4, cuts: [{ frame: 2, id: 'new scene' }] } });
  const raster = require('../cli/png.js').raster;
  assert.deepEqual(artifacts.map(({ bytes }) => [...raster(bytes).data]),
    [[...red, ...red], [...green, ...red], [...blue, ...blue], [...colors[3], ...blue]]);
});
