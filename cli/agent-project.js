'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { publishJson, write } = require('./asset-files.js');
const Bundles = require('./project-bundle.js');

const format = 'ink-studio/project-authoring';
const editFormat = 'ink-studio/project-edit';
const attachment = 'ink-authoring';
const commandOptions = Object.freeze({
  inspect: [],
  sample: ['at', 'w', 'h', 'pick', 'out'],
  pixel: ['at', 'frame', 'layer'],
  preview: ['at', 'w', 'h', 'pick', 'image'],
  apply: ['out']
});
const usages = [
  'project author inspect <bundle.json>   list the current revision, scene addresses, pixel assets and timeline',
  'project author sample <bundle.json> --at seconds [--w pixels --h pixels --pick x,y --out frame.png]',
  'project author pixel <bundle.json> <asset> --at x,y [--frame id --layer id]   inspect a native pixel',
  'project author preview <bundle.json> <edit.json> [--at seconds --w pixels --h pixels --pick x,y --image frame.png]',
  'project author apply <bundle.json> <edit.json> --out <revision.json>   save all edits as one guarded project revision'
];

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => record(value) && Object.keys(value).every(key => names.includes(key));
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value);
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readAttachment = (project, id) => {
  const { path: file, bytes } = project.attachment(id);
  if (!/\.json$/i.test(file)) throw new TypeError('Project authoring attachments need JSON files: ' + id);
  return { file, document: JSON.parse(Buffer.from(bytes).toString('utf8')) };
};
const pixelEditor = document => require('./pixel-art.js').createEditor(document);
const snapshotKey = project => createHash('sha256').update(JSON.stringify(project.snapshot())).digest('hex');

function sources(project) {
  if (!Object.hasOwn(project.snapshot().attachments, attachment)) return null;
  if (typeof project.withScene !== 'function') throw new TypeError('Authoring needs a portable diorama project');
  const { document } = readAttachment(project, attachment);
  if (!fields(document, ['format', 'version', 'pixels', 'soundtrack']) ||
      document.format !== format || document.version !== 1 ||
      !record(document.pixels ?? {}) || Object.keys(document.pixels ?? {}).length > 128)
    throw new TypeError('Expected a version 1 project authoring attachment');
  const pixels = new Map();
  const files = new Set([project.metadata.entry]);
  for (const [id, row] of Object.entries(document.pixels ?? {})) {
    if (!idOK(id) || !fields(row, ['source', 'placement', 'frame']) || !idOK(row.source) ||
        !record(row.placement) || ['stamp', 'preset', 'objectId'].some(key => Object.hasOwn(row.placement, key)) ||
        (row.frame !== undefined && !idOK(row.frame)))
      throw new TypeError('Invalid authored pixel placement: ' + id);
    const art = readAttachment(project, row.source);
    if (files.has(art.file)) throw new TypeError('Pixel assets need distinct source files: ' + id);
    files.add(art.file);
    pixels.set(id, { ...row, ...art, editor: pixelEditor(art.document) });
  }
  let soundtrack;
  if (document.soundtrack !== undefined) {
    if (!idOK(document.soundtrack)) throw new TypeError('Choose a named soundtrack attachment');
    soundtrack = readAttachment(project, document.soundtrack);
    if (soundtrack.document?.format !== 'ink-studio/scene-audio' || soundtrack.document.version !== 1)
      throw new TypeError('Expected a version 1 scene soundtrack for project authoring');
  }
  return { pixels, soundtrack };
}

function placement(id, entry) {
  return { ...entry.placement, objectId: id, stamp: entry.editor.stamp({ frame: entry.frame }) };
}

function splitPlacements(scene, pixels) {
  const fixed = [], managed = new Map();
  for (const row of scene.finish?.pixelStamps ?? []) {
    if (!pixels.has(row.objectId)) fixed.push(row);
    else {
      if (managed.has(row.objectId)) throw new RangeError('Duplicate authored pixel placement: ' + row.objectId);
      managed.set(row.objectId, row);
    }
  }
  return { fixed, managed };
}

function projected(scene, pixels, fixed) {
  if (!pixels.size) return scene;
  return { ...scene, finish: { ...scene.finish,
    pixelStamps: [...fixed, ...Array.from(pixels, ([id, entry]) => placement(id, entry))] } };
}

function initialize(project) {
  const authored = sources(project);
  if (!authored?.pixels.size) return project;
  const scene = project.scene();
  const { fixed } = splitPlacements(scene, authored.pixels);
  return project.withScene(projected(scene, authored.pixels, fixed), { revision: project.metadata.revision });
}

