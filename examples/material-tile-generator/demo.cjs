const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const Ink=require('../..');
const files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js');
const {kilnGraph,kilnPreview}=require('./kiln.js');
const out=path.resolve(process.argv[2]??'studio/out/material-tile-generator'), at=name=>path.join(out,name);
const material=at('kiln-and-course.material.json');
Ink.writeMaterialGraph(material,Ink.openMaterialGraph(kilnGraph(true),{id:'kiln-and-course',label:'Kiln & Course'}));
const {outputs,artifacts}=Ink.readGraphProject(material).run();
assert.equal(outputs.layout.rowOffset.effective,4/7);
assert.equal(outputs.layout.placements.length,28);
assert(outputs.height.raster.data.some(n=>n>1));
for(const artifact of artifacts) files.write(at(artifact.file),artifact.bytes);
for(const mode of ['glaze','courses']){
  const {width,height,data}=kilnPreview(outputs,undefined,mode);
  files.write(at(mode+'.png'),PNG.encode(width,height,data,4));
}
for(const file of ['index.html','kiln.js']) files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('ink-studio.browser.js'),Buffer.from(Ink.bundle()));
console.log('Wrote Kiln & Course, the editable tile recipe and the glaze and course previews to '+out);
