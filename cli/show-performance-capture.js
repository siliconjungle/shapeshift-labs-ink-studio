const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { stageAt } = require('./recorded-presentation.js');

const format = 'ink-studio/beat-performance-case';
const runFormat = 'ink-studio/beat-performance-run';
const maxFrames = 36000, maxInputs = 8 * 1024 ** 2, maxVideo = 64 * 1024 ** 2, maxAudio = 2 * 1024 ** 2;
const relative = (folder, file) => path.relative(folder, file).split(path.sep).join('/');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rasterBytes = ({ data }) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);

async function fingerprints(files, folder) {
  const result = [];
  for (const file of new Set(files.filter(Boolean))) {
    const hash = createHash('sha256');
    for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
    result.push({ file: relative(folder, file), sha256: hash.digest('hex') });
  }
  return result;
}

function create(directory, config, source) {
  if (fs.lstatSync(directory, { throwIfNoEntry: false })) throw new Error('Choose a new performance capture directory');
  const radius = Math.max(3, Math.ceil(config.fps * .25));
  const keep = radius * 4 + 12, cases = [], ring = [], audioRing = [], timeline = [], controls = [], video = [], audioBoundaries = [];
  const controlKeys = new Map(), videoKeys = new WeakMap();
  let inputsBytes = 0, videoBytes = 0, audioBytes = 0, omitted = 0, unavailable, unavailableFrom, audioFallback = false, last = 0;

  function addAudio(interval, { block, bytes }) {
    if (block.fromFrame >= interval.to || block.toFrame <= interval.from) return;
    if (interval.audio.length < 2048 && interval.audioBytes + bytes <= maxAudio) {
      interval.audio.push(block);
      interval.audioBytes += bytes;
    } else interval.omittedAudio++;
  }

  function issue(fault) {
    const { fromFrame } = fault;
    if (!Number.isSafeInteger(fromFrame) || fromFrame < 0) return;
    const from = Math.max(0, fromFrame - radius), to = Math.min(config.frames, fromFrame + radius + 1);
    const related = cases.find(row => fromFrame >= row.from && fromFrame < row.to && last <= row.to + keep);
    if (related) {
      if (related.faults.length < 32) related.faults.push(fault);
      else related.omittedFaults++;
      return;
    }
    if (cases.length === 8) { omitted++; return; }
    const interval = { from, to, faults: [fault], omittedFaults: 0,
      pictures: ring.filter(row => row.frame >= from && row.frame < to), audio: [], audioBytes: 0, omittedAudio: 0 };
    for (const row of audioRing) addAudio(interval, row);
    cases.push(interval);
  }

  function inputsIndex(inputs) {
    const key = JSON.stringify(inputs);
    if (controlKeys.has(key)) return controlKeys.get(key);
    inputsBytes += Buffer.byteLength(key);
    if (inputsBytes > maxInputs) { unavailable = 'recorded-controls-exceeded-budget'; return null; }
    const index = controls.length;
    controls.push(JSON.parse(key));
    controlKeys.set(key, index);
    return index;
  }

  function videoIndex(frame) {
    if (!frame) return null;
    if (videoKeys.has(frame)) return videoKeys.get(frame);
    videoBytes += frame.data.byteLength;
    if (videoBytes > maxVideo) { unavailable = 'recorded-video-exceeded-budget'; return null; }
    const index = video.length;
    videoKeys.set(frame, index);
    video.push({ width: frame.width, height: frame.height, bytes: Buffer.from(frame.data) });
    return index;
  }

  function request(frame, inputs, media, seed) {
    last = Math.max(last, frame + 1);
    if (timeline.length >= maxFrames) unavailable ??= 'recorded-frame-sequence-exceeded-budget';
    if (unavailable) { unavailableFrom ??= frame; return; }
    const controls = inputsIndex(inputs), image = videoIndex(media);
    if (!unavailable) timeline.push({ frame, controls, video: image, seed });
    else unavailableFrom ??= frame;
  }

  function picture(row, raster) {
    const sample = { ...row, sha256: digest(rasterBytes(raster)) };
    ring.push(sample);
    while (ring.length && ring[0].frame < row.frame - keep) ring.shift();
    for (const interval of cases)
      if (row.frame >= interval.from && row.frame < interval.to) interval.pictures.push(sample);
  }

  function audio(block, frameOf) {
    for (const gap of block.gaps)
      if (!gap.recovered) issue({ kind: 'audio-underrun', channel: 'live-score', fromFrame: frameOf(gap.sample),
        toFrame: frameOf(gap.sample) + 1, sample: gap.sample, sourceSample: gap.sourceSample, sampleRate: block.sampleRate,
        resource: gap.resource, ...(gap.part && { part: gap.part }), ...(gap.beatId && { beatId: gap.beatId }),
        voices: gap.voices });
    const row = { block, bytes: Buffer.byteLength(JSON.stringify(block)) };
    audioRing.push(row);
    audioBytes += row.bytes;
    while (audioRing.length && (audioBytes > 2 * maxAudio || audioRing.length > 4096 ||
      audioRing[0].block.toFrame < block.fromFrame - keep)) audioBytes -= audioRing.shift().bytes;
    for (const interval of cases) addAudio(interval, row);
  }

  function beatsFor(from, to, links, faults) {
    const planned = (config.beatAnchors ?? []).filter(row => row.fromFrame < to && row.toFrame > from);
    const authored = config.cues.filter(row => row.beatId && row.frame >= from && row.frame < to)
      .map(row => ({ beatId: row.beatId, fromFrame: row.frame, toFrame: row.frame + 1, preset: row.preset, alignment: 'cue' }));
    const direct = faults.filter(row => row.beatId).map(row => ({
      beatId: row.beatId, fromFrame: row.fromFrame, toFrame: row.toFrame, alignment: 'audio'
    }));
    return [...direct, ...links, ...authored, ...planned].slice(0, 96);
  }

  async function finish(summary, dependencies) {
    const stage = stageAt(directory);
    try {
      const first = timeline[0]?.frame ?? Infinity;
      const referenced = cases.filter(row => first < row.to);
      const uses = Math.max(0, ...referenced.map(row => row.to));
      const kept = timeline.filter(row => row.frame < uses);
      let run = null;
      if (referenced.length && kept.length) {
        const assets = [];
        for (let index = 0; index <= Math.max(-1, ...kept.map(row => row.video ?? -1)); index++) {
          const item = video[index], file = 'video/' + index + '.rgba';
          stage.save(file, item.bytes);
          assets.push({ file, width: item.width, height: item.height, sha256: digest(item.bytes) });
        }
        const audioEnd = audioBoundaries.findIndex(boundary => boundary >= uses);
        run = { format: runFormat, version: 1, patch: relative(directory, config.patch), output: config.output,
          rate: String(config.rate), frameBudgetMs: 1000 / config.fps, frames: kept,
          inputs: controls.slice(0, 1 + Math.max(...kept.map(row => row.controls))),
          audioBoundaries: audioBoundaries.slice(0, audioEnd < 0 ? audioBoundaries.length : audioEnd + 1),
          framesInShow: Number.isFinite(config.frames) ? config.frames : null, videoFrames: assets,
          projectHash: source.projectHash, fingerprint: source.fingerprint, files: source.files,
          ...(source.gpuModule && { gpuModule: relative(directory, source.gpuModule) }),
          ...(config.audio && { staticAudio: { file: config.audio === 'video' ? 'video' : relative(directory, config.audio),
            ...(config.audio === 'video' && { video: relative(directory, config.video) }), fallback: audioFallback } }),
          ...(source.score && { score: { recipe: relative(directory, source.score.recipe), route: relative(directory, source.score.route) } }) };
        stage.save('run.json', JSON.stringify(run) + '\n');
      }
      const rows = cases.map((row, i) => {
        const file = 'case-' + String(i + 1).padStart(2, '0') + '.json';
        const { from, to, faults, pictures, audio, omittedFaults, omittedAudio } = row;
        const links = pictures.flatMap(row => row.beats);
        const beats = beatsFor(from, to, links, faults);
        const canReplay = run && (pictures.length > 0 || audio.length > 0) && (unavailableFrom === undefined || unavailableFrom >= to);
        const replay = canReplay ? { run: 'run.json' } : null;
        const incidents = faults.map(fault => ({ ...fault,
          beats: beats.filter(beat => beat.fromFrame < fault.toFrame && beat.toFrame > fault.fromFrame).slice(0, 32) }));
        stage.json(file, { format, version: 1, fromFrame: from, toFrame: to, frameBudgetMs: 1000 / config.fps,
          status: summary.reason, faults: incidents, beats, picture: pictures, audio: { blocks: audio, omitted: omittedAudio },
          omittedFaults, replay, ...(!replay && { unavailable: unavailable ?? 'no-work-in-capture-window' }) });
        return { file, fromFrame: from, toFrame: to, faults: faults.length, replayable: Boolean(replay) };
      });
      const result = { format: 'ink-studio/beat-performance-capture', version: 1, cases: rows, omitted };
      stage.json('report.json', result);
      if (fs.lstatSync(directory, { throwIfNoEntry: false })) throw new Error('Performance capture directory was created during the show');
      stage.publish(dependencies);
      return result;
    } finally { stage.close(); }
  }

  return { request, picture, audio, issue,
    audioBoundary(frame) { if (audioBoundaries.length <= maxFrames) audioBoundaries.push(frame); },
    staticFallback() { audioFallback = true; }, finish };
}

module.exports = { create, fingerprints, digest, rasterBytes, format, runFormat };
