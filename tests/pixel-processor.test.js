const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');

const data = {intent:'data',layout:'r',precision:'float32'};
const color = {intent:'color',layout:'rgba',precision:'unorm8',colorSpace:'srgb'};
const project = fields=>({format:'ink-studio/graph-project',version:1,...fields});
const program = (fields={})=>({format:'ink-studio/pixel-processor',version:1,precision:'f32',...fields});
const x=['x'], y=['y'];
const i=n=>['i32',n];
const get=name=>['get',name];
const parameter=name=>['param',name];
const load=(name,u=x,v=y)=>['load',name,u,v];
const sample=(name,u=['u'],v=['v'])=>['sample',name,['vec2',u,v]];
const fixture=program({
  resources:{
    heightField:{...data,tiling:{u:'wrap',v:'transparent'},sampling:'linear'},
    pigment:{...color,tiling:{u:'mirror',v:'clamp'},sampling:'linear'}
  },
  parameters:{turns:{type:'i32',default:2},gain:{type:'f32',default:.25},tint:{type:'vec3',default:[1,.5,.25]},
    flip:{type:'bool',default:false}},
  outputs:{scalar:{descriptor:data},value:{descriptor:color}},
  body:[
    {let:'sum',type:'f32',value:0},
    {for:'tap',count:parameter('turns'),limit:4,body:[
      {let:'n',value:['add',get('tap'),i(1)]},
      {let:'value',value:load('heightField',['sub',x,get('n')])},
      {set:'sum',value:['add',get('sum'),get('value')]}
    ]},
    {if:['and',parameter('flip'),['ge',x,i(0)]],then:[
      {let:'p',value:get('sum')},
      {set:'sum',value:['neg',get('p')]}
    ]},
    {let:'texel',value:sample('pigment',.5,.5)}
  ],
  result:{
    scalar:['add',['add',['mul',get('sum'),parameter('gain')],sample('heightField',1,.25)],['time']],
    value:['vec4',['component',get('texel'),0],['mul',['component',parameter('tint'),1],.5],
      ['component',load('pigment',['sub',x,i(1)],y),2],1]
  }
});

function createImages(P) {
  return {
    heightField:P.graphImages.declare({width:2,height:2,channels:1,data:[0,1,2,3]},
      {intent:'data',layout:'r',precision:'float32'}),
    pigment:P.graphImages.declare({width:2,height:1,channels:4,data:[0,80,128,255,255,120,0,255]},
      {intent:'color',layout:'rgba',precision:'unorm8',colorSpace:'srgb'})
  };
}

test('named resource contracts, loops, sampling and output encodings agree with exact reference values',()=>{
  const P=Ink.load().KIT.procedural, plan=P.pixelProcessor.compile(JSON.parse(JSON.stringify(fixture)));
  const resources=createImages(P), request={width:3,height:2,resources,time:.125};
  const out=plan.run(request);
  assert.deepEqual(plan.ports,{scalar:'grayImage',value:'colorImage'});
  assert.equal(plan.sockets.heightField.type,'grayImage');
  assert.deepEqual(Array.from(out.scalar.raster.data),[.875,.875,.875,1.875,1.875,1.875]);
  assert.deepEqual(Array.from(out.value.raster.data.slice(0,12)),[128,64,128,255,128,64,128,255,128,64,0,255]);
  assert.deepEqual(Array.from(plan.run({...request,parameters:{turns:0}}).scalar.raster.data),Array(6).fill(.625));
  assert.deepEqual(Array.from(plan.run({...request,parameters:{turns:-6}}).scalar.raster.data),Array(6).fill(.625));
  assert.deepEqual(Array.from(plan.run({...request,parameters:{turns:100,flip:true}}).scalar.raster.data),
    [.125,.125,.125,-1.875,-1.875,-1.875]);
  assert.throws(()=>plan.run({...request,resources:{...resources,pigment:resources.heightField}}),/pigment does not match/);
  assert.throws(()=>plan.run({...request,parameters:{turns:2.5}}),/turns needs i32/);
  assert.throws(()=>plan.run({...request,parameters:{turns:2147483648}}),/turns needs i32/);
  assert.throws(()=>plan.run({...request,width:9000}),/extent exceeds/);
});

