/* Rebuild the CLI listening session with node examples/music-production/mix-tools.cjs output-directory. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),ink=require('../..');
const {write,json}=require('../../cli/asset-files'),WAV=require('../../cli/wav');
const {describe}=require('../../cli/music-sound-library');
const {production,row}=require('../native-sound-library/performances.cjs');
const racks=require('../audio-racks/production-tools.cjs');
const out=path.resolve(process.argv[2] ?? 'return-signal'),at=name=>path.join(out,name);
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music',...args],{encoding:'utf8'}));
const sampleRate=48000,tempo=115;
const {patches,sources}=describe('drums-and-bass'),{KIT}=ink.load();
const chord=(beat,notes,length,velocity)=>notes.map(n=>row(beat,n,length,velocity));
patches.keys={type:'keys',tine:.64,bite:.76,wear:.22,dust:.009,drive:1.3,color:.70,
  env:{attack:.005,decay:.39,sustain:.33,release:.18}};
const chords=[chord(.36,[50,57,60,65,69],.57,.8),chord(1.72,[53,57,62,65],.41,.69),
  chord(2.73,[48,55,58,62,65],.35,.58),chord(4.27,[48,55,58,62,67],.67,.84),
  chord(5.7,[55,58,62,67],.37,.59),chord(7.07,[53,57,60,64],.40,.73)];
const score=production(patches,{
  kick:{notes:[0,1.46,2.57,3.64,4,5.46,6.70].map((b,i)=>row(b,36,.16,[.95,.73,.90,.60,.98,.77,.91][i])),
    gain:-4,highpass:26},
  snare:{notes:[1.04,2.31,3.04,5.05,6.44,7.04].map((b,i)=>row(b,38,.15,[.87,.28,.81,.92,.26,.83][i])),
    gain:-12,pan:.08,highpass:115},
  'closed-hat':{notes:[.48,1.49,2.06,2.53,3.52,4.49,5.51,6.07,6.53,7.51].map((b,i)=>
    row(b,42,.10,.32+.05*(i%4))),gain:-20,pan:-.26,highpass:1100},
  bass:{patch:'electric-bass',notes:[[.055,38,.72],[1.50,38,.37],[2.60,45,.53],[3.66,41,.23],
    [4.055,36,.76],[5.50,36,.31],[6.75,43,.57]].map(([b,n,l])=>row(b,n,l,.86)),gain:-4,highpass:34},
  keys:{notes:chords.flat(),gain:-6,pan:.19,highpass:85}
},2);
score.tracks.keys.clips[0].voices=Array.from({length:5},(_,i)=>({id:'voice-'+i,notes:chords.flatMap(
  (notes,j)=>notes[i] ? [{...notes[i],id:'key-'+j+'-'+i}] : [])}));
score.arrangement.score.tempoMap={tempo,swing:.539};
const assets=Object.fromEntries([...new Set(Object.values(score.patches).flatMap(KIT.procedural.musicInstruments.assetNames))]
  .map(id=>[id,WAV.read(sources[id].file)]));
const {stems}=KIT.music.production.render(score,assets,{sampleRate,stems:true});
const save=(name,pcm)=>write(at(name),WAV.encode(pcm,{encoding:'pcm24'}));
const blend=(parts,gain=1,from=0,to=stems.keys.samples.length/2)=>{
  const samples=new Float64Array(2*(to-from));
  for (const [name,level] of Object.entries(parts)) {
    const source=stems[name].samples;
    for (let i=0;i<samples.length;i++) samples[i]+=source[2*from+i]*level*gain;
  }
  const peak=samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0);
  if (peak>.96) for (let i=0;i<samples.length;i++) samples[i]*=.96/peak;
  return {samples,sampleRate,channels:2};
};
for (const [id,parts] of Object.entries({drums:{kick:1,snare:.81,'closed-hat':.79},keys:{keys:1},bass:{bass:1},
  'room-hit':{snare:1,keys:.62}})) {
  // A single rim and the end of its chord leave silence for the room's decay.
  const bounds=id==='room-hit' ? [Math.round(.48*sampleRate),Math.round(1.23*sampleRate)] : [];
  const cue=blend(parts,id==='drums' ? 2.3 : 1,...bounds);
  if (id==='room-hit') {
    const fade=Math.round(.016*sampleRate), frames=cue.samples.length/2;
    for (let i=0;i<frames;i++) {
      const envelope=Math.min(1,i/fade,(frames-1-i)/fade);
      cue.samples[2*i]*=envelope;
      cue.samples[2*i+1]*=envelope;
    }
  }
  save('sources/'+id+'.wav',cue);
}
const credits=path.resolve(__dirname,'../audio-racks/rooms');
for (const file of fs.readdirSync(credits)) write(at('rooms/'+file),fs.readFileSync(path.join(credits,file)));
const choices=['keys','drums','bass','room-hit','room-hit','room-hit'];
const prints=racks.map((rack,i)=>{
  const {id}=rack;
  json(at(id+'.rack.json'),rack);
  const macros=i===0 ? {'low-mid':.95,presence:.83} : i===1 ? {drive:.72,ceiling:.49,knee:.12} :
    i===2 ? {drive:.86,tone:.92,bias:.54} : {amount:.88};
  json(at(id+'.json'),{assets:{main:'sources/'+choices[i]+'.wav'},state:{macros},
    options:{sampleRate,targetLufs:-19,ceilingDbTP:-1}});
  const files=run('rack','audition',at(id+'.rack.json'),at(id+'.json'),'--out',at('prints/'+id));
  return {id,title:rack.title,files,report:JSON.parse(fs.readFileSync(files.report,'utf8'))};
});
const processor=racks[0].processors.process;
json(at('in-context.json'),{assets:Object.fromEntries(['keys','drums','bass'].map(id=>[id,'sources/'+id+'.wav'])),
  mixer:{id:'return-signal',sampleRate,map:{tempo},end:{beat:8},tail:'cut',output:'master',
    strips:{
      drums:{clips:[{id:'loop',source:'drums',gainDb:-10}],output:'master'},
      bass:{clips:[{id:'line',source:'bass',gainDb:-2}],output:'master'},
      keys:{clips:[{id:'chords',source:'keys'}],inserts:[{processor:'carve',sidechain:{strip:'bass',tap:'pre'}}]},
      master:{}
    },processors:{carve:{...processor,bands:[{mode:'low-shelf',hz:340,q:.68,keyHz:140,keyQ:.77,
      thresholdDb:-45,direction:'cut',ratio:6,rangeDb:13,attack:.007,release:.14}]}}}});
const context=run('mix','audition',at('in-context.json'),'--strip','keys','--insert','carve','--out',at('prints/in-context'));
const seconds=frames=>(frames/sampleRate).toFixed(2)+'s';
function sequence(name,entries) {
  const gap=2*Math.round(.32*sampleRate);
  const clips=entries.map(({file})=>WAV.read(file));
  const samples=new Float64Array(clips.reduce((n,x)=>n+x.samples.length,0)+gap*(clips.length-1));
  let offset=0;
  const index=clips.map(({samples:clip},i)=>{
    samples.set(clip,offset);
    const line=seconds(offset/2)+'  '+entries[i].title;
    offset+=clip.length+gap;
    return line;
  });
  save(name,{samples,channels:2,sampleRate});
  return index;
}
const ab=entries=>entries.flatMap(({title,files})=>[
  {title:title+' / bypass',file:files.bypass},{title:title+' / processed',file:files.rack}]);
const rooms=prints.slice(3), comparisons=sequence('return-signal.wav',ab(prints.slice(0,3)));
const spaces=sequence('three-rooms.wav',[{title:'Dry cue',file:rooms[0].files.bypass},
  ...rooms.map(({title,files})=>({title,file:files.rack}))]);
const full=sequence('in-context.wav',[{title:'Bypass',file:context.bypass},{title:'Keyed EQ',file:context.processed}]);
const meter=KIT.procedural.mediaGraph.mixerMonitor.meter;
for (const {files} of [...prints,{files:{...context,rack:context.processed}}]) {
  const [bypass,wet,difference,effect]=['bypass','rack','difference','effect'].map(name=>WAV.read(files[name]));
  const a=meter(bypass),b=meter(wet);
  assert(Math.abs(a.integratedLufs-b.integratedLufs)<.06 && Math.max(a.truePeakDbTP,b.truePeakDbTP)<-.99);
  assert(wet.samples.every((x,i)=>Math.abs(x-bypass.samples[i]-difference.samples[i])<3e-7));
  assert(meter(effect).rmsDbFS>-70,'The processor should leave an audible difference in this example');
}
write(at('README.txt'),[
  'Return Signal', '', 'return-signal.wav',...comparisons,
  '', 'three-rooms.wav',...spaces,'','in-context.wav',...full,
  '', 'In context, the bass keys a low shelf on the electric keys.',
  'In each prints/ folder, difference.wav subtracts the matched bypass from the matched processed take.',
  'effect.wav subtracts the unlevelled bypass at the original mix gains, with only peak protection.',
  'The room effect.wav prints isolate the reflections. The room captures and their credits are in rooms/.',
  '', 'Reproduce these comparisons from this folder with Ink Studio',
  '  ink-studio music rack audition dynamic-eq.rack.json dynamic-eq.json --out my-eq',
  '  ink-studio music rack audition lady-chapel.rack.json lady-chapel.json --out my-room',
  '  ink-studio music mix audition in-context.json --strip keys --insert carve --out my-mix',
  ''
].join('\n'));
console.log(JSON.stringify({out,comparisons,spaces,full,takes:prints.map(({id,report})=>
  ({id,lufs:report.matchingLufs,frames:report.frames}))},null,2));
