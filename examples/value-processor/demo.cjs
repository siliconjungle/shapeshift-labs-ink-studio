const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ink=require('../..'),files=require('../../cli/asset-files.js');
const {toGraphProject}=require('../../cli/material-graph.js');
const {graph,processor,settings}=require('./meridian.cjs');

const out=path.resolve(process.argv[2]??'studio/out/value-processor'), at=name=>path.join(out,name);
const controls=Object.fromEntries(Object.entries(settings).map(([id,{label,min,max,step,unit}],order)=>
  [id,{input:id,label,group:'Meridian',widget:'slider',order,min,max,step,...(unit&&{units:unit})}]));
const material=at('meridian.material.json'), spec=graph();
const saved=Ink.writeMaterialGraph(material,{...Ink.openMaterialGraph(spec,{id:'meridian'}),label:'Meridian',controls});
const runner=Ink.readGraphProject(material), {outputs,artifacts}=runner.run();
assert.equal(outputs.preview.width,144);
assert.equal(outputs.preview.height,128);
assert.deepEqual(outputs.range,[18,66]);
assert.equal(runner.run({inputs:{heading:42}}).outputs.score,1);
assert.equal(runner.run({inputs:{requested:216}}).outputs.preview.height,192);
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
files.write(at('meridian.value.json'),JSON.stringify(processor,null,2)+'\n');
const {inputs,nodes,outputs:ports}=toGraphProject(saved);
files.write(at('data.js'),'const meridian='+JSON.stringify({spec:{inputs,nodes,outputs:ports},saved,settings,processor})+';\n');
for(const name of ['index.html','live.js'])files.write(at(name),fs.readFileSync(path.join(__dirname,name)));
files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
