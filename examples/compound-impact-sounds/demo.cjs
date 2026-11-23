const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const ink=require(repo), {world:W}=ink.load().KIT, rate=48000;
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name);
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});

const tau=2*Math.PI;
const decay=(t,hz,life)=>Math.sin(tau*hz*t)*Math.exp(-t/life);
function texture(duration,seed,peak,sample){
  let last=0, low=0, maximum=0;
  const samples=Float32Array.from({length:Math.round(duration*rate)},(_,i)=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    const white=seed/2147483648-1, noise=white-last;
    last=white;
    low+=.14*(white-low);
    const t=i/rate, fade=Math.min(1,i/12,(duration-t)/.009);
    const value=sample(t,low,noise)*fade;
    maximum=Math.max(maximum,Math.abs(value));
    return value;
  });
  return {sampleRate:rate,channels:1,samples:samples.map(value=>value*peak/maximum)};
}
function rattle(seed,beats){
  return texture(.31,seed,.72,(t,low,noise)=>beats.reduce((sum,[start,hz,level])=>{
    const age=t-start;
    if(age<0)return sum;
    const click=.3*noise*Math.exp(-age/.002)+decay(age,hz,.012)+.2*decay(age,hz*1.72,.016);
    return sum+level*Math.min(age/.00065,1)*click;
  },0));
}
const sources={
  strike:texture(.095,93,.8,(t,low,noise)=>
    .62*noise*Math.exp(-t/.003)+.8*decay(t,425,.011)+.18*decay(t,1350,.004)),
  boards:texture(.39,32,.8,(t,low,noise)=>
    1.5*low*Math.exp(-t/.013)+decay(t,113,.065)+.65*decay(t,184,.042)+.43*decay(t,271,.027)),
  stone:texture(.28,408,.84,(t,low,noise)=>
    .48*noise*Math.exp(-t/.009)+1.2*low*Math.exp(-t/.032)+.8*decay(t,247,.049)+.55*decay(t,657,.038)),
  'hardware-a':rattle(72,[[0,1540,1],[.019,1180,.86],[.051,1880,.62],[.093,1490,.38],[.138,960,.24]]),
  'hardware-b':rattle(360,[[0,1250,1],[.011,1710,.74],[.038,1010,.57],[.069,1520,.49],[.121,1280,.33]]),
  resonance:texture(1.05,17,.74,t=>Math.min(1,t/.035)*(
    decay(t,318,.21)+.53*decay(t,498,.18)+.44*decay(t,717,.14)+.22*decay(t,1109,.093)))
};
fs.mkdirSync(file('sources'),{recursive:true});
const entries=Object.entries(sources).map(([id,value])=>{
  const source='sources/'+id+'.wav';
  fs.writeFileSync(file(source),ink.encodeWav(value));
  return {asset:'workshop/'+id,revision:1,kind:'sound',file:source};
});
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,entries});
run('assets','lock','assets-draft.json','--out','assets.json');
const events=[
  {time:.32,material:'shop/boards',speed:.55,load:8,strength:.18,gain:.72,layers:['strike']},
  {time:1.58,material:'shop/boards',speed:1.7,load:24,strength:.42,gain:.96,layers:['strike','surface']},
  {time:2.86,material:'shop/boards',speed:3.7,load:56,strength:.88,gain:1,layers:['strike','surface','rattle','tail']},
  {time:4.48,material:'shop/stone',speed:3.7,load:60,strength:.9,gain:1,layers:['strike','surface','rattle','tail']}
];
const dt=.05;
const commands=events.map(({time,material,speed,load,strength,gain},i)=>({
  tick:Math.ceil(time/dt),action:'world/event',
  args:W.timedEvents.at(time,{kind:'material-sound',interaction:'impact',cue:'strike',
    contact:{prop:'toolbox',material,speed,load,strength,point:[i%2?.38:-.38,0,-1]},gain})
}));
save('workshop.world.json',{format:'ink-studio/world',version:1,id:'compound-workshop',dt,commands});
run('sim','run','workshop.world.json','--ticks','124','--record','workshop.run.json');
const variation={rotate:true,pitchCents:[-50,50]};
const spatial={soundSeed:1943,
  cues:Object.fromEntries(Object.keys(sources).map(id=>[id,{asset:id}])),
  materials:{'shop/boards':{impact:'boards'},'shop/stone':{impact:'stone'}},
  soundFamilies:{hardware:{takes:{a:'hardware-a',b:'hardware-b'},variation}},
  bindings:{toolbox:{on:{kind:'material-sound',where:{path:'/interaction',value:'impact'}},impactLayers:{
    strike:{cue:'strike',threshold:{measure:'speed',min:.35},bus:'foley',gain:.87},
    surface:{interaction:'impact',threshold:{measure:'speed',min:1.2},bus:'effects',delay:.009,gain:.9},
    rattle:{select:[{id:'loose-parts',when:{prop:'toolbox'},family:'hardware'}],
      threshold:{measure:'load',min:35},bus:'foley',delay:.043,gain:.7},
    tail:{cue:'resonance',threshold:{measure:'strength',min:.7},bus:'ambience',delay:.027,gain:.39}
  }}}};
const definition={format:'ink-studio/scene-audio',version:1,sampleRate:rate,assetRegistry:'assets.json',
  assets:Object.fromEntries(read('assets.json').entries.map(({asset,revision,sha256})=>
    [asset.slice('workshop/'.length),{asset,revision,sha256}])),spatial,post:{}};
save('workshop.audio.json',definition);
run('story','audio','workshop.run.json','workshop.audio.json','--out','mix');
const report=read('mix/report.json'), receipts=read('mix/receipts.json').choices;
assert.equal(new Set(report.cues.map(row=>row.source.beatId)).size,events.length);
const byOnset=onset=>report.cues.filter(row=>row.onsetSample===onset);
for(const event of events){
  const onset=Math.round(event.time*rate), layers=byOnset(onset);
  assert.deepEqual(layers.map(row=>row.impact.layer),event.layers);
  for(const row of layers)
    assert.equal(row.arrivalSample,onset+Math.round(row.impact.delay*rate));
}
assert.deepEqual(report.cues.filter(row=>row.impact.layer==='surface').map(row=>row.cue),['boards','boards','stone']);
assert.equal(new Set(receipts.map(row=>row.take)).size,2);
assert(report.headroom===1);
fs.copyFileSync(file('mix/mix.wav'),file('compound-impact-sounds.wav'));
save('demo-summary.json',{audio:'compound-impact-sounds.wav',sampleRate:rate,events,receipts});
fs.writeFileSync(file('README.txt'),`Ink Studio compound impacts

0.32 s   Light tap. Only the initial strike clears its threshold.
1.58 s   Medium hit. The boards add a hollow response.
2.86 s   Hard hit on boards. Hear the loose hardware and the toolbox ring.
4.48 s   Hard hit on stone. The surface changes and the hardware uses another take.

The strike and rattle print to foley.wav, surface response to effects.wav, and
resonance to ambience.wav. mix/report.json shows the original beat plus each
layer's measured threshold and exact sample onset.

With the Ink Studio CLI built, replay from this directory:

  node /path/to/ink-studio/cli/ink-studio.js story audio workshop.run.json workshop.audio.json --receipts mix/receipts.json --out replay

Or rebuild the demo in a fresh directory:

  node demo.cjs /path/to/new-output /path/to/ink-studio
`);
console.log('Rendered four impacts. Verified layer gates, material cues, exact offsets, and different rattle takes.');
