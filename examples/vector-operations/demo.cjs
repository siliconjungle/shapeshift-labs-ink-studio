const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const Ink=require('../..');
const files=require('../../cli/asset-files.js');
const {toGraphProject}=require('../../cli/material-graph.js');
const {graph,controls,patterns}=require('./press.cjs');

const folder=path.resolve(process.argv[2]??'studio/out/vector-operations'), at=file=>path.join(folder,file);
const spec=graph();
const presentation=Object.fromEntries(Object.entries(controls).map(([id,{label,min,max,step,options}],order)=>[
  id,{input:id,label,order,group:order<5?'Vector':'Cast',widget:options?'select':'slider',
    ...(options?{options}:{min,max,step})}
]));
const document=Ink.writeMaterialGraph(at('signal-press.material.json'),
  {...Ink.openMaterialGraph(spec,{id:'signal-press'}),label:'Signal Press',controls:presentation});
const runner=Ink.readGraphProject(at('signal-press.material.json'));
const defaultRun=runner.run(), alternate=runner.run({inputs:{cells:3.46,rounding:'ceil',rim:0}});
assert.equal(defaultRun.outputs.carriers,3);
assert.equal(alternate.outputs.carriers,4);
assert.equal(alternate.outputs.rimGate,false);
assert.notDeepEqual(defaultRun.artifacts[0].bytes,alternate.artifacts[0].bytes);
for(const artifact of defaultRun.artifacts)files.write(at(artifact.file),artifact.bytes);
const {inputs,nodes,outputs}=toGraphProject(document);
files.write(at('press-data.js'),'const press = '+JSON.stringify({project:{inputs,nodes,outputs},document,controls,patterns})+'\n');
files.write(at('ink-studio.browser.js'),Ink.bundle());
for(const file of ['index.html','press-live.js'])files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
console.log(at('index.html'));
