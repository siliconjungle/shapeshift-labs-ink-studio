const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');
const Assets = require('./asset-files.js');
const FrameComposite = require('../src/frame-composite.js');
const CameraLens = require('../src/camera-lens.js');

const format = 'ink-studio/visual-sweep', pinFormat = 'ink-studio/sweep-pin';
const maxRuns = 48, maxViews = 8, maxFrames = 120, maxPixels = 64e6;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const finiteTime = n => Number.isFinite(n) && n >= 0;
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
function check(condition, message) {
  if (!condition) throw new RangeError(message);
}
function outputPath(opt, extra = []) {
  check(Object.keys(opt).every(key => ['out', ...extra].includes(key)) && typeof opt.out === 'string' && opt.out.length,
    'Visual sweeps need --out and use settings from their plan');
  return path.resolve(opt.out);
}

function fixedViews(views, id) {
  if (views === undefined) return;
  check(Array.isArray(views) && views.length >= 1 && views.length <= maxViews,
    'A scene sweep accepts 1–8 fixed camera views');
  const used = new Set();
  return views.map(view => {
    check(fields(view, ['id', 'camera']) && id(view.id) && !used.has(view.id),
      'Sweep camera views need distinct IDs');
    const { camera } = view;
    check(fields(camera, ['target', 'yaw', 'pitch', 'dist', 'ortho', 'fov']) &&
      [camera.yaw, camera.pitch, camera.dist].every(Number.isFinite) &&
      camera.dist > 0 && typeof camera.ortho === 'boolean' &&
      Array.isArray(camera.target) && camera.target.length === 3 && camera.target.every(Number.isFinite),
      'Sweep camera ' + view.id + ' needs target, yaw, pitch, positive dist and ortho');
    used.add(view.id);
    return { id: view.id, camera: { ...camera, fov: CameraLens.resolve(camera).fov } };
  });
}

function visual(raw, { kit, mode, start = 0 }) {
  const sim = mode === 'sim';
  const keys = ['width', 'height', 'pixelSize', 'columns', 'at', 'clip', 'title'];
  check(fields(raw, sim ? keys : [...keys, 'views']), 'Invalid visual sweep settings');
  const views = fixedViews(raw.views, kit.world.data.id);
  const { width = 240, height = 144, pixelSize = 2, columns = 3, clip, title } = raw;
  check(integer(width, 64, 1024) && integer(height, 32, 1024) && integer(pixelSize, 1, 16) &&
    width % pixelSize === 0 && height % pixelSize === 0 && integer(columns, 1, 8) &&
    (title === undefined || typeof title === 'string' && title.length <= 120),
    'Invalid sweep dimensions, pixel size, columns or title');
  let times = [], fps;
  if (clip !== undefined) {
    check(fields(clip, sim ? ['from', 'to', 'every', 'fps'] : ['from', 'to', 'fps']),
      'Invalid sweep clip settings');
    const { from = start, to, every = 1 } = clip;
    fps = clip.fps ?? 12;
    check(integer(fps, 1, 120) && finiteTime(from) && finiteTime(to) && from >= start && to > from,
      'A sweep clip needs an increasing range and an integer frame rate');
    if (sim) times = kit.world.observations.schedule({ from, to, every });
    else {
      const count = Math.max(2, Math.round((to - from) * fps));
      check(count <= maxFrames && from + (count - 1) / fps <= to + 1e-9,
        'Sweep clip must fit 2–120 frames inside its time range');
      times = Array.from({ length: count }, (_, i) => from + i / fps);
    }
    check(times.length <= maxFrames, 'A sweep clip supports at most 120 frames');
  }
  const at = raw.at ?? times[0] ?? start;
  check(finiteTime(at) && at >= start && (!sim || Number.isSafeInteger(at)),
    'The sweep poster must be at a valid time or tick at or after the start');
  const ordered = [...new Set([...times, at])].sort((a, b) => a - b);
  return { width, height, pixelSize, columns: views?.length ?? columns, title, at, clip, fps, times, ordered, views };
}

