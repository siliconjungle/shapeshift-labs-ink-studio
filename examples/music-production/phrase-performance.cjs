/* Run: node examples/music-production/phrase-performance.cjs output-directory */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), A=KIT.procedural.mediaGraph;
const splitReed=require('./split-reed.cjs');
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
if (!process.argv[2]) throw new TypeError('Choose a phrase performance demo directory');
const dir=path.resolve(process.argv[2]), rate=32000;
const file=(name,data)=>{const target=path.join(dir,name);json(target,data);return target;};
const wave=(name,pcm)=>write(path.join(dir,name),WAV.encode(pcm,{encoding:'pcm24'}));
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music','session',...args],{encoding:'utf8'}));
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const clip=(id,notes,mode)=>[{id,beat:0,length:20,voices:[{id:'line',notes}],...(mode && {mode})}];
const pitches=[60,63,67,65,63];
const leadNotes=[
  note('start',4.19,.73,pitches[0],.71,{articulation:'steady'}),
  note('lean',5.27,1.17,pitches[1],.74,{articulation:'steady'}),
  note('lift',6.8,1.52,pitches[2],.69,{articulation:'steady'}),
  note('turn',9.16,1.27,pitches[3],.66,{articulation:'steady'}),
  note('hold',11.08,2.05,pitches[4],.72,{articulation:'steady'})
];
const production={seed:110,arrangement:{
  score:{key:{root:'C3',mode:'minor'},tempoMap:{tempo:108},endFade:.12,
    harmonies:{home:{root:'C3',quality:'minor'}}},
  motifs:{guide:{length:1,events:[note('off',0,.1,60,0)]}},
  parts:{reed:{role:'lead',material:'guide'},bass:{role:'bass',material:'guide'},
    glass:{role:'pad',material:'guide'},click:{role:'percussion',material:'guide'}},
  sections:[{id:'room',bars:1,harmony:'home'},{id:'reply',bars:4,harmony:'home'}]
},patches:{
  reed:{...splitReed,performance:{connect:{gap:.072,interval:7,fade:.025},rules:[{when:'legato',glide:.055}]},
    echo:{delay:.312,feedback:.27,damping:.68,send:.21,width:.67}},
  sub:{type:'subtractive',saw:.12,pulse:.22,sub:.73,filter:{cutoff:490,envAmount:16},
    env:{attack:.025,decay:.46,sustain:.59,release:.25}},
  glass:{type:'keys',tine:.57,bite:.38,dust:.035,wear:.47,env:{attack:.016,decay:.47,sustain:.18,release:.39}},
  click:{type:'drum',kind:'metal',tune:337,decay:.12,color:.82,click:.45}
},tracks:{
  reed:{patch:'reed',gain:-6.3,pan:.05,highpass:110,send:.23,clips:clip('call',leadNotes)},
  bass:{patch:'sub',gain:-12,clips:clip('pedal',[
    note('enter',2.12,1.42,36,.63),note('after-first',7.45,1.43,36,.60),
    note('under',9.68,.9,34,.69),note('pickup',13.62,1.16,32,.79),note('settle',15.42,2.11,36,.58)
  ])},
  glass:{patch:'glass',gain:-14.3,pan:-.24,send:.45,clips:clip('reflection',[
    note('hint',.71,.81,55,.48),note('other',2.85,1,63,.52),note('exit',8.44,.54,60,.53),
    note('low',10.76,.78,55,.5),note('wash',14.37,1.91,67,.64),note('end',17.43,1.45,55,.44)
  ])},
  click:{patch:'click',gain:-19,pan:.29,send:.43,clips:clip('edges',[
    note('left',3.34,.09,36,.58),note('right',8.18,.12,39,.54),
    note('wait',10.13,.1,36,.52),note('answer',15.03,.08,36,.64)
  ],'layer')}
},room:{gain:-11,size:1.19,decay:.85,damping:.56}};
const session={format:'ink-studio/music-edit-session',version:1,id:'blackwater-phrase',sampleRate:rate,
  production,pins:{reed:'pitch'},mixer:{output:'master',strips:{master:{fader:1.47}},
    taps:{reed:{strip:'reed'}},peakPolicy:'error'}};
const mapping={
  pressure:{base:.08,from:{effort:.90}},breath:{base:.08,from:{effort:.37,air:.46}},
  amplitude:{base:.035,from:{effort:.93}},damping:{base:.92,from:{effort:-.68}},
  roughness:{base:.008,from:{air:.41}},pitchCents:{base:-38,from:{tilt:76}},gainDb:{base:-2,from:{effort:3}}
};
const driver=rows=>rows.map(([beat,value],i)=>({id:'k-'+i,beat,value}));
const shape=(effort,air,tilt,notes=[])=>({id:'call',from:4,to:16.8,
  drivers:{effort:driver(effort),air:driver(air),tilt:driver(tilt)},mapping,notes});
