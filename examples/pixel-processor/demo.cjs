const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const Ink=require('../..'), files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js');
const {graph,program,settings,width,height}=require('./copperwake.cjs');

const out=path.resolve(process.argv[2]??'studio/out/pixel-processor'), at=name=>path.join(out,name);
const controls=Object.fromEntries(Object.entries(settings).map(([id,{label,min,max,step}],order)=>
  [id,{input:id,label,group:'Copperwake',widget:'slider',order,min,max,step}]));
const material=at('copperwake.material.json'), spec=graph();
const saved=Ink.writeMaterialGraph(material,{...Ink.openMaterialGraph(spec,{id:'copperwake'}),label:'Copperwake',controls});
const runner=Ink.readGraphProject(material), {outputs,artifacts}=runner.run();
const processor=Ink.load().KIT.procedural.pixelProcessor.compile(program);
assert.equal(outputs.value.raster.width,width);
assert.equal(outputs.oxide.raster.height,height);
assert.notDeepEqual(runner.run({inputs:{reach:0}}).outputs.value.raster.data,outputs.value.raster.data);
const request={width,height,resources:{relief:outputs.relief,drift:outputs.drift},seed:spec.seed};
assert.deepEqual(processor.run(request).value.raster.data,outputs.value.raster.data);
for(const artifact of artifacts)files.write(at(artifact.file),artifact.bytes);
files.write(at('artifacts/oxide.png'),PNG.encodeGray(width,height,outputs.oxide.raster.data));
files.write(at('copperwake.pixel.json'),JSON.stringify(program,null,2)+'\n');

const sources=Object.fromEntries(Object.entries(request.resources).map(([name,{raster,descriptor}])=>
  [name,{raster:{...raster,data:Array.from(raster.data)},descriptor}]));
files.write(at('data.js'),'const copperwake='+JSON.stringify({saved,program,settings,width,height,seed:spec.seed,sources})+';\n');
for(const name of ['index.html','live.js'])files.write(at(name),fs.readFileSync(path.join(__dirname,name)));
files.write(at('ink-studio.browser.js'),Ink.bundle());

// Keep the delivered HTML usable when opened directly from disk.
const gpu=['graph.mjs','pixel-processor.mjs'].map(name=>
  fs.readFileSync(path.join(__dirname,'../../src/webgpu',name),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function )/gm,'')).join('\n');
files.write(at('webgpu.js'),'const CopperwakeGPU=(()=>{\n'+gpu+'\nreturn {createWebGPUPixelProcessor};\n})();\n');
console.log(at('index.html'));
