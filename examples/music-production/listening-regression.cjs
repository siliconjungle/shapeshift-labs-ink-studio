/* Run: node examples/music-production/listening-regression.cjs output-directory */
const path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load();
const A=KIT.music.production,WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
if (!process.argv[2]) throw new TypeError('Choose an output directory for the listening and rehearsal demo');
const out=path.resolve(process.argv[2]), rate=12000;
const cli=(...args)=>{
  const text=execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music',...args],{encoding:'utf8'});
  return text.trim() ? JSON.parse(text) : undefined;
};
const jsonAt=(name,value)=>{const file=path.join(out,name);json(file,value);return file;};
const wavAt=(name,value)=>write(path.join(out,name),WAV.encode(value,{encoding:'pcm24'}));
function sequence(file,pieces) {
  const clips=[],assets={};
  let cursor=0;
  for (const [i,pcm] of pieces.entries()) {
    const source='clip-'+i;
    assets[source]=pcm;
    clips.push({id:source,source,at:{samples:cursor}});
    cursor+=pcm.samples.length/pcm.channels+Math.round(.36*rate);
  }
  wavAt(file,KIT.procedural.mediaGraph.mixer.render({id:'listening-demo',sampleRate:rate,output:'master',strips:{master:{clips}}},assets).value);
}

const motif=(rows,length=4)=>({length,events:rows.map(([beat,duration,midi,velocity])=>({beat,duration,midi,velocity}))});
const line=[[.12,.3,74,.76],[.58,.29,77,.61],[1.03,.54,81,.83]];
const lean=[[.12,.3,74,.76],[.58,.29,79,.64],[1.11,.42,76,.83]];
const reverse=[[.12,.22,69,.68],[.85,.61,72,.58]];
const pedal=[[.06,.62,38,.66],[1.84,.65,45,.61],[3.15,.44,38,.66]];
const drums=[[0,.22,36,.84],[1.51,.16,36,.48],[2.68,.26,36,.66]];
const score={tempoMap:{tempo:120},key:{root:'D3',mode:'minor'},
  harmonies:{home:{root:'D3',quality:'minor'}},endFade:0};
function cue(pattern,{pace=pedal,bite=.37,beat=drums,tag='body',room=-15,full=false,call='base'}={}) {
  return {seed:574,arrangement:{score,sections:full ? [
    {id:'approach',bars:1,harmony:'home',parts:{lead:'small'}},
    {id:'return',bars:2,harmony:'home',parts:{lead:call}}] : [{id:tag,bars:1,harmony:'home'}],
  motifs:{base:motif(pattern),small:motif(reverse),alternate:motif(lean),
    low:motif(pace),pulse:motif(beat)},
  parts:{lead:{role:'lead',material:'base'},bass:{role:'bass',material:'low'},drums:{role:'percussion',material:'pulse'}}},
  patches:{glass:{type:'fm',ratio:2.01,index:bite,env:{attack:.008,decay:.27,sustain:.65,release:.19}},
    sub:{type:'subtractive',saw:.65,pulse:.12,filter:{cutoff:610},sub:.48,env:{attack:.009,decay:.3,sustain:.64,release:.14}},
    kick:{type:'drum',kind:'kick',tune:49,decay:.19,click:.28}},
  tracks:{lead:{patch:'glass',gain:-11.5,pan:.09,send:.26},bass:{patch:'sub',gain:-12,highpass:35},
    drums:{patch:'kick',gain:-13,send:.12}},room:{gain:room,size:.95,damping:.64,decay:.65}};
}

const production=cue(line,{full:true}), productionFile=jsonAt('production.json',{production});
const brief={section:'return',kind:'custom',goal:'Choose the call and the shape of its return.',
  sampleRate:rate,leadInBeats:3.5,focusBeats:4,criterion:'identity',
  listeningContext:{scene:'night-ferry',moment:'return',role:'lead'},
  takes:[
    {id:'wide-answer',hypothesis:'Turn the three-note call downward so it can recur across scenes.',
      revision:{edits:[{section:'return',part:'lead',scope:'section',adopt:motif(lean)}]}},
    {id:'held-arrival',hypothesis:'Hold the low end back for the opening phrase of the return.',
      revision:{cueMap:{silence:[{from:4,to:5.55,parts:['bass','drums'],mode:'ring'}]}}},
    {id:'room-edge',hypothesis:'Let the tail recede on the first two beats.',
      revision:{cueMap:{room:[{from:4,to:6,parts:['lead'],send:.12}]}}}
  ]};
const plan=A.critique.plan(production,brief);
assert.deepEqual(plan.blocked,[]);
const planFile='listening-plan.json';
jsonAt(planFile,plan);
const questions=[
  {id:'recognize-call',plan:planFile,criterion:'identity',
    question:'Which three-note call would you recognize when it returns later in the cue?',
    moves:['reference','wide-answer'],later:{fromBeat:8,toBeat:12},impacts:{'lead-performance':3,'return-orchestration':2,'hook-in-world':3}},
  {id:'earned-arrival',plan:planFile,criterion:'shape',
    question:'Which return feels earned after this lead-in?',
    moves:['reference','held-arrival'],impacts:{'return-orchestration':2,'low-end-entry':3}},
  {id:'room-tail',plan:planFile,criterion:'identity',
    question:'Which tail closes the phrase more clearly?',
    moves:['reference','room-edge'],impacts:{'room-tail':1}}
];
const preference=cli('critique','prioritize',productionFile,jsonAt('questions.json',{questions,options:{budget:2,seed:96}}),
  '--out',path.join(out,'listening'));
