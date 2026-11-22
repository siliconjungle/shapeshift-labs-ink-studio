/* Print the exposed studies and the Sill Lights cue with their portable recipes. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ink=require('../..');
const {exportSoundPack}=require('../../cli/music-sound-library.js');
const {production,row}=require('../native-sound-library/performances.cjs');

const out=path.resolve(process.argv[2] ?? 'sill-lights');
fs.mkdirSync(out,{recursive:true});
const at=name=>path.join(out,name);
const json=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value,null,2)+'\n');
const {KIT}=ink.load(), music=KIT.music.production, monitor=KIT.procedural.mediaGraph.mixerMonitor;
const direct='expressive-plate', reed='expressive-reed';
const assets={}, paths={}, patches={};
for (const id of ['breath-and-reed','struck-and-scraped-metal']) {
  const dir='packs/'+id, manifest=JSON.parse(fs.readFileSync(exportSoundPack(id,at(dir)),'utf8'));
  Object.assign(patches,manifest.patches);
  for (const [name,file] of Object.entries(manifest.assets)) {
    paths[name]=dir+'/'+file;
    assets[name]=ink.readWav(at(paths[name]));
  }
}
const raw=patches[reed];
patches.retriggered={...raw,performance:{...raw.performance,rules:raw.performance.rules.filter(rule=>!rule.recorded)}};

const quiet={pressure:.045,breath:.43};
const pressureSweep={breath:.47,curves:{pressure:[[0,.034],[.17,.07],[.48,.72],[.72,.91],[1,.18]]}};
const sustain=play=>({patch:reed,highpass:92,notes:[row(.32,64,5.8,.71,play)]});
const legato=[
  row(.3,67,.62,.66,{pressure:.83}),row(.945,72,.79,.63,{pressure:.81}),
  row(1.757,76,1.1,.62,{pressure:.79}),
  row(3.84,67,.67,.73,{pressure:.89}),row(4.528,60,1.75,.69,{pressure:.85}),
  row(6.3,62,.66,.57,{pressure:.73})
];
const reedTrack=(patch,notes)=>({patch,notes,highpass:94});
const plateTrack=notes=>({patch:direct,notes,highpass:170});
const taps=[.29,2.68,5.07,7.46,9.85].map((beat,i)=>
  row(beat,54,.11,[.21,.37,.56,.72,.88][i],{room:.26}));
const roomHit=room=>row(.27,54,2.6,.72,typeof room==='number' ? {room} : room);

const studies={};
function write(name, tracks, bars, ids, options={}) {
  const score=production(patches,tracks,bars,{gain:options.gain ?? -5,...(options.sections && {sections:options.sections})});
  if (options.roomGain!==undefined) score.room.gain=options.roomGain;
  const selected=Object.keys(paths).filter(key=>ids.some(prefix=>key.startsWith(prefix)));
  const sources=Object.fromEntries(selected.map(key=>[key,assets[key]]));
  const references=Object.fromEntries(selected.map(key=>[key,paths[key]]));
  const settings={sampleRate:32000,tail:options.tail ?? .25};
  const result=music.render(score,sources,settings);
  const meter=monitor.meter(result.value);
  assert.ok(meter.truePeakDbTP<-.35 && meter.integratedLufs!==null,name+' needs audible, unclipped audio');
  fs.writeFileSync(at(name+'.wav'),ink.encodeWav(result.value,{encoding:'pcm24'}));
  json(name+'.json',{production:score,assets:references,options:settings});
  studies[name]={frames:meter.frames,truePeakDbTP:meter.truePeakDbTP,integratedLufs:meter.integratedLufs};
  return music.inspect(score,sources);
}

const reedBank=['reed-'], plateBank=['metal-plate-'];
write('reed-air',{reed:sustain(quiet)},2,reedBank,{gain:1});
write('reed-pressure',{reed:sustain(pressureSweep)},2,reedBank,{gain:1});
write('reed-held',{reed:sustain({pressure:.86,breath:.47})},2,reedBank,{gain:1});
const joined=write('reed-joined',{reed:reedTrack(reed,legato)},2,reedBank,{gain:2});
write('reed-retriggered',{reed:reedTrack('retriggered',legato)},2,reedBank,{gain:2});
write('plate-force',{plate:plateTrack(taps)},3,plateBank,{gain:7});
write('plate-direct',{plate:plateTrack([roomHit(0)])},1,plateBank,{gain:7,tail:.65});
write('plate-between',{plate:plateTrack([roomHit(.5)])},1,plateBank,{gain:7,tail:.65});
write('plate-room',{plate:plateTrack([roomHit(1)])},1,plateBank,{gain:7,tail:.65});
write('plate-mic-ride',{plate:plateTrack([roomHit({curves:{room:[[0,0],[.07,0],[.58,1],[1,1]]}})])},
  1,plateBank,{gain:7,tail:.65});

patches.keys={type:'keys',tine:.43,bite:.18,dust:.015,wear:.16,drive:1.13,color:.44,
  env:{attack:.014,decay:.56,sustain:.17,release:.38}};
const lead=[
  row(.35,64,4.22,.57,pressureSweep),
  ...legato.slice(0,3).map(note=>({...note,beat:note.beat+5.18})),
  row(10.41,67,.72,.6,{pressure:.7}),row(11.151,60,2.23,.59,{pressure:.67,
    curves:{pressure:[[0,.75],[.66,.59],[1,.2]]}}),
  row(16.2,67,.82,.60,{pressure:.72}),row(17.044,72,.46,.71,{pressure:.86}),
  row(17.526,76,1.54,.66,{pressure:.83,curves:{pressure:[[0,.89],[.61,.61],[1,.32]]}}),
  row(20.06,74,.73,.53,{pressure:.68}),row(21.21,72,1.24,.64,{pressure:.63}),
  row(24.34,67,.76,.67,{pressure:.80}),row(25.118,60,2.01,.63,{pressure:.79,
    curves:{pressure:[[0,.86],[.46,.68],[1,.12]]}}),
  row(29.21,64,1.57,.44,pressureSweep)
];
const percussive=[
  [1.7,.29,.24],[4.71,.48,.34],[7.23,.64,.55],[9.99,.38,.65],[13.68,.56,.91],
  [15.62,.29,.12],[18.15,.83,.67],[19.74,.49,.53],[22.64,.67,.40],
  [24.09,.18,.22],[26.76,.79,.76],[28.92,.31,.91],[30.44,.38,.84]
].map(([beat,velocity,room])=>row(beat,54,.15,velocity,{room}));
const keys=[
  [2.14,40,1.64,.66],[4.32,47,.87,.49],[6.9,45,1.9,.56],[9.32,52,.83,.47],
  [10.72,43,2.15,.53],[14.85,40,.58,.44],[16.13,36,1.8,.68],[18.45,43,.66,.61],
  [19.58,38,1.6,.60],[21.8,45,.69,.51],[23.29,47,.66,.51],[25.17,40,2.58,.66],
  [29.91,52,1.13,.39]
].map(args=>row(...args));
write('sill-lights',{reed:{...reedTrack(reed,lead),pan:-.13,gain:1.8,send:.19},
  plate:{...plateTrack(percussive),pan:.17,gain:-5.5},keys:{notes:keys,pan:.06,gain:-12,send:.46,highpass:38}},
  8,[...reedBank,...plateBank],{gain:2,roomGain:-13,tail:.9,sections:[
    {id:'air',bars:2,harmony:'home'},{id:'pulse',bars:2,harmony:'home'},
    {id:'open',bars:2,harmony:'home'},{id:'return',bars:2,harmony:'home'}
  ]});
const bridges=joined.events.reed.filter(note=>note.performance?.recorded).map(note=>({
  articulation:note.play.articulation,arrival:note.time,start:note.start,lead:note.performance.attackLead
}));
assert.deepEqual(bridges.map(row=>row.articulation),['slur-g4-c5','slur-c5-e5','slur-g4-c4']);
json('report.json',{bridges,studies});
const live=JSON.parse(fs.readFileSync(at('sill-lights.json'),'utf8'));
json('live-session.json',{assets:live.assets,session:{format:'ink-studio/music-edit-session',version:1,
  id:'Sill-Lights',sampleRate:32000,production:live.production}});
json('live-loop.json',{from:{beat:0},to:{beat:8},preroll:false});
fs.copyFileSync(path.join(__dirname,'expressive-sampling.html'),at('index.html'));
process.stdout.write(out+'\n');
