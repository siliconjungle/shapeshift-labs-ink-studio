/* Run: node examples/music-production/audio-critique-diagnosis.cjs output-directory */
const assert=require('node:assert/strict'),path=require('node:path');
const {KIT}=require('../..').load(), P=KIT.procedural,A=P.mediaGraph,C=KIT.music.production.critique;
const WAV=require('../../cli/wav.js'),{write,json}=require('../../cli/asset-files.js');
const root=process.argv[2];
if (!root) throw new TypeError('Choose a demo output directory');
const output=path.resolve(root), sampleRate=16000;
const save=(file,value)=>json(path.join(output,file),value);
const wav=(file,value,encoding='pcm24')=>write(path.join(output,file),WAV.encode(value,{encoding}));
const beat=n=>({beat:n}), range=(a,b)=>({from:beat(a),to:beat(b)});
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const clip=(id,notes,mode)=>[{id,beat:0,length:12,voices:[{id:'line',notes}],...(mode && {mode})}];

const samples=Float64Array.from({length:Math.round(sampleRate*.46)},(_,i)=>{
  const t=i/sampleRate-.067;
  if (t<0) return 0;
  const u=Math.min(1,t/.008), tau=Math.PI*2;
  return u*(.62*Math.sin(tau*73.416*t)+.13*Math.sin(tau*146.832*t)+
    .055*Math.sin(tau*440.5*t))*Math.exp(-5.8*t);
});
wav('late-bass.wav',{sampleRate,channels:1,samples},'float32');
const assets={strike:WAV.read(path.join(output,'late-bass.wav'))};
const reed={type:'graph',tail:.12,output:'out',nodes:{
  carrier:{type:'oscillator',wave:'sine'},
  edge:{type:'oscillator',wave:'sine',ratio:2.003},
  rim:{type:'gain',input:'edge',amount:.15},sum:{type:'mix',inputs:['carrier','rim']},
  env:{type:'envelope',env:{attack:.015,decay:.12,sustain:.68,release:.12}},
  out:{type:'gain',input:'sum',amount:{base:0,from:{env:.63}}}
}};
const production={seed:602,room:{gain:-15,size:.9,decay:.68,damping:.61},arrangement:{
  score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:120},endFade:.15,harmonies:{home:{root:'D3',quality:'minor'}}},
  motifs:{guide:{length:1,events:[note('off',0,.1,60,0)]}},
  parts:Object.fromEntries([['hook','lead'],['keys','pad'],['bass','bass'],['kick','percussion'],['rim','percussion']]
    .map(([part,role])=>[part,{role,material:'guide'}])),
  sections:[{id:'approach',bars:1,harmony:'home'},{id:'return',bars:1,harmony:'home'},{id:'after',bars:1,harmony:'home'}]
},patches:{
  reed,keys:{type:'keys',bite:.5,wear:.51,dust:.05,env:{attack:.003,decay:.27,sustain:.55,release:.17}},
  bass:{type:'sample',zones:[{samples:['strike'],root:38,oneShot:false}],env:{attack:.001,decay:.18,sustain:.83,release:.07}},
  kick:{type:'drum',kind:'kick',tune:49,decay:.18,click:.32},rim:{type:'drum',kind:'rim',tune:206,decay:.10,click:.5}
},tracks:{
  hook:{patch:'reed',gain:-12.7,pan:.09,send:.22,highpass:130,clips:clip('hook',[
    note('hint',2.17,.46,69,.56),note('answer',2.8,.64,72,.53),
    note('return-a',4.15,.51,74,.79,{vibrato:13}),note('return-b',4.82,.61,77,.63,{vibrato:14}),
    note('return-c',5.52,.45,76,.67,{vibrato:16}),note('return-d',6.43,1.11,69,.76,{vibrato:11}),
    note('fall',9.6,.72,65,.56)])},
  keys:{patch:'keys',gain:-11,pan:-.08,highpass:130,send:.20,clips:clip('figure',[
    note('first',1.48,.65,65,.56),note('pre',3.56,.42,69,.59),
    note('cover-a',4.11,.66,74,.83),note('cover-b',4.82,.66,77,.76),
    note('cover-c',5.5,.67,76,.82),note('cover-d',6.34,.93,69,.79),note('out',9.82,.62,65,.56)])},
  bass:{patch:'bass',gain:-10,lowpass:420,clips:clip('pocket',[
    note('wait',2.21,.68,38,.51),note('target',4,.77,38,.97,{delay:.093}),
    note('hold',5.25,.65,38,.55),note('shift',6.5,.78,36,.59),note('return',9,.72,38,.5)])},
  kick:{patch:'kick',gain:-13.2,clips:clip('drums',[
    note('pre',2.21,.09,36,.57),note('target',4,.10,36,.87),note('hit',5.25,.10,36,.68),
    note('hit2',6.5,.10,36,.81),note('out',9,.10,36,.55)],'layer')},
  rim:{patch:'rim',gain:-17.8,pan:-.3,send:.28,clips:clip('rim',[
    note('pre',3.02,.08,41,.57),note('answer',4.69,.08,41,.64),note('reply',5.91,.08,41,.54),
    note('later',6.93,.08,41,.57)],'layer')}
}};
const session={format:'ink-studio/music-edit-session',version:1,id:'night-crossing',sampleRate,production,
  pins:{hook:'pitch'},mixer:{output:'master',strips:{master:{},rim:{output:'rhythm'},kick:{output:'rhythm'},rhythm:{fader:.93}},
    peakPolicy:'error'}};
