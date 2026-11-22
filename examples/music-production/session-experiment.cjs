/* Run: node examples/music-production/session-experiment.cjs output-directory [--scouts] */
const assert=require('node:assert/strict'), path=require('node:path');
const {KIT}=require('../..').load(), A=KIT.procedural.mediaGraph;
const {json,write}=require('../../cli/asset-files.js'), WAV=require('../../cli/wav.js');
const [folder,flag]=process.argv.slice(2);
if (!folder) throw new TypeError('Choose an output directory');
const out=path.resolve(folder), rate=24000, tempo=120, body=48, root=62, seed=1717;
const audio=(relative,value,encoding='pcm24')=>{
  write(path.join(out,relative),WAV.encode(value,{encoding}));
  return relative;
};
const save=(relative,value)=>json(path.join(out,relative),value);
const bar=(from,to)=>({from:{bar:from},to:{bar:to}});
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const clips=(notes,mode)=>[{id:'line',beat:0,length:body,voices:[{id:'player',notes}],...(mode && {mode})}];
const form=[{id:'approach',bars:2,harmony:'minor'},{id:'return',bars:8,harmony:'minor'},{id:'wake',bars:2,harmony:'open'}];

const source=A.synthesizeGesture({model:'breath',sampleRate:rate,seed,duration:.72,
  parameters:{pitchStart:238,pitchEnd:281,voice:.94,throat:1300,roughTail:.68}}).value;
const treatments=[
  ['short-contact','attack','Dry onset',.06],['rubbed-contact','attack','Rubbed onset',.31],['long-contact','attack','Sliding onset',.62],
  ['steady-reed','contour','Steady reed',.02],['bent-reed','contour','Bent reed',.22],['open-reed','contour','Open reed',.47],
  ['early-breath','handoff','Early breath tail',.04,'breath',.45],['split-breath','handoff','Split breath tail',.2,'breath',.62],
  ['late-breath','handoff','Late breath tail',.37,'breath',.79],['early-wire','handoff','Early wire tail',.03,'wire',.48],
  ['split-wire','handoff','Split wire tail',.17,'wire',.66],['late-wire','handoff','Late wire tail',.31,'wire',.81]
];
const bank=A.playableSound.build(source,{id:'tide-call',seed,fit:{attackMs:41},
  variants:treatments.map(([id,family,label,motion,tail,phase])=>({id,family,label,motion,
    ...(tail && {tail,phase,blend:.16,tailDb:tail==='wire' ? -20 : -15})}))});
const leadPatch=(patch,i)=>({...patch,performance:{connect:{gap:.075,interval:12,fade:[.015,.033,.058][i%3]},
  repeatGap:.15,rules:[{when:'legato',glide:[.046,.071,.106][i%3]}]},
  echo:{delay:.375,feedback:.23,damping:.74,send:.16,width:.57,wow:.055}});
const sound=treatments.map(([id,family,label,,tail],i)=>({id,label,
  family:tail ?? family,
  revision:{patches:{lead:leadPatch(bank.value.candidates[id].patch,i)}}}));

