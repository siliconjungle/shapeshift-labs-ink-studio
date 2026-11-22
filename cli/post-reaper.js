/* Loss-aware REAPER exchange for Ink's sync-anchored editorial clips. */
const fs=require('node:fs'), path=require('node:path'), {createHash}=require('node:crypto');
const WAV=require('./wav.js'), {stageAt}=require('./recorded-presentation.js'), {guid,dec}=require('./handoff-reaper.js');
const {print}=require('./post-print.js');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const token=value=>typeof value==='string' && value.length>0 && value.length<=2048 && !/[\0\r\n]/.test(value);
const q=value=>'"'+value+'"'; // IDs and generated relative media paths use a restricted alphabet.
const read=file=>{
  if (fs.statSync(file).size>24*1024*1024) throw new RangeError('Editorial handoff exceeds its JSON budget');
  return JSON.parse(fs.readFileSync(file,'utf8'));
};
const expectedFormat='ink-studio/reaper-editorial-handoff';
const closest=(value,target)=>Number.isFinite(value) && Math.abs(value-target)<1e-8;

function rpp(manifest) {
  const {sampleRate:rate,frames,tracks,items,pictureRate}=manifest;
  const n=samples=>dec(samples/rate), ntsc=Math.round(pictureRate*1001/1000);
  const fractional=Math.abs(ntsc*1000/1001-pictureRate)<1e-8;
  const rulerRate=fractional ? ntsc : Math.max(1,Math.round(pictureRate));
  let output='<REAPER_PROJECT 0.1 "7.0" 0 0\n  AUTOXFADE 0\n  TIMELOCKMODE 0\n  TEMPOENVLOCKMODE 1\n'+
    '  PANLAW 1\n  PANMODE 3\n  SAMPLERATE '+rate+' 1 0\n  TEMPO 120 4 4 0\n'+
    '  TIMEMODE 1 5 -1 '+rulerRate+' '+(fractional ? 2 : 0)+' 0 -1\n'+
    '  SMPTESYNC 0 '+dec(pictureRate)+' 100 40 1000 300 0 0 1 0 0\n'+
    '  ZOOM '+dec(Math.max(1,Math.min(110,820*rate/frames)))+' 0 0\n';
  const pins=items.filter(row=>row.role!=='picture');
  for (const [i,item] of pins.entries()) output+='  MARKER '+(i+1)+' '+n(item.syncSample)+' '+q(item.clip+' sync')+' 0 0 1\n';
  for (const track of tracks) {
    output+='  <TRACK '+track.guid+'\n    NAME '+q(track.name)+'\n    TRACKID '+track.guid+
      '\n    BEAT 0\n    NCHAN 2\n    VOLPAN 1 0 -1 -1 1\n    MUTESOLO 0 0 0\n    MAINSEND '+track.mainSend+' 0\n';
    for (const item of items.filter(row=>row.track===track.guid)) {
      output+='    <ITEM\n      POSITION '+n(item.first)+'\n      SNAPOFFS '+n(item.syncSample-item.first)+
        '\n      LENGTH '+n(item.frames)+'\n      LOOP 0\n      ALLTAKES 0\n      BEAT 0\n      MUTE 0 0\n'+
        '      FADEIN 1 0 0 1 0 0 0\n      FADEOUT 1 0 0 1 0 0 0\n      IGUID '+item.guid+'\n';
      const takes=[item.takes.find(take=>take.id===item.active),...item.takes.filter(take=>take.id!==item.active)];
      for (const [i,take] of takes.entries()) {
        output+=(i ? '      TAKE\n' : '')+'      NAME '+q(take.id)+'\n'+
          (i ? '      TAKEVOLPAN 0 1 -1\n' : '      VOLPAN 1 0 1 -1\n')+
          '      SOFFS 0\n      PLAYRATE 1 1 0 -1 0 0.0025\n      CHANMODE 0\n      GUID '+take.guid+'\n'+
          '      <SOURCE '+(item.role==='picture' ? 'VIDEO' : 'WAVE')+'\n        FILE '+q(take.file)+'\n      >\n';
      }
      output+='    >\n';
    }
    output+='  >\n';
  }
  return output+'>\n';
}

