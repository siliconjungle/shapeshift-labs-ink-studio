const path = require('node:path');
const Bitmap = require('../src/bitmap-resources.js');
const Linked = require('./bitmap-resources.js');
const { openMaterialGraph } = require('./material-graph.js');

const fields = (value, keys) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.keys(value).every(key => keys.includes(key));
const isId = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function options(settings = {}) {
  const { baseDir = process.cwd(), kit = require('../index.js').load() } = settings;
  return { baseDir: path.resolve(baseDir), declare: kit.KIT.procedural.graphImages.declare };
}

function resource(document, id) {
  const found = Object.hasOwn(document.resources ?? {}, id) && document.resources[id];
  if (found?.definition?.format !== Bitmap.format) throw new RangeError('Unknown material bitmap ' + id);
  return found;
}

function describeMaterialBitmap(document, id, settings) {
  const entry = resource(openMaterialGraph(document), id);
  return { id, ...(entry.label !== undefined && { label: entry.label }),
    ...Linked.load(entry.definition, { baseDir: path.resolve(settings?.baseDir ?? process.cwd()) }).info };
}

function editMaterialBitmap(source, request, settings) {
  const variants = {
    link: ['definition', 'label'], embed: ['frame', 'tile'], reimport: ['frame', 'tile'], replace: ['frame', 'tile', 'member'],
    edit: ['frame', 'tile', 'pixels', 'interpretation', 'missing', 'playback', 'label']
  };
  if (!Object.hasOwn(variants, request?.kind) || !fields(request, ['kind', 'id', ...variants[request.kind]]) ||
      !isId(request.id) || request.label !== undefined && (typeof request.label !== 'string' || request.label.length > 100))
    throw new TypeError('Invalid material bitmap edit');
  const { kind, id, label } = request, document = openMaterialGraph(source), load = options(settings);
  const resources = document.resources ??= {};
  let entry;
  if (kind === 'link') {
    if (Object.hasOwn(resources, id)) throw new RangeError('Bitmap resource ID is already in use: ' + id);
    const { definition } = request;
    Bitmap.layout(definition);
    entry = { definition, ...(label !== undefined && { label }) };
  } else {
    entry = { ...resource(document, id) };
    const definition = entry.definition;
    if (kind === 'edit') {
      if (!['pixels', 'interpretation', 'missing', 'playback', 'label'].some(key => Object.hasOwn(request, key)))
        throw new TypeError('Bitmap edit needs at least one authored change');
      if (request.pixels === undefined && (request.frame !== undefined || request.tile !== undefined))
        throw new TypeError('Frame and tile selectors apply to pixel edits');
      entry.definition = { ...definition };
      for (const key of ['interpretation', 'missing']) if (Object.hasOwn(request, key))
        entry.definition[key] = request[key];
      if (request.playback !== undefined) {
        if (!definition.sequence) throw new TypeError('Only sequence bitmaps have playback settings');
        entry.definition.sequence = { ...definition.sequence, playback: request.playback };
      }
      if (label !== undefined) entry.label = label;
    }
    if (kind !== 'edit' || request.pixels !== undefined) {
      const key = Bitmap.memberKey(definition, request);
      entry.definition = Bitmap.mapMembers(entry.definition, (member, name) => {
        if (name !== key) return member;
        if (kind === 'embed' || kind === 'reimport') return Linked.embed(member, load.baseDir, kind === 'reimport');
        if (kind === 'replace') return Bitmap.member(request.member);
        if (member === null) throw new RangeError('Add a source before editing a missing bitmap frame');
        Bitmap.pixels(request.pixels);
        return { ...member, pixels: request.pixels };
      });
    }
  }
  resources[id] = entry;
  const saved = openMaterialGraph(document), compiled = Linked.load(saved.resources[id].definition, load);
  return { document: saved, bitmap: { id, ...(entry.label !== undefined && { label: entry.label }), ...compiled.info } };
}

module.exports = { describeMaterialBitmap, editMaterialBitmap };
