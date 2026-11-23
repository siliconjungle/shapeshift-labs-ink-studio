/* Copper Steps: two takes of one passage with live, phase-matched switches. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav');

const sampleRate=32000, tempo=120, end=8.5;
const dir=path.resolve(process.argv[2] ?? 'copper-steps');
fs.mkdirSync(dir,{recursive:true});
function write(name,value) {
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}

const parts={
  lead:{role:'lead',gain:-10,pan:-.18,send:.56,patch:{type:'fm',ratio:2.01,index:1.24,width:11,
    env:{attack:.009,decay:.22,sustain:.46,release:.59},
    echo:{delay:.375,feedback:.38,send:.27,damping:.61,width:.72}}},
  pad:{role:'pad',gain:-19,pan:.33,send:.67,patch:{type:'fm',ratio:3.012,index:.8,width:17,
    env:{attack:.27,decay:.39,sustain:.65,release:.52}}},
  bass:{role:'bass',gain:-12,pan:.04,send:.07,patch:{type:'subtractive',saw:.27,pulse:.39,sub:.34,
    filter:{cutoff:580,resonance:.53,envAmount:22,keyTrack:.3},
    env:{attack:.012,decay:.21,sustain:.57,release:.16}}},
  step:{role:'percussion',gain:-13,pan:.05,send:.04,patch:{type:'drum',kind:'kick',tune:49,sweep:54,decay:.18,click:.23}},
  rim:{role:'percussion',gain:-18,pan:.32,send:.26,patch:{type:'drum',kind:'rim',tune:232,decay:.19,color:.68,click:.46}}
};
const notes={
  lead:[[.18,.66,62],[1.01,.48,69],[1.72,.34,72],[2.42,.48,65],[3.55,.28,69],
    [4.26,.65,74],[5.17,.51,72],[5.88,.31,69],[6.48,.51,67],[7.28,.42,65],
    [8.15,.62,67],[9.07,.46,70],[9.96,.31,74],[10.65,.5,70],[11.57,.27,67],
    [12.25,.65,65],[13.05,.52,69],[13.94,.4,72],[14.5,.77,62]],
  pad:[[.08,2.03,50],[2.62,1.6,53],[5.17,2.2,48],[8.21,2.12,55],[10.53,1.68,58],[12.93,1.96,50]],
  bass:[[.01,.57,38],[1.42,.44,45],[2.18,.58,38],[3.21,.49,41],[4,.63,38],[5.53,.45,48],
    [6.16,.49,36],[7.19,.55,43],[8.01,.63,43],[9.33,.51,46],[10.11,.7,43],[11.12,.51,41],
    [12,.63,38],[13.53,.48,45],[14.14,.72,38]],
  step:[0,1.4,2.56,3.26,4,5.42,6.5,7.34,8,9.41,10.52,11.36,12,13.42,14.54]
    .map(beat=>[beat,.13,36]),
  rim:[1.02,2.25,3.48,5.02,6.21,7.51,9.02,10.18,11.47,13.02,14.24]
    .map(beat=>[beat,.12,51])
};
const arrangement={score:{tempoMap:{tempo},key:{root:'D3',mode:'minor'},
  harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},
  parts:Object.fromEntries(Object.entries(parts).map(([part,{role}])=>[part,{role}])),
  sections:[{id:'steps',bars:4,harmony:'home'}]};
const patches=Object.fromEntries(Object.entries(parts).map(([part,{patch}])=>[part,patch]));
const velocities={
  restrained:{lead:.47,pad:.40,bass:.24,step:.09,rim:.13},
  energetic:{lead:.83,pad:.66,bass:.9,step:.93,rim:.74}
};
function take(name) {
  return {seed:83,arrangement,patches,room:{gain:-5,size:1.4,decay:1.66,damping:.53},
    tracks:Object.fromEntries(Object.entries(parts).map(([part,{role,gain,pan,send}])=>{
      const clip=part+'-written', voice='player';
      const written=notes[part].map(([beat,duration,midi],index)=>({
        id:'note-'+index,beat,duration,midi,velocity:velocities[name][part]*[1,.74,.89,.8][index%4]
      }));
      const timingEdits=written.filter((note,index)=>note.beat>0 && note.beat%4!==0 && index%2===1)
        .map(note=>({at:{beat:note.beat,clip,voice,note:note.id},delay:name==='energetic'?.009:.023}));
      return [part,{patch:part,gain,pan,send,timingEdits,clips:[{
        id:clip,beat:0,length:16,...(role==='percussion' && {mode:'layer'}),voices:[{id:voice,notes:written}]
      }]}];
    }))};
}
const sources={restrained:take('restrained'),energetic:take('energetic')};
const entry='restrained', switchPoints={lift:{beat:4},answer:{beat:8},return:{beat:12}};
const pairs=[{from:'restrained',to:'energetic'},{from:'energetic',to:'restrained'}];
const timeline={entry,segments:{restrained:{source:'restrained',loop:false},energetic:{source:'energetic',loop:false}},
  transitions:pairs.map(pair=>({...pair,switchPoints})),performers:{tracks:['lead','pad'],roomSource:entry}};
const clock={tempo,entry,sections:{restrained:{resource:'restrained'},energetic:{resource:'energetic'}},
  parameters:{drive:{}},transitions:pairs.map(({from,to})=>({id:'play-'+to,from,to,quantize:'none',
    when:{path:'/parameters/drive',value:Number(to==='energetic')}}))};
const commands=[[26,1],[99,0]].map(([tick,value])=>({tick,action:'world/input',args:{port:'score/parameter.drive',value}}));
const world={id:'copper-steps',dt:.05,systems:{score:{kind:'adaptive-music',config:clock}},commands};
const options={sampleRate,masterGain:2};
const score=write('score.json',{sources,timeline,live:{options}});
write('world.json',world);
const run=KIT.world.runtime.create(world);
run.advance(Math.round(end/world.dt));
const recording=run.recording();
write('world.run.json',recording);
const A=KIT.music.production;
const trace=write('world.trace.json',A.rehearsal.capture(recording,{id:'copper-steps'}));
const mix=path.join(dir,'mix');
execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
  score,trace,'--out',mix],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(mix,'listen.json'),'utf8'));
assert.equal(report.profile.clippedFrames,0);
assert.deepEqual(report.joins.map(join=>[join.switchPoint.id,join.time]),[['lift',2],['return',6]]);
for (const join of report.joins) {
  assert(join.carry.held.some(voice=>voice.state==='release'));
  assert(join.carry.held.some(voice=>voice.state==='held'));
  assert(join.carry.echoes.includes('lead'));
  assert(join.carry.room);
}

(async()=>{
  for (const take of Object.keys(sources)) {
    const {value}=await A.live.replay(sources,{...timeline,entry:take},{end,events:[]},options);
    fs.writeFileSync(path.join(dir,take+'.wav'),WAV.encode(value,{encoding:'pcm24'}));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
