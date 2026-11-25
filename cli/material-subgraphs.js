const fs = require('node:fs');
const path = require('node:path');
const assets = require('./asset-files.js');
const { groupDocument } = require('./graph-groups.js');
const { openMaterialGraph, toGraphProject, editableScope, portVisibility } = require('./material-graph.js');
const { createGraphProject } = require('./graph-project.js');

const own = Object.hasOwn;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const graphFormat = 'ink-studio/graph-group';

function compiled(document, { sourceFile, baseDir = sourceFile && path.dirname(path.resolve(sourceFile)), ...options } = {}) {
  return createGraphProject(document, { ...options, sourceFile, baseDir, requireOutputs: false });
}

function describeMaterialSubgraph(source, target, options) {
  return compiled(source, options).describeSubgraph(target);
}

const actions = {
  publish: ['group', 'graph', 'reference'],
  insert: ['node', 'group', 'overrides', 'connections'],
  override: ['node', 'overrides'],
  reset: ['node', 'ports'],
  replace: ['node', 'group']
};

function editMaterialSubgraph(source, edit, options = {}) {
  if (!record(edit) || !own(actions, edit.kind) ||
      Object.keys(edit).some(key => !['kind', 'scope', ...actions[edit.kind]].includes(key)))
    throw new TypeError('Invalid material subgraph edit');
  const { kind, scope = [], node, group, overrides } = edit;
  if (actions[kind].includes('node') && !id(node) || actions[kind].includes('group') && !id(group))
    throw new TypeError('Subgraph edits need stable node and group IDs');
  const document = openMaterialGraph(source), graph = editableScope(document, scope);
  const target = node === undefined ? { scope, group } : { scope, node };
  const inspect = () => compiled(document, options).describeSubgraph(target);

  if (kind === 'publish') {
    const { graph: definition, reference } = edit;
    if (own(graph.groups ?? {}, group)) throw new RangeError('Subgraph ' + group + ' is already published');
    if ((definition === undefined) === (reference === undefined))
      throw new TypeError('Publish an editable graph or an external group reference');
    (graph.groups ??= {})[group] = definition === undefined ? { reference } : { graph: definition };
  } else if (kind === 'insert') {
    if (own(graph.nodes, node)) throw new RangeError('Graph node ' + node + ' already exists');
    graph.nodes[node] = { op: group };
    connectInputs(graph, node, edit.connections === undefined ? {} : edit.connections);
    setOverrides(graph, node, overrides === undefined ? {} : overrides);
  } else {
    const previous = inspect();
    const instance = graph.nodes[node];
    if (previous.instance.op !== previous.alias.split('/').at(-1))
      throw new TypeError('Edit the inputs of a direct subgraph instance');
    if (kind === 'override') setOverrides(graph, node, overrides);
    if (kind === 'reset') reset(graph, node, previous.inputs, edit.ports);
    if (kind === 'replace') {
      const next = compiled(document, options).describeSubgraph({ scope, group });
      const kit = options.kit ?? require('../index.js').load(), types = kit.KIT.procedural.graphTypes;
      for (const { from } of Object.values(graph.links)) {
        if (from.node !== node) continue;
        const port = from.port ?? 'value', before = previous.outputs[port], after = next.outputs[port];
        if (!after || after.type === 'any' && before.type !== 'any' || !types.compatible(after.type, before.type))
          throw new TypeError('Replacement cannot preserve output ' + node + '.' + port);
        kit.KIT.quantities.assertLink(after.quantity, before.quantity, group + '.' + port, node + '.' + port);
      }
      instance.op = group;
    }
  }

  const saved = openMaterialGraph(document);
  if (kind === 'publish') {
    // A pending editable output is allowed in a draft, but cannot be published.
    const definition = editableScope(saved, scope).groups[group].graph;
    if (definition) toGraphProject({ format: saved.format, version: saved.version, id: group, graph: definition });
  }
  const description = compiled(saved, options).describeSubgraph(target);
  if (kind === 'insert' && description.instance.op !== group)
    throw new RangeError('Unknown subgraph ' + group);
  return { document: saved, subgraph: description };
}

