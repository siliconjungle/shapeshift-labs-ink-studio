'use strict';

const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const wav=require('./wav.js');
const PNG=require('./png.js');
const R=require('./render.js');
const {pose}=require('./diarama-pose.js');
const {graphOutputs}=require('./graph-outputs.js');
const json=value=>typeof value==='string'&&value.endsWith('.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const report=value=>console.log(JSON.stringify(value,null,2));

function number(value,fallback,min,max,integer=false) {
  if (value===undefined) return fallback;
  const n=Number(value);
  if (typeof value!=='string'||!value.trim()||!Number.isFinite(n)||n<min||n>max||integer&&!Number.isSafeInteger(n))
    throw new RangeError('Invalid paint effects time or flipbook dimensions');
  return n;
}

function bake(source,descriptor,out,flags,kit) {
  const from=number(flags.from,0,0,60), fps=number(flags.fps,12,1,120,true);
  const count=number(flags.frames,24,1,120,true), w=number(flags.w,320,8,1024,true), h=number(flags.h,240,8,1024,true);
  if (from+(count-1)/fps>60||count*w*h>48e6||
      ['raw','ortho','flipbook'].some(name=>flags[name]!==undefined&&flags[name]!==true))
    throw new RangeError('Paint effects bake exceeds its timeline or raster budget');
  const rendered=[], frames=[];
  const outputs=Array.from({length:count},(_,i)=>{
    const time=from+i/fps, world=descriptor.build(undefined,{parameterInputs:{time}});
    pose(world,time,{kit,maxSteps:3600});
    const image=R.render(world,{w,h,px:1,t:time,raw:flags.raw===true,ortho:flags.ortho,
      renderGrid:false,shutter:false});
    if (image.w!==w||image.h!==h||image.rgb.length!==w*h*3) throw new RangeError('Bake needs native-grid color frames');
    if (flags.flipbook) rendered.push(PNG.packFrame(image));
    const file='frame-'+String(i+1).padStart(3,'0')+'.png';
    frames.push({time,file,clips:world.paintEffects.clips});
    return {file,bytes:PNG.encode(w,h,image.rgb,3)};
  });
  const document={format:'ink-studio/paint-effects-bake',version:1,fps,w,h,track:source.paintEffects.id,frames,
    ...(flags.flipbook&&{flipbook:'flipbook.png'})};
  if (flags.flipbook) outputs.push({file:document.flipbook,bytes:PNG.encodeAnimation(rendered,fps)});
  outputs.push({file:'bake.json',document});
  return {outputs,document};
}

module.exports=function paintEffects([verb,file,first,second,...rest],flags,kit,loadScene) {
  const {out}=flags, api=kit.KIT.procedural.paintEffects;
  const allowed={apply:['out'],inspect:['at','point'],erase:['out'],sample:['out','at'],
    bake:['out','from','fps','frames','w','h','raw','ortho','flipbook']};
  if (!Object.hasOwn(allowed,verb)||!json(file)||rest.length||Object.keys(flags).some(key=>!allowed[verb].includes(key))||
      (verb==='apply'?!json(first)||second!==undefined:verb==='erase'?!first||!json(second):first!==undefined)||
      (verb==='bake'?typeof out!=='string'||!out.trim():verb!=='inspect'&&!json(out)))
    throw new TypeError('Use paint-effects apply, inspect, erase, sample or bake. See paint-effects.md for arguments.');
  if (['apply','erase','sample'].includes(verb)&&path.dirname(path.resolve(file))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the edited scene beside its source to preserve relative assets');
  const descriptor=loadScene(file);
  if (!descriptor.openEditor) throw new TypeError('Paint effects need a plain editable JSON scene');
  const source=descriptor.openEditor({historyLimit:0}).snapshot();
  if (verb!=='apply'&&!source.paintEffects) throw new RangeError('The scene has no paint effects track');
  const inputs=[file,...(verb==='apply'?[first]:verb==='erase'?[second]:[])];
  if (verb==='bake') {
    const {outputs,document}=bake(source,descriptor,out,flags,kit);
    graphOutputs(inputs).write(out,outputs);
    return report({out,...document});
  }
  const time=number(flags.at,0,0,60);
  if (verb==='inspect') {
    const {reports,duration,time:at}=api.scene(source,time);
    const point=typeof flags.point==='string'?flags.point.split(',').map(Number):undefined;
    if (flags.point!==undefined&&(!point||point.length!==3||flags.point.split(',').some(part=>!part.trim())||!point.every(Number.isFinite)))
      throw new RangeError('Inspect a mask with --point x,y,z');
    if (point) for (const [i,{spatial}] of api.header(source.paintEffects,source).entries.entries())
      reports[i].influence=reports[i].weight*spatial(point);
    return report({time:at,duration,clips:reports});
  }

  const output=fs.statSync(out,{throwIfNoEntry:false});
  graphOutputs(inputs).protect(output);
  let track=source.paintEffects;
  if (verb==='sample') {
    if (flags.at===undefined) throw new TypeError('Choose a sample time with --at');
    track={...track,time};
  } else if (verb==='erase') {
    const {id,...patch}=read(second), clip=track.clips.find(row=>row.id===first);
    if (!clip) throw new RangeError('Unknown paint effects clip '+first);
    const erasers=kit.KIT.procedural.channelEraser.revise(clip.erasers,id,patch);
    track={...track,clips:track.clips.map(row=>row===clip?{...row,erasers}:row)};
  } else {
    track=read(first);
    const {entries}=api.header(track,source);
    const relative=(asset,readAsset)=>{
      const input=path.resolve(path.dirname(first),asset);
      graphOutputs([input]).protect(output);
      return readAsset(input);
    };
    let clips=track.clips.map(row=>{
      if (row.kind==='flow'&&row.effect.field?.file!==undefined) {
        const ref=row.effect.field;
        if (Object.keys(ref).length!==1||!json(ref.file)) throw new TypeError('Expected a relative flow-map JSON reference');
        return {...row,effect:{...row.effect,field:relative(ref.file,read)}};
      }
      if (row.kind==='throb') {
        const baked=kit.KIT.procedural.paintThrob.bake(api.native(track,row),file=>relative(file,wav.read));
        return {...row,effect:{...row.effect,drivers:baked.drivers}};
      }
      return row;
    });
    const other=clips.filter(row=>row.kind!=='evaporate'), {time:_,...live}=track;
    const captureScene={...source,paintEffects:other.length?{...live,clips:other}:undefined};
    const captureDescriptor=clips.some(row=>row.kind==='evaporate'&&row.effect.particles===undefined)&&loadScene(file,captureScene);
    clips=clips.map((row,i)=>{
      if (row.kind!=='evaporate'||row.effect.particles!==undefined) return row;
      const capture=kit.KIT.procedural.paintEvaporation.capture(api.native(track,row));
      const at=entries[i].start;
      const world=captureDescriptor.build(undefined,{parameterInputs:{time:at},paintEvaporationCapture:capture});
      const {particles,captureTime}=capture.finish(world,at);
      return {...row,effect:{...row.effect,particles,captureTime}};
    });
    track={...track,clips};
  }
  const revised={...source,paintEffects:track};
  const {reports,duration}=api.scene(revised,0);
  loadScene(file,revised);
  files.json(out,revised);
  return report({out,id:track.id,duration,clips:reports});
};