const patterns=[
  {id:'locked-step',label:'Kick and bass strike together',kick:[0,1.5,2.75],bass:[0,1.5,2.75],rim:[1.0,3.43]},
  {id:'late-bass',label:'Bass answers ninety milliseconds later',kick:[0,1.5,2.75],bass:[.18,1.68,2.93],rim:[1.0,3.43]},
  {id:'withheld',label:'Both leave the expected downbeat empty',kick:[0,1.5,2.75],bass:[0,1.5,2.75],rim:[1.16,3.42],withhold:true},
  {id:'bass-pickup',label:'Bass pushes into the kick',kick:[.17,1.50,2.77],bass:[0,1.33,2.6],rim:[1.08,3.34]},
  {id:'pedal',label:'One long bass holds underneath sparse drums',kick:[0,2.48],bass:[.27],rim:[1.5,3.5],hold:true},
  {id:'rim-answer',label:'Rim strokes answer the melody',kick:[0,2.64],bass:[.42,2.30],rim:[1.4,2.9,3.66]},
  {id:'broken',label:'Alternate broken-beat accents',kick:[0,.81,2.52,3.24],bass:[.76,1.8,2.8],rim:[1.28,3.51]},
  {id:'exposed',label:'Give the call the first two bars',kick:[0,1.75],bass:[.18,2.67],rim:[1.39,3.62],expose:true}
];
const bassLine=(beat,n,velocity,id)=>note(id,beat,.68,n,velocity);
function pocket(pattern) {
  const kick=[note('pre-k',1.5,.1,36,.6),note('pre-kk',5.65,.1,36,.68),note('post-k',42.5,.12,36,.54)];
  const bass=[bassLine(2.25,38,.54,'pre-b'),bassLine(5.65,38,.53,'pre-bb'),bassLine(42.5,36,.47,'post-b')];
  const rim=[note('pre-r',3.04,.11,54,.46),note('pre-rr',6.84,.10,54,.52),note('post-r',44.3,.11,54,.40)];
  for (let bar=0;bar<8;bar++) {
    const first=8+bar*4, bassNote=[38,38,36,36,34,36,38,41][bar];
    const omit=beat=>pattern.withhold && bar%2===0 && beat===0;
    if (pattern.expose && bar<2) continue;
    pattern.kick.forEach((beat,i)=>{
      if (!omit(beat)) kick.push(note('k-'+bar+'-'+i,first+beat,.074,36,i===0 ? .89 : .66));
    });
    pattern.bass.forEach((beat,i)=>{
      if (!omit(beat)) bass.push(note('b-'+bar+'-'+i,first+beat,pattern.hold ? 2.86 : Math.min(.62,3.98-beat),
        bassNote+(i===2 && bar%2 ? 7 : 0),i===0 ? .79 : .65));
    });
    pattern.rim.forEach((beat,i)=>rim.push(note('r-'+bar+'-'+i,first+beat,.071,54,i===1 ? .56 : .37)));
  }
  return {kick:{clips:clips(kick,'layer')},bass:{clips:clips(bass)},rim:{clips:clips(rim,'layer')}};
}
const phrase=patterns.map(pattern=>({id:pattern.id,label:pattern.label,revision:{tracks:pocket(pattern)}}));
const hook=[];
const accents=[.79,.56,.71,.54];
for (let pair=0;pair<4;pair++) {
  const first=8+pair*8;
  const shape=pair%2 ? [[.18,.69,62],[.87,.64,65],[1.51,1.07,67],[4.92,1.48,64]] :
    [[.18,.69,62],[.87,.64,65],[1.51,1.07,69],[4.92,1.48,67]];
  shape.forEach(([beat,gate,key],i)=>hook.push(note('hook-'+pair+'-'+i,first+beat,gate,key,accents[i],
    {curves:{breath:[[0,.37],[.38,.70],[1,.21]],gainDb:[[0,-1.2],[.32,0],[1,-3]]}})));
}
hook.push(note('wake',41.13,2.36,60,.42,{curves:{breath:[[0,.23],[.5,.48],[1,.12]]}}));
const guide={length:1,events:[note('silent',0,.1,root,0)]};
const production={seed,arrangement:{
  score:{key:{root,mode:'minor'},tempoMap:{tempo},endFade:.46,harmonies:{
    minor:{root:'D3',quality:'minor'},open:{root:'C3',quality:'major'}
  }},motifs:{guide},
  parts:Object.fromEntries([['lead','lead'],['keys','pad'],['bass','bass'],['kick','percussion'],['rim','percussion']]
    .map(([name,role])=>[name,{role,material:'guide'}])),
  sections:form
},patches:{
  lead:{type:'subtractive',saw:.23,pulse:.46,sub:.11,env:{attack:.024,decay:.26,sustain:.52,release:.24}},
  bass:{type:'analog',body:.32,drive:1.12,env:{attack:.007,decay:.27,sustain:.44,release:.12}},
  kick:{type:'drum',kind:'kick',tune:49,decay:.224,click:.109},rim:{type:'drum',kind:'rim',tune:173,decay:.133,click:.45,color:.71},
  glass:{type:'keys',tine:.76,bite:.36,wear:.42,dust:.08,env:{attack:.028,decay:.45,sustain:.31,release:.55}}
},tracks:{
  lead:{patch:'lead',gain:-8,pan:.06,send:.32,highpass:146,clips:clips(hook)},
  bass:{patch:'bass',gain:-13,lowpass:540,send:.05},
  kick:{patch:'kick',gain:-10,send:.06},rim:{patch:'rim',gain:-16,pan:-.28,send:.48,highpass:260},
  keys:{patch:'glass',gain:-18,send:.61,pan:.17,highpass:180,lowpass:5100,clips:clips([
    note('glow-a',.54,1.71,57,.56),note('glow-b',4.26,2.13,64,.50),note('keys-a',9.7,1.71,72,.45),
    note('keys-b',14.58,1.86,69,.54),note('keys-c',18.81,1.49,64,.43),note('keys-d',25.69,1.63,72,.53),
    note('keys-e',30.1,2.3,67,.56),note('keys-f',34.58,1.85,64,.50),
    note('keys-g',39.79,1.79,67,.36),note('keys-h',45.27,1.73,64,.41)
  ])}
},room:{size:1.24,gain:-12.4,decay:.85,damping:.48}};
const basePocket=pocket(patterns[0]);
for (const [name,track] of Object.entries(basePocket)) Object.assign(production.tracks[name],track);
const usedAssets={'fitted-attack':bank.assets['fitted-attack']};
const paths=Object.fromEntries(Object.entries(usedAssets).map(([name,pcm])=>
  [name,audio('samples/'+name+'.wav',pcm,'float32')]));
const assets=Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,WAV.read(path.join(out,file))]));
const session={format:'ink-studio/music-edit-session',version:1,id:'tide-relay',sampleRate:rate,production,
  pins:{keys:'all'},mixer:{output:'master',strips:{master:{},kick:{output:'drums'},rim:{output:'drums'},
    drums:{inserts:['drum-weight']}},processors:{'drum-weight':{type:'compressor',thresholdDb:-20,ratio:2.3,
      attack:.018,release:.092}},peakPolicy:'error'}};
