const { render, sequenceHistory } = require('./render.js');
const { prepareReview, compositeMatte } = require('./readability-review.js');
const { prepareChecks, measureChecks } = require('./palette-checks.js');
const { comparisonSettings, compareFrames } = require('./transition-review.js');
const { pose: poseScene } = require('./diarama-pose.js');

const format = 'ink-studio/shot-approval';
const categories = ['palette', 'silhouette', 'motion', 'transition', 'performance'];
const motionKinds = ['loop-pop', 'spacing-spike', 'arc-kink', 'foot-drift'];
const performanceMetrics = {
  frameMs: stats => stats.frameMs,
  splatRows: stats => stats.splatRows,
  rasterPasses: stats => stats.rasterPasses,
  fragments: stats => stats.fragments,
  translucentFragments: stats => stats.translucentFragments,
  peakDeferredFragments: stats => stats.peakDeferredFragments,
  volumeSamples: stats => stats.volume.densitySamples,
  volumeMarchSteps: stats => stats.volume.marchSteps,
  cloudSamples: stats => stats.volume.cloudSamples
};
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function settings(input, allowed, label) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError('Invalid ' + label);
  return input;
}

function prepare(input, view, kit, frame) {
  const {
    from = 0, fps = 12, frames, warmup = 0, width = 320, height = 180, pixelSize = 1,
    subjects, thresholds, matte = '#000000', palette = [], silhouette = [], cuts = [],
    motion = {}, transition = {}, performance = {}
  } = settings(input, ['from', 'fps', 'frames', 'warmup', 'width', 'height', 'pixelSize',
    'subjects', 'thresholds', 'matte', 'palette', 'silhouette', 'cuts', 'motion', 'transition', 'performance'], 'shot approval plan');
  const w = view.w ?? width, h = view.h ?? height, px = view.px ?? pixelSize;
  if (!integer(frames, 1, 4096) || !integer(warmup, 0, 4096) ||
      frame !== undefined && !integer(frame, 0, frames - 1) ||
      !integer(w, 1, 8192) || !integer(h, 1, 8192) || !integer(px, 1, Math.min(w, h)) ||
      !Number.isFinite(from) || from < 0 || from > 3600)
    throw new RangeError('Shot approval needs valid dimensions, a nonnegative start, up to 4096 frames and an in-range focus frame');
  const clock = kit.KIT.timeDomains.take({ fps, cuts });
  const end = clock.at(frames - 1);
  const count = frame === undefined ? frames : frame + 1;
  if (end.fps > 240 || from + end.end > 3600 || from + end.end === from ||
      cuts.some(cut => cut.frame >= frames) || Math.ceil(w / px) * Math.ceil(h / px) * (count + warmup) > 96e6)
    throw new RangeError('Shot approval exceeds its frame, time, cut, or pixel budget');

  if (!Array.isArray(palette) || !Array.isArray(silhouette))
    throw new TypeError('Shot approval palette and silhouette checks need lists');
  if (view.raw && palette.length) throw new RangeError('Palette approval needs a palette-enabled render');
  if (!/^#[a-f0-9]{6}$/i.test(matte)) throw new TypeError('Shot approval matte must be a #rrggbb color');
  let subjectReview, subjectChecks = [];
  if (palette.length || silhouette.length) {
    subjectReview = prepareReview({ subjects, thresholds, matte }, from);
    subjectChecks = prepareChecks([
      ...palette.map(row => ({ ...settings(row, ['id', 'subject', 'swatch', 'minPixels', 'minShare'], 'approval swatch check'), type: 'swatch' })),
      ...silhouette.map(row => ({ ...settings(row, ['id', 'subject', 'minSamples', 'minPixels', 'minColorP10', 'minLightnessP10',
        'maxWeakColorShare', 'maxWeakLightnessShare', 'maxCroppedEdges'], 'approval silhouette check'), type: 'readability' }))
    ], subjectReview);
  }
  const motionSettings = motion === false ? false : settings(motion, ['start', 'kinds', 'required'], 'approval motion settings');
  if (motionSettings) {
    const { start = 0, kinds = motionKinds, required = false } = motionSettings;
    if (!Number.isFinite(start) || start < 0 || !Array.isArray(kinds) || !kinds.length ||
        !Array.from(kinds).every(kind => motionKinds.includes(kind)) || new Set(kinds).size !== kinds.length ||
        typeof required !== 'boolean') throw new TypeError('Invalid approval motion start, kinds or required setting');
  }
  const comparison = transition === false ? false : comparisonSettings(
    settings(transition, ['thresholds', 'paletteMode'], 'approval transition settings').thresholds, transition.paletteMode);
  const budgets = performance === false ? false : settings(performance, Object.keys(performanceMetrics), 'approval performance budgets');
  if (budgets && Object.entries(budgets).some(([key, max]) =>
    !Number.isFinite(max) || max < 0 || key !== 'frameMs' && !Number.isSafeInteger(max)))
    throw new RangeError('Approval performance budgets must be nonnegative maximums');
  return { from, frames, count, warmup, w, h, px, clock, matte, subjectReview, subjectChecks, motionSettings, comparison, budgets };
}

function findMotion(world, plan) {
  const findings = new Map(), source = world.motionReview;
  if (!plan.motionSettings) return { findings, configured: false };
  const { start = 0, kinds = motionKinds, required = false } = plan.motionSettings;
  if (!Array.isArray(source?.findings)) {
    if (required) throw new TypeError('Shot approval requires an authored Motion Review');
    return { findings, configured: false };
  }
  const end = plan.from + plan.clock.at(plan.frames - 1).end;
  for (const issue of source.findings) {
    const sceneTime = start + issue.time;
    if (!kinds.includes(issue.kind) || sceneTime < plan.from - 1e-9 || sceneTime > end + 1e-9 ||
        sceneTime >= end - 1e-9 && issue.kind !== 'loop-pop') continue;
    const offset = Math.max(0, sceneTime - plan.from);
    const { frame } = plan.clock.locate(offset + 1e-10);
    // Use the first visible sample at or after the finding, or the tail for a loop seam.
    const index = Math.min(plan.frames - 1, frame + Number(plan.clock.at(frame).start < offset - 1e-9));
    if (index >= plan.count) continue;
    if (!findings.has(index)) findings.set(index, []);
    findings.get(index).push({ category: 'motion', check: issue.kind, subject: issue.name ?? issue.part ?? issue.probe,
      evidence: { ...issue, sceneTime, focus: source.focus?.(issue.id, { before: true })?.evidence } });
  }
  return { findings, configured: true };
}

function transitionImage(image, matte) {
  const frame = compositeMatte(image, matte);
  const palette = new Set();
  for (let i = 0; i < frame.rgb.length; i += 3)
    palette.add((frame.rgb[i] << 16) | (frame.rgb[i + 1] << 8) | frame.rgb[i + 2]);
  return { w: frame.w, h: frame.h, rgb: frame.rgb, palette };
}

function approveShot(world, {
  plan = world.shotApproval, view = {}, frame: focus, camera, pose, capture, kit = require('../index.js').load()
} = {}) {
  const prepared = prepare(plan, view, kit, focus);
  const { from, frames, count, warmup, w, h, px, clock, matte, subjectReview, subjectChecks, comparison, budgets } = prepared;
  const motion = findMotion(world, prepared);
  const definitions = new Map(subjectChecks.map(({ definition }) => [definition.id, definition]));
  const configured = [subjectChecks.some(check => check.definition.type === 'swatch'),
    subjectChecks.some(check => check.definition.type === 'readability'), motion.configured, !!comparison, !!budgets];
  const checks = Object.fromEntries(categories.map((category, i) => [category, {
    status: configured[i] ? 'passed' : 'not-configured', evaluations: 0, failures: 0
  }]));
  if (budgets && Object.keys(budgets).length === 0) checks.performance.status = 'measured';
  const samples = [], findings = [];
  let history = sequenceHistory(kit.KIT), previous, evidence, warmupRendered = 0;
  const setPose = pose ?? ((world, time) => poseScene(world, time, { kit, artDirection: view.artDirection }));
  const selectors = subjectReview?.subjects.map(subject => subject.select);

  for (let index = -warmup; index < count; index++) {
    const timing = clock.at(Math.abs(index));
    const time = from + (index < 0 ? -timing.start : timing.start);
    if (time < 0) continue;
    const cut = index >= 0 && timing.cut;
    if (cut && index > 0) history = sequenceHistory(kit.KIT);
    setPose(world, time);
    let subjectFrame, cameraSample;
    const reportFrame = index >= 0;
    const image = render(world, { ...view, ...history, ...camera?.(Math.max(0,index) / Math.max(1, frames - 1)),
      t: time, w, h, px, renderStats: reportFrame && !!budgets,
      passes: reportFrame && selectors ? ['depth'] : false,
      readabilitySelectors: reportFrame ? selectors : undefined,
      captureReadabilityFrame: frame => { subjectFrame = frame; },
      shotFrame: frame => { cameraSample = frame; }
    });
    if (!reportFrame) { warmupRendered++; continue; }
    const location = { frame: index, time, shot: timing.shot, cut, camera: cameraSample?.camera, skyTime: cameraSample?.skyTime,
      art: { width: image.w, height: image.h, pixelSize: image.px } };
    const frame = { ...location };
    const rows = [];
    let marked;
    function record(category, check, subject, evidence) {
      rows.push({ category, check, subject, ...location, evidence });
      checks[category].status = 'failed';
      checks[category].failures++;
    }
    if (subjectReview) {
      if (!subjectFrame) throw new Error('Shot approval could not capture the native subject mask');
      const { subjects, thresholds } = subjectReview;
      const measured = measureChecks(subjectFrame, subjects, thresholds, matte, subjectChecks);
      marked = measured.marked;
      frame.subjects = measured.results;
      for (const row of measured.results) {
        const definition = definitions.get(row.id);
        const category = definition.type === 'swatch' ? 'palette' : 'silhouette';
        checks[category].evaluations++;
        if (!row.passed) record(category, row.id, definition.subject, row);
      }
    }
    if (motion.configured) checks.motion.evaluations++;
    for (const row of motion.findings.get(index) ?? [])
      record(row.category, row.check, row.subject, row.evidence);
    const comparisonFrame = comparison && transitionImage(image, matte);
    if (previous && comparison && !cut) {
      if (previous.comparisonFrame.w !== comparisonFrame.w || previous.comparisonFrame.h !== comparisonFrame.h)
        throw new RangeError('Shot approval needs a consistent export art grid between cuts');
      frame.transition = { from: index - 1, ...compareFrames(previous.comparisonFrame, comparisonFrame, comparison) };
      checks.transition.evaluations++;
      for (const flag of frame.transition.flags)
        record('transition', flag.kind, timing.shot ?? 'shot', { ...flag, previousFrame: index - 1 });
    }
    if (budgets) {
      const measured = Object.fromEntries(Object.entries(performanceMetrics).map(([key, measure]) => [key, measure(image.renderStats)]));
      frame.performance = measured;
      checks.performance.evaluations++;
      for (const [metric, max] of Object.entries(budgets))
        if (measured[metric] > max) record('performance', metric, timing.shot ?? 'frame renderer',
          { metric, value: measured[metric], max, ...(metric === 'frameMs' && { hostDependent: true }) });
    }
    capture?.(image, location);
    samples.push(frame);
    findings.push(...rows);
    if (focus === index || focus === undefined && !evidence && (rows.length || index === count - 1)) {
      evidence = { frame: index, image, ...(previous && !cut && { previous: previous.image }), ...(marked && { marked }) };
    }
    previous = { image, comparisonFrame };
  }
  if (comparison && checks.transition.evaluations === 0) checks.transition.status = 'not-sampled';
  return { report: { format, version: 1, scene: world.id ?? null, passed: findings.length === 0,
    plan, timing: { from, fps: clock.at(0).fps, frames, reviewedFrames: count, warmupRendered },
    checks, firstFailure: findings[0] ?? null, findings, samples }, evidence };
}

module.exports = { approveShot, format };
