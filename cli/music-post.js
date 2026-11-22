const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'), {json}=require('./asset-files.js'), {stageAt}=require('./recorded-presentation.js');
const Reaper=require('./post-reaper.js'), {print}=require('./post-print.js');
const {readAudioSource}=require('./sound-source.js');
const {read}=Reaper;
const usage='music post from-story | relink | room | repair | review | export | import ... --out path';
const output=value=>{process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;};

function project(P,file) {
  const {check,fields,record,id}=P.musicInstruments;
  const raw=read(file);
  check(fields(raw,['session','assets']) && record(raw.assets) && Object.keys(raw.assets).length<=256,
    'Expected an Ink editorial session and audio asset paths');
  const paths=Object.fromEntries(Object.entries(raw.assets).map(([name,ref])=>{
    check(id(name) && typeof ref==='string' && ref.length<=2048,'Invalid editorial asset path');
    return [name,path.resolve(path.dirname(file),ref)];
  }));
  return {session:raw.session,paths,assets:Object.fromEntries(Object.entries(paths).map(([name,at])=>
    [name,readAudioSource(at,P,{metadata:true})]))};
}
function pathsFor(out,paths) {
  return Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,path.relative(out,file)]));
}
function asset(stage,name,value,encoding='float64') {
  const file='audio/'+name+'.wav';
  stage.save(file,WAV.encode(value,{encoding}));
  return file;
}
function fromStory(P,file,out) {
  const {check,id}=P.musicInstruments, handoff=read(file);
  check(handoff.format==='ink-studio/story-editorial-handoff' && handoff.version===1 &&
    typeof handoff.audio?.editorial==='string','Expected an Ink story handoff manifest');
  const from=path.dirname(file), load=file=>project(P,path.resolve(from,file));
  const roles=load(handoff.audio.editorial), lines=handoff.dialogue?.editorial ? load(handoff.dialogue.editorial) : null;
  const paths={...roles.paths}, clips=roles.session.clips.filter(clip=>!(lines && clip.track==='dialogue'));
  const assets={...roles.assets};
  if (lines) {
    check(JSON.stringify(roles.session.picture)===JSON.stringify(lines.session.picture) &&
      roles.session.sampleRate===lines.session.sampleRate,'Story roles and editable dialogue have different clocks');
    for (const [name,value] of Object.entries(lines.paths)) {
      const alias=Object.hasOwn(paths,name) && paths[name]!==value ? 'line-'+name : name;
      check(id(alias) && (!Object.hasOwn(paths,alias) || paths[alias]===value),'Duplicate dialogue asset address');
      paths[alias]=value;
      assets[alias]=lines.assets[name];
    }
    for (const line of lines.session.clips) {
      const {takes,...clip}=line;
      const mapped=Object.fromEntries(Object.entries(takes).map(([name,take])=>[name,{...take,
        asset:paths[take.asset]===lines.paths[take.asset] ? take.asset : 'line-'+take.asset
      }]));
      clips.push({...clip,takes:mapped});
    }
  }
  const session={...roles.session,clips};
  P.mediaGraph.audioEditorial.inspect(session,assets);
  json(out,{session,assets:pathsFor(path.dirname(out),paths)});
  return output({project:out,picture:handoff.picture?.file ? path.join(from,handoff.picture.file) : null,
    dialogue:lines?.session.clips.length ?? 0});
}
function captureImport(P,folder,changes,out) {
  const reply=Reaper.addressed(P,folder,read(changes)), stage=stageAt(out);
  try {
    const result=print(P,reply.session,reply.assets,stage,{allowUnresolved:reply.manifest.omitted.length>0});
    const report={application:reply.application,identity:reply.manifest.identity,edits:reply.log,
      omitted:reply.manifest.omitted,...result};
    stage.json('project.json',{session:reply.session,assets:pathsFor(out,reply.sourcePaths)});
    stage.json('edits.json',reply.changes);
    stage.json('report.json',report);
    stage.publish(new Set([changes,path.join(folder,'handoff.json'),...Object.values(reply.sourcePaths)]));
    return output({project:path.join(out,'project.json'),mix:path.join(out,result.mix),
      report:path.join(out,'report.json'),accepted:reply.log.filter(row=>row.applied).length,verification:result.verification});
  } finally {
    stage.close();
  }
}
module.exports=function command([mode,file,changes],opt,kit) {
  if (!file || typeof opt.out!=='string' || !['from-story','relink','room','repair','review','export','import'].includes(mode) ||
    (!changes && mode!=='from-story' && mode!=='export')) throw new TypeError('Use '+usage);
  const P=kit.KIT.procedural, A=P.mediaGraph, Q=A.postProduction,E=A.audioEditorial;
  const {check,fields,id,integer}=P.musicInstruments, out=path.resolve(opt.out), input=path.resolve(file);
  if (mode==='from-story') return fromStory(P,input,out);
  if (mode==='import') return captureImport(P,input,path.resolve(changes),out);
  const settings=changes ? read(path.resolve(changes)) : {};
  if (mode==='room') {
    check(fields(settings,['reference','options']) && typeof settings.reference==='string',
      'Specify a reference audio source and quiet source ranges');
    const reference=path.resolve(path.dirname(changes),settings.reference);
    const result=Q.matchRoom(readAudioSource(input,P),readAudioSource(reference,P),settings.options);
    const stage=stageAt(out);
    try {
      const room=asset(stage,'room-tone',result.value);
      stage.json('report.json',result.report);
      stage.publish(new Set([input,path.resolve(changes),reference]));
      return output({room:path.join(out,room),report:path.join(out,'report.json')});
    } finally {
      stage.close();
    }
  }
  const {session,assets,paths}=project(P,input);
  if (mode==='export') {
    const config={...settings};
    const resolve=ref=>path.resolve(path.dirname(path.resolve(changes ?? input)),ref);
    if (typeof config.picture==='string') config.picture=resolve(config.picture);
    if (config.records!==undefined) {
      const {record}=P.musicInstruments;
      check(record(config.records) && Object.values(config.records).every(ref=>typeof ref==='string'),
        'Editorial records must name JSON files');
      config.records=Object.fromEntries(Object.entries(config.records).map(([name,ref])=>[name,resolve(ref)]));
    }
    return output(Reaper.publish(P,session,assets,paths,config,out));
  }
  const stage=stageAt(out);
  const refs=pathsFor(out,paths), guards=new Set([input,path.resolve(changes),...Object.values(paths)]);
  try {
    let next,report;
    if (mode==='relink') {
      const result=Q.relink(session,assets,settings);
      for (const name of Object.keys(result.report.generated)) refs[name]=asset(stage,name,result.assets[name]);
      next=result.value; report=result.report;
    } else if (mode==='review') {
      const result=Q.reviewPicture(session,assets,settings);
      report={...result.report,beforeFile:asset(stage,'before',result.before,'pcm24'),
        afterFile:asset(stage,'after',result.value,'pcm24')};
      next=result.session;
    } else if (mode==='repair') {
      check(fields(settings,['clip','take','as','options','select']) && id(settings.clip) && id(settings.as) &&
        (settings.take===undefined || id(settings.take)) && typeof (settings.select ?? false)==='boolean',
      'Repair needs an existing clip and a new alternate take ID');
      const clip=session.clips.find(clip=>clip.id===settings.clip);
      const name=settings.take ?? clip?.take, take=clip?.takes[name], options=settings.options ?? {};
      check(take && !Object.hasOwn(clip.takes,settings.as) && !Object.hasOwn(assets,settings.as),
        'Repair alternate or asset collides with an existing source');
      const {preview,...full}=options, result=A.repairDialogue(assets[take.asset],full);
      const {sampleRate,channels}=result.value, frames=result.value.samples.length/channels;
      const fromSample=preview?.fromSample ?? 0,toSample=preview?.toSample ?? frames;
      check((preview===undefined || fields(preview,['fromSample','toSample'])) &&
        integer(fromSample,0,frames-1) && integer(toSample,fromSample+1,frames),'Invalid repair preview range');
      const crop=value=>({sampleRate,channels,samples:value.samples.subarray(fromSample*channels,toSample*channels)});
      const audition=(name,value)=>asset(stage,name,crop(value),'pcm24');
      const previews={before:audition('before',result.before),repaired:audition('repaired',result.value),
        removed:audition('removed',result.removed)};
      const derived=result.value;
      refs[settings.as]=asset(stage,'repair-'+settings.as,derived);
      const row=E.inspect(session,assets).clips.find(row=>row.id===clip.id);
      const sourceSync=clip.take===name ? row.source.sourceSync :
        E.inspect({...session,clips:[{...clip,take:name,comp:[]}]},assets).clips[0].source.sourceSync;
      const edits=[{op:'put-take',clip:clip.id,take:settings.as,source:{...take,asset:settings.as,sync:{sample:sourceSync}}}];
      if (settings.select) {
        if (clip.comp?.length) edits.push({op:'comp',clip:clip.id,ranges:[]});
        edits.push({op:'take',clip:clip.id,take:settings.as});
      }
      next=E.revise(session,{...assets,[settings.as]:derived},edits).value;
      report={clip:clip.id,take:name,original:take.asset,derived:settings.as,
        selected:settings.select === true,previews,preview:{fromSample,toSample},repair:result.report};
    }
    stage.json('project.json',{session:next,assets:refs});
    stage.json('report.json',report);
    stage.publish(guards);
    return output({project:path.join(out,'project.json'),report:path.join(out,'report.json'),...report});
  } finally {
    stage.close();
  }
};
