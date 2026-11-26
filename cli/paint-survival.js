'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { pose } = require('./diarama-pose.js');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { graphOutputs } = require('./graph-outputs.js');

const format = 'ink-studio/paint-survival';
const reportFormat = 'ink-studio/paint-survival-review';
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
const range = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isSafeInteger(n) && range(n, min, max);
const list = (value, min, max) => Array.isArray(value) && range(value.length, min, max);
const point = value => list(value, 3, 3) && Array.from(value).every(n => range(n, -1e5, 1e5));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = value => typeof value === 'string' && value.endsWith('.json');

function fallback(raw, name) {
  if (!record(raw)) throw new TypeError('A paint region needs a fallback');
  const { kind } = raw, fallbackId = 'lod-' + name;
  if (kind === 'omit' && fields(raw, ['kind'])) return { kind };
  if (kind === 'silhouette' && fields(raw, ['kind', 'at', 'path', 'stamp', 'color', 'bias']) &&
      (raw.at !== undefined) !== (raw.path !== undefined) && raw.color !== undefined) {
    const { kind, ...mark } = raw;
    return { kind, pixel: { id: 'paint-survival-' + name, ...mark } };
  }
  if (kind === 'pigment' && fields(raw, ['kind', 'mark']) && fields(raw.mark,
      ['attachment', 'brush', 'poses', 'mat', 'step', 'blendRadius', 'pressureResponse', 'transform', 'res']) &&
      raw.mark.attachment?.kind === 'surface' && raw.mark.attachment.snap?.mode === 'surface')
    return { kind, mark: { ...raw.mark, id: fallbackId, relief: { mode: 'flat' } } };
  if (kind === 'line' && fields(raw, ['kind', 'points', 'radius', 'mat', 'attachment', 'res']) &&
      list(raw.points, 2, 128) && Array.from(raw.points).every(point) && range(raw.radius, .0001, 10) &&
      raw.mat !== undefined &&
      (raw.attachment === undefined || raw.attachment?.kind === 'surface' && raw.attachment.snap?.mode === 'surface')) {
    const { points, radius, mat, attachment, res } = raw;
    return { kind, mark: { id: fallbackId, mat, brush: { kind: 'sphere', radius },
      poses: points.map(point => ({ point })), ...(attachment && { attachment, relief: { mode: 'flat' } }),
      ...(res !== undefined && { res }) } };
  }
  throw new TypeError('Invalid paint fallback for ' + name + '. Use pigment, line, silhouette or omit');
}

