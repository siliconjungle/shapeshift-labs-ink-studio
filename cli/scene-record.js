'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {createInterface}=require('node:readline');
const files=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');

const json=value=>typeof value==='string'&&value.endsWith('.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const print=value=>console.log(JSON.stringify(value,null,2));

function line(text) {
  if (text.length>65536) throw new RangeError('Scene changes exceed the packet size budget');
  return JSON.parse(text);
}

async function captureFile(input,take) {
  const stat=fs.statSync(input);
  if (!stat.isFile()||stat.size>16*1024*1024)
    throw new RangeError('Use a recorded NDJSON file up to 16 MiB');
  const stream=fs.createReadStream(input);
  const reader=createInterface({input:stream,crlfDelay:Infinity,terminal:false});
  try {
    for await (const text of reader) {
      if (!text.trim()) continue;
      const {elapsed,...packet}=line(text);
      take.push(packet,elapsed);
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function captureLive(take) {
  const clock=take.clock, {from,to,countIn,punch}=clock, end=countIn+to-from, timers=[];
  const emit=(state,time)=>process.stderr.write(JSON.stringify({type:'scene-record',state,time})+'\n');
  const reader=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
  const start=performance.now();
  function schedule(elapsed,action) {
    const deadline=start+elapsed*1000;
    function tick() {
      const left=deadline-performance.now();
      if (left<=0) action();
      else timers.push(setTimeout(tick,Math.ceil(left)));
    }
    tick();
  }
  if (countIn) emit('count-in',from);
  schedule(countIn,()=>emit('rolling',from));
  if (punch) {
    schedule(countIn+punch[0]-from,()=>emit('punch-in',punch[0]));
    schedule(countIn+punch[1]-from,()=>emit('punch-out',punch[1]));
  }
  schedule(end,()=>reader.close());
  try {
    for await (const text of reader) {
      if (!text.trim()) continue;
      take.push(line(text),(performance.now()-start)/1000);
    }
  } finally {
    timers.forEach(clearTimeout);
    reader.close();
    process.stdin.pause();
  }
}

module.exports=async function sceneRecord([verb,source,file,...rest],flags,loadScene) {
  const {input,out}=flags, capture=verb==='capture';
  if ((!capture&&verb!=='apply')||!json(source)||!json(file)||!json(out)||rest.length||
      Object.keys(flags).some(name=>!(capture?['input','out']:['out']).includes(name))||
      input!==undefined&&(typeof input!=='string'||!input.trim()))
    throw new TypeError('Use scene-record capture <scene.json> <plan.json> [--input changes.ndjson] --out take.json or apply <scene.json> <take.json> --out scene.json');
  if (!capture&&path.dirname(path.resolve(source))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the recorded scene beside its source to preserve relative assets');
  const outputs=graphOutputs([source,file,...(input?[input]:[])]);
  outputs.protect(fs.statSync(out,{throwIfNoEntry:false}));
  const descriptor=loadScene(source);
  if (!descriptor.openEditor) throw new TypeError('Scene recording needs a plain editable JSON diorama');
  const recorder=descriptor.recording(), data=read(file);
  if (capture) {
    const take=recorder.capture(data);
    if (input) await captureFile(input,take);
    else await captureLive(take);
    const result=take.finish(), {id,tracks}=result.take;
    outputs.protect(fs.statSync(out,{throwIfNoEntry:false}));
    files.json(out,result.take);
    return print({out,id,tracks:tracks.map(row=>({target:row.target,keys:row.keys.length})),...result.stats});
  }
  const result=recorder.apply(data);
  loadScene(source,result.scene);
  files.json(out,result.scene);
  print({out,id:data.id,clips:result.clips});
};
