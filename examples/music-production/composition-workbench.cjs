/* Build a cue, hear several musical decisions, then keep a playable combination. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {KIT}=require('../..').load(), P=KIT.procedural, M=P.mediaGraph;
const WAV=require('../../cli/wav'), {json,write}=require('../../cli/asset-files');
const rate=24000, tempo=106, map={tempo,swing:.53}, b=beat=>({beat});
const folder=path.resolve(process.argv[2] ?? 'out/composition-workbench');
const at=file=>path.join(folder,file);
const wind=require('./split-reed.cjs');
const motif=(length,rows)=>({length,events:rows.map(([beat,duration,midi,velocity,degree],index)=>
  ({id:'hit-'+index,beat,duration,velocity,...(midi===null ? {degree:degree ?? 1} : {midi})}))});
const hook=motif(8,[[.22,.32,69,.66],[.89,.35,72,.74],[3.17,.43,67,.69],
  [4.46,.6,74,.72],[6.09,.41,72,.58],[7.17,.55,69,.57]]);
const native={id:'after-call',beat:24,length:8,voices:[{id:'reed',notes:motif(8,[
  [.19,.58,72,.64],[1.47,.35,69,.54],[2.62,1.47,64,.62],[5.09,1.42,62,.62]
]).events.map(({degree,...note})=>note)}]};
const sampleNames=['metal-hit','metal-soft','metal-alt','hat-open','hat-closed','hat-closed-alt','snare-rim','snare-ghost'];

function recordings() {
  const ways=Object.fromEntries([...sampleNames,'kick'].map(id=>[id,'assets/'+id+'.wav']));
  for (const name of sampleNames) write(at(ways[name]),fs.readFileSync(path.join(__dirname,'samples',name+'.wav')));
  const samples=Float64Array.from({length:rate*.23},(_,i)=>{
    const t=i/rate, phase=45*t+(87/34)*(1-Math.exp(-34*t));
    return .78*Math.sin(2*Math.PI*phase)*Math.min(1,t*920)*Math.exp(-t*16);
  });
  write(at(ways.kick),WAV.encode({sampleRate:rate,channels:1,samples},{encoding:'pcm24'}));
  write(at('assets/CREDITS.md'),fs.readFileSync(path.join(__dirname,'samples/CREDITS.md')));
  return {assets:Object.fromEntries(Object.entries(ways).map(([id,file])=>[id,WAV.read(at(file))])),paths:ways};
}
const chords={
  deep:{root:'D3',quality:'minor7'}, glow:{root:'Bb2',quality:'major7'},
  bridge:{root:'G2',quality:'minor7'}, close:{root:'A2',quality:'dominant7'}
};
const session={format:'ink-studio/music-edit-session',version:1,id:'night-relay',sampleRate:rate,
  production:{seed:270,arrangement:{score:{key:{root:'D4',mode:'minor'},tempoMap:map,endFade:.17,harmonies:chords,
    changes:[{id:'bend',time:b(20),harmony:'bridge'}]},
    motifs:{hook,
      floor:motif(4,[[0,.72,null,.76],[1.36,.37,null,.6,5],[2.18,.6,null,.68],[3.31,.28,null,.5,3]]),
      keys:motif(4,[[.36,1.14,null,.49,3],[2.21,.6,null,.59,5],[3.19,.43,null,.33,7]]),
      click:motif(4,[[.62,.11,null,.54],[2.27,.13,null,.48],[3.78,.11,null,.49]])},
    parts:{lead:{role:'lead'},bass:{role:'bass',material:'floor'},inner:{role:'pad',material:'keys'},
      strike:{role:'percussion',material:'click'},signal:{role:'pad'}},
    sections:[{id:'intake',bars:2,harmony:'deep'},{id:'rise',bars:2,harmony:'glow',parts:{lead:'hook'}},
      {id:'return',bars:2,harmony:'deep'},{id:'after',bars:2,harmony:'close',parts:{lead:null}}]},
    patches:{reed:{...wind,echo:{delay:.303,feedback:.27,damping:.68,send:.16,width:.65}},
      tine:{type:'keys',tine:.63,bite:.35,dust:.055,wear:.27,env:{attack:.008,decay:.35,sustain:.32,release:.45}},
      sub:{type:'subtractive',saw:.19,pulse:.14,sub:.78,filter:{cutoff:312,keyTrack:.35,envAmount:19},
        env:{attack:.032,decay:.28,sustain:.68,release:.21}},
      strike:{type:'sample',zones:[{samples:['metal-soft','metal-alt','metal-hit'],root:57,levels:[.9,.85,.73]}]},
      signal:{type:'fm',ratio:2.006,index:.58,body:.26,indexDecay:.33,env:{attack:.012,decay:.23,sustain:.28,release:.23}}},
    tracks:{lead:{patch:'reed',gain:-13,pan:.11,send:.38,clips:[native]},bass:{patch:'sub',gain:-15,send:.012},
      inner:{patch:'tine',gain:-19,pan:-.19,send:.51},strike:{patch:'strike',gain:-27,pan:.28,send:.18},
      signal:{patch:'signal',gain:-24,pan:-.25,send:.4}},
    room:{gain:-8.4,size:1.16,decay:.75,damping:.64}},
  editorial:{picture:{fps:24,shots:[{id:'intake',frames:109},{id:'corridor',frames:109},
    {id:'latch',frames:109},{id:'undertow',frames:109}]}},
  mixer:{output:'master',tail:'cut',peakPolicy:'error',strips:{master:{},drums:{fader:.79},foley:{fader:.55}}}};
const pattern={id:'relay',seed:2219,length:4,steps:[
  {id:'down',beat:0,pad:'kick',velocity:.79,offset:.001},
  {id:'bass-reply',beat:2.12,pad:'kick',velocity:.67,offset:-.012},
  {id:'snap',beat:1,pad:'rim',velocity:.66,offset:.024,play:{tune:-160,pan:.14}},
  {id:'snap-two',beat:3,pad:'rim',velocity:.85,offset:.034,play:{sends:{echo:.16}}},
  {id:'wire-call',beat:.64,pad:'call',velocity:.63,gate:.18,offset:-.025,
    play:{sample:'metal-soft',startSample:20,tune:-165,filter:{type:'lowpass',hz:3950},pan:.25}},
  {id:'wire-answer',beat:2.68,pad:'call',velocity:.57,gate:.15,offset:.037,play:{pan:-.33}},
  {id:'ring',beat:1.65,pad:'open',velocity:.55,offset:.017},
  {id:'damp',beat:2.06,pad:'closed',velocity:.44,offset:-.011},
  {id:'air',beat:3.39,pad:'closed',velocity:.57,offset:.014,play:{pan:.38}}
],fills:[{id:'break',from:3.48,to:4,mode:'add',steps:[
  {id:'rim-skip',beat:3.54,pad:'rim',velocity:.48,offset:-.014,roll:{count:3,spacing:.14,velocity:[.65,1.12]}}
]}]};
const layer=(takes,gain={})=>({default:[{id:'one',takes:takes.map(asset=>({asset,...gain}))}]});
const kit={id:'machine-room',buses:{echo:{gain:-10,inserts:[{type:'delay',seconds:.196,feedback:.27,mix:.62}]}},
  pads:{
    kick:{gain:-10,articulations:layer(['kick'])},
    rim:{gain:-11,articulations:{default:[{id:'ghost',takes:[{asset:'snare-ghost'}],velocity:[0,0,.33,.6]},
      {id:'rim',takes:[{asset:'snare-rim'},{asset:'metal-alt',tune:-530,gain:5}],velocity:[.28,.54,1,1]}]}},
    wire:{gain:-13,release:.05,sends:{echo:.21},articulations:layer(['metal-soft','metal-alt'])},
    open:{gain:-15,choke:'hat',pan:-.2,articulations:layer(['hat-open'])},
    close:{gain:-16,choke:'hat',pan:.18,articulations:layer(['hat-closed','hat-closed-alt'])}
  }};
const rhythm={id:'pocket',rhythm:{pattern,written:{'bass-reply':2.33,'wire-answer':2.46,'snap-two':3.23},
  settings:{startBeat:16,cycles:2,fills:[{cycle:1,id:'break'}]},
  notes:{lane:'signal',voices:{top:{from:'call',pitches:[{degree:3},{degree:5},{degree:6},{degree:5}]},
    floor:{from:'call',pitches:['A3','D4'],transpose:0}}},
  pads:{lane:'drums',take:'metal-kit',kit,routes:{kick:{pad:'kick'},rim:{pad:'rim'},call:{pad:'wire'},open:{pad:'open'},closed:{pad:'close'}}},
  foley:{lane:'foley',take:'relay',routes:{call:{take:'bolt',takes:{bolt:{asset:'metal-hit',sync:{sample:120},toSample:8400}},
    gain:.39,fades:{inSamples:24,outSamples:840,curve:'equal-power'}}}}}};
function form(id,part,ending) {
  return {id,form:{theme:{themes:{signal:{motif:'hook',fragments:{hint:['hit-0','hit-2']}}},appearances:[
    {id:'metal-hint',theme:'signal',stage:'fragment',fragment:'hint',section:'intake',beat:1.5,targets:[{part:'strike',pitch:'rhythm',gate:.7}]},
    {id:'bass-recall',theme:'signal',stage:'development',fragment:'hint',section:'rise',beat:.3,
      targets:[{part:'bass',pitch:'chord-tone',stretch:1.2,transpose:-12}]},
    {id:'full-return',theme:'signal',stage:'statement',section:'return',beat:0,
      targets:[{part,level:part==='inner' ? 1.2 : 1}]}
  ]},withhold:[{from:0,to:4,parts:['bass']},{from:8,to:part==='lead' ? 16 : 24,parts:['lead'],mode:'cut'}],
  ending:{at:31.35,mode:ending}}};
}
const moves=[
  form('late-call','lead','ring'),form('piano-return','inner','cut'),
  {id:'phrase',phrase:{section:'return',kinds:['pedal','contrary','drum-answer','empty-beat'],
    tracks:{lead:'lead',bass:'bass',inner:'inner',percussion:'strike'},
    constraints:{scale:{root:'D4',mode:'minor'},pins:{lead:'all'},ranges:{bass:[26,46],inner:[52,70]}}}},
  {id:'voicing',voicing:{track:'inner',melody:'lead',bass:'bass',from:16,to:24,voices:[
    {id:'low',low:'F3',high:'D4',anchor:'A3',velocity:.54},{id:'high',low:'D4',high:'E5',anchor:'F4',velocity:.61}],
    preferences:{dissonance:.23,tension:.14,delay:.62}}},
  {id:'touch',gesture:{lane:'lead',clip:'after-call',voice:'reed',notes:[
    {note:'hit-0',play:{delay:-.042,attackFade:.17,curves:{breath:[[0,.85],[.35,.55],[1,.2]],
      amplitude:[[0,.38],[.23,.68],[.65,1],[1,.78]]}}},
    {note:'hit-3',play:{releaseLimit:.06}}
  ]}},rhythm
];

const {assets,paths}=recordings(), E=M.musicSession.create(assets);
const brief={moves,preview:{from:b(0),to:b(32)}};
const review=E.compose(session,brief);
const names=['late-call','piano-return','phrase-pedal','phrase-contrary','phrase-drum-answer','phrase-empty-beat','touch',
  'pocket-grid','pocket-written','pocket-timing','pocket-both'];
for (const id of names) assert(review.sessions[id],JSON.stringify(review.value.groups.map(group=>
  ({id:group.id,rejected:group.rejected,evidence:group.evidence?.families?.filter(row=>row.blocked)}))));
assert(!review.value.listening.takes.find(row=>row.id==='touch').identicalToReference);
const picked=['late-call','pocket-both','touch'];
const changes=picked.flatMap(name=>review.value.candidates.find(row=>row.id===name).edits);
const kept=E.edit(session,changes), final=E.render(kept,brief.preview).value;
const {lufs,truePeak}=P.musicProduction.meters(final,true);
const listeningGain=10**(Math.min(review.value.listening.commonLufs-lufs,-1-20*Math.log10(truePeak))/20);
const publishWav=(name,pcm)=>write(at(name+'.wav'),WAV.encode(pcm,{encoding:'pcm24'}));
for (const [id,clip] of Object.entries(review.clips)) publishWav(id,clip);
publishWav('kept',{...final,samples:final.samples.map(sample=>sample*listeningGain)});
json(at('brief.json'),brief);
json(at('source.json'),{session,assets:paths});
json(at('kept.json'),{session:kept,assets:paths});
json(at('decisions.json'),{kept:picked,changes,listeningGain,reason:'The room introduces the figure, the kit leans into it, and the last reed lets go sooner.'});
const relAssets=Object.fromEntries(Object.entries(paths).map(([id,file])=>[id,'../'+file]));
for (const [id,session] of Object.entries(review.sessions)) json(at('sessions/'+id+'.json'),{session,assets:relAssets});
json(at('report.json'),review.value);
json(at('kept-trace.json'),E.trace(kept));
const html=fs.readFileSync(path.join(__dirname,'composition-workbench.html'),'utf8');
write(at('index.html'),html.replace('__TAKES__',JSON.stringify(Object.keys(review.clips))));
console.log(JSON.stringify({folder,takes:Object.keys(review.clips),kept:picked,matchedLufs:review.value.listening.commonLufs},null,2));