save('session.json',{session,assets:{strike:'late-bass.wav'}});
const studio=C.openAudio(session,assets);
const shared={range:range(4,8),context:{beforeBeats:2.5,afterBeats:.6},lead:'hook',level:'fixed'};
const requests={
  masking:{...shared,test:{kind:'masking',track:'keys',duckDb:-10,holdMs:220}},
  groove:{...shared,test:{kind:'groove',anchor:'kick',track:'bass',note:{clip:'pocket',voice:'line',note:'target'},accent:.46}}
};
const results={};
for (const [kind,request] of Object.entries(requests)) {
  const result=studio.diagnose(request);
  assert.equal(result.report.takes.length,4,JSON.stringify(result.report.blocked));
  results[kind]=result;
  const files=Object.fromEntries(Object.entries(result.audio).map(([id,pcm])=>{
    const file=id+'.wav'; wav(kind+'/'+file,pcm); return [id,file];
  }));
  save(kind+'/request.json',request);
  save(kind+'/comparison.json',result.key);
  save(kind+'/report.json',{...result.report,files});
}
const choice={token:results.groove.key.token,take:'sample-attack',
  reason:'Demonstrate removing silent sample lead-in while preserving the original trigger and accent.'};
const kept=C.applyEdit(session,results.groove.key,choice,assets);
save('kept-session.json',{session:kept.session,assets:{strike:'late-bass.wav'}});
save('decision.json',kept.reference);

function reel(name,result) {
  const skins={}, clips=[], sections=[];
  let cursor=0;
  for (const {id,label} of result.report.takes) {
    const pcm=result.audio[id], frames=pcm.samples.length/pcm.channels;
    skins[id]=pcm;
    clips.push({id,source:id,gainDb:6,at:{samples:cursor}});
    sections.push({id,label,start:cursor/sampleRate,end:(cursor+frames)/sampleRate});
    cursor+=frames+Math.round(sampleRate*.32);
  }
  const mix=A.mixer.render({id:name,sampleRate,output:'master',strips:{master:{clips}}},skins);
  wav(name+'.wav',mix.value);
  save(name+'.json',{sections});
}
reel('masking-comparison',results.masking);
reel('groove-comparison',results.groove);

const listenerClips={}, cases=[];
function capture(kind,id,range) {
  const {audio,report}=results[kind], pcm=audio[id];
  const from=range?.[0] ?? report.focus.firstSample, to=range?.[1] ?? report.focus.endSample;
  const first=(from-report.context.firstSample)*pcm.channels,end=(to-report.context.firstSample)*pcm.channels;
  const name=kind+'-'+id, file='listener-clips/'+name+'.wav';
  wav(file,{...pcm,samples:pcm.samples.slice(first,end)});
  listenerClips[name]={wav:file,firstSample:from};
  return name;
}
const masking=capture('masking','reference'), groove=capture('groove','reference');
const test=(id,criterion,question,left,right)=>cases.push({id,kind:'known',criterion,question,left,right,expected:'right'});
test('masking','balance','Which version removes the competing midrange keyboard part and leaves the high melody more exposed?',
  masking,capture('masking','mute-rival'));
test('accent','accent','In which version is the first bass note softer relative to the first kick?',groove,capture('groove','accent'));
test('timing','timing','Which version brings the first bass attack closer in time to the first kick? Listen only to the first hit.',
  groove,capture('groove','timing'));
test('sample-attack','timing','Which version lets the first bass sound arrive earlier after the first kick?',
  groove,capture('groove','sample-attack'));
const texture={sampleRate,channels:1,samples:Float64Array.from({length:sampleRate},(_,i)=>{
  const t=i/sampleRate, harmonic=Math.sin(2*Math.PI*184*t);
  return .48*Math.sin(Math.PI*t)**1.7*harmonic;
})};
const rough={...texture,samples:Float64Array.from(texture.samples,(y,i)=>{
  const t=i/sampleRate;
  return .5*Math.tanh(y*7+.09*Math.sin(2*Math.PI*1197*t))*Math.sin(Math.PI*t)**.65;
})};
const rms=pcm=>Math.sqrt(pcm.samples.reduce((sum,n)=>sum+n*n,0)/pcm.samples.length);
const trim=rms(texture)/rms(rough);
for (const [id,pcm] of [['smooth',texture],['rough',rough]]) {
  const file='listener-clips/'+id+'.wav';
  wav(file,id==='rough' ? {...pcm,samples:Float64Array.from(pcm.samples,y=>y*trim)} : pcm);
  listenerClips[id]={wav:file};
}
test('roughness','texture','Which has an audibly more buzzy and rough sustained tone?', 'smooth','rough');
cases.push({id:'deliberate-roughness',kind:'preference',criterion:'rough-preference',
  question:'Which sustained tone would you choose for an eerie scraped texture? Acknowledge uncertainty if you have no preference.',
  left:'smooth',right:'rough'});
save('listener-recipe.json',{clips:listenerClips,settings:{id:'night-crossing',seed:608,cases,gapSeconds:.55}});
console.log(JSON.stringify({masking:path.join(output,'masking-comparison.wav'),groove:path.join(output,'groove-comparison.wav'),
  listener:path.join(output,'listener-recipe.json')}));
