const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const files = require('./asset-files.js');
const { groupReference } = require('./graph-groups.js');
const Base = require('../src/material-base-settings.js');
const Parameters = require('../src/material-parameters.js');
const Presets = require('../src/material-presets.js');
const OutputUsages = require('./material-output-usages.js');
const Metadata = require('./material-metadata.js');
const Bitmap = require('../src/bitmap-resources.js');
const Vector = require('./vector-resources.js');
const Fonts = require('./font-resources.js');

const format = 'ink-studio/material-graph';
const version = 1;
const projectFormat = 'ink-studio/graph-project';
const settingsKeys = ['assetRegistry', 'exports', 'assertions', 'time', 'seed', 'base', 'inheritance', 'primaryInput', 'outputUsages'];
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isId = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function fields(value, keys, label) {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Invalid ' + label);
}

function entity(value, keys, label) {
  fields(value, [...keys, 'label', 'extensions'], label);
  if (Object.hasOwn(value, 'label') && typeof value.label !== 'string' ||
      Object.hasOwn(value, 'extensions') && !record(value.extensions))
    throw new TypeError('Invalid metadata on ' + label);
}

function entries(value, label) {
  if (!record(value) || Object.keys(value).some(key => !isId(key)))
    throw new TypeError('Expected ' + label + ' keyed by stable IDs');
  return Object.entries(value);
}

function copyJson(value, depth = 0) {
  if (depth > 160) throw new TypeError('Material graph JSON is nested too deeply or contains a cycle');
  if (value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Array.from(value, item => copyJson(item, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, copyJson(item, depth + 1)]));
  throw new TypeError('Material graph data must be finite JSON');
}

function linked(binding) {
  return record(binding) && (Object.hasOwn(binding, 'input') || Object.hasOwn(binding, 'node'));
}

function migrateGraph(source) {
  fields(source, ['inputs', 'nodes', 'outputs', 'groups', 'result'], 'legacy graph scope');
  const links = {};
  function separate(binding, to) {
    if (!linked(binding)) return true;
    const key = JSON.stringify(to);
    const id = 'link-' + createHash('sha256').update(key).digest('hex').slice(0, 24);
    links[id] = { from: binding, to };
    return false;
  }
  const { inputs = {}, nodes, outputs, groups = {} } = source;
  return {
    ...(Object.hasOwn(source,'result') && {result:source.result}),
    inputs: Object.fromEntries(entries(inputs, 'legacy inputs').map(([id, definition]) => [id, { definition }])),
    nodes: Object.fromEntries(entries(nodes, 'legacy nodes').map(([id, node]) => {
      fields(node, ['op', 'group', 'type', 'inputs', 'params'], 'legacy node ' + id);
      for (const slot of ['params', 'inputs']) {
        if (!Object.hasOwn(node, slot)) continue;
        node[slot] = Object.fromEntries(entries(node[slot], 'legacy node ' + slot).filter(([port, binding]) =>
          separate(binding, { node: id, slot, port })));
      }
      return [id, node];
    })),
    outputs: Object.fromEntries(entries(outputs, 'legacy outputs').map(([id, binding]) =>
      [id, separate(binding, { output: id }) ? { binding } : {}])),
    groups: Object.fromEntries(entries(groups, 'legacy groups').map(([id, group]) =>
      [id, groupReference(group) ? { reference: group } : { graph: migrateGraph(group) }])),
    links
  };
}

function migrate(source, id) {
  if (source.version !== 1) throw new RangeError('Unsupported graph-project version ' + source.version);
  const { format: _format, version: _version, assets = {}, ...spec } = source;
  const settings = {};
  for (const key of settingsKeys) {
    if (!Object.hasOwn(spec, key)) continue;
    settings[key] = spec[key];
    delete spec[key];
  }
  return {
    format, version, id, graph: migrateGraph(spec), settings,
    resources: Object.fromEntries(entries(assets, 'legacy assets').map(([key, definition]) => [key, { definition }])),
    controls: Object.fromEntries(Object.keys(spec.inputs ?? {}).map(key => [key, { input: key }])),
    instances: {}
  };
}

