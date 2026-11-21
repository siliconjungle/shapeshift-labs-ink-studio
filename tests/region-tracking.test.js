const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { pixelEffects: { createRegionTracker }, graph } = KIT.procedural;

function frame(points, width = 24, height = 14) {
  const data = new Uint8Array(width * height);
  for (const [x, y] of points) data[y * width + x] = 255;
  return { width, height, channels: 1, data };
}
const label = ({ labels }, x, y) => labels.data[y * labels.width + x];

test('tracking follows predicted motion when two regions exchange screen order', () => {
  const tracker = createRegionTracker({ maxDistance: 5 });
  const start = tracker.update(frame([[2, 3], [17, 4]]), 0);
  assert.deepEqual(start.value.map(({ id, center, velocity }) => [id, center, velocity]), [
    [1, [2.5, 3.5], [0, 0]], [2, [17.5, 4.5], [0, 0]]
  ]);
  tracker.update(frame([[6, 3], [13, 4]]), .25);
  const result = tracker.update(frame([[10, 4], [9, 5]]), .5);
  assert.equal(label(result, 10, 4), 1);
  assert.equal(label(result, 9, 5), 2);
  assert.deepEqual(result.value.map(track => track.velocity), [[16, 4], [-16, 4]]);
  assert.ok(result.value.every(track => track.confidence > .65 && track.confidence < 1));
  assert.deepEqual(start.value.map(track => track.id), [1, 2]);
});

test('matching assigns globally when one track could consume the only valid match for another', () => {
  const tracker = createRegionTracker({ maxDistance: 4 });
  tracker.update(frame([[6, 3], [10, 3]]), 0);
  const result = tracker.update(frame([[3, 3], [8, 3]]), 1);
  assert.equal(label(result, 3, 3), 1);
  assert.equal(label(result, 8, 3), 2);
});

test('a brief missed detection can be reacquired, and an expired ID is never recycled', () => {
  const tracker = createRegionTracker({ maxDistance: 4, maxMissed: 2 });
  tracker.update(frame([[2, 3]]), 0);
  tracker.update(frame([[5, 3]]), 1);
  assert.deepEqual(tracker.update(frame([]), 2).value, []);
  assert.equal(label(tracker.update(frame([]), 3), 11, 3), 0);
  const resumed = tracker.update(frame([[14, 3]]), 4);
  assert.deepEqual(resumed.value.map(({ id, velocity, confidence }) => [id, velocity, confidence]), [[1, [3, 0], 2 / 3]]);
  for (let t = 5; t <= 7; t++) tracker.update(frame([]), t);
  assert.equal(label(tracker.update(frame([[14, 3]]), 8), 14, 3), 2);
  tracker.reset();
  assert.equal(label(tracker.update(frame([[14, 3]]), -1), 14, 3), 1);
});

test('per-region contours include holes, respect borders, and follow the ID raster', () => {
  const ring = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (x === 0 || x === 4 || y === 0 || y === 4) ring.push([x, y]);
  }
  const source = frame([...ring, [8, 3]]);
  const result = createRegionTracker().update(source, 0);
  const [border, dot] = result.value;
  assert.deepEqual(border.center, [2.5, 2.5]);
  assert.deepEqual(border.bounds, { x: 0, y: 0, width: 5, height: 5 });
  assert.equal(border.contours.length, 2);
  assert.ok(border.contours.every(path => path.closed));
  assert.ok(border.contours.some(path => path.points.some(([x, y]) => x === 0 && y > 0)));
  assert.equal(dot.contours.length, 1);
  assert.ok(dot.contours[0].closed);
  assert.equal(label(result, 2, 2), 0);
  assert.equal(label(result, 8, 3), 2);
  assert.equal(source.data[3 * source.width + 8], 255);
});

test('bad frames leave the current stream unchanged', () => {
  const tracker = createRegionTracker({ maxRegions: 1 });
  tracker.update(frame([[4, 4]]), 0);
  assert.throws(() => tracker.update(frame([[4, 4], [9, 1]]), 1), /region budget/);
  assert.throws(() => tracker.update(frame([[4, 4]], 20), 1), /common size/);
  assert.throws(() => tracker.update(frame([[4, 4]]), 0), /increasing timestamps/);
  const next = tracker.update(frame([[6, 4]]), 1);
  assert.equal(label(next, 6, 4), 1);
  assert.deepEqual(next.value[0].velocity, [2, 0]);
  assert.throws(() => tracker.update(frame([[6, 4]]), Infinity), /timestamps/);
});

test('the graph replays equivalent IDs after rewinds, late seeks, wrap, and clear', () => {
  const session = graph.create({
    inputs: { frames: 'array<raster>' },
    nodes: { tracks: { op: 'fx.trackRegions', inputs: { frames: { input: 'frames' },
      options: { value: { fps: 4, mode: 'loop' } } } } },
    outputs: Object.fromEntries(['value', 'labels', 'time', 'frame'].map(port => [port, { node: 'tracks', port }]))
  });
  const frames = [frame([[2, 4]]), frame([[5, 4]]), frame([]), frame([[11, 4]])];
  const at = time => session.evaluate({ frames }, { time }).outputs;
  const late = at(.75);
  assert.equal(late.frame, 3);
  assert.equal(late.time, .75);
  assert.equal(label(late, 11, 4), 1);
  assert.deepEqual(late.value[0].velocity, [12, 0]);
  assert.equal(at(.25).frame, 1);
  assert.equal(at(.5).value.length, 0);
  assert.deepEqual(at(.75), late);
  assert.equal(at(1).frame, 0);
  session.clear();
  assert.deepEqual(at(.75), late);
});
