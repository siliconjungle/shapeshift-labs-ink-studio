const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2]||!process.argv[3])throw Error('Use node demo.cjs <output-directory> <dry-call.wav> [ink-studio-repository]');
const repo=path.resolve(process.argv[4]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const ink=require(repo), {world:W}=ink.load().KIT, rate=48000, dt=.05;
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name);
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});

fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.resolve(process.argv[3])), wav=ink.decodeWav(source);
const duration=wav.samples.length/(wav.channels*wav.sampleRate);
assert(duration>=.25&&duration<=10,'Use a dry call between 250 ms and 10 seconds');
fs.writeFileSync(file('call.wav'),source);
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,
  entries:[{asset:'workshop/radio-call',revision:1,kind:'voice',file:'call.wav'}]});
run('assets','lock','assets-draft.json','--out','assets.json');

const spacing=Math.ceil((duration+.65)/dt);
const plays=['open-air','steel-pipe','closed-hatch','underwater'].map((mode,i)=>({
  mode,tick:6+i*spacing,time:(6+i*spacing)/20
}));
const commands=[];
function move(tick,entity,position){
  commands.push({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/'+entity+'/position',value:position}]}});
}
for(const {mode,tick,time} of plays){
  if(mode==='closed-hatch'){
    commands.push({tick:tick-2,action:'world/input',args:{port:'air/opening.hatch',value:0}});
    move(tick-1,'caller',[1,2,0]);
  }
  if(mode==='underwater'){
    move(tick-1,'caller',[-5,1,3]);
    move(tick-1,'listener',[-2,1,3]);
  }
  commands.push({tick,action:'world/event',args:W.timedEvents.at(time,{kind:'audio-cue',
    cue:'call',at:{entity:'caller'},...(mode==='steel-pipe'&&{object:'steel-pipe'})})});
}
save('workshop.world.json',{format:'ink-studio/world',version:1,id:'contextual-workshop',dt,
  entities:{caller:{position:[-5,2,0]},listener:{position:[-2,2,0]}},
  systems:{
    air:{kind:'ventilation',config:{rooms:{
      hall:{bounds:{min:[-8,0,-5],max:[0,4,5]}},
      chamber:{bounds:{min:[0,0,-5],max:[8,4,5]}}
    },openings:{hatch:{from:'hall',to:'chamber',at:[0,2,0]}}}},
    pool:{kind:'enclosed-water',config:{chambers:{basin:{
      bounds:{min:[-7,0,2],max:[-1,4,4]},initial:24
    }}}},
    acoustics:{kind:'acoustics',config:{layout:'air/acoustic-layout',media:['pool/acoustic-layout'],
      openings:{hatch:{closedLossDb:[2,5,14]}}}}
  },commands});
run('sim','run','workshop.world.json','--ticks',String(6+4*spacing),'--record','workshop.run.json');

const [{asset,revision,sha256}]=read('assets.json').entries;
const processing={path:'acoustics/path',profiles:{
  pipe:{highpass:370,lowpass:2600,gainDb:-1,peaks:[{hz:695,q:4.8,gainDb:13},{hz:1380,q:5.5,gainDb:7}]},
  hatch:{lowpass:800,gainDb:1.5,peaks:[{hz:380,q:3,gainDb:5}]},
  water:{lowpass:390,gainDb:1,peaks:[{hz:190,q:2,gainDb:6}]}
},rules:[
  {id:'underwater',when:{medium:'water',minMeters:1.2},profile:'water'},
  {id:'closed-hatch',when:{opening:'hatch',maxOpen:.08},profile:'hatch'},
  {id:'steel-pipe',when:{object:'steel-pipe'},profile:'pipe'}
]};
save('workshop.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener:{at:{entity:'listener'},forward:[1,0,0]},
  assets:{call:{asset,revision,sha256}},assetRegistry:'assets.json',post:{},spatial:{
    cues:{call:{asset:'call',bus:'dialogue',gain:.65}},distance:{reference:4,rolloff:0},
    occlusion:{acoustic:'acoustics/audible'},processing
  }});
run('story','audio','workshop.run.json','workshop.audio.json','--out','mix');

const report=read('mix/report.json'), rows=report.cues;
assert.deepEqual(rows.map(row=>row.asset),['call','call','call','call']);
assert.deepEqual(rows.map(row=>row.processing?.rule??'open-air'),plays.map(row=>row.mode));
assert.deepEqual(rows.map(row=>row.onsetSample),plays.map(row=>Math.round(row.time*rate)));
const start=Math.floor((plays[2].time+duration/3)*rate), end=Math.floor((plays[3].time+duration/2)*rate);
run('story','audio','workshop.run.json','workshop.audio.json','--from',start+'/'+rate,'--to',end+'/'+rate,'--out','trim');
const rendered=ink.decodeWav(bytes('mix/dialogue.wav')), trimmed=ink.decodeWav(bytes('trim/dialogue.wav'));
assert.deepEqual(trimmed.samples,rendered.samples.subarray(start*2,end*2));
fs.copyFileSync(file('mix/mix.wav'),file('contextual-sound-processing.wav'));
save('demo-summary.json',{audio:'contextual-sound-processing.wav',sampleRate:rate,plays,sourceAsset:asset,sourceHash:sha256});
fs.writeFileSync(file('README.txt'),`Ink Studio contextual sound processing

${plays.map(({mode,time})=>time.toFixed(2)+' s   '+mode).join('\n')}

Every call plays the same call.wav. The pipe selects a profile from the source
object. The hatch profile reads the simulated opening fraction. The water
profile measures the length of submerged acoustic path. The dialogue stem and
mix/report.json contain the full render and the selected profile per call.

With the Ink Studio CLI built, replay from this directory:

  node /path/to/ink-studio/cli/ink-studio.js story audio workshop.run.json workshop.audio.json --out replay

Or rebuild the world, plan, and audio in a fresh directory:

  node demo.cjs /path/to/new-output call.wav /path/to/ink-studio
`);
console.log('Rendered the same call in air, through a pipe, behind a closed hatch, and underwater. Verified a sample-identical trim.');
