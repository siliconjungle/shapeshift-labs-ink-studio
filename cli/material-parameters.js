const { createHash } = require('node:crypto');
const path = require('node:path');
const { openMaterialGraph } = require('./material-graph.js');
const { createGraphProject } = require('./graph-project.js');

const own = Object.hasOwn;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const supported = { expose: ['parameters'], set: ['instance', 'values'], reset: ['instance', 'controls'] };

function prepare(document, kit) {
  const { materialParameters } = kit.KIT.procedural;
  return materialParameters.prepare({ ...document.graph, controls: document.controls });
}

function inspectMaterialParameters(source, { inputs, instance, kit = require('../index.js').load() } = {}) {
  const document = openMaterialGraph(source), instances = document.instances ?? {};
  if (instance !== undefined && (!id(instance) || !own(instances, instance)))
    throw new RangeError('Unknown material instance ' + instance);
  const overrides = instance === undefined ? undefined : instances[instance].overrides;
  return { format: 'ink-studio/material-parameters', version: 1, material: document.id,
    ...(instance !== undefined && { instance }), ...prepare(document, kit).inspect({ inputs, overrides }) };
}

function lift(graph, name, target, project) {
  if (!record(target) || Object.keys(target).some(key => !['node', 'port'].includes(key)) ||
      !id(target.node) || !id(target.port) || !own(graph.nodes, target.node))
    throw new TypeError('Expose a known node input port');
  const { node, port } = target, namePath = node + '.' + port;
  if (own(graph.inputs ?? {}, name) || name === 'materialBase')
    throw new RangeError('Choose a new graph input ID for ' + namePath);
  if (Object.values(graph.links).some(({ to }) => to.node === node && to.port === port))
    throw new RangeError('Cannot expose wired node input ' + namePath);
  const sockets = project.sockets(node).inputs;
  if (!own(sockets, port)) throw new RangeError('Unknown graph input socket ' + namePath);
  const { type, quantity, default: fallback } = sockets[port], authored = graph.nodes[node];
  const slot = own(authored.inputs ?? {}, port) ? 'inputs' : own(authored.params ?? {}, port) ? 'params' : 'inputs';
  const raw = authored[slot]?.[port];
  if (record(raw) && own(raw, 'keys')) throw new RangeError('Cannot expose animated node input ' + namePath);
  const value = raw === undefined ? fallback : record(raw) && own(raw, 'value') ? raw.value : raw;
  const key = 'link-exposed-' + createHash('sha256').update(JSON.stringify([node, slot, port])).digest('hex').slice(0, 24);
  if (own(graph.links, key)) throw new RangeError('An exposure link already exists for ' + namePath);
  for (const location of ['inputs', 'params']) if (own(authored[location] ?? {}, port)) delete authored[location][port];
  (graph.inputs ??= {})[name] = { definition: { type, ...(quantity && { quantity }), ...(value !== undefined && { default: value }) } };
  graph.links[key] = { from: { input: name }, to: { node, slot, port } };
}

function expose(document, parameters, options) {
  if (!record(parameters) || !Object.keys(parameters).length || Object.keys(parameters).length > 128 ||
      !Object.entries(parameters).every(([key, row]) => id(key) && record(row)))
    throw new TypeError('Batch expose needs 1–128 parameter definitions keyed by stable IDs');
  const controls = document.controls ??= {}, graph = document.graph;
  const lifting = Object.values(parameters).some(row => own(row, 'target'));
  const project = lifting && createGraphProject(document, { ...options, requireOutputs: false });
  for (const [key, definition] of Object.entries(parameters)) {
    const previous = own(controls, key) ? controls[key] : undefined;
    const { input = previous?.input ?? key, target, ...presentation } = definition;
    if (!id(input) || previous && previous.input !== input)
      throw new RangeError('Cannot reassign the graph input for parameter ' + key);
    if (target !== undefined) lift(graph, input, target, project);
    controls[key] = { ...previous, ...presentation, input };
  }
  const edited = openMaterialGraph(document);
  if (lifting) createGraphProject(edited, { ...options, requireOutputs: false });
  return edited;
}

function editMaterialParameters(source, request, { kit = require('../index.js').load(), sourceFile, baseDir = sourceFile && path.dirname(path.resolve(sourceFile)), ...options } = {}) {
  if (!record(request) || typeof request.kind !== 'string' || !own(supported, request.kind) ||
      Object.keys(request).some(key => !['kind', ...supported[request.kind]].includes(key)))
    throw new TypeError('Invalid material parameter edit');
  let document = openMaterialGraph(source);
  const { kind, instance } = request;
  if (kind === 'expose') {
    document = expose(document, request.parameters, { ...options, kit, sourceFile, baseDir });
  } else {
    if (!id(instance)) throw new TypeError('Choose a stable material instance ID');
    const instances = document.instances ??= {}, entry = own(instances, instance) ? instances[instance] : undefined;
    if (kind === 'set') {
      const { apply } = prepare(document, kit);
      instances[instance] = { ...entry, overrides: apply(entry?.overrides ?? {}, request.values) };
    } else {
      if (!entry) throw new RangeError('Unknown material instance ' + instance);
      const { controls } = request;
      if (controls !== undefined && (!Array.isArray(controls) ||
          !Array.from(controls).every(key => id(key) && own(document.controls ?? {}, key))))
        throw new RangeError('Reset controls must name exposed material parameters');
      entry.overrides = kit.KIT.procedural.materialParameters.reset(entry.overrides ?? {}, controls);
    }
    document = openMaterialGraph(document);
  }
  return { document, inspector: inspectMaterialParameters(document, { kit, instance }) };
}

module.exports = { editMaterialParameters, inspectMaterialParameters };
