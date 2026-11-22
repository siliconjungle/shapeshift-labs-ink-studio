/* Publish picture, editable cue placement and audio from a verified story take. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('./png.js');
const Replay = require('./scene-replay.js');
const render = require('./render.js');
const WAV = require('./wav.js');
const { clockFor, stageAt } = require('./recorded-presentation.js');
const { readNativeRun } = require('./story-audio.js');
const { readSceneAudio } = require('./scene-audio.js');
const { captions } = require('./story-performance.js');
const { readSheet } = require('./story-effects.js');
const { editorialTimeline, cueCSV } = require('./delivery-interchange.js');
const media = require('./story-editorial-media.js');

const format = 'ink-studio/story-editorial-handoff', planFormat = 'ink-studio/story-editorial-plan';
const usage = 'story handoff <recording|run-bundle> <plan.json> --out directory [--ffmpeg executable]';
const token = n => typeof n==='string' && n.trim().length>0 && n.length<=512;

function read(file) {
  if (fs.statSync(file).size>8*1024*1024) throw new RangeError('Handoff plan exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function prepare(P,raw) {
  const {fields,record,id,check}=P.musicInstruments;
  check(fields(raw,['format','version','id','title','soundtrack','picture','markers','dialogue','instruments'])&&
    raw.format===planFormat && raw.version===1 && id(raw.id) && token(raw.title ?? raw.id) &&
    token(raw.soundtrack) && (raw.markers===undefined||token(raw.markers)) &&
    fields(raw.picture??{},['fps','fromFrame','toFrame','width','height','video','effects']) &&
    (raw.dialogue===undefined || fields(raw.dialogue,['plan','assets']) && token(raw.dialogue.plan) &&
      record(raw.dialogue.assets??{}) && Object.keys(raw.dialogue.assets??{}).length<=128 &&
      Object.values(raw.dialogue.assets??{}).every(token)) &&
    (raw.instruments===undefined || fields(raw.instruments,['session','at'])&&token(raw.instruments.session)),
  'Expected a version 1 story editorial plan');
  return raw;
}
function session(P,id,clock,clips,assets) {
  const {frameRate:fps,fromFrame:startFrame,shots,rate:sampleRate}=clock;
  const session={format:'ink-studio/audio-editorial',version:1,id,sampleRate,
    picture:{fps,startFrame,shots:shots.map(row=>({id:row.id,frames:row.frames,inFrame:row.firstFrame}))},clips};
  P.mediaGraph.audioEditorial.inspect(session,assets.pcm);
  return {session,assets:assets.files};
}
function marker(clock,point,row) {
  const {T,from,to,firstSample,sample,frameOf}=clock;
  if (T.compare(point,from)<0||T.compare(point,to)>=0) return;
  const fromSample=sample(point), offsetSample=fromSample-firstSample;
  return {...row,time:T.pack(T.sub(point,from)),fromSample,toSample:fromSample,offsetSample,durationSamples:0,
    pictureFrame:frameOf(point),timeReference:String(fromSample)};
}
function picture(stage,clock,kit,recording,effects,ffmpeg) {
  const {T,take,fromFrame,toFrame,frameRate,width,height,rate}=clock, W=kit.KIT.world;
  const run=W.runtime.openRecording(recording), frames=[];
  let bytes=0;
  for (let frame=fromFrame;frame<toFrame;frame++) {
    const snapshot=take.at(frame), offset=frame-fromFrame;
    run.advance(snapshot.tick);
    const scene=W.visual(kit,run.view(),run.query(),{take:snapshot,eventEffects:effects});
    const image=render.resize(render.render(scene,{w:width,h:height,t:snapshot.start,take:snapshot,colored:true}),width,height);
    const png=PNG.encode(image.w,image.h,image.rgb);
    bytes+=png.length;
    if (bytes>Replay.maxReplayBytes) throw new RangeError('Handoff picture exceeds its PNG byte budget');
    const file='picture/frame-'+String(offset).padStart(6,'0')+'.png';
    stage.save(file,png);
    const timecode=T.pack(T.requireFrame(snapshot).start);
    frames.push({frame,offset,firstSample:snapshot.firstSample,endSample:snapshot.endSample,tick:snapshot.tick,timecode,shot:snapshot.shot,file});
  }
  let file;
  if (clock.video) {
    file='picture.mov';
    const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-framerate',
      frameRate.numerator+'/'+frameRate.denominator,'-start_number','0','-i',stage.at('picture/frame-%06d.png'),
      '-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-crf','15','-map_metadata','-1','-movflags','+faststart',
      stage.reserve(file)],{encoding:'utf8',maxBuffer:1024*1024});
    if (result.error||result.status!==0) throw new Error('Picture encoder failed: '+(result.error?.message??result.stderr.trim()));
  }
  stage.json('picture.json',{format:'ink-studio/editorial-picture',version:1,frameRate,width,height,sampleRate:rate,frames});
  return {fps:clock.fps,frameRate,width,height,fromFrame,toFrame,frameCount:clock.frameCount,
    shots:clock.shots,index:'picture.json',...(file&&{file})};
}

async function command(file,planFile,rest,opt,library) {
  if (!file||!planFile||rest.length||!token(opt.out)||opt.ffmpeg!==undefined&&!token(opt.ffmpeg)||
      Object.keys(opt).some(key=>!['out','ffmpeg'].includes(key))) throw new TypeError('Use '+usage);
  const kit=library(), K=kit.KIT, W=K.world, P=K.procedural, R=W.runtime;
  const inputs=new Set(), onFile=entry=>{const source=path.resolve(entry); inputs.add(source); return source;};
  const plan=prepare(P,read(onFile(planFile))), resolve=entry=>onFile(path.resolve(path.dirname(path.resolve(planFile)),entry));
  const recording=readNativeRun(onFile(file),kit,onFile), soundtrackFile=resolve(plan.soundtrack);
  const settings={kit,onFile,recordedOnly:true}, additions={assets:new Map(),tracks:[]};
  const soundtrack=readSceneAudio(soundtrackFile,{...settings,additions});
  const clock=clockFor(K,recording,plan.picture??{},soundtrack.sampleRate), {T,from,to,firstSample,endSample,rate}=clock;
  const markerPlan=plan.markers===undefined ? undefined : read(resolve(plan.markers));
  const timeline=await W.storySceneTimeline.replay(recording,{plan:markerPlan});
  const markers=timeline.markers.flatMap(row=>{
    const projected=marker(clock,T.read(row.time),{...row,kind:'story',role:'picture'});
    return projected ? [projected] : [];
  });
  const stage=stageAt(opt.out);
  try {
    const dialogue=await media.dialogue({settings:plan.dialogue,resolve,W,recording,clock,soundtrack,stage,additions});
    const instrument=media.instruments({settings:plan.instruments,resolve,onFile,P,clock,stage,additions});
    const mixed=readSceneAudio(soundtrackFile,{...settings,additions}).render({startPoint:from,endPoint:to},{
      runtime:()=>R.openRecording(recording),recordedThrough:recording.end.tick,trace:true
    });
    const stems={}, printed={}, clips=[];
    for (const [name,bytes] of Object.entries(mixed.waves)) {
      const pcm=WAV.decode(bytes), path='audio/'+name+'.wav';
      if (pcm.samples.length/pcm.channels!==endSample-firstSample) throw new RangeError('Handoff WAV differs from its picture clock');
      stage.save(path,media.wave(pcm,firstSample,(plan.title??plan.id)+' '+name));
      if (name==='mix') continue;
      stems[name]=path;
      printed[name]=pcm;
      if (mixed.report.stems[name].voices) clips.push(media.editorialClip(name,name,name,0,0,endSample-firstSample,endSample-firstSample));
    }
    for (const row of mixed.report.storyAudio.cues) {
      if (row.arrivalSample<firstSample||row.arrivalSample>=endSample) continue;
      const point=row.arrivalSample===row.onsetSample ? T.read(row.source.timecode) : T.div(T.read(row.arrivalSample),T.read(rate));
      const at=marker(clock,T.compare(point,from)<0 ? from : point,{id:'audio-'+(markers.length+1),label:row.cue,
        kind:'audio',role:row.bus,beatId:row.source.beatId,source:row.source,file:stems[row.bus]});
      if (at) markers.push(at);
    }
    markers.sort((a,b)=>a.offsetSample-b.offsetSample);
    const parts=instrument?.(markers);
    const picturePlan=picture(stage,clock,kit,recording,
      plan.picture?.effects===undefined ? undefined : readSheet(resolve(plan.picture.effects)),opt.ffmpeg??'ffmpeg');
    const length=endSample-firstSample, duration=T.pack(T.sub(to,from));
    stage.json('timeline.json',{duration,markers:markers.map(({id,label,time,category,beatId,source})=>{
      const {beatId:_,causes,...reference}=source;
      return {id,label,time,category:category??'audio',beatId,source:reference};
    })});
    stage.json('dialogue.json',{format:'ink-studio/actor-lettering',version:1,lines:dialogue.lines});
    stage.save('captions.vtt',captions(dialogue.lines,T));
    stage.json('audio-edit.json',session(P,plan.id,clock,clips,{files:stems,pcm:printed}));
    if (dialogue.clips.length) stage.json('dialogue-edit.json',session(P,plan.id,clock,dialogue.clips,{
      files:dialogue.assets,pcm:Object.fromEntries(additions.assets)
    }));
    stage.json('edit.otio',editorialTimeline({title:plan.title??plan.id,sampleRate:rate,frames:length,
      timeReference:String(firstSample),stems,cues:markers,picture:picturePlan,dialogue:dialogue.lines}));
    stage.json('cues.json',{sampleRate:rate,firstSample,cues:markers});
    stage.json('audio-report.json',mixed.report);
    stage.save('cues.csv',cueCSV(markers.map(row=>({...row,source:row.beatId}))));
    stage.json('handoff.json',{format,version:1,id:plan.id,title:plan.title??plan.id,world:recording.origin.world.id,
      clock:{from:T.pack(from),to:T.pack(to),duration,frameRate:clock.frameRate,sampleRate:rate,firstSample,endSample,
        simulationPeriod:T.pack(clock.period)},picture:picturePlan,audio:{mix:'audio/mix.wav',stems,editorial:'audio-edit.json',report:'audio-report.json'},
      timeline:'timeline.json',cues:'cues.json',cueSheet:'cues.csv',interchange:'edit.otio',dialogue:{lines:'dialogue.json',
        captions:'captions.vtt',...(dialogue.clips.length&&{editorial:'dialogue-edit.json'})},
      ...(parts&&{instruments:parts})});
    stage.publish(inputs);
  } finally {
    stage.close();
  }
}

module.exports={command,usage};
