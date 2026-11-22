/* Place dialogue and performed instrument notes on the handoff's sample clock. */
const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const Midi = require('./handoff-midi.js');
const { sumVoices } = require('./scene-audio-mix.js');
const { readAssets } = require('./music-mixer.js');

function read(file) {
  if (fs.statSync(file).size>8*1024*1024) throw new RangeError('Handoff editorial source exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function description(text) {
  return text.replace(/[^ -~]/gu,'?').slice(0,256);
}
function wave(pcm, first, label) {
  return WAV.encode(pcm,{encoding:'pcm24',bwf:{timeReference:first,description:description(label)}});
}
function editorialClip(id, track, asset, offset, from, to, length) {
  return {id,track,spot:{samples:offset},take:'source',takes:{
    source:{asset,sync:{sample:from},fromSample:from,toSample:to,handles:{fromSample:0,toSample:length}}
  }};
}
function printVoice(source, { first, end, rate, id, gain = 1 }, place = 0) {
  return sumVoices([{stem:id,asset:id,first:place,gain}],()=>source,{start:first,end,sampleRate:rate},[id]).stems.get(id);
}

async function dialogue({settings, resolve, W, recording, clock, soundtrack, stage, additions}) {
  if (!settings) return {lines:[],clips:[],assets:{}};
  const {T,from,to,rate,firstSample,endSample,sample} = clock;
  const sheet = await W.actorPerformance.replay(recording,read(resolve(settings.plan)));
  const rules = new Map(sheet.presentationCues.cues.map(cue=>[cue.id,cue.rule]));
  const { dialogue: authored } = W.actorPerformance.open(sheet);
  const sources = new Map(), clips=[], lines=[], assets={};
  for (const line of authored) {
    const start=T.read(line.timecode), stop=T.read(line.endTimecode);
    if (T.compare(start,to)>=0) continue;
    const localStart=T.sub(T.compare(start,from)<0 ? from : start,from);
    const localStop=T.sub(T.compare(stop,to)>0 ? to : stop,from);
    const { timecode:originalTimecode,endTimecode:originalEndTimecode,...detail } = line;
    const row={...detail,time:T.seconds(localStart),end:T.seconds(localStop),timecode:T.pack(localStart),
      endTimecode:T.pack(localStop),originalTimecode,originalEndTimecode};
    if (T.compare(stop,from)>0) lines.push(row);
    const rule=rules.get(line.id);
    const source=Object.hasOwn(settings.assets ?? {},rule) ? settings.assets[rule] : undefined;
    if (source===undefined) continue;
    if (!sources.has(source)) {
      const raw=soundtrack.asset(source), length=Math.ceil(raw.samples.length/raw.channels*rate/raw.sampleRate);
      if (length<1) throw new RangeError('Dialogue source is empty: '+source);
      const id='handoff-voice-'+(sources.size+1);
      const pcm={sampleRate:rate,channels:2,samples:printVoice(raw,{first:0,end:length,rate,id})};
      sources.set(source,{id,pcm,length});
      additions.assets.set(id,pcm);
    }
    const {id,pcm,length}=sources.get(source), at=sample(start), lineLength=Math.min(length,sample(stop)-at);
    if (lineLength<=0) continue;
    additions.tracks.push({asset:id,time:{numerator:at,denominator:rate},duration:{numerator:lineLength,denominator:rate},
      bus:'dialogue'});
    const placed=Math.max(firstSample,at), inSample=placed-at;
    const count=Math.min(lineLength-inSample,endSample-placed);
    if (count<=0) continue;
    if (!Object.hasOwn(assets,id)) {
      assets[id]='audio/voices/'+id+'.wav';
      stage.save(assets[id],wave(pcm,0,'Dialogue source'));
    }
    const local=placed-firstSample;
    const clip=editorialClip(line.id,'dialogue',id,local,inSample,inSample+count,length);
    clips.push(clip);
    Object.assign(row,{clip:{asset:id,file:assets[id],firstSample:placed,offsetSample:local,
      sourceIn:inSample,durationSamples:count,sourceSamples:length}});
  }
  return {lines,clips,assets};
}

function instruments({settings, resolve, onFile, P, clock, stage, additions}) {
  if (!settings) return;
  const file=resolve(settings.session), recipe=read(file), assets=recipe.assets ?? {};
  const pcm=readAssets(assets,file,P), {session}=recipe;
  const {T,rate,firstSample,endSample,sample,frameCount} = clock, frames=endSample-firstSample;
  const inkAssets=Object.fromEntries(Object.entries(assets).map(([id,ref])=>{
    const input=onFile(path.resolve(path.dirname(file),ref)), output='ink/assets/'+id+'.wav';
    stage.save(output,fs.readFileSync(input));
    return [id,'assets/'+id+'.wav'];
  }));
  stage.json('ink/instruments.json',{session,assets:inkAssets});
  const take=P.mediaGraph.musicSession.create(pcm).handoff(session), master='handoff-instruments';
  const at=T.read(settings.at ?? 0), start=sample(at);
  if (start<0) throw new RangeError('Instrument session needs a nonnegative placement');
  additions.assets.set(master,take.value);
  additions.tracks.push({asset:master,time:T.pack(at),bus:'music'});
  const {plan}=take, native=n=>T.add(at,T.div(T.read(n),T.read(plan.sampleRate)));
  const convert=n=>sample(native(n));
  const tracks=Object.fromEntries(Object.entries(plan.tracks).map(([name,row])=>{
    const notes=row.notes.flatMap(note=>{
      const inSample=convert(note.startSample), outSample=convert(note.endSample);
      const begin=Math.max(firstSample,inSample), end=Math.min(endSample,outSample);
      if (end<=begin) return [];
      const held=new Map(), expression=[];
      for (const point of note.expression) {
        const at=convert(point.sample);
        if (at<begin) held.set(point.type,point.value);
        else if (at<end) expression.push({...point,sample:at-firstSample});
      }
      const startSample=begin-firstSample;
      return [{...note,startSample,endSample:end-firstSample,inSample,outSample,
        expression:[...Array.from(held,([type,value])=>({type,value,sample:startSample})),...expression]}];
    });
    return [name,{takes:row.takes,notes}];
  }));
  const tempo=[{seconds:0,tempo:plan.tempo[0].tempo}];
  for (const change of plan.tempo) {
    const seconds=(sample(T.add(at,T.read(change.seconds)))-firstSample)/rate;
    if (seconds<=0) tempo[0].tempo=change.tempo;
    else if (seconds<frames/rate) tempo.push({seconds,tempo:change.tempo});
  }
  const stems=Object.fromEntries(Object.entries(take.stems).map(([name,source])=>{
    const gain=plan.stemGains[name], file='audio/instruments/'+name+'.wav';
    const samples=printVoice(source,{first:firstSample,end:endSample,rate,id:name},start);
    stage.save(file,wave({sampleRate:rate,channels:2,samples},firstSample,name));
    return [name,{file,gain}];
  }));
  return markers=>{
    const midiPlan={id:plan.id,sampleRate:rate,frames,scoreFrames:frames,beatsPerBar:plan.beatsPerBar,tempo,tracks,
      markers:markers.map(row=>({id:row.label,seconds:row.offsetSample/rate}))};
    const midi=Midi.compile(midiPlan);
    stage.save('notes.mid',Midi.encode(midiPlan,midi));
    stage.json('parts.json',{format:'ink-studio/story-instrument-parts',version:1,sampleRate:rate,firstSample,frames,frameCount,
      placement:T.pack(at),sourceSampleRate:plan.sampleRate,tempo,beatsPerBar:plan.beatsPerBar,tracks,stems,midi:{file:'notes.mid',ppq:midi.ppq,notices:midi.notices}});
    return {source:'ink/instruments.json',parts:'parts.json',midi:'notes.mid',stems};
  };
}

module.exports = { wave, dialogue, instruments, editorialClip };