test('typed authoring and bounded control reject invalid programs before evaluation',()=>{
  const {compile}=Ink.load().KIT.procedural.pixelProcessor;
  assert.throws(()=>compile({...fixture,precision:'float64'}),/explicit f32/);
  assert.throws(()=>compile({...fixture,result:{value:get('texel')}}),/every declared output/);
  assert.throws(()=>compile({...fixture,result:{...fixture.result,scalar:get('tap')}}),/unknown get name tap/);
  assert.throws(()=>compile({...fixture,body:[{for:'tap',count:i(1),limit:65,body:[]}]}),/literal loop limit/);
  assert.throws(()=>compile({...fixture,body:[{for:'tap',count:1,limit:2,body:[]}]}),/i32 count/);
  assert.throws(()=>compile({...fixture,body:[{for:'tap',count:i(2),limit:2,body:[{set:'tap',value:i(3)}]}]}),/mutable local/);
  const loop=body=>({for:'tap',count:i(1),limit:64,body});
  assert.throws(()=>compile({...fixture,body:[loop([loop([loop([])])])]}),/per-texel work budget/);
  assert.throws(()=>compile({...fixture,result:{...fixture.result,scalar:load('heightField',0,y)}}),/two i32 coordinates/);
  const deep=Array.from({length:40}).reduce(value=>['not',value],true);
  assert.throws(()=>compile({...fixture,body:[{if:deep,then:[]}]}),/syntax budget/);
  assert.throws(()=>compile({...fixture,result:{...fixture.result,scalar:['component',get('texel'),4]}}),/in-range literal lane/);
});

test('comparison separates float error from encoded differences and identifies the failing texel',()=>{
  const {compile}=Ink.load().KIT.procedural.pixelProcessor;
  const doc=program({outputs:{value:{descriptor:{intent:'mask',layout:'r',precision:'unorm8'}}},
    result:{value:['u']}});
  const packet=compile(doc).prepare({width:2,height:1});
  const cpu=packet.executeCPU(), gpu=Float32Array.from(cpu);
  gpu[0]+=.01;
  const {report}=packet.compare(cpu,gpu,{absolute:.001,relative:0});
  assert.equal(report.passed,false);
  assert.deepEqual(report.outputs.value.first,{x:0,y:0,lane:'r',cpu:.25,gpu:gpu[0]});
  assert.equal(report.outputs.value.outsideTolerance,1);
  assert.equal(report.outputs.value.differentStoredSamples,1);
  assert.equal(packet.compare(cpu,gpu,{absolute:.02}).report.passed,true);
  assert.throws(()=>packet.resolve(new Float32Array([-.01,.25])),/outside its output contract/);
  assert.throws(()=>packet.resolve(new Float32Array([NaN,.25])),/nonfinite/);
  const clamped=compile({...doc,outputs:{value:{...doc.outputs.value,outOfRange:'clamp'}}}).prepare({width:2,height:1});
  assert.deepEqual(Array.from(clamped.resolve(new Float32Array([-.1,1.1])).value.raster.data),[0,255]);
  const wide=compile({...doc,outputs:{value:{descriptor:{intent:'mask',layout:'r',precision:'unorm16'}}}});
  assert.deepEqual(Array.from(wide.run({width:2,height:1}).value.raster.data),[16384,49151]);
});

test('the processor survives material save/reopen and uses project clock and seed',()=>{
  const doc=program({outputs:{value:{descriptor:data}},parameters:{amount:{type:'f32'}},
    result:{value:['add',['add',['time'],['toF32',['seed']]],parameter('amount')]}});
  const spec=project({
    seed:17,time:1.5,inputs:{amount:{type:'number',default:.25}},
    nodes:{process:{op:'image.pixelProcessor',inputs:{program:doc,width:2,height:3,amount:{input:'amount'}}}},
    outputs:{value:{node:'process',port:'value'}}
  });
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'kernel'})));
  const runner=Ink.createGraphProject(saved);
  assert.deepEqual(Array.from(runner.run().outputs.value.raster.data),Array(6).fill(18.75));
  assert.deepEqual(Array.from(runner.run({time:2,seed:-2,inputs:{amount:.5}}).outputs.value.raster.data),Array(6).fill(.5));
  assert.equal(runner.snapshot().graph.nodes.process.outputs.value.type,'grayImage');
  assert.throws(()=>Ink.createGraphProject({...spec,nodes:{process:{...spec.nodes.process,
    inputs:{...spec.nodes.process.inputs,program:{input:'code'}}}},inputs:{...spec.inputs,code:'record'}}),/explicit f32/);
});

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

