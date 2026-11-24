const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const PNG = require('./png.js');
const { nativeVideoFrames } = require('./patch-media.js');
const { sourcePixels, nativeArt } = require('./video-approval.js');
const { probe } = require('./video-approval-probe.js');
const { readTakePicture } = require('./take-picture.js');
const { stageAt } = require('./recorded-presentation.js');
const { scanner, matchingEnergy, improves } = require('./flash-flicker-metrics.js');

const format = 'ink-studio/flash-flicker-review';
const usage = 'take review-flashes <plan.json> --out <new-directory> [--ffmpeg executable] [--ffprobe executable] [--fail-on-flags]';
const finite = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const integer = (n, lo, hi) => Number.isInteger(n) && finite(n, lo, hi);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));
function check(condition, message) {
  if (!condition) throw new RangeError(message);
}

function prepare(file, kit) {
  check(fs.statSync(file).size <= 1024 * 1024, 'Flash review plan exceeds 1 MiB');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(fields(spec, ['format', 'version', 'picture', 'delivery', 'scale', 'sources', 'alternate', 'thresholds', 'preview']) &&
    spec.format === format && spec.version === 1 && text(spec.delivery), 'Expected a version 1 flash flicker review plan');
  const scale = spec.scale ?? 1;
  check(integer(scale, 1, 16), 'Use an integer delivery scale from 1 to 16');

  const defaults = { minLumaDelta: .12, minRedDelta: .22, minArea: .08, maxPulseSeconds: .33, windowSeconds: 1, minFlashes: 3 };
  check(spec.thresholds === undefined || fields(spec.thresholds, Object.keys(defaults)), 'Invalid flash thresholds');
  const thresholds = { ...defaults, ...spec.thresholds };
  const { minLumaDelta, minRedDelta, minArea, maxPulseSeconds, windowSeconds, minFlashes } = thresholds;
  check(finite(minLumaDelta, .02, .9) && finite(minRedDelta, .02, .9) && finite(minArea, .001, 1) &&
    finite(maxPulseSeconds, .05, .8) && finite(windowSeconds, .25, 2) &&
    maxPulseSeconds <= windowSeconds && integer(minFlashes, 2, 12), 'Flash thresholds are outside the review range');
  check(spec.preview === undefined || fields(spec.preview, ['reduction', 'crf']), 'Invalid flash preview options');
  const preview = { reduction: .7, crf: 18, ...spec.preview };
  check(finite(preview.reduction, .05, 1) && integer(preview.crf, 0, 40), 'Use a preview reduction from .05 to 1 and CRF from 0 to 40');

  const root = path.dirname(file), delivery = path.resolve(root, spec.delivery);
  const inputs = new Set([file, delivery]), T = kit.KIT.procedural.takeTime;
  const read = value => readTakePicture(value, file, kit, source => inputs.add(source));
  const picture = read(spec.picture);
  const { frames, firstFrame, rate } = picture, fps = T.seconds(rate);
  check(frames.length >= 3 && frames.length <= 720 && fps <= 120, 'Review 3–720 picture frames at up to 120 fps');
  const variants = spec.sources ?? [];
  check(Array.isArray(variants) && variants.length <= 8, 'Review up to eight source ablations');
  const ids = new Set();
  function aligned(value) {
    const other = read(value);
    check(other.firstFrame === firstFrame && other.frames.length === frames.length && T.compare(other.rate, rate) === 0,
      'Every ablation and alternate must match the source frame range and rate');
    return other;
  }
  const sources = variants.map(row => {
    check(fields(row, ['id', 'kind', 'without']) && typeof row.id === 'string' &&
      /^[a-z][\w.:-]{0,95}$/i.test(row.id) && !ids.has(row.id) &&
      (row.kind === 'light' || row.kind === 'effect'), 'Each source needs a unique authored ID, kind and a render with that source disabled');
    ids.add(row.id);
    return { id: row.id, kind: row.kind, picture: aligned(row.without) };
  });
  const alternate = spec.alternate === undefined ? null : aligned(spec.alternate);
  const [n, d] = rate;
  return { picture, delivery, scale, thresholds, preview, sources, alternate, inputs, fps, rateText: n + '/' + d };
}

