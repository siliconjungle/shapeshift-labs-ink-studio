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
const span = (first, last, y = 3) => Array.from({ length: last - first + 1 }, (_, i) => [first + i, y]);

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
  const missing = tracker.update(frame([]), 2);
  assert.deepEqual(missing.value, []);
  assert.deepEqual(missing.events, [{ type: 'disappear', time: 2, from: [1], to: [], center: [5.5, 3.5] }]);
  const stillMissing = tracker.update(frame([]), 3);
  assert.equal(label(stillMissing, 11, 3), 0);
  assert.deepEqual(stillMissing.events, []);
  const resumed = tracker.update(frame([[14, 3]]), 4);
  assert.deepEqual(resumed.value.map(({ id, velocity, confidence }) => [id, velocity, confidence]), [[1, [3, 0], 2 / 3]]);
  assert.deepEqual(resumed.events, [{ type: 'reappear', time: 4, from: [1], to: [1], center: [14.5, 3.5], missedFrames: 2 }]);
  for (let t = 5; t <= 7; t++) tracker.update(frame([]), t);
  const newRegion = tracker.update(frame([[14, 3]]), 8);
  assert.equal(label(newRegion, 14, 3), 2);
  assert.deepEqual(newRegion.events, []);
  tracker.reset();
  assert.equal(label(tracker.update(frame([[14, 3]]), -1), 14, 3), 1);
});

test('a split and merge report complete lineage and preserve an ID through large changes in area', () => {
  const tracker = createRegionTracker();
  const joined = frame(span(2, 19));
  const separated = frame([...span(2, 5), ...span(7, 10), ...span(12, 15), ...span(17, 19)]);
  const first = tracker.update(joined, 0);
  assert.deepEqual(first.events, []);
  first.labels.data.fill(0);
  const split = tracker.update(separated, 1);
  assert.deepEqual(split.events, [{ type: 'split', time: 1, from: [1], to: [1, 2, 3, 4], center: [10.9, 3.5] }]);
  assert.ok(split.value.every(region => region.confidence >= 0 && region.confidence <= 1));
  assert.equal(label(split, 4, 3), 1);
  assert.equal(label(split, 8, 3), 2);
  assert.equal(label(split, 13, 3), 3);
  assert.equal(label(split, 18, 3), 4);
  const merge = tracker.update(joined, 2);
  assert.deepEqual(merge.events, [{ type: 'merge', time: 2, from: [1, 2, 3, 4], to: [1], center: [11, 3.5] }]);
  assert.equal(merge.value.length, 1);
  assert.ok(Object.isFrozen(merge.events[0].from));
  const separatedAgain = tracker.update(separated, 3);
  assert.deepEqual(separatedAgain.events.map(event => event.type), ['split']);
  assert.deepEqual(separatedAgain.events[0].to, [1, 2, 3, 4]);
});

test('motion compensation detects a split with no unshifted overlap', () => {
  const tracker = createRegionTracker({ maxDistance: 12 });
  tracker.update(frame(span(2, 7)), 0);
  tracker.update(frame(span(10, 15)), 1);
  const moving = tracker.update(frame([...span(18, 19), ...span(22, 23)]), 2);
  assert.deepEqual(moving.events, [{ type: 'split', time: 2, from: [1], to: [1, 2], center: [21, 3.5] }]);
});

test('separate one-to-one continuations and the vacated footprint of a moving region do not create branching events', () => {
  const moving = createRegionTracker({ maxDistance: 10 });
  moving.update(frame(span(2, 5)), 0);
  moving.update(frame(span(8, 11)), 1);
  const changed = moving.update(frame([...span(8, 11), ...span(14, 17)]), 2);
  assert.deepEqual(changed.events, []);
  assert.equal(label(changed, 15, 3), 1);

  const crossing = createRegionTracker({ eventOverlap: .2 });
  crossing.update(frame([...span(3, 7, 2), ...span(3, 7, 6)]), 0);
  const perpendicular = Array.from({ length: 5 }, (_, i) => [[3, i + 2], [7, i + 2]]).flat();
  const after = crossing.update(frame(perpendicular), 1);
  assert.deepEqual(after.value.map(({ id }) => id), [1, 2]);
  assert.deepEqual(after.events, []);
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
    outputs: Object.fromEntries(['value', 'labels', 'time', 'frame', 'events'].map(port => [port, { node: 'tracks', port }]))
  });
  const frames = [frame([[2, 4]]), frame([[5, 4]]), frame([]), frame([[11, 4]])];
  const at = time => session.evaluate({ frames }, { time }).outputs;
  const late = at(.75);
  assert.equal(late.frame, 3);
  assert.equal(late.time, .75);
  assert.equal(label(late, 11, 4), 1);
  assert.deepEqual(late.value[0].velocity, [12, 0]);
  assert.deepEqual(late.events.map(event => event.type), ['reappear']);
  assert.equal(at(.25).frame, 1);
  assert.deepEqual(at(.5).events.map(event => event.type), ['disappear']);
  assert.deepEqual(at(.75), late);
  assert.equal(at(1).frame, 0);
  session.clear();
  assert.deepEqual(at(.75), late);
});

test('the graph exposes simultaneous topology and visibility events at their own source frame', () => {
  const connected = span(2, 12);
  const separated = [...span(2, 6), ...span(8, 12)];
  const outside = [20, 10];
  const frames = [frame([...connected, outside]), frame(separated), frame(separated), frame([...connected, outside])];
  const session = graph.create({
    inputs: { frames: 'array<raster>' },
    nodes: { regions: { op: 'fx.trackRegions', inputs: { frames: { input: 'frames' }, options: { value: { fps: 2 } } } } },
    outputs: { events: { node: 'regions', port: 'events' } }
  });
  const at = time => session.evaluate({ frames }, { time }).outputs.events;
  const connectedAgain = at(1.5);
  assert.deepEqual(connectedAgain.map(({ type, time }) => [type, time]), [['merge', 1.5], ['reappear', 1.5]]);
  const divided = at(.5);
  assert.deepEqual(divided.map(({ type, time }) => [type, time]), [['split', .5], ['disappear', .5]]);
  assert.deepEqual(at(1), []);
  assert.deepEqual(at(1.5), connectedAgain);
});
