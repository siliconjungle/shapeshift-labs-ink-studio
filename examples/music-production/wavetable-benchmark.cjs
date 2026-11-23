/* Build the shared performances and backing for the CLI instrument benchmark. */
const path=require('node:path');
const {KIT}=require('../..').load(), P=KIT.procedural, A=P.musicProduction;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
const {production,row}=require('../native-sound-library/performances.cjs');

const folder=path.resolve(process.argv[2] ?? 'wavetable-benchmark');
const sampleRate=48000, at=file=>path.join(folder,file);
const amp=(input,amount)=>({type:'gain',input,amount});
const osc=(wave,settings={})=>({type:'oscillator',wave,...settings});
const mix=(...inputs)=>({type:'mix',inputs});
const filter=(input,mode,cutoff,resonance)=>({type:'filter',input,mode,cutoff,resonance});
const shape=(attack,decay,sustain,release)=>({attack,decay,sustain,release});
const env=(...args)=>({type:'envelope',env:shape(...args)});
const held=input=>amp(input,{base:0,from:{gate:1}});
const graph=(nodes,output,tail)=>({type:'graph',nodes,output,tail});
const sub=graph({sine:osc('sine'),body:osc('sine',{ratio:2}),harmonic:amp('body',.065),
  sum:mix('sine','harmonic'),gate:env(.012,.24,.90,.22),voice:held('sum')},'voice',.26);
const reese=graph({
  a:osc('saw',{detune:-.19,phase:.17}),b:osc('saw',{detune:.22,phase:.64}),
  p:osc('pulse',{width:.29,phase:.31}),left:amp('a',.76),right:amp('b',.78),core:amp('p',.33),
  lm:mix('left','b','core'),rm:mix('a','right','core'),
  sweep:{type:'curve',points:[[0,.88],[.25,.58],[.75,.19],[1,.36]]},
  lowl:filter('lm','lowpass',{base:460,from:{sweep:1450}},1.19),
  lowr:filter('rm','lowpass',{base:519,from:{sweep:1280}},1.31),
  highl:filter('lowl','highpass',98,.707),highr:filter('lowr','highpass',98,.707),
  gate:env(.017,.18,.84,.22),l:held('highl'),r:held('highr')
},{left:'l',right:'r'},.31);
const talk=graph({
  mod:osc('sine',{ratio:2.01}),carrier:osc('sine',{phaseInput:'mod',index:.49}),
  saw:osc('saw',{phase:.13}),fm:amp('carrier',.85),sum:mix('fm','saw'),drive:{type:'drive',amount:1.7,input:'sum'},
  mouth:{type:'curve',points:[[0,.20],[.23,1],[.43,.25],[.62,.78],[1,.17]]},
  a:filter('drive','bandpass',{base:355,from:{mouth:792}},3.47),
  b:filter('drive','bandpass',{base:815,from:{mouth:1590}},3.1),
  neck:filter('drive','lowpass',426,.93),bottom:amp('neck',.24),sum2:mix('a','b','bottom'),
  gate:env(.011,.11,.85,.18),voice:held('sum2')
},'voice',.22);
const saw=graph({
  center:osc('saw',{phase:.2}),l1:osc('saw',{detune:-.12,phase:.09}),r1:osc('saw',{detune:.15,phase:.68}),
  l2:osc('saw',{detune:.22,phase:.42}),r2:osc('saw',{detune:-.26,phase:.83}),
  l3:osc('saw',{detune:-.43,phase:.55}),r3:osc('saw',{detune:.45,phase:.27}),
  c:amp('center',.69),a:amp('l1',.35),b:amp('r1',.35),d:amp('l2',.24),e:amp('r2',.24),
  f:amp('l3',.14),g:amp('r3',.14),ls:mix('c','a','d','f'),rs:mix('c','b','e','g'),
  lowl:filter('ls','lowpass',7460,.77),lowr:filter('rs','lowpass',7100,.81),
  gate:env(.025,.29,.88,.27),l:held('lowl'),r:held('lowr')
},{left:'l',right:'r'},.33);
const pad=graph({
  clock:osc('sine',{hz:110/60*2}),swell:osc('sine',{hz:.23,phase:.22}),
  as:osc('saw',{detune:-.12}),bs:osc('saw',{detune:.13,phase:.25}),
  a:filter('as','lowpass',{base:1640,from:{clock:840,swell:480}},.94),
  b:filter('bs','lowpass',{base:1660,from:{clock:800,swell:-420}},.98),
  gate:env(.26,.38,.85,.57), l:held('a'),r:held('b')
},{left:'l',right:'r'},.62);
const pluck={type:'fm',ratio:2,index:1.37,indexDecay:.19,body:.44,color:.68,drive:1.25,width:.8,
  env:shape(.007,.22,.26,.22)};