const brief={id:'tide-relay-return',seed,goal:'Find distinct pockets for the same eight-bar hook.',
  focus:bar(2,10),context:bar(0,12),roles:{hook:'lead',kick:'kick',bass:'bass'},axes:{sound,phrase},
  targets:{hookDb:-2,contrastDb:9,kickBass:.36},advance:{limit:11,disagreement:2,diversity:['phrase','sound']}};
save('session.json',{session,assets:paths});
save('brief.json',brief);
const E=A.musicSession.create(assets);
function campaign(name,base,settings,scouts=false) {
  const files={scouts:{},context:{}};
  const options=scouts ? {onScout(id,pcm) {
    const file='scouts/'+id+'.wav';
    audio(name+'/'+file,pcm,'pcm16');
    files.scouts[id]=file;
  }} : {};
  const {value,clips}=E.experiment(base,settings,options);
  for (const [id,clip] of Object.entries(clips)) {
    const file=id+'.wav';
    audio(name+'/'+file,clip);
    files.context[id]=file;
  }
  save(name+'/report.json',{...value,files});
  console.log(JSON.stringify({id:value.id,attempted:value.attempted,scoutRenders:value.scoutRenders,contextHeard:value.contextHeard}));
  return {report:value,clips};
}
const matrix=campaign('matrix',session,brief,flag==='--scouts');
assert.equal(matrix.report.scoutRenders,96);
assert.equal(matrix.report.candidates.filter(row=>['scouted','advanced'].includes(row.status)).length,96);
const heard=matrix.report.shortlist.filter(row=>row.status==='heard').map(row=>
  matrix.report.candidates.find(candidate=>candidate.id===row.id));
const named=family=>heard.find(row=>row.axes.phrase.id===family);
const anchor=named('late-bass') ?? heard[0];
const fork=E.keepExperiment(session,matrix.report,{candidate:anchor.id,
  reason:'Use this heard pocket as the fixed example for the cue setup comparison.'});
save('cue-anchor.json',{session:fork.value,assets:paths});
save('cue-anchor-decision.json',fork.decision);
const preQuote={id:'quote',beat:0,length:8,mode:'layer',voices:[{id:'player',notes:[
  note('pitch-a',3.13,.56,62,.51),note('pitch-b',3.69,.81,65,.43)
]}]};
const cue={...brief,id:'tide-relay-setup',goal:'Compare where the listener first hears the call and the pulse.',
  axes:{cue:[
    {id:'early-quote',label:'Hint at the hook in the approach',revision:{tracks:{lead:{clips:[...clips(hook),preQuote]}}}},
    {id:'late-pulse',label:'Withhold kick and bass until the return',revision:{cueMap:{silence:[{parts:['kick','bass'],from:0,to:8}]}}},
    {id:'exposed-approach',label:'Leave the approach to the call and the keys',revision:{
      tracks:{lead:{clips:[...clips(hook),preQuote]}},cueMap:{silence:[{parts:['kick','bass','rim'],from:0,to:8}]}}}
  ]},advance:{limit:3,disagreement:0,diversity:['cue']}};
save('cue-brief.json',cue);
const setups=campaign('cue',fork.value,cue);

function reel(file,entries,gainDb) {
  const assets={}, clips=[], spans=[];
  let at=0;
  for (const {id,label,value,from,to} of entries) {
    const first=Math.round(from*rate), last=Math.round(to*rate);
    const trimmed=value.samples.slice(first*2,last*2);
    for (let i=0;i<trimmed.length;i+=2) {
      const fade=Math.min(1,(i/2)/(rate*.024),(trimmed.length-i-2)/(rate*.036*2));
      trimmed[i]*=fade;
      trimmed[i+1]*=fade;
    }
    assets[id]={...value,samples:trimmed};
    clips.push({id,source:id,at:{samples:at},gainDb});
    spans.push({id,label,start:at/rate,end:(at+trimmed.length/2)/rate});
    at+=trimmed.length/2+Math.round(rate*.42);
  }
  const mix=A.mixer.render({id:file,sampleRate:rate,output:'master',strips:{master:{clips}}},assets).value;
  audio(file+'.wav',mix);
  save(file+'.json',{spans});
}
const contrast=[named('locked-step'),named('late-bass'),named('withheld')].filter(Boolean);
for (const row of heard) if (contrast.length<3 && !contrast.includes(row)) contrast.push(row);
reel('pocket-comparison',contrast.map(row=>({id:row.id,label:row.axes.phrase.label,
  value:matrix.clips[row.id],from:3.62,to:8.45})),9);
reel('cue-comparison',[
  {id:'reference',label:'Original approach',value:setups.clips.reference,from:.7,to:6.15},
  ...setups.report.shortlist.filter(row=>row.status==='heard' && row.id!=='take-003').map(row=>({id:row.id,
    label:setups.report.candidates.find(candidate=>candidate.id===row.id).axes.cue.label,value:setups.clips[row.id],from:.7,to:6.15}))
],9);
