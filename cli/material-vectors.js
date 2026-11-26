const Vector = require('../src/vector-resources.js');
const files = require('./vector-resources.js');
const { openMaterialGraph } = require('./material-graph.js');
const fields = (value, keys) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.keys(value).every(key => keys.includes(key));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function resource(document, name) {
  const row = Object.hasOwn(document.resources ?? {}, name) && document.resources[name];
  if (row?.definition?.format !== files.format) throw new RangeError('Unknown material vector ' + name);
  return row;
}
function describe(name, row, loaded) {
  return { id: name, ...(row.label !== undefined && { label: row.label }), ...loaded.info,
    sha256: loaded.sha256, ...Vector.describe(loaded.value) };
}
function describeMaterialVector(source, name, options) {
  const row = resource(openMaterialGraph(source), name);
  return describe(name, row, files.load(row.definition, options));
}

function editMaterialVector(source, request, { baseDir = process.cwd() } = {}) {
  const modes = { link: ['file', 'label'], embed: [], reimport: [], replace: ['definition'], edit: ['edits'] };
  if (!Object.hasOwn(modes, request?.kind) || !fields(request, ['kind', 'id', ...modes[request.kind]]) ||
      !id(request.id) || request.label !== undefined && typeof request.label !== 'string')
    throw new TypeError('Invalid material vector resource edit');
  const { kind, id: name } = request, document = openMaterialGraph(source), resources = document.resources ??= {};
  const previous = kind === 'link' ? null : resource(document, name);
  let row;
  if (kind === 'link') {
    if (Object.hasOwn(resources, name)) throw new RangeError('Material resource ID already in use: ' + name);
    row = { definition: { format: files.format, file: request.file },
      ...(request.label !== undefined && { label: request.label }) };
  } else {
    const current = previous.definition;
    const origin = current.file ?? current.origin;
    let definition;
    if (kind === 'replace') definition = request.definition;
    if (kind === 'embed' || kind === 'edit') {
      const { value } = files.load(current, { baseDir });
      definition = { format: files.format, document: kind === 'edit' ? Vector.edit(value, request.edits) : value,
        ...(origin && { origin }) };
    }
    if (kind === 'reimport') {
      if (!origin) throw new RangeError('Embedded vector has no reimport origin');
      definition = current.file ? current : { ...current, document: files.read(origin, baseDir).value };
    }
    row = { ...previous, definition };
  }
  const loaded = files.load(row.definition, { baseDir });
  resources[name] = row;
  return { document: openMaterialGraph(document), vector: describe(name, row, loaded) };
}

module.exports = { describeMaterialVector, editMaterialVector };
