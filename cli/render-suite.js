const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { pose } = require('./diarama-pose.js');
const { measure, strandThresholds, silhouetteThreshold } = require('./render-suite-metrics.js');

const fixtures = {
  gatehouse: {
    file: 'opaque-surface-gate.js', silhouette: 'gatehouse', paint: true,
    reference: { render: {} }, candidate: { render: { sdfAssist: false } }
  },
  'signal-coil': {
    file: 'curve-mode-signal-coil.js', strands: true,
    reference: { render: { curveMode: 'curves', curveSubdivision: false } },
    candidate: { render: { curveMode: 'curves', curveSubdivision: { pixels: .65 } } }
  },
  night: {
    file: 'effect-palettes-night-watch.js',
    reference: { cloudSteps: 21, render: {} }, candidate: { cloudSteps: 9, render: {} }
  }
};
const moves = ['pan', 'orbit', 'zoom', 'cut'];
const lanes = ['reference', 'candidate'];
const warmupFrames = 4;
const isRecord = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;

function settings(options) {
  const { width = 128, height = 80, framesPerMove = 6, fps = 12, scene, profiles = {} } = options;
  if (!integer(width, 24, 320) || !integer(height, 24, 320) || !integer(framesPerMove, 4, 24) || !integer(fps, 1, 60))
    throw new RangeError('Render suite needs 24–320 art pixels per side, 4–24 frames per move, and 1–60 fps');
  if (scene !== undefined && !Object.hasOwn(fixtures, scene))
    throw new RangeError('Render suite scene must be gatehouse, signal-coil, or night');
  const ids = scene ? [scene] : Object.keys(fixtures);
  if (ids.length * width * height * moves.length * framesPerMove > 6_000_000)
    throw new RangeError('Render suite exceeds six million art pixels across scenes and frames');
  if (!isRecord(profiles)) throw new TypeError('Render suite profiles need an object keyed by scene');
  for (const [id, variants] of Object.entries(profiles)) {
    if (!Object.hasOwn(fixtures, id) || !isRecord(variants)) throw new TypeError('Invalid render suite profile for ' + id);
    for (const [lane, profile] of Object.entries(variants)) {
      if (!lanes.includes(lane) || !isRecord(profile) || Object.keys(profile).some(key => key !== 'render' && (key !== 'cloudSteps' || id !== 'night')) ||
          (profile.render !== undefined && !isRecord(profile.render)) ||
          (profile.cloudSteps !== undefined && !integer(profile.cloudSteps, 2, 32)))
        throw new TypeError('Invalid render suite profile for ' + id + '/' + lane);
    }
  }
  return { width, height, framesPerMove, fps, ids, profiles };
}

function cameraPlan(camera, framesPerMove, fps) {
  const { yaw, pitch, dist, target } = camera;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const cutAt = Math.floor(framesPerMove / 2);
  const offset = value => target.map((n, k) => n + right[k] * value);
  const plan = [];
  for (const move of moves) for (let i = 0; i < framesPerMove; i++) {
    const u = i / (framesPerMove - 1);
    const smooth = u*u*(3-2*u);
    const frame = { yaw, pitch, dist, target: target.slice() };
    if (move === 'pan') frame.target = offset(dist*.15*(smooth - .5));
    if (move === 'orbit') frame.yaw += .74*(smooth - .5);
    if (move === 'zoom') frame.dist *= 1.17 - .44*smooth;
    if (move === 'cut' && i >= cutAt) {
      frame.yaw -= .36;
      frame.pitch += .09;
      frame.dist *= .87;
      frame.target = offset(-dist*.024);
    }
    plan.push({ index: plan.length, move, frameInMove: i, time: plan.length / fps, camera: frame,
      reset: i === 0 || move === 'cut' && i === cutAt, cut: move === 'cut' && i === cutAt });
  }
  return plan;
}

function cameraOf(world) {
  const { yaw, pitch, dist, target } = world.cam;
  return { yaw, pitch, dist, target: Array.from(target) };
}

function artOptions(config, sample, profile, history) {
  return {
    ...profile.render, ...history, ...sample.camera,
    w: config.width, h: config.height, px: 1, t: sample.time, time: sample.time, cameraTime: sample.time,
    lockCamera: true, resetRenderHistory: sample.reset
  };
}

function setup(kit, id, profile) {
  const example = require('../examples/' + fixtures[id].file)(kit);
  return { world: example.build(example.seed, { cloudSteps: profile.cloudSteps }), seed: example.seed };
}

