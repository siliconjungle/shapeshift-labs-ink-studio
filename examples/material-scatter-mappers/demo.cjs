const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ink=require('../..'), PNG=require('../../cli/png.js'), files=require('../../cli/asset-files.js');
const atlas=require('./mapper.js');
const out=path.resolve(process.argv[2]??'studio/out/material-scatter-mappers'), at=name=>path.join(out,name);
const g=Ink.load().KIT.procedural.graphImages;
const spec=atlas.graph(g,true), initial=Ink.createGraphProject(spec).run().outputs;
const focus=atlas.defaultFocus(initial,atlas.defaults.shape), material=at('riverbed-restorer.material.json');
spec.inputs.focus.default={pixel:focus.pixel};
Ink.writeMaterialGraph(material,Ink.openMaterialGraph(spec,{id:'riverbed-restorer',label:'Riverbed Restorer'}));
const project=Ink.readGraphProject(material), {outputs,artifacts}=project.run();
assert.equal(outputs.inspect.shapeId,atlas.defaults.shape);
assert(outputs.selection.ids.length>1);
assert(outputs.color.raster.data.some(n=>n>0));
assert(outputs.gray.raster.data.some(n=>n>0&&n<1));
assert(outputs.edits.replace.length===outputs.selection.ids.length);
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
for(const mode of ['original',...Object.keys(atlas.modes)]){
  const source=mode==='hide'?project.run({inputs:{action:{action:'hide'}}}).outputs:outputs;
  const {width,height,data}=atlas.preview(source,mode);
  files.write(at(mode+'.png'),PNG.encode(width,height,data,4));
}
for(const file of ['index.html','mapper.js'])files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('silt.js'),fs.readFileSync(path.join(__dirname,'../material-shape-splatter/silt.js')));
files.write(at('ink-studio.browser.js'),Buffer.from(Ink.bundle()));
console.log('Wrote Riverbed Restorer, the editable graph, and the aligned maps to '+out);
