/* Run: node examples/music-production/playable-sound-workshop.cjs output-directory */
const path=require('node:path');
const {KIT}=require('../..').load(), A=KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
const target=process.argv[2];
if (!target) throw new TypeError('Choose an output directory');
const dir=path.resolve(target), rate=32000;
const audio=(name,pcm)=>write(path.join(dir,name),WAV.encode(pcm,{encoding:'pcm24'}));
function saveAssets(bank) {
  return Object.fromEntries(Object.entries(bank).map(([name,pcm])=>{
    const file='samples/'+name+'.wav';
    write(path.join(dir,file),WAV.encode(pcm,{encoding:'float32'}));
    return [name,file];
  }));
}

// Three differently voiced excitations make up the source call. The fit and
// projection receive only the recorded sum.
const samples=new Float64Array(Math.round(1.275*rate));
const parts=[
  [.015,.24,238,267,.62,71],
  [.299,.175,290,319,.53,73],
  [.543,.715,304,379,.86,79]
];
for (const [at,duration,pitchStart,pitchEnd,level,seed] of parts) {
  const {value}=A.synthesizeGesture({model:'breath',sampleRate:rate,seed,duration,
    parameters:{pitchStart,pitchEnd,voice:.94,roughTail:.77,throat:1520}});
  const start=Math.round(at*rate);
  for (let i=0;i<value.samples.length;i++) samples[start+i]+=value.samples[i]*level;
}
const source={sampleRate:rate,channels:1,samples}, lab=A.playableSound;
const built=lab.build(source,{id:'fog-hinge',seed:562,fit:{attackMs:47},variants:[
  {id:'sample',family:'sample',label:'Original call across the keys'},
  {id:'attack',family:'attack',label:'Recorded puff with modeled body'},
  {id:'contour',family:'contour',label:'Fitted pitch contour'},
  {id:'air-tail',family:'handoff',tail:'breath',phase:.68,label:'Body into breath'},
  {id:'wire-tail',family:'handoff',tail:'wire',phase:.71,label:'Body into ringing wire'},
  {id:'soft-wire',family:'handoff',tail:'wire',phase:.71,motion:.08},
  {id:'soft-air',family:'handoff',tail:'breath',phase:.62,motion:.06}
]});
const {root}=built.value, bank=saveAssets(built.assets);
const review=lab.audition(built.value,built.assets,{sampleRate:rate,pitches:[root-5,root,root+5],velocities:[.42,.84],
  candidates:['sample','attack','contour','air-tail','wire-tail']});
audio('audition.wav',review.value);
json(path.join(dir,'workshop.json'),{workshop:built.value,assets:bank,
  source:{model:'breath',components:parts,seed:562}});
json(path.join(dir,'audition-report.json'),review.report);
const selection={candidate:'contour',from:'performed',trigger:{key:root,velocity:.78},
  analysis:{detect:{minGap:.15,minStrength:.03,sensitivity:1.4}},
  projection:{beats:2.62,pitchStep:2.6,minNoteMs:100,intervalScale:.72},zones:[
    {id:'quiet',label:'Breathing keys',candidate:'soft-air',low:root-9,high:root+12,velocity:[0,.56]},
    {id:'low-open',label:'Recorded air in the lower register',candidate:'attack',
      low:root-9,high:root-1,velocity:[.56,1],gainDb:-2},
    {id:'high-open',label:'Wire ringing out',candidate:'soft-wire',low:root,high:root+12,velocity:[.56,1]}
  ],fallback:'soft-air'};
const kept=lab.keep(built.value,built.assets,selection);
const {patch,zones,motif}=kept.value, {contour,attacks}=motif.motifs;
if (!contour || contour.events.length<2) throw new Error('The fitted call needs an audible changing pitch contour');
json(path.join(dir,'selection.json'),selection);
json(path.join(dir,'instrument.json'),{patch,zones,assets:Object.fromEntries(Object.keys(kept.assets).map(name=>[name,bank[name]])),
  motif:'motif.json'});
json(path.join(dir,'motif.json'),motif);
audio('held-gesture.wav',kept.reference);

