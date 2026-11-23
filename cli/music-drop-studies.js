const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const {write,json} = require('./asset-files.js');
const studies = require('../examples/music-production/drop-studies/sessions.cjs');

const workshop = path.resolve(__dirname,'../examples/music-production');
const recordings = path.resolve(workshop,'../native-sound-library/recordings');
const titles = {dnb:'Stairwell',dubstep:'Underbite',rave:'Arc Lamp'};
const sampleFiles = {
  'kick-hard-a':path.join(recordings,'rhythm-kick-hard-a.wav'),
  'kick-hard-b':path.join(recordings,'rhythm-kick-hard-b.wav'),
  ...Object.fromEntries(['snare-main','snare-alt','snare-rim']
    .map(name=>[name,path.join(workshop,'samples',name+'.wav')]))
};
const playable = {dnb:{reese:'reese'},dubstep:{vowel:'vowel',growl:'growl'},rave:{lead:'supersaw'}};
const displayOrder = ['dnb','dubstep','rave'];
const gain = db => 10 ** (db/20);

function sampleBank(includeBreak) {
  const assets = Object.fromEntries(Object.entries(sampleFiles).map(([name,file])=>[name,WAV.read(file)]));
  if (includeBreak) {
    const recording = WAV.read(path.join(workshop,'drop-studies/played-break.wav'));
    const frames = recording.samples.length / (4*recording.channels);
    if (recording.channels!==2 || !Number.isInteger(frames) || frames===0)
      throw new RangeError('The played break needs four equal stereo slices');
    for (let index=0; index<4; index++) {
      const offset = 2*frames*index;
      assets['break-'+(index+1)] = {...recording,samples:recording.samples.slice(offset,offset+2*frames)};
    }
  }
  return assets;
}

function writeAudio(file,audio) {
  write(file,WAV.encode(audio,{encoding:'pcm24'}));
}

function printSession(editor,monitor,out,session,assets) {
  const {value,report} = editor.render(session);
  const meter = monitor.meter(value);
  writeAudio(path.join(out,'mix.wav'),value);
  json(path.join(out,'session.json'),{session,assets});
  json(path.join(out,'mix-report.json'),{measurements:meter,render:report});
  return meter;
}

function auditionDrums(P,editor,monitor,out,original,assets,references) {
  const {focus,dnbVariants,dnbDrums} = studies;
  const range = {from:{beat:0},to:{beat:48}};
  const pair = {...focus,range};
  const editorFor = session => P.musicGrooveEditor.open(session,assets);
  const target = [[0,21],[8,18],[16,21],[24,15],[36,20],[48,21]];
  const {value:aligned,report:adjustment} = editorFor(original).edit({...pair,
    edits:[{op:'gap',metric:'audible',targetMs:target}]});
  // Keep the split sub and Reese on the same triggers while moving their attacks as a unit.
  aligned.production.tracks.reese.timingEdits = aligned.production.tracks.bass.timingEdits.map(edit=>({
    ...edit,at:{...edit.at,clip:'reese-phrase'}
  }));
  json(path.join(out,'kick-bass-focus.json'),focus);
  json(path.join(out,'kick-bass-adjustment.json'),adjustment);

  const auditionFolder = path.join(out,'auditions');
  const auditionAssets = Object.fromEntries(Object.entries(references).map(([name,file])=>
    [name,path.relative(auditionFolder,path.resolve(out,file))]));
  const candidates = dnbVariants.map(spec=>{
    const session = structuredClone(aligned);
    const {production} = session;
    production.patches.kick = dnbDrums[spec.kick];
    production.patches.snare = dnbDrums[spec.snare];
    // Trim candidate input before the shared mixer and key detector.
    production.tracks.kick.gain += spec.kickDb;
    production.tracks.snare.gain += spec.snareDb;
    // Main backing, routes and clock stay fixed. Only the two named patch slots can change.
    const {value} = editor.render(session,focus.range);
    const measurements = monitor.meter(value);
    const timing = editorFor(session).inspect(focus);
    return {spec,session,value,measurements,timing};
  });

  if (candidates.some(({measurements})=>measurements.integratedLufs===null))
    throw new RangeError('Each drum audition needs audible programme material');
  const targetLufs = Math.min(-15,...candidates.map(({measurements})=>
    measurements.integratedLufs - measurements.truePeakDbTP - 1.5));
  const results = candidates.map(({spec,session,value,measurements,timing})=>{
    const trimDb = targetLufs-measurements.integratedLufs;
    const print = {...value,samples:value.samples.map(sample=>sample*gain(trimDb))};
    const report = monitor.meter(print);
    const filename = spec.id+'.wav';
    writeAudio(path.join(auditionFolder,filename),print);
    json(path.join(auditionFolder,spec.id+'.json'),{session,assets:auditionAssets});
    json(path.join(auditionFolder,spec.id+'-timing.json'),timing);
    return {id:spec.id,title:spec.title,kick:spec.kick,snare:spec.snare,
      kickInputDb:spec.kickDb,snareInputDb:spec.snareDb,trimDb,...report,
      audition:'auditions/'+filename,session:'auditions/'+spec.id+'.json',
      timing:'auditions/'+spec.id+'-timing.json'};
  });
  json(path.join(out,'audition-report.json'),{range:focus.range,targetLufs,comparison:results,selection:dnbVariants[0].id});
  const late = editor.render(original,focus.range).value;
  const adjusted = candidates[0].value;
  const timingPair = monitor.compare({value:late},{value:adjusted},{targetLufs:-15,ceilingDbTP:-1.5});
  writeAudio(path.join(out,'kick-bass-late.wav'),timingPair.bypass);
  writeAudio(path.join(out,'kick-bass-aligned.wav'),timingPair.value);
  json(path.join(out,'kick-bass-late.json'),{session:original,assets:references});
  return {session:aligned,auditionCount:results.length};
}

