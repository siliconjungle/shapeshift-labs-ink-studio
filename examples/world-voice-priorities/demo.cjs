const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
if(!process.argv[2]||!process.argv[3])throw Error('Use node demo.cjs <output-directory> <dialogue.wav> [ink-studio-repository]');
const repo=path.resolve(process.argv[4]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const ink=require(repo), {world:W}=ink.load().KIT, rate=48000, dt=.05;
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name);
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});

fs.mkdirSync(out,{recursive:true});
const dialogue=fs.readFileSync(path.resolve(process.argv[3]));
ink.decodeWav(dialogue);
fs.writeFileSync(file('dialogue.wav'),dialogue);
const sine=(hz,t)=>Math.sin(2*Math.PI*hz*t);
function make(name,duration,voice){
  const samples=Float32Array.from({length:Math.round(rate*duration)},(_,i)=>voice(i/rate));
  fs.writeFileSync(file(name+'.wav'),ink.encodeWav({samples,channels:1,sampleRate:rate}));
}
function noise(seed){
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
}
const drops=noise(114);
let smooth=0;
make('rain',1,t=>{
  smooth+=(drops()-smooth)*.21;
  return .14*smooth*(.7+.3*sine(8,t));
});
const bustle=noise(75);
let voices=0;
make('crowd',.47,t=>{
  voices+=(bustle()-voices)*.053;
  return Math.min(1,t/.02)*Math.exp(-t/.15)*(.34*voices+(.3+.7*sine(9,t)**2)*.09*sine(199,t));
});
const hits=noise(157);
make('collision',.56,t=>Math.min(1,t/.002)*(
  .16*hits()*Math.exp(-t/.026)+.28*sine(157,t)*Math.exp(-t/.11)+.12*sine(508,t)*Math.exp(-t/.07)));
make('warning',.55,t=>{
  const age=t%.22, window=Math.max(0,Math.min(1,age/.01,(.15-age)/.018));
  return .78*window*(.82*sine(776,t)+.18*sine(1227,t));
});
make('feedback',.18,t=>Math.min(1,t/.004)*Math.exp(-t/.041)*.72*sine(t<.065?590:960,t));

const critical=['warning','dialogue','feedback'];
const commands=[];
function event(tick,cue,at,gain=1){
  commands.push({tick,action:'world/event',args:W.timedEvents.at(tick/20-.0125,{kind:'audio-cue',cue,gain,at})});
}
for(let tick=6;tick<=72;tick+=4){
  for(let k=0;k<7;k++)event(tick,'collision',[-2+(k%5),1,-1.9-(k%3)*.23],.72+(k%4)*.12);
  for(let k=0;k<5;k++)event(tick+1,'crowd',[-2.4+k,1,-2.7],.81+(k%3)*.12);
}
event(23,'warning',[-.45,1,-1]);
event(27,'dialogue',[0,1,-1]);
event(29,'feedback',[.9,1,-1]);
commands.sort((a,b)=>a.tick-b.tick);
save('workshop.world.json',{format:'ink-studio/world',version:1,id:'voice-priority-workshop',dt,commands});
run('sim','run','workshop.world.json','--ticks','88','--record','workshop.run.json');

const cues={
  rain:{asset:'rain',bus:'ambience',gain:.82,group:'rain'},
  crowd:{asset:'crowd',bus:'effects',gain:.93,group:'crowd'},
  collision:{asset:'collision',bus:'foley',gain:1.12,group:'collision'},
  warning:{asset:'warning',bus:'effects',gain:.29,priority:90,protected:true},
  dialogue:{asset:'dialogue',bus:'dialogue',gain:.59,priority:68},
  feedback:{asset:'feedback',bus:'effects',gain:.25,priority:78,protected:true}
};
const emitters=Object.fromEntries([-1.3,-.4,.6,1.4].map((x,i)=>['roof-'+i,{
  cue:'rain',at:[x,2,-1.4],gain:1-.06*i,offset:i*.18
}]));
const definition={format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener:[0,1,0],
  assets:Object.fromEntries(Object.keys(cues).map(name=>[name,name+'.wav'])),post:{},
  spatial:{cues,emitters,distance:{reference:2,rolloff:.4},
    voiceBudget:{maxVoices:6,reservedVoices:2,groups:{rain:1,crowd:2,collision:2},stealFade:.008}}};
save('protected.audio.json',definition);
const baseline=structuredClone(definition);
baseline.spatial.voiceBudget={maxVoices:6,reservedVoices:0};
for(const cue of Object.values(baseline.spatial.cues)){
  cue.priority=0;
  cue.protected=false;
}
save('loudness.audio.json',baseline);
const passes=['loudness','protected'], folder=name=>name+'/';
for(const name of passes)run('story','audio','workshop.run.json',name+'.audio.json','--out',name);
const reports=passes.map(name=>read(folder(name)+'report.json'));
for(let i=0;i<reports.length;i++){
  const {voiceBudget,cues}=reports[i];
  assert(voiceBudget.peakVoices<=6&&voiceBudget.dropped>100);
  const chosen=cues.filter(row=>critical.includes(row.cue)).map(row=>[row.cue,row.voiceBudget.action]);
  assert.deepEqual(chosen,critical.map(cue=>[cue,i?'admitted':'dropped']));
}
assert(reports[1].voiceBudget.stolen>=1);
const [before,after]=passes.map(name=>ink.decodeWav(bytes(folder(name)+'mix.wav')).samples);
const gap=Math.round(rate*.28)*2, samples=new Float32Array(before.length+gap+after.length);
samples.set(before);samples.set(after,before.length+gap);
fs.writeFileSync(file('world-voice-priorities.wav'),ink.encodeWav({samples,channels:2,sampleRate:rate}));
const report=reports.map(({voiceBudget,cues},i)=>({
  mode:passes[i],listenAt:i*(before.length+gap)/2/rate,
  allocation:Object.fromEntries(Object.entries(voiceBudget).filter(([key])=>key!=='decisions')),
  critical:cues.filter(row=>critical.includes(row.cue)).map(({cue,voiceBudget,source})=>({cue,voiceBudget,beatId:source.beatId}))
}));
save('demo-summary.json',{audio:'world-voice-priorities.wav',report});
fs.writeFileSync(file('README.txt'),`Ink Studio world voice priorities

${report[0].listenAt.toFixed(2)} s   Six voices ranked by loudness. The warning, dialogue, and feedback are dropped.
${report[1].listenAt.toFixed(2)} s   Same recording and voice limit, with protected cues and group limits.

Both folders contain WAV stems and the scene report. demo-summary.json
links the three critical signals to their allocation decisions.

Replay the protected pass:

  ink-studio story audio workshop.run.json protected.audio.json --out replay

Rebuild the demo in a fresh folder:

  node demo.cjs /path/to/output dialogue.wav /path/to/ink-studio
`);
console.log('Rendered loudness-only and protected passes. All three critical sounds survived only with the protected allocation.');
