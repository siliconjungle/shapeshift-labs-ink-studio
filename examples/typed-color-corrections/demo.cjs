const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { prismPlate, prismGraph, paintPresets } = require('./prism.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/typed-color-corrections');
const at = file => path.join(out, file);
const plate = prismPlate();
const portable = { ...plate, data: Array.from(plate.data) };
for (const mode of Object.keys(paintPresets)) {
  const graph = prismGraph(mode);
  graph.inputs.plate = { type: 'raster', default: portable };
  graph.exports = {
    samples: { output: 'corrected', format: 'json' },
    histogram: { output: 'afterBins', format: 'json' },
    ...(graph.outputs.afterDisplay && { preview: { output: 'afterDisplay', format: 'png' } })
  };
  const name = mode === 'levels' ? 'prism-study.material.json' : path.join('presets', mode + '.material.json');
  Ink.writeMaterialGraph(at(name), Ink.openMaterialGraph(graph, { id: 'prism-' + mode }));
  const { outputs, artifacts } = Ink.readGraphProject(at(name)).run();
  assert.equal(outputs.beforeBins.count, plate.width * plate.height);
  assert.equal(outputs.afterBins.count, plate.width * plate.height);
  if (mode === 'levels') for (const artifact of artifacts) files.write(at(artifact.file), artifact.bytes);
}
for (const name of ['index.html', 'prism.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the Prism Study material graphs and live demo to ' + out);