test('WebGPU executes the same program on odd extents, rebinds resources and compares raw samples', {
  skip: !process.env.INK_TEST_WEBGPU || typeof WebSocket !== 'function', timeout: 30000
}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-gpu-'));
  const profile=path.join(dir,'profile'), pageFile=path.join(dir,'index.html'), url=pathToFileURL(pageFile).href;
  const modules=pathToFileURL(path.resolve(__dirname,'../webgpu.mjs')).href;
  fs.writeFileSync(path.join(dir,'kit.js'),Ink.bundle());
  fs.writeFileSync(pageFile,`<!doctype html><script src="kit.js"></script><script type="module">
    import { createWebGPUPixelProcessor } from ${JSON.stringify(modules)};
    window.result=(${runGPU.toString()})(createWebGPUPixelProcessor,${JSON.stringify(fixture)},(${createImages.toString()}));
  </script>`);
  const chrome=spawn(process.env.INK_TEST_WEBGPU,['--headless','--no-first-run','--disable-background-networking',
    '--allow-file-access-from-files','--enable-unsafe-webgpu','--remote-debugging-port=0','--user-data-dir='+profile,url],
    {stdio:'ignore'});
  let socket;
  t.after(async()=>{
    socket?.close();
    if(chrome.exitCode===null&&chrome.signalCode===null){
      const closed=once(chrome,'exit');
      chrome.kill();
      await closed;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const portFile=path.join(profile,'DevToolsActivePort');
  let page;
  for(let i=0;i<150&&!page;i++){
    if(fs.existsSync(portFile)){
      const [port]=fs.readFileSync(portFile,'utf8').split('\n');
      const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:t.signal})).json();
      page=pages.find(row=>row.url===url);
    }
    if(!page)await delay(30);
  }
  assert(page,'Chrome did not open the Pixel Processor fixture');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await once(socket,'open',{signal:t.signal});
  const reply=once(socket,'message',{signal:t.signal});
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
    expression:"(async()=>{while(!window.result)await new Promise(r=>setTimeout(r,20));return await window.result})()",
    awaitPromise:true,returnByValue:true
  }}));
  const [event]=await reply, response=JSON.parse(event.data);
  assert.equal(response.error,undefined,JSON.stringify(response.error));
  assert.equal(response.result.exceptionDetails,undefined,JSON.stringify(response.result.exceptionDetails));
  const result=response.result.result.value;
  assert.equal(result.error,undefined,result.error);
  for(const entry of [result.first,result.changed,result.resized]){
    assert(entry.passed,JSON.stringify(entry));
    assert.equal(entry.outputs.value.differentStoredSamples,0);
    assert.equal(entry.outputs.scalar.outsideTolerance,0);
  }
  assert.equal(result.resized.width,7);
  assert.notEqual(result.a,result.b);
  assert.equal(result.integer,0);
  assert.match(result.disposed,/disposed/);
});

async function runGPU(create,doc,images){
  const P=KIT.procedural;
  let device, gpu;
  try{
    const adapter=await navigator.gpu?.requestAdapter();
    if(!adapter)throw new Error('WebGPU adapter unavailable');
    device=await adapter.requestDevice();
    const program=P.pixelProcessor.compile(doc), resources=images(P);
    gpu=create(device,program);
    const request={width:13,height:5,resources,time:.125};
    const first=await gpu.compare(request);
    const changed=await gpu.compare({...request,time:.375,parameters:{turns:300,flip:true}});
    const resized=await gpu.compare({...request,width:7,height:9,resources:{...resources,
      heightField:P.graphImages.uniform(.3,3,4,{intent:'data',layout:'r',precision:'float32'})}});
    const emptyProgram=P.pixelProcessor.compile({...doc,resources:{},parameters:{},body:[],
      outputs:{value:{descriptor:{intent:'data',layout:'r',precision:'float32'}}},
      result:{value:['toF32',['mod',['add',['i32',2147483647],['i32',1]],['i32',-1]]]}});
    const noSources=create(device,emptyProgram);
    const integer=(await noSources.run({width:1,height:2})).value.raster.data[0];
    noSources.dispose();
    gpu.dispose();
    const disposed=await gpu.run(request).then(()=>'',error=>error.message);
    return {first:first.report,changed:changed.report,resized:resized.report,
      a:first.gpu.scalar.raster.data[0],b:changed.gpu.scalar.raster.data[0],integer,disposed};
  }catch(error){return {error:String(error.stack??error)};}
  finally{gpu?.dispose();device?.destroy();}
}
