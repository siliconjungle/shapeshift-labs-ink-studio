const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { atlasFamilies, atlasSeed, atlasGraph } = require('./atlas.js');

const output = path.resolve(process.argv[2] ?? 'studio/out/typed-named-noise');
const at = name => path.join(output,name);
const material = at('noise-atlas.material.json');
Ink.writeMaterialGraph(material,Ink.openMaterialGraph(atlasGraph(Object.keys(atlasFamilies),true),{
  id:'noise-atlas',label:'Noise Atlas'
}));
const {outputs,artifacts} = Ink.readGraphProject(material).run();
for (const family of Object.keys(atlasFamilies)) {
  assert.equal(outputs[family+'Info'].family,family);
  assert.equal(outputs[family+'Scalar'].descriptor.materialSeed,atlasSeed);
}
for (const artifact of artifacts) files.write(at(artifact.file),artifact.bytes);
for (const file of ['index.html','atlas.js']) files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('ink-studio.browser.js'),Buffer.from(Ink.bundle()));
console.log('Wrote the Noise Atlas, editable material, and twelve texture previews to '+output);