module.exports = function command(id,opt,kit) {
  if (id!==undefined && !Object.hasOwn(titles,id)) throw new RangeError('Choose dnb, dubstep or rave');
  if (typeof opt.out!=='string') throw new TypeError('Use music production drop-studies [dnb|dubstep|rave] --out DIR');
  const root = path.resolve(opt.out);
  const P = kit.KIT.procedural;
  const {musicSession,mixerMonitor} = P.mediaGraph;
  const ids = id===undefined ? displayOrder : [id];
  const bank = sampleBank(ids.includes('dnb'));
  const manifest = ids.map(key=>{
    const out=path.join(root,key);
    const original=studies[key]();
    const patches=Object.values(original.production.patches).concat(key==='dnb' ? Object.values(studies.dnbDrums) : []);
    const names=[...new Set(patches.flatMap(patch=>P.musicInstruments.assetNames(patch)))].sort();
    const assets=Object.fromEntries(names.map(name=>[name,bank[name]]));
    const references=Object.fromEntries(names.map(name=>[name,'../samples/'+name+'.wav']));
    for (const [name,audio] of Object.entries(assets)) writeAudio(path.resolve(out,references[name]),audio);
    const editor=musicSession.create(assets);
    const {session,auditionCount} = key==='dnb' ?
      auditionDrums(P,editor,mixerMonitor,out,original,assets,references) : {session:original};
    const measurements = printSession(editor,mixerMonitor,out,session,references);
    const instruments = Object.fromEntries(Object.entries(playable[key]).map(([slot,name])=>{
      const file = key+'/instruments/'+name+'.json';
      json(path.join(root,file),session.production.patches[slot]);
      return [name,file];
    }));
    return {id:key,title:titles[key],session:key+'/session.json',mix:key+'/mix.wav',instruments,
      report:key+'/mix-report.json',measurements,
      ...(auditionCount && {comparison:key+'/audition-report.json',auditionCount})};
  });
  const manifestFile = path.join(root,'manifest.json');
  json(manifestFile,{format:'ink-studio/drop-studies',version:1,studies:manifest});
  write(path.join(root,'CREDITS.md'),fs.readFileSync(path.join(workshop,'drop-studies/CREDITS.md')));
  process.stdout.write(JSON.stringify({manifest:manifestFile,studies:manifest.map(row=>row.id)})+'\n');
  return manifest;
};
module.exports.sampleBank = sampleBank;
