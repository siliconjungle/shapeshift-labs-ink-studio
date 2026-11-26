const Fonts = require('./font-resources.js');
const { openMaterialGraph } = require('./material-graph.js');
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function resource(document, name) {
  const entry = Object.hasOwn(document.resources ?? {}, name) && document.resources[name];
  if (entry?.definition?.format !== Fonts.format) throw new RangeError('Unknown material font ' + name);
  return entry;
}
function describe(name, row, loaded) {
  return { id: name, ...(row.label !== undefined && {label: row.label}), ...loaded.info, sha256: loaded.sha256 };
}
function describeMaterialFont(source, name, options) {
  const row = resource(openMaterialGraph(source), name);
  return describe(name, row, Fonts.load(row.definition, options));
}

function editMaterialFont(source, request, { baseDir = process.cwd() } = {}) {
  const modes = { link: ['file', 'family', 'style', 'label'], embed: [], replace: ['definition'], reimport: [] };
  if (!record(request) || !Object.hasOwn(modes, request.kind) || !id(request.id) ||
      Object.keys(request).some(key => !['kind', 'id', ...modes[request.kind]].includes(key)) ||
      request.label !== undefined && typeof request.label !== 'string')
    throw new TypeError('Invalid material font resource edit');
  const document = openMaterialGraph(source), resources = document.resources ??= {};
  const { kind, id: name, family, style, label, file } = request;
  let row;
  if (kind === 'link') {
    if (Object.hasOwn(resources, name)) throw new RangeError('Material resource ID already in use: ' + name);
    row = { definition: { format: Fonts.format, file, ...(family !== undefined && {family}),
      ...(style !== undefined && {style}) }, ...(label !== undefined && {label}) };
  } else {
    const previous = resource(document, name), current = previous.definition;
    let definition = current;
    if (kind === 'replace') definition = request.definition;
    if (kind === 'embed' && current.file) {
      const { value } = Fonts.load(current, { baseDir });
      definition = { format: Fonts.format, data: value.data, family: value.family, style: value.style, origin: current.file };
    }
    if (kind === 'reimport') {
      if (!current.file && !current.origin) throw new RangeError('Embedded font has no reimport origin');
      if (current.origin) definition = { ...current,
        data: Fonts.read(current.origin, baseDir).bytes.toString('base64') };
    }
    row = { ...previous, definition };
  }
  const loaded = Fonts.load(row.definition, { baseDir });
  resources[name] = row;
  return { document: openMaterialGraph(document), font: describe(name, row, loaded) };
}

module.exports = { describeMaterialFont, editMaterialFont };