function prepare(P,session,assets,stage,identity,picture,allowUnresolved) {
  const E=P.mediaGraph.audioEditorial, {check}=P.musicInstruments;
  const book=E.inspect(session,assets), rate=book.sampleRate;
  const tracks=[],items=[],byTrack=new Map(),omitted=[];
  const makeTrack=(role,name,mainSend)=>({role,name,guid:guid(identity,'track-'+role+'-'+name),mainSend});
  if (picture) {
    const track=makeTrack('picture','Picture',0), item=guid(identity,'picture-item');
    tracks.push(track);
    items.push({role:'picture',guid:item,track:track.guid,first:0,frames:book.frames,syncSample:0,
      active:'Picture',takes:[{id:'Picture',guid:guid(identity,'picture-take'),...picture}]});
  }
  let size=0;
  const known=new Map(book.clips.map(row=>[row.id,row]));
  for (const clip of session.clips) {
    const row=known.get(clip.id);
    if (row.spot.issue || row.range.fromSample>=row.range.toSample) {
      check(allowUnresolved,'Resolve or explicitly omit the clip outside picture: '+row.id);
      omitted.push({clip:row.id,reason:row.spot.issue ?? 'outside-picture'});
      continue;
    }
    if (!byTrack.has(row.track)) {
      const track=makeTrack('sound',row.track,1);
      byTrack.set(row.track,track);
      tracks.push(track);
    }
    const alternatives=Object.keys(clip.takes).map(take=>{
      const solo={...session,clips:[{...clip,take,comp:take===clip.take ? clip.comp ?? [] : []}]};
      return {take,renderer:E.prepare(solo,assets)};
    });
    const views=alternatives.map(({renderer})=>renderer.clips[0]);
    const first=Math.min(...views.map(row=>row.range.fromSample)), last=Math.max(...views.map(row=>row.range.toSample));
    size+=2*(last-first)*alternatives.length;
    check(size<=32e6,'Editable REAPER media exceeds its PCM export budget');
    const takes=alternatives.map(({take,renderer})=>{
      const samples=new Float64Array(2*(last-first));
      renderer.write(samples,first,last);
      check(samples.every(value=>Number.isFinite(value) && Math.abs(value)<=1),
        'A clip proxy would clip in the workstation: '+clip.id+'/'+take);
      const file='media/'+clip.id+'/'+take+'.wav', bytes=WAV.encode({sampleRate:rate,channels:2,samples},{encoding:'float32'});
      stage.save(file,bytes);
      return {id:take,guid:guid(identity,'take-'+clip.id+'/'+take),file,sha256:digest(bytes)};
    });
    items.push({role:'clip',clip:clip.id,guid:guid(identity,'clip-'+clip.id),track:byTrack.get(row.track).guid,
      first,frames:last-first,syncSample:row.spot.sample,offsetSamples:clip.offsetSamples ?? 0,active:clip.take,
      movable:views.every(view=>view.clipped.head===0 && view.clipped.tail===0),takes});
  }
  return {sampleRate:rate,frames:book.frames,tracks,items,omitted};
}