const queue=require(preference.manifest);
assert.equal(queue.selected.length,2);
const blind=queue.selected[0].files.manifest, publicDir=path.dirname(blind);
const pair=require(blind).trials[0].takes;
sequence('blind-comparison.wav',pair.map(label=>WAV.read(path.join(publicDir,label+'.wav'))));

const sources={wait:cue(reverse),reveal:cue(line),bypass:cue([[.42,.2,65,.39],[1.77,.44,67,.55]],{bite:.23}),
  waitTwo:cue([[.29,.31,69,.57],[1.33,.54,76,.64]],{pace:[[.12,1.06,41,.62]],bite:.25}),
  waitThree:cue([[.19,.28,72,.52],[1.59,.74,69,.59]],{pace:[[1,.65,38,.60]],beat:[[2,.20,36,.68]],bite:.56}),
  waitFour:cue([[.72,.59,65,.58],[2.21,.41,74,.58]],{pace:[[.5,1.2,43,.60]],room:-10}),
  waitFive:cue([[1.2,.39,64,.55]],{pace:[[.32,.65,41,.58],[2.08,.42,48,.58]],bite:.45}),
  hit:cue([[0,.42,86,.93]],{pace:[],beat:[],bite:1.14})};
const timeline={entry:'wait',end:9,segments:{wait:{source:'wait'},reveal:{source:'reveal'},
  bypass:{source:'bypass'},mark:{source:'hit',end:.46,loop:false,gain:3}},stingers:{latch:'mark'}};
const condition=(name,value)=>({path:'/parameters/'+name,op:'gte',value});
const adaptive={entry:'wait',tempo:120,sections:Object.fromEntries(['wait','reveal','bypass'].map(name=>[name,{resource:name}])),
  parameters:{open:{default:0},reverse:{default:0}},cues:{latch:{resource:'latch'}},transitions:[
    {id:'approach',from:'wait',to:'reveal',quantize:'beat',when:condition('open',.5)},
    {id:'back-out',from:'reveal',to:'bypass',quantize:'beat',when:condition('reverse',.5)},
    {id:'retry',from:'bypass',to:'reveal',quantize:'beat',when:{path:'/parameters/reverse',op:'lt',value:.5}}
  ]};
const scenarios=[
  {id:'reversal',count:72,end:[6.21,6.7],updates:[
    {time:[.65,.86],parameters:{open:1}},{time:[1.68,1.9],parameters:{reverse:1}},
    {time:[2.13,2.38],parameters:{reverse:0}}]},
  {id:'dwell',count:72,end:[8.08,9.18]},
  {id:'interruption',count:72,end:[4.3,5.4],updates:[
    {time:[1.65,1.9],parameters:{open:1}},{time:[2.086,2.18],cues:[{cue:'latch'}]}]}
];
const hookRepair={id:'skip-the-repeated-call',transitions:[{from:'bypass',to:'reveal',entry:.87}]};
const dwellRepair={id:'rotate-wait-material',phrasing:{listen:{wait:['lead','bass']},
  routes:{wait:[
    {id:'wait-five',source:'waitFive',when:{heard:[{phrase:'wait-four',min:1}]}},
    {id:'wait-four',source:'waitFour',when:{heard:[{phrase:'wait-three',min:1}]}},
    {id:'wait-three',source:'waitThree',when:{heard:[{phrase:'wait-two',min:1}]}},
    {id:'wait-two',source:'waitTwo',when:{heard:[{phrase:'wait',min:1}]}}
  ]}}};
const stingerRepair={id:'leave-the-call-clear',stingerRules:[{section:'reveal',resource:'latch',linked:false}]};
const fix={id:'revised',transitions:hookRepair.transitions,phrasing:dwellRepair.phrasing,stingerRules:stingerRepair.stingerRules};
const suite={seed:7744,scenarios,variants:[fix],options:{sampleRate:rate,before:1.25,after:1.75,radius:.18,limit:6,
  listenFor:['early-hook-return','exhausted-dwell','hook-collision'],watchTracks:['lead'],checks:{
    hooks:[{id:'ferry-call',segments:['reveal'],sources:['reveal'],tracks:['lead'],minGap:1.76,repair:hookRepair}],
    dwells:[{id:'ferry-wait',segment:'wait',tracks:['lead'],maxConsecutive:2,repair:dwellRepair}]},
  maxAffected:{'early-hook-return':0,'exhausted-dwell':0,'hook-collision':0}}};
const rehearsed=cli('rehearsal','regression',jsonAt('timeline.json',{sources,timeline,adaptive:{score:adaptive}}),
  jsonAt('routes.json',suite),'--out',path.join(out,'rehearsal'),'--assert','revised');
const report=require(rehearsed.manifest);
const selected=['early-hook-return','exhausted-dwell','hook-collision'].map(family=>{
  const group=report.groups.find(group=>group.family===family);
  assert(group && group.versions[0].routes===72 && group.versions[1].routes===0);
  return report.listening.find(row=>row.key===group.key);
});
const folder=path.dirname(rehearsed.manifest);
sequence('rehearsal-comparison.wav',selected.flatMap(join=>join.takes.map(take=>WAV.read(path.join(folder,take.file)))));
for (const [i,join] of selected.entries()) {
  const names=['reversal','dwell','stinger'];
  sequence(names[i]+'-before-after.wav',join.takes.map(take=>WAV.read(path.join(folder,take.file))));
}
jsonAt('rehearsal/selected-fix.json',fix);
cli('rehearsal','keep',path.join(out,'timeline.json'),path.join(out,'rehearsal','selected-fix.json'),
  '--out',path.join(out,'rehearsal','revised-timeline.json'));
console.log(JSON.stringify({listening:preference.manifest,regression:rehearsed.manifest},null,2));
