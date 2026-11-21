const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { rasterWarp: W, graph, raster } = KIT.procedural;

function field(width, height, displacement) {
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    data.set(displacement(x + .5, y + .5), (y * width + x) * 2);
  return { width, height, channels: 2, data };
}
const plane = (width, height, sample) => ({ width, height, channels: 1,
  data: Float32Array.from({ length: width * height }, (_, i) => sample(i % width, Math.floor(i / width))) });
const close = (actual, expected, epsilon = .00001) =>
  assert.ok(Math.hypot(...actual.map((value, i) => value - expected[i])) < epsilon, `Expected ${expected}, got ${actual}`);
const map = (matrix, x, y) => matrix.map(([a, b, c]) => a * x + b * y + c);

test('a pan, zoom, and roll are removed while local subject movement stays in the original coordinates', () => {
  const width = 80, height = 54, scale = 1.1, rotation = .09, pan = [3.2, -2.6];
  const a = scale * Math.cos(rotation), b = scale * Math.sin(rotation);
  const subject = (x, y) => x > 24 && x < 54 && y > 18 && y < 38;
  const motion = field(width, height, (x, y) => {
    const dx = x - width / 2 + (subject(x, y) ? 6 : 0), dy = y - height / 2 + (subject(x, y) ? -4 : 0);
    return [a * dx - b * dy + width / 2 + pan[0] - x, b * dx + a * dy + height / 2 + pan[1] - y];
  });
  const result = W.cameraMotion(motion, { threshold: .18 });
  assert.equal(result.transform.valid, true);
  close(result.transform.pan, pan);
  close([result.transform.scale, result.transform.rotation], [scale, rotation]);
  close(W.flowSampler(result.value)(39.5, 29.5), [6, -4]);
  close(W.flowSampler(result.value)(16.5, 16.5), [0, 0]);
  close(map(result.transform.inverse, ...map(result.transform.matrix, 39.5, 29.5)), [39.5, 29.5]);
  assert.equal(result.inliers.data[29 * width + 39], 0);
  assert.equal(result.inliers.data[16 * width + 16], 255);
  assert.deepEqual(W.cameraMotion(motion, { threshold: .18 }), result);
});

test('a background mask and confidence gate can isolate camera anchors when the foreground dominates', () => {
  const width = 43, height = 30;
  const motion = field(width, height, (x, y) => x < 8 ? [2, -1] : y < 21 ? [-7, 3] : [0, 4]);
  const mask = plane(width, height, (x, y) => x < 8 || y > 24 ? 255 : 0);
  const confidence = plane(width, height, (x, y) => x < 8 || y <= 24 ? 1 : 0);
  const solve = W.cameraMotion(motion, { model: 'translation', threshold: .1, mask, confidence });
  close(solve.transform.pan, [2, -1]);
  assert.equal(solve.transform.valid, true);
  assert.equal(solve.transform.inlierRatio, 1);
  close(W.flowSampler(solve.value)(21.5, 14.5), [-9, 4]);
  assert.equal(solve.inliers.data[26 * width + 20], 0);
});

test('an unusable consensus gives an identity field and preserves the input displacement', () => {
  const motion = field(16, 12, () => [5, 2]);
  const noEvidence = W.cameraMotion(motion, { confidence: plane(16, 12, () => 0) });
  assert.equal(noEvidence.transform.valid, false);
  close(noEvidence.transform.pan, [0, 0]);
  assert.deepEqual(noEvidence.value, motion);
  assert.ok(noEvidence.camera.data.every(x => x === 0));
  assert.ok(noEvidence.inliers.data.every(x => x === 0));
  assert.deepEqual(noEvidence.field, W.field({ width: 16, height: 12 }));
  const incompatible = field(30, 20, (x) => x < 10 ? [3, 0] : x < 20 ? [-2, 1] : [0, -4]);
  assert.equal(W.cameraMotion(incompatible, { model: 'translation', threshold: .1 }).transform.valid, false);
  assert.throws(() => W.cameraMotion(motion, { mask: plane(12, 12, () => 1) }), /aligned single-channel/);
  assert.throws(() => W.cameraMotion(motion, { model: 'perspective' }), /model/);
});

test('typed graph outputs stabilize a raster and drive points with its compensated field', () => {
  const width = 22, height = 16;
  const motion = field(width, height, () => [3, -2]);
  const source = raster.canvas({ width, height });
  source.data.set([160, 90, 40, 180], (6 * width + 12) * 4);
  const at = (node, port) => ({ node, ...(port && { port }) });
  const session = graph.create({
    inputs: { motion: 'raster', source: 'raster' },
    nodes: {
      camera: { op: 'warp.cameraMotion', inputs: { motion: { input: 'motion' } } },
      stabilized: { op: 'warp.sample', inputs: { source: { input: 'source' }, field: at('camera', 'field'),
        options: { value: { filter: 'nearest', edge: 'transparent' } } } },
      points: { op: 'warp.flowPoints', inputs: { points: { value: [[9.5, 8.5]] }, motion: at('camera') } }
    },
    outputs: { image: at('stabilized'), points: at('points'), transform: at('camera', 'transform') }
  });
  const { outputs } = session.evaluate({ motion, source });
  close(outputs.transform.pan, [3, -2]);
  assert.deepEqual([...outputs.image.data.subarray((8 * width + 9) * 4, (8 * width + 10) * 4)], [160, 90, 40, 180]);
  assert.deepEqual(outputs.points, [[9.5, 8.5]]);
});

test('dense optical flow recovers camera motion from raster pixels and keeps independent motion', () => {
  const width = 144, height = 94;
  const texture = (x, y) => .47 + .16 * Math.sin(.51 * x + .32 * y) + .1 * Math.cos(.34 * x - .63 * y) +
    .16 * Math.sin(.19 * x) * Math.cos(.56 * y) + .08 * Math.sin(.09 * x + .11 * y);
  const image = (scale, pan, actor) => ({ width, height, channels: 1,
    data: Uint8Array.from({ length: width * height }, (_, p) => {
      const x = (p % width + .5 - width / 2 - pan[0]) / scale + width / 2;
      const y = (Math.floor(p / width) + .5 - height / 2 - pan[1]) / scale + height / 2;
      const a = x - 68 - actor, b = y - 46;
      const coverage = Math.max(0, Math.min(1, (13 - Math.hypot(a, b)) / 2));
      return Math.round(255 * (texture(x, y) * (1 - coverage) + coverage *
        (.62 + .15 * Math.sin(.8 * a - .5 * b) + .11 * Math.cos(.3 * a + .82 * b))));
    })
  });
  const raw = W.opticalFlow(image(1, [0, 0], 0), image(1.1, [6, -3], 5));
  const stable = W.cameraMotion(raw.value, { confidence: raw.confidence });
  assert.equal(stable.transform.valid, true);
  close(stable.transform.pan, [6, -3], .8);
  close([stable.transform.scale], [1.1], .008);
  close(W.flowSampler(stable.value)(66.5, 46.5), [5, 0], .8);
  close(W.flowSampler(stable.value)(25.5, 25.5), [0, 0], 1);
});