const hash = image => createHash('sha256').update(image.rgb).update(image.alpha ?? '').digest('hex');
const rssPeakBytes = () => process.resourceUsage().maxRSS * 1024;

function newMemorySnapshot() {
  const { rss, heapUsed, arrayBuffers, external } = process.memoryUsage();
  return { rssBytes: rss, heapUsedBytes: heapUsed, arrayBuffersBytes: arrayBuffers, externalBytes: external };
}

function benchmark({ id, profile, config }) {
  const kit = require('..').load(), beforeScene = newMemorySnapshot();
  const { world } = setup(kit, id, profile);
  const afterScene = newMemorySnapshot();
  const plan = cameraPlan(cameraOf(world), config.framesPerMove, config.fps);
  const warmup = R.sequenceHistory(kit.KIT);
  pose(world, plan[0].time, { kit, artDirection: profile.render.artDirection });
  for (let i = 0; i < warmupFrames; i++)
    R.render(world, { ...artOptions(config, plan[0], profile, warmup), passes: [], renderStats: true });
  const history = R.sequenceHistory(kit.KIT);
  const beforeSequence = newMemorySnapshot(), sampledPeak = { ...beforeSequence };
  const observations = plan.map(sample => {
    pose(world, sample.time, { kit, artDirection: profile.render.artDirection });
    const image = R.render(world, { ...artOptions(config, sample, profile, history), passes: [], renderStats: true });
    const { frameMs, rasterPasses, fragments, translucentFragments, curveSegments, volume } = image.renderStats;
    const memory = newMemorySnapshot();
    for (const key of Object.keys(memory)) sampledPeak[key] = Math.max(sampledPeak[key], memory[key]);
    if (image.w !== config.width || image.h !== config.height)
      throw new RangeError(id + ' changed the requested art resolution');
    return { frameMs, rasterPasses, compositedFragments: fragments, translucentFragments,
      fragmentsPerArtPixel: fragments / (image.w * image.h), curveSegments, cloudSamples: volume.cloudSamples,
      pictureSha256: hash(image) };
  });
  return { observations, memory: { beforeScene, afterScene, beforeSequence, sampledPeak, processPeakRssBytes: rssPeakBytes() } };
}

