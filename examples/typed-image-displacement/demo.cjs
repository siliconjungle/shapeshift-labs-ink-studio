const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { tidalSources, tidalGraph } = require('./tidal.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/typed-image-displacement');
const at = file => path.join(out, file);
const graph = tidalGraph();
for (const [name, raster] of Object.entries(tidalSources()))
  graph.inputs[name] = { type: 'raster', default: { ...raster, data: Array.from(raster.data) } };
const material = at('tidal-glass.material.json');
Ink.writeMaterialGraph(material, Ink.openMaterialGraph(graph, { id: 'tidal-glass' }));
const project = Ink.readGraphProject(material), { outputs, artifacts } = project.run();
assert.notDeepEqual(outputs.original.data, outputs.vectorWarp.data);
for (const artifact of artifacts) files.write(at(artifact.file), artifact.bytes);
for (const name of ['index.html', 'tidal.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the editable graph and interactive Tidal Glass demo to ' + out);
