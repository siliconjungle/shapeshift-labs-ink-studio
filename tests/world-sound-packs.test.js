const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test');
const studio=require('..'), {KIT:K}=studio.load(), SoundPacks=require('../cli/world-sound-pack.js');
const {readSceneAudio}=require('../cli/scene-audio.js');
const {hash}=require('../cli/asset-references.js');
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const rate=16000;

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-world-sound-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), read=name=>fs.readFileSync(file(name));
  const save=(name,value)=>{
    fs.mkdirSync(path.dirname(file(name)),{recursive:true});
    fs.writeFileSync(file(name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');
  };
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const recording=id=>{
    const world={id,dt:.05,commands:[{tick:4,action:'world/event',args:{kind:'tool-drop',object:'latch',material:'steel',strength:.2}},
      {tick:10,action:'world/event',args:{kind:'tool-drop',object:'other',material:'steel',strength:.9}}]};
    const run=K.world.runtime.create(world);
    run.advance(22);
    return {world,record:run.recording()};
  };
  const clip={format:'ink-studio/sound-recipe',version:1,id:'latch',family:'impact',seed:43,
    render:{sampleRate:rate,duration:.18,peak:.6}};
  const pcm=studio.encodeWav({sampleRate:rate,channels:1,
    samples:Float32Array.from({length:1600},(_,i)=>.32*Math.sin(i*.4)*(1-i/1600))},{encoding:'pcm24'});
  save('source/latch.sound.json',clip);
  save('source/steel.wav',pcm);
  const ref={asset:'hardware/steel-impact',revision:4,sha256:hash(pcm)};
  save('source/registry.json',{format:K.authoring.assetReferences.format,version:1,entries:[{...ref,kind:'sound',file:'steel.wav'}]});
  const example=recording('factory-source');
  save('source/example.run.json',example.record);
  const draft={format:K.world.soundPacks.sourceFormat,version:1,id:'factory-sounds',revision:7,assetRegistry:'registry.json',
    assets:{'sample/light':{recipe:'latch.sound.json'},'sample/steel':{recording:ref,credit:'Demo source'},
      'sample/alias':{recording:'steel.wav'}},
    spatial:{cues:{'tool/light':'sample/light','tool/steel':'sample/steel'},materials:{steel:{impact:'tool/steel'}},
      soundFamilies:{'tool/latch':{takes:{touch:'tool/light'},variation:{rotate:true,pitchCents:[-5,5]}}},
      bindings:{'tool/drop':{on:{kind:'tool-drop'},interaction:'impact',
        select:[{id:'latch',when:{object:'latch',surface:'steel'},family:'tool/latch'}]}}},
    examples:{check:{run:'example.run.json',label:'Factory hits',from:'.10',to:'1',sampleRate:rate}}};
  save('source/pack.source.json',draft);
  const packed=JSON.parse(run('music','sound','pack','build','source/pack.source.json','--out','install/pack.json'));
  return {file,read,save,run,recording,draft,packed,clip,pcm,ref};
}

test('world-sound media deduplicates, preserves registry pins and rebuilds after unpack',t=>{
  const {file,read,run,packed,clip,pcm,ref}=fixture(t);
  assert.equal(packed.files.length,3);
  assert.equal(packed.assets['sample/steel'].recording,packed.assets['sample/alias'].recording);
  assert.deepEqual(packed.assets['sample/steel'].refs.recording,ref);
  const pack=SoundPacks.load(file('install/pack.json'),K);
  const asset=pack.read(pack.manifest.assets['sample/steel'].recording);
  assert.deepEqual(Buffer.from(asset),pcm);
  asset[0]=0;
  assert.deepEqual(Buffer.from(pack.read(ref.sha256)),pcm);
  assert.deepEqual(pack.audio('sample/light').samples,K.procedural.mediaGraph.soundRecipe.render(clip).value.samples);
  run('music','sound','pack','unpack','install/pack.json','--out','unpacked');
  run('music','sound','pack','build','unpacked/sound-pack.source.json','--out','rebuilt.json');
  assert.deepEqual(read('install/pack.json'),read('rebuilt.json'));
  assert.throws(()=>run('music','sound','pack','unpack','install/pack.json','--out','unpacked'),/new world-sound directory/);
});

test('one portable pack auditions its capture and follows a different world through a relocated take',t=>{
  const {file,read,save,run,recording,packed}=fixture(t);
  const other=recording('factory-receiver'), ref={file:'pack.json',id:packed.id,revision:7,sha256:packed.sha256};
  const plan={format:'ink-studio/scene-audio',version:1,sampleRate:rate,worldSoundPacks:[ref],
    spatial:{materials:{steel:{step:'tool/light'}}}};
  const take={format:'ink-studio/take',version:1,id:'receiver',world:'world.json',audio:'audio.json',
    clock:{fps:24,simulationRate:20,sampleRate:rate}};
  save('install/other.run.json',other.record);
  save('install/world.json',other.world);
  save('install/audio.json',plan);
  save('install/take.json',take);
  fs.rmSync(file('source'),{recursive:true,force:true});
  run('music','sound','pack','audition','install/pack.json','check','--out','example');
  run('story','audio','install/other.run.json','install/audio.json','--out','receiver');
  run('story','audio','install/other.run.json','install/pack.json','--out','standalone');
  assert.deepEqual(JSON.parse(read('standalone/report.json')).cues.map(row=>row.cue),['tool/light','tool/steel']);
  const report=JSON.parse(read('receiver/report.json'));
  assert.equal(report.world,'factory-receiver');
  assert.deepEqual(report.worldSoundPacks,[{id:ref.id,revision:7,sha256:ref.sha256}]);
  assert.deepEqual(report.cues.map(row=>row.cue),['tool/light','tool/steel']);
  assert.equal(report.cues[0].selection.family,'tool/latch');
  assert.match(report.cues[0].source.beatId,/factory-receiver/);
  assert.notDeepEqual(read('example/mix.wav'),read('receiver/mix.wav'));
  save('install/attachments.json',{recording:'other.run.json'});
  run('project','pack','install/take.json','--attachments','install/attachments.json','--out','receiver.project.json');
  fs.rmSync(file('install'),{recursive:true,force:true});
  run('project','unpack','receiver.project.json','--out','elsewhere');
  run('story','audio','elsewhere/other.run.json','elsewhere/audio.json','--out','replay');
  assert.deepEqual(read('replay/mix.wav'),read('receiver/mix.wav'));
  assert.deepEqual(read('replay/receipts.json'),read('receiver/receipts.json'));
});

test('world-sound imports refuse modified bytes, wrong revisions and conflicting scene slots',t=>{
  const {file,read,save,packed}=fixture(t), base={format:'ink-studio/scene-audio',version:1,worldSoundPacks:[
    {file:'pack.json',id:packed.id,revision:packed.revision}]};
  const writePlan=change=>save('install/plan.json',{...base,...change});
  const load=()=>readSceneAudio(file('install/plan.json'));
  const altered=JSON.parse(read('install/pack.json')), payload=altered.files[packed.assets['sample/steel'].recording];
  payload.data=(payload.data[0]==='A'?'B':'A')+payload.data.slice(1);
  save('install/damaged.json',altered);
  writePlan({worldSoundPacks:[{...base.worldSoundPacks[0],file:'damaged.json'}]});
  assert.throws(load,/payload SHA-256 mismatch/);
  writePlan({worldSoundPacks:[{...base.worldSoundPacks[0],revision:8}]});
  assert.throws(load,/at revision 8/);
  writePlan({worldSoundPacks:[{...base.worldSoundPacks[0],sha256:'0'.repeat(64)}]});
  assert.throws(load,/pack SHA-256 mismatch/);
  writePlan({assets:{'sample/light':'local.wav'}});
  assert.throws(load,/asset ID collision/);
  writePlan({spatial:{materials:{steel:{impact:'tool/light'}}}});
  assert.throws(load,/material mapping collision/);
  writePlan({spatial:{cues:{'tool/light':'local'}}});
  assert.throws(load,/cues ID collision/);
});
