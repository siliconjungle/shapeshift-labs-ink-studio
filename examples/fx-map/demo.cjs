const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ink=require('../..'),files=require('../../cli/asset-files.js');
const {toGraphProject}=require('../../cli/material-graph.js');
const {graph,design,settings}=require('./brocade.cjs');

const out=path.resolve(process.argv[2]??'studio/out/fx-map'), at=name=>path.join(out,name);
const spec=graph(), material=at('ember-brocade.material.json');
const controls=Object.fromEntries(Object.entries(settings).map(([id,{label,min,max,step,choices}],order)=>[
  id,{input:id,label,order,group:'Weaving',widget:choices?'select':'slider',
    ...(choices?{options:choices.map(([label,value])=>({label,value}))}:{min,max,step})}
]));
const saved=Ink.writeMaterialGraph(material,{...Ink.openMaterialGraph(spec,{id:'ember-brocade'}),label:'Ember Brocade',controls});
const runner=Ink.readGraphProject(material), {outputs,artifacts}=runner.run();
assert.equal(outputs.layout.stamps.filter(row=>row.pattern==='brocade').length,32);
assert.equal(runner.run({inputs:{petals:6}}).outputs.layout.stamps.filter(row=>row.pattern==='brocade').length,24);
assert.equal(runner.run({inputs:{painted:false}}).outputs.layout.stamps.filter(row=>row.pattern==='brocade').length,0);
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
files.write(at('ember-brocade.fx-map.json'),JSON.stringify(design(),null,2)+'\n');
const {inputs,nodes,outputs:ports}=toGraphProject(saved);
files.write(at('data.js'),'const brocade='+JSON.stringify({spec:{inputs,nodes,outputs:ports},saved,settings})+';\n');
for(const name of ['index.html','live.js'])files.write(at(name),fs.readFileSync(path.join(__dirname,name)));
files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
