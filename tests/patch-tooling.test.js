const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const ink=require('..');
const PNG=require('../cli/png.js');
const WAV=require('../cli/wav.js');

const cli=path.join(__dirname,'../cli/ink-studio.js');
function room(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-patch-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run=(args,input)=>execFileSync(process.execPath,[cli,'patch',...args],{cwd:dir,input,encoding:'utf8'});
  const fail=args=>spawnSync(process.execPath,[cli,'patch',...args],{cwd:dir,encoding:'utf8'});
  return {dir,write,read,run,fail};
}

test('typed edits wire, map and plan atomically with early errors and source protection',t=>{
  const {dir,write,read,run,fail}=room(t);
  run(['init','patch.json']);
  write('edit.json',[
    {op:'input',id:'bass',socket:{type:'number',default:.25}},
    {op:'add',id:'raw',node:{op:'add',inputs:{a:{input:'bass'},b:0}}},
    {op:'add',id:'amount',node:{op:'multiply',inputs:{a:1,b:2}}},
    {op:'wire',from:'amount:value',to:'$result'}
  ]);
  run(['apply','patch.json','edit.json']);
  run(['bind','patch.json','raw:value','amount:a','--id','response','--from','0,1','--to','0,4']);
  const output=JSON.parse(run(['run','patch.json','--watch','signal=response:value,result=$result','--out','take']));
  assert.equal(output.previews.signal.value,1);
  assert.equal(output.previews.result.value,2);
  assert.equal(read('take/previews/result.json'),2);
  assert.match(run(['plan','patch.json','--dot']),/"raw" -> "response"/);
  assert.match(run(['plan','patch.json']),/a \[number\] <- response:value/);
  const before=fs.readFileSync(path.join(dir,'patch.json'));
  const cycle=fail(['wire','patch.json','amount:value','raw:a']);
  assert.equal(cycle.status,1);
  assert.match(cycle.stderr,/cycle/i);
  assert.deepEqual(fs.readFileSync(path.join(dir,'patch.json')),before);
  write('bad.json',[{op:'set',to:'raw:a',value:'wrong'}]);
  assert.match(fail(['apply','patch.json','bad.json']).stderr,/Wrong value/);
  assert.deepEqual(fs.readFileSync(path.join(dir,'patch.json')),before);
  assert.equal(fail(['init','patch.json']).status,1);
  assert.equal(fs.existsSync(path.join(dir,'patch.json.ink-edit-lock')),false);
});

test('previewFrame awaits a shader-like operation in a group and evaluates each watched port once',async()=>{
  let seen=0, resolve;
  const pending=new Promise(done=>{resolve=done;});
  const project=ink.createGraphProject({format:'ink-studio/graph-project',version:1,
    nodes:{a:{op:'child',inputs:{source:2}}},outputs:{result:{node:'a'}},
    groups:{child:{inputs:{source:{type:'number'}},nodes:{compute:{op:'test.async',inputs:{n:{input:'source'}}}},
      outputs:{value:{node:'compute'}}}}
  },{operations:{'test.async':{
    inputs:{n:'number'},outputs:{value:'number',twice:'number'},
    async run({n}) {seen++;await pending;return {value:n+1,twice:n*2};}
  }}});
  const call=project.previewFrame({value:{output:'result'},inner:{node:'a/compute',port:'twice'}},{},{profile:true});
  await assert.rejects(project.previewFrame({},{}),/already running/);
  assert.throws(()=>project.clear(),/during asynchronous evaluation/);
  resolve();
  const result=await call;
  assert.equal(result.values.value,3);
  assert.equal(result.values.inner,4);
  assert.equal(seen,1);
  assert.equal(Number.isFinite(result.report.timingsMs.a),true);
  const cached=await project.previewFrame({value:{output:'result'}});
  assert.equal(cached.report.cache.nodes.a,'cached');
  assert.equal(seen,1);
  project.clear();
});

