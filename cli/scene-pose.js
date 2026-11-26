'use strict';

const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');
const json=value=>typeof value==='string'&&value.endsWith('.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const print=value=>console.log(JSON.stringify(value,null,2));

function seconds(value,fallback) {
  if (value===undefined) return fallback;
  const n=Number(value);
  if (typeof value!=='string'||!value.trim()||!Number.isFinite(n)||n<0||n>3600)
    throw new RangeError('Pose time, duration and hold use 0–3600 seconds');
  return n;
}

module.exports=function scenePose([verb,source,file,...rest],flags,loadScene) {
  const capture=verb==='capture', {out,sequence,id,blend}=flags;
  const allowed=capture?['out','sequence','id','at','duration','hold','blend']:['out'];
  if ((!capture&&verb!=='apply')||!json(source)||!json(file)||!json(out)||rest.length||
      Object.keys(flags).some(name=>!allowed.includes(name))||sequence!==undefined&&!json(sequence))
    throw new TypeError('Use scene-pose capture <scene.json> <edits-or-scene.json> --at seconds --out poses.json or apply <scene.json> <poses.json> --out scene.json');
  if (!capture&&path.dirname(path.resolve(source))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the posed scene beside its source to preserve relative assets');
  const outputs=graphOutputs([source,file,...(sequence?[sequence]:[])]);
  outputs.protect(fs.statSync(out,{throwIfNoEntry:false}));
  const descriptor=loadScene(source);
  if (!descriptor.openEditor) throw new TypeError('Sparse poses need a plain editable JSON diorama');
  const at=seconds(flags.at,0), context=descriptor.poseCapture(at), document=read(file);
  if (capture) {
    let input=document;
    if (!document||typeof document!=='object'||Array.isArray(document)) throw new TypeError('Use an edited scene or a changes array');
    if (Object.hasOwn(document,'changes')) {
      if (Object.keys(document).length!==1) throw new TypeError('An edit snapshot contains a changes array');
    } else {
      const edited=loadScene(file);
      if (!edited.openEditor) throw new TypeError('Use a plain edited JSON scene or a changes array');
      input=edited.poseCapture(at);
    }
    const result=context.capture(input,{sequence:sequence&&read(sequence),id,duration:seconds(flags.duration),
      hold:seconds(flags.hold,0),blend});
    files.json(out,result.sequence);
    return print({out,...result.key,id:result.sequence.id,duration:result.sequence.duration});
  }
  const result=context.apply(document);
  loadScene(source,result.scene);
  files.json(out,result.scene);
  print({out,id:document.id,ranges:result.ranges});
};