const address=(name,fields)=>({clip:'call',voice:'line',note:name,...fields});
const captures={
  lean:shape([[4,.38],[4.24,.61],[4.76,.46],[5.23,.58],[5.71,.95],[6.14,.83],[6.45,.5],[7.08,.69],
      [8.37,.47],[9.43,.65],[10.31,.54],[11,.48],[11.72,.71],[12.34,.66],[13.22,.42],[14.03,.15],[16.8,0]],
    [[4,.27],[5.55,.34],[6.2,.62],[7.47,.14],[9.55,.24],[11.57,.46],[12.6,.35],[14.2,.67],[16.8,.02]],
    [[4,.44],[4.52,.51],[5.26,.29],[5.83,.82],[6.43,.49],[7.38,.59],[8.02,.51],[11.2,.33],[12.15,.51],[13.76,.30],[16.8,.5]],
    [address('lean',{delay:.022,gate:1.04,accent:1.16}),address('hold',{gate:.93})]),
  falter:shape([[4,.03],[4.32,.21],[4.58,.034],[4.9,.16],[5.2,.077],[5.62,.40],[5.88,.17],[6.15,.04],
      [6.91,.095],[7.41,.44],[8.49,.14],[9.3,.25],[10.18,.06],[11.16,.26],[12.41,.41],[13.25,.12],[15.1,.04],[16.8,0]],
    [[4,.65],[4.47,.87],[5.51,.69],[6.36,.94],[7.61,.57],[9.5,.76],[11.44,.72],[13.2,.99],[16.8,.06]],
    [[4,.1],[4.57,.47],[5.6,.25],[6.43,.43],[7.61,.49],[11.47,.42],[13.44,.09],[16.8,.46]],
    [address('start',{delay:.043}),address('lift',{delay:.061}),address('hold',{gate:1.11})]),
  carry:shape([[4,.41],[4.43,.54],[5.65,.63],[6.48,.56],[7.47,.74],[8.49,.63],[9.56,.57],
      [10.55,.47],[11.14,.63],[11.97,.68],[12.81,.81],[13.38,.92],[13.91,.86],[14.31,.58],[14.86,.18],[15.55,.025],[16.8,0]],
    [[4,.28],[6.1,.27],[7.37,.19],[8.11,.31],[10.06,.43],[11.05,.22],[12.7,.35],[13.63,.25],
      [14.48,.46],[14.98,.84],[15.67,.54],[16.8,.04]],
    [[4,.35],[5.65,.46],[6.76,.47],[7.31,.56],[8.8,.45],[11.34,.49],[12.8,.59],[13.5,.65],[14.57,.48],[15.16,.19],[16.8,.49]],
    [address('hold',{gate:1.68,accent:.9})])
};
const base=file('reference-session.json',{session});
const record=Object.entries(captures).map(([take,phrase])=>({op:'record-phrase',lane:'reed',take,phrase}));
const tracking=cli('edit',base,file('capture.json',record),'--out',path.join(dir,'takes-session.json'));
const sections=[{take:'lean',from:4,to:12.24},{take:'carry',from:12.24,to:16.8,blend:.16}];
const keep={op:'comp-phrase',lane:'reed',phrase:'call',take:'kept',sections};
const comp=cli('edit',tracking.session,file('comp.json',[keep]),'--out',path.join(dir,'kept-session.json'));
const listen={lane:'reed',phrase:'call',takes:['lean','falter','carry','kept'],from:{beat:3.08},to:{beat:16.8}};
const review=cli('audition-phrase',comp.session,file('audition.json',listen),'--out',path.join(dir,'takes'));
const phrases=read(review.report);
const names=phrases.takes;
const reel=A.gestureBank.audition(names.map(id=>({id,value:WAV.read(review.clips[id])})),
  {sampleRate:rate,levelMatch:'shared',gapSeconds:.32,peakDb:-2,targetRmsDb:-15,maxGainDb:0});
wave('phrase-takes.wav',reel.value);
file('reel.json',reel.report);
const printed=cli('render',comp.session,'--out',path.join(dir,'printed'));
const fixed=read(comp.session).session, E=A.musicSession.create(), evidence=E.inspect(fixed);
for (const id of names) assert.deepEqual(evidence.lanes.reed.takes[id].map(note=>note.midi),pitches);
const held=evidence.lanes.reed.takes.kept.find(note=>note.address[3]==='hold');
const pickup=evidence.lanes.bass.takes.reference.find(note=>note.address[3]==='pickup');
assert(held.time<pickup.time && held.time+held.gate>pickup.time);
assert.deepEqual(fixed.takes.kept.tracks.reed.phrases[0].sources,sections);
const {sampleRate,firstSample,endSample}=phrases;
const full=WAV.read(printed.mix), audition=WAV.read(review.clips.kept);
assert.deepEqual(full.samples.slice(2*firstSample,2*endSample),audition.samples);
file('evidence.json',{sampleRate,held:{midi:held.midi,start:held.time,end:held.time+held.gate},
  seam:E.inspect(fixed).lanes.reed.performances.kept[0].sources[1],pickup:pickup.time,
  takes:names,joinSeconds:12.24*60/108,full:printed.mix});
console.log(JSON.stringify({reel:path.join(dir,'phrase-takes.wav'),comp:printed.mix,
  session:comp.session,report:review.report,pickupOverlapped:true},null,2));