function connectInputs(graph, node, connections) {
  if (!record(connections) || !Object.keys(connections).every(id))
    throw new TypeError('Instance connections must be keyed by stable link ID');
  for (const [link, binding] of Object.entries(connections)) {
    if (own(graph.links, link)) throw new RangeError('Graph link ' + link + ' already exists');
    if (!record(binding) || Object.keys(binding).some(key => !['port', 'from'].includes(key)) || !id(binding.port))
      throw new TypeError('Each instance connection needs a source and input port');
    graph.links[link] = { from: binding.from, to: { node, slot: 'inputs', port: binding.port } };
  }
}

function wiredPorts(graph, node) {
  return new Set(Object.values(graph.links).filter(({ to }) => to.node === node).map(({ to }) => to.port));
}

function removeOverride(instance, port) {
  for (const slot of ['inputs', 'params']) {
    if (!instance[slot]) continue;
    delete instance[slot][port];
    if (!Object.keys(instance[slot]).length) delete instance[slot];
  }
}

function setOverrides(graph, node, values) {
  if (!record(values) || !Object.keys(values).every(id)) throw new TypeError('Instance overrides must be keyed by port ID');
  const wired = wiredPorts(graph, node), instance = graph.nodes[node];
  for (const [port, value] of Object.entries(values)) {
    if (wired.has(port)) throw new RangeError('Disconnect ' + node + '.' + port + ' before overriding it');
    removeOverride(instance, port);
    (instance.inputs ??= {})[port] = { value };
  }
}

function reset(graph, node, inputs, ports) {
  if (ports !== undefined && (!Array.isArray(ports) || !Array.from(ports).every(port => id(port) && own(inputs, port))))
    throw new RangeError('Reset ports must name published inputs');
  const instance = graph.nodes[node], wired = wiredPorts(graph, node);
  for (const port of ports ?? Object.keys(inputs)) {
    if (!wired.has(port)) removeOverride(instance, port);
  }
}

function publishMaterialSubgraph(file, source, { revision = 1, baseDir = path.dirname(path.resolve(file)), ...options } = {}) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new RangeError('Subgraph publication needs a positive integer revision');
  const document = openMaterialGraph(source);
  if (Object.keys(document.resources ?? {}).length || document.settings?.base !== undefined)
    throw new TypeError('Publish a portable subgraph with explicit inputs for material resources and base settings');
  const { inputs, nodes, outputs, groups, result } = toGraphProject(document);
  const target = path.resolve(file), folder = path.dirname(target);
  function relocate(declarations) {
    return Object.fromEntries(Object.entries(declarations).map(([name, definition]) => {
      if (typeof definition !== 'string' && !own(definition, 'file'))
        return [name, { ...definition, ...(definition.groups && { groups: relocate(definition.groups) }) }];
      const original = typeof definition === 'string' ? definition : definition.file;
      const resolved = path.resolve(baseDir, original);
      const relocated = path.isAbsolute(original) ? original : path.relative(folder, resolved).split(path.sep).join('/');
      return [name, typeof definition === 'string' ? relocated : { ...definition, file: relocated }];
    }));
  }
  const body = { ...(inputs && { inputs }), nodes, outputs, ...(result!==undefined && {result}), ...(groups && { groups: relocate(groups) }) };
  const inspector = portVisibility(document.graph, document.controls);
  const definition = { format: graphFormat, version: 1, revision, ...body, ...(inspector && { inspector }) };
  // Register the body as a group to compile the same public interface its consumers will receive.
  const project = createGraphProject({ format: 'ink-studio/graph-project', version: 1,
    groups: { [document.id]: body }, nodes: {}, outputs: {} }, { ...options, baseDir: folder });
  const contract = project.describeSubgraph({ group: document.id });
  if (project.sourceFiles().some(dependency => dependency === target ||
      fs.existsSync(target) && fs.realpathSync(dependency) === fs.realpathSync(target)))
    throw new RangeError('Cannot publish a subgraph over its dependency');
  assets.publishJson(target, definition, 'Subgraph publication already exists at ' + target);
  const bytes = fs.readFileSync(target);
  const { sha256 } = groupDocument(definition, bytes, target);
  return { file: target, revision, sha256, inputs: contract.inputs, outputs: contract.outputs };
}

module.exports = { describeMaterialSubgraph, editMaterialSubgraph, publishMaterialSubgraph };
