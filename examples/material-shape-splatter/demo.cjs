const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const Ink=require('../..'), PNG=require('../../cli/png.js'), files=require('../../cli/asset-files.js');
const {siltMaps,siltGraph,siltPreview,siltPorts}=require('./silt.js');
const out=path.resolve(process.argv[2]??'studio/out/material-shape-splatter'), at=name=>path.join(out,name);
const maps=siltMaps(Ink.load().KIT.procedural.graphImages), material=at('silt-and-stone.material.json');
Ink.writeMaterialGraph(material,Ink.openMaterialGraph(siltGraph(maps,'mixed',true),{id:'silt-and-stone',label:'Silt & Stone'}));
const {outputs,artifacts}=Ink.readGraphProject(material).run();
assert.equal(new Set(outputs.layout.placements.map(n=>n.kind)).size,2);
assert(outputs.layout.rejected.mask>0&&outputs.layout.rejected.density>0);
assert(outputs.coverage.raster.data.some(n=>n>0&&n<1));
for(const artifact of artifacts) files.write(at(artifact.file),artifact.bytes);
for(const mode of Object.keys(siltPorts)){
  const {width,height,data}=siltPreview(outputs,mode);
  files.write(at(mode+'.png'),PNG.encode(width,height,data,4));
}
for(const file of ['index.html','silt.js']) files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('ink-studio.browser.js'),Buffer.from(Ink.bundle()));
console.log('Wrote Silt & Stone, the editable graph and the aligned material maps to '+out);