function approvalPlans(raw, settings) {
  if (raw === undefined) return;
  const keys = ['warmup', 'subjects', 'thresholds', 'matte', 'palette', 'silhouette',
    'cuts', 'motion', 'transition', 'performance'];
  const views = settings.views ?? [{ id: 'default' }];
  const overrides = raw?.views ?? {};
  check(fields(raw, ['checks', 'views']) && fields(raw.checks ?? {}, keys) &&
    fields(overrides, views.map(view => view.id)) && Object.values(overrides).every(row => fields(row, keys)),
    'Sweep approval needs shot checks and overrides for named views');
  const { width, height, pixelSize, times, fps, at } = settings;
  return views.map(({ id }) => ({ ...raw.checks, ...overrides[id], width, height, pixelSize,
    from: times[0] ?? at, fps: fps ?? 12, frames: times.length || 1 }));
}

function sizeOf(visual, count) {
  const columns = Math.min(visual.columns, count), tileWidth = Math.max(168, visual.width) + 18;
  const tileHeight = visual.height + 56, width = 18 + columns * tileWidth;
  const height = 54 + Math.ceil(count / columns) * tileHeight;
  check(width <= 8192 && height <= 8192 && width * height * (visual.times.length + 1) <= maxPixels,
    'Visual sweep exceeds its contact sheet pixel budget');
  return { width, height, columns, tileWidth, tileHeight };
}

function small(value) {
  return typeof value === 'number' ? String(Number(value.toPrecision(6))) :
    typeof value === 'string' ? value : JSON.stringify(value);
}
function sheet(kit, visual, tiles, title, anchor, cases) {
  const { width, height, columns, tileWidth, tileHeight } = sizeOf(visual, tiles.length);
  const draw = [], positions = [];
  const text = (value, x, y, size, color = '#eff3f5') => draw.push({ type: 'text', text: value, at: [x, y], size, color });
  const rect = (x, y, w, h, color) => draw.push({ type: 'rect', rect: [x, y, w, h], color });
  function fit(s, pixels, fontSize = 10) {
    const count = Math.max(6, Math.floor(pixels / (.89 * fontSize)));
    return s.length <= count ? s : s.slice(0, count - 3) + '...';
  }
  const titleSize = width < 420 ? 13 : 17;
  text(fit(title, width - 36, titleSize), width / 2, 19, titleSize);
  text(cases + (cases === 1 ? ' case' : ' cases') +
    (visual.views ? '  /  ' + visual.views.length + ' views' : '') +
    (visual.fps ? '   /   ' + visual.fps + ' FPS, ' + visual.times.length + ' frames' : ''),
  width / 2, 40, 10, '#a6b7c2');
  const equal = kit.world.data.equal;
  tiles.forEach((tile, i) => {
    const x = 9 + (i % columns) * tileWidth, y = 53 + Math.floor(i / columns) * tileHeight;
    const middle = x + tileWidth / 2, left = Math.floor(middle - visual.width / 2), top = y + 25;
    const pinned = anchor && tile.seed === anchor.seed && tile.case === anchor.case && equal(tile.parameters, anchor.parameters);
    const failed = tile.approvalPassed === false;
    const border = failed ? '#94483e' : pinned || tile.approvalPassed ? '#385149' : '#263442';
    rect(x + 4, y + 2, tileWidth - 8, tileHeight - 9, border);
    if (tile.approvalPassed !== undefined)
      text(failed ? 'X' : '+', x + 16, y + 15, 9, failed ? '#f4aa95' : '#b8f2ca');
    rect(x + 6, y + 4, tileWidth - 12, tileHeight - 13, '#121e2b');
    const number = String(tile.number ?? i + 1).padStart(2, '0');
    const heading = [number, tile.view ?? 'seed ' + tile.seed, pinned ? 'PIN' : null].filter(Boolean).join('  /  ');
    text(fit(heading, tileWidth - 18), middle, y + 15, 10, pinned ? '#b8f2ca' : '#dce6ec');
    const parts = Object.entries(tile.parameters).map(([key,value]) => key + '=' + small(value));
    text(fit(parts.length ? parts.join('   ') : tile.case, tileWidth - 18), middle, top + visual.height + 11, 10, '#abbec9');
    positions.push({ left, top });
  });
  const plan = kit.frameComposite.prepare({ layers: [{ draw }] }, width, height, 1);
  const paper = FrameComposite.compose({ w:1,h:1,rgb:Uint8Array.of(11,18,27) },
    kit.frameComposite.layers(plan, {}, 0), width, height, 'nearest');
  return at => {
    const rgb = paper.rgb.slice();
    for (const [i, tile] of tiles.entries()) {
      const { left, top } = positions[i], frame = tile.frames.get(at);
      for (let row = 0; row < visual.height; row++)
        rgb.set(frame.rgb.subarray(row * visual.width * 3, (row + 1) * visual.width * 3),
          ((top + row) * width + left) * 3);
    }
    return { w: width, h: height, rgb };
  };
}

