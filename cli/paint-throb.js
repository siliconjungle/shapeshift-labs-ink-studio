'use strict';

const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const wav=require('./wav.js');
const {graphOutputs}=require('./graph-outputs.js');
const json=value=>typeof value==='string' && value.endsWith('.json');

module.exports=function paintThrob([verb,scene,plan,...extra],flags,kit,loadScene) {
  const {out,at,pulse}=flags, apply=verb==='apply';
  const allowed=apply?['out']:['at','pulse'];
  if ((!apply && verb!=='inspect') || !json(scene) || (apply ? !json(plan) || !json(out) : plan!==undefined) ||
      extra.length || Object.keys(flags).some(key=>!allowed.includes(key)) || (pulse!==undefined && typeof pulse!=='string'))
    throw new TypeError('Use paint-throb apply <scene.json> <plan.json> --out scene.json or inspect <scene.json> [--at seconds] [--pulse id]');
  const time=at===undefined?0:Number(at);
  if (at!==undefined && (typeof at!=='string' || !at.trim() || !Number.isFinite(time) || time<0 || time>1e6))
    throw new RangeError('Use a nonnegative time in seconds');
  if (apply && path.dirname(path.resolve(scene))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the pulsing scene beside its source to preserve relative assets');
  const descriptor=loadScene(scene);
  if (!descriptor.openEditor) throw new TypeError('Paint throb needs a plain editable JSON scene');
  const source=descriptor.openEditor({historyLimit:0}).snapshot(), api=kit.KIT.procedural.paintThrob;
  if (!apply) {
    const {reports=[]}=api.scene(source,time);
    const pulses=reports.filter(row=>pulse===undefined || row.id===pulse);
    if (pulse!==undefined && !pulses.length) throw new RangeError('Unknown paint throb '+pulse);
    console.log(JSON.stringify({time,pulses},null,2));
    return;
  }
  const existing=source.paintThrobs??[], recipe=JSON.parse(fs.readFileSync(plan,'utf8'));
  const output=fs.statSync(out,{throwIfNoEntry:false}), inputs=[scene,plan];
  graphOutputs(inputs).protect(output);
  const baked=api.bake(recipe,file=>{
    const input=path.resolve(path.dirname(plan),file);
    graphOutputs([input]).protect(output);
    return wav.read(input);
  });
  const plans=existing.some(row=>row.id===baked.id)?existing.map(row=>row.id===baked.id?baked:row):[...existing,baked];
  const revised={...source,paintThrobs:plans};
  loadScene(scene,revised);
  const {reports}=api.scene(revised);
  files.json(out,revised);
  console.log(JSON.stringify({out,pulse:reports.find(row=>row.id===baked.id),
    embeddedAudio:Object.entries(baked.drivers).filter(([,row])=>row.type==='audio').map(([id,row])=>({
      id,seconds:row.envelope.duration,frames:row.envelope.values.length
    }))},null,2));
};
