#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const ink = require('..');
const { grid, upscale } = require('../cli/render.js');
const PNG = require('../cli/png.js');

const kit = ink.load();
const example = require('../examples/depth-aware-fog/stochastic-aperture.js')(kit);
const world = example.build(example.seed);
const destination = path.resolve(process.argv[2] ?? 'stochastic-fog-review');
const width = 200, height = 124, fps = 16, cut = 12, frames = 30, stride = 8, historyFrames = 12;
const threshold = 1, consecutive = 3;
const lanes = ['dense', 'fresh', 'accumulated'];
const history = kit.KIT.atmosphere.history();
const timing = Object.fromEntries(lanes.map(lane => [lane, []]));
const cameras = [
  { yaw: .13, pitch: .075, dist: 6.9, target: [0,1.52,-.33] },
  { yaw: -.32, pitch: .14, dist: 6.25, target: [.17,1.45,-.39] }
];

function draw(lane, frame) {
  const start = performance.now();
  const image = ink.render(world, {
    ...cameras[Number(frame >= cut)], w: width, h: height, t: frame / fps, px: 1, raw: true, captureFog: true,
    volumeHistory: lane === 'accumulated' ? history : undefined,
    volumeQuality: { stats: true, stochastic: lane === 'dense' ? 1 : stride, stochasticHistory: historyFrames, seed: 29 }
  });
  if (frame >= 0) timing[lane].push(performance.now() - start);
  return image;
}

function measure(image, dense, previous) {
  let error = 0, change = 0, pixels = 0;
  for (let p = 0; p < dense.fog.length; p++) {
    assert.equal(image.fog[p], dense.fog[p], 'native fog opacity must match the dense reference');
    if (dense.fog[p] <= .01) continue;
    pixels++;
    for (let channel = 0; channel < 3; channel++) {
      const i = 3 * p + channel;
      error += (image.rgb[i] - dense.rgb[i]) ** 2;
      if (previous) change += (image.rgb[i] - previous.rgb[i]) ** 2;
    }
  }
  return {
    fogPixels: pixels, rgbRmse8Bit: Math.sqrt(error / (3 * pixels)),
    frameDeltaRmse8Bit: previous ? Math.sqrt(change / (3 * pixels)) : null,
    ...image.volumeStats
  };
}

function summarize(samples) {
  const sorted = samples.slice().sort((a,b) => a-b), mid = sorted.length >> 1;
  return {
    medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2,
    p95Ms: sorted[Math.ceil(.95 * sorted.length) - 1]
  };
}

for (let frame = -6; frame < 0; frame++) for (const lane of lanes) draw(lane, frame);
history.clear();
const movies = [], rows = [], samples = [];
let previous;
for (let frame = 0; frame < frames; frame++) {
  const images = {};
  // Rotate the order to distribute runtime warm-up and short-term CPU effects.
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[(frame + i) % lanes.length];
    images[lane] = draw(lane, frame);
  }
  assert.equal(images.fresh.volumeStats.stochasticStride, stride);
  assert.equal(images.accumulated.volumeStats.fieldSamples, images.dense.volumeStats.fieldSamples);
  if (frame === 0 || frame === cut) {
    assert.equal(images.accumulated.volumeStats.historyFrames, 1);
    assert.deepEqual(images.accumulated.rgb, images.fresh.rgb);
    previous = undefined;
  }
  samples.push({
    frame, time: frame / fps, sinceCut: frame >= cut ? frame - cut : null,
    ...Object.fromEntries(lanes.map(lane => [lane, measure(images[lane], images.dense, previous?.[lane])]))
  });
  const strip = upscale(grid(lanes.map(lane => images[lane]), lanes.length, ['1', '2', '3']), 2);
  movies.push(PNG.packFrame(strip));
  if ([cut - 1, cut, frames - 1].includes(frame)) rows.push(strip);
  previous = images;
}

const postCut = samples.slice(cut);
function settles(metric) {
  const frame = postCut.findIndex((_, i) => i + consecutive <= postCut.length &&
    postCut.slice(i, i + consecutive).every(sample => {
      const value = sample.accumulated[metric];
      return value !== null && value <= threshold;
    }));
  return { framesAfterCut: frame < 0 ? null : frame, secondsAfterCut: frame < 0 ? null : frame / fps };
}

const report = {
  platform: { machine: os.cpus()[0]?.model, os: os.platform(), arch: os.arch(), node: process.version },
  artGrid: { width, height }, fps, frames, cameraCutFrame: cut, warmupFramesPerLane: 6,
  stride, historyFrames, seed: 29, opacityMatchesDense: true,
  metric: 'RMS over the final 8-bit RGB channels of native pixels whose dense fog opacity exceeds 0.01',
  settling: {
    thresholdRmse8Bit: threshold, consecutiveFrames: consecutive,
    frameToFrame: settles('frameDeltaRmse8Bit'), reference: settles('rgbRmse8Bit')
  },
  timing: Object.fromEntries(lanes.map(lane => [lane, { ...summarize(timing[lane]), samplesMs: timing[lane] }])),
  samples
};

fs.mkdirSync(destination, { recursive: true });
const sheet = grid(rows, 1);
PNG.write(path.join(destination, 'comparison.png'), sheet.w, sheet.h, sheet.rgb);
fs.writeFileSync(path.join(destination, 'camera-cut.png'), PNG.encodeAnimation(movies, fps));
fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(destination);