function prepare(raw, source, editor, kit) {
  if (!fields(raw, ['format', 'version', 'camera', 'resolutions', 'angles', 'regions', 'fallbackBudget', 'pixelBudget', 'raw', 'time']) ||
      raw.format !== format || raw.version !== 1 || !list(raw.regions, 1, 64) ||
      !list(raw.resolutions, 2, 6) || !list(raw.angles, 2, 6))
    throw new TypeError('Use a version 1 paint survival plan with regions, two or more resolutions and two or more angles');
  const { camera, time = 0, raw: direct = false, fallbackBudget = raw.regions.length, pixelBudget } = raw;
  if (!fields(camera, ['target', 'dist', 'projection', 'fov']) || !point(camera.target) || !range(camera.dist, .05, 1e4) ||
      camera.projection !== undefined && !['orthographic', 'perspective'].includes(camera.projection) ||
      camera.fov !== undefined && !range(camera.fov, .02, 3.1) || !range(time, 0, 120) || typeof direct !== 'boolean' ||
      !integer(fallbackBudget, 0, 64) || pixelBudget !== undefined && !integer(pixelBudget, 0, 4096))
    throw new TypeError('Paint survival needs a camera target and distance, bounded time, and valid fallback budgets');
  const ids = new Set(), dimensions = new Set(), directions = new Set();
  for (const row of raw.resolutions) {
    const key = [row?.w, row?.h].join('/');
    if (!fields(row, ['id', 'w', 'h']) || !id(row.id) || ids.has(row.id) ||
        !integer(row.w, 8, 512) || !integer(row.h, 8, 512) || dimensions.has(key))
      throw new TypeError('Use named, distinct art resolutions up to 512 × 512');
    ids.add(row.id);
    dimensions.add(key);
  }
  ids.clear();
  for (const row of raw.angles) {
    const key = [row?.yaw, row?.pitch].join('/');
    if (!fields(row, ['id', 'yaw', 'pitch']) || !id(row.id) || ids.has(row.id) || directions.has(key) ||
        !range(row.yaw, -Math.PI, Math.PI) || !range(row.pitch, -Math.PI / 2, Math.PI / 2))
      throw new TypeError('Use named, distinct camera angles in radians');
    ids.add(row.id);
    directions.add(key);
  }
  const cases = raw.angles.flatMap(({ id, yaw, pitch }) => raw.resolutions.map(({ id: resolution, w, h }) => ({
    id: id + '/' + resolution, angle: id, resolution, w, h, camera: { projection: 'orthographic', ...camera, yaw, pitch }
  })));
  if (cases.reduce((sum, row) => sum + row.w * row.h, 0) > 2e6)
    throw new RangeError('Paint review exceeds two million native pixels per lane');

  ids.clear();
  const placements = new Map(source.paintings3d?.map(row => [row.id, row]));
  const attachments = new Map(editor.inspectPaintings3d().map(row => [row.id, row.marks]));
  const owned = new Set(), { sceneGraph: graph } = kit.KIT;
  const regions = raw.regions.map(row => {
    if (!fields(row, ['id', 'placement', 'marks', 'priority', 'measure', 'minPixels', 'fallback']) ||
        !id(row.id) || ids.has(row.id) || typeof row.placement !== 'string' ||
        !list(row.marks, 1, 256) || !range(row.priority, -1e6, 1e6) || !range(row.minPixels ?? 1.5, .05, 100))
      throw new TypeError('A paint region needs a unique ID, named painting marks, priority and a positive pixel threshold');
    ids.add(row.id);
    const authored = placements.get(row.placement);
    for (const mark of row.marks) {
      const key = row.placement + '/' + mark;
      if (typeof mark !== 'string' || owned.has(key) ||
          !authored?.painting.marks.some(item => item.id === mark && item.enabled !== false))
        throw new RangeError('Unknown, disabled or repeated paint mark ' + key);
      owned.add(key);
    }
    const { measure } = row;
    if (!fields(measure, ['span', 'mark']) || !list(measure.span, 2, 2) || !Array.from(measure.span).every(point) ||
        !measure.span[0].some((n, i) => n !== measure.span[1][i]))
      throw new TypeError('A paint region needs two distinct XYZ points across its smallest feature');
    let span = measure.span;
    if (measure.mark !== undefined) {
      const anchor = attachments.get(row.placement)?.find(mark => mark.id === measure.mark);
      if (!row.marks.includes(measure.mark) || !anchor?.transform || anchor.part)
        throw new RangeError('Use an unrigged region mark for local measurement, or supply a posed world span');
      span = span.map(point => graph.point(anchor.transform, point));
    }
    const replacement = fallback(row.fallback, row.id);
    if (replacement.mark && authored.painting.marks.some(mark => mark.id === replacement.mark.id))
      throw new RangeError('The fallback ID ' + replacement.mark.id + ' is already in use in ' + row.placement);
    return { ...row, minPixels: row.minPixels ?? 1.5, span, replacement };
  });
  return { time, direct, cases, regions, fallbackBudget, pixelBudget, angleCount: raw.angles.length, resolutionCount: raw.resolutions.length };
}

function selection(config, projection, kit) {
  const camera = kit.CameraLens.rasterProjector(projection);
  const { clipNear, clipFar, width, height } = projection;
  const metrics = config.regions.map(region => {
    const { id, priority, minPixels } = region, evidence = { id, priority, minPixels };
    const stations = region.span.map(camera.viewPoint);
    if (stations.some(p => p[2] < clipNear || p[2] > clipFar))
      return { ...evidence, pixels: null, choice: 'outside' };
    const [a,b] = stations.map(camera.project), pixels = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const outside = [[0, width], [1, height]].some(([i, size]) =>
      Math.max(a[i], b[i]) < 0 || Math.min(a[i], b[i]) >= size);
    return { ...evidence, pixels, choice: outside ? 'outside' : pixels >= minPixels ? 'detail' : 'pending' };
  });
  const order = config.regions.slice().sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const byId = new Map(metrics.map(row => [row.id, row]));
  let remaining = config.fallbackBudget;
  for (const region of order) {
    const row = byId.get(region.id), { kind } = region.replacement;
    if (row.choice !== 'pending') continue;
    if (kind === 'omit') row.choice = 'omit';
    else if (remaining > 0) {
      row.choice = kind;
      remaining--;
    } else row.choice = 'budget';
  }
  return { metrics, order, byId };
}

