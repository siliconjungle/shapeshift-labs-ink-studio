const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const ink=require(repo), {world:W}=ink.load().KIT, rate=48000, dt=.05;
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name);
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});

fs.mkdirSync(out,{recursive:true});
const sine=(hz,t)=>Math.sin(2*Math.PI*hz*t);
function signal(length,repeat,voice){
  const samples=Float32Array.from({length:Math.round(length*rate)},(_,i)=>{
    const t=i/rate;
    return [0,repeat].reduce((sum,start)=>{
      const from=t-start;
      return from<=0?sum:sum+voice(from)*Math.min(1,from/.004);
    },0)*Math.min(1,(length-t)/.012);
  });
  return ink.encodeWav({samples,channels:1,sampleRate:rate});
}
fs.writeFileSync(file('bell.wav'),signal(.39,.132,t=>
  (.40*sine(1080,t)+.24*sine(1973,t)+.16*sine(2739,t))*Math.exp(-t/.053)));
fs.writeFileSync(file('buzzer.wav'),signal(.36,.106,t=>
  (.62*sine(161,t)+.21*sine(322,t)+.08*sine(481,t))*Math.exp(-t/.051)));

const at=[2.5,1,0], listeners={hall:[-2,1,0],guard:[1.5,1,0]};
const passes=[
  {tick:6,case:'Bell, hatch open',cue:'bell',sourceLevelDb:72,band:'high',duration:.36,expected:true},
  {tick:30,case:'Bell, hatch latched',cue:'bell',sourceLevelDb:72,band:'high',duration:.26,expected:false},
  {tick:54,case:'Low buzzer, hatch latched',cue:'buzzer',sourceLevelDb:72,band:'low',duration:.31,expected:true},
  {tick:78,case:'Quiet bell, hatch open',cue:'bell',sourceLevelDb:59,band:'high',duration:.19,expected:false}
];
const hatch=(tick,value)=>({tick,action:'world/input',args:{port:'air/opening.hatch',value}});
const commands=[hatch(28,0),hatch(76,1),...passes.map(({tick,cue,sourceLevelDb,band,duration})=>({
  tick,action:'world/event',args:W.timedEvents.at(tick/20-.0125,{kind:'world-sound',cue,at,sourceLevelDb,band,duration})
}))].sort((a,b)=>a.tick-b.tick);
save('lock.world.json',{format:'ink-studio/world',version:1,id:'shared-lock-sounds',dt,systems:{
  air:{kind:'ventilation',config:{rooms:{
    hall:{bounds:{min:[-7,0,-3],max:[0,3,3]}},lock:{bounds:{min:[0,0,-3],max:[6,3,3]}}
  },openings:{hatch:{from:'hall',to:'lock',at:[0,1,0]}}}},
  acoustics:{kind:'acoustics',config:{layout:'air/acoustic-layout',openings:{hatch:{
    openLossDb:[0,0,0],closedLossDb:[4,13,31]}}}},
  intel:{kind:'perception',config:{profiles:{watch:{hearing:{range:15,thresholdDb:52,field:'acoustics/audible'}}},
    factions:Object.fromEntries(Object.entries(listeners).map(([label,at])=>[label,{
      observers:{[label]:{at,profile:'watch'}}
    }]))}}
},commands});
run('sim','run','lock.world.json','--ticks','104','--record','lock.run.json');
const recording=W.runtime.openRecording(read('lock.run.json'));
for(const [name,position] of Object.entries(listeners)){
  save(name+'.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    listener:{at:position,forward:[1,0,0]},assets:{bell:'bell.wav',buzzer:'buzzer.wav'},post:{},
    spatial:{cues:{bell:{asset:'bell',bus:'effects',gain:.75},buzzer:{asset:'buzzer',bus:'effects',gain:.75}},
      soundReferenceDb:72,occlusion:{acoustic:'acoustics/audible'},propagationDelay:true}});
  run('story','audio','lock.run.json',name+'.audio.json','--out',name);
}
const hall=read('hall/report.json'), guard=read('guard/report.json');
assert.equal(hall.cues.length,passes.length);
assert.equal(guard.cues.length,passes.length);
const notes=passes.map(({tick,case:title,expected},i)=>{
  recording.advance(tick);
  const source=recording.committedEvents().find(row=>row.kind==='world-sound');
  const beatId=W.inspectionLinks.identify(source);
  const explain=faction=>recording.query().probe('intel/hearing',undefined,{faction,event:beatId}).value.observations[0];
  const hallHearing=explain('hall'), guardHearing=explain('guard');
  assert.equal(hallHearing.audible,expected);
  assert.equal(guardHearing.audible,true);
  assert.equal(hall.cues[i].source.beatId,beatId);
  assert.equal(guard.cues[i].source.beatId,beatId);
  assert.deepEqual(hall.cues[i].sound,guard.cues[i].sound);
  return {title,beatId,sound:hall.cues[i].sound,atSeconds:hall.cues[i].onsetSample/rate,
    hall:hallHearing,guard:guardHearing};
});
const [left,right]=['hall','guard'].map(name=>ink.decodeWav(bytes(name+'/effects.wav')).samples);
assert.equal(left.length,right.length);
const samples=Float32Array.from(left,(sample,i)=>i%2?right[i]*Math.SQRT2:sample*Math.SQRT2);
fs.writeFileSync(file('shared-world-sounds.wav'),ink.encodeWav({samples,channels:2,sampleRate:rate}));
save('hearing.json',{sampleRate:rate,channels:['hall','guard'],sounds:notes});
run('beat',notes[0].beatId,'hall/report.json','guard/report.json','hearing.json','--out','beat-inspection.json');
assert.deepEqual(new Set(read('beat-inspection.json').matches.map(row=>row.report)),
  new Set(['hall/report.json','guard/report.json','hearing.json']));
const outcome=row=>row.audible?'heard':row.status;
fs.writeFileSync(file('README.txt'),`Ink Studio shared playback and hearing

Hall on the left. Guard by the bell on the right.
The simulation compares each listener's received level against 52 dB.

${notes.map(({atSeconds,title,hall,guard})=>atSeconds.toFixed(2)+' s   '+title+
  '   Hall '+outcome(hall)+'   Guard '+outcome(guard)).join('\n')}

hearing.json explains each decision. The same beat ID appears in both mix
reports and in the committed event.

Use the Ink Studio CLI to replay the recording or query the first call:

  ink-studio story audio lock.run.json hall.audio.json --out hall-replay
  ink-studio probe lock.run.json --ticks 6 --field intel/hearing --args '{"faction":"hall","event":"${notes[0].beatId}"}' --json
  ink-studio beat ${notes[0].beatId} hall/report.json guard/report.json hearing.json

Rebuild the entire demo with node demo.cjs /path/to/output /path/to/ink-studio.
`);
console.log('Rendered four sounds from two listening posts and verified the matching beat IDs and hearing decisions.');
