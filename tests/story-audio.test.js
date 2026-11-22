const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const kit = ink.load(), K = kit.KIT, R = K.world.runtime, T = K.procedural.takeTime;
const rate = 8000, cli = path.resolve(__dirname,'../cli/ink-studio.js');
const select = ({sampleRate, samples}, second) => samples.subarray(Math.round(second*sampleRate)*2,Math.round(second*sampleRate)*2+2);
const audio = (value,frames=1) => ({ sampleRate:rate,channels:1,samples:new Float32Array(frames).fill(value) });
const cross = { tick:5,action:'world/patch',args:{edits:[{op:'set',path:'/entities/cart/position',value:[2,0,0]}]} };
const motion = {
  id:'moving-sound',dt:.1,history:{enabled:false},entities:{cart:{position:[-2,0,0],sockets:{bell:[0,0,0]}}},
  commands:[
    { tick:2,action:'world/event',args:{kind:'cart-passes',emitter:{entity:'cart',socket:'bell'}} },
    cross
  ]
};
const config = { format:'ink-studio/scene-audio',version:1,sampleRate:rate,
  spatial:{distance:{reference:2},cues:{ring:{asset:'bell',follow:true,bus:'foley'}},
    bindings:{passing:{on:{kind:'cart-passes'},cue:'ring'}}},post:{} };

test('score layers follow smoothed pressure inside a section and moving cue tails use later poses', () => {
  const world = {...motion,systems:{score:{kind:'adaptive-music',config:{
    entry:'idle',parameters:{pressure:{attack:.25,release:.3}},sections:{idle:{resource:'bed',layers:{pulse:1}}}
  }}},commands:[...motion.commands,
    {tick:3,action:'world/input',args:{port:'score/parameter.pressure',value:1}},
    {tick:7,action:'world/input',args:{port:'score/parameter.pressure',value:0}}
  ]};
  const plan = ink.createSceneAudio({...config,music:{system:'score',fade:0,layers:{bed:{pulse:'pulse'}},
    layerControls:{pulse:{path:'/parameters/pressure'}}}}, {kit,resolveAsset:asset=>
    asset==='bed' ? audio(.04) : asset==='pulse' ? audio(.26) : audio(.25,rate)});
  const run = R.create(world);
  run.advance(10);
  const tape = run.recording(), sequence = {startPoint:T.read(0),endPoint:T.read(1)};
  const {waves,report} = plan.render(sequence,{runtime:()=>R.openRecording(tape),recordedThrough:10,trace:true});
  const foley = ink.decodeWav(waves.foley), music = ink.decodeWav(waves.music);
  assert.deepEqual(Array.from(select(foley,.199)),[0,0]);
  const [earlyL,earlyR] = select(foley,.24), [lateL,lateR] = select(foley,.55);
  assert(earlyL>.22 && earlyR<.001);
  assert(lateR>.22 && lateL<.001);
  assert(select(music,.65)[0] > select(music,.2)[0]+.16);
  assert(select(music,.95)[0] < select(music,.73)[0]-.06);
  assert.deepEqual(report.storyAudio.sections.map(row=>row.section),['idle']);
  assert(report.storyAudio.layers[0].peak>.75);
  const [row] = report.storyAudio.cues;
  assert.equal(row.source.beatId,'ink:beat:moving-sound/main/2.0');
  assert.equal(row.onsetSample,1600);
  assert.deepEqual([row.position,row.lastPosition],[[-2,0,0],[2,0,0]]);
});

test('story replay mixes both velocity takes at the same sample and carries their separate receipts', () => {
  const world={id:'load-blend',dt:.1,commands:[{tick:2,action:'world/event',args:{kind:'drop',
    contact:{load:60,prop:'brass-latch'}}}]};
  const run=R.create(world);
  run.advance(5);
  const recording=run.recording();
  const soundtrack=ink.createSceneAudio({
    format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial:{
      cues:{soft:{asset:'soft'},hard:{asset:'hard'}},
      soundFamilies:{latch:{takes:{soft:'soft',hard:'hard'},layers:[{at:0,takes:['soft']},{at:1,takes:['hard']}]}},
      bindings:{drop:{on:{kind:'drop'},loadForFullStrength:120,select:[{id:'latch',when:{prop:'brass-latch'},family:'latch'}]}}
    }
  },{kit,resolveAsset:name=>audio(name==='soft'?.25:.75,120)});
  const render=start=>soundtrack.render({startPoint:T.read(start),endPoint:T.read(.5)},{
    runtime:()=>R.openRecording(recording),recordedThrough:5,trace:true
  });
  const all=render(0), cut=render(.2);
  const rows=all.report.storyAudio.cues;
  assert.deepEqual(rows.map(row=>[row.cue,row.onsetSample,row.selection.layer.weight]),[['soft',1600,.5],['hard',1600,.5]]);
  assert(rows.every(row=>row.source.beatId==='ink:beat:load-blend/main/2.0'));
  assert.deepEqual(cut.report.storyAudio.cues,rows);
  const mixed=ink.decodeWav(all.waves.mix), sliced=ink.decodeWav(cut.waves.mix);
  assert.deepEqual(Array.from(select(mixed,.2)),[.5,.5]);
  assert.deepEqual(sliced.samples,mixed.samples.subarray(3200));
});

