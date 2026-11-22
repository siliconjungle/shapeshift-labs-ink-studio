/* Build a review with dozens of instrument swaps, ensemble forks and a blind ballot. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), P=KIT.procedural, M=P.mediaGraph;
const WAV=require('../../cli/wav'), {json,write}=require('../../cli/asset-files');
const Output=require('../../cli/music-session-listening');
const out=path.resolve(process.argv[2] ?? 'out/batch-listening');
const at=file=>path.join(out,file), cli=path.join(__dirname,'../../cli/ink-studio.js');
const rate=16000, tempo=112, seed=1537, span=(from,to)=>({from:{beat:from},to:{beat:to}});
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const clip=(notes,mode)=>[{id:'line',beat:0,length:20,voices:[{id:'player',notes}],...(mode && {mode})}];
const bank={}, paths={}, sources=[];
const materials=[
  {name:'reed',label:'Hollow reed',pitchStart:241,pitchEnd:289,voice:.94,throat:1100,roughTail:.48},
  {name:'air',label:'Air through glass',pitchStart:207,pitchEnd:252,voice:.74,throat:1730,roughTail:.68},
  {name:'wire',label:'High wire',pitchStart:280,pitchEnd:324,voice:.93,throat:2330,roughTail:.87}
];

for (const [index,{name,label,...parameters}] of materials.entries()) {
  const source=M.synthesizeGesture({model:'breath',sampleRate:rate,seed:seed+index,duration:.79,parameters}).value;
  const variants=[
    ...[.042,.25,.48].map((motion,i)=>({id:'contact-'+i,family:'attack',motion})),
    ...[.052,.21,.49].map((motion,i)=>({id:'bend-'+i,family:'contour',motion})),
    ...['breath','wire'].flatMap(tail=>[.42,.62,.79].map((phase,i)=>({
      id:tail+'-'+i,family:'handoff',tail,phase,motion:.12+i*.07,blend:.18,tailDb:-18
    })))
  ];
  const build=M.playableSound.build(source,{id:name,seed:seed+index,fit:{attackMs:[36,52,63][index]},variants});
  const asset=name+'-attack', file=at('assets/'+asset+'.wav');
  write(file,WAV.encode(build.assets['fitted-attack'],{encoding:'float32'}));
  bank[asset]=WAV.read(file);
  paths[asset]='assets/'+asset+'.wav';
  for (const variant of variants) {
    const patch=JSON.parse(JSON.stringify(build.value.candidates[variant.id].patch)
      .replaceAll('"fitted-attack"',JSON.stringify(asset)));
    sources.push({id:name+'-'+variant.id,family:name+'-'+(variant.tail ?? variant.family),
      label:label+' · '+variant.id,patch});
  }
}

const song=[
  note('call-a',1.14,.64,65,.74,{curves:{breath:[[0,.72],[.4,.23],[1,.68]]}}),
  note('call-b',1.96,.67,68,.78),note('call-c',3.01,1.25,70,.72),
  note('trace',7.63,.65,63,.53),note('pickup',10.46,.55,65,.61),
  note('return-a',12.17,.64,65,.79),note('return-b',12.98,.67,68,.83),
  note('return-c',14.02,1.18,72,.78),note('return-d',15.64,.67,70,.64),
  note('after',17.88,1.32,63,.51)
];
const gestures=[
  {id:'together',label:'Kick and bass meet',kick:[0,1.48,2.77],bass:[0,1.48,2.77],rim:[1.08,3.35]},
  {id:'answers',label:'Bass answers after the kick',kick:[0,1.48,2.77],bass:[.24,1.72,3.01],rim:[1.08,3.35]},
  {id:'push',label:'Bass leads the kick',kick:[.22,1.48,2.77],bass:[0,1.24,2.53],rim:[1.08,3.35]},
  {id:'leave-space',label:'Leave the first downbeat empty',kick:[1.48,2.77],bass:[.59,2.18],rim:[1.1,3.2]},
  {id:'small-pedal',label:'Hold a pedal under sparse drums',kick:[0,2.31],bass:[.03],rim:[1.7,3.4],hold:true},
  {id:'rim-reply',label:'Let the rim answer the call',kick:[0,1.59,2.72],bass:[.45,1.93,3.03],rim:[.86,1.76,3.53]},
  {id:'broken',label:'Displace the second accent',kick:[0,1.16,2.68,3.45],bass:[.13,1.61,2.9],rim:[1.35,2.18,3.62]}
];
function pocket(row) {
  const kick=[note('pre-k',6.11,.11,36,.66),note('pre-k2',9.46,.11,36,.58)],
    bass=[note('pre-b',6.22,.69,41,.57),note('pre-b2',10.19,.58,39,.57)],
    rim=[note('pre-r',6.87,.095,54,.47),note('pre-r2',8.95,.07,54,.45)];
  for (const [i,start] of [12,16].entries()) {
    row.kick.forEach((beat,n)=>kick.push(note('kick-'+i+'-'+n,start+beat,.09,36,n===0 ? .85 : .60)));
    row.bass.forEach((beat,n)=>bass.push(note('bass-'+i+'-'+n,start+beat,row.hold ? 2.84 : .32,
      (i ? 39 : 41)+(n===2 ? 7 : 0),n===0 ? .74 : .58)));
    row.rim.forEach((beat,n)=>rim.push(note('rim-'+i+'-'+n,start+beat,.075,54,n===0 ? .49 : .38)));
  }
  return {kick:{clips:clip(kick,'layer')},bass:{clips:clip(bass)},rim:{clips:clip(rim,'layer')}};
}
const tracks=pocket(gestures[0]), silence={length:1,events:[]};
const source={format:'ink-studio/music-edit-session',version:1,id:'breakwater',sampleRate:rate,
  production:{seed,arrangement:{score:{tempoMap:{tempo,swing:.53},key:{root:'F3',mode:'minor'},
    harmonies:{inlet:{root:'F3',quality:'minor7'},hinge:{root:'Eb3',quality:'major7'}}},
    motifs:{silence},parts:{lead:{role:'lead'},keys:{role:'pad'},bass:{role:'bass'},kick:{role:'percussion'},rim:{role:'percussion'}},
    sections:[{id:'call',bars:2,harmony:'inlet'},{id:'approach',bars:1,harmony:'hinge'},
      {id:'return',bars:2,harmony:'inlet'}]},
    patches:{lead:{type:'subtractive',saw:.18,pulse:.42,sub:.08,filter:{cutoff:1710,keyTrack:.62},
      env:{attack:.031,decay:.39,sustain:.56,release:.28},
      echo:{delay:.367,feedback:.27,width:.58,damping:.68,send:.16}},
      keys:{type:'keys',tine:.8,bite:.38,dust:.09,wear:.24,env:{attack:.009,decay:.46,sustain:.42,release:.69}},
      bass:{type:'subtractive',saw:.13,pulse:.07,sub:.81,filter:{cutoff:343,envAmount:14},
        env:{attack:.009,decay:.32,sustain:.63,release:.19}},kick:{type:'drum',kind:'kick',tune:43,decay:.22,click:.14},
      rim:{type:'drum',kind:'rim',tune:162,decay:.152,click:.39}},
    tracks:{lead:{patch:'lead',gain:-12,pan:.13,send:.41,clips:clip(song)},
      keys:{patch:'keys',gain:-13,pan:-.24,send:.47,clips:clip([
        note('keys-a',.48,1.39,53,.63),note('keys-b',3.04,1.5,60,.61),note('keys-c',6.61,1.59,55,.56),
        note('keys-d',9.93,1.48,63,.61),note('rival',12.68,1.48,67,.79),note('keys-e',15.21,1.72,64,.62),
        note('keys-f',17.47,1.22,56,.51)])},
      bass:{patch:'bass',gain:-16,lowpass:685,send:.042,...tracks.bass},
      kick:{patch:'kick',gain:-13,...tracks.kick},rim:{patch:'rim',gain:-18,pan:-.41,send:.53,...tracks.rim}},
    room:{size:1.22,gain:-9,decay:.75,damping:.72}},
  mixer:{output:'master',tail:'cut',peakPolicy:'error',strips:{master:{},keys:{},lead:{
    inserts:[{processor:'rival-comp',sidechain:{strip:'keys',tap:'pre'}}]
  }},processors:{'rival-comp':{type:'compressor',thresholdDb:-38,ratio:2.8,attack:.018,release:.213}}},
  automation:{'rival-volume':{target:{strip:'keys',parameter:'fader'},unit:'beats',curve:'hold',points:[
    {id:'base',at:0,value:1},{id:'return-in',at:12.5,value:1},{id:'return-out',at:15,value:1}
  ]}}};
const brief={id:'breakwater-one',series:'breakwater',seed,lead:'lead',roles:{bass:'bass',kick:'kick'},
  context:span(0,20),call:span(.95,4.62),recall:span(11.75,16.3),groove:span(11.75,16.5),
  scout:span(11.75,16.65),focus:span(11.25,17.4),
  advance:{sources:8,context:9,disagreement:2},integrity:{attackWindowMs:160,attackFloorDb:-61},
  sources,relationships:gestures.map(row=>({id:row.id,label:row.label,
    family:['answers','push','together'].includes(row.id)?row.id:'broken-'+row.id,revision:{tracks:pocket(row)}}))};
const E=M.musicSession.create(bank);
const result=E.listeningRound(source,brief);
assert.equal(result.value.instrument.attempted,36);
assert(result.ballot && result.value.ensemble.attempted>=35,'Expected a large cross and a blind ballot');
assert(result.value.ensemble.shortlist.some(row=>row.status==='heard' && row.reason==='disagreement'),'Expected a disagreement pick');
const save=(file,session)=>{
  json(file,{session,assets:Object.fromEntries(Object.entries(paths).map(([id,ref])=>[id,path.relative(path.dirname(file),at(ref))]))});
  return {session:file};
};
save(at('session.json'),source);
json(at('brief.json'),brief);
const published=Output.publish(at('round'),result,save);
const selected=result.value.ballot[0].id, reviewed=result.sessions[selected];
const evidenceRequest={focus:span(11.75,16.5),context:span(8,18.5),solo:['lead','keys'],mute:['keys'],
  repairs:[{id:'duck-keys',label:'Lower the keys through the pickup only',edits:[
    {op:'automation',lane:'rival-volume',point:'return-in',value:.23}]},
  {id:'late-ride',label:'Lower the keys one beat later',edits:[
    {op:'automation',lane:'rival-volume',point:'return-in',at:13.5,value:.36}]}]};
const evidence=E.listeningEvidence(reviewed,evidenceRequest);
assert(evidence.clips['lead-in'] && evidence.clips['mute-0'] && evidence.clips['duck-keys']);
const measured=Output.evidence(at('evidence'),evidence);
json(at('evidence/request.json'),evidenceRequest);
save(at('evidence/session.json'),reviewed);

const recipe=JSON.parse(fs.readFileSync(published.preferences,'utf8'));
for (const [name,file] of Object.entries(recipe.clips)) recipe.clips[name]='round/'+file;
const base=evidence.clips.reference, focus=evidence.value.focus, context=evidence.value.context;
const rendered=(id,pcm,a=focus.from-context.from,b=focus.to-context.from)=>{
  const file='controls/'+id+'.wav', sampleRate=pcm.sampleRate;
  write(at(file),WAV.encode({...pcm,samples:pcm.samples.slice(2*a,2*b)},{encoding:'pcm24'}));
  recipe.clips[id]={wav:file,firstSample:context.from+a};
};
const shaped=fn=>({...base,samples:Float64Array.from(base.samples,fn)});
const missing=shaped((value,i)=>{
  const time=i/(2*rate)+context.from/rate, when=13.02*60/tempo;
  const remove=Math.max(0,Math.min(1,(time-when)*225,(when+.47-time)*225));
  return value*(1-remove);
});
const broken=shaped((value,i)=>{
  const time=i/(2*rate)+context.from/rate;
  return time>=13.73*60/tempo && time<14.13*60/tempo ? 0 : value;
});
const rough=shaped(value=>.31*Math.tanh(19*value));
const hardClip=shaped(value=>Math.max(-.23,Math.min(.23,value*4)));
rendered('known-base',base); rendered('known-muted',evidence.clips['mute-0']);
rendered('known-missing',missing); rendered('known-broken',broken); rendered('known-clipped',hardClip);
rendered('rough',rough);
recipe.settings.cases.push(
  {id:'known-balance',criterion:'balance',kind:'known',left:'known-base',right:'known-muted',expected:'right',
    question:'Which version removes the bright accompanying keys but preserves the high lead call?'},
  {id:'known-drop',criterion:'technical',kind:'known',left:'known-base',right:'known-missing',expected:'right',
    question:'Which version has an abrupt short missing piece near the first third, as if audio briefly dropped out?'},
  {id:'known-join',criterion:'technical',kind:'known',left:'known-broken',right:'known-base',expected:'left',
    question:'Which version has a sudden edit and short silence in the middle of its phrase?'},
  {id:'known-clip',criterion:'technical',kind:'known',left:'known-base',right:'known-clipped',expected:'right',
    question:'Which version has hard clipping on peaks, with a more flattened and distorted tone?'},
  {id:'known-rough',criterion:'texture',kind:'known',left:'known-base',right:'rough',expected:'right',
    question:'Which version has the deliberately rougher, more saturated texture?'},
  {id:'rough-preference',criterion:'rough-preference',kind:'preference',left:'known-base',right:'rough',
    question:'Which version suits a cue about a damaged harbor relay? Both textures are deliberate. Choose tie or abstain if needed.'}
);
recipe.settings.gapSeconds=.56;
json(at('listener-recipe.json'),recipe);
execFileSync(process.execPath,[cli,'music','critique','listener-pack',at('listener-recipe.json'),'--out',at('calibration')],{stdio:'inherit'});
const counts={instruments:result.value.instrument.attempted,advanced:result.value.instruments.length,
  crosses:result.value.ensemble.attempted,heard:result.value.ensemble.contextHeard,
  disagreement:result.value.ensemble.shortlist.filter(row=>row.reason==='disagreement' && row.status==='heard').length};
const modelReport=at('model-report.json');
const info={counts,rate,views:evidence.value.views,files:measured.files,model:fs.existsSync(modelReport)};
const html=fs.readFileSync(path.join(__dirname,'batch-listening.html'),'utf8');
write(at('index.html'),html.replace('__REVIEW__',JSON.stringify(info).replace(/</g,'\\u003c')));
console.log(JSON.stringify({folder:out,...counts,selected},null,2));
