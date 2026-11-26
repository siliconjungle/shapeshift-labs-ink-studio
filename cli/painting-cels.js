'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const SpriteCels = require('../src/sprite-cels.js');
const PNG = require('./png.js');
const R = require('./render.js');
const files = require('./asset-files.js');
const { graphOutputs } = require('./graph-outputs.js');
const { pose } = require('./diarama-pose.js');
const paintingCelBoil = require('./painting-cel-boil.js');

const format = 'ink-studio/painting-cels';
const editFormat = 'ink-studio/painting-cel-edit';
const verbs = {
  init: { args: 1, flags: ['id', 'fps', 'playback', 'out'] },
  inspect: { args: 1, flags: [] },
  edit: { args: 3, flags: ['out'] },
  sample: { args: 2, flags: ['frame', 'at', 'out'] },
  preview: { args: 2, flags: ['frame', 'at', 'view', 'out'] },
  export: { args: 2, flags: ['view', 'out'] }
};
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const name = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
const integer = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;
const jsonPath = value => typeof value === 'string' && value.endsWith('.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const report = value => console.log(JSON.stringify(value, null, 2));
const solidId = (placement, mark) => 'paint.' + placement + '.' + mark;

function open(document, K) {
  if (!fields(document, ['format', 'version', 'placement', 'fps', 'playback', 'cels']) ||
      document.format !== format || document.version !== 1 ||
      !integer(document.fps, 1, 120) || !['once', 'loop'].includes(document.playback) ||
      !Array.isArray(document.cels) || !integer(document.cels.length, 1, 120))
    throw new TypeError('A painting clip needs 1–120 cels, an integer fps in 1–120 and once or loop playback');
  const { placement, cels, fps, playback } = document;
  if (!fields(placement, ['id', 'bindings', 'transform', 'painting']) || !name(placement.id) ||
      placement.bindings !== undefined && !record(placement.bindings) ||
      !fields(placement.painting, ['format', 'version', 'id', 'profiles', 'flowMaps', 'presets']) ||
      placement.painting.format !== K.authoring.paintings3d.format ||
      placement.painting.version !== 1 || !name(placement.painting.id))
    throw new TypeError('A painting clip needs one shared 3D painting placement and its resources');
  let ticks = 0, markCount = 0;
  const ids = new Set();
  const entries = cels.map((row, frame) => {
    if (!fields(row, ['id', 'hold', 'marks']) || !name(row.id) || ids.has(row.id) ||
        !integer(row.hold, 1, 65535) || !Array.isArray(row.marks) || row.marks.length > 256)
      throw new TypeError('Each cel needs a unique ID, a hold in ticks, and up to 256 marks');
    ids.add(row.id);
    const marks = new Set();
    for (const mark of row.marks) {
      if (!record(mark) || !name(mark.id) || marks.has(mark.id))
        throw new TypeError('Each mark needs a stable ID unique within its cel');
      marks.add(mark.id);
    }
    markCount += row.marks.length;
    const tick = ticks, time = tick / fps;
    ticks += row.hold;
    return { ...row, frame, tick, time, duration: row.hold / fps };
  });
  if (markCount > 8192) throw new RangeError('Painting clip exceeds its retained mark budget');
  const boil = paintingCelBoil(entries, document, ticks, K.procedural.paintBoil);
  return { document, entries, duration: ticks / fps, frameAt: SpriteCels.playback(entries, fps, playback), boil };
}

function find(cels, id) {
  const index = cels.findIndex(row => row.id === id);
  if (index < 0) throw new RangeError('Unknown painting cel ' + id);
  return index;
}

function select(clip, flags) {
  if (flags.frame !== undefined && flags.at !== undefined)
    throw new RangeError('Select a painting cel by --frame or --at');
  if (flags.at !== undefined && (typeof flags.at !== 'string' || !flags.at.trim() ||
      !Number.isFinite(Number(flags.at)) || Number(flags.at) < 0))
    throw new RangeError('Painting sample time must be finite and nonnegative');
  const at = flags.at === undefined ? undefined : Number(flags.at), { entries } = clip;
  const index = flags.frame !== undefined ? find(entries, flags.frame) : clip.frameAt(at ?? 0);
  const entry = entries[index], time = at ?? entry.time;
  return clip.boil ? clip.boil.at(entry, time) : still(entry, time);
}

const still = (entry, time = entry.time) => ({ entry, time, hold: entry.hold, marks: entry.marks, drawings: [] });
const start = (clip, entry) => clip.boil?.start(entry) ?? still(entry);

function placed(placement, marks) {
  const slots = new Set(marks.map(row => row.attachment?.slot));
  const bindings = Object.fromEntries(Object.entries(placement.bindings ?? {}).filter(([slot]) => slots.has(slot)));
  return { ...placement, bindings, painting: { ...placement.painting, marks } };
}

function edit(clip, request, K) {
  if (!fields(request, ['format', 'version', 'fps', 'playback', 'operations']) || request.format !== editFormat ||
      request.version !== 1 || !Array.isArray(request.operations) || request.operations.length > 128 ||
      !request.operations.length && request.fps === undefined && request.playback === undefined)
    throw new TypeError('Use a version 1 painting cel edit with timing settings or up to 128 operations');
  const api = K.authoring.paintings3d;
  const { placement } = clip.document, cels = clip.document.cels.slice(), original = new Set(cels);
  for (const change of request.operations) {
    if (!record(change) || !name(change.id)) throw new TypeError('A painting cel edit needs an operation and cel ID');
    const { id, op } = change;
    if (op === 'insert') {
      if (!fields(change, ['op', 'id', 'after', 'from', 'hold']) || cels.some(row => row.id === id))
        throw new TypeError('A cel insert needs a new ID and optional after, from, and hold');
      const from = change.from === undefined ? undefined : cels[find(cels, change.from)];
      const at = change.after === undefined ? cels.length : find(cels, change.after) + 1;
      cels.splice(at, 0, { id, hold: change.hold === undefined ? from?.hold ?? 1 : change.hold, marks: from?.marks ?? [] });
      continue;
    }
    const i = find(cels, id);
    if (op === 'remove' && fields(change, ['op', 'id'])) cels.splice(i, 1);
    else if (op === 'move' && fields(change, ['op', 'id', 'before']) && change.before !== id) {
      const [entry] = cels.splice(i, 1);
      cels.splice(change.before === undefined ? cels.length : find(cels, change.before), 0, entry);
    } else if (op === 'set-hold' && fields(change, ['op', 'id', 'hold'])) cels[i] = { ...cels[i], hold: change.hold };
    else if (op === 'edit-marks' && fields(change, ['op', 'id', 'edits']) && Array.isArray(change.edits)) {
      const input = placed(placement, cels[i].marks);
      const [{ painting }] = api.revise({ paintings3d: [input] }, { id: placement.id, edits: change.edits }, true);
      cels[i] = { ...cels[i], marks: painting.marks };
    } else throw new TypeError('Use insert, remove, move, set-hold or edit-marks for a painting cel');
  }
  const { fps = clip.document.fps, playback = clip.document.playback } = request;
  const revised = open({ ...clip.document, fps, playback, cels }, K);
  return { revised, changed: cels.filter(row => !original.has(row)) };
}

function manifest(clip, entry, exposure = start(clip, entry)) {
  const placement = clip.document.placement.id;
  return { id: entry.id, frame: entry.frame, time: entry.time, hold: entry.hold, duration: entry.duration,
    marks: entry.marks.map(mark => ({ id: mark.id, solid: solidId(placement, mark.id), enabled: mark.enabled ?? true })),
    ...(exposure.drawings.length && { boil: exposure.drawings }) };
}

function sceneWith(source, placement) {
  const list = source.paintings3d ?? [];
  if (list.some(row => row.id === placement.id))
    return { ...source, paintings3d: list.map(row => row.id === placement.id ? placement : row) };
  return { ...source, paintings3d: [...list, placement] };
}

function viewOptions(settings) {
  if (!fields(settings, ['w', 'h', 'camera', 'raw', 'opacity'])) throw new TypeError('Invalid painting view settings');
  const { w = 320, h = 240, camera, raw = false, opacity = .48 } = settings;
  if (!integer(w, 8, 1024) || !integer(h, 8, 1024) || w * h > 524288 ||
      camera !== undefined && !record(camera) || typeof raw !== 'boolean' ||
      !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new TypeError('Painting view needs bounded dimensions, optional camera, raw switch and opacity in 0–1');
  return { w, h, camera, raw, opacity };
}

function shots(clip, source, view, active, build, kit) {
  const { placement } = clip.document, { w, h, raw } = view;
  const rest = { ...source, paintings3d: (source.paintings3d ?? []).filter(row => row.id !== placement.id) };
  const celScene = sample => sceneWith(source, placed(placement, sample.marks));
  const worldAt = (scene, at) => {
    const world = build(scene, at);
    pose(world, at, { kit, maxSteps: 7200 });
    return world;
  };
  const cameraSample = clip.boil && (active.entry !== clip.entries[0] || active.time !== 0)
    ? start(clip, clip.entries[0]) : active;
  const first = worldAt(celScene(cameraSample), cameraSample.time);
  const lensOptions = { camera: view.camera === undefined ? undefined : kit.KIT.procedural.sceneGraph.camera(view.camera),
    t: cameraSample.time, lockCamera: true };
  const projection = kit.CameraLens.frame(first, lensOptions, w, h, {
    orbit: kit.KIT.cameraStaging.prepare(first.look?.cameraStaging)?.orbit
  });
  const camera = { ...projection.lens, pose: projection.pose, target: projection.base.target,
    yaw: projection.yaw, pitch: projection.pitch, dist: projection.dist, ortho: projection.ortho };
  const draw = (world, t, ownership = false) => {
    const result = R.render(world, { w, h, px: 1, t, raw, camera, ortho: camera.ortho, lockCamera: true,
      renderGrid: false, shutter: false, cameraGuides: false, ...(ownership && {passes:['objectId']}) });
    if (result.w !== w || result.h !== h || result.rgb.length !== w * h * 3)
      throw new RangeError('Painting cels need a matching native-grid color capture');
    return result;
  };
  return { camera, baseline: () => draw(worldAt(rest, active.time), active.time),
    frame: (sample, at = sample.time, ownership) => draw(
      sample === cameraSample && at === sample.time ? first : worldAt(celScene(sample), at), at, ownership) };
}

const ghosts = [
  { offset: -1, side: 'previous', tint: [255, 116, 149] },
  { offset: 1, side: 'next', tint: [120, 220, 198] }
];

function different(a, b, i) {
  return Math.abs(a[i] - b[i]) > 3 || Math.abs(a[i + 1] - b[i + 1]) > 3 || Math.abs(a[i + 2] - b[i + 2]) > 3;
}

function onion(active, base, neighbors, opacity) {
  if (!opacity) return active;
  const rgb = active.rgb.slice();
  for (let i = 0; i < rgb.length; i += 3) {
    let count = 0, red = 0, green = 0, blue = 0;
    for (const row of neighbors) {
      const { rgb, passes } = row.frame;
      if (!row.owners.has(passes.objectId[i / 3]) ||
          !different(rgb, base.rgb, i) || !different(rgb, active.rgb, i)) continue;
      row.pixels++;
      count++;
      red += row.tint[0];
      green += row.tint[1];
      blue += row.tint[2];
    }
    if (!count) continue;
    const amount = different(active.rgb, base.rgb, i) ? opacity * .45 : opacity;
    rgb[i] = Math.round(rgb[i] + (red / count - rgb[i]) * amount);
    rgb[i + 1] = Math.round(rgb[i + 1] + (green / count - rgb[i + 1]) * amount);
    rgb[i + 2] = Math.round(rgb[i + 2] + (blue / count - rgb[i + 2]) * amount);
  }
  return { w: active.w, h: active.h, rgb };
}

function renderPreview(clip, sample, source, view, build, kit, output) {
  const { entry, time } = sample;
  const { entries } = clip, total = entries.length;
  const { placement } = clip.document;
  const capture = shots(clip, source, view, sample, build, kit);
  const active = capture.frame(sample), ids = new Map(entry.marks.map((mark, order) => [mark.id, {mark, order}]));
  const activeDrawings = new Map(sample.drawings.map(row => [row.id, row.drawing]));
  const neighbors = ghosts.flatMap(ghost => {
    let i = entry.frame + ghost.offset;
    if (clip.document.playback === 'loop') i = (i + total) % total;
    if (i === entry.frame || i < 0 || i >= total) return [];
    const cel = entries[i], neighbor = start(clip, cel), shared = cel.marks.filter(mark => ids.has(mark.id));
    const neighborDrawings = new Map(neighbor.drawings.map(row => [row.id, row.drawing]));
    const changed = cel.marks.filter((mark, order) => {
      const prior = ids.get(mark.id);
      return !prior || prior.order !== order || !isDeepStrictEqual(prior.mark, mark) ||
        activeDrawings.get(mark.id) !== neighborDrawings.get(mark.id);
    });
    const targets = new Set();
    for (const mark of changed) {
      if (mark.enabled === false) continue;
      targets.add(solidId(placement.id, mark.id));
      // A flat contribution inherits the receiver's render ownership.
      const receiver = mark.attachment?.kind === 'surface' && placement.bindings?.[mark.attachment.slot];
      if (receiver) targets.add(receiver);
    }
    const frame = capture.frame(neighbor, time, true), { objects } = frame.passes;
    const owners = new Set(objects.flatMap((object, index) => targets.has(object) ? [index] : []));
    return [{ ...ghost, id: cel.id, shared: shared.map(mark => mark.id),
      changed: changed.filter(mark => ids.has(mark.id)).map(mark => mark.id), frame, owners, pixels: 0 }];
  });
  const combined = neighbors.length ? onion(active, capture.baseline(), neighbors, view.opacity) : active;
  const image = (file, frame) => ({ file, bytes: PNG.encodeFrame(PNG.packFrame(frame)) });
  const receipt = { format: 'ink-studio/painting-cel-preview', version: 1, active: manifest(clip, entry, sample), time,
    camera: capture.camera, image: 'onion.png', neighbors: neighbors.map(({ side, id, shared, changed, pixels }) =>
      ({ side, id, shared, changed, pixels, image: side + '.png' })) };
  output([image('active.png', active), image('onion.png', combined),
    ...neighbors.map(({ side, frame }) => image(side + '.png', frame)), { file: 'preview.json', document: receipt }]);
  return receipt;
}

function renderExport(clip, source, view, build, kit, output) {
  const samples = clip.boil?.frames() ?? clip.entries.map(entry => still(entry));
  if (view.w * view.h * samples.length > 16e6) throw new RangeError('Painting export exceeds its frame pixel budget');
  const capture = shots(clip, source, view, samples[0], build, kit);
  const frames = samples.map(sample => PNG.packFrame(capture.frame(sample)));
  const rows = samples.map(({ entry, time, hold, drawings }, i) => ({ cel: entry.id, time, hold,
    ...(drawings.length && { boil: drawings }), image: 'frames/' + String(i + 1).padStart(3, '0') + '-' + entry.id + '.png' }));
  const firstImages = new Map(rows.slice().reverse().map(row => [row.cel, row.image]));
  const cels = clip.entries.map(entry => ({ ...manifest(clip, entry), image: firstImages.get(entry.id) }));
  const { fps, playback } = clip.document;
  const receipt = { format: 'ink-studio/painting-cel-export', version: 1, fps, playback,
    duration: clip.duration, camera: capture.camera, cels, ...(clip.boil && { frames: rows }), animation: 'painting.png' };
  output([...rows.map((entry, i) => ({ file: entry.image, bytes: PNG.encodeFrame(frames[i]) })),
    { file: receipt.animation, bytes: PNG.encodeAnimation(frames, fps, { holds: rows.map(row => row.hold), loop: playback === 'loop' }) },
    { file: 'export.json', document: receipt }]);
  return receipt;
}

module.exports = function paintingCels([verb, ...args], flags, kit, loadScene) {
  const config = Object.hasOwn(verbs, verb) && verbs[verb], { out, view } = flags;
  if (!config || args.length !== config.args || !args.every(jsonPath) ||
      Object.keys(flags).some(key => !config.flags.includes(key)) ||
      (verb !== 'inspect' && (typeof out !== 'string' || !out.length)) ||
      (['init', 'edit', 'sample'].includes(verb) && !jsonPath(out)) ||
      (view !== undefined && !jsonPath(view)))
    throw new TypeError('Use painting-cels init|inspect|edit|sample|preview|export. See ink-studio help for syntax');
  const K = kit.KIT;
  if (verb === 'inspect') {
    const clip = open(read(args[0]), K);
    const { fps, playback, placement } = clip.document;
    return report({ fps, playback, placement: placement.id, duration: clip.duration, cels: clip.entries.map(row => manifest(clip, row)) });
  }
  const [scene, clipFile, editFile] = args;
  const descriptor = loadScene(scene);
  if (!descriptor.openEditor) throw new TypeError('Painting cels need a plain editable JSON scene');
  const editor = descriptor.openEditor({ historyLimit: 0 }), source = editor.snapshot();
  const destinations = graphOutputs([...args, ...(view ? [view] : [])]);
  const save = value => {
    destinations.protect(fs.statSync(out, { throwIfNoEntry: false }));
    files.json(out, value);
  };
  if (verb === 'init') {
    const existing = source.paintings3d?.find(row => row.id === flags.id);
    if (!existing) throw new RangeError('Choose a retained painting with --id');
    if (flags.fps !== undefined && (typeof flags.fps !== 'string' || !flags.fps.trim()))
      throw new RangeError('--fps needs a positive integer');
    editor.inspectPaintings3d();
    const { painting: { marks, ...painting }, ...placement } = existing;
    const created = open({ format, version: 1, fps: flags.fps === undefined ? 12 : Number(flags.fps),
      playback: flags.playback ?? 'loop', placement: { ...placement, painting }, cels: [{ id: 'cel-1', hold: 1, marks }] }, K);
    save(created.document);
    return report({ out, cel: manifest(created, created.entries[0]) });
  }
  const clip = open(read(clipFile), K), { placement } = clip.document;
  const update = source.paintings3d?.some(row => row.id === placement.id) ?? false;
  const validate = marks => {
    const request = placed(placement, marks);
    const plan = editor.planPainting3d(update ? { transform: null, ...request } : request, { update });
    return { ...source, paintings3d: plan.paintings3d };
  };
  if (verb === 'edit') {
    const { revised, changed } = edit(clip, read(editFile), K);
    for (const row of changed) validate(row.marks);
    save(revised.document);
    return report({ out, duration: revised.duration, cels: revised.entries.map(row => manifest(revised, row)) });
  }
  if (verb === 'sample') {
    if (path.dirname(path.resolve(out)) !== path.dirname(path.resolve(scene)))
      throw new RangeError('Write the sampled scene beside its source to preserve relative assets');
    const sample = select(clip, flags), { entry, time } = sample;
    save(validate(sample.marks));
    return report({ out, time, cel: manifest(clip, entry, sample) });
  }
  const options = viewOptions(view ? read(view) : {});
  const build = (snapshot, time) => loadScene(scene, snapshot).build(undefined, { parameterInputs: { time } });
  const output = artifacts => destinations.write(path.resolve(out), artifacts);
  if (verb === 'export') return report(renderExport(clip, source, options, build, kit, output));
  return report(renderPreview(clip, select(clip, flags), source, options, build, kit, output));
};
module.exports.format = format;
