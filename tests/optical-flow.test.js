const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { rasterWarp: W, graph } = KIT.procedural;

const texture = (x, y) => .5 + .13 * Math.sin(.32 * x + .21 * y) + .08 * Math.sin(.62 * x - .41 * y) +
  .13 * Math.cos(.13 * x - .37 * y) + .1 * Math.sin(.2 * x) * Math.cos(.56 * y);
const image = (width, height, draw) => ({ width, height, channels: 1,
  data: Float32Array.from({ length: width * height }, (_, p) => draw(p % width, Math.floor(p / width))) });
const flow = (width, height, u, v) => ({ width, height, channels: 2,
  data: Float32Array.from({ length: width * height * 2 }, (_, i) => i % 2 ? v : u) });
const normalized = { sampleRange: [0, 1] };
const close = (actual, expected, tolerance) =>
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < tolerance,
    `Expected ${expected} ± ${tolerance}, got ${actual}`);

test('dense flow resolves signed subpixel and multiscale shifts in both directions', () => {
  const width = 91, height = 71, before = image(width, height, texture);
  for (const [dx, dy] of [[.7, -1.3], [13.4, 5.6], [-12, -7]]) {
    const after = image(width, height, (x, y) => texture(x - dx, y - dy));
    const forward = W.opticalFlow(before, after, normalized);
    const reverse = W.opticalFlow(before, after, { ...normalized, direction: 'backward' });
    const point = [42.5, 32.5];
    close(W.flowSampler(forward.value)(...point), [dx, dy], .28);
    close(W.flowSampler(reverse.value)(point[0] + dx, point[1] + dy), [-dx, -dy], .28);
    assert.ok(forward.confidence.data[32 * width + 42] > .4);
    assert.equal(forward.value.data.length, width * height * 2);
    assert.equal(forward.confidence.data.length, width * height);
  }
});

test('regions moving in opposite directions keep distinct flow, with lower confidence in the flat gap', () => {
  const width = 105, height = 77;
  const frame = (a, b) => image(width, height, (x, y) => y < 30 ? texture(x - a, y) :
    y > 48 ? texture(x - b + 13, y + 5) : .055);
  const result = W.opticalFlow(frame(0, 0), frame(4.2, -3.5), normalized);
  const read = W.flowSampler(result.value);
  close(read(47.5, 15.5), [4.2, 0], .35);
  close(read(47.5, 62.5), [-3.5, 0], .35);
  assert.ok(result.confidence.data[15 * width + 47] > .3);
  assert.equal(result.confidence.data[39 * width + 47], 0);
  assert.deepEqual(W.flowSampler(result.value, result)(47.5, 39.5), [0, 0]);
});

test('still, transparent and degenerate rasters return finite estimates and respect motion limits', () => {
  const flat = image(1, 9, () => .1);
  const still = W.opticalFlow(flat, flat, normalized);
  assert.ok(still.value.data.every(value => value === 0));
  assert.ok(still.confidence.data.every(value => value === 0));
  const hidden = { width: 12, height: 9, channels: 4,
    data: Uint8Array.from({ length: 12 * 9 * 4 }, (_, i) => i % 4 === 3 ? 0 : (i * 71) % 255) };
  const seen = W.opticalFlow(hidden, { ...hidden, data: new Uint8Array(hidden.data.length) });
  assert.ok(seen.value.data.every(value => value === 0));
  assert.ok(seen.confidence.data.every(value => value === 0));
  const cap = .5;
  const bounded = W.opticalFlow(image(29, 23, texture), image(29, 23, (x, y) => texture(x - 3, y + 1)),
    { ...normalized, maxMotion: cap });
  for (let i = 0; i < bounded.value.data.length; i += 2)
    assert.ok(Math.hypot(bounded.value.data[i], bounded.value.data[i + 1]) <= cap + 1e-6);
  assert.throws(() => W.opticalFlow(flat, hidden), /matching raster/);
  assert.throws(() => W.opticalFlow(flat, flat, { sampleRange: [0, 0] }), /solver settings/);
});