function lowerGraph(scope, { requireOutputs, materialBase = false } = {}) {
  entity(scope, ['inputs', 'nodes', 'links', 'outputs', 'groups', 'result'], 'material graph scope');
  const { nodes, links, outputs, inputs = {}, groups = {} } = scope;
  const declaredInputs = entries(inputs, 'inputs');
  if (materialBase && Object.hasOwn(inputs, 'materialBase'))
    throw new TypeError('The materialBase graph input is reserved by shared base settings');
  if (Object.hasOwn(scope,'result') && (typeof scope.result !== 'string' ||
      !record(outputs) || Object.keys(outputs).length !== 1 || !Object.hasOwn(outputs,'result')))
    throw new TypeError('A material function scope needs a declared result type and result output');
  const native = {
    ...(Object.hasOwn(scope,'result') && {result:scope.result}),
    nodes: Object.fromEntries(entries(nodes, 'nodes').map(([id, node]) => {
      entity(node, ['op', 'group', 'type', 'inputs', 'params'], 'node ' + id);
      if (!isId(node.op) || Object.hasOwn(node, 'group') && !isId(node.group))
        throw new TypeError('Invalid operation or group on node ' + id);
      const { label, extensions, ...spec } = node;
      for (const slot of ['inputs', 'params']) {
        if (!Object.hasOwn(spec, slot)) continue;
        const bindings = entries(spec[slot], 'node ' + slot);
        if (bindings.some(([, binding]) => linked(binding)))
          throw new TypeError('Connections on node ' + id + ' require a link ID');
        spec[slot] = Object.fromEntries(bindings);
      }
      return [id, spec];
    })),
    outputs: {},
    ...(declaredInputs.length && { inputs: Object.fromEntries(declaredInputs.map(([id, value]) => {
      entity(value, ['definition', 'visibleWhen'], 'input ' + id);
      if (!Object.hasOwn(value, 'definition')) throw new TypeError('Missing definition on input ' + id);
      return [id, value.definition];
    })) })
  };
  for (const [id, output] of entries(outputs, 'outputs')) {
    entity(output, ['binding', 'visibleWhen'], 'output ' + id);
    if (!Object.hasOwn(output, 'binding')) continue;
    if (linked(output.binding)) throw new TypeError('Connection on output ' + id + ' requires a link ID');
    native.outputs[id] = output.binding;
  }
  const declaredGroups = entries(groups, 'groups');
  if (declaredGroups.length) native.groups = Object.fromEntries(declaredGroups.map(([id, group]) => {
    entity(group, ['graph', 'reference'], 'group ' + id);
    if (Object.hasOwn(group, 'graph') === Object.hasOwn(group, 'reference'))
      throw new TypeError('Group ' + id + ' needs one graph or reference');
    if (Object.hasOwn(group, 'graph')) return [id, lowerGraph(group.graph, { requireOutputs })];
    if (!groupReference(group.reference)) throw new TypeError('Invalid reference on group ' + id);
    return [id, group.reference];
  }));

  for (const [id, link] of entries(links, 'links')) {
    entity(link, ['from', 'to'], 'link ' + id);
    const { from, to } = link, label = 'link ' + id;
    fields(from, ['input', 'node', 'port'], 'source on ' + label);
    fields(to, ['output', 'node', 'slot', 'port'], 'destination on ' + label);
    if (Object.hasOwn(from, 'input')) {
      if (Object.keys(from).length !== 1 || !isId(from.input) || !Object.hasOwn(inputs, from.input) && !(materialBase && from.input === 'materialBase'))
        throw new RangeError('Unknown or invalid input on ' + label);
    } else if (!isId(from.node) || !Object.hasOwn(nodes, from.node) ||
        Object.hasOwn(from, 'port') && !isId(from.port)) {
      throw new RangeError('Unknown or invalid source node on ' + label);
    }
    if (Object.hasOwn(to, 'output')) {
      if (Object.keys(to).length !== 1 || !isId(to.output) || !Object.hasOwn(outputs, to.output))
        throw new RangeError('Unknown or invalid output on ' + label);
      if (Object.hasOwn(native.outputs, to.output)) throw new RangeError('Output already bound on ' + label);
      native.outputs[to.output] = from;
    } else {
      if (!isId(to.node) || !Object.hasOwn(nodes, to.node) || !isId(to.port) || !['params', 'inputs'].includes(to.slot))
        throw new RangeError('Unknown or invalid target socket on ' + label);
      const bindings = native.nodes[to.node][to.slot] ??= {};
      if (Object.hasOwn(bindings, to.port)) throw new RangeError('Socket already bound on ' + label);
      bindings[to.port] = from;
    }
  }
  for (const id of Object.keys(outputs)) {
    if (requireOutputs && !Object.hasOwn(native.outputs, id)) throw new RangeError('Unbound material output ' + id);
  }
  native.outputs = Object.fromEntries(Object.keys(outputs).filter(id => Object.hasOwn(native.outputs, id))
    .map(id => [id, native.outputs[id]]));
  return native;
}

