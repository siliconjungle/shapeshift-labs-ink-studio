const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');

if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
const repo=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]), file=name=>path.join(out,name), rate=48000;
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const bytes=name=>fs.readFileSync(file(name)), read=name=>JSON.parse(bytes(name));
const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','inherit']});
const takes={
  thunk:{render:{duration:.22,peak:.72},shape:{pitchSemitones:-5,decay:1.3},
    synth:{noise:{color:'brown',level:.5},filter:{fromHz:2000,toHz:420}}},
  click:{render:{duration:.19,peak:.75},shape:{pitchSemitones:7,sweep:.55,decay:1.1},
    synth:{pulseWidth:.24,noise:{color:'pink',level:.45},filter:{type:'highpass',fromHz:670,toHz:350}}},
  ring:{render:{duration:.28,peak:.74},shape:{pitchSemitones:3.5,sweep:.61,decay:.64},
    synth:{pulseWidth:.29,noise:{color:'pink',level:.43},filter:{fromHz:5400,toHz:840},
      retrigger:{positions:[0,.26],gate:.9}}}
};
fs.mkdirSync(file('sounds'),{recursive:true});
const entries=Object.entries(takes).map(([id,recipe],i)=>{
  const source='sounds/'+id+'.sound.json';
  save(source,{format:'ink-studio/sound-recipe',version:1,id,family:'impact',seed:7451+i*83,
    ...recipe,render:{sampleRate:rate,...recipe.render}});
  return {asset:'workshop/'+id,revision:1,kind:'sound',file:source};
});
save('assets-draft.json',{format:'ink-studio/asset-registry',version:1,entries});
run('assets','lock','assets-draft.json','--out','assets.json');
save('shop.world.json',{format:'ink-studio/world',version:1,id:'hook-rotation',dt:.05,history:{enabled:true},
  commands:Array.from({length:6},(_,i)=>({tick:4+11*i,action:'world/event',args:{
    kind:'object-contact',contact:{action:'drop',object:'metal-hook',surface:'shop/boards',strength:.65,point:[0,0,-1.2]}
  }}))});
run('sim','run','shop.world.json','--ticks','76','--record','shop.run.json');
const spatial={soundSeed:722,
  cues:Object.fromEntries(Object.keys(takes).map(id=>[id,{asset:id,bus:'foley',distance:{rolloff:0}}])),
  soundFamilies:{hook:{takes:{thunk:{cue:'thunk',weight:6},click:'click',ring:'ring'}}},
  bindings:{drops:{on:{kind:'object-contact'},select:[
    {id:'board',when:{action:'drop',object:'metal-hook',surface:'shop/boards'},family:'hook'}]}}};
const definition={format:'ink-studio/scene-audio',version:1,sampleRate:rate,assetRegistry:'assets.json',listener:[0,0,0],
  assets:Object.fromEntries(read('assets.json').entries.map(({asset,revision,sha256})=>[asset.slice('workshop/'.length),{asset,revision,sha256}])),
  spatial,post:{}};
save('ordinary.audio.json',definition);
run('story','audio','shop.run.json','ordinary.audio.json','--out','ordinary');
const ordinary=read('ordinary/report.json').cues.map(row=>row.cue);
assert(ordinary.some((cue,i)=>i>0&&cue===ordinary[i-1]));

spatial.soundFamilies.hook.variation={rotate:true,pitchCents:[-100,100]};
save('rotation.audio.json',definition);
run('story','audio','shop.run.json','rotation.audio.json','--out','rotation');
const receipts=read('rotation/receipts.json');
assert.equal(receipts.choices.length,6);
const rotated=receipts.choices.map(row=>row.take);
assert(rotated.every((take,i)=>!i||take!==rotated[i-1]));
assert.deepEqual([0,3].map(start=>new Set(rotated.slice(start,start+3)).size),[3,3]);
assert(new Set(receipts.choices.map(row=>row.pitchCents)).size>1);
run('story','audio','shop.run.json','rotation.audio.json','--from','.72','--to','2.70','--out','trim');
assert.deepEqual(read('trim/receipts.json').choices,receipts.choices.slice(0,5));

spatial.soundSeed=7059;
spatial.soundFamilies.hook.variation.pitchCents=[0,0];
save('changed.audio.json',definition);
run('story','audio','shop.run.json','changed.audio.json','--out','redraw');
assert(!bytes('redraw/mix.wav').equals(bytes('rotation/mix.wav')));
run('story','audio','shop.run.json','changed.audio.json','--receipts','rotation/receipts.json','--out','receipt-replay');
for(const name of ['mix.wav','receipts.json','report.json'])assert(bytes('receipt-replay/'+name).equals(bytes('rotation/'+name)));

const groups=[['ordinary',0],['rotation',3.8],['receipt-replay',7.6]];
save('reel.mix.json',{assets:Object.fromEntries(groups.map(([id])=>[id,id+'/mix.wav'])),
  mixer:{id:'repeat-avoidance',sampleRate:rate,end:{seconds:11.4},tail:'cut',output:'master',peakPolicy:'error',
    strips:{master:{clips:groups.map(([id,seconds])=>({id,source:id,at:{seconds}}))}}}});
run('music','mix','render','reel.mix.json','--out','reel');
fs.copyFileSync(file('reel/mix.wav'),file('repeat-safe-sounds.wav'));
save('demo-summary.json',{audio:'repeat-safe-sounds.wav',rate,ordinary,rotation:receipts.choices,groups});
console.log('Rendered weighted picks, a repeat-free rotation, and byte-identical receipt replay after changing the seed.');