const stamp = file => fs.statSync(file, { bigint: true });
function unchanged(file, previous) {
  const now = stamp(file);
  check(['ino', 'dev', 'size', 'mtimeNs'].every(key => previous[key] === now[key]), 'Delivery changed during the flash review');
}

function pictureFrame(picture, width, height, i, hash) {
  return sourcePixels(picture.frames[i], width, height, hash, picture.hashes?.[i]);
}

function scanPicture(settings, picture, width, height) {
  const scan = scanner(width, height, settings.fps, settings.thresholds);
  const hash = createHash('sha256');
  for (let i = 0; i < picture.frames.length; i++) scan.sample(pictureFrame(picture, width, height, i, hash), i);
  return { ...scan.finish(), sha256: hash.digest('hex') };
}

async function scanDelivery(file, info, settings, count, ffmpeg, heat = false) {
  const { width, height } = info, { scale } = settings;
  const scan = scanner(width / scale, height / scale, settings.fps, settings.thresholds, heat);
  let frame = 0;
  for await (const pixels of nativeVideoFrames(file, { width, height, executable: ffmpeg })) {
    check(frame < count, 'Delivery decoder produced extra frames');
    scan.sample(nativeArt(pixels.data, width / scale, height / scale, scale), frame++);
  }
  check(frame === count, 'Delivery decoder returned an incomplete sequence');
  return scan.finish();
}

function clockedSummary(track, firstFrame) {
  const { windows, ...summary } = track.summary;
  return { ...summary, windows: windows.map(row => ({ ...row, from: firstFrame + row.from, to: firstFrame + row.to })) };
}

function describeEvents(delivered, composed, sources, settings, pts) {
  const first = settings.picture.firstFrame, cuts = settings.picture.cuts;
  return delivered.qualified.map(event => {
    const { tiles: _tiles, from, peak, frame, ...measurement } = event;
    const sourceEnergy = matchingEnergy(event, composed);
    const origin = sourceEnergy <= event.energy * .05 ? 'delivery-only'
      : sourceEnergy < event.energy * .9 ? 'delivery-amplified' : 'composited';
    const contributors = sources.flatMap(({ id, kind, track }) => {
      const remaining = matchingEnergy(event, track), removed = sourceEnergy - remaining;
      return removed > Math.max(.000001, sourceEnergy * .02) ? [{ id, kind, removedEnergy: removed }] : [];
    }).sort((a, b) => b.removedEnergy - a.removedEnergy);
    return { ...measurement, from: first + from, peak: first + peak, frame: first + frame, pts: pts[frame],
      crossesEdit: cuts.some(cut => cut >= first + from && cut <= first + frame),
      origin, sourceEnergy, contributors };
  });
}