function lower(document, { requireOutputs, instance } = {}) {
  entity(document, ['format', 'version', 'id', 'graph', 'resources', 'controls', 'instances', 'presets', 'settings', 'metadata'], 'material graph');
  if (!isId(document.id)) throw new TypeError('Material graph needs a stable ID');
  if (Object.hasOwn(document, 'metadata')) Metadata.validate(document.metadata);
  Presets.validatePresets(document.presets);
  const { graph, resources = {}, settings = {}, controls = {}, instances = {} } = document;
  fields(settings, settingsKeys, 'material graph execution settings');
  const materialBase = Object.hasOwn(settings, 'base');
  if (materialBase) Base.resolve(settings.base, { seed: settings.seed });
  if (!materialBase && (Object.hasOwn(settings, 'inheritance') || Object.hasOwn(settings, 'primaryInput')))
    throw new TypeError('Material inheritance needs shared settings.base');
  if (Object.hasOwn(settings, 'inheritance')) Base.checkRules(settings.inheritance);
  const native = lowerGraph(graph, { requireOutputs, materialBase });
  if (Object.hasOwn(settings, 'outputUsages')) OutputUsages.normalize(settings.outputUsages, graph.outputs);
  if (Object.hasOwn(settings, 'primaryInput') &&
      (!isId(settings.primaryInput) || !Object.hasOwn(native.inputs ?? {}, settings.primaryInput)))
    throw new RangeError('Material primaryInput must name a declared graph input');
  const assets = Object.fromEntries(entries(resources, 'resources').map(([id, resource]) => {
    entity(resource, ['definition'], 'resource ' + id);
    const { definition } = resource;
    if (definition?.format === Bitmap.format) Bitmap.layout(definition);
    else if (definition?.format === Vector.format) Vector.validate(definition);
    else if (definition?.format === Fonts.format) Fonts.validate(definition);
    else if (!record(definition) || !Object.hasOwn(definition, 'file'))
      throw new TypeError('Resource ' + id + ' needs a graph asset definition');
    return [id, definition];
  }));
  const exposed = new Set();
  for (const [id, control] of entries(controls, 'controls')) {
    entity(control, ['input', 'visibleWhen', ...Parameters.keys], 'control ' + id);
    if (!isId(control.input) || !Object.hasOwn(native.inputs ?? {}, control.input) || exposed.has(control.input))
      throw new RangeError('Control ' + id + ' needs a distinct graph input');
    exposed.add(control.input);
    Parameters.validate(control, id);
    const input = control.input;
    if (Object.hasOwn(control, 'default')) native.inputs[input] = Parameters.inputDefault(native.inputs[input], control.default);
    if (Object.hasOwn(native.inputs[input] ?? {}, 'default'))
      Parameters.checkValue(control, id, native.inputs[input].default);
  }
  for (const [id, value] of entries(instances, 'instances')) {
    entity(value, ['overrides', 'preset'], 'instance ' + id);
    if (Object.hasOwn(value, 'preset')) Presets.validateApplied(value.preset);
    for (const [key, override] of entries(value.overrides ?? {}, 'instance overrides')) {
      if (!Object.hasOwn(controls, key)) throw new RangeError('Unknown control ' + key + ' on instance ' + id);
      Parameters.checkValue(controls[key], key, override);
      if (instance === id) {
        const input = controls[key].input;
        native.inputs[input] = Parameters.inputDefault(native.inputs[input], override);
      }
    }
  }
  if (instance !== undefined && (!isId(instance) || !Object.hasOwn(instances, instance)))
    throw new RangeError('Unknown material instance ' + instance);
  return { format: projectFormat, version: 1, ...native, ...settings, ...(Object.keys(assets).length && { assets }) };
}

