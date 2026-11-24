const fs = require('node:fs');
const path = require('node:path');
const { readGraphProject } = require('./graph-project.js');
const { graphOutputs } = require('./graph-outputs.js');
const { patchNodes } = require('./patch-nodes.js');
const { createPatchGpu } = require('./patch-gpu.js');
const { audioSource, parseRate } = require('./patch-media.js');
const Draw = require('./performance-draw.js');
const Score = require('./show-performance-score.js');
const Capture = require('./show-performance-capture.js');

const index = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
function check(value, message) {
  if (!value) throw new RangeError(message);
}

function read(file, maxBytes) {
  const stat = fs.statSync(file);
  check(stat.isFile() && stat.size <= maxBytes, 'Stress case document exceeds its input budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mediaFrames(rows, directory) {
  let total = 0;
  return rows.map(({ file, width, height, sha256 }, i) => {
    const bytes = width * height * 4;
    check(file === 'video/' + i + '.rgba' && sha(sha256) && index(width) && index(height) &&
      bytes > 0 && bytes <= 4194304 && (total += bytes) <= 64 * 1024 ** 2, 'Invalid captured video frame inventory');
    const at = path.join(directory, file), stat = fs.statSync(at);
    check(stat.isFile() && stat.size === bytes, 'Captured video frame no longer matches its inventory');
    const data = fs.readFileSync(at);
    check(Capture.digest(data) === sha256, 'Captured video frame no longer matches its digest');
    return { width, height, channels: 4, data };
  });
}

async function load(file) {
  const folder = path.dirname(file), spec = read(file, 32 * 1024 ** 2);
  check(spec?.format === Capture.format && spec.version === 1 && spec.replay?.run === 'run.json' &&
    index(spec.fromFrame) && index(spec.toFrame) && spec.toFrame > spec.fromFrame && spec.toFrame - spec.fromFrame <= 121 &&
    Array.isArray(spec.picture) && spec.picture.length <= 121 && Array.isArray(spec.audio?.blocks) &&
    spec.audio.blocks.length <= 2048, 'Expected a replayable version 1 beat performance case');
  const runFile = path.join(folder, 'run.json'), run = read(runFile, 16 * 1024 ** 2);
  check(run?.format === Capture.runFormat && run.version === 1 && typeof run.patch === 'string' &&
    typeof run.output === 'string' && sha(run.projectHash) && sha(run.fingerprint) &&
    Array.isArray(run.inputs) && run.inputs.every(record) && Array.isArray(run.frames) && run.frames.length > 0 &&
    run.frames.length <= 36000 && Array.isArray(run.videoFrames) && run.videoFrames.length <= 36000 &&
    Array.isArray(run.audioBoundaries) && run.audioBoundaries.length <= 36001 && Array.isArray(run.files) && run.files.length <= 4096,
  'Invalid stress run inventory');
  const fps = parseRate(run.rate);
  for (const [i, step] of run.frames.entries()) {
    check(index(step?.frame) && index(step.controls) && step.controls < run.inputs.length && Number.isSafeInteger(step.seed) &&
      (step.video === null || index(step.video) && step.video < run.videoFrames.length) &&
      (i === 0 || step.frame > run.frames[i - 1].frame), 'Invalid recorded graph work order');
  }
  check(run.audioBoundaries.every((frame, i) => index(frame) && (i === 0 || frame > run.audioBoundaries[i - 1])),
    'Invalid recorded audio work order');
  check(run.files.every(row => typeof row?.file === 'string' && sha(row.sha256)), 'Invalid stress dependency list');
  const paths = run.files.map(row => path.resolve(folder, row.file));
  const current = await Capture.fingerprints(paths, folder);
  check(current.length === run.files.length && current.every((row, i) => row.sha256 === run.files[i].sha256),
    'A captured stress dependency has changed');
  const video = mediaFrames(run.videoFrames, folder);
  return { spec, run, folder, fps, video, paths: [...paths, file, runFile, ...run.videoFrames.map(row => path.join(folder, row.file))] };
}

async function replay(capture, opt, settings) {
  const { run, spec, folder, fps, video } = capture, { fromFrame, toFrame } = spec;
  const resolve = file => path.resolve(folder, file), patch = resolve(run.patch);
  const gpu = createPatchGpu(path.dirname(patch), opt['gpu-module'] ?? (run.gpuModule && resolve(run.gpuModule)));
  const media = {}, operations = { ...settings.operations, ...patchNodes(settings.kit, media, gpu) };
  const raster = settings.kit.KIT.procedural.raster;
  let project, score, boundary = 0;
  const picture = [], audio = [], expected = new Map(spec.picture.map(row => [row.frame, row.sha256]));
  const expectedAudio = new Map(spec.audio.blocks.map(row => [row.firstSample, row]));
  const seenAudio = new Set();
  function hear(block) {
    if (block.toFrame <= fromFrame || block.fromFrame >= toFrame) return;
    const { firstSample, endSample, fromFrame: from, toFrame: to, peakVoices, ms, sha256, gaps } = block;
    const prior = expectedAudio.get(firstSample);
    seenAudio.add(firstSample);
    audio.push({ firstSample, endSample, fromFrame: from, toFrame: to, peakVoices, ms, sha256,
      matches: !prior || (prior.endSample === endSample && prior.sha256 === sha256 &&
        JSON.stringify(prior.gaps) === JSON.stringify(gaps) && JSON.stringify(prior.voices) === JSON.stringify(block.voices)),
      gaps: gaps.filter(gap => !gap.recovered).map(({ sample, resource, beatId }) => ({ sample, resource, beatId })) });
  }
  async function audioThrough(frame) {
    while (score && (boundary === 0 || run.audioBoundaries[boundary - 1] < toFrame) && run.audioBoundaries[boundary] <= frame) {
      const target = run.audioBoundaries[boundary++];
      await score.advance(target, hear);
      if (target >= toFrame) break;
    }
  }
  let warmupFrames = 0;
  try {
    project = readGraphProject(patch, { ...settings, operations });
    check(project.plan().projectHash === run.projectHash && project.artifactIdentity().fingerprint === run.fingerprint,
      'Stress replay needs the captured graph and host operations');
    if (run.staticAudio) {
      const input = run.staticAudio, fallback = { sampleRate: 48000, channels: 1, samples: new Float32Array(48000) };
      check(input.fallback || typeof input.file === 'string', 'Invalid recorded static audio source');
      media.audio = input.fallback ? fallback : await audioSource(input.file === 'video' ? 'video' : resolve(input.file), {
        video: input.video && resolve(input.video), executable: opt.ffmpeg,
        duration: (run.framesInShow ?? toFrame) / fps, procedural: settings.kit.KIT.procedural
      });
    }
    if (run.score) score = await Score.open(resolve(run.score.recipe), resolve(run.score.route), settings.kit, run.rate);
    for (const { frame, controls, video: image, seed } of run.frames) {
      if (frame >= toFrame) break;
      const audioStart = performance.now();
      await audioThrough(frame + 1);
      const audioMs = score ? performance.now() - audioStart : 0;
      media.frame = image === null ? undefined : video[image];
      const start = performance.now();
      const { result, trace } = await Draw.measure(() => project.previewFrame({ picture: { output: run.output } },
        { inputs: run.inputs[controls], time: frame / fps, seed }, { profile: true, encodeArtifacts: false }));
      if (frame < fromFrame) { warmupFrames++; continue; }
      const sha256 = Capture.digest(Capture.rasterBytes(raster.rgba(result.values.picture)));
      picture.push({ frame, sha256, matches: expected.get(frame) === sha256, graphMs: performance.now() - start, audioMs,
        timingsMs: result.report.timingsMs, draw: trace });
    }
    await audioThrough(Infinity);
  } finally {
    try { await score?.close(); project?.clear(); }
    finally { gpu.dispose(); }
  }
  const pictureMatches = picture.length === expected.size && picture.every(row => row.matches);
  const audioMatches = [...expectedAudio.keys()].every(sample => seenAudio.has(sample)) && audio.every(row => row.matches);
  const overBudget = picture.filter(row => row.graphMs + row.audioMs > 1000 / fps).map(row => row.frame);
  return { warmupFrames, picture, audio, pictureMatches, audioMatches, overBudget,
    audioUnderruns: audio.flatMap(row => row.gaps).length };
}

async function command(file, opt, settings, print) {
  const repeat = Number(opt.repeat ?? 1);
  check(Number.isInteger(repeat) && repeat >= 1 && repeat <= 8, 'Stress replay supports 1–8 repetitions');
  const capture = await load(path.resolve(file)), destination = opt.out && path.resolve(opt.out);
  const writer = destination && graphOutputs(capture.paths);
  if (destination) writer.protect(fs.statSync(destination, { throwIfNoEntry: false }));
  const runs = [];
  for (let i = 0; i < repeat; i++) runs.push(await replay(capture, opt, settings));
  const report = { format: 'ink-studio/beat-performance-stress', version: 1, fromFrame: capture.spec.fromFrame,
    toFrame: capture.spec.toFrame, frameBudgetMs: 1000 / capture.fps, capturedFaults: capture.spec.faults,
    passed: runs.every(row => row.pictureMatches && row.audioMatches), runs };
  if (destination) writer.write(path.dirname(destination), [{ file: path.basename(destination), document: report }]);
  await print(destination ? { ...report, runs: runs.map(({ picture, audio, ...row }) => ({
    ...row, pictureFrames: picture.length, audioBlocks: audio.length
  })) } : report);
  if (!report.passed) process.exitCode = 2;
}

module.exports = { command };
