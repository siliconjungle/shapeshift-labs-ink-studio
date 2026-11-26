'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const { graphOutputs } = require('./graph-outputs.js');
const { fields, prepare } = require('./paint-flow-solver.js');
const { format: celFormat } = require('./painting-cels.js');

const format = 'ink-studio/painting-flow';
const json = value => typeof value === 'string' && value.endsWith('.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const print = value => console.log(JSON.stringify(value, null, 2));

function numeric(value, fallback, min, max, whole = false) {
  if (value === undefined) return fallback;
  const n=Number(value);
  if (typeof value!=='string' || !value.trim() || !Number.isFinite(n) || n<min || n>max || whole&&!Number.isSafeInteger(n))
    throw new RangeError('Invalid paint flow time, frame count, or frame rate');
  return n;
}

module.exports = function paintingFlow([verb, scene, file, ...rest], flags, kit, openEditor) {
  const { out } = flags, bake=verb==='bake', sample=verb==='sample';
  const allowed=bake?['out','from','fps','frames','playback']:['out','at'];
  if ((!bake&&!sample) || !json(scene) || !json(file) || !json(out) || rest.length ||
      Object.keys(flags).some(key=>!allowed.includes(key)))
    throw new TypeError('Use painting-flow sample <scene.json> <plan.json> [--at seconds] --out scene.json or bake <scene.json> <plan.json> --fps 12 --frames 24 --out clip.json');
  if (sample && path.dirname(path.resolve(scene))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the flowed scene beside its source to preserve relative assets');
  const plan=read(file);
  if (!fields(plan,['format','version','painting','marks','field','chart','speed','step','spacing','wrap','seam','edge','obstructions']) ||
      plan.format!==format || plan.version!==1 || typeof plan.painting!=='string' ||
      !(typeof plan.field==='string' || fields(plan.field,['file']) && json(plan.field.file)))
    throw new TypeError('Use a version 1 painting flow plan with a retained painting and a named or file-backed field');

  const fieldFile=typeof plan.field==='string'?undefined:path.resolve(path.dirname(file),plan.field.file);
  const outputs=graphOutputs([scene,file,...(fieldFile?[fieldFile]:[])]);
  outputs.protect(fs.statSync(out,{throwIfNoEntry:false}));
  const editor=openEditor(scene), source=editor.snapshot();
  const placement=source.paintings3d?.find(row=>row.id===plan.painting);
  if (!placement) throw new RangeError('Unknown retained painting '+plan.painting);
  const named=placement.painting.flowMaps ?? {};
  const asset=fieldFile?read(fieldFile):Object.hasOwn(named,plan.field)?named[plan.field]:undefined;
  if (!asset) throw new RangeError('Unknown retained flow map '+plan.field);
  const flow=prepare(plan,asset,placement,kit.KIT);
  const receipt={painting:placement.id,bounds:flow.bounds,step:flow.dt,wrap:flow.wrap,seam:flow.seam,edge:flow.edge};
  function validate(marks) {
    const slots=new Set(marks.map(row=>row.attachment?.slot));
    const bindings=Object.fromEntries(Object.entries(placement.bindings ?? {}).filter(([slot])=>slots.has(slot)));
    return editor.planPainting3d({...placement,bindings,painting:{...placement.painting,marks}}, {update:true});
  }

  if (sample) {
    const time=numeric(flags.at,0,0,60), { marks,report }=flow.sample(time);
    const {paintings3d}=validate(marks);
    files.json(out,{...source,paintings3d});
    return print({...receipt,out,time,marks:report});
  }

  const from=numeric(flags.from,0,0,60), fps=numeric(flags.fps,12,1,120,true);
  const count=numeric(flags.frames,24,1,120,true), playback=flags.playback??'once';
  if (!['once','loop'].includes(playback) || from+(count-1)/fps>60)
    throw new RangeError('Paint flow bake needs once or loop playback within 60 seconds');
  let markCount=0;
  const takes=Array.from({length:count},(_,i)=>{
    const time=from+i/fps, result=flow.sample(time);
    markCount+=result.marks.length;
    if (markCount>8192) throw new RangeError('Paint flow bake exceeds the retained cel mark budget');
    validate(result.marks);
    return {id:'flow-'+String(i+1).padStart(3,'0'),time,...result};
  });
  const {marks,...painting}=placement.painting;
  const document={format:celFormat,version:1,fps,playback,placement:{...placement,painting},
    cels:takes.map(({id,marks})=>({id,hold:1,marks}))};
  files.json(out,document);
  return print({...receipt,out,fps,playback,frames:takes.map(({id,time,report})=>({id,time,marks:report}))});
};
