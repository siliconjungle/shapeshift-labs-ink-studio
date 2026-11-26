const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const Assets = require('./asset-files.js');
const Sweep = require('./visual-sweep.js');

function open(source) {
  const filename = path.resolve(source);
  const reportFile = fs.statSync(filename).isDirectory() ? path.join(filename, 'report.json') : filename;
  const raw = Sweep.read(reportFile), report = raw.visual ?? raw;
  if (report.format !== 'ink-studio/visual-sweep' || report.version !== 1 || !Array.isArray(report.tiles) || !report.tiles.length)
    throw new TypeError('Expected a visual sweep report');
  const root = fs.realpathSync(path.dirname(reportFile));
  function asset(name) {
    if (typeof name !== 'string' || path.isAbsolute(name)) throw new TypeError('Sweep artifacts need relative paths');
    const file = fs.realpathSync(path.resolve(root, name)), relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new RangeError('Sweep artifact leaves its report directory');
    return file;
  }
  return { report, asset };
}

function difference(first, second) {
  if (first.w !== second.w || first.h !== second.h) throw new RangeError('Candidate image grids differ');
  let changed = 0, squared = 0;
  for (let i = 0; i < first.rgb.length; i += 3) {
    const delta = (first.rgb[i] - second.rgb[i]) ** 2 +
      (first.rgb[i + 1] - second.rgb[i + 1]) ** 2 + (first.rgb[i + 2] - second.rgb[i + 2]) ** 2;
    changed += Number(delta !== 0);
    squared += delta;
  }
  return { changedPixels: changed, rgbRms: Math.sqrt(squared / first.rgb.length) };
}

function clips(kit, temp, asset, reference, candidate, still, timing) {
  const { fps, frames: samples } = timing;
  const settings = { w: still.w, h: still.h, count: samples.length, fps };
  const left = PNG.readFullFrameAnimation(asset(reference.clip), settings);
  const right = PNG.readFullFrameAnimation(asset(candidate.clip), settings);
  const sideBySide = reference.id + '-comparison.apng', signedDifference = reference.id + '-difference.apng';
  const paired = [], deltas = [];
  const frames = samples.map((sample, i) => {
    const a = PNG.read(PNG.encodeFrame(left[i])), b = PNG.read(PNG.encodeFrame(right[i]));
    paired.push(PNG.packFrame(kit.comparison.compose(a, b, { mode: 'side-by-side' })));
    deltas.push(PNG.packFrame(kit.comparison.compose(a, b, { mode: 'difference' })));
    return { frame: i, sample, ...difference(a,b) };
  });
  fs.writeFileSync(path.join(temp,sideBySide),PNG.encodeAnimation(paired,fps));
  fs.writeFileSync(path.join(temp,signedDifference),PNG.encodeAnimation(deltas,fps));
  return { sideBySide, difference: signedDifference, frames };
}

