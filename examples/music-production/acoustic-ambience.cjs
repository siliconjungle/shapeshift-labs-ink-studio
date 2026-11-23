/* The Pump House: walk from a rainy marsh through an awning and two doors. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav');

const sampleRate=32000, period=4, frames=sampleRate*period, end=12, tau=2*Math.PI;
const dir=path.resolve(process.argv[2] ?? 'pump-house');
fs.mkdirSync(dir,{recursive:true});
function write(name,value) {
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
let seed=713, breeze=0, body=0, spray=0;
function noise() {
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/2147483648-1;
}
const beds=Object.fromEntries(['wind','rain','wildlife','machinery'].map(name=>[name,new Float32Array(frames)]));
for (let i=0;i<frames;i++) {
  const t=i/sampleRate, x=tau*t/period, a=noise(), b=noise(), c=noise();
  breeze+=.015*(a-breeze);
  body+=.0038*(a-body);
  spray+=.34*(b-spray);
  const gust=.65+.22*Math.cos(x-.3)+.13*Math.cos(3*x+.8);
  beds.wind[i]=gust*(1.34*breeze+2.23*body+.032*Math.sin(213*x+.41*Math.sin(3*x)));
  beds.rain[i]=(.81+.13*Math.cos(2*x+.31))*(.32*b+.28*(b-spray)+.71*breeze);
  let bird=0;
  for (const [begin,duration,hz,drop] of [[.23,.16,2250,500],[.49,.13,2600,840],[1.7,.19,2520,870],
    [2.02,.16,2400,450],[2.95,.16,2180,620],[3.25,.21,2730,750]]) {
    const age=t-begin;
    if (age<0 || age>=duration) continue;
    const envelope=Math.sin(Math.PI*age/duration)**1.5;
    bird+=envelope*(.17*Math.sin(tau*(hz*age-drop*age*age/duration))+
      .033*Math.sin(tau*(2*hz*age-1.8*drop*age*age/duration)));
  }
  beds.wildlife[i]=bird+.026*body;
  const motor=.82+.12*Math.cos(9*x)+.06*Math.sin(17*x);
  beds.machinery[i]=motor*(.18*Math.sin(192*x)+.11*Math.sin(384*x+.4)+.06*Math.sin(768*x)+
    .054*Math.sin(1840*x+.73*Math.sin(8*x))+.036*Math.sin(4221*x)+.029*c);
}
const trim={wind:-1,rain:0,wildlife:0,machinery:0};
const pan={wind:-.43,rain:.29,wildlife:-.2,machinery:.19};
const streams=Object.fromEntries(Object.entries(beds).map(([part,samples])=>{
  const file=part+'.wav';
  fs.writeFileSync(path.join(dir,file),WAV.encode({sampleRate,channels:1,samples},{encoding:'pcm24'}));
  return [part,{file,pan:pan[part],gain:trim[part]}];
}));

const entry='walk', dt=.05, listener={entity:'listener'};
const input=(tick,port,value)=>({tick,action:'world/input',args:{port,value}});
const move=(tick,value)=>({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/listener/position',value}]}});
function walk(from,to,first,last) {
  const actions=[];
  for (let tick=first;tick<=last;tick+=2)
    actions.push(move(tick,from.map((value,k)=>value+(to[k]-value)*(tick-first)/(last-first))));
  return actions;
}
const weather=(tick,field,value)=>({tick,action:'weather/set',args:{field,region:{
  id:'marsh',bounds:{min:[-19,-8],max:[10,8]},value
}}});
const outside=[-4.4,1,1.25], near=[-2.65,1,1.1], awning=[-.96,1,.57], lobby=[1.67,1,.45], pump=[6.38,1,.26];
const cover={field:'weather/roof',shelteredBands:[.51,.23,.042]};
const world={id:'pump-house',dt,entities:{listener:{position:outside}},systems:{
  air:{kind:'ventilation',config:{
    rooms:{hall:{bounds:{min:[0,0,-2.3],max:[4,2.8,2.3]}},
      plant:{bounds:{min:[4,0,-2.3],max:[8,2.8,2.3]}}},
    openings:{front:{from:'outside',to:'hall',at:[0,1,.48]},
      gate:{from:'hall',to:'plant',at:[4,1,.33],opening:0}}
  }},
  acoustics:{kind:'acoustics',config:{layout:'air/acoustic-layout',referenceDistance:3.75,
    openings:{front:{closedLossDb:[11,30,55]},gate:{sealed:true}}}},
  weather:{kind:'fields',config:{fields:{
    rain:{axes:'xz',default:6},wind:{axes:'xz',default:.58},
    roof:{axes:'xz',default:0,regions:[{id:'awning',bounds:{min:[-1.63,-.8],max:[-.01,1.4]},value:1}]}
  }}},
  ambience:{kind:'acoustic-ambience',config:{listener,zones:{
    wind:{from:[-2.45,1,-.25],weather:{field:'weather/wind'},cover,ramp:.28,gain:.93},
    rain:{from:[-1.7,1,.36],weather:{field:'weather/rain',range:[0,20]},cover,ramp:.32},
    wildlife:{from:[-3.45,1,1.85],gain:.83,ramp:.27,
      bounds:{min:[-5.9,0,.17],max:[-1.84,2.7,3.28]},feather:2.9},
    machinery:{from:[6.84,1,0],gain:.95,ramp:.3}
  }}},
  score:{kind:'adaptive-music',config:{entry,sections:{walk:{resource:'walk'}}}}
},commands:[
  ...walk(outside,near,12,30),weather(36,'rain',19),weather(36,'wind',.93),
  ...walk(near,awning,52,72),...walk(awning,lobby,89,109),
  input(122,'air/opening.front',0),input(156,'air/opening.gate',1),
  ...walk(lobby,pump,165,193),input(209,'air/opening.gate',0)
].sort((a,b)=>a.tick-b.tick)};
const source={seed:84,arrangement:{score:{key:{root:'D3'},tempoMap:{tempo:120},
  harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},parts:{lamp:{role:'lead'}},
  sections:[{id:'walk',bars:6,harmony:'home'}]},patches:{lamp:{type:'fm',ratio:2.013,index:.59,width:13,
    env:{attack:.11,decay:.34,sustain:.41,release:.5}}},
  tracks:{lamp:{patch:'lamp',gain:-23,pan:.02,send:.26,clips:[{id:'line',beat:0,length:24,voices:[{
    id:'player',notes:[[.22,.92,62,.5],[3.4,.71,65,.43],[6.22,.98,57,.45],[10.66,.81,60,.47],
      [14.49,.7,65,.43],[17.44,.74,62,.48],[21.4,.7,57,.46]]
      .map(([beat,duration,midi,velocity],i)=>({id:'note-'+i,beat,duration,midi,velocity}))
  }]}]}},room:{gain:-14,decay:.81,damping:.57}};
const timeline={entry,segments:{walk:{source:entry,loop:false}}};
const score=write('score.json',{sources:{walk:source},timeline,live:{streams,options:{sampleRate,masterGain:1,
  stemGroups:{ambience:{frames,parts:Object.fromEntries(Object.keys(streams).map(name=>[name,{stream:name}]))}}
}}});
write('world.json',world);
const run=KIT.world.runtime.create(world);
const listen={};
for (const [name,tick] of [['marsh',0],['storm',45],['awning',81],['hall',116],['door-closed',135],['gate-open',163],['plant',220]]) {
  if (tick) run.advance(tick);
  listen[name]={time:tick*dt,...run.query().probe('ambience/mix').value};
}
write('positions.json',listen);
assert.equal(listen.awning.zones.rain.shelter,1);
assert(listen['door-closed'].zones.rain.bands[2]<listen.hall.zones.rain.bands[2]*.01);
assert.deepEqual(listen['door-closed'].zones.machinery.bands,[0,0,0]);
assert(listen.plant.zones.machinery.bands[1]>listen['gate-open'].zones.machinery.bands[1]);
run.advance(Math.round(end/dt));
const recording=run.recording();
const runPath=write('world.run.json',recording);
const capture=write('capture.json',{id:'pump-house',ambience:'ambience'});
const trace=path.join(dir,'world.trace.json'), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
execFileSync(process.execPath,[cli,'music','rehearsal','capture',runPath,capture,'--out',trace],{stdio:'inherit'});
const mix=path.join(dir,'mix');
execFileSync(process.execPath,[cli,'music','live','replay',score,trace,'--out',mix],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(mix,'listen.json'),'utf8'));
assert.equal(report.profile.streamGaps,0);
assert.equal(report.profile.clippedFrames,0);
assert.equal(report.ambienceGains.rain.bands[2],0);
assert(report.ambienceGains.machinery.bands[1]>.9);
