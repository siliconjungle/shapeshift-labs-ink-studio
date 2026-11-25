const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { opticsImages, opticsGraph, opticsProbe } = require('./optics.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/typed-material-filters');
const at = file => path.join(out, file);
const source = opticsGraph();
for (const [name, raster] of Object.entries(opticsImages()))
  source.inputs[name] = { type: 'raster', default: { ...raster, data: Array.from(raster.data) } };
const material = at('beacon-optics.material.json');
Ink.writeMaterialGraph(material, Ink.openMaterialGraph(source, { id: 'beacon-optics' }));
const { outputs, artifacts } = Ink.readGraphProject(material).run();
const offset = (opticsProbe[1] * outputs.source.raster.width + opticsProbe[0]) * 4;
assert.notEqual(outputs.source.raster.data[offset], outputs.filtered.raster.data[offset]);
for (const artifact of artifacts) files.write(at(artifact.file), artifact.bytes);
for (const name of ['index.html', 'optics.js'])
  files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
files.write(at('ink-studio.browser.js'), Buffer.from(Ink.bundle()));
console.log('Wrote the Beacon Optics editable material and live filter demo to ' + out);
