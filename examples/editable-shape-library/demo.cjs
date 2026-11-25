const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Ink=require('../..');
const files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js');
const {pressSource,pressGraph,pressImage}=require('./press.js');
const {shapeLibrary}=Ink.load().KIT.procedural;
const out=path.resolve(process.argv[2]??'studio/out/editable-shape-library'), at=name=>path.join(out,name);
const material=at('mark-and-die.material.json');
Ink.writeMaterialGraph(material,Ink.openMaterialGraph(pressGraph(pressSource(shapeLibrary.presets),true),
  {id:'mark-and-die',label:'Mark & Die'}));
const {outputs,artifacts}=Ink.readGraphProject(material).run();
assert.strictEqual(outputs.definition.type,'bevel');
assert(outputs.inspectionHeight.raster.data.some(n=>n>.04));
for (const artifact of artifacts) files.write(at(artifact.file),artifact.bytes);
for (const name of ['native','inspection']) {
  const {width,height,data}=pressImage(outputs,name,'material');
  files.write(at(name+'.png'),PNG.encode(width,height,data,4));
}
for (const file of ['index.html','press.js']) files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('ink-studio.browser.js'),Buffer.from(Ink.bundle()));
console.log('Wrote the Mark & Die demo, shape library, material graph and matching bakes to '+out);
