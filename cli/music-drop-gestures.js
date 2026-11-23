const path = require('node:path');
const WAV = require('./wav.js');
const {write,json} = require('./asset-files.js');
const {capture} = require('./music-session-recording.js');
const {sampleBank} = require('./music-drop-studies.js');
const {dubstep} = require('../examples/music-production/drop-studies/sessions.cjs');
const study = require('../examples/music-production/drop-studies/gesture-takes.cjs');

function reel(audio,names,gapSeconds) {
  const {sampleRate,channels} = audio[names[0]];
  const gap = Math.round(gapSeconds*sampleRate);
  const total = names.reduce((frames,id)=>frames+audio[id].samples.length/channels,0) + gap*(names.length-1);
  const samples = new Float64Array(total*channels);
  const cues = [];
  let firstSample = 0;
  for (const id of names) {
    const {samples:clip} = audio[id];
    samples.set(clip,firstSample*channels);
    cues.push({id,title:study.labels[id],firstSample,endSample:firstSample+clip.length/channels});
    firstSample += clip.length/channels+gap;
  }
  return {value:{sampleRate,channels,samples},sampleRate,cues};
}

module.exports = function command(file,opt,kit) {
  if (file!==undefined || typeof opt.out!=='string') throw new TypeError('Use music production drop-gestures --out DIR');
  const out = path.resolve(opt.out), at = file=>path.join(out,file);
  const P = kit.KIT.procedural, session = dubstep();
  const {production,sampleRate} = session;
  const {lane,phrase,fromBeat,toBeat,takeNames,selections,labels} = study;
  const tempoMap = production.arrangement.score.tempoMap;
  const clock = P.musicTiming.compile(tempoMap);
  const mark = beat=>Math.round(clock.timeAt({beat})*sampleRate);
  const from = mark(fromBeat), to = mark(toBeat);
  const referencePatch = production.patches[production.tracks[lane].patch];
  const patches = study.sounds(referencePatch);
  Object.assign(production.patches,patches);
  const store = (file,pcm)=>write(at(file),WAV.encode(pcm,{encoding:'pcm24'}));
  const save = (file,value)=>json(at(file),value);

  const assetNames = [...new Set(Object.values(production.patches).flatMap(P.musicInstruments.assetNames))];
  const bank = sampleBank(false), files = {};
  const assets = Object.fromEntries(assetNames.map(id=>{
    files[id]='samples/'+id+'.wav';
    store(files[id],bank[id]);
    return [id,WAV.read(at(files[id]))];
  }));
  const scoreFile = (file,value)=>save(file,{session:value,assets:files});
  const editor = P.mediaGraph.musicSession.create(assets);
  const clip = production.tracks[lane].clips[0];
  const notes = clip.voices[0].notes.filter(note=>note.beat>=fromBeat && note.beat<toBeat);
  const captures = [], record = [];
  for (const [pass,take] of takeNames.entries()) {
    const {gesture,edits} = study.controllers(notes,take,clock,sampleRate,from,to);
    const meta = {id:String(pass+1).padStart(24,'0'),pass,from,to,lane,gesture};
    const recorded = capture(P,session,{sampleRate,loop:{from,to}},meta,Buffer.alloc(0),{});
    const [saved] = recorded.changes[0].revision.tracks[lane].phrases;
    captures.push({take,...meta});
    record.push({op:'record-phrase',lane,take,phrase:{...saved,id:phrase,notes:edits}});
  }

  const first = record[0].phrase.from, last = record[0].phrase.to;
  const sections = selections.map(({to, ...selection},i)=>({
    ...selection,from:i ? selections[i-1].to : first,to:to ?? last
  }));
  const comp = {op:'comp-phrase',lane,phrase,take:'kept',sections};
  const tracked = editor.edit(session,record);
  const kept = editor.edit(tracked,[comp]);
  const [played] = kept.takes.kept.tracks[lane].phrases;
  const variants = Object.keys(patches).map(take=>({op:'score-take',take,
    revision:{tracks:{[lane]:{patch:take,phrases:[played]}}}}));
  const complete = editor.edit(kept,variants);

  scoreFile('reference-session.json',session);
  scoreFile('kept-session.json',complete);
  save('capture-events.json',{sampleRate,from,to,mode:'authored-controller-replay',captures});
  save('record.json',record);
  save('comp.json',[comp]);
  save('sound-swaps.json',variants);

  const window = {from:{beat:3.5},to:{beat:20.5}};
  const level = {targetLufs:-15,ceilingDbTP:-1.5};
  const listen = {lane,phrase,...window,loudness:level};
  function audition(name,settings) {
    save(name+'-settings.json',settings);
    const {audio,report} = editor.auditionPhrase(complete,settings);
    const clips = Object.fromEntries(report.takes.map(id=>{
      const file = name+'/'+id+'.wav';
      store(file,audio[id]);
      return [id,file];
    }));
    const {value,...index} = reel(audio,report.takes,.45);
    store(name+'.wav',value);
    save(name+'/report.json',{...report,clips,reel:index});
    return {audio,report,clips,reel:index};
  }

  const keptName = 'kept';
  const performances = audition('performances',{...listen,takes:[...takeNames,keptName]});
  const sounds = audition('sounds',{...listen,reference:false,takes:[keptName,...Object.keys(patches)]});
  const {value:ab,...index} = reel(performances.audio,['reference',keptName],.55);
  store('reference-and-comp.wav',ab);
  const context = editor.render(complete).value;
  store('underbite-comp.wav',context);
  const focus = {range:window,tracks:[lane],searchMs:110};
  save('timing-focus.json',focus);
  save('timing.json',{reference:P.musicGrooveEditor.open(session,assets).inspect(focus),
    comp:P.musicGrooveEditor.open(complete,assets).inspect(focus)});

  const instruments = Object.fromEntries([['original',referencePatch],...Object.entries(patches)].map(([name,patch])=>{
    const file = 'instruments/'+name+'.json';
    save(file,patch);
    return [name,file];
  }));
  write(at('CREDITS.md'),'# Underbite audio credits\n\nThe acoustic snare comes from the CC0 Versilian Community Sample Library. '+
    'This study uses Legacy Snares / OldSnare takes snare_f1.wav, snare_f2.wav and snare_rim.wav.\n\n'+
    '[Source and license](https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e)\n');
  const manifest = {format:'ink-studio/drop-gestures',version:1,phrase,lane,sections,labels,instruments,
    reference:'reference-session.json',session:'kept-session.json',mix:'underbite-comp.wav',
    files:{performances:'performances/report.json',sounds:'sounds/report.json',timing:'timing.json',
      capture:'capture-events.json',edits:['record.json','comp.json','sound-swaps.json']},
    reels:{'reference-and-comp':{file:'reference-and-comp.wav',...index,loudness:performances.report.loudness},
      performances:{file:'performances.wav',...performances.reel},sounds:{file:'sounds.wav',...sounds.reel}}};
  save('manifest.json',manifest);
  process.stdout.write(JSON.stringify({manifest:at('manifest.json'),takes:takeNames,comp:at('kept-session.json')})+'\n');
  return manifest;
};