const bassPhrase=[
  [0,29,1.19,.89],[1.51,29,.44,.64],[2.03,36,.69,.81],[3.12,29,.59,.81],
  [4,29,1.26,.91],[5.52,29,.39,.62],[6.05,32,.66,.77],[7.23,27,.48,.70],
  [8,28,1.78,.90],[10,35,.81,.83],[11.16,28,.47,.71],
  [12,29,1.27,.96],[13.58,29,.37,.74],[14.01,36,.63,.80],[14.96,32,.78,.62]
];
const talkPhrase=[
  [0,40,.76,.93],[.94,40,.53,.78],[1.67,40,.59,.82],[2.67,43,.75,.83],
  [4,40,1.38,.96],[5.84,40,.62,.83],[6.79,38,.57,.76],
  [8,40,.64,.96],[8.93,40,.52,.78],[9.64,47,.76,.87],[10.78,43,.53,.71],
  [12,40,1.13,.96],[13.48,40,.51,.77],[14.24,38,1.26,.87]
];
const leadPhrase=[
  [0,74,.86,.91],[1.02,77,.57,.80],[1.75,81,1.12,.92],[3.05,79,.70,.83],
  [4,77,.76,.86],[4.97,74,.62,.76],[5.78,77,.61,.83],[6.64,84,1.05,.98],
  [8,81,1.29,.96],[9.48,84,.55,.83],[10.17,86,.76,.94],[11.19,84,.57,.86],
  [12,79,.98,.89],[13.18,76,.78,.78],[14.18,74,1.31,.91]
];
const padNotes=[[[.02,52,4.38,.63],[5.03,53,5.54,.69],[11.02,52,4.34,.62]],
  [[0,59,4.20,.53],[5,60,5.53,.58],[11,59,4.29,.55]],
  [[.045,67,4.27,.58],[5.05,65,5.44,.53],[11.04,64,4.33,.53]]];
