const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const ink=require(repo), {world:W}=ink.load().KIT, rate=48000;
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name);
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});

// Integer harmonics generate seamless loops one second long.
function texture({seed,low,high,grain,tone,color}){
  const samples=new Float32Array(rate), tau=2*Math.PI;
  function next(){
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  }
  for(let partial=0;partial<100;partial++){
    const u=next(), hz=low+Math.round((high-low)*u**color), phase=tau*next();
    const weight=(.3+next()*.7)/(1+2*u), step=tau*hz/rate;
    for(let i=0;i<rate;i++)samples[i]+=weight*Math.sin(i*step+phase);
  }
  let peak=0;
  for(let i=0;i<rate;i++){
    const angle=tau*i/rate;
    const cycle=.5+.5*Math.sin(grain*angle+1.2*Math.sin(3*angle));
    samples[i]=samples[i]*(.34+.66*cycle)+tone[1]*Math.sin(tone[0]*angle)*cycle;
    peak=Math.max(peak,Math.abs(samples[i]));
  }
  return {sampleRate:rate,channels:1,samples:samples.map(value=>value*.78/peak)};
}
const textures={
  'crate-boards':{seed:11,low:62,high:880,grain:9,tone:[71,1.2],color:2.6},
  'crate-stone':{seed:9,low:100,high:2200,grain:17,tone:[125,.2],color:1.1},
  'wheel-boards':{seed:18,low:38,high:530,grain:8,tone:[54,4],color:2.5},
  'wheel-stone':{seed:59,low:75,high:1330,grain:18,tone:[82,1.6],color:2},
  'tool-boards':{seed:76,low:160,high:3300,grain:22,tone:[366,1.8],color:1.5},
  'tool-stone':{seed:23,low:240,high:4400,grain:26,tone:[630,3.2],color:1}
};
fs.mkdirSync(file('loops'),{recursive:true});
const entries=Object.entries(textures).map(([id,spec])=>{
  const source='loops/'+id+'.wav';
  fs.writeFileSync(file(source),ink.encodeWav(texture(spec)));
  return {asset:'workshop/'+id,revision:1,kind:'sound',file:source};
});
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,entries});
run('assets','lock','assets-draft.json','--out','assets.json');

const actions=[
  {id:'crate',interaction:'drag',start:.23,switch:1.48,end:2.39,speed:[.7,2.4,1.6],load:[22,68,34]},
  {id:'wheel',interaction:'roll',start:2.86,switch:4.09,end:5.04,speed:[.6,3.3,2.3],load:[20,62,29]},
  {id:'tool',interaction:'scrape',start:5.51,switch:6.72,end:7.93,speed:[.62,1.82,1.1],load:[18,50,22]}
];
const dt=.05, commands=[];
function event(kind,time,contact){
  commands.push({tick:Math.ceil(time/dt),action:'world/event',args:W.timedEvents.at(time,{kind,contact})});
}
for(const {id,interaction,start,switch:cross,end,speed,load} of actions){
  event('contact-start',start,{id,interaction,material:'shop/boards',speed:speed[0],load:load[0],point:[-1,0,-2]});
  for(let step=1;step<=18;step++){
    const u=step/18, time=+(start+(cross-start)*u*.95).toFixed(4);
    event('contact-update',time,{id,speed:speed[0]+(speed[1]-speed[0])*u,
      load:load[0]+(load[1]-load[0])*u,point:[u*.5-1,0,-2]});
  }
  event('contact-update',cross,{id,material:'shop/stone'});
  for(let step=1;step<=12;step++){
    const u=step/12, time=+(cross+(end-cross)*u*.9).toFixed(4);
    event('contact-update',time,{id,speed:speed[1]+(speed[2]-speed[1])*u,
      load:load[1]+(load[2]-load[1])*u,point:[u*1.5-.5,0,-2]});
  }
  event('contact-end',end,{id});
}
save('workshop.world.json',{format:'ink-studio/world',version:1,id:'continuous-workshop',dt,commands});
run('sim','run','workshop.world.json','--ticks','170','--record','workshop.run.json');

const spatial={
  cues:Object.fromEntries(Object.keys(textures).map(id=>[id,{asset:id,gain:id.startsWith('tool')?.68:.88,
    distance:{reference:2,rolloff:.25}}])),
  contactLoops:{attack:.11,crossfade:.24,release:.22,response:.07,
    interactions:Object.fromEntries(actions.map(({id,interaction})=>[interaction,{
      cue:id+'-boards',materials:{'shop/stone':id+'-stone'},speedForFullRate:interaction==='scrape'?2.2:3.6,
      loadForFullGain:65,rate:[.52,1.6]
    }]))}
};
save('workshop.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,assetRegistry:'assets.json',
  assets:Object.fromEntries(read('assets.json').entries.map(({asset,revision,sha256})=>[asset.slice('workshop/'.length),{asset,revision,sha256}])),
  spatial,post:{}});
run('story','audio','workshop.run.json','workshop.audio.json','--out','mix');
run('story','audio','workshop.run.json','workshop.audio.json','--from','1.25','--to','7.5','--out','trim');
const full=ink.decodeWav(bytes('mix/foley.wav')), trim=ink.decodeWav(bytes('trim/foley.wav'));
assert.deepEqual(trim.samples,full.samples.subarray(1.25*rate*2,7.5*rate*2));
const contactTracks=read('mix/report.json').contacts;
assert.equal(contactTracks.length,6);
for(const {id,start,switch:cross,end} of actions){
  const [boards,stone]=contactTracks.filter(row=>row.id===id);
  assert.deepEqual([boards.fromSample,boards.toSample,stone.fromSample,stone.toSample],
    [start,cross+.24,cross,end+.22].map(time=>Math.round(time*rate)));
  assert.equal(stone.file,'foley.wav');
}
fs.copyFileSync(file('mix/mix.wav'),file('continuous-contact-sounds.wav'));
save('demo-summary.json',{audio:'continuous-contact-sounds.wav',sampleRate:rate,actions,contactTracks});
fs.writeFileSync(file('README.txt'),`Ink Studio continuous contact sounds

0.23–2.61 s   A crate drags over boards onto stone
2.86–5.26 s   A wheel rolls over boards onto stone
5.51–8.15 s   A tool scrapes over boards onto stone

Listen for the rate and gain increasing before each switch, the two materials overlapping
for 240 ms, and the sound taking 220 ms to die away when contact ends. The six source loops
are in loops/. Inspect their exact placements in mix/report.json.

With the Ink Studio CLI built, replay from this directory:

  node /path/to/ink-studio/cli/ink-studio.js story audio workshop.run.json workshop.audio.json --out replay

Or rebuild the entire demo in a fresh directory:

  node demo.cjs /path/to/new-output /path/to/ink-studio
`);
console.log('Rendered three continuous contacts. Verified six loop placements and a sample-identical foley trim.');
