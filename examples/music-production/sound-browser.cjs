/* A portable session for auditioning kick changes through a live bass sidechain. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ink=require('../..');
const {createSoundBrowser}=require('../../cli/music-sound-browser.js');
const {describe}=require('../../cli/music-sound-library.js');
const {production,row}=require('../native-sound-library/performances.cjs');
const rate=32000;
const loop={from:{beat:0},to:{beat:16},preroll:false};
const kickRows=[
  [[.12,.91],[1.53,.68],[2.66,.83],[3.68,.65]],
  [[.06,.88],[1.75,.67],[2.93,.84]],
  [[.10,.92],[1.59,.63],[2.74,.84],[3.55,.64]],
  [[.07,.89],[1.30,.69],[2.53,.82],[3.48,.71]]
];
const roots=[29,29,32,27];
const hits=(midi,duration,bars)=>bars.flatMap((notes,bar)=>notes.map(([beat,velocity])=>row(bar*4+beat,midi,duration,velocity)));
const bass=roots.flatMap((midi,bar)=>[
  row(bar*4+.04,midi,2.34,.82),row(bar*4+2.51,midi+12,.26,.52),
  row(bar*4+2.83,midi,1.1,.8)
]);
const hats=hits(42,.1,Array.from({length:4},(_,bar)=>
  Array.from({length:6},(_,step)=>[[.48,1.026,1.49,2.524,3.04,3.53][step],.28+.25*((bar+step*3)%7)/7])));
const snares=hits(38,.13,Array.from({length:4},(_,bar)=>[[1.04,.82],[3.035,.86],[bar===3 ? 2.78 : 2.44,.25]]));
const keys=[
  row(.77,65,.44,.74),row(2.19,60,.21,.54),row(2.21,68,.30,.64),row(3.61,70,.21,.5),
  row(5.53,60,.40,.53),row(5.55,67,.41,.62),row(7.6,63,.23,.44),
  row(8.76,68,.44,.61),row(9.84,63,.25,.53),row(10.30,70,.29,.6),row(10.32,65,.32,.5),
  row(12.77,67,.52,.76),row(14.29,62,.23,.52),row(14.31,65,.26,.53),row(15.57,60,.39,.56)
];

function fixture(sampleRate=rate) {
  const score=production({
    rubber:{type:'drum',kind:'kick',tune:49,decay:.18,sweep:37,click:.025,color:.28},
    bass:{type:'analog',body:.61,ratio:1,drive:1.02,env:{attack:.012,decay:.15,sustain:.88,release:.12}},
    snare:{type:'drum',kind:'snare',tune:167,decay:.22,click:.58,color:.64},
    'closed-hat':{type:'drum',kind:'hat',tune:780,decay:.092,click:.49,color:.64},
    keys:{type:'keys',tine:.46,bite:.19,dust:.016,drive:1.04,env:{attack:.009,decay:.64,sustain:.21,release:.31}}
  },{
    kick:{patch:'rubber',notes:hits(36,.14,kickRows),gain:-8,highpass:27},
    bass:{notes:bass,gain:-10,highpass:35,lowpass:950},
    snare:{notes:snares,gain:-18,pan:.12,highpass:130,send:.26},
    'closed-hat':{notes:hats,gain:-25,pan:-.31,highpass:2300,send:.15},
    keys:{notes:keys,gain:-16,pan:.18,send:.43,highpass:115}
  },4,{gain:4});
  score.arrangement.score.tempoMap.tempo=116;
  const [clip]=score.tracks.keys.clips, {notes}=clip.voices[0], harmony=new Set([2,5,10,13]);
  clip.voices=[
    {id:'keys',notes:notes.filter((_,i)=>!harmony.has(i))},
    {id:'harmony',notes:notes.filter((_,i)=>harmony.has(i))}
  ];
  return {format:'ink-studio/music-edit-session',version:1,id:'Backpressure',sampleRate,production:score,
    mixer:{output:'master',strips:{master:{fader:1},kick:{output:'drums'},snare:{output:'drums'},
      'closed-hat':{output:'drums'},drums:{output:'master'},
      bass:{inserts:[{processor:'kick-key',sidechain:{strip:'kick',tap:'pre'}}]}},
      processors:{'kick-key':{type:'compressor',thresholdDb:-31,ratio:8,attack:.002,release:.14}},
      taps:{'kick-key':{strip:'kick',tap:'pre'},'bass-before':{strip:'bass',tap:'input'},bass:{strip:'bass',tap:'post'}}}};
}

function publish(directory) {
  const out=path.resolve(directory);
  fs.mkdirSync(out,{recursive:true});
  const at=name=>path.join(out,name);
  const json=(name,data)=>fs.writeFileSync(at(name),JSON.stringify(data,null,2)+'\n');
  const {KIT}=ink.load(), P=KIT.procedural, M=P.mediaGraph;
  const source=fixture(), editor=M.musicSession.create(), browser=createSoundBrowser(P,{},{});
  const settings={...loop,fadeSamples:0}, base=editor.open(source,settings);
  const span={from:{samples:base.state().loop.from},to:{samples:base.state().loop.to}};
  const switches=[['rubber',null],['acoustic','stock-kick'],['circuit','circuit-kick'],['low','low-kick']];
  const mixReport={}, candidates={};
  for (const [name,id] of switches) {
    const transport=editor.open(source,settings);
    const choice={lane:'kick',source:'reference',id};
    if (id) {
      const entry=browser.candidate(source,choice);
      candidates[name]=entry;
      const additions=Object.fromEntries(entry.additions.map(row=>[row.name,row.pcm]));
      const {range,material}=editor.prepareSound(source,{lane:'kick',revision:entry.revision,...span},additions);
      transport.setSound({...choice,...range,material});
    }
    const frames=base.state().loop.to, samples=new Float32Array(frames*2), bass=new Float32Array(frames*2);
    for (let i=0;i<frames;i+=4096) {
      const part=transport.pull(Math.min(4096,frames-i),{taps:true});
      samples.set(part.value.samples,i*2);
      bass.set(part.taps.bass.samples,i*2);
    }
    const mix={sampleRate:rate,channels:2,samples}, bassTap={...mix,samples:bass};
    const meter=M.mixerMonitor.meter(mix), low=M.mixerMonitor.meter(bassTap);
    assert.ok(meter.truePeakDbTP<-1 && meter.integratedLufs>-28);
    for (const [label,audio] of [[name,mix],[name+'-bass',bassTap]])
      fs.writeFileSync(at(label+'.wav'),ink.encodeWav(audio,{encoding:'pcm24'}));
    mixReport[name]={integratedLufs:meter.integratedLufs,peak:meter.truePeakDbTP,bassLufs:low.integratedLufs};
  }
  const {revision,additions}=candidates.acoustic, assetPaths={};
  fs.mkdirSync(at('samples'),{recursive:true});
  const {credits,sources}=describe('drums-and-bass');
  const shipped={};
  for (const {name,file,pcm} of additions) {
    const relative='samples/'+path.basename(file);
    fs.copyFileSync(file,at(relative));
    assetPaths[name]=relative;
    editor.addAsset(name,pcm);
    const {credit,original}=Object.values(sources).find(row=>row.file===file);
    shipped[relative]={credit,original};
  }
  const winner=editor.edit(source,[
    {op:'score-take',take:'acoustic-kick',revision},
    {op:'comp',lane:'kick',take:'acoustic-kick',...span}
  ]);
  const example=additions.find(row=>row.name.includes('hard-a'));
  fs.copyFileSync(example.file,at('kick-example.wav'));
  shipped['kick-example.wav']=shipped[assetPaths[example.name]];
  json('session.json',{session:source});
  json('loop.json',loop);
  json('kept-session.json',{session:winner,assets:assetPaths});
  json('sample-credits.json',{credits:Object.fromEntries(Object.entries(credits)
    .filter(([name])=>Object.values(shipped).some(row=>row.credit===name))),sources:shipped});
  json('report.json',{loop:span,mixReport});
  fs.copyFileSync(path.join(__dirname,'sound-browser.html'),at('index.html'));
  process.stdout.write(out+'\n');
}

if (require.main===module) publish(process.argv[2] ?? 'backpressure');
module.exports={fixture,loop};
