const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { gardenImages, gardenOptions, gardenGraph, gardenProbe } = require('./garden.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/typed-image-morphology');
const at = file => path.join(out, file);
const graph = gardenGraph(), sources = gardenImages();
for (const [name, raster] of Object.entries(sources))
  graph.inputs[name] = { type: 'raster', default: { ...raster, data: Array.from(raster.data) } };
const material = at('seam-garden.material.json');
Ink.writeMaterialGraph(material, Ink.openMaterialGraph(graph, { id: 'seam-garden' }));
const project = Ink.readGraphProject(material), result = project.run();
const clamped = project.run({ inputs: gardenOptions({ border: 'clamp' }) });
const index = gardenProbe[1] * sources.mask.width + gardenProbe[0];
assert.notEqual(result.outputs.distanceField.raster.data[index], clamped.outputs.distanceField.raster.data[index]);
for (const artifact of result.artifacts) files.write(at(artifact.file), artifact.bytes);
for (const name of ['index.html', 'garden.js'])
  files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the Seam Garden material graph and live repeated-tile demo to ' + out);
