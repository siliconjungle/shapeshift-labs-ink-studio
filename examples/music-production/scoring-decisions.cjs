/* Signal Hatch: leave a live opening for Foley and let selected accents answer it. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav');

const tempo=120, sampleRate=32000, end=8;
const dir=path.resolve(process.argv[2] ?? 'signal-hatch');
fs.mkdirSync(dir,{recursive:true});
function write(name,value) {
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
function passage(bars,parts) {
  return {seed:47,arrangement:{score:{key:{root:'D3',mode:'minor'},tempoMap:{tempo},
    harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},
    parts:Object.fromEntries(Object.entries(parts).map(([part,row])=>[part,{role:row.role}])),
    sections:[{id:'phrase',bars,harmony:'home'}]},
  patches:Object.fromEntries(Object.entries(parts).map(([part,row])=>[part,row.patch])),
  tracks:Object.fromEntries(Object.entries(parts).map(([part,row])=>[part,{patch:part,gain:row.gain,
    pan:row.pan ?? 0,send:row.send ?? 0,clips:[{id:part+'-line',beat:0,length:bars*4,voices:[{id:'player',
      notes:row.notes.map(([beat,duration,midi,velocity],i)=>({id:'note-'+i,beat,duration,midi,velocity}))}]}]}])),
  room:{gain:-8,size:1.32,decay:1.44,damping:.56}};
}
const bell={type:'fm',ratio:2.997,index:1.3,width:14,env:{attack:.007,decay:.19,sustain:.28,release:.47},
  echo:{delay:.24,feedback:.34,send:.19,damping:.65,width:.72}};
const sources={
  hall:passage(4,{
    keys:{role:'lead',gain:-14,pan:-.21,send:.44,patch:{type:'fm',ratio:2.01,index:.73,width:11,
      env:{attack:.029,decay:.22,sustain:.61,release:.37},echo:{delay:.375,feedback:.32,send:.24,damping:.61,width:.66}},
      notes:[[0,.57,62,.61],[.83,.51,65,.54],[1.53,.49,69,.58],[2.31,.61,74,.51],[3.1,.49,72,.52],
        [3.82,.61,69,.59],[4.59,.59,65,.47],[5.39,.5,62,.58],[6.6,.54,64,.57],[7.36,.44,67,.52],
        [8.1,.56,69,.62],[8.78,.45,72,.52],[9.57,.69,74,.56],[10.43,.52,69,.53],[11.22,.59,67,.5],
        [11.94,.49,65,.54],[12.7,.74,62,.58],[13.64,.61,57,.51],[14.45,.6,60,.42],[15.26,.5,62,.45]]},
    pad:{role:'pad',gain:-16,pan:.23,send:.56,patch:{type:'subtractive',saw:.11,pulse:.42,sub:.16,pulseWidth:.27,
      pwm:{rate:.63,depth:.12},filter:{cutoff:484,resonance:.56,keyTrack:.18},
      env:{attack:.31,decay:.53,sustain:.68,release:.63}},
      notes:[[.06,3.98,50,.66],[4.26,3.38,48,.61],[8.02,3.64,53,.65],[12.1,2.97,50,.56]]}
  }),
  signal:passage(1,{bell:{role:'lead',gain:-7,pan:.23,send:.46,patch:bell,
    notes:[[0,.22,81,.87],[.25,.31,86,.72]]}}),
  clear:passage(1,{bell:{role:'lead',gain:-12,pan:-.24,send:.54,patch:bell,
    notes:[[0,.26,77,.79],[.38,.47,74,.68]]}})
};
const entry='hall';
const timeline={entry,segments:{hall:{source:'hall',loop:false},signal:{source:'signal',end:.9},clear:{source:'clear',end:1}},
  stingers:{'signal-bell':'signal','clear-bell':'clear'},scoring:{
    openings:{hall:{breath:[{beat:6},{beat:9},{beat:13}]}},
    cues:{
      hatch:{passThrough:true,space:{gain:0,attack:.035,hold:.53,release:.32}},
      alert:{accent:{resource:'signal-bell',opening:'breath',cooldown:1.35,expiresAfter:.86}},
      clear:{accent:{resource:'clear-bell',expiresAfter:.3}}
    }
  }};
let seed=501, filtered=0;
const tau=2*Math.PI;
const metal=Float32Array.from({length:Math.round(.63*sampleRate)},(_,i)=>{
  const t=i/sampleRate;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const white=seed/2147483648-1;
  filtered+=.33*(white-filtered);
  let value=.32*filtered*Math.sin(Math.PI*Math.min(1,t/.23))**2;
  for (const [onset,force] of [[.056,.42],[.171,.96],[.21,.55],[.307,.27]]) {
    const age=t-onset;
    if (age<0 || age>.31) continue;
    value+=force*Math.min(1,age*1500)*(.24*Math.sin(tau*184*age)*Math.exp(-age*11)+
      .16*Math.sin(tau*413*age)*Math.exp(-age*22)+.14*Math.sin(tau*917*age)*Math.exp(-age*34)+
      .18*white*Math.exp(-age*84));
  }
  return value*Math.min(1,(.63-t)*15);
});
fs.writeFileSync(path.join(dir,'hatch.wav'),WAV.encode({sampleRate,channels:1,samples:metal},{encoding:'pcm24'}));

const cueRows=[[22,'hatch'],[45,'alert'],[54,'alert'],[64,'alert'],[81,'alert'],[108,'hatch'],[126,'clear']];
const world={id:'signal-hatch',dt:.05,systems:{score:{kind:'adaptive-music',config:{
  tempo,entry,sections:{hall:{resource:'hall'}}
}}},commands:cueRows.map(([tick,cue])=>({tick,action:'world/event',args:{kind:'audio-cue',cue,
  ...(cue==='hatch' && {duration:.63})}}))};
write('world.json',world);
const run=KIT.world.runtime.create(world);
run.advance(Math.round(end/world.dt));
const recording=run.recording();
write('world.run.json',recording);
const trace=write('world.trace.json',KIT.music.production.rehearsal.capture(recording,{id:'signal-hatch'}));
const options={sampleRate,masterGain:2};
const live={options,streams:{hatch:{file:'hatch.wav',gain:-1,pan:.05,send:.31,foreground:true}}};
function render(name,timeline,worldCues,output) {
  const file=write(name,{sources,timeline,live:{...live,traceOptions:{worldCues}}});
  execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
    file,trace,'--out',path.join(dir,output)],{stdio:'inherit'});
}
render('score.json',timeline,{hatch:'hatch',alert:'alert',clear:'clear'},'mix');
const report=JSON.parse(fs.readFileSync(path.join(dir,'mix/listen.json'),'utf8'));
assert.equal(report.profile.streamGaps,0);
assert.equal(report.profile.clippedFrames,0);
assert.deepEqual(report.scoring.outcomes,{queued:4,played:3,cooldown:1,expired:1});
assert.deepEqual(report.trace.filter(row=>row.kind==='score-accent' && row.status==='played').map(row=>row.time),
  [3,4.5,6.3]);
const {scoring,...unscored}=timeline;
render('bypassed.json',unscored,{hatch:'hatch'},'bypassed');