function context(project) {
  const authored = sources(project);
  if (!authored) throw new RangeError('Project has no ' + attachment + ' authoring attachment');
  const scene = project.scene();
  const { fixed, managed } = splitPlacements(scene, authored.pixels);
  for (const [id, entry] of authored.pixels)
    if (!isDeepStrictEqual(managed.get(id), JSON.parse(JSON.stringify(placement(id, entry)))))
      throw new Error('Stale pixel placement in the bundle: ' + id + '. Repack its editable source files.');
  return { ...authored, scene, fixed, project };
}

function inspect(project) {
  const { scene, pixels, soundtrack } = context(project);
  return {
    ...project.metadata, base: snapshotKey(project), objects: project.editor().tree(),
    pixels: Object.fromEntries(Array.from(pixels, ([id, asset]) => [id, {
      source: asset.source, file: asset.file, placement: asset.placement, frame: asset.frame, document: asset.editor.describe()
    }])),
    timeline: scene.timeline ?? {},
    soundtrack: soundtrack && { file: soundtrack.file, assets: Object.keys(soundtrack.document.assets ?? {}) },
    edits: Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, operation.fields]))
  };
}

function targetPixel(state, id) {
  const entry = state.pixels.get(id);
  if (!entry) throw new RangeError('Unknown project pixel asset: ' + id);
  return entry;
}