function compare(kit, source, left, right, out) {
  const { report, asset } = open(source);
  const a = Sweep.selectTile(report.tiles,left), b = Sweep.selectTile(report.tiles,right), timing = report.samples;
  if (!a || !b) throw new RangeError('Both comparison candidates must exist');
  const views = tile => tile.views ?? [{ id: 'default', image: tile.image, clip: tile.clip }];
  const referenceViews = views(a), candidates = views(b);
  if (referenceViews.length !== candidates.length) throw new RangeError('Candidates need matching view cameras');
  const animated = timing?.frames !== undefined;
  if (animated && (!Array.isArray(timing.frames) || !['seconds', 'ticks'].includes(timing.units) ||
      !timing.frames.every((sample,i) => Number.isFinite(sample) && (!i || sample > timing.frames[i-1]))))
    throw new RangeError('Sweep clip needs a valid sample schedule');
  Sweep.publish(out, temp => {
    const rows = referenceViews.map((reference, i) => {
      const candidate = candidates[i], id = reference.id;
      if (id !== candidate?.id || !kit.world.data.equal(reference.camera, candidate.camera))
        throw new RangeError('Candidates need matching view cameras');
      if (!kit.world.data.id(id)) throw new TypeError('Invalid sweep view ID');
      const first = PNG.read(asset(reference.image)), second = PNG.read(asset(candidate.image));
      const metrics = difference(first,second), sideBySide = id + '-comparison.png', signedDifference = id + '-difference.png';
      for (const [file, mode] of [[sideBySide, 'side-by-side'], [signedDifference, 'difference']]) {
        const { w, h, rgb } = kit.comparison.compose(first, second, { mode });
        PNG.write(path.join(temp, file), w, h, rgb);
      }
      const clip = animated ? clips(kit,temp,asset,reference,candidate,first,timing) : undefined;
      return { view: id, ...metrics, sideBySide, difference: signedDifference, ...(clip && { clip }) };
    });
    Assets.json(path.join(temp, 'report.json'), { format: 'ink-studio/sweep-comparison', version: 1,
      left: a.id, right: b.id, ...(a.sampleId && { leftSampleId: a.sampleId }),
      ...(b.sampleId && { rightSampleId: b.sampleId }), ...(animated && { samples: timing }), views: rows });
  });
}

function rank(source, out) {
  const { report, asset } = open(source);
  const sourcePath = path.resolve(source);
  const reportPath = fs.statSync(sourcePath).isDirectory() ? path.join(sourcePath, 'report.json') : sourcePath;
  if (out === reportPath) throw new RangeError('Choose a separate output for the ranking');
  const candidates = report.tiles.map(tile => {
    const checks = tile.approval ?? [];
    const findings = checks.reduce((count, row) => count + Sweep.read(asset(row.report)).findings.length, 0);
    const passed = checks.length ? checks.every(row => row.passed) : null;
    return { id: tile.id, ...(tile.sampleId && { sampleId: tile.sampleId }), tile: tile.tile, seed: tile.seed, parameters: tile.parameters, passed, findings };
  });
  const priority = new Map([[true, 0], [false, 1], [null, 2]]);
  candidates.sort((a,b) => priority.get(a.passed) - priority.get(b.passed) || a.findings - b.findings || a.tile - b.tile);
  Assets.json(out, { format: 'ink-studio/sweep-ranking', version: 1, candidates });
}

function apply(kit, file, out, scene) {
  const { recipe, anchor } = Sweep.loadPin(file);
  if (recipe.mode !== 'scene') throw new RangeError('Apply needs a scene sweep pin');
  const { plan, source } = recipe;
  const { groups, seeds } = kit.world.observations.matrix(plan, { scene: true, limit: 48 });
  if (groups.length !== 1 || seeds?.length !== 1) throw new RangeError('Apply needs exactly one pinned case');
  const [{ controls: overrides, edits }] = groups;
  const controls = kit.world.apply({ ...plan.controls, ...overrides }, edits, { validate: value => value }).world;
  if (path.resolve(file) === out || path.isAbsolute(source) && path.resolve(source) === out)
    throw new RangeError('Keep the source and pin. Choose a new destination');
  if (!scene) {
    Assets.json(out, controls);
    return;
  }
  if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.json' ||
      path.dirname(source) !== path.dirname(out) || path.extname(out).toLowerCase() !== '.json')
    throw new RangeError('Write an editable JSON scene revision beside the original source');
  const original = Sweep.read(source);
  if (!original.parameterBindings?.controls || !Object.keys(controls).every(name =>
    Object.hasOwn(original.parameterBindings.controls, name)))
    throw new RangeError('The scene must declare all selected controls');
  const parameterBindings = { ...original.parameterBindings, controls: { ...original.parameterBindings.controls, ...controls } };
  kit.parameters.prepare(parameterBindings);
  Assets.json(out, { ...original, seed: seeds?.[0] ?? anchor.seed, parameterBindings });
}

module.exports = { compare, rank, apply };