function publish(P,session,assets,originalPaths,config,out) {
  const {fields,check,record,id}=P.musicInstruments;
  check(fields(config,['picture','allowUnresolved','records']) && (config.picture===undefined || token(config.picture)) &&
    typeof (config.allowUnresolved ?? false)==='boolean' && record(config.records ?? {}) &&
    Object.keys(config.records ?? {}).length<=24 && Object.entries(config.records ?? {}).every(([name,ref])=>id(name) && token(ref)),
    'Invalid REAPER post handoff settings');
  const stage=stageAt(out);
  const inputs=new Set(Object.values(originalPaths));
  try {
    let size=0;
    const originals={};
    for (const [name,source] of Object.entries(originalPaths)) {
      size+=fs.statSync(source).size;
      check(size<=550e6,'Ink editorial sources exceed the handoff media budget');
      const bytes=fs.readFileSync(source), file='ink/sources/'+name+'.wav';
      stage.save(file,bytes);
      originals[name]={file,sha256:digest(bytes)};
    }
    let picture;
    if (config.picture) {
      const ext=path.extname(config.picture).toLowerCase();
      check(['.mov','.mp4'].includes(ext) && fs.statSync(config.picture).size<=256e6,'Use the current MOV or MP4 picture cut');
      inputs.add(config.picture);
      const bytes=fs.readFileSync(config.picture), file='media/picture'+ext;
      stage.save(file,bytes);
      picture={file,sha256:digest(bytes)};
    }
    const records=Object.fromEntries(Object.entries(config.records ?? {}).map(([name,ref])=>{
      read(ref);
      inputs.add(ref);
      const bytes=fs.readFileSync(ref), file='ink/records/'+name+'.json';
      stage.save(file,bytes);
      return [name,{file,sha256:digest(bytes)}];
    }));
    const sourceKey=JSON.stringify(Object.entries(originals).map(([name,row])=>[name,row.sha256]));
    const identity=digest(JSON.stringify([session,sourceKey,picture?.sha256 ?? null]));
    const preparation=prepare(P,session,assets,stage,identity,picture,config.allowUnresolved);
    const reference=print(P,session,assets,stage,{prefix:'ink/prints/',allowUnresolved:Boolean(config.allowUnresolved)});
    const pictureRate=P.takeTime.seconds(P.takeTime.read(session.picture.fps));
    const manifest={format:expectedFormat,version:1,identity,originals,picture:picture ?? null,
      pictureRate,...preparation,reference,records};
    stage.json('handoff.json',manifest);
    const project={session,assets:Object.fromEntries(Object.entries(originals).map(([name,row])=>[name,row.file.slice(4)]))};
    stage.json('ink/project.json',project);
    stage.save('edit.rpp',rpp(manifest));
    stage.save('Capture Ink edits.lua',fs.readFileSync(path.join(__dirname,'reaper-editorial-capture.lua')));
    stage.publish(inputs);
    return {handoff:path.join(out,'handoff.json'),reaper:path.join(out,'edit.rpp'),clips:manifest.items.length-Number(Boolean(picture)),
      omitted:manifest.omitted};
  } finally {
    stage.close();
  }
}

