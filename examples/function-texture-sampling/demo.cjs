const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ink=require('../..'),PNG=require('../../cli/png.js'),files=require('../../cli/asset-files.js');
const {toGraphProject}=require('../../cli/material-graph.js');
const {project,settings,view}=require('./tideglass.cjs');
const preview=require('./tideglass-preview.js');

const out=path.resolve(process.argv[2]??'studio/out/function-texture-sampling'),at=name=>path.join(out,name);
const controls=Object.fromEntries(Object.entries(settings).map(([id,{label,choices,min,max,step}],order)=>[
  id,{input:id,label,group:'Texture sampling',order,widget:choices?'select':'slider',
    ...(choices?{options:choices.map(value=>({label:value,value}))}:{min,max,step})}
]));
const material=at('tideglass.material.json');
const saved=Ink.writeMaterialGraph(material,{...Ink.openMaterialGraph(project(),{id:'tideglass'}),label:'Tideglass',controls});
const runner=Ink.readGraphProject(material), {outputs,artifacts}=runner.run();
const P=Ink.load().KIT.procedural;
assert.equal(runner.describeSubgraph({group:'glaze'}).inputs.pigment.type,'colorImage');
assert.equal(runner.describeSubgraph({group:'glaze'}).inputs.stencil.type,'grayImage');
assert.equal(outputs.chart.length,view.width*view.height);
assert(outputs.chart.some(value=>value[0]>.3)&&outputs.chart.some(value=>value[0]<.1));
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
for(const [name,{width,height,data}] of Object.entries({
  glaze:preview.chart(outputs.chart,view,P.conversions),
  pigment:P.graphImages.toDisplay(outputs.colorSource),
  stencil:preview.gray(outputs.graySource)
}))files.write(at(name+'.png'),PNG.encode(width,height,data,4));
for(const file of ['index.html','tideglass-preview.js','tideglass-live.js'])files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
const {inputs,nodes,outputs:ports,groups}=toGraphProject(saved);
files.write(at('data.js'),'const tideglass='+JSON.stringify({spec:{inputs,nodes,outputs:ports,groups},saved,settings,view})+'\n');
files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
