const { openMaterialGraph } = require('./material-graph.js');

function prepare(document, kit) {
  return kit.KIT.procedural.materialPresets.prepare({ ...document.graph, controls: document.controls }, document.id);
}

function inspectMaterialPresets(source, { instance, kit = require('../index.js').load() } = {}) {
  const document = openMaterialGraph(source);
  return { format: 'ink-studio/material-preset-inspection', version: 1,
    ...prepare(document, kit).inspect(document, { instance }) };
}

function editMaterialPresets(source, request, { kit = require('../index.js').load() } = {}) {
  const original = openMaterialGraph(source), tools = prepare(original, kit);
  const document = openMaterialGraph({ ...original, ...tools.edit(original, request) });
  return { document, inspector: { format: 'ink-studio/material-preset-inspection', version: 1, ...tools.inspect(document) } };
}

function exportMaterialPresets(source, { ids, kit = require('../index.js').load() } = {}) {
  const document = openMaterialGraph(source);
  return prepare(document, kit).exportPresets(document, ids);
}

module.exports = { inspectMaterialPresets, editMaterialPresets, exportMaterialPresets };
