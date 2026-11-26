'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const {graphOutputs} = require('./graph-outputs.js');
const json = value => typeof value==='string' && value.endsWith('.json');

module.exports = function paintEvaporation([verb,scene,plan,...extra],flags,kit,loadScene) {
  const {out,at,layer}=flags, apply=verb==='apply';
  const allowed=apply?['out','at']:['at','layer'];
  if ((!apply && verb!=='inspect') || !json(scene) || (apply ? !json(plan) || !json(out) : plan!==undefined) ||
      extra.length || Object.keys(flags).some(key=>!allowed.includes(key)) || (layer!==undefined && typeof layer!=='string'))
    throw new TypeError('Use paint-evaporation apply <scene.json> <plan.json> [--at seconds] --out scene.json or inspect <scene.json> [--at seconds] [--layer id]');
  const atTime=at===undefined?undefined:Number(at);
  if (at!==undefined && (typeof at!=='string' || !at.trim() || !Number.isFinite(atTime) || atTime<0 || atTime>1e4))
    throw new RangeError('Use a nonnegative time in seconds');
  if (apply && path.dirname(path.resolve(scene))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the evaporated scene beside its source to preserve relative assets');
  if (apply) graphOutputs([scene,plan]).protect(fs.statSync(out,{throwIfNoEntry:false}));
  const descriptor=loadScene(scene);
  if (!descriptor.openEditor) throw new TypeError('Paint evaporation needs a plain editable JSON scene');
  const source=descriptor.openEditor({historyLimit:0}).snapshot();
  const api=kit.KIT.procedural.paintEvaporation;
  if (!apply) {
    const time=atTime??0, layers=api.scene(source,time).layers.filter(row=>layer===undefined || row.plan.id===layer);
    if (layer!==undefined && !layers.length) throw new RangeError('Unknown evaporation layer '+layer);
    console.log(JSON.stringify({time,layers:layers.map(({plan,particles,captureTime})=>({
      id:plan.id,captureTime,life:plan.life,particles:particles.map((row,i)=>({id:'paint-particles/'+plan.id+'/'+i,...row,status:time<row.birth?'pending':
        time<row.birth+plan.life?'airborne':'expired'}))
    }))},null,2));
    return;
  }

  const recipe=JSON.parse(fs.readFileSync(plan,'utf8'));
  const capture=api.capture(recipe);
  const time=atTime??recipe.start??0;
  const existing=source.paintEvaporations??[], previous=existing.filter(row=>row.id!==recipe.id);
  const input=previous.length===existing.length?descriptor:loadScene(scene,{...source,paintEvaporations:previous});
  const world=input.build(undefined,{parameterInputs:{time},paintEvaporationCapture:capture});
  const baked=capture.finish(world,time);
  const revised={...source,paintEvaporations:[...previous,baked]};
  api.scene(revised,time);
  files.json(out,revised);
  console.log(JSON.stringify({out,id:baked.id,captureTime:time,particles:baked.particles.length,
    sources:[...new Set(baked.particles.map(row=>row.source))]},null,2));
};
