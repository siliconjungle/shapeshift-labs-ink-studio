/* Signal Crossing: print one recorded world through the live and offline renderers. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav.js');
const sampleRate=24000, tempo=120, end=6;

const lead={type:'fm',ratio:2,index:1.17,env:{attack:.018,decay:.24,sustain:.55,release:.47},
  echo:{delay:.28,feedback:.3,send:.16,damping:.6}};
const pulse={type:'subtractive',pulse:.64,saw:.28,sub:.33,filter:{cutoff:490,resonance:.55,keyTrack:.3},
  env:{attack:.09,decay:.29,sustain:.62,release:.31}};
const bell={type:'fm',ratio:2.61,index:1.85,env:{attack:.002,decay:.17,sustain:.18,release:.36}};
const room={gain:-17,decay:.88,damping:.53};
const motif=(length,notes)=>({length,events:notes.map(([beat,duration,midi,velocity])=>({beat,duration,midi,velocity}))});
function production(theme,bass,key='D3') {
  return {seed:23,arrangement:{score:{tempoMap:{tempo},key:{root:key,mode:'minor'},
    harmonies:{home:{root:key,quality:'unison'}}},parts:{lead:{role:'lead',material:'theme'},pulse:{role:'bass',material:'bass'}},
    sections:[{id:'phrase',bars:2,harmony:'home'}],motifs:{theme:motif(8,theme),bass:motif(8,bass)}},
    patches:{lead,pulse},tracks:{lead:{patch:'lead',gain:-13,pan:-.13,send:.48},pulse:{patch:'pulse',gain:-14,pan:.12,send:.14}},room};
}
function accent(pitch) {
  return {seed:23,arrangement:{score:{tempoMap:{tempo},key:{root:'D3'},
    harmonies:{home:{root:'D3',quality:'unison'}}},parts:{bell:{role:'lead',material:'note'}},
    sections:[{id:'accent',bars:1,harmony:'home'}],motifs:{note:motif(4,[[0,.22,pitch,.86]])}},
    patches:{bell},tracks:{bell:{patch:'bell',gain:-9,pan:.23,send:.6}},room};
}
const sources={
  bank:production([[0,1.3,62,.83],[1.5,.54,65,.71],[2.16,1.32,69,.89],[4,.77,65,.63],
    [5.03,.62,60,.67],[6.2,1.1,62,.74]],[[0,3.5,38,.85],[4,3.3,38,.69]]),
  crossing:production([[0,.48,74,.88],[.77,.65,76,.74],[1.8,1.2,77,.88],[3.22,.46,81,.69],
    [4,1.24,79,.78],[5.56,.65,76,.67],[6.4,1.15,74,.76]],[[0,1.5,45,.88],[1.76,1.85,43,.75],[4,3.9,38,.72]]),
  brass:accent(85), glass:accent(95)
};
const timeline={entry:'bank',segments:{bank:{source:'bank',end:2.5},crossing:{source:'crossing'},
  'brass-bell':{source:'brass',end:.7,loop:false},'glass-bell':{source:'glass',end:.7,loop:false}},
  transitions:[{from:'bank',to:'crossing',exit:1.4,tail:.6,fadeIn:.06}],
  stingers:{brass:'brass-bell',glass:'glass-bell'},
  scoring:{cues:{warning:{accent:{resource:'glass',opening:'gap'}}},openings:{bank:{gap:[1.10]}}}};
const score={tempo,entry:'bank',sections:{bank:{resource:'bank'},crossing:{resource:'crossing'}},
  parameters:{danger:{},cross:{}},layerControls:{pulse:{parameter:'danger',attack:.5,release:.62}},
  transitions:[{id:'cross',from:'bank',to:'crossing',quantize:'none',
    when:{path:'/parameters/cross',op:'gte',value:.5}}]};
const signal=(tick,name,value)=>({tick,action:'world/input',args:{port:'score/parameter.'+name,value}});
const sound=(tick,cue)=>({tick,action:'world/event',args:{kind:'audio-cue',cue}});
const world={id:'signal-crossing',seed:46,dt:.05,systems:{score:{kind:'adaptive-music',config:score}},
  commands:[sound(7,'wheel'),signal(11,'danger',.8),sound(17,'warning'),signal(38,'cross',1),
    sound(42,'wheel'),signal(72,'danger',.26),sound(96,'wheel')]};
const out=path.resolve(process.argv[2] ?? 'signal-crossing'), comparison=path.join(out,'comparison');
fs.mkdirSync(out,{recursive:true});
function write(name,value) {
  const file=path.join(out,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
const samples=Float32Array.from({length:Math.round(.4*sampleRate)},(_,i)=>{
  const t=i/sampleRate;
  return (.42*Math.sin(2*Math.PI*(270-160*t)*t)+.22*Math.sin(2*Math.PI*580*t))*
    Math.exp(-t*15)*Math.min(1,t/.007);
});
fs.writeFileSync(path.join(out,'wheel.wav'),WAV.encode({sampleRate,channels:1,samples},{encoding:'pcm24'}));
const recipe=write('score.json',{sources,timeline,live:{options:{sampleRate,masterGain:0,traceLimit:8},
  traceOptions:{arrivalOffset:.125,worldCues:{wheel:'wheel',warning:'brass'}},
  streams:{wheel:{file:'wheel.wav',gain:-7,pan:-.30,send:.20,foreground:true}}}});
write('world.json',world);
const run=KIT.world.runtime.create(world);
run.advance(Math.round(end/world.dt));
const recording=write('world.run.json',run.recording());
const settings=write('capture.json',{id:'signal-crossing'});
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
execFileSync(process.execPath,[cli,'music','rehearsal','compare',recipe,recording,'--capture',settings,'--out',comparison],
  {stdio:'inherit'});
const reportFile=path.join(comparison,'comparison.json'), report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
assert.equal(report.summary.cueVariants,1);
assert.equal(report.summary.transitions,1);
assert.equal(report.summary.layerGains,2);
assert.equal(report.summary.releaseTails,1);
const warning=report.cues.find(row=>row.cue==='warning');
assert.equal(warning.live.variants[0].resource,'glass');
assert.equal(warning.offline.variants[0].resource,'brass');
execFileSync(process.execPath,[cli,'beat',warning.beatId,reportFile,'--out',path.join(out,'warning.inspect.json')]);
