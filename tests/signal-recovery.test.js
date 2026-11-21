const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const kit = ink.load(), P = kit.KIT.procedural;
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];
const image = (data, width = 1) => ({ width, height: 1, channels: 4, data });
const rgba = result => result.value && Array.from(result.value.data);

test('short faults hold the usable frame inside a hysteresis window', () => {
  const receiver = P.signalRecovery.create({ loseBelow: .3, lockAbove: .7, lossFrames: 2 });
  assert.equal(receiver.sample(image(red), 0).status.stage, 'locked');
  const weak = receiver.sample(image(green), .25, { quality: .4 });
  assert.equal(weak.status.stage, 'locked');
  assert.deepEqual(rgba(weak), green);
  const firstFault = receiver.sample(image(red), .5, { available: false });
  assert.equal(firstFault.status.stage, 'losing');
  assert.deepEqual(firstFault.events, [{ type: 'losing', from: 'locked', time: .5 }]);
  assert.equal(firstFault.status.lastUsableTime, .25);
  assert.deepEqual(rgba(firstFault), green);
  firstFault.value.data.fill(0);
  assert.deepEqual(rgba(receiver.sample(image(red), .5)), green);
  const resumed = receiver.sample(image(blue), .75, { quality: .4 });
  assert.equal(resumed.status.stage, 'locked');
  assert.deepEqual(resumed.events, [{ type: 'locked', from: 'losing', time: .75 }]);
  assert.deepEqual(rgba(resumed), blue);
});

test('an unconfirmed or interrupted relock keeps the original hold and uses alpha-correct blending', () => {
  const receiver = P.signalRecovery.create({ lockFrames: 2, blendSeconds: .5 });
  receiver.sample(image([255, 0, 0, 0]), 0);
  receiver.sample(null, .25);
  const hold = receiver.sample(null, .5);
  assert.equal(hold.status.stage, 'holding');
  assert.deepEqual(hold.events, [{ type: 'holding', from: 'losing', time: .5 }]);
  assert.equal(hold.status.since, .5);
  const weak = receiver.sample(image(blue), .625, { quality: .6 });
  assert.equal(weak.status.stage, 'holding');
  assert.deepEqual(weak.events, []);
  const probe = receiver.sample(image(blue), .75);
  assert.equal(probe.status.stage, 'relocking');
  assert.equal(probe.status.confirmations, 1);
  assert.equal(receiver.sample(image(green), .75).status.confirmations, 1);
  const begin = receiver.sample(image(blue), 1);
  assert.equal(begin.status.confirmations, 2);
  assert.equal(begin.status.mix, 0);
  assert.deepEqual(rgba(begin), [255, 0, 0, 0]);
  const halfway = receiver.sample(image(blue), 1.25);
  assert.deepEqual(rgba(halfway), [0, 0, 255, 128]);
  assert.equal(halfway.status.mix, .5);
  const broken = receiver.sample(null, 1.375);
  assert.deepEqual(broken.events, [{ type: 'holding', from: 'relocking', time: 1.375 }]);
  assert.equal(broken.status.lastUsableTime, 0);
  assert.deepEqual(rgba(broken), [255, 0, 0, 0]);
  assert.equal(receiver.sample(image(green), 1.5).status.confirmations, 1);
  receiver.sample(image(green), 1.75);
  const locked = receiver.sample(image(green), 2.25);
  assert.equal(locked.status.stage, 'locked');
  assert.deepEqual(locked.events, [{ type: 'locked', from: 'relocking', time: 2.25 }]);
  assert.deepEqual(rgba(locked), green);
});

test('a selected tracker ID can return through an occlusion while unrelated regions keep moving', () => {
  const tracker = P.pixelEffects.createRegionTracker({ maxMissed: 3 });
  const receiver = P.signalRecovery.create({ trackId: 1, lockAbove: .45, lockFrames: 2, blendSeconds: 0 });
  function sample(time, found, shade) {
    const width = 9, mask = new Uint8Array(width);
    if (found) mask[1] = 255;
    mask[5 + time % 3] = 255;
    const { value: tracks } = tracker.update({ width, height: 1, channels: 1, data: mask }, time);
    return receiver.sample(image(shade), time, { tracks });
  }
  assert.equal(sample(0, true, red).status.stage, 'locked');
  assert.equal(sample(1, false, green).status.stage, 'losing');
  const wait = sample(2, false, blue);
  assert.equal(wait.status.stage, 'holding');
  assert.equal(wait.status.hasSignal, false);
  assert.equal(wait.status.trackId, 1);
  assert.deepEqual(rgba(wait), red);
  const candidate = sample(3, true, blue);
  assert.equal(candidate.status.stage, 'relocking');
  assert(candidate.status.quality >= .45);
  const lock = sample(4, true, green);
  assert.equal(lock.status.stage, 'locked');
  assert.deepEqual(rgba(lock), green);
});

test('fallback, cold observation, rewinds, size changes, and invalid input preserve stream boundaries', () => {
  const receiver = P.signalRecovery.create({ lockFrames: 1, blendSeconds: 0 });
  const empty = receiver.sample(null, 0);
  assert.equal(empty.value, null);
  assert.equal(empty.status.stage, 'holding');
  assert.deepEqual(receiver.sample(image(red), 0), empty);
  assert.deepEqual(rgba(receiver.sample(null, .25, { fallback: image(blue) })), blue);
  assert.deepEqual(rgba(receiver.sample(image(red), .5)), red);
  assert.throws(() => receiver.sample(image(green), .75, { fallback: image([...blue, ...blue], 2) }), /match/);
  const missing = receiver.sample(null, .75);
  assert.equal(missing.status.stage, 'losing');
  assert.deepEqual(rgba(missing), red);
  const bigger = receiver.sample(image([...green, ...green], 2), 1, { quality: 0 });
  assert.equal(bigger.status.stage, 'holding');
  assert.equal(bigger.status.lastUsableTime, null);
  assert.deepEqual(rgba(bigger), [...clear, ...clear]);
  assert.equal(receiver.sample(image(red), .25).status.stage, 'locked');
  assert.deepEqual(rgba(receiver.sample(null, .25, { reset: true, fallback: image(blue) })), blue);
  receiver.clear();
  assert.equal(receiver.sample(null, .5).value, null);
  assert.throws(() => P.signalRecovery.create({ loseBelow: .8, lockAbove: .7 }), /thresholds/);
});

test('graph clip cuts discard a held image even when the next source is absent', () => {
  const node = id => ({ node: id });
  const project = ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1, nodes: {
    source: { op: 'feed' },
    recovery: { op: 'fx.signalRecovery', inputs: {
      source: node('source'), fallback: image(blue), options: { lossFrames: 1, lockFrames: 2, blendSeconds: 0 }
    } }
  }, outputs: { value: node('recovery') } }, { kit, operations: {
    feed: { time: true, outputs: { value: 'any' }, run(_, { time }) {
      return { value: time === 0 ? image(red) : time >= .75 ? image(green) : null };
    } }
  } });
  const { artifacts } = project.clip({ output: 'value', to: 5, format: 'frames',
    clock: { fps: 4, cuts: [{ frame: 2, id: 'new receive channel' }] } });
  assert.deepEqual(artifacts.map(({ bytes }) => [...require('../cli/png.js').raster(bytes).data]),
    [red, red, blue, blue, green]);
});