function checkDirectory(directory) {
  if (fs.existsSync(directory))
    check(fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length === 0,
      'Choose a new or empty sweep output directory');
}
function publish(directory, write) {
  checkDirectory(directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(directory), '.ink-sweep-'));
  try {
    write(temporary);
    fs.renameSync(temporary, directory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function finish({ kit, directory, recipe, visual, tiles, numeric, name, anchor }) {
  const { ordered, times, fps, at, width, height } = visual;
  const lanes = visual.views ? tiles.flatMap((tile, i) => visual.views.map((view, j) =>
    ({ ...tile, number: i + 1, view: view.id, frames: tile.frames[j], approvalPassed: tile.approvals?.[j].report.passed }))) :
    tiles.map(tile => ({ ...tile, approvalPassed: tile.approvals?.[0].report.passed }));
  for (const tile of lanes)
    check(ordered.every(time => {
      const frame = tile.frames?.get(time);
      return frame?.w === width && frame.h === height && frame.rgb.length === width * height * 3;
    }), 'Sweep renderer did not produce a matching tile at every sample');
  const draw = sheet(kit, visual, lanes, visual.title || name, anchor, tiles.length);
  const sheetFiles = { image: 'sheet.png', ...(fps && { clip: 'sheet.apng' }) };
  const checked = tiles.some(tile => tile.approvals);
  const passed = !checked || tiles.every(tile => tile.approvals.every(row => row.report.passed));
  const result = {
    format, version: 1, recipe, ...(checked && { passed }), ...(anchor && { anchor }), sheet: sheetFiles,
    samples: { units: recipe.mode === 'sim' ? 'ticks' : 'seconds', poster: at, ...(fps && { frames: times, fps }) },
    tiles: tiles.map(({ frames, approvals, ...tile }, i) => {
      const file = 'cases/' + String(i + 1).padStart(3, '0');
      const views = visual.views?.map(view => ({ ...view, image: file + '-' + view.id + '.png',
        ...(fps && { clip: file + '-' + view.id + '.apng' }) }));
      const approval = approvals?.map(({ report, evidence }, j) => {
        const view = views?.[j].id ?? 'default', prefix = file + '-' + view + '-approval';
        const artifacts = report.passed || !evidence ? undefined : Object.fromEntries(
          ['image', 'previous', 'marked'].filter(key => evidence[key]).map(key => [key, prefix + '-' + key + '.png']));
        return { view, passed: report.passed, report: prefix + '.json', ...(artifacts && { evidence: artifacts }) };
      });
      return { ...tile, tile: i + 1, image: views?.[0].image ?? file + '.png',
        ...(fps && { clip: views?.[0].clip ?? file + '.apng' }), ...(views && { views }), ...(approval && { approval }) };
    })
  };
  publish(directory, temp => {
    fs.mkdirSync(path.join(temp, 'cases'));
    function still(file, { w, h, rgb }) { PNG.write(path.join(temp, file), w, h, rgb); }
    function clip(file, frame) {
      fs.writeFileSync(path.join(temp,file), PNG.encodeAnimation(times.map(t => PNG.packFrame(frame(t))), fps));
    }
    still(sheetFiles.image, draw(at));
    if (fps) clip(sheetFiles.clip, draw);
    result.tiles.forEach(({ image, clip: movie, views, approval }, i) => {
      (views ?? [{ image, clip: movie }]).forEach(({ image, clip: movie }, j) => {
        const frames = views ? tiles[i].frames[j] : tiles[i].frames;
        still(image, frames.get(at));
        if (movie) clip(movie, time => frames.get(time));
      });
      approval?.forEach((item, j) => {
        const { report, evidence } = tiles[i].approvals[j];
        Assets.json(path.join(temp, item.report), { ...report, ...(item.evidence && { evidence: item.evidence }) });
        for (const [key, output] of Object.entries(item.evidence ?? {})) {
          const { w, h, rgb, alpha } = evidence[key];
          PNG.write(path.join(temp, output), w, h, rgb, alpha);
        }
      });
    });
    Assets.json(path.join(temp, 'report.json'), numeric ? { ...numeric, visual: result } : result);
  });
  return { directory, cases: tiles.length, poster: path.join(directory, sheetFiles.image),
    ...(fps && { clip: path.join(directory, sheetFiles.clip) }), ...(checked && { passed }),
    report: path.join(directory, 'report.json') };
}

function canonicalVisual(plan, settings) {
  const { width, height, columns, pixelSize, at } = settings;
  return { ...plan, visual: { ...plan.visual, width, height, columns, pixelSize, at, ...(settings.views && { views: settings.views }) } };
}
function inputReceipts(source, dependencies) {
  check(dependencies === undefined || Array.isArray(dependencies) && dependencies.length <= 128 &&
    Array.from(dependencies).every(file => typeof file === 'string' && file.length && !path.isAbsolute(file)),
    'Sweep dependencies need up to 128 source-relative filenames');
  if (dependencies?.length) check(path.isAbsolute(source), 'Sweep dependencies require a scene file');
  if (!path.isAbsolute(source)) return [];
  const names = [source, ...(dependencies ?? []).map(file => path.resolve(path.dirname(source), file))];
  return [...new Set(names)].map(file => ({
    file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }));
}

function runScene({ kit, source, plan, directory, loadScene, renderCase, anchor }) {
  check(fields(plan, ['controls', 'visual', 'seeds', 'parameters', 'cases', 'approval', 'dependencies', 'constraints', 'sampling', 'runBudget']) && record(plan.controls ?? {}),
    'Invalid scene sweep plan');
  checkDirectory(directory);
  const settings = visual(plan.visual, { kit, mode: 'scene' });
  const inputs = inputReceipts(source, plan.dependencies);
  const approval = approvalPlans(plan.approval, settings);
  const { seeds, groups, runCount } = kit.world.observations.matrix(plan, { scene: true, limit: maxRuns });
  sizeOf(settings, runCount * (settings.views?.length ?? 1));
  const scene = loadScene(source);
  const actualSeeds = seeds ?? [scene.seed ?? 0];
  check(actualSeeds.every(Number.isSafeInteger), 'Sweep seeds need distinct safe integers');
  const tiles = [];
  for (const group of groups) {
    const controls = kit.world.apply({ ...plan.controls, ...group.controls }, group.edits, { validate: value => value }).world;
    for (const seed of actualSeeds) {
      const id = group.id + '@' + seed, sampleId = kit.world.observations.sampleId(group.case,seed,group.parameters);
      try {
        const { frames, approvals } = renderCase(source, { seed, controls }, settings, approval);
        tiles.push({ id, sampleId, case: group.case, seed, parameters: group.parameters, frames, ...(approvals && { approvals }) });
      } catch (error) { throw Error('Sweep run ' + id + ': ' + error.message, { cause: error }); }
    }
  }
  const recipe = { mode: 'scene', source, ...(inputs.length && { inputs }), plan: canonicalVisual(plan, settings) };
  return finish({ kit, directory, recipe, visual: settings, tiles, name: scene.name ?? scene.id, anchor });
}

function runSimulation({ kit, source, plan, directory, input, workerPool, runtime, renderFrame, anchor }) {
  checkDirectory(directory);
  const { visual: raw, ...numericPlan } = plan;
  const settings = visual(raw, { kit, mode: 'sim', start: input.tick ?? 0 });
  const prepared = kit.world.observations.prepare(numericPlan, { visual: true, limit: maxRuns });
  sizeOf(settings, prepared.runCount);
  const tiles = new Map();
  const numeric = prepared.run(input, {
    runtime: { workerPool }, capture: { ticks: settings.ordered, frame(view, query, sample) {
      const { tick, dt, ...tile } = sample;
      if (!tiles.has(tile.id)) tiles.set(tile.id, { ...tile, frames: new Map() });
      tiles.get(tile.id).frames.set(tick, renderFrame(view, query, settings, tile.id, tick, tick * dt));
    } }
  });
  const recipe = { mode: 'sim', source, runtime, plan: canonicalVisual(plan, settings) };
  return finish({ kit, directory, recipe, visual: settings, tiles: [...tiles.values()], numeric, name: numeric.world, anchor });
}

function selectTile(tiles, selection) {
  if (typeof selection !== 'string') return;
  return tiles.find(row => row.id === selection || row.sampleId === selection || String(row.tile) === selection);
}

function pin(report, selection, note) {
  check(note === undefined || typeof note === 'string' && note.length > 0 && note.length <= 512,
    'Sweep pin notes need 1–512 characters');
  const result = report.visual ?? report;
  check(result.format === format && result.version === 1 && Array.isArray(result.tiles) &&
    record(result.recipe) && record(result.recipe.plan), 'Expected a visual sweep report');
  const tile = selectTile(result.tiles, selection);
  check(tile, 'No visual sweep tile matches ' + selection);
  const { recipe } = result, { plan } = recipe;
  const choice = (plan.cases ?? [{ id: 'base' }]).find(row => row.id === tile.case);
  check(choice && Number.isSafeInteger(tile.seed), 'The sweep report is missing its selected case or seed');
  const parameters = Object.fromEntries(Object.entries(plan.parameters ?? {}).map(([name, parameter]) => {
    check(Object.hasOwn(tile.parameters, name), 'The sweep report is missing parameter ' + name);
    const { range, ...binding } = parameter;
    return [name, { ...binding, values: [tile.parameters[name]] }];
  }));
  const anchor = { id: tile.id, ...(tile.sampleId && { sampleId: tile.sampleId }), case: tile.case, seed: tile.seed, parameters: tile.parameters };
  const { sampling, ...fixedPlan } = plan;
  return { format: pinFormat, version: 1, anchor, ...(note && { note }), recipe: {
    ...recipe, plan: { ...fixedPlan, seeds: [tile.seed], cases: [choice], parameters }
  } };
}

function loadPin(file, nearby) {
  const pin = read(file);
  check(pin?.format === pinFormat && pin.version === 1 && record(pin.anchor) && record(pin.recipe) &&
    ['sim', 'scene'].includes(pin.recipe.mode) && typeof pin.recipe.source === 'string' &&
    record(pin.recipe.plan) && record(pin.recipe.plan.parameters), 'Expected a saved sweep pin');
  if (pin.recipe.mode === 'scene' && pin.recipe.inputs !== undefined) {
    const inputs = inputReceipts(pin.recipe.source, pin.recipe.plan.dependencies);
    check(Array.isArray(pin.recipe.inputs) && JSON.stringify(pin.recipe.inputs) === JSON.stringify(inputs),
      'Sweep pin scene or declared dependency changed');
  }
  if (nearby === undefined) return pin;
  const offsets = read(nearby);
  check(record(offsets) && Object.keys(offsets).length, 'Nearby sweeps need named parameter offsets');
  const { parameters } = pin.recipe.plan;
  for (const [name, shifts] of Object.entries(offsets)) {
    const base = Object.hasOwn(parameters, name) ? parameters[name]?.values?.[0] : undefined;
    check(Number.isFinite(base) && Array.isArray(shifts) && shifts.length > 0 && shifts.length <= maxRuns &&
      shifts.every(delta => Number.isFinite(delta) && Number.isFinite(base + delta)),
      'Nearby offsets need a pinned numeric parameter and finite values for ' + name);
    parameters[name].values = [...new Set([...shifts, 0].sort((a,b) => a-b).map(delta => delta === 0 ? base : base + delta))];
  }
  return pin;
}

function sourcePath(id) {
  return /\.(?:js|json|obj|gltf|glb)$/i.test(id) || id.includes('/') ? path.resolve(id) : id;
}

module.exports = { read, outputPath, runScene, runSimulation, pin, loadPin, sourcePath, publish, selectTile };
