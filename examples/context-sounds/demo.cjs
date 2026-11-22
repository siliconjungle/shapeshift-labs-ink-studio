const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name), rate=48000;
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});
const shots={
  'wet-tick':{duration:.21,peak:.49,shape:{pitchSemitones:6.5,sweep:.7,decay:.8},
    synth:{pulseWidth:.26,noise:{color:'pink',level:.35},filter:{type:'highpass',fromHz:700,toHz:200}}},
  'wet-ring-a':{duration:.29,peak:.78,shape:{pitchSemitones:7.8,sweep:.6,decay:.73},
    synth:{pulseWidth:.25,noise:{color:'pink',level:.56},filter:{fromHz:6400,toHz:880},punch:{amount:2.3,decayMs:22}}},
  'wet-ring-b':{duration:.32,peak:.8,shape:{pitchSemitones:5.8,sweep:.56,decay:.64},
    synth:{pulseWidth:.33,noise:{color:'pink',level:.67},filter:{fromHz:5900,toHz:670},punch:{amount:2,decayMs:28}}},
  'board-tap':{duration:.19,peak:.51,shape:{pitchSemitones:-5.5,decay:1.4},
    synth:{noise:{color:'brown',level:.65},filter:{fromHz:1450,toHz:320}}},
  'board-knock-a':{duration:.24,peak:.79,shape:{pitchSemitones:-3.8,decay:1.15},
    synth:{noise:{color:'brown',level:.8},filter:{fromHz:2350,toHz:390},punch:{amount:1.7,decayMs:31}}},
  'board-knock-b':{duration:.27,peak:.77,shape:{pitchSemitones:-4.9,decay:1.2},
    synth:{noise:{color:'brown',level:.9},filter:{fromHz:1800,toHz:330},punch:{amount:2,decayMs:33}}},
  'generic-tap':{duration:.14,peak:.36,shape:{pitchSemitones:1.5,decay:1.5}}
};
fs.mkdirSync(file('sounds'),{recursive:true});
const entries=Object.entries(shots).map(([id,{duration,peak,shape,synth}],index)=>{
  const source='sounds/'+id+'.sound.json';
  save(source,{format:'ink-studio/sound-recipe',version:1,id,family:'impact',seed:8414+43*index,
    render:{sampleRate:rate,duration,peak},shape,...(synth&&{synth})});
  return {asset:'contact/'+id,revision:1,kind:'sound',file:source};
});
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,entries});
run('assets','lock','assets-draft.json','--out','assets.json');
const pinned=read('assets.json').entries;
const wet=[-.86,0,-1.55],dry=[.83,0,-1.55];
const contacts=[
  {label:'Wet stone · light',at:wet,strength:.23,family:'wet-stone'},
  {label:'Wet stone · hard',at:wet,strength:.83,family:'wet-stone'},
  {label:'Dry boards · light',at:dry,strength:.23,family:'dry-boards'},
  {label:'Dry boards · hard',at:dry,strength:.83,family:'dry-boards'},
  {label:'Wet stone · another hard drop',at:wet,strength:.87,family:'wet-stone'},
  {label:'Dry boards · another hard drop',at:dry,strength:.9,family:'dry-boards'},
  {label:'Different object · default cue',at:wet,strength:.82,object:'wrench'}
];
save('workbench.world.json',{format:'ink-studio/world',version:1,id:'workbench-drop',dt:.05,history:{enabled:true},
  assetPacks:[{format:'ink-studio/asset-pack',version:1,id:'shop',title:'Workshop surfaces',revision:1,materials:[
    {id:'shop/stone',label:'Stone',friction:.63},{id:'shop/boards',label:'Boards',friction:.54}]}],
  systems:{floor:{kind:'materials',config:{grid:{width:8,height:8,cell:.5,origin:[-2,-3]},
    material:'shop/boards',regions:[{bounds:{min:[-2,-3],max:[0,1]},material:'shop/stone',wetness:.85}]}}},
  commands:contacts.map(({at,strength,object='metal-hook'},index)=>({tick:4+15*index,action:'world/event',args:{
    kind:'object-contact',contact:{action:'drop',object,strength,point:at}
  }}))});
run('sim','run','workbench.world.json','--ticks','104','--record','workbench.run.json');
const family=(soft,a,b)=>({takes:{
  light:{cue:soft,strength:[0,.45]},
  'hard-a':{cue:a,strength:[.45,1]},
  'hard-b':{cue:b,strength:[.45,1],weight:2}
}});
save('workbench.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,assetRegistry:'assets.json',
  assets:Object.fromEntries(pinned.map(({asset,revision,sha256})=>[asset.slice('contact/'.length),{asset,revision,sha256}])),
  listener:[0,0,0],post:{},spatial:{soundSeed:417,surface:'floor/surface',
    cues:Object.fromEntries(Object.keys(shots).map(id=>[id,{asset:id,bus:'foley',distance:{rolloff:0}}])),
    soundFamilies:{'wet-stone':family('wet-tick','wet-ring-a','wet-ring-b'),
      'dry-boards':family('board-tap','board-knock-a','board-knock-b')},
    bindings:{drops:{on:{kind:'object-contact'},cue:'generic-tap',select:[
      {id:'wet-hook',when:{action:'drop',object:'metal-hook',surface:'shop/stone',wetness:[.5,1]},family:'wet-stone'},
      {id:'dry-hook',when:{action:'drop',object:'metal-hook',surface:'shop/boards',wetness:[0,.5]},family:'dry-boards'}
    ]}}}});
run('story','audio','workbench.run.json','workbench.audio.json','--out','story');
const report=read('story/report.json');
assert.deepEqual(report.cues.map(row=>row.selection?.family),contacts.map(shot=>shot.family));
assert.deepEqual(report.cues.slice(0,4).map(row=>row.selection.context.wetness),[.85,.85,0,0]);
assert.equal(report.cues.at(-1).cue,'generic-tap');
run('story','audio','workbench.run.json','workbench.audio.json','--from','1.6','--to','4.2','--out','trim');
const full=report.cues.filter(row=>row.onsetSample>=1.6*rate&&row.onsetSample<4.2*rate);
assert.deepEqual(read('trim/report.json').cues.filter(row=>row.onsetSample>=1.6*rate),full);
fs.copyFileSync(file('story/mix.wav'),file('context-sounds.wav'));
save('demo-summary.json',{audio:'context-sounds.wav',rate,events:report.cues.map((row,i)=>({
  label:contacts[i].label,beatId:row.source.beatId,at:row.onsetSample/rate,cue:row.cue,selection:row.selection??null
}))});
console.log('Rendered wet stone, dry boards, light and hard contacts, then verified the trimmed replay choices.');
