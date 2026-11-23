/* Under the Eaves: rain and pursuit follow independent world inputs. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav');

const tempo=120, sampleRate=32000, frames=4*sampleRate, end=14;
const dir=path.resolve(process.argv[2] ?? 'under-the-eaves');
fs.mkdirSync(dir,{recursive:true});
function write(name,value) {
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
function rain() {
  const outside=new Float32Array(frames*2), roof=new Float32Array(frames*2);
  const tau=2*Math.PI, drops=[[.14,.67],[.61,.78],[.83,.51],[1.37,1],[1.79,.7],[2.43,.94],[2.91,.66],[3.32,.88],[3.74,.48]];
  let seed=8721, breeze=0, left=0, right=0, muffled=0;
  function noise() {
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/2147483648-1;
  }
  for (let i=0;i<frames;i++) {
    const time=i/sampleRate, gust=.75+.16*Math.cos(tau*time/4)+.09*Math.sin(tau*time/2);
    const whole=noise(), a=noise(), b=noise();
    breeze+=.012*(whole-breeze);
    left+=.26*(a-left);
    right+=.27*(b-right);
    muffled+=.047*(whole-muffled);
    outside[2*i]=gust*(.39*left+.20*a+.56*breeze+.09*whole);
    outside[2*i+1]=gust*(.39*right+.20*b+.56*breeze+.09*whole);
    let drip=0;
    for (const [at,strength] of drops) {
      const age=(time-at+4)%4;
      if (age<.16) {
        drip+=strength*Math.min(1,age*1400)*Math.exp(-age*53)*
          (.076*Math.sin(tau*317*age)+.043*Math.sin(tau*773*age)+.021*a);
      }
    }
    roof[2*i]=.19*muffled+.33*breeze+.71*drip;
    roof[2*i+1]=.21*muffled+.34*breeze+drip;
  }
  return {outside,roof};
}
const streams=Object.fromEntries(Object.entries(rain()).map(([part,samples])=>{
  const file=part+'.wav';
  fs.writeFileSync(path.join(dir,file),WAV.encode({sampleRate,channels:2,samples},{encoding:'pcm24'}));
  return [part,{file,gain:3,send:part==='roof'?.32:.07}];
}));

const notes={
  lamp:[[.2,.9,62,.56],[2.15,.73,69,.49],[3.23,.66,65,.54],[5.13,1.06,60,.53],[7.1,.64,64,.43],
    [8.3,.74,65,.56],[10.44,.72,69,.49],[12.1,1.22,72,.53],[14.3,.63,67,.45],[15.43,.53,65,.51],
    [17.18,.88,62,.56],[19.13,.7,57,.53],[20.3,.98,60,.49],[22.25,.8,64,.52],[24.1,.65,65,.49],
    [25.57,.61,69,.44],[27.1,.5,62,.47]],
  chase:[[0,24,38,.78]],
  foot:[0,.83,1.55,2.7,3.29,4.12,4.94,5.62].flatMap(beat=>
    [beat,beat+6,beat+12,beat+18].map(at=>[at,.13,36,at%6<.01?.86:.66]))
};
const source={seed:41,arrangement:{score:{tempoMap:{tempo},key:{root:'D3',mode:'minor'},
  harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},
  parts:{lamp:{role:'lead'},chase:{role:'bass'},foot:{role:'percussion'}},
  sections:[{id:'alley',bars:7,harmony:'home'}]},
  room:{gain:-10,decay:1.3,damping:.56},patches:{
    lamp:{type:'fm',ratio:2.013,index:.71,width:14,env:{attack:.07,decay:.28,sustain:.63,release:.34},
      echo:{delay:.48,send:.26,feedback:.35,damping:.61,width:.7}},
    chase:{type:'subtractive',saw:.24,pulse:.54,sub:.43,pulseWidth:.27,pwm:{rate:4,depth:.22},
      filter:{cutoff:540,resonance:.63,keyTrack:.31},env:{attack:.11,decay:.4,sustain:.8,release:.61}},
    foot:{type:'drum',kind:'kick',tune:51,sweep:69,click:.32,decay:.2}
  },
  tracks:Object.fromEntries(Object.entries(notes).map(([part,rows])=>[part,{
    patch:part,gain:{lamp:-19,chase:-10,foot:-12}[part],pan:{lamp:-.16,chase:.06,foot:0}[part],
    send:part==='lamp'?.52:.13,clips:[{id:part+'-guide',beat:0,length:28,
      ...(part==='foot' && {mode:'layer'}),voices:[{id:'player',notes:rows.map(([beat,duration,midi,velocity],i)=>
        ({id:'note-'+i,beat,duration,midi,velocity}))}]}]
  }]))};
const listener={entity:'courier'}, entry='alley';
const weather={parameter:'weather-intensity',attack:.94,release:1.12};
const clock={tempo,entry,sections:{alley:{resource:'alley'}},parameters:{
  pursuit:{attack:.2,release:.7},exposure:{default:.85,attack:.35,release:.54},
  'weather-intensity':{default:.35,field:'weather/rain',at:listener,range:[0,20],attack:.8,release:1.2},
  shelter:{field:'terrain/roof',at:listener,attack:.25,release:.3}
},layerControls:{
  chase:{parameter:'pursuit',attack:.37,release:.88},
  foot:{parameter:'pursuit',range:[.32,1],attack:.26,release:.61},
  outside:{factors:{weather,exposure:{parameter:'exposure',attack:.44,release:.59},
    open:{parameter:'shelter',range:[1,0],attack:.4,release:.48}}},
  roof:{factors:{weather,cover:{parameter:'shelter',attack:.4,release:.37}}}
}};
const weatherAt=(tick,value)=>({tick,action:'weather/set',args:{field:'rain',
  region:{id:'alley-rain',bounds:{min:[-8,-8],max:[8,8]},value}}});
const input=(tick,name,value)=>({tick,action:'world/input',args:{port:'score/parameter.'+name,value}});
const move=(tick,value)=>({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/courier/position',value}]}});
const world={id:'under-the-eaves',dt:.05,entities:{courier:{position:[0,0,0]}},systems:{
  weather:{kind:'fields',config:{fields:{rain:{type:'number',axes:'xz',units:'mm/h',default:7}}}},
  terrain:{kind:'fields',config:{fields:{roof:{type:'number',axes:'xz',default:0,
    regions:[{id:'eaves',bounds:{min:[2,-2],max:[5,2]},value:1}]}}}},
  score:{kind:'adaptive-music',config:clock}
},commands:[
  weatherAt(36,19),input(66,'pursuit',.93),move(116,[3,0,0]),input(138,'exposure',.48),
  weatherAt(168,12),input(199,'pursuit',0),move(234,[0,0,0]),input(249,'exposure',.94)
]};
const timeline={entry,segments:{alley:{source:'alley',end,loop:false}}};
const score=write('score.json',{sources:{alley:source},timeline,live:{streams,options:{sampleRate,masterGain:1,
  stemGroups:{rain:{frames,parts:{outside:{stream:'outside'},roof:{stream:'roof'}}}}}}});
write('world.json',world);
const run=KIT.world.runtime.create(world);
run.advance(Math.round(end/world.dt));
const recording=run.recording();
write('world.run.json',recording);
const trace=write('world.trace.json',KIT.music.production.rehearsal.capture(recording,{id:'under-the-eaves'}));
const mix=path.join(dir,'mix');
execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
  score,trace,'--out',mix],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(mix,'listen.json'),'utf8'));
assert.equal(report.profile.streamGaps,0);
assert.equal(report.profile.clippedFrames,0);
assert.equal(report.joins.length,0);
const covered=report.trace.filter(row=>row.kind==='layer-gain' && row.frame===Math.round(5.8*sampleRate));
assert.deepEqual(covered.map(({part,factor,target})=>[part,factor,target]),[['outside','open',0],['roof','cover',1]]);