test('story audio saves per-layer take and pitch receipts and replays them with a changed seed', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sound-receipts-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), bytes=name=>fs.readFileSync(file(name));
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(bytes(name));
  const call=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const run=R.create({id:'tap-replay',dt:.1,commands:Array.from({length:6},(_,i)=>({
    tick:i+1,action:'world/event',args:{kind:'impact',strength:.5,pitch:1.11}
  }))});
  run.advance(8);
  save('run.json',run.recording());
  const ids=['a','b','c','d'];
  const spatial={soundSeed:28,cues:Object.fromEntries(ids.map(id=>[id,{asset:id,pitch:1.2}])),
    soundFamilies:{tool:{takes:Object.fromEntries(ids.map(id=>[id,id])),
      layers:[{at:0,takes:['a','b']},{at:1,takes:['c','d']}],variation:{rotate:true,pitchCents:[-80,80]}}},
    bindings:{tool:{on:{kind:'impact'},select:[{id:'tool',family:'tool'}]}}};
  for(const [i,id] of ids.entries())fs.writeFileSync(file(id+'.wav'),ink.encodeWav({
    sampleRate:rate,channels:1,samples:Float32Array.from({length:128},(_,n)=>.1*Math.sin(n*(.2+.25*i)))
  }));
  const soundtrack={format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial,
    assets:Object.fromEntries(ids.map(id=>[id,id+'.wav']))};
  save('mix.json',soundtrack);
  call('story','audio','run.json','mix.json','--out','original');
  const receipts=read('original/receipts.json'), rows=read('original/report.json').cues;
  assert.equal(receipts.choices.length,12);
  assert.equal(read('original/report.json').receipts,'receipts.json');
  for(const [i,choice] of receipts.choices.entries()){
    const {selection,source}=rows[i];
    assert.equal(choice.take,selection.take);
    assert.equal(choice.beatId,source.beatId);
    assert.equal(choice.rate,1.11*1.2*2**(choice.pitchCents/1200));
  }
  call('story','audio','run.json','mix.json','--from','.25','--to','.65','--out','cut');
  assert.deepEqual(read('cut/receipts.json'),receipts);
  assert.deepEqual(ink.decodeWav(bytes('cut/mix.wav')).samples,
    ink.decodeWav(bytes('original/mix.wav')).samples.slice(4000,10400));
  spatial.soundSeed=183;
  save('changed.json',soundtrack);
  call('story','audio','run.json','changed.json','--out','redraw');
  assert(!bytes('redraw/mix.wav').equals(bytes('original/mix.wav')));
  call('story','audio','run.json','changed.json','--receipts','original/receipts.json','--out','replay');
  for(const file of ['mix.wav','receipts.json','report.json'])assert(bytes('replay/'+file).equals(bytes('original/'+file)));
  const invalid=structuredClone(receipts);
  invalid.choices[0].take='d';
  save('invalid.json',invalid);
  const failure=spawnSync(process.execPath,[cli,'story','audio','run.json','mix.json','--receipts','invalid.json','--out','bad'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(failure.status,1);
  assert.match(failure.stderr,/no longer eligible/);
  assert(!fs.existsSync(file('bad')));
});

test('story audio prints a verified branch window with exact onset and beat lookup', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-audio-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const call = (...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const before = R.create({...motion,commands:[cross]});
  before.advance(2);
  const fork = before.fork({branch:'late-cart'});
  fork.schedule([{tick:3,action:'world/event',args:K.world.timedEvents.at(.25,
    {kind:'cart-passes',at:{entity:'cart',socket:'bell'}})}]);
  fork.advance(10);
  save('run.json',fork.recording());
  save('mix.json',{...config,post:undefined,assets:{bell:'source.wav'}});
  fs.writeFileSync(file('source.wav'),ink.encodeWav(audio(.25,rate)));
  call('story','audio','run.json','mix.json','--from','1/5','--to','3/4','--out','printed');
  const report = read('printed/report.json'), [cue] = report.cues;
  assert.deepEqual(report.coverage,{fromTick:2,toTick:10});
  assert.deepEqual([report.firstSample,report.endSample],[1600,6000]);
  assert.deepEqual(cue.source.timecode,{numerator:1,denominator:4});
  assert.equal(cue.onsetSample,2000);
  assert.equal(cue.file,'spatial.wav');
  assert.equal(cue.source.beatId,'ink:beat:moving-sound/late-cart/3.0');
  const linked = JSON.parse(call('beat',cue.source.beatId,'printed/report.json'));
  assert.equal(linked.matches[0].artifact,'printed/spatial.wav');
  const diverged = read('run.json');
  diverged.end.world.entities.cart.position = [9,0,0];
  save('diverged.json',diverged);
  const failure = spawnSync(process.execPath,[cli,'story','audio','diverged.json','mix.json','--out','bad'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(failure.status,1);
  assert.match(failure.stderr,/diverged|checkpoint/i);
  assert.equal(fs.existsSync(file('bad')),false);
});