function addressed(P,folder,capture) {
  const {check,fields,id,integer,finite}=P.musicInstruments;
  const manifest=read(path.join(folder,'handoff.json'));
  check(manifest.format===expectedFormat && manifest.version===1 &&
    Array.isArray(manifest.items) && Array.isArray(manifest.tracks),'Expected an Ink REAPER post handoff');
  const {sampleRate:rate,frames}=manifest;
  check(integer(rate,8000,96000) && integer(frames,1,16e6) &&
    Array.isArray(capture?.items) && capture.items.length===manifest.items.length &&
    Array.isArray(capture.tracks) && capture.tracks.length===manifest.tracks.length &&
    capture.format==='ink-studio/reaper-editorial-capture' && capture.version===1 && token(capture.project),
  'REAPER return does not match the handoff items and tracks');
  const project=read(path.join(folder,'ink/project.json')), assets={}, sourcePaths={};
  const originals=Object.entries(manifest.originals ?? {});
  check(originals.length<=256,'Too many originals in the Ink archive');
  function checkMedia(file,sha256) {
    check(token(file) && !path.isAbsolute(file) && !file.split(/[\\/]/).some(part=>part==='..'),
      'Invalid local handoff media path');
    const full=path.join(folder,file);
    check(digest(fs.readFileSync(full))===sha256,'Handoff media changed: '+file);
    return full;
  }
  for (const [name,row] of originals) {
    check(id(name) && row.file==='ink/sources/'+name+'.wav' && project.assets[name]==='sources/'+name+'.wav',
      'Original source address differs from the Ink archive');
    sourcePaths[name]=checkMedia(row.file,row.sha256);
    assets[name]=WAV.read(sourcePaths[name],{metadata:true});
  }
  const identity=digest(JSON.stringify([project.session,JSON.stringify(originals.map(([name,row])=>[name,row.sha256])),
    manifest.picture?.sha256 ?? null]));
  check(identity===manifest.identity && project.session.sampleRate===rate,'The exact Ink session has changed since export');
  const trackByGUID=new Map(capture.tracks.map(row=>[row.guid,row]));
  const incoming=new Map(capture.items.map(row=>[row.guid,row]));
  check(trackByGUID.size===capture.tracks.length && incoming.size===capture.items.length,'Duplicate REAPER addresses');
  function defaults(row,values) {
    return Object.entries(values).every(([name,value])=>closest(row[name],value));
  }
  for (const original of manifest.tracks) {
    const row=trackByGUID.get(original.guid);
    check(row && defaults(row,{gain:1,pan:0,mute:0,polarity:0,width:1,solo:0,fx:0,envelopes:0,sends:0,mainSend:original.mainSend}) &&
      [-1,1].some(value=>closest(row.faderLaw,value)),'Unsupported REAPER track processing or routing: '+original.name);
  }
  const changes=[],log=[],placed=new Map(project.session.clips.map(row=>[row.id,row]));
  const snapped=(value,label)=>{
    check(finite(value,0,frames/rate+1),'Invalid '+label);
    return Math.round(value*rate);
  };
  for (const original of manifest.items) {
    const row=incoming.get(original.guid), label=original.clip ?? 'picture';
    const take=original.takes.find(take=>take.guid===row?.take);
    check(row && row.track===original.track && take && Array.isArray(row.takes) &&
      row.takes.length===original.takes.length && new Set(row.takes).size===row.takes.length &&
      original.takes.every(take=>row.takes.includes(take.guid)),
    'An item was split, moved to a new track, or changed takes outside the handoff: '+label);
    const media=checkMedia(take.file,take.sha256);
    check(token(row.file),'The REAPER take has no source path: '+label);
    const actual=path.resolve(folder,row.file);
    check(fs.realpathSync(actual)===fs.realpathSync(media),'The REAPER take points to different media: '+label);
    check(defaults(row,{itemGain:1,takeGain:1,pan:0,pitch:0,offset:0,rate:1,allTakes:0,loop:0,mute:0,
      fadeIn:0,fadeOut:0,channelMode:0,fx:0,envelopes:0}) && row.autoIn<=0 && row.autoOut<=0 &&
      Math.abs(row.length*rate-original.frames)<.05,'Unsupported trim, fade, stretch, or take processing: '+label);
    const first=snapped(row.position,'REAPER item position'), shiftSamples=first-original.first;
    check(first+original.frames<=frames && (!shiftSamples || original.role!=='picture' && original.movable),
      'The REAPER item move would cross picture or expose uncaptured handles: '+label);
    if (original.role==='picture') continue;
    const clip=placed.get(original.clip);
    check(clip && Object.hasOwn(clip.takes,take.id),'Unknown returned take address');
    if (take.id!==original.active) {
      if (clip.comp?.length) changes.push({op:'comp',clip:clip.id,ranges:[]});
      changes.push({op:'take',clip:clip.id,take:take.id});
    }
    if (shiftSamples) changes.push({op:'nudge',clip:clip.id,offsetSamples:original.offsetSamples+shiftSamples});
    log.push({clip:clip.id,fromTake:clip.take,take:take.id,shiftSamples,syncSample:original.syncSample+shiftSamples,
      applied:Boolean(shiftSamples || take.id!==original.active)});
  }
  const E=P.mediaGraph.audioEditorial, next=E.revise(project.session,assets,changes);
  for (const row of next.report.clips) {
    const target=log.find(entry=>entry.clip===row.id);
    if (target) check(row.spot.sample===target.syncSample,'Returned clip did not land at its addressed sample: '+row.id);
  }
  return {session:next.value,assets,sourcePaths,manifest,changes,log,application:capture.application};
}

module.exports={addressed,publish,read};
