const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { dialPlates, dialGraph, dialSample } = require('./dial.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/typed-image-channels');
const at = file => path.join(out, file);
const graph = dialGraph(), plates = dialPlates();
for (const [name, raster] of Object.entries(plates))
  graph.inputs[name] = { type: 'raster', default: { ...raster, data: Array.from(raster.data) } };
graph.exports = Object.fromEntries(['packed', 'shuffled', 'red', 'alpha'].map(name =>
  [name, { output: name, format: 'json' }]));
const material = at('signal-dial.material.json');
Ink.writeMaterialGraph(material, Ink.openMaterialGraph(graph, { id: 'signal-dial' }));
const result = Ink.readGraphProject(material).run();
const index = dialSample[1] * plates.roughness.width + dialSample[0];
assert(Math.abs(result.outputs.adjusted.raster.data[index] * 65535 - 30001.25) < 1e-9);
assert.equal(result.outputs.packed.descriptor.precision, 'float64');
assert.equal(result.outputs.red.raster.data[0], 1.75);
assert.equal(result.outputs.alpha.raster.data[0], .5);
for (const artifact of result.artifacts) files.write(at(artifact.file), artifact.bytes);
for (const name of ['index.html', 'dial.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the Signal Dial material graph and live demo to ' + out);
