const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { toGraphProject } = require('../../cli/material-graph.js');
const { graph, controls, swatches } = require('./moonlock.cjs');

const directory = path.resolve(process.argv[2] ?? 'studio/out/sdf-functions');
const at = file => path.join(directory, file);
const settings = Object.fromEntries(Object.entries(controls).map(([id, { label, min, max, step }], order) =>
  [id, { input: id, label, order, group: 'Moonlock', widget: 'slider', min, max, step }]));
const saved = Ink.writeMaterialGraph(at('moonlock.material.json'), {
  ...Ink.openMaterialGraph(graph(), { id: 'moonlock' }), label: 'Moonlock', controls: settings
});
const { outputs, artifacts } = Ink.readGraphProject(at('moonlock.material.json')).run();
const { frame, scatterLayout, scatterMaterials, slices, sliceMaterials, sliceLayout } = outputs;
const seen = (values, names) => new Set(Array.from(values, n => names[n]));
assert(seen(frame.passes.materialId, frame.passes.materials).has('gold'));
assert(seen(scatterMaterials.raster.data, scatterLayout.materials).has('inlay'));
assert(sliceMaterials.some(layer => seen(layer.data, sliceLayout.materials).has('gem')));
for (const artifact of artifacts) files.write(at(artifact.file), artifact.bytes);
const { width, height, data, channels } = slices[17];
files.write(at('section.png'), require('../../cli/png.js').encode(width, height, data, channels));
const { inputs, nodes, outputs: ports, groups } = toGraphProject(saved);
files.write(at('data.js'), 'const moonlock = ' + JSON.stringify({ spec: { inputs, nodes, outputs: ports, groups }, controls, swatches, saved }) + ';\n');
for (const file of ['index.html', 'live.js']) files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
files.write(at('ink-studio.browser.js'), Ink.bundle());
console.log(at('index.html'));