function trackGraph() {
  const link=(node,port='value')=>({node,port});
  return {format:'ink-studio/graph-project',version:1,nodes:{
    video:{op:'patch.video'},
    audio:{op:'patch.audio'},
    fft:{op:'audio.fft',inputs:{source:link('audio'),options:{fps:12,size:4096,bands:{bass:[40,100]}}}},
    bass:{op:'patch.band',inputs:{bands:link('fft','bands'),name:'bass'}},
    tracker:{op:'patch.track',inputs:{source:link('video'),options:{channel:'luma',threshold:127,minArea:2}}},
    overlay:{op:'patch.overlay',inputs:{source:link('video'),tracks:link('tracker'),options:{labels:false}}},
    trails:{op:'patch.trail',inputs:{source:link('overlay','ink'),length:link('bass')}},
    picture:{op:'patch.composite',inputs:{source:link('video'),layer:link('trails')}}
  },outputs:{picture:link('picture'),moving:link('tracker')}};
}
test('raw-video stdin, WAV FFT, streaming tracking and multiple file previews work through CLI',t=>{
  const {dir,write,read,run}=room(t), width=18,height=12, chunks=[];
  write('patch.json',trackGraph());
  const sampleRate=48000;
  const samples=Float32Array.from({length:sampleRate},(_,i)=>
    Math.sin(2*Math.PI*60*i/sampleRate)*(i<4000?.12:.68));
  fs.writeFileSync(path.join(dir,'pulse.wav'),WAV.encode({sampleRate,channels:1,samples}));
  for (let n=0;n<3;n++) {
    const raw=Buffer.alloc(width*height*4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      const on=y>=3&&y<8&&x>=n+4&&x<n+7;
      raw.fill(on?255:0,i,i+3);
      raw[i+3]=255;
    }
    chunks.push(raw);
  }
  const text=run(['run','patch.json','--video','-','--audio','pulse.wav','--size','18x12','--frames','3',
    '--watch','video=video:value,tracks=tracker:value,bass=bass:value,output=$picture',
    '--out','previews','--keep','--progress'],Buffer.concat(chunks));
  const reports=text.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(reports.map(r=>r.frame),[0,1,2]);
  assert(reports[1].previews.bass.value>reports[0].previews.bass.value*2);
  const first=read('previews/frames/000000/previews/tracks.json');
  const next=read('previews/frames/000002/previews/tracks.json');
  assert.equal(first[0].id,next[0].id);
  assert(next[0].center[0]>first[0].center[0]);
  assert.equal(read('previews/report.json').frame,2);
  assert.equal(PNG.raster(path.join(dir,'previews/previews/output.png')).w,18);
  assert.notEqual(reports[2].previews.video.sha256,reports[2].previews.output.sha256);
});

test('controls update at a frame boundary and invalid changes keep the last valid value',async t=>{
  const {dir,write}=room(t);
  write('controls.json',{gain:.25});
  write('patch.json',{format:'ink-studio/graph-project',version:1,inputs:{gain:{type:'number',default:1}},
    nodes:{video:{op:'patch.video'}, knob:{op:'add',inputs:{a:{input:'gain'},b:0}}},outputs:{gain:{node:'knob'}}});
  const child=spawn(process.execPath,[cli,'patch','run','patch.json','--video','-','--size','1x1',
    '--frames','3','--controls','controls.json','--progress'],{cwd:dir,stdio:['pipe','pipe','pipe']});
  const completion=once(child,'close');
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let stderr='';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',part=>{stderr+=part;});
  t.after(()=>child.kill());
  async function frame() {
    child.stdin.write(Buffer.from([25,50,75,255]));
    const line=await lines.next();
    assert.equal(line.done,false,stderr);
    return JSON.parse(line.value);
  }
  assert.equal((await frame()).previews.gain.value,.25);
  write('controls.json',{gain:'bad'});
  const held=await frame();
  assert.match(held.controlsError,/Wrong input value/);
  assert.equal(held.previews.gain.value,.25);
  write('controls.json',{gain:.8});
  const resumed=await frame();
  assert.equal(resumed.controlsError,undefined);
  assert.equal(resumed.previews.gain.value,.8);
  child.stdin.end();
  assert.deepEqual(await completion,[0,null],stderr);
});

test('native WGSL runs without a browser and publishes modified bytes',{
  skip:!process.env.INK_TEST_PATCH_GPU
},t=>{
  const {dir,write,run}=room(t);
  const wgsl=`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var result: texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(2) var<uniform> settings: vec4f;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p:vec3u) {
  if (any(p.xy >= textureDimensions(source))) { return; }
  let xy=vec2i(p.xy);
  let value=textureLoad(source,xy,0);
  textureStore(result,xy,vec4f(1.0-value.r,settings.y,value.b,1.0));
}`;
  write('patch.json',{format:'ink-studio/graph-project',version:1,nodes:{video:{op:'patch.video'},
    shader:{op:'patch.shader',inputs:{source:{node:'video'},wgsl,amount:.5}}},
    outputs:{image:{node:'shader'}}});
  const pixels=Buffer.from([0,0,40,255,255,0,0,255,128,0,8,255]);
  run(['run','patch.json','--video','-','--size','3x1','--frames','1','--out','gpu','--gpu-module',path.resolve(process.env.INK_TEST_PATCH_GPU)],pixels);
  assert.deepEqual([...PNG.raster(path.join(dir,'gpu/previews/image.png')).data],
    [255,128,40,255,0,128,0,255,127,128,8,255]);
});
