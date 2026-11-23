/* Signal Watch: a continuous score driven by a recorded world parameter. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load();

const tempo=120, sampleRate=32000, entry='watch', end=9;
const parts={beacon:'lead',pulse:'bass',kick:'percussion',rim:'percussion'};
const patches={
  beacon:{type:'fm',ratio:2,index:1.11,width:12,env:{attack:.12,decay:.30,sustain:.51,release:.42},
    echo:{delay:.375,feedback:.32,send:.19,damping:.52,width:.65}},
  pulse:{type:'subtractive',pulse:.69,saw:.14,sub:.29,pulseWidth:.32,
    pwm:{rate:4,depth:.21},filter:{cutoff:410,resonance:.52,keyTrack:.2},
    env:{attack:.12,decay:.37,sustain:.69,release:.51}},
  kick:{type:'drum',kind:'kick',tune:43,sweep:47,decay:.23,click:.18},
  rim:{type:'drum',kind:'rim',tune:235,decay:.13,color:.72,click:.5}
};
function track(part,gain,pan,send,rows) {
  return {patch:part,gain,pan,send,clips:[{id:part+'-line',beat:0,length:20,...(parts[part]==='percussion' && {mode:'layer'}),voices:[{id:'player',
    notes:rows.map(([beat,duration,midi,velocity],i)=>({id:'note-'+i,beat,duration,midi,velocity}))}]}]};
}
const sources={'signal-watch':{
  seed:652,arrangement:{score:{key:{root:'D3',mode:'minor'},tempoMap:{tempo},
    harmonies:{home:{root:'D3',quality:'minor'}}},motifs:{},
    parts:Object.fromEntries(Object.entries(parts).map(([part,role])=>[part,{role}])),
    sections:[{id:entry,bars:5,harmony:'home'}]},
  patches,room:{gain:-9,decay:1.35,damping:.6},
  tracks:{
    beacon:track('beacon',-15,-.18,.48,[[0,1.4,62,.62],[1.93,1.35,69,.55],[3.51,.43,65,.44],
      [4.38,1.88,74,.61],[6.65,.74,72,.51],[7.55,.39,69,.51],[8.27,1.99,67,.54],
      [10.62,1.41,77,.59],[12.31,1.78,74,.61],[14.4,.72,65,.43],[15.44,2.33,62,.54]]),
    pulse:track('pulse',-12,.16,.36,[[0,17.5,38,.86]]),
    kick:track('kick',-10,0,.04,Array.from({length:9},(_,i)=>[i*2,.2,36,i%2===0?.91:.7])),
    rim:track('rim',-15,.32,.48,Array.from({length:9},(_,i)=>[1.03+i*2,.18,52,i%2===0?.85:.64]))
  }
}};
const timeline={entry,segments:{watch:{source:'signal-watch',end,loop:false}}};
const clock={tempo,entry,sections:{watch:{resource:'watch'}},parameters:{danger:{}},
  layerControls:{
    pulse:{parameter:'danger',attack:.85,release:1.15},
    kick:{parameter:'danger',range:[.15,.9],attack:.63,release:.64},
    rim:{parameter:'danger',range:[.28,1],attack:.84,release:.83}
  }};
const commands=[[38,.37],[76,1],[121,.22],[141,0]].map(([tick,value])=>({
  tick,action:'world/input',args:{port:'score/parameter.danger',value}
}));
const world={id:'signal-watch',seed:73,dt:.05,systems:{score:{kind:'adaptive-music',config:clock}},commands};
const dir=path.resolve(process.argv[2] ?? 'signal-watch');
fs.mkdirSync(dir,{recursive:true});
function write(name,value){
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
const recipe=write('score.json',{sources,timeline,live:{options:{sampleRate,masterGain:4}}});
write('world.json',world);
const run=KIT.world.runtime.create(world);
run.advance(180);
const recording=run.recording();
write('world.run.json',recording);
const trace=KIT.music.production.rehearsal.capture(recording,{id:'signal-watch'});
const tracePath=write('world.trace.json',trace);
const mix=path.join(dir,'mix');
execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
  recipe,tracePath,'--out',mix],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(mix,'listen.json'),'utf8'));
assert.equal(report.section,entry);
assert.equal(report.profile.starts,30);
assert.equal(report.profile.clippedFrames,0);
assert.equal(report.joins.length,0);
assert.equal(report.trace.filter(row=>row.kind==='layer-gain').length,11);
