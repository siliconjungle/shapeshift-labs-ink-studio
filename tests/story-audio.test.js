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
