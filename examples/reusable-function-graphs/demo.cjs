const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const { toGraphProject } = require('../../cli/material-graph.js');
const { material, firing, shared, knobs, presets } = require('./kiln.cjs');

const directory=path.resolve(process.argv[2]??'studio/out/reusable-function-graphs'), at=name=>path.join(directory,name);
const { project, controls }=material(), filename=at('kiln-formula.material.json');
const document=Ink.writeMaterialGraph(filename,{...Ink.openMaterialGraph(project,{id:'kiln-formula'}),
  label:'Kiln Formula',controls});
const definition=Ink.openMaterialGraph({format:'ink-studio/graph-project',version:1,...firing},{id:'kiln-glaze'});
const published=at('kiln-glaze.group.json');
if (fs.existsSync(published)) assert.deepEqual(JSON.parse(fs.readFileSync(published)),
  {format:'ink-studio/graph-group',version:1,revision:1,...firing});
else Ink.publishMaterialSubgraph(published,definition);
const runner=Ink.readGraphProject(filename), original=runner.run();
const tuned=runner.run({inputs:{knee:.61}});
for (const name of Object.keys(presets)) {
  assert.notDeepEqual(original.outputs[name+'Color'],tuned.outputs[name+'Color']);
  assert.equal(runner.describeSubgraph({node:name+'Call'}).result,'srgb');
}
for (const artifact of original.artifacts) files.write(at(artifact.file),artifact.bytes);
const { inputs,nodes,outputs,groups }=toGraphProject(document);
files.write(at('kiln-data.js'),'const kiln = '+JSON.stringify({graph:{inputs,nodes,outputs,groups},document,shared,knobs,presets})+'\n');
files.write(at('ink-studio.browser.js'),Ink.bundle());
for (const name of ['index.html','kiln-gallery.js']) files.write(at(name),fs.readFileSync(path.join(__dirname,name)));
console.log(at('index.html'));
