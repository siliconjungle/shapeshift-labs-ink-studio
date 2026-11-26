const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const Ink=require('../..'), files=require('../../cli/asset-files.js');
const {toGraphProject}=require('../../cli/material-graph.js');
const {graph,controls,defaults,width,height}=require('./lantern.cjs');

const out=path.resolve(process.argv[2]??'studio/out/function-control'), at=name=>path.join(out,name);
const exposed=Object.fromEntries(Object.entries(controls).map(([id,{label,choices,min,max,step}],order)=>[
  id,{input:id,label,group:'Signal',order,widget:choices?'select':'slider',
    ...(choices?{options:choices.map(([label,value])=>({label,value}))}:{min,max,step})}
]));
const saved=Ink.writeMaterialGraph(at('last-light.material.json'),{
  ...Ink.openMaterialGraph(graph(),{id:'last-light'}),label:'Last Light',controls:exposed
});
const runner=Ink.readGraphProject(at('last-light.material.json')), {outputs,artifacts}=runner.run();
assert.equal(outputs.primed,22.5);
assert.equal(outputs.charge,76.5);
assert.equal(outputs.iterations,6);
assert.deepEqual(outputs.size,[width,height]);
assert.equal(runner.run({inputs:{storm:true}}).outputs.iterations,4);
assert.equal(runner.run({inputs:{limit:0}}).outputs.lastTurn,-1);
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
const {inputs,nodes,outputs:ports,groups}=toGraphProject(saved);
files.write(at('data.js'),'const lastLight='+JSON.stringify({
  spec:{inputs,nodes,outputs:ports},groups,saved,controls,defaults,width,height
})+'\n');
for(const name of ['index.html','live.js'])files.write(at(name),fs.readFileSync(path.join(__dirname,name)));
files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