const pluckPhrase=[
  [0,64,.52,.93],[.76,71,.38,.76],[1.51,76,.43,.86],[2.72,74,.52,.77],[3.48,67,.39,.66],
  [4,65,.47,.91],[4.72,72,.44,.79],[5.48,77,.61,.87],[6.79,76,.41,.70],[7.52,72,.38,.65],
  [8,64,.53,.92],[8.72,71,.36,.75],[9.48,76,.61,.92],[10.73,74,.43,.80],[11.41,67,.44,.67],
  [12,65,.49,.87],[12.74,72,.43,.78],[13.5,76,.63,.91],[14.79,64,.87,.83]
];
const presetFX={'341421301':1};
const cases=[
  {id:'sub',title:'Sub bass · foundation',tempo:174,kind:'dnb',native:sub,notes:[bassPhrase],
    preset:'patches_factory/Basses/Sub 3.fxp',parameters:{...presetFX,'3235198798':.5},soloLufs:-23,hpHz:27,tail:.44},
  {id:'reese',title:'Reese · detune and movement',tempo:174,kind:'dnb',native:reese,
    notes:[bassPhrase.map(([t,n,d,v])=>[t,n+12,d,v])],preset:'patches_3rdparty/Vospi/Basses/Primitive Reese.fxp',
    parameters:presetFX,soloLufs:-21,hpHz:98,tail:.5},
  {id:'vowel',title:'Talking bass · formant motion',tempo:140,kind:'half',native:talk,notes:[talkPhrase],
    preset:'patches_3rdparty/Giana Brotherz/Leads/Formant Tables.fxp',parameters:{...presetFX,'3235198798':.5},
    soloLufs:-20,hpHz:116,tail:.50},
  {id:'saw',title:'Supersaw · sustained rave lead',tempo:148,kind:'rave',native:saw,notes:[leadPhrase],
    preset:'patches_3rdparty/Luna/Leads/JP8K Supersaw.fxp',parameters:presetFX,soloLufs:-21,hpHz:190,tail:.62},
  {id:'pad',title:'Pad · tempo-synced movement',tempo:110,changes:[{beat:8,tempo:138}],kind:'half',native:pad,notes:padNotes,
    preset:'patches_factory/Pads/MW Pulsating.fxp',
    parameters:{...presetFX,'2456464138':.38,'1360577357':.29},soloLufs:-24,hpHz:167,tail:.79},
  {id:'pluck',title:'Pluck · transient and release',tempo:112,kind:'half',native:pluck,notes:[pluckPhrase],
    preset:'patches_factory/Plucks/Clean.fxp',parameters:presetFX,soloLufs:-23,hpHz:149,tail:.62}
];
const output=cases.map(entry=>{
  const {id,title,tempo,changes,kind,native,notes,preset,parameters,soloLufs,hpHz,tail}=entry;
  const map={tempo,...(changes && {changes})};
  const study=production({voice:native},{voice:{notes:[],gain:-14}},4,{gain:0});
  study.arrangement.score.tempoMap=map;
  study.arrangement.score.endFade=0;
  study.tracks.voice.clips[0].voices=notes.map((notes,i)=>({id:'v-'+i,
    notes:notes.map((line,j)=>({...row(...line),id:'n-'+j}))}));
  const kickRows=kind==='rave' ? [0,1,2,3] : kind==='dnb' ? [0,2.51] : [0,2.73];
  const hits=(offset,velocity)=>Array.from({length:4},(_,i)=>offset.map((t,j)=>row(4*i+t,36,.104,
    velocity[(i+j)%velocity.length]))).flat();
  const backing=production({
    kick:{type:'sample',zones:[{samples:['kick-a','kick-b'],gain:3}]},
    snare:{type:'sample',zones:[{samples:['snare-a','snare-b'],gain:7}]},
    'closed-hat':{type:'sample',zones:[{samples:['hat-a','hat-b'],gain:8}]},
    bass:sub
  },{
    kick:{notes:hits(kickRows,[.92,.75,.84,.90]),gain:-10},
    snare:{notes:hits(kind==='half'?[2.018]:[1.018,3.011],[.88,.81,.91]),gain:-13,highpass:110},
    'closed-hat':{notes:hits([.49,1.48,2.51,3.49],[.58,.48,.62,.43]),gain:-17,highpass:630,pan:.19},
    ...(id!=='sub'&& {bass:{notes:bassPhrase.map(([t,m,d,v])=>row(t,m,d,v)),gain:-20,lowpass:140}})
  },4,{gain:-2});
  backing.arrangement.score.tempoMap=map;
  backing.arrangement.score.endFade=0;
  const sources=Object.fromEntries(Object.entries({
    'kick-a':'../native-sound-library/recordings/rhythm-kick-hard-a',
    'kick-b':'../native-sound-library/recordings/rhythm-kick-hard-b',
    'snare-a':'samples/snare-main','snare-b':'samples/snare-alt','hat-a':'samples/hat-closed','hat-b':'samples/hat-closed-alt'
  }).map(([name,file])=>[name,WAV.read(path.resolve(__dirname,file+'.wav'))]));
  const bed=A.render(backing,sources,{sampleRate,tail,stems:false}).value;
  const bedPath='backing/'+id+'.wav';
  write(at(bedPath),WAV.encode(bed,{encoding:'pcm24'}));
  return {id,title,production:study,reference:{type:'clap',plugin:'surge'},preset,
    snapshotParameters:parameters,assets:{backing:bedPath},options:{tail,soloLufs,mixLufs:-18},
    mixer:{id: id+'-desk',sampleRate,map,output:'master',tail:'cut',end:{samples:bed.samples.length/bed.channels},
      strips:{backing:{clips:[{id:'bed',source:'backing'}]},
        voice:{clips:[{id:'take',source:'instrument'}],inserts:['seat'],
          ...(['saw','pad','pluck'].includes(id)&&{sends:{room:{tap:'post',level:.18}}})},
        room:{inserts:['space','return']},master:{}},
      processors:{seat:{type:'eq',bands:[{mode:'highpass',hz:hpHz}]},
        space:{type:'reverb',size:1.04,decay:.61,damping:.69,wet:1},
        return:{type:'eq',bands:[{mode:'highpass',hz:244},{mode:'lowpass',hz:6600}]}}}
  };
});
json(at('suite.json'),{format:'ink-studio/instrument-benchmark',version:1,reference:'Surge XT 1.3.4',cases:output});
console.log(at('suite.json'));
