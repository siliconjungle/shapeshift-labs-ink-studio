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

function compare(kit, source, left, right, out) {
  const { report, asset } = open(source);
  const select = value => report.tiles.find(tile => tile.id === value || String(tile.tile) === value);
  const a = select(left), b = select(right);
  if (!a || !b) throw new RangeError('Both comparison candidates must exist');
  const views = tile => tile.views ?? [{ id: 'default', image: tile.image }];
  const candidates = views(b);
  const frames = views(a).map((reference, i) => {
    const candidate = candidates[i];
    if (reference.id !== candidate?.id || !kit.world.data.equal(reference.camera, candidate.camera))
      throw new RangeError('Candidates need matching view cameras');
    if (!kit.world.data.id(reference.id)) throw new TypeError('Invalid sweep view ID');
    const first = PNG.read(asset(reference.image)), second = PNG.read(asset(candidate.image));
    if (first.w !== second.w || first.h !== second.h) throw new RangeError('Candidate image grids differ');
    let changed = 0, squared = 0;
    for (let i = 0; i < first.rgb.length; i += 3) {
      const delta = (first.rgb[i] - second.rgb[i]) ** 2 +
        (first.rgb[i + 1] - second.rgb[i + 1]) ** 2 + (first.rgb[i + 2] - second.rgb[i + 2]) ** 2;
      changed += Number(delta !== 0);
      squared += delta;
    }
    return { id: reference.id, first, second, changed, rgbRms: Math.sqrt(squared / first.rgb.length) };
  });
  const rows = frames.map(({ id, changed, rgbRms }) => ({ view: id, changedPixels: changed, rgbRms,
    sideBySide: id + '-comparison.png', difference: id + '-difference.png' }));
  Sweep.publish(out, temp => {
    for (const [i, { first, second }] of frames.entries()) {
      for (const [file, mode] of [[rows[i].sideBySide, 'side-by-side'], [rows[i].difference, 'difference']]) {
        const { w, h, rgb } = kit.comparison.compose(first, second, { mode });
        PNG.write(path.join(temp, file), w, h, rgb);
      }
    }
    Assets.json(path.join(temp, 'report.json'), { format: 'ink-studio/sweep-comparison', version: 1,
      left: a.id, right: b.id, views: rows });
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
    return { id: tile.id, tile: tile.tile, seed: tile.seed, parameters: tile.parameters, passed, findings };
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
