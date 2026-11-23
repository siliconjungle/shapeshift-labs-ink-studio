/* Dock Hardware travels from the lock workshop to a freight lift. */
const assert=require('node:assert/strict'), fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'), {load,encodeWav,decodeWav}=require(repo);
const {KIT:K}=load(), rate=32000;
const root=path.resolve(process.argv[2]??'dock-hardware'), cli=path.join(repo,'cli/ink-studio.js');
const file=name=>path.join(root,name);
function put(name,data){
  fs.mkdirSync(path.dirname(file(name)),{recursive:true});
  fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
}
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const bytes=name=>fs.readFileSync(file(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
const copy=(from,to)=>fs.copyFileSync(file(from),file(to));
const audio=(recipe,name)=>{
  put('author/'+name+'.sound.json',recipe);
  const sound=K.procedural.mediaGraph.soundRecipe.render(recipe);
  fs.writeFileSync(file('author/'+name+'.wav'),encodeWav(sound.value,{encoding:'pcm24'}));
};
audio({format:'ink-studio/sound-recipe',version:1,id:'latch-touch',family:'impact',seed:916,
  render:{sampleRate:rate,duration:.16,peak:.62},shape:{pitchSemitones:6.2,sweep:.60,noise:.9},
  synth:{noise:{color:'pink',level:.45},filter:{fromHz:4400,toHz:730}}},'latch-touch');
audio({format:'ink-studio/sound-recipe',version:1,id:'oak-drop',family:'impact',seed:150,
  render:{sampleRate:rate,duration:.26,peak:.79},shape:{pitchSemitones:-5.1,decay:1.37},
  synth:{noise:{color:'brown',level:.83},filter:{fromHz:1900,toHz:280}}},'oak-drop');
const native=path.join(repo,'examples/native-sound-library');
for(const name of ['metal-iron-hard-a','metal-iron-hard-b'])
  fs.copyFileSync(path.join(native,'recordings',name+'.wav'),file('author/'+name+'.wav'));
const names=['metal-iron-hard-a','metal-iron-hard-b'];
put('author/registry.draft.json',{format:'ink-studio/asset-registry',version:1,
  entries:names.map(name=>({asset:'dock/'+name,revision:1,kind:'sound',file:name+'.wav'}))});
run('assets','lock','author/registry.draft.json','--out','author/registry.json');
const refs=read('author/registry.json').entries.map(({asset,revision,sha256})=>({asset,revision,sha256}));
const credit='Versilian Studios Chamber Orchestra Community Sound Library, CC0.';
const packAssets={
  'dock/latch-touch':{recipe:'latch-touch.sound.json',recording:'latch-touch.wav',playback:'recipe'},
  'dock/oak-drop':{recipe:'oak-drop.sound.json'},
  'dock/iron-a':{recording:refs[0],credit},'dock/iron-b':{recording:refs[1],credit}
};
const cues=Object.fromEntries(Object.keys(packAssets).map(asset=>[asset,{asset,bus:'foley',gain:asset.includes('iron')?.65:.73}]));
const spat={
  cues,materials:{'dock/iron':{impact:'dock/iron-a'},'dock/oak':{impact:'dock/oak-drop'}},
  soundFamilies:{'dock/latch':{takes:{light:{cue:'dock/latch-touch',strength:[0,.45]},
    'iron-a':{cue:'dock/iron-a',strength:[.45,1]},'iron-b':{cue:'dock/iron-b',strength:[.45,1]}},
    variation:{rotate:true,pitchCents:[-30,30]}}},
  bindings:{'dock/hardware-drop':{on:{kind:'tool-drop'},interaction:'impact',select:[
    {id:'struck-latch',family:'dock/latch',when:{object:'latch',surface:'dock/iron'}}
  ]}}
};
const soundSeed=391;
const hit=(tick,strength,material,at,object='latch')=>({tick,action:'world/event',
  args:{kind:'tool-drop',action:'drop',point:at,object,material,strength}});
const direct=(tick,cue,at)=>({tick,action:'world/event',args:{kind:'audio-cue',cue,at}});
const world=(id,commands)=>({format:'ink-studio/world',version:1,id,dt:.05,commands});
put('author/workshop.world.json',world('lock-workshop',[
  hit(5,.22,'dock/iron',[-.3,0,-1]),hit(18,.87,'dock/iron',[0,0,-1.15]),
  hit(32,.94,'dock/iron',[.45,0,-1]),hit(47,.73,'dock/oak',[.65,0,-1],'wrench'),
  direct(59,'dock/latch-touch',[0,0,-1])
]));
run('sim','run','author/workshop.world.json','--ticks','76','--record','author/workshop.run.json');
const base={format:'ink-studio/scene-audio',version:1,sampleRate:rate};
const listener=[0,0,0];
put('author/workshop.audio.json',{...base,listener,assets:Object.fromEntries(Object.entries(packAssets)
  .map(([name,row])=>[name,row.playback==='recipe'?row.recipe:row.recording??row.recipe])),
  assetRegistry:'registry.json',spatial:{...spat,soundSeed}});
run('story','audio','author/workshop.run.json','author/workshop.audio.json','--out','author/reference');
const workshop=read('author/reference/report.json');
const beat=workshop.cues.find(row=>row.selection?.take==='light').source.beatId;
put('author/dock.source.json',{format:'ink-studio/world-sound-pack-source',version:1,id:'dock-hardware',revision:1,
  label:'Dock Hardware',assetRegistry:'registry.json',assets:packAssets,spatial:spat,
  examples:{workshop:{label:'Latch on iron and wrench on oak',run:'workshop.run.json',preview:'reference/mix.wav',
    beat,listener,sampleRate:rate,soundSeed}}});
fs.mkdirSync(file('freight-lift/sound'),{recursive:true});
const packed=JSON.parse(run('music','sound','pack','build','author/dock.source.json','--out','freight-lift/sound/dock-hardware.json'));
run('music','sound','pack','audition','freight-lift/sound/dock-hardware.json','workshop','--out','workshop-audition');
assert(bytes('workshop-audition/mix.wav').equals(bytes('workshop-audition/reference.wav')));

put('freight-lift/lift.world.json',world('freight-lift',[
  direct(3,'lift/relay',[-1,0,-1]),hit(12,.29,'dock/iron',[.7,0,-1.75]),
  hit(28,.96,'dock/iron',[.82,0,-1.65]),hit(43,.55,'dock/oak',[-1,0,-1.6],'crate'),
  hit(57,.78,'dock/iron',[.2,0,-1.05]),direct(70,'dock/latch-touch',[0,0,-1])
]));
const relay={format:'ink-studio/sound-recipe',version:1,id:'lift-relay',family:'confirm',seed:92,
  render:{sampleRate:rate,duration:.26,peak:.45},retro:{bits:9}};
put('freight-lift/relay.sound.json',relay);
put('freight-lift/lift.audio.json',{...base,listener:[-.55,0,0],assets:{relay:'relay.sound.json'},
  worldSoundPacks:[{file:'sound/dock-hardware.json',id:packed.id,revision:packed.revision,sha256:packed.sha256}],
  spatial:{soundSeed,occlusion:{lossDb:3},distance:{reference:.8,rolloff:.6,max:20},
    cues:{'lift/relay':{asset:'relay',bus:'effects',gain:.55}},materials:{'dock/oak':{step:'lift/relay'}}}});
run('sim','run','freight-lift/lift.world.json','--ticks','86','--record','freight-lift/lift.run.json');
run('story','audio','freight-lift/lift.run.json','freight-lift/lift.audio.json','--out','lift-audition');
put('freight-lift/lift.take.json',{format:'ink-studio/take',version:1,id:'freight-lift',
  world:'lift.world.json',audio:'lift.audio.json',clock:{fps:24,simulationRate:20,sampleRate:rate}});
put('freight-lift/attachments.json',{recording:'lift.run.json'});
run('project','pack','freight-lift/lift.take.json','--attachments','freight-lift/attachments.json','--out','freight-lift.project.json');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ink-lift-relocation-')), moved=path.join(scratch,'relocated');
try{
  run('project','unpack','freight-lift.project.json','--out',moved);
  const replay=path.join(scratch,'replay');
  run('story','audio',path.join(moved,'lift.run.json'),path.join(moved,'lift.audio.json'),'--out',replay);
  for(const name of ['mix.wav','receipts.json'])
    assert(bytes('lift-audition/'+name).equals(fs.readFileSync(path.join(replay,name))));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
const lift=read('lift-audition/report.json');
assert.equal(lift.cues[0].cue,'lift/relay');
assert.equal(lift.cues[1].selection.family,'dock/latch');
assert.equal(lift.cues[3].cue,'dock/oak-drop');
assert.equal(lift.cues.at(-1).cue,'dock/latch-touch');
copy('freight-lift/sound/dock-hardware.json','dock-hardware.json');
const left=decodeWav(bytes('workshop-audition/mix.wav')).samples,right=decodeWav(bytes('lift-audition/mix.wav')).samples;
const gap=Math.round(.35*rate)*2, samples=new Float32Array(left.length+gap+right.length);
samples.set(left);samples.set(right,left.length+gap);
fs.writeFileSync(file('dock-hardware-demo.wav'),encodeWav({samples,sampleRate:rate,channels:2},{encoding:'pcm24'}));
put('comparison.json',{pack:{id:packed.id,revision:packed.revision,sha256:packed.sha256,payloads:packed.files.length},
  workshop:{audio:'workshop-audition/mix.wav',cues:workshop.cues.map(({cue,source,selection})=>({cue,source,selection}))},
  freightLift:{audio:'lift-audition/mix.wav',cues:lift.cues.map(({cue,source,selection})=>({cue,source,selection}))},
  matching:{workshopReference:true,relocatedMix:true,relocatedReceipts:true}});
console.log('Verified embedded audition audio and byte-identical project relocation.');
