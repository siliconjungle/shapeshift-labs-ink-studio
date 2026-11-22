/* Frame-aligned clock and staged publication for native recording exports. */
const fs = require('node:fs');
const path = require('node:path');
const Replay = require('./scene-replay.js');
const { json } = require('./asset-files.js');
const { graphOutputs } = require('./graph-outputs.js');
const token = n => typeof n==='string' && n.trim().length>0 && n.length<=512;

function clockFor(K,recording,settings,rate) {
  const T=K.procedural.takeTime, {origin,end}=recording, native=origin.world.takeClock;
  const period=T.period(origin.world.dt,native?.simulationRate), simulation=T.div(T.read(1),period);
  const fps=T.read(settings.fps ?? native?.fps ?? 24), frameRate=T.pack(fps), speed=T.seconds(fps);
  const ceil=([n,d])=>T.index(-T.roundDown([-n,d]));
  const toFrame=point=>T.index(T.roundDown(T.mul(point,fps)));
  const firstFrame=ceil(T.mul(T.mul(T.read(origin.tick),period),fps));
  const lastFrame=toFrame(T.mul(T.read(end.tick),period));
  const fromFrame=settings.fromFrame ?? firstFrame, stopFrame=settings.toFrame ?? lastFrame, frameCount=stopFrame-fromFrame;
  const {width=640,height=360,video=true}=settings;
  if (!Number.isSafeInteger(fromFrame)||!Number.isSafeInteger(stopFrame)||fromFrame<firstFrame||stopFrame>lastFrame||
      frameCount<1||frameCount>Replay.maxFrames||!Replay.dimensions(width,height)||frameCount*width*height>Replay.maxPixels||
      speed<1||speed>120||typeof video!=='boolean'||video&&(width%2||height%2)||
      settings.effects!==undefined&&!token(settings.effects))
    throw new RangeError('Handoff needs a bounded full-frame window inside the recording and an even video size');
  const cutRate=T.read(native?.fps??frameRate), cuts=new Map();
  for (const row of [...(native?.cuts??[])].sort((a,b)=>a.frame-b.frame))
    cuts.set(ceil(T.mul(T.div(T.read(row.frame),cutRate),fps)),row.id);
  const anchors=[[fromFrame,[...cuts].findLast(([n])=>n<=fromFrame)?.[1]??'Opening'],
    ...[...cuts].filter(([n])=>n>fromFrame&&n<stopFrame)];
  const shots=anchors.map(([firstFrame,label],i)=>({id:'shot-'+(i+1),label,firstFrame,offsetFrame:firstFrame-fromFrame,
    frames:(anchors[i+1]?.[0]??stopFrame)-firstFrame}));
  const take=K.timeDomains.take({fps:frameRate,sampleRate:rate,simulationRate:T.pack(simulation),
    cuts:[...cuts].map(([frame,id])=>({frame,id}))});
  const from=T.position(take,{frame:fromFrame}), to=T.position(take,{frame:stopFrame});
  const firstSample=take.at(fromFrame).firstSample,endSample=take.at(stopFrame).firstSample;
  return {T,take,period,from,to,firstSample,endSample,fromFrame,toFrame:stopFrame,frameCount,fps:speed,frameRate,
    width,height,video,shots,rate,sample:point=>T.locate(take,point).sample,frameOf:toFrame};
}
function stageAt(directory) {
  const root=path.resolve(directory), parent=path.dirname(root), entries=[];
  fs.mkdirSync(parent,{recursive:true});
  const folder=fs.mkdtempSync(path.join(parent,'.ink-editorial-'));
  const at=name=>path.join(folder,name);
  function reserve(file) {
    entries.push(file);
    const output=at(file);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    return output;
  }
  return {
    at, reserve, save:(file,bytes)=>fs.writeFileSync(reserve(file),bytes),
    json:(file,value)=>json(reserve(file),value),
    publish(inputs) {
      const guard=graphOutputs([...inputs]);
      for (const file of entries) guard.protect(fs.statSync(path.join(root,file),{throwIfNoEntry:false}));
      if (!fs.existsSync(root)) fs.renameSync(folder,root);
      else {
        for (const file of entries) {
          const output=path.join(root,file);
          fs.mkdirSync(path.dirname(output),{recursive:true});
          fs.renameSync(at(file),output);
        }
      }
    },
    close:()=>fs.rmSync(folder,{recursive:true,force:true})
  };
}
module.exports = { clockFor, stageAt };
