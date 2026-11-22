const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name), rate=48000;
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});
const takes={
  'board-tap':{peak:.44,duration:.21,shape:{pitchSemitones:-6,decay:1.35},
    synth:{noise:{color:'brown',level:.7},filter:{fromHz:1450,toHz:390}}},
  'board-thump':{peak:.77,duration:.26,shape:{pitchSemitones:-3.8,decay:1.13},
    synth:{noise:{color:'brown',level:.8},filter:{fromHz:2450,toHz:330},punch:{amount:2.1,decayMs:28}}},
  'latch-touch':{peak:.49,duration:.21,shape:{pitchSemitones:8,sweep:.55,decay:.85},
    synth:{pulseWidth:.27,noise:{color:'pink',level:.35},filter:{type:'highpass',fromHz:680,toHz:280}}},
  'latch-clack':{peak:.81,duration:.29,shape:{pitchSemitones:8.6,sweep:.57,decay:.65},
    synth:{pulseWidth:.2,noise:{color:'white',level:.37},filter:{fromHz:7400,toHz:970},punch:{amount:2.8,decayMs:18}}},
  fallback:{peak:.33,duration:.14,shape:{pitchSemitones:1,decay:1.6}}
};
fs.mkdirSync(file('sounds'),{recursive:true});
const entries=Object.entries(takes).map(([id,{peak,duration,shape,synth}],index)=>{
  const filename='sounds/'+id+'.sound.json';
  save(filename,{format:'ink-studio/sound-recipe',version:1,id,family:'impact',seed:7301+index*73,
    render:{sampleRate:rate,peak,duration},shape,...(synth&&{synth})});
  return {asset:'workshop/'+id,revision:1,kind:'sound',file:filename};
});
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,entries});
run('assets','lock','assets-draft.json','--out','assets.json');

const contacts=[
  {label:'Boards · low speed',data:{speed:0},family:'boards',weights:[1]},
  {label:'Boards · middle speed',data:{speed:2},family:'boards',weights:[.5,.5]},
  {label:'Boards · high speed',data:{speed:4},family:'boards',weights:[1]},
  {label:'Latch on boards · low load',data:{prop:'brass-latch',load:0,speed:4},family:'latch',weights:[1]},
  {label:'Latch on boards · middle load',data:{prop:'brass-latch',force:[50,-60,0],normal:[0,1,0],speed:4},family:'latch',weights:[.5,.5]},
  {label:'Latch on boards · high load',data:{prop:'brass-latch',load:120},family:'latch',weights:[1]},
  {label:'Latch · missing reading',data:{prop:'brass-latch'},family:'latch',weights:[1]},
  {label:'Knob · no eligible prop take, boards fallback',data:{prop:'cabinet-knob',speed:2},family:'boards',weights:[.5,.5]},
  {label:'Unmapped surface · default cue',data:{surface:'shop/rag',speed:2},weights:[1]}
];
const point=[0,0,-1.45];
save('shop.world.json',{format:'ink-studio/world',version:1,id:'brass-latch-velocity',dt:.05,history:{enabled:true},
  assetPacks:[{format:'ink-studio/asset-pack',version:1,id:'shop',title:'Workshop floor',revision:1,
    materials:[{id:'shop/boards',label:'Boards',friction:.54}]}],
  systems:{floor:{kind:'materials',config:{grid:{width:8,height:8,cell:.5,origin:[-2,-3]},material:'shop/boards'}}},
  commands:contacts.map(({data},i)=>({tick:4+15*i,action:'world/event',args:{
    kind:'object-contact',contact:{action:'drop',object:'hardware',point,...data}
  }}))});
run('sim','run','shop.world.json','--ticks','136','--record','shop.run.json');
const family=(soft,hard)=>({takes:{soft,hard},layers:[{at:0,takes:['soft']},{at:1,takes:['hard']}]});
const knob=family('latch-touch','latch-clack');
knob.takes={soft:{cue:'latch-touch',strength:[0,.2]},hard:{cue:'latch-clack',strength:[.8,1]}};
save('shop.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener:[0,0,0],assetRegistry:'assets.json',
  assets:Object.fromEntries(read('assets.json').entries.map(({asset,revision,sha256})=>[asset.slice('workshop/'.length),{asset,revision,sha256}])),
  post:{},spatial:{surface:'floor/surface',soundSeed:38,
    cues:Object.fromEntries(Object.keys(takes).map(id=>[id,{asset:id,bus:'foley',distance:{rolloff:0}}])),
    soundFamilies:{boards:family('board-tap','board-thump'),latch:family('latch-touch','latch-clack'),knob},
    bindings:{hardware:{on:{kind:'object-contact'},cue:'fallback',speedForFullStrength:4,loadForFullStrength:120,select:[
      {id:'floor',when:{action:'drop',surface:'shop/boards'},family:'boards'},
      {id:'latch',when:{action:'drop',prop:'brass-latch'},family:'latch'},
      {id:'knob',when:{action:'drop',prop:'cabinet-knob'},family:'knob'}
    ]}}}});
run('story','audio','shop.run.json','shop.audio.json','--out','story');
const report=read('story/report.json');
const events=contacts.map(({label,family,weights},i)=>{
  const rows=report.cues.filter(row=>row.source.tick===4+15*i);
  assert.deepEqual(rows.map(row=>row.selection?.family),weights.map(()=>family));
  assert.deepEqual(rows.map(row=>row.selection?.layer.weight??1),weights);
  assert.equal(new Set(rows.map(row=>row.onsetSample)).size,1);
  return {label,at:rows[0].onsetSample/rate,beatId:rows[0].source.beatId,
    takes:rows.map(({cue,selection})=>({cue,selection:selection??null}))};
});
assert.equal(events[4].takes[0].selection.measurement.kind,'load');
assert.equal(events[6].takes[0].selection.fallback,'quiet-layer');
run('story','audio','shop.run.json','shop.audio.json','--from','2.1','--to','5.35','--out','trim');
assert.deepEqual(read('trim/report.json').cues.filter(row=>row.onsetSample>=2.1*rate),
  report.cues.filter(row=>row.onsetSample>=2.1*rate&&row.onsetSample<5.35*rate));
fs.copyFileSync(file('story/mix.wav'),file('velocity-layers.wav'));
save('demo-summary.json',{audio:'velocity-layers.wav',rate,events});
console.log('Rendered speed and load blends, prop overrides, and fallbacks from one recorded run.');