test('backward flow transports alpha-correct marks and forward flow advances particles with confidence gating', () => {
  const source = KIT.procedural.raster.canvas({ width: 8, height: 3 });
  source.data.set([255, 80, 23, 140], (8 + 2) * 4);
  const backward = flow(8, 3, -2, 0), forward = flow(8, 3, 2, 0);
  const { value, field } = W.flow(source, backward, { filter: 'nearest', edge: 'transparent' });
  assert.deepEqual([...value.data.slice((8 + 4) * 4, (8 + 5) * 4)], [255, 80, 23, 140]);
  assert.equal(value.data[(8 + 2) * 4 + 3], 0);
  assert.equal(field.data[(8 + 4) * 2], 2.5 / 8);
  const confidence = image(8, 3, x => Number(x < 4));
  const points = [[2.5, 1.5], [5.5, 1.5], [-1, 0]];
  assert.deepEqual(W.flowPoints(points, forward, { confidence }), [[4.5, 1.5], [5.5, 1.5], [-1, 0]]);
  assert.throws(() => W.flow(source, flow(7, 3, 0, 0)), /matching image/);
  assert.throws(() => W.flowSampler(forward, { confidence: image(8, 3, () => 2) }), /confidence/);
});

test('typed optical-flow nodes compose estimated fields, confidence, a warp, and point motion', () => {
  const before = image(43, 35, (x, y) => Math.round(255 * texture(x, y)));
  const after = image(43, 35, (x, y) => Math.round(255 * texture(x - 2, y + 1)));
  const at = (node, port) => ({ node, ...(port && { port }) });
  const session = graph.create({
    inputs: { before: 'raster', after: 'raster', points: 'array<vec2>' },
    nodes: {
      a: { op: 'warp.opticalFlow', inputs: { before: { input: 'before' }, after: { input: 'after' } } },
      b: { op: 'warp.opticalFlow', inputs: { before: { input: 'before' }, after: { input: 'after' },
        options: { value: { direction: 'backward' } } } },
      tracks: { op: 'warp.flowPoints', inputs: { points: { input: 'points' }, motion: at('a'), confidence: at('a', 'confidence') } },
      dragged: { op: 'warp.flow', inputs: { source: { input: 'before' }, motion: at('b'), confidence: at('b', 'confidence') } }
    },
    outputs: { points: at('tracks'), image: at('dragged') }
  });
  const sources = { before, after, points: [[21.5, 18.5]] };
  const { outputs } = session.evaluate(sources);
  close(outputs.points[0], [23.5, 17.5], .2);
  const pos = 17 * before.width + 23;
  assert.ok(Math.abs(outputs.image.data[pos * 4] - after.data[pos]) < 4);
  assert.deepEqual(session.evaluate(sources).outputs, outputs);
});

test('raster feedback pulls its previous ink along the backward field and replays the same result', () => {
  const width = 8, height = 3;
  const make = () => KIT.procedural.raster.canvas({ width, height });
  const mark = make();
  mark.data.set([200, 170, 80, 255], (width + 2) * 4);
  const frames = [mark, make(), make()], motions = [flow(width, height, -2, 0), flow(width, height, -1, 0)];
  const session = graph.create({
    inputs: { frames: 'array<raster>', motion: 'array<raster>' },
    nodes: { echo: { op: 'anim.feedback', inputs: { frames: { input: 'frames' }, flow: { input: 'motion' },
      options: { value: { dt: .05, fps: 20, filter: 'nearest', halfLife: 1 } } } } },
    outputs: { image: { node: 'echo' } }
  });
  const at = (time, motion = motions) => session.evaluate({ frames, motion }, { time }).outputs.image;
  const alpha = (raster, x) => raster.data[(width + x) * 4 + 3];
  const second = at(.05);
  assert.ok(alpha(second, 4) > 225);
  assert.equal(alpha(second, 2), 0);
  const third = at(.1);
  assert.ok(alpha(third, 5) > 200);
  assert.deepEqual(at(.05), second);
  assert.ok(alpha(at(.1, []), 2) > 200);
  assert.ok(alpha(at(0), 2) > 240);
  assert.deepEqual(at(.1), third);
  assert.throws(() => at(.05, [flow(width - 1, height, 0, 0)]), /aligned two-channel/);
});
