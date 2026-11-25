const { effectiveInputs } = require('../src/material-parameters.js');
const { openMaterialGraph, editableScope } = require('./material-graph.js');

function inspectMaterialVisibility(source, { inputs = {}, instance, scope = [], kit = require('../index.js').load() } = {}) {
  const material = openMaterialGraph(source), graph = editableScope(material, scope);
  const { graphVisibility } = kit.KIT.procedural;
  const controls = scope.length ? {} : material.controls ?? {};
  const defaults = {};
  if (instance !== undefined) {
    if (scope.length || typeof instance !== 'string' || !Object.hasOwn(material.instances ?? {}, instance))
      throw new RangeError('Choose a known root material instance');
    for (const [name, value] of Object.entries(material.instances[instance].overrides ?? {}))
      defaults[controls[name].input] = value;
  }
  if (!inputs || ![Object.prototype, null].includes(Object.getPrototypeOf(inputs)))
    throw new TypeError('Inspector input overrides need a named record');
  const path = '/graph' + scope.map(name => '/groups/' + name + '/graph').join('');
  return { format: 'ink-studio/material-visibility', version: 1, material: material.id, scope,
    ...(instance !== undefined && { instance }),
    ...graphVisibility.inspect({ inputs: effectiveInputs(graph.inputs ?? {}, controls), outputs: graph.outputs, controls }, { values: { ...defaults, ...inputs }, path }) };
}

module.exports = { inspectMaterialVisibility };