function percentiles(values) {
  const sorted = values.slice().sort((a, b) => a-b);
  const at = p => sorted[Math.ceil(sorted.length*p)-1];
  return { p50: at(.50), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
}

function summarize(samples, lane) {
  return {
    frameMs: percentiles(samples.map(sample => sample[lane].frameMs)),
    overdraw: percentiles(samples.map(sample => sample[lane].fragmentsPerArtPixel))
  };
}

function qualitySummary(samples) {
  const max = values => {
    const observed = values.filter(value => value !== null);
    return observed.length ? Math.max(...observed) : null;
  };
  return {
    maxSilhouetteError: max(samples.map(frame => frame.silhouette.errorFraction)),
    maxRgbRmse8Bit: max(samples.map(frame => frame.rgbRmse8Bit)),
    maxPaintRmse8Bit: max(samples.map(frame => frame.paint?.rgbRmse8Bit ?? null)),
    strandBreaks: samples[0].strands ? samples.reduce((sum, frame) => sum + frame.strands.breaks, 0) : null,
    maxResidualFlickerRmse8Bit: max(samples.map(frame => frame.flicker.residualDeltaRmse8Bit)),
    maxHoldFlickerRmse8Bit: max(samples.map(frame => frame.flicker.holdRmse8Bit)),
    diagnosticMismatches: Object.fromEntries(lanes.map(lane => [
      lane, samples.filter(frame => !frame[lane].diagnosticMatchesTimedPicture).length
    ]))
  };
}

function profilesFor(config, id) {
  return Object.fromEntries(lanes.map(lane => {
    const defaults = fixtures[id][lane], overrides = config.profiles[id]?.[lane];
    return [lane, { ...defaults, ...overrides, render: { ...defaults.render, ...overrides?.render } }];
  }));
}

function runScene(kit, config, id, receive) {
  const fixture = fixtures[id], profiles = profilesFor(config, id);
  const data = Object.fromEntries(lanes.map(lane => [lane, JSON.parse(execFileSync(process.execPath, [__filename], {
    input: JSON.stringify({ id, profile: profiles[lane], config }), encoding: 'utf8', maxBuffer: 2_000_000
  }))]));
  const worlds = Object.fromEntries(lanes.map(lane => [lane, setup(kit, id, profiles[lane])]));
  const histories = Object.fromEntries(lanes.map(lane => [lane, R.sequenceHistory(kit.KIT)]));
  const seed = worlds.reference.seed, plan = cameraPlan(cameraOf(worlds.reference.world), config.framesPerMove, config.fps);
  const passes = ['coverage', ...(fixture.silhouette ? ['objectId'] : []),
    ...(fixture.strands ? ['strandCoverage', 'strandId', 'strandU', 'strandMotion'] : [])];
  let previous, previousCamera;
  const frames = plan.map(sample => {
    let camera;
    const images = Object.fromEntries(lanes.map(lane => {
      const { world } = worlds[lane], profile = profiles[lane];
      pose(world, sample.time, { kit, artDirection: profile.render.artDirection });
      let resolved;
      const capture = R.cameraCapture(null, value => {
        if (value.width === config.width && value.height === config.height) resolved = value;
      });
      const image = R.render(world, { ...artOptions(config, sample, profile, histories[lane]), ...capture, passes, renderStats: false });
      if (image.w !== config.width || image.h !== config.height || !resolved || (camera && !isDeepStrictEqual(camera, resolved)))
        throw new RangeError(id + ' lanes must resolve the same camera and native art grid');
      if (image.passes?.w !== image.w || image.passes?.h !== image.h ||
          passes.some(name => !ArrayBuffer.isView(image.passes[name])))
        throw new RangeError(id + '/' + lane + ' must supply the native diagnostic passes');
      camera = resolved;
      return [lane, image];
    }));
    const hold = !sample.reset && isDeepStrictEqual(camera, previousCamera);
    const result = measure(images.reference, images.candidate, fixture, sample.reset ? undefined : previous, hold);
    previous = result.state;
    previousCamera = camera;
    receive(sample, [images.reference, images.candidate, result.evidence]);
    const timings = Object.fromEntries(lanes.map(lane => {
      const info = data[lane].observations[sample.index];
      return [lane, { ...info, diagnosticMatchesTimedPicture: hash(images[lane]) === info.pictureSha256 }];
    }));
    return { ...sample, resolvedCamera: camera, hold, ...timings, ...result.metrics };
  });
  return {
    id, fixture: 'examples/' + fixture.file, seed, profiles, quality: qualitySummary(frames),
    performance: Object.fromEntries(lanes.map(lane => [lane, { ...summarize(frames, lane), memory: data[lane].memory }])),
    shots: Object.fromEntries(moves.map(move => {
      const samples = frames.filter(frame => frame.move === move);
      return [move, { ...Object.fromEntries(lanes.map(lane => [lane, summarize(samples, lane)])), quality: qualitySummary(samples) }];
    })),
    frames
  };
}

function run(directory, options = {}) {
  const config = settings(options), kit = require('..').load();
  const movies = Array.from({ length: config.framesPerMove * moves.length }, () => []);
  const stills = [], scenes = [];
  for (const id of config.ids) {
    options.onScene?.(id);
    scenes.push(runScene(kit, config, id, (sample, pictures) => {
      const strip = R.grid(pictures, 3, ['1', '2', '3']);
      if (sample.cut) stills.push(strip);
      movies[sample.index].push(strip);
    }));
  }
  const report = {
    format: 'ink-studio/render-suite', version: 1, backend: 'headless',
    machine: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    artGrid: { width: config.width, height: config.height }, fps: config.fps, framesPerMove: config.framesPerMove,
    warmupFrames, moves, thresholds: { coverage: silhouetteThreshold, strand: strandThresholds },
    panels: ['reference', 'candidate', 'evidence'], evidenceColors: { lost: [251,156,70], added: [88,225,240], strandBreak: [244,104,208] },
    comparison: 'comparison.png', animation: 'comparison.apng', scenes
  };
  files.write(path.join(directory, report.comparison), PNG.encodeFrame(PNG.packFrame(R.grid(stills, 1))));
  const movie = movies.map(strips => PNG.packFrame(R.grid(strips, 1)));
  files.write(path.join(directory, report.animation), PNG.encodeAnimation(movie, config.fps));
  files.json(path.join(directory, 'report.json'), report);
  return report;
}

if (require.main === module) process.stdout.write(JSON.stringify(benchmark(JSON.parse(fs.readFileSync(0, 'utf8')))));

module.exports = { run, cameraPlan, percentiles };