function timelineTrack(scene, target, keys) {
  if (typeof target !== 'string' || !target.startsWith('/') || !Array.isArray(keys) || !keys.length)
    throw new TypeError('A timeline track needs a JSON Pointer target and a nonempty key list');
  const tracks = [...(scene.timeline?.tracks ?? [])];
  const pointer = value => Array.isArray(value) ? '/' + value.map(part =>
    String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : value;
  const index = tracks.findIndex(track => pointer(track.target) === target);
  const track = { target, keys };
  if (index < 0) tracks.push(track);
  else tracks[index] = track;
  scene.timeline = { ...scene.timeline, tracks };
}

function timelineCue(state, edit) {
  if (!idOK(edit.id) || !fields(edit.values, ['time', 'cue', 'duration', 'offset', 'gain']))
    throw new TypeError('A cue edit needs an ID and named cue fields');
  const { scene } = state;
  const audio = [...(scene.timeline?.audio ?? [])];
  const index = audio.findIndex(cue => cue.id === edit.id);
  const cue = { ...audio[index], ...edit.values, id: edit.id };
  const soundtrack = state.soundtrack?.document;
  if (typeof cue.cue !== 'string' || (!Object.hasOwn(soundtrack?.assets ?? {}, cue.cue) &&
      !Object.hasOwn(soundtrack?.spatial?.cues ?? {}, cue.cue)))
    throw new RangeError('Cue must name an asset or spatial cue in the project soundtrack: ' + cue.cue);
  if (index < 0) audio.push(cue);
  else audio[index] = cue;
  scene.timeline = { ...scene.timeline, audio };
}

const operations = {
  'scene.material': { fields: ['target', 'material'], edit(state, { target, material }) {
    if (typeof target !== 'string' || material === undefined) throw new TypeError('A material edit needs an address and material');
    const editor = state.project.resolve(state.scene);
    const { KIT } = require('../index.js').load();
    const scene = KIT.authoring.sceneEditor.create(editor.spec, { env: editor.env });
    scene.setMaterial(material, target);
    state.scene = structuredClone(scene.snapshot());
  } },
  'pixels.edit': { fields: ['asset', 'patch'], edit(state, { asset, patch }) {
    const { editor } = targetPixel(state, asset);
    if (!record(patch)) throw new TypeError('A pixel edit needs a native pixel-art patch');
    editor.apply({ ...patch, revision: patch.revision ?? editor.describe().revision });
    state.changedPixels.add(asset);
    return editor.receipts().at(-1);
  } },
  'timeline.track': { fields: ['target', 'keys'], edit(state, { target, keys }) {
    timelineTrack(state.scene, target, keys);
  } },
  'timeline.cue': { fields: ['id', 'values'], edit: timelineCue }
};

function transact(project, patch) {
  const state = { ...context(project), changedPixels: new Set() };
  const base = snapshotKey(project);
  if (!fields(patch, ['format', 'version', 'base', 'edits']) || patch.format !== editFormat ||
      patch.version !== 1 || !Array.isArray(patch.edits) || !patch.edits.length || patch.edits.length > 256)
    throw new TypeError('Expected a bounded version 1 project edit');
  if (patch.base !== base) throw new RangeError('Project edit base is stale. Inspect the current bundle before editing.');
  const changes = patch.edits.map(edit => {
    const operation = record(edit) && Object.hasOwn(operations, edit.op) && operations[edit.op];
    if (!operation || !fields(edit, ['op', ...operation.fields])) throw new TypeError('Unknown or invalid project edit: ' + edit?.op);
    const receipt = operation.edit(state, edit);
    return { op: edit.op, ...(receipt && { receipt }) };
  });
  const scene = projected(state.scene, state.pixels, state.fixed);
  const data = project.withScene(scene).snapshot();
  for (const id of state.changedPixels) {
    const { file, editor } = state.pixels.get(id);
    data.files[file] = { encoding: 'utf8', data: JSON.stringify(editor.snapshot(), null, 2) + '\n' };
  }
  const next = require('../index.js').load().KIT.authoring.projectBundles.open(data, {
    digest: bytes => createHash('sha256').update(bytes).digest('hex')
  });
  const report = { format: 'ink-studio/project-edit-result', version: 1,
    id: next.metadata.id, revision: next.metadata.revision, base, next: snapshotKey(next), changes };
  return { project: next, report };
}

function withExportSource(input, callback) {
  return Bundles.withTakeSource(input, callback, document => {
    if (!Object.hasOwn(document.attachments ?? {}, attachment)) return callback(input);
    const project = Bundles.readProjectBundle(input);
    const { soundtrack } = context(project);
    return soundtrack ? Bundles.mountProject(project, (_, root) => callback(input, path.join(root, soundtrack.file))) :
      callback(input);
  });
}

function coordinate(value) {
  if (typeof value !== 'string' || !/^\d+,\d+$/.test(value)) throw new TypeError('Use native pixel coordinates x,y');
  return value.split(',').map(Number);
}

function frame(project, options, output) {
  const { pixels } = context(project);
  const at = Number(options.at ?? 0), w = Number(options.w ?? 192), h = Number(options.h ?? 112);
  if (!Number.isFinite(at) || at < 0 || !require('./scene-replay.js').dimensions(w, h))
    throw new RangeError('Choose a nonnegative sample time and valid art dimensions');
  if (output !== undefined && !/\.png$/i.test(output)) throw new TypeError('Frame output needs a .png filename');
  const point = options.pick === undefined ? null : coordinate(options.pick);
  const kit = require('../index.js').load();
  const world = project.build({ parameterInputs: { time: at } });
  require('./diarama-pose.js').pose(world, at, { kit });
  const image = require('./render.js').render(world, { w, h, px: 1, t: at, time: at,
    ...(point && { passes: [...kit.ArtPasses.opaque.filter(channel => !kit.ArtPasses.needsSurfaceMotion([channel])), 'partId'] }) });
  const PNG = require('./png.js');
  let hit = point && kit.ArtPasses.pick(image.passes, ...point);
  const pixel = hit && pixels.get(hit.object);
  if (hit?.kind === 'sprite' && pixel) {
    const [width, height] = pixel.editor.describe().grid;
    const texel = (position, size) => Math.min(size - 1, Math.max(0, Math.floor(position * size)));
    const pixelAt = hit.uv && [texel(hit.uv[0], width), texel(1 - hit.uv[1], height)];
    hit = { ...hit, pixelAsset: hit.object, ...(pixelAt && { pixelAt }) };
  }
  if (output) write(path.resolve(output), PNG.encodeFrame(PNG.packFrame(image)));
  return { at, width: image.w, height: image.h, camera: world.cam,
    timeline: world.timeline?.sample(at), ...(point && { hit }),
    ...(output && { image: path.resolve(output) }) };
}

function command([mode, file, value, ...rest], options) {
  if (!Object.hasOwn(commandOptions, mode) || !file || rest.length ||
      (['pixel', 'preview', 'apply'].includes(mode) ? !value : value !== undefined) ||
      Object.entries(options).some(([name, option]) => !commandOptions[mode].includes(name) || typeof option !== 'string' || !option.trim()) ||
      (['sample', 'pixel'].includes(mode) && options.at === undefined) ||
      (mode === 'apply' && !/\.json$/i.test(options.out ?? '')))
    throw new TypeError(usages.map(line => 'ink-studio ' + line).join('\n'));
  const project = Bundles.readProjectBundle(file);
  let result;
  if (mode === 'inspect') result = inspect(project);
  else if (mode === 'sample') result = frame(project, options, options.out);
  else if (mode === 'pixel') {
    const { editor, frame } = targetPixel(context(project), value);
    const at = coordinate(options.at);
    const selectedFrame = options.frame ?? frame;
    result = options.layer === undefined ? editor.inspect(at, { frame: selectedFrame }) :
      editor.sample(at, { frame: selectedFrame, mode: 'layer', layer: options.layer });
  }
  else {
    const next = transact(project, readJSON(value));
    result = next.report;
    if (mode === 'preview' && Object.keys(options).length) result.sample = frame(next.project, options, options.image);
    if (mode === 'apply') {
      const out = path.resolve(options.out);
      publishJson(out, next.project.snapshot(), 'Project output already contains a different revision');
      result.file = out;
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
module.exports = { initialize, withExportSource, command, commandOptions, usages };
