const fs = require('node:fs');
const path = require('node:path');
const { graphOutputs } = require('./graph-outputs.js');
const { json } = require('./asset-files.js');
const { measureAttacks } = require('./audio-attacks.js');
const { recording, stimulus, fps, flashFrames } = require('./output-latency-media.js');

const planFormat = 'ink-studio/output-latency-plan', profileFormat = 'ink-studio/output-latency-profile';
const usage = [
  'output-latency signal --out pattern.mp4 [--profile output-profile.json] [--ffmpeg executable]',
  'output-latency measure <plan.json> --out output-profile.json [--report report.json] [--ffmpeg executable] [--ffprobe executable]'
];
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const record = (row, keys) => row && typeof row === 'object' && !Array.isArray(row) &&
  Object.keys(row).every(key => keys.includes(key));
const label = value => typeof value === 'string' && value.trim() && value.length <= 240;
const middle = values => {
  const sorted = [...values].sort((a, b) => a - b), k = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
};
const round = ms => Number(ms.toFixed(3));
const read = file => {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new RangeError('Calibration JSON needs a local file up to 1 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

function planSettings(plan) {
  if (!record(plan, ['format', 'version', 'output', 'recording', 'region', 'window',
    'maxOffsetMs', 'maxSpreadMs', 'recorderBiasMs', 'channel']) || plan.format !== planFormat ||
    plan.version !== 1 || typeof plan.recording !== 'string' || !plan.recording.trim())
    throw new TypeError('Expected a version 1 output latency plan with a camera recording');
  const { output, region, window, maxOffsetMs = 350, maxSpreadMs = 35, recorderBiasMs = 0, channel = 'mix' } = plan;
  const names = ['id', 'display', 'speakers', 'playback'];
  if (!record(output, names) || !names.every(key => label(output[key])) || !/^[a-z0-9][\w.-]{0,63}$/i.test(output.id))
    throw new TypeError('Give the output an id and name its display, speakers and playback path');
  if (!Array.isArray(region) || region.length !== 4 || !region.every(value => finite(value, 0, 1)) ||
      region[2] <= 0 || region[3] <= 0 || region[0] + region[2] > 1 || region[1] + region[3] > 1)
    throw new RangeError('The flash region needs normalized [left, top, width, height] inside the video');
  if (window !== undefined && (!Array.isArray(window) || window.length !== 2 ||
      !window.every(n => finite(n, 0, 20)) || window[1] - window[0] < 4))
    throw new RangeError('Use a calibration window [start, end] in seconds covering at least four seconds');
  if (!finite(maxOffsetMs, 40, 400) || !finite(maxSpreadMs, 5, 100) ||
      !finite(recorderBiasMs, -200, 200) || !(channel === 'mix' || Number.isInteger(channel) && finite(channel, 0, 7)))
    throw new RangeError('Invalid calibration offset range, spread, recorder bias or microphone channel');
  return { output, region, window, maxOffsetMs, maxSpreadMs, recorderBiasMs, channel };
}

function findFlashes(picture, window) {
  const view = window ? picture.filter(row => row.time >= window[0] && row.time < window[1]) : picture;
  const luma = view.map(row => row.luma).sort((a, b) => a - b);
  const dark = luma[Math.floor(luma.length * .2)], bright = luma[Math.floor(luma.length * .98)];
  const contrast = bright - dark, threshold = dark + contrast * .5;
  const thresholds = { dark, bright, contrast, threshold };
  const flashes = [];
  if (!(contrast >= 30)) return { thresholds, flashes, issue: 'flash-contrast-too-low' };

  for (let i = 0; i < view.length;) {
    if (view[i].luma < threshold) { i++; continue; }
    const first = i;
    while (i < view.length && view[i].luma >= threshold) i++;
    const before = view[first - 1], after = view[i], on = view[first], last = view[i - 1];
    if (!before || !after || on.time - before.time > .08 ||
        after.time - on.time < .035 || after.time - on.time > .35)
      return { thresholds, flashes, issue: 'flash-unbracketed-or-unstable' };
    flashes.push({ frame: on.frame, beforeFrame: before.frame, lastFrame: last.frame,
      fromSeconds: before.time, toSeconds: on.time, seconds: (before.time + on.time) / 2,
      halfFrameMs: (on.time - before.time) * 500 });
  }

  if (flashes.length !== flashFrames.length) return { thresholds, flashes, issue: 'wrong-flash-count' };
  for (let i = 1; i < flashes.length; i++) {
    const expected = (flashFrames[i] - flashFrames[i - 1]) / fps;
    if (Math.abs(flashes[i].seconds - flashes[i - 1].seconds - expected) > .15)
      return { thresholds, flashes, issue: 'flash-spacing-mismatch' };
  }
  return { thresholds, flashes };
}

function measureTrials(media, settings, graph) {
  const { picture, audio, audioAt } = media;
  const { channel, window, maxOffsetMs, maxSpreadMs, recorderBiasMs } = settings;
  if (channel !== 'mix' && channel >= audio.channels) throw new RangeError('Microphone channel is outside the camera audio track');
  const { thresholds, flashes, issue } = findFlashes(picture, window);
  const halfWindow = maxOffsetMs / 1000;
  const sampleAt = time => Math.ceil((time - audioAt) * audio.sampleRate);
  const trials = flashes.map(flash => {
    const search = { from: sampleAt(flash.seconds - halfWindow), to: sampleAt(flash.seconds + halfWindow), channel };
    const click = measureAttacks(graph, audio, search);
    const clickSeconds = click.hit ? audioAt + click.hit.sample / audio.sampleRate : null;
    const audioMinusPictureMs = clickSeconds === null ? null : (clickSeconds - flash.seconds) * 1000;
    return { flash, click: { ...click, seconds: clickSeconds }, audioMinusPictureMs };
  });
  const good = trials.filter(trial => trial.audioMinusPictureMs !== null);
  const offsets = good.map(trial => trial.audioMinusPictureMs);
  const detectedMedianMs = offsets.length ? middle(offsets) : null;
  const spreadMs = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null;
  const jitterMs = offsets.length ? middle(offsets.map(offset => Math.abs(offset - detectedMedianMs))) : null;
  const uncertaintyMs = offsets.length
    ? Math.max(...good.map(trial => trial.flash.halfFrameMs)) + jitterMs + 1000 / audio.sampleRate
    : null;
  const reason = issue ?? (good.length < 3 ? 'too-few-unambiguous-clicks' : spreadMs > maxSpreadMs ? 'offsets-disagree' : null);
  const offset = detectedMedianMs === null ? null : detectedMedianMs - recorderBiasMs;
  const correctionMs = !reason && Math.abs(offset) > uncertaintyMs ? offset : 0;
  return { thresholds, trials, repeatableTrials: good.length, detectedMedianMs,
    recorderBiasMs, audioMinusPictureMs: reason ? null : offset, spreadMs, uncertaintyMs, reason,
    correction: reason ? null : { pictureDelayMs: round(Math.max(0, correctionMs)), audioDelayMs: round(Math.max(0, -correctionMs)) } };
}

async function analyze(file, { kit, ffmpeg, ffprobe }) {
  const spec = read(file), settings = planSettings(spec);
  const source = path.resolve(path.dirname(file), spec.recording), stat = fs.statSync(source, { bigint: true });
  if (!stat.isFile() || stat.size < 1n || stat.size > 2n * 1024n ** 3n)
    throw new RangeError('Use an ordinary local camera recording up to 2 GiB');
  const samples = await recording(source, settings.region, { ffmpeg, ffprobe });
  const after = fs.statSync(source, { bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs'].some(key => stat[key] !== after[key]))
    throw new Error('The camera recording changed during calibration');
  const evidence = measureTrials(samples, settings, kit.KIT.procedural.mediaGraph);
  const profile = evidence.correction && { format: profileFormat, version: 1, output: settings.output,
    calibration: { recording: path.basename(source), trialCount: evidence.repeatableTrials,
      audioMinusPictureMs: round(evidence.audioMinusPictureMs), uncertaintyMs: round(evidence.uncertaintyMs),
      spreadMs: round(evidence.spreadMs), recorderBiasMs: settings.recorderBiasMs },
    correction: evidence.correction };
  const report = { format: 'ink-studio/output-latency-report', version: 1, output: settings.output,
    recording: path.basename(source), region: settings.region, window: settings.window ?? null,
    ...samples.metadata, ...evidence };
  return { profile, report, source };
}

function readCorrection(file) {
  const profile = read(file), correction = profile?.correction;
  if (profile?.format !== profileFormat || profile.version !== 1 ||
      !record(correction, ['pictureDelayMs', 'audioDelayMs']) || !finite(correction.pictureDelayMs, 0, 600) ||
      !finite(correction.audioDelayMs, 0, 600) || (correction.pictureDelayMs > 0 && correction.audioDelayMs > 0))
    throw new TypeError('Expected a measured Ink output latency profile with one nonnegative delay');
  return correction;
}

function distinctOutputs(inputs, outputs) {
  const files = graphOutputs(inputs);
  for (const name of outputs) {
    const stat = fs.statSync(name, { throwIfNoEntry: false });
    if (inputs.includes(name) || (stat && !stat.isFile())) throw new RangeError('Calibration outputs need separate regular file paths');
    files.protect(stat);
  }
  if (new Set(outputs).size !== outputs.length ||
      (outputs.length === 2 && fs.existsSync(outputs[0]) && fs.existsSync(outputs[1]) &&
        fs.realpathSync(outputs[0]) === fs.realpathSync(outputs[1])))
    throw new RangeError('The calibration profile and report need separate paths');
}

async function command(pos, opt, kit) {
  const [action, operand] = pos;
  const allowed = action === 'signal' ? ['out', 'profile', 'ffmpeg'] : ['out', 'report', 'ffmpeg', 'ffprobe'];
  if (!(action === 'signal' && pos.length === 1 || action === 'measure' && pos.length === 2) ||
      typeof opt.out !== 'string' || !Object.entries(opt).every(([key, value]) => allowed.includes(key) && label(value)))
    throw new TypeError(usage.join('\n'));
  const out = path.resolve(opt.out);
  if (action === 'signal') {
    const profile = opt.profile && path.resolve(opt.profile);
    if (!/\.mp4$/i.test(out)) throw new TypeError('The calibration signal output needs an .mp4 filename');
    distinctOutputs(profile ? [profile] : [], [out]);
    const applied = stimulus(out, profile ? readCorrection(profile) : undefined, opt.ffmpeg);
    console.log('wrote', out, 'with picture delay', round(applied.pictureDelayMs), 'ms and audio delay', round(applied.audioDelayMs), 'ms');
    return;
  }

  const file = path.resolve(operand), reportFile = opt.report && path.resolve(opt.report);
  const { profile, report, source } = await analyze(file, { kit, ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe });
  distinctOutputs([file, source], reportFile ? [out, reportFile] : [out]);
  if (reportFile) json(reportFile, report);
  if (!profile) {
    console.error('Calibration needs review (' + report.reason + '). Profile was left untouched.');
    if (!reportFile) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 2;
    return;
  }
  json(out, profile);
  const { correction, calibration } = profile;
  console.log('Measured audio minus picture', calibration.audioMinusPictureMs, 'ms, uncertainty ±' + calibration.uncertaintyMs, 'ms');
  console.log('Saved', out, 'with picture delay', correction.pictureDelayMs, 'ms and audio delay', correction.audioDelayMs, 'ms');
}

module.exports = { command, usage };
