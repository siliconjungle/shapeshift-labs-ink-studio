const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ink=require('../..'),files=require('../../cli/asset-files.js'),PNG=require('../../cli/png.js');
const { toGraphProject }=require('../../cli/material-graph.js');

const directory=path.resolve(process.argv[2]??'studio/out/vector-resources'), at=name=>path.join(directory,name);
const V=Ink.load().KIT.procedural.vectorResources;
const svg=fs.readFileSync(path.join(__dirname,'night-ferry.svg'),'utf8');
const resource=V.importSVG(svg);
const ref=(node,port='value')=>({node,port}), input=input=>({input});
const graph={
  format:'ink-studio/graph-project',version:1,assets:{ferry:{format:'svg',document:resource}},
  inputs:{edits:{type:'array<record>',default:[]}, target:{type:'string',default:'swell'}, maskTarget:{type:'string',default:'compass-ring'}},
  nodes:{
    asset:{op:'svgAsset',inputs:{name:'ferry'}},
    vector:{op:'vector.edit',inputs:{source:ref('asset'),edits:input('edits')}},
    xml:{op:'vector.export',inputs:{source:ref('vector')}},
    points:{op:'vector.path',inputs:{source:ref('vector'),key:input('target')}},
    mask:{op:'vector.fillMask',inputs:{source:ref('vector'),key:input('maskTarget'),options:{width:160,height:110,samples:4}}}
  },
  outputs:{vector:ref('vector'),svg:ref('xml'),points:ref('points'),pathInfo:ref('points','info'),mask:ref('mask'),maskInfo:ref('mask','info')},
  exports:{'night-ferry':{output:'vector',format:'svg'}}
};
const material=Ink.openMaterialGraph(graph,{id:'night-ferry'});
material.label='Night Ferry';
const saved=Ink.writeMaterialGraph(at('night-ferry.material.json'),material);
const project=Ink.readGraphProject(at('night-ferry.material.json'));
const {outputs,artifacts}=project.run();
assert.deepEqual(V.importSVG(outputs.svg),resource);
for (const file of artifacts) files.write(at(file.file),file.bytes);
const edited=project.run({inputs:{edits:[
  {kind:'point',key:'swell',segment:2,handle:'c1',at:[226,267],tangent:'mirrored'},
  {kind:'attributes',key:'compass-ring',attrs:{'fill-rule':'nonzero','stroke':'#f2c989','stroke-width':'1.5'}}
]}});
files.write(at('night-ferry-edited.svg'),edited.artifacts[0].bytes);
assert.notDeepEqual(edited.outputs.mask.raster.data,outputs.mask.raster.data);
const {width,height,data}=outputs.mask.raster;
files.write(at('compass-mask.png'),PNG.encodeGray(width,height,Uint8Array.from(data,n=>Math.round(n*255))));
const { inputs, nodes, outputs:ports }=toGraphProject(saved);
files.write(at('data.js'),'const demo = '+JSON.stringify({spec:{inputs,nodes,outputs:ports},saved})+';\n');
for(const file of ['index.html','live.js']) files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
files.write(at('ink-studio.browser.js'),Ink.bundle());
console.log(at('index.html'));