function variant(source, config, selected, kit, world) {
  const { order, byId } = selected;
  const placements = new Map(), protectedMarks = [];
  for (const region of order.slice().reverse()) {
    const { choice } = byId.get(region.id);
    if (choice === 'detail' || choice === 'outside') continue;
    const row = placements.get(region.placement) ?? { mute: new Set(), add: [] };
    placements.set(region.placement, row);
    for (const id of region.marks) row.mute.add(id);
    if (choice === 'silhouette') protectedMarks.push({ ...region.replacement.pixel, priority: region.priority });
    if (choice === 'line' || choice === 'pigment') row.add.push(region.replacement.mark);
  }
  if (!placements.size) return source;
  const result = { ...source, paintings3d: source.paintings3d.map(entry => {
    const row = placements.get(entry.id);
    if (!row) return entry;
    return { ...entry, painting: { ...entry.painting, marks: [
      ...entry.painting.marks.map(mark => row.mute.has(mark.id) ? { ...mark, enabled: false } : mark), ...row.add
    ] } };
  }) };
  if (protectedMarks.length) {
    const base = record(world.look?.protectedPixels) ? world.look.protectedPixels : {};
    const protectedPixels = { ...base, ...(config.pixelBudget !== undefined && { budget: config.pixelBudget }),
      marks: [...base.marks ?? [], ...protectedMarks] };
    kit.KIT.protectedPixels.prepare(protectedPixels, undefined, { scenePalette: world.pal, paletteRoles: world.paletteRoles });
    result.finish = { ...source.finish, look: { ...kit.KIT.diorama.sceneLook(source), protectedPixels } };
  }
  return result;
}

function encode(image) {
  return PNG.encodeFrame(PNG.packFrame(image));
}

function capture(source, config, entry, build, kit) {
  const { w, h, camera } = entry;
  const { time, direct } = config;
  const native = build(source, time);
  const authoredCamera = kit.KIT.procedural.sceneGraph.camera(camera);
  const options = { w, h, px: 1, t: time, lockCamera: true, raw: direct, shutter: false, renderGrid: false,
    cameraGuides: false, composite: false, inspection: false };
  const lens = kit.CameraLens.frame(native, { ...options, camera: authoredCamera }, w, h, {
    orbit: kit.KIT.cameraStaging.prepare(native.look?.cameraStaging)?.orbit
  });
  const common = { ...options, camera: { ...lens.lens, pose: lens.pose, target: lens.base.target, dist: lens.dist,
    yaw: lens.yaw, pitch: lens.pitch, ortho: lens.ortho }, ortho: lens.ortho };
  let projection;
  const original = R.render(native, { ...common, ...R.cameraCapture(null, (raster, sample) => {
    if (raster.width === w && raster.height === h) projection = { ...raster, focal: sample.focal };
  }) });
  if (!projection || original.w !== w || original.h !== h)
    throw new RangeError('Paint survival needs the requested native art grid and camera');
  const chosen = selection(config, projection, kit);
  const revised = variant(source, config, chosen, kit, native);
  const candidate = revised === source ? original : R.render(build(revised, time), common);
  if (candidate.w !== w || candidate.h !== h) throw new RangeError('A fallback changed the native art grid');
  const protectedRows = new Map(candidate.protectedPixels?.marks.map(row => [row.id, row]));
  const regions = chosen.metrics.map(row => ({ ...row, ...(row.choice === 'silhouette' && {
    protected: protectedRows.get('paint-survival-' + row.id) ?? { status: 'unresolved' }
  }) }));
  return { original, candidate, revised, regions };
}

function names(index) {
  const prefix = 'views/' + String(index + 1).padStart(2, '0');
  return { original: prefix + '-original.png', candidate: prefix + '-sprite.png' };
}

function sheet(config, frames, kit) {
  const w = 154, h = 100, gap = 8, cw = 2*w+gap, ch = h+31;
  const W = config.resolutionCount*(cw+gap)+gap, H = config.angleCount*(ch+gap)+44;
  const commands = [{ type:'rect', rect:[0,0,W,H], fill:'#111c29' }];
  const text = (text, x, y, scale = 1, color = '#e9dac6') => commands.push({ type:'text', text, at:[x,y], scale, color });
  text('PAINT AT SPRITE SIZE',gap,11,2);
  const tiles = [];
  for (const [i,{ original, candidate }] of frames.entries()) {
    const { angle, w: width, h: height } = config.cases[i];
    const x=gap+i%config.resolutionCount*(cw+gap), y=34+Math.floor(i/config.resolutionCount)*(ch+gap);
    text(angle.toUpperCase()+'  '+width+' X '+height,x,y);
    text('ORIGINAL',x,y+13,1,'#a7bec8');
    text('FALLBACKS',x+w+gap,y+13,1,'#8bdbc2');
    tiles.push([original,x,y+24],[candidate,x+w+gap,y+24]);
  }
  const image = kit.KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
  for (const [frame,x,y] of tiles) {
    const scale = Math.min(w/frame.w,h/frame.h);
    const tw = Math.round(frame.w*scale), th = Math.round(frame.h*scale);
    const ox = x + Math.floor((w-tw)/2), oy = y + Math.floor((h-th)/2);
    for (let yy=0; yy<th; yy++) for (let xx=0; xx<tw; xx++) {
      const i = (Math.floor(yy*frame.h/th)*frame.w+Math.floor(xx*frame.w/tw))*3, o = ((oy+yy)*W+ox+xx)*4;
      const alpha = frame.alpha ? frame.alpha[i/3]/255 : 1;
      for (let k=0;k<3;k++) image.data[o+k] = Math.round(image.data[o+k]*(1-alpha)+frame.rgb[i+k]*alpha);
    }
  }
  return PNG.encode(W,H,image.data,4);
}