function normalize(source, id) {
  const document = copyJson(source);
  if (document?.format === projectFormat) {
    const derived = () => 'material-' + createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 24);
    return migrate(document, id ?? derived());
  }
  if (document?.format !== format) throw new TypeError('Expected an Ink material graph or a legacy graph project');
  // Dispatch each supported on-disk version here so older documents can upgrade in memory.
  if (document.version !== version) throw new RangeError('Unsupported material graph version ' + document.version);
  if (id !== undefined && id !== document.id) throw new RangeError('An existing material ID cannot be reassigned on open');
  return document;
}

function openMaterialGraph(source, { id } = {}) {
  const document = normalize(source, id);
  lower(document);
  return document;
}

function readMaterialGraph(file, options) {
  return openMaterialGraph(JSON.parse(fs.readFileSync(file, 'utf8')), options);
}

function writeMaterialGraph(file, source, { baseDir = path.dirname(path.resolve(file)) } = {}) {
  const document = openMaterialGraph(source);
  const target = path.resolve(file), directory = path.dirname(target);
  const destination = fs.statSync(target, { throwIfNoEntry: false });
  function relocate(filename) {
    const input = path.resolve(baseDir, filename);
    const current = destination && fs.statSync(input, { throwIfNoEntry: false });
    if (input === target || current && current.ino === destination.ino && current.dev === destination.dev)
      throw new RangeError('A material cannot overwrite its dependency ' + filename);
    return path.resolve(baseDir) === directory || path.isAbsolute(filename) ? filename :
      path.relative(directory, input).split(path.sep).join('/');
  }
  function relocateGroups(scope) {
    for (const group of Object.values(scope.groups ?? {})) {
      if (group.graph) relocateGroups(group.graph);
      else if (typeof group.reference === 'string') group.reference = relocate(group.reference);
      else group.reference.file = relocate(group.reference.file);
    }
  }
  relocateGroups(document.graph);
  if (document.metadata?.thumbnail) document.metadata.thumbnail.file = relocate(document.metadata.thumbnail.file);
  if (typeof document.settings?.assetRegistry === 'string')
    document.settings.assetRegistry = relocate(document.settings.assetRegistry);
  for (const resource of Object.values(document.resources ?? {})) {
    const { definition } = resource;
    if (definition.format === Bitmap.format) resource.definition = Bitmap.mapMembers(definition, member => member && {
      ...member, ...(member.file && { file: relocate(member.file) }), ...(member.origin && { origin: relocate(member.origin) })
    });
    else if (typeof definition.file === 'string') definition.file = relocate(definition.file);
    else if ([Vector.format, Fonts.format].includes(definition.format) && definition.origin) definition.origin = relocate(definition.origin);
  }
  files.json(target, document);
  return document;
}

function editableScope(document, scope) {
  if (!Array.isArray(scope) || !Array.from(scope).every(isId)) throw new TypeError('Subgraph scope needs an array of group IDs');
  let graph = document.graph;
  for (const name of scope) {
    const group = Object.hasOwn(graph.groups ?? {}, name) && graph.groups[name];
    if (!group?.graph) throw new RangeError('Unknown inline material subgraph scope ' + scope.join('/'));
    graph = group.graph;
  }
  return graph;
}

function portVisibility(graph, controls) {
  const visible = entries => entries && Object.fromEntries(Object.entries(entries).filter(([, row]) =>
    Object.hasOwn(row, 'visibleWhen')).map(([id, { visibleWhen, label }]) =>
    [id, { visibleWhen, ...(label !== undefined && { label }) }]));
  const inputs = visible(graph.inputs), outputs = visible(graph.outputs);
  const groups = Object.fromEntries(Object.entries(graph.groups ?? {}).flatMap(([id, { graph }]) => {
    const nested = graph && portVisibility(graph);
    return nested ? [[id, nested]] : [];
  }));
  if (!Object.keys(inputs ?? {}).length && !Object.keys(outputs ?? {}).length && !Object.keys(groups).length)
    return;
  const aliases = controls && Object.fromEntries(Object.entries(controls).map(([id, { input }]) => [id, { input }]));
  return { ...(Object.keys(inputs ?? {}).length && { inputs }), ...(Object.keys(outputs ?? {}).length && { outputs }),
    ...(Object.keys(groups).length && { groups }), ...(Object.keys(aliases ?? {}).length && { controls: aliases }) };
}

function toGraphProject(source, { instance, requireOutputs = true } = {}) {
  return lower(normalize(source), { requireOutputs, instance });
}

module.exports = { format, openMaterialGraph, readMaterialGraph, writeMaterialGraph, toGraphProject, editableScope, portVisibility };
