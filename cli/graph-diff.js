/* Compare graph plans and trace changed bindings to named outputs without evaluating nodes. */
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');

const snapshotFormat = 'ink-studio/graph-snapshot';
const own = Object.hasOwn;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = (prefix, ...keys) => prefix + keys.map(key => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
const names = (before, after) => [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
const nodeHeader = ({ inputs, outputs, ...header }) => header;

function requireSnapshot(value) {
  if (value?.format !== snapshotFormat || value.version !== 1 || !record(value.settings) ||
      !Number.isSafeInteger(value.settings.seed) || !Number.isFinite(value.settings.time) ||
      ![value.graph, value.groups, value.assets, value.references, value.exports].every(record) || !Array.isArray(value.assertions))
    throw new TypeError('Expected an Ink Studio graph snapshot version 1');
  for (const scope of [value.graph, ...Object.values(value.groups)])
    if (!record(scope) || ![scope.inputs, scope.nodes, scope.outputs].every(record) ||
        !Array.isArray(scope.order) || scope.order.length !== Object.keys(scope.nodes).length ||
        new Set(scope.order).size !== scope.order.length || !scope.order.every(id => typeof id === 'string' && own(scope.nodes, id)))
      throw new TypeError('Invalid graph snapshot scope');
  return value;
}

function compareGraphs(before, after) {
  const changes = new Map();

  function preview(value) {
    const json = JSON.stringify(value);
    return json.length > 2048 ? { bytes: Buffer.byteLength(json),
      sha256: createHash('sha256').update(json).digest('hex') } : value;
  }

  function change(path, kind, a, b) {
    if (isDeepStrictEqual(a, b)) return;
    changes.set(path, { path, kind, status: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
      ...(a !== undefined && { before: preview(a) }), ...(b !== undefined && { after: preview(b) }) });
  }

  function named(prefix, kind, a, b) {
    for (const key of names(a, b)) change(pointer(prefix, key), kind, a?.[key], b?.[key]);
  }

  function scope(path, a, b) {
    named(pointer(path, 'inputs'), 'parameter', a?.inputs, b?.inputs);
    named(pointer(path, 'outputs'), 'named-output', a?.outputs, b?.outputs);
    for (const id of names(a?.nodes, b?.nodes)) {
      const left = a?.nodes[id], right = b?.nodes[id], node = pointer(path, 'nodes', id);
      change(node, 'node', left && nodeHeader(left), right && nodeHeader(right));
      named(pointer(node, 'inputs'), 'input-port', left?.inputs, right?.inputs);
      named(pointer(node, 'outputs'), 'output-port', left?.outputs, right?.outputs);
    }
  }

  named('/settings', 'setting', before.settings, after.settings);
  named('/assets', 'asset', before.assets, after.assets);
  named('/references', 'group-reference', before.references, after.references);
  named('/exports', 'export', before.exports, after.exports);
  named('/assertions', 'assertion', Object.fromEntries(before.assertions.map(row => [row.id, row])),
    Object.fromEntries(after.assertions.map(row => [row.id, row])));
  scope('/graph', before.graph, after.graph);
  for (const name of names(before.groups, after.groups)) scope(pointer('/groups', name), before.groups[name], after.groups[name]);
  return changes;
}

function trace(snapshot, changes) {
  const empty = { causes: [] };
  const active = new Set();
  const assetChanges = [...changes.values()].filter(change => change.kind === 'asset').map(change => change.path);
  const changed = path => changes.has(path) ? [path] : [];
  const seed = changed('/settings/seed');
  const merge = (...sources) => [...new Set(sources.flat())];
  let visits = 0;

  function scope(graph, path, parameters, clock) {
    const results = new Map();
    function read(binding) {
      switch (binding.kind) {
        case 'value': return { causes: [], value: binding.value };
        case 'track': return { causes: clock };
        case 'input': return parameters[binding.id] ?? empty;
        case 'node': {
          const value = results.get(binding.id)?.[binding.port];
          if (!value) throw new TypeError('Invalid graph snapshot binding ' + binding.id + '.' + binding.port);
          return value;
        }
        default: throw new TypeError('Invalid graph snapshot binding');
      }
    }

    for (const id of graph.order) {
      if (++visits > 2000) throw new RangeError('Graph snapshot exceeds the 2000 node budget');
      const node = graph.nodes[id], prefix = pointer(path, 'nodes', id);
      const inputs = Object.fromEntries(Object.entries(node.inputs).map(([port, binding]) => {
        const value = read(binding.source);
        return [port, { ...value, causes: merge(value.causes, changed(pointer(prefix, 'inputs', port))) }];
      }));
      function groupOutput(alias, argumentsByName) {
        const group = own(snapshot.groups, alias) && snapshot.groups[alias];
        if (!group || active.has(alias)) throw new TypeError('Invalid graph snapshot group ' + alias);
        const retime = node.op === 'anim.retime';
        const groupClock = retime ? merge(inputs.timing.causes,
          own(inputs.timing.value ?? {}, 'time') ? [] : clock) : clock;
        active.add(alias);
        const output = scope(group, pointer('/groups', alias), argumentsByName, groupClock);
        active.delete(alias);
        return output;
      }
      const control = node.groupPaths;
      const output = !control && node.groupPath !== undefined ? groupOutput(node.groupPath, inputs) : undefined;
      const controlCauses = control?.flatMap(alias=>groupOutput(alias,{...inputs,state:inputs.state??inputs.initial}).result.causes) ?? [];
      const contextSeed = node.seed === true || typeof node.seed === 'string' &&
        !own(inputs[node.seed]?.value ?? {}, 'seed') ? seed : [];
      const asset = inputs[node.asset]?.value;
      const files = node.asset === undefined ? [] : typeof asset === 'string'
        ? changed(pointer('/assets', asset)) : assetChanges;
      const systemName = node.op === 'fn.system' ? inputs.name.value : undefined;
      const systemCauses = systemName === 'time' ? clock : systemName === 'seed' ? seed :
        systemName === 'size' ? changed('/settings/base') : [];
      const common = merge(changed(prefix), contextSeed, files, systemCauses, controlCauses);
      const incoming = Object.values(inputs).map(input => input.causes);
      const directGroup = output && (node.group === undefined || node.op === 'anim.retime');
      const all = directGroup ? common : merge(common, ...incoming,
        output ? output.value?.causes ?? [] : node.time ? clock : []);

      results.set(id, Object.fromEntries(Object.keys(node.outputs).map(port => {
        const nested = directGroup ? output[port] : empty;
        return [port, { ...nested, causes: merge(all, nested.causes, changed(pointer(prefix, 'outputs', port))) }];
      })));
    }

    return Object.fromEntries(Object.entries(graph.outputs).map(([name, binding]) => {
      const result = read(binding);
      return [name, { ...result, causes: merge(result.causes, changed(pointer(path, 'outputs', name))) }];
    }));
  }

  const parameters = Object.fromEntries(Object.entries(snapshot.graph.inputs).map(([name, input]) =>
    [name, { value: input.default, causes: changed(pointer('/graph/inputs', name)) }]));
  return scope(snapshot.graph, '/graph', parameters, changed('/settings/time'));
}

function diffGraphs(before, after) {
  before = requireSnapshot(typeof before?.snapshot === 'function' ? before.snapshot() : before);
  after = requireSnapshot(typeof after?.snapshot === 'function' ? after.snapshot() : after);
  const changes = compareGraphs(before, after);
  const previous = trace(before, changes), next = trace(after, changes);
  const affectedOutputs = names(previous, next).flatMap(name => {
    const causes = [...new Set([...(previous[name]?.causes ?? []), ...(next[name]?.causes ?? [])])].sort();
    return causes.length ? [{ name, status: !own(previous, name) ? 'added' : !own(next, name) ? 'removed' : 'affected', causes }] : [];
  });
  return { format: 'ink-studio/graph-diff', version: 1, before: before.projectHash, after: after.projectHash,
    changes: [...changes.values()], affectedOutputs };
}

module.exports = { snapshotFormat, diffGraphs };
