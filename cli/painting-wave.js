'use strict';

const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const {graphOutputs}=require('./graph-outputs.js');

const json=value=>typeof value==='string' && value.endsWith('.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function paintingWave([verb,scene,plan,...extra],flags,kit,loadScene){
  const {out,at}=flags, apply=verb==='apply', inspect=verb==='inspect', sample=verb==='sample';
  const allowed=apply?['out']:inspect?['at']:['at','out'];
  if ((!apply&&!inspect&&!sample) || !json(scene) || (apply?!json(plan):plan!==undefined) ||
      (!inspect&&!json(out)) || extra.length || Object.keys(flags).some(key=>!allowed.includes(key)) ||
      (sample&&at===undefined))
    throw new TypeError('Use painting-wave apply <scene.json> <plan.json> --out scene.json, inspect <scene.json> [--at seconds], or sample <scene.json> --at seconds --out scene.json');
  const time=at===undefined?0:Number(at);
  if (at!==undefined && (typeof at!=='string' || !at.trim() || !Number.isFinite(time) || time<0 || time>1e6))
    throw new RangeError('Wave time needs finite nonnegative seconds');
  if (!inspect && path.dirname(path.resolve(scene))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the waved scene beside its source to preserve relative assets');
  const inputs=graphOutputs([scene,...(apply?[plan]:[])]);
  if (out) inputs.protect(fs.statSync(out,{throwIfNoEntry:false}));
  const descriptor=loadScene(scene);
  if (!descriptor.openEditor) throw new TypeError('Painting waves need a plain editable JSON scene');
  const source=descriptor.openEditor({historyLimit:0}).snapshot(), existing=source.paintingWaves??[];
  let revised=source;
  if (apply) {
    const wave=read(plan);
    kit.KIT.procedural.paintWave.prepare(wave);
    const found=existing.some(row=>row.id===wave.id);
    revised={...source,paintingWaves:found?existing.map(row=>row.id===wave.id?wave:row):[...existing,wave]};
  } else if (sample) revised={...source,paintingWaves:existing.map(row=>({...row,time}))};

  const world=(revised===source?descriptor:loadScene(scene,revised)).build(undefined,{parameterInputs:{time}});
  const waves=world.paintWaveReport??[];
  if (!inspect) files.json(out,revised);
  console.log(JSON.stringify({...(out&&{out}),time,waves},null,2));
};