const round=n=>Number(n.toFixed(8));
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const translated=(leadIn,tag,transpose,velocity)=>contour.events.map(row=>
  ({id:tag+'-'+row.id,beat:round(row.beat+leadIn),duration:row.duration,
    midi:row.midi+transpose,velocity:round(row.velocity*velocity),
    play:{curves:{pitchCents:row.play.curves.pitchCents,gainDb:row.play.curves.gainDb
      .map(([phase,db])=>[phase,Math.max(-10,db*.66)])}}}));
const clicks=attacks.events
  .filter((hit,i,rows)=>!i || (hit.beat-rows[i-1].beat)>.13)
  .map(({id,beat,duration,velocity},i)=>note('echo-'+id,8.35+beat,duration,root,velocity*(i%2===1 ? .65 : .90)));
const guide={length:1,events:[note('off',0,.1,root,0)]};
const clip=(notes,mode)=>[{id:'sketch',beat:0,length:20,voices:[{id:'voice',notes}],...(mode && {mode})}];
const production={seed:562,arrangement:{
  score:{key:{root},tempoMap:{tempo:116},endFade:.27,harmonies:{home:{root,quality:'unison'}}},
  motifs:{guide},parts:{lead:{role:'lead',material:'guide'},contact:{role:'percussion',material:'guide'},
    floor:{role:'bass',material:'guide'},glow:{role:'pad',material:'guide'}},
  sections:[{id:'sketch',bars:5,harmony:'home'}]
},patches:{
  reed:{...patch,echo:{delay:.386,feedback:.26,damping:.76,send:.24,width:.68,wow:.07}},
  contact:{type:'sample',zones:[{samples:['fitted-attack'],gain:-3}]},
  floor:{type:'analog',body:.26,color:.46,env:{attack:.041,decay:.56,sustain:.47,release:.29}},
  glass:{type:'keys',tine:.72,bite:.56,dust:.08,wear:.5,env:{attack:.018,decay:.36,sustain:.22,release:.54}}
},tracks:{
  lead:{patch:'reed',gain:-5,pan:.08,send:.28,highpass:150,clips:clip([
    ...translated(4.47,'question',0,.65),...translated(12.27,'return',-5,.93),
    note('hold',16.24,1.85,root,.66,{curves:{breath:[[0,.2],[.52,.72],[1,.22]]}})
  ])},
  contact:{patch:'contact',gain:-14,highpass:280,pan:-.35,send:.52,clips:clip(clicks,'layer')},
  floor:{patch:'floor',gain:-17,lowpass:540,send:.06,clips:clip([
    note('pedal',4.11,3.3,root-24,.62),note('undertow',8.23,2.72,root-24,.53),
    note('return',12.09,3.15,root-19,.61),note('settle',16.58,2.18,root-24,.52)
  ])},
  glow:{patch:'glass',gain:-20,highpass:210,lowpass:3400,pan:-.13,send:.65,clips:clip([
    note('answer',6.83,1.05,root+7,.56),note('glint',9.19,.7,root+10,.52),
    note('shadow',11.52,.4,root+7,.46),note('high',14.61,1.03,root+3,.59),
    note('fade',17.21,1.23,root+7,.49)
  ])}
},room:{size:1.2,gain:-12,decay:.85,damping:.49}};
const session={format:'ink-studio/music-edit-session',version:1,id:'fog-hinge',sampleRate:rate,production,
  audio:{found:{take:'call',takes:{call:{asset:'workshop-source',at:{seconds:.24}}}}},
  mixer:{output:'master',strips:{master:{fader:1.38},found:{fader:.62}}}};
const printAssets={...kept.assets,'fitted-attack':built.assets['fitted-attack'],'workshop-source':source};
const paths=Object.fromEntries(Object.keys(printAssets).map(name=>[name,bank[name]]));
const playbackAssets=Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,WAV.read(path.join(dir,file))]));
const print=A.musicSession.create(playbackAssets).render(session);
audio('source-to-motif.wav',print.value);
json(path.join(dir,'sketch-session.json'),{session,assets:paths});
console.log(JSON.stringify({audition:path.join(dir,'audition.wav'),sketch:path.join(dir,'source-to-motif.wav'),
  contour:contour.events.map(({beat,midi})=>({beat,midi})),attackEvents:clicks.length,
  builds:review.report.candidates.length,cells:review.report.cells.length}));
