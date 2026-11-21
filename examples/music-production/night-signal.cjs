/* Render: node examples/music-production/night-signal.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const WAV=require('../../cli/wav.js');
const {KIT:K}=require('../..').load();
const A=K.music.production;
const folder=path.resolve(process.argv[2] ?? 'night-signal');
const sampleRate=32000;
const phrase=(length,notes)=>({length,events:notes.map(([beat,duration,pitch,velocity])=>
  ({beat,duration,...(pitch<16 ? {degree:pitch} : {midi:pitch}),velocity}))});
const production={seed:3107,arrangement:{
  score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:108,swing:.541},endFade:.42,harmonies:{
    home:{root:'D3',quality:'minor7',notes:[38,62,65,69,60]},
    drift:{root:'G2',quality:'minor7',notes:[43,58,62,65,55]},
    clear:{root:'D3',quality:'minor',notes:[38,62,65,69]}
  }},
  motifs:{
    opening:phrase(8,[[.5,.59,62,.68],[1.5,.47,65,.62],[2.75,.82,69,.86],[4.5,.59,62,.71],
      [5.5,.48,65,.62],[6.75,.71,72,.77]]),
    away:phrase(8,[[.75,.63,67,.61],[2,.84,70,.73],[3,.54,74,.57],[4.625,.68,69,.64],
      [5.5,.34,67,.46]]),
    theme:phrase(8,[[0,.68,62,.88],[1,.47,65,.72],[1.75,1.12,69,.86],[3.25,.45,72,.77],
      [4,.7,74,.83],[5,.37,72,.59],[5.75,.57,69,.69],[6.5,1.23,65,.63]]),
    line:phrase(8,[[0,.75,1,.86],[1.5,.44,1,.66],[2.75,.51,5,.72],[4,.87,1,.79],
      [5.5,.39,1,.64],[6,.67,1,.72],[7,.61,5,.69]]),
    landing:phrase(8,[[0,1.5,1,.93],[2,.82,5,.76],[3.25,.51,5,.66],[4,1.1,1,.78],[6,.83,3,.65]]),
    kick:phrase(4,[[0,.09,1,.83],[2.75,.09,1,.7]]),
    brushes:phrase(4,[[1,.11,1,.54],[2.5,.09,1,.31],[3,.11,1,.62],[3.75,.07,1,.34]])
  },
  parts:{bass:{role:'bass',material:'line'},keys:{role:'lead',material:'opening'},
    bed:{role:'pad',material:{sustain:true}},glass:{role:'lead'},
    kick:{role:'percussion',material:'kick'},brush:{role:'percussion',material:'brushes'},
    strike:{role:'percussion'}},
  sections:[{id:'signal',bars:2,harmony:'home'},
    {id:'drift',bars:2,harmony:'drift',parts:{keys:'away'}},
    {id:'return',bars:2,harmony:'clear',parts:{keys:'theme',bass:'landing'}}]
},patches:{
  bass:{type:'analog',body:.51,drive:1.26,env:{attack:.009,decay:.22,sustain:.51,release:.15}},
  keys:{type:'keys',tine:.94,bite:.68,wear:.32,dust:.045,env:{attack:.005,decay:.28,sustain:.39,release:.24},
    echo:{delay:.282,feedback:.41,send:.16,width:.75,wow:.15,flutter:.08}},
  bed:{type:'fm',ratio:2.004,index:1.56,body:.12,width:15,env:{attack:.23,decay:.87,sustain:.49,release:.41}},
  glass:{type:'fm',ratio:3.017,index:2.31,indexDecay:.14,body:.055,width:5,grain:.021,
    env:{attack:.012,decay:.21,sustain:.21,release:.21}},
  kick:{type:'drum',kind:'kick',tune:50,decay:.24,click:.2,sweep:53},
  brush:{type:'drum',kind:'brush',tune:229,decay:.17,click:.66,color:.43},
  strike:{type:'drum',kind:'metal',tune:276,decay:.57,click:.76,color:.68}
},tracks:{
  bass:{patch:'bass',gain:-12,highpass:28,lowpass:950},keys:{patch:'keys',gain:-12.5,pan:-.22,send:.47,highpass:93},
  bed:{patch:'bed',gain:-17.5,pan:.24,send:.57,highpass:131,lowpass:2260,
    pad:{voices:3,low:'D3',high:'A4',anchor:'E4',spread:.026}},
  glass:{patch:'glass',gain:-16,pan:.36,send:.56,highpass:421,lowpass:9370},
  kick:{patch:'kick',gain:-12,lowpass:3600},brush:{patch:'brush',gain:-13.6,pan:-.17,send:.21,highpass:382},
  strike:{patch:'strike',gain:-6.5,pan:.03,send:.41,highpass:271}
},room:{size:1.18,decay:.62,damping:.53,gain:-13}};

const brief={section:'return',goal:'Make the theme’s return feel earned and keep its first note clear.',lead:'keys',layer:'glass'};
const generated=A.planProducer(production,brief);
assert.deepEqual(generated.takes.map(take=>take.id),['reference','harmony','orchestration'],JSON.stringify(generated.blocked));
const double=generated.takes.find(take=>take.id==='orchestration').components[0];
brief.takes=[{id:'full-arrival',hypothesis:'Pair the doubled hook with a conspicuous metal downbeat.',
  components:[double,{id:'metal-strike',summary:'A bright metal accent sounds with the first note and again one bar later.',
    revision:{edits:[{part:'strike',section:'return',scope:'section',adopt:phrase(8,[[0,.19,1,.96],[4,.16,1,.78]])}]}}]}];
const session=A.planProducer(production,brief);
const options={sampleRate,start:{bar:3},end:{bar:6},target:-18,focus:[
  {id:'cadence',start:{bar:3,beat:2},end:{bar:4,beat:2},tracks:['bass','bed']},
  {id:'hook',start:{bar:4},end:{bar:5},tracks:['keys','glass','strike']},
  {id:'return',start:{bar:4},end:{bar:5}}
]};
const review=A.reviewProducer(production,session,{},options);
const selection={keep:[{take:'harmony',component:'cadence'},{take:'full-arrival',component:'octave-double'}],
  listened:['cadence bass and pad solo','return keyboard, glass and strike solo'],
  reason:'The A7 gives the approach a leading tone into D minor. The glass double makes the theme wider. Leaving the strike out gives the first note that space.'};
const result=A.keepProducer(production,session,selection);
const {events}=A.inspect(result.production);
assert(events.glass.length>0 && events.strike.length===0);
assert(A.inspect(review.takes.find(take=>take.id==='full-arrival').production).events.strike.length===2);
assert.deepEqual(A.revise(production,result.reference.revision),result.production);
// Match the kept combination against the same reference and context as the source takes.
const finalSession=A.planProducer(production,{...brief,strategies:[],takes:[{
  id:'kept',hypothesis:selection.reason,components:[{id:'combination',summary:'The kept cadence and glass double.',revision:result.revision}]
}]});
const compared=A.reviewProducer(production,finalSession,{}, {...options,target:review.report.target});
const kept=compared.takes.find(take=>take.id==='kept');
assert.equal(compared.report.target,review.report.target);

fs.mkdirSync(folder,{recursive:true});
const save=(name,json)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(json,null,2)+'\n');
const audio=(name,value)=>fs.writeFileSync(path.join(folder,name),WAV.encode(value,{encoding:'pcm24'}));
save('source.json',{production});
save('brief.json',brief);
save('session.json',session);
save('review.json',{session:'session.json',options});
save('selection.json',{session:'session.json',...selection});
save('reference.json',result.reference);
save('kept-production.json',{production:result.production});
save('report.json',{...review.report,kept:compared.report.takes.at(-1)});
for (const take of [...review.takes,kept]) {
  audio(take.id+'.wav',take.value);
  for (const [id,value] of Object.entries(take.focus)) audio(take.id+'-'+id+'.wav',value);
}
console.log('Night Signal · '+review.takes.map(take=>take.id).join(', ')+' · kept '+selection.keep.map(row=>row.component).join(' and '));