module.exports = function paintSurvival([verb, scene, plan, receipt, ...rest], flags, kit, loadScene) {
  const { out, case: picked } = flags, applying = verb === 'apply';
  if (!['review', 'apply'].includes(verb) || !json(scene) || !json(plan) || !out || typeof out !== 'string' ||
      rest.length || (applying ? !json(receipt) || !json(out) || typeof picked !== 'string' : receipt !== undefined || picked !== undefined) ||
      Object.keys(flags).some(key => !['out', 'case'].includes(key)))
    throw new TypeError('Use paint-survival review <scene.json> <plan.json> --out directory or apply <scene.json> <plan.json> <review.json> --case angle/resolution --out scene.json');
  const inputs = graphOutputs([scene, plan, ...(receipt ? [receipt] : [])]);
  const sceneBytes = fs.readFileSync(scene), planBytes = fs.readFileSync(plan);
  const descriptor = loadScene(scene, JSON.parse(sceneBytes));
  if (!descriptor.openEditor) throw new TypeError('Paint survival needs a plain editable JSON scene');
  const editor = descriptor.openEditor({ historyLimit: 0 }), source = editor.snapshot();
  const config = prepare(JSON.parse(planBytes), source, editor, kit);
  const sourceHash = digest(sceneBytes), planHash = digest(planBytes);
  const build = (snapshot, time) => {
    const world = loadScene(scene, snapshot).build(undefined, { parameterInputs: { time } });
    pose(world, time, { kit, maxSteps: 7201 });
    return world;
  };
  if (applying) {
    if (path.dirname(path.resolve(out)) !== path.dirname(path.resolve(scene)))
      throw new RangeError('Write the revised scene beside its source to preserve relative assets');
    inputs.protect(fs.statSync(out, { throwIfNoEntry: false }));
    const review = read(receipt);
    if (review?.format !== reportFormat || review.version !== 1 || review.sourceHash !== sourceHash || review.planHash !== planHash ||
        !Array.isArray(review.cases) || review.cases.length !== config.cases.length)
      throw new RangeError('Review is stale or incomplete for this scene and plan');
    const index = config.cases.findIndex(row => row.id === picked);
    if (index < 0) throw new RangeError('Unknown reviewed paint case ' + picked);
    const directory = path.dirname(path.resolve(receipt));
    for (const [i, entry] of config.cases.entries()) {
      const row = review.cases[i];
      if (!row || row.id !== entry.id || !row.images) throw new RangeError('Review is missing ' + entry.id);
      for (const [lane, file] of Object.entries(names(i))) {
        const image = path.join(directory, file);
        if (row.images[lane]?.file !== file || !fs.existsSync(image) || digest(fs.readFileSync(image)) !== row.images[lane].sha256)
          throw new RangeError('Review image is missing or changed for ' + entry.id + ' ' + lane);
      }
    }
    const entry = config.cases[index], row = review.cases[index], result = capture(source, config, entry, build, kit);
    if (!isDeepStrictEqual(result.regions, row.regions) || digest(encode(result.original)) !== row.images.original.sha256 ||
        digest(encode(result.candidate)) !== row.images.candidate.sha256)
      throw new RangeError('This case did not reproduce the reviewed result');
    files.json(out, result.revised);
    return console.log(JSON.stringify({ out, case: entry.id, w: entry.w, h: entry.h, camera: entry.camera,
      time: config.time, regions: result.regions }, null, 2));
  }
  const frames = [], artifacts = [];
  const cases = config.cases.map((entry, index) => {
    const { original, candidate, regions } = capture(source, config, entry, build, kit);
    frames.push({ original, candidate });
    const images = Object.fromEntries(Object.entries(names(index)).map(([lane, file]) => {
      const bytes = encode(lane === 'original' ? original : candidate);
      artifacts.push({ file, bytes });
      return [lane, { file, sha256: digest(bytes) }];
    }));
    return { ...entry, regions, images };
  });
  const report = { format: reportFormat, version: 1, sourceHash, planHash, time: config.time,
    fallbackBudget: config.fallbackBudget, sheet: 'review.png', cases };
  inputs.write(path.resolve(out), [...artifacts, { file: report.sheet, bytes: sheet(config, frames, kit) },
    { file: 'report.json', document: report }]);
  console.log(JSON.stringify(report, null, 2));
};