function encode(file, width, height, settings, sourceHash, variant, amount, ffmpeg) {
  const project = settings.picture;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-flash-preview-'));
  const basisHash = createHash('sha256'), variantHash = createHash('sha256');
  try {
    for (let i = 0; i < project.frames.length; i++) {
      const basis = pictureFrame(project, width, height, i, basisHash);
      let rgb = basis;
      if (variant) {
        const other = pictureFrame(variant.picture, width, height, i, variantHash);
        if (amount === 1) rgb = other;
        else for (let byte = 0; byte < rgb.length; byte++)
          rgb[byte] = Math.round(basis[byte] * (1 - amount) + other[byte] * amount);
      }
      PNG.write(path.join(directory, String(i).padStart(4, '0') + '.png'), width, height, rgb);
    }
    check(basisHash.digest('hex') === sourceHash &&
      (!variant || variantHash.digest('hex') === variant.track.sha256), 'Composited frames changed during the flash review');
    const outputWidth = width * settings.scale, outputHeight = height * settings.scale;
    const pixelFormat = outputWidth % 2 || outputHeight % 2 ? 'yuv444p' : 'yuv420p';
    execFileSync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', settings.rateText,
      '-i', path.join(directory, '%04d.png'), '-vf', 'scale=' + outputWidth + ':' + outputHeight + ':flags=neighbor',
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', String(settings.preview.crf),
      '-threads', '1', '-pix_fmt', pixelFormat, '-movflags', '+faststart', file],
    { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.stderr?.length) throw new Error('Flash preview encode failed. ' + error.stderr.toString().trim());
    throw error;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function frameAt(file, info, scale, index, ffmpeg) {
  let i = 0;
  for await (const pixels of nativeVideoFrames(file, { width: info.width, height: info.height, executable: ffmpeg }))
    if (i++ === index) return nativeArt(pixels.data, info.width / scale, info.height / scale, scale);
  throw new Error('Decoded clip did not contain its reported evidence frame');
}

function heatmap(rgb, heat) {
  const pixels = new Uint8Array(rgb.length);
  let maximum = 0;
  for (const n of heat) maximum = Math.max(maximum, n);
  const orange = [255, 150, 69];
  for (let i = 0; i < heat.length; i++) {
    const at = i * 3, gray = (.2126 * rgb[at] + .7152 * rgb[at + 1] + .0722 * rgb[at + 2]) * .42;
    const intensity = maximum ? Math.sqrt(heat[i] / maximum) : 0;
    for (let k = 0; k < 3; k++) pixels[at + k] = Math.round(gray * (1 - intensity) + orange[k] * intensity);
  }
  return pixels;
}

async function previewOf(stage, settings, composed, delivered, candidates, width, height, ffmpeg, ffprobe) {
  const count = settings.picture.frames.length;
  const ranked = candidates.filter(row => improves(composed.summary, row.track.summary)).sort((a, b) =>
    a.track.summary.peakCount - b.track.summary.peakCount || a.track.summary.peakEnergy - b.track.summary.peakEnergy);
  const reduction = settings.preview.reduction, attempts = [];
  for (const variant of ranked.slice(0, 3)) {
    attempts.push({ variant, amount: reduction });
    if (reduction < 1) attempts.push({ variant, amount: 1 });
  }
  if (improves(delivered.summary, composed.summary)) attempts.push({ variant: null, amount: 0 });
  const file = stage.at('candidate.mp4'), fallback = stage.at('fallback.mp4');
  let provisional;
  function accept(file, result) {
    fs.renameSync(file, stage.reserve(result.report.file));
    return { info: result.info, report: result.report };
  }
  try {
    for (const { variant, amount } of attempts) {
      if (provisional && provisional.variant !== variant) break;
      encode(file, width, height, settings, composed.sha256, variant, amount, ffmpeg);
      const info = probe(file, ffprobe, settings.picture.rate, count);
      const track = await scanDelivery(file, info, settings, count, ffmpeg);
      if (!improves(delivered.summary, track.summary)) continue;
      const result = { variant, info, report: { file: 'preview.mp4', source: variant?.id ?? null,
        change: variant?.kind ?? 're-encode', reduction: amount, codec: info.codec, pixelFormat: info.pixelFormat,
        crf: settings.preview.crf, decoded: clockedSummary(track, settings.picture.firstFrame) } };
      if (track.summary.peakCount < delivered.summary.peakCount || !track.summary.windows.length)
        return accept(file, result);
      if (!provisional) {
        fs.renameSync(file, fallback);
        provisional = result;
      }
    }
    return provisional ? accept(fallback, provisional) : null;
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(fallback, { force: true });
  }
}

function mediaLink(directory, file) {
  return path.relative(directory, file).split(path.sep).map(encodeURIComponent).join('/');
}

async function review(file, directory, { kit, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' }) {
  const settings = prepare(file, kit);
  const { picture, delivery, fps, thresholds, scale, inputs } = settings;
  const count = picture.frames.length, first = picture.firstFrame, input = stamp(delivery);
  check(input.isFile() && input.size > 0n && input.size <= 4n * 1024n ** 3n, 'Use a bounded local delivery file');
  const info = probe(delivery, ffprobe, picture.rate, count);
  const { width: outWidth, height: outHeight, timestamps, ...codec } = info;
  const width = outWidth / scale, height = outHeight / scale;
  check(Number.isInteger(width) && Number.isInteger(height), 'Delivery raster does not match the declared integer scale');
  check(count * outWidth * outHeight <= 540e6 &&
    count * width * height * (5 + settings.sources.length + Number(Boolean(settings.alternate))) <= 540e6,
    'Flash review exceeded its pixel budget. Use a shorter excerpt or a lower native art resolution.');

  const composed = scanPicture(settings, picture, width, height);
  const delivered = await scanDelivery(delivery, info, settings, count, ffmpeg, true);
  const sources = settings.sources.map(row => ({ ...row, track: scanPicture(settings, row.picture, width, height) }));
  const candidates = [...sources];
  if (settings.alternate) candidates.push({ id: null, kind: 'authored-alternate', picture: settings.alternate,
    track: scanPicture(settings, settings.alternate, width, height) });
  const events = describeEvents(delivered, composed, sources, settings, timestamps);
  const stage = stageAt(directory);
  try {
    const preview = delivered.summary.peakEnergy
      ? await previewOf(stage, settings, composed, delivered, candidates, width, height, ffmpeg, ffprobe) : null;
    const hotspot = delivered.qualified.reduce((a, b) => !a || b.energy > a.energy ? b : a, null);
    let evidence = null;
    if (hotspot) {
      const peak = hotspot.peak;
      const original = await frameAt(delivery, info, scale, peak, ffmpeg);
      stage.save('delivery.png', PNG.encode(width, height, original));
      stage.save('heatmap.png', PNG.encode(width, height, heatmap(original, delivered.heat)));
      evidence = { frame: first + peak, delivery: 'delivery.png', heatmap: 'heatmap.png' };
      if (preview) {
        const reduced = await frameAt(stage.at(preview.report.file), preview.info, scale, peak, ffmpeg);
        stage.save('preview.png', PNG.encode(width, height, reduced));
        evidence.preview = 'preview.png';
      }
    }
    unchanged(delivery, input);
    const report = {
      format: format + '-report', version: 1, status: delivered.summary.windows.length ? 'flagged' : 'reviewed',
      source: { firstFrame: first, endFrame: first + count, fps, frameSetSha256: composed.sha256, width, height },
      delivery: { video: mediaLink(directory, delivery), width: outWidth, height: outHeight,
        firstPts: timestamps[0], lastPts: timestamps.at(-1), ...codec }, thresholds,
      composited: clockedSummary(composed, first), decoded: clockedSummary(delivered, first),
      sources: sources.map(({ id, kind, track }) => ({ id, kind, without: clockedSummary(track, first) })),
      events, evidence, preview: preview?.report ?? null
    };
    stage.json('report.json', report);
    const template = fs.readFileSync(path.join(__dirname, 'flash-flicker-review.html'), 'utf8');
    stage.save('index.html', template.replace('/* REPORT */ {}', () => JSON.stringify(report).replace(/</g, '\\u003c')));
    check(!fs.lstatSync(directory, { throwIfNoEntry: false }), 'Flash review output was created by another process');
    stage.publish(inputs);
    return report;
  } finally { stage.close(); }
}

async function command(file, opt, { kit }) {
  check(text(file) && text(opt.out) && Object.entries(opt).every(([key, value]) =>
    key === 'fail-on-flags' ? value === true : ['out', 'ffmpeg', 'ffprobe'].includes(key) && text(value)), 'Use ' + usage);
  const directory = path.resolve(opt.out);
  check(!fs.lstatSync(directory, { throwIfNoEntry: false }), 'Choose a new directory for flash review output');
  const report = await review(path.resolve(file), directory, { kit, ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe });
  console.log('Flash review', report.status, 'with', report.decoded.pulses, 'decoded pulses and', report.decoded.windows.length, 'flagged intervals');
  if (report.preview) console.log('Verified a lower-flicker preview');
  console.log('wrote', directory);
  if (report.status === 'flagged' && opt['fail-on-flags']) process.exitCode = 2;
}

module.exports = { command, usage };
