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

test('recorded continuous contacts print timed fades, variable phase and exact trimmed foley', () => {
  const command=(kind,tick,time,contact)=>({tick,action:'world/event',
    args:K.world.timedEvents.at(time,{kind,contact:{id:'crate',...contact}})});
  const run=R.create({id:'continuous-foley',dt:.125,commands:[
    command('contact-start',2,.1875,{interaction:'drag',material:'boards',speed:2,load:2}),
    command('contact-update',4,.4375,{speed:4}),
    command('contact-update',6,.6875,{material:'stone'}),
    command('contact-end',8,.9375,{})
  ]});
  run.advance(10);
  const recording=run.recording();
  const shape={sampleRate:rate,channels:1,samples:Float32Array.from({length:rate},(_,i)=>.2*i/rate)};
  const plan=ink.createSceneAudio({
    format:'ink-studio/scene-audio',version:1,sampleRate:rate,post:{},spatial:{
      cues:{boards:'boards',stone:'stone'},
      contactLoops:{attack:.125,crossfade:.125,release:.125,response:.125,interactions:{
        drag:{cue:'boards',materials:{stone:'stone'},speedForFullRate:4,loadForFullGain:2,rate:[.5,1.5]}}}
    }
  },{kit,resolveAsset:name=>name==='boards'?shape:audio(.4,rate)});
  const render=start=>plan.render({startPoint:T.read(start),endPoint:T.read(1.25)},{
    runtime:()=>R.openRecording(recording),recordedThrough:10,trace:true
  });
  const all=render(0), cut=render(.5);
  const complete=ink.decodeWav(all.waves.foley), trimmed=ink.decodeWav(cut.waves.foley);
  assert.deepEqual(trimmed.samples,complete.samples.subarray(rate));
  const at=time=>select(complete,time)[0];
  assert.equal(at(.185),0);
  assert(at(.25)>0);
  assert(Math.abs(at(.625)-.10625)<1e-6);
  assert(at(.75)>.24&&at(.75)<.32);
  assert(Math.abs(at(.875)-.4)<1e-6);
  assert(Math.abs(at(1)-.2)<1e-6);
  assert.equal(at(1.0625),0);
  assert.deepEqual(all.report.storyAudio.contacts.map(row=>[row.material,row.fromSample,row.toSample,row.bus]),
    [['boards',1500,6500,'foley'],['stone',5500,8500,'foley']]);
  assert.deepEqual(all.report.storyAudio.cues,[]);
});

test('compound impact layers preserve beat identity, sample delays, buses, and replay choices', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-impact-layers-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), bytes=name=>fs.readFileSync(file(name));
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(bytes(name));
  const call=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const run=R.create({id:'compound-test',dt:.125,commands:[{tick:2,action:'world/event',
    args:K.world.timedEvents.at(.1875,{kind:'drop',contact:{speed:4,load:30}})}]});
  run.advance(6);
  save('run.json',run.recording());
  for(const [name,gain] of Object.entries({hit:.05,surface:.1,rattle:.15,ring:.2}))
    fs.writeFileSync(file(name+'.wav'),ink.encodeWav(audio(gain,rate/2)));
  const varied=cue=>({takes:{take:cue,alternate:cue},variation:{rotate:true,pitchCents:[-100,100]}});
  const definition={format:'ink-studio/scene-audio',version:1,sampleRate:rate,post:{},
    assets:{hit:'hit.wav',surface:'surface.wav',rattle:'rattle.wav',ring:'ring.wav'},
    spatial:{cues:{hit:'hit',surface:'surface',rattle:'rattle',ring:'ring'},soundSeed:9,
      soundFamilies:{hardware:varied('rattle'),resonance:varied('ring')},
      bindings:{tool:{on:{kind:'drop'},impactLayers:{
        strike:{cue:'hit',bus:'foley'},
        surface:{cue:'surface',bus:'effects',delay:.015625,threshold:{measure:'speed',min:4}},
        rattle:{select:[{id:'parts',family:'hardware'}],bus:'effects',delay:.03125,threshold:{measure:'load',min:30}},
        tail:{select:[{id:'body',family:'resonance'}],bus:'ambience',delay:.0625}
      }}}}};
  save('plan.json',definition);
  call('story','audio','run.json','plan.json','--out','original');
  const report=read('original/report.json');
  assert.deepEqual(report.cues.map(row=>[row.impact.layer,row.onsetSample,row.impact.startSample,row.arrivalSample,row.file]),[
    ['strike',1500,1500,1500,'foley.wav'],['surface',1500,1625,1625,'effects.wav'],
    ['rattle',1500,1750,1750,'effects.wav'],['tail',1500,2000,2000,'ambience.wav']
  ]);
  assert(report.cues.every(row=>row.source.beatId==='ink:beat:compound-test/main/2.0'));
  const gainAt=(bus,sample)=>ink.decodeWav(bytes('original/'+bus+'.wav')).samples[2*sample];
  assert.equal(gainAt('effects',1624),0);
  assert(Math.abs(gainAt('effects',1625)-.1)<.0001);
  assert(Math.abs(gainAt('effects',1750)-.25)<.0001);
  assert.equal(gainAt('ambience',1999),0);
  assert(Math.abs(gainAt('ambience',2000)-.2)<.0001);
  const choices=read('original/receipts.json').choices;
  assert.deepEqual(choices.map(row=>row.binding),['impact:tool/rattle','impact:tool/tail']);
  definition.spatial.soundSeed=922;
  definition.spatial.soundFamilies.hardware.variation.pitchCents=[0,0];
  save('changed.json',definition);
  call('story','audio','run.json','changed.json','--receipts','original/receipts.json','--out','replay');
  for(const name of ['mix.wav','receipts.json','report.json'])assert(bytes('replay/'+name).equals(bytes('original/'+name)));
  call('story','audio','run.json','plan.json','--from','.24','--to','.5','--out','trim');
  assert.deepEqual(ink.decodeWav(bytes('trim/mix.wav')).samples,
    ink.decodeWav(bytes('original/mix.wav')).samples.subarray(3840,8000));
});

test('contextual audio prints the same asset with different spectra and restores filter history for trims', () => {
  const dt=.125, commands=[
    {tick:1,action:'world/event',args:{kind:'audio-cue',cue:'call'}},
    {tick:9,action:'world/event',args:{kind:'audio-cue',cue:'call',object:'pipe'}}
  ];
  const run=R.create({id:'contextual-call',dt,commands});
  run.advance(17);
  const tape=run.recording(), source={sampleRate:rate,channels:1,samples:Float32Array.from({length:6000},(_,i)=>
    .08*(Math.sin(i*2*Math.PI*440/rate)+Math.sin(i*2*Math.PI*3000/rate)))};
  const spatial={cues:{call:{asset:'call',bus:'dialogue'}},processing:{
    profiles:{pipe:{highpass:120,lowpass:950,peaks:[{hz:440,q:3,gainDb:9}]}},
    rules:[{id:'pipe',when:{object:'pipe'},profile:'pipe'}]}};
  const render=(from,post)=>ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial,
    ...(post&&{post:{}})},{kit,resolveAsset:()=>source}).render({startPoint:T.read(from),endPoint:T.read(2.125)},
    {runtime:()=>R.openRecording(tape),recordedThrough:17,trace:true});
  function level(samples,start,hz){
    const length=rate/4, angle=2*Math.PI*hz/rate;
    let cos=0,sin=0;
    for(let i=start;i<start+length;i++){
      cos+=samples[2*i]*Math.cos(i*angle);
      sin+=samples[2*i]*Math.sin(i*angle);
    }
    return Math.hypot(cos,sin)/length;
  }
  const full=render(0,true), cut=render(1.375,true);
  const waves=ink.decodeWav(full.waves.dialogue).samples;
  assert.deepEqual(ink.decodeWav(cut.waves.dialogue).samples,waves.subarray(2*rate*1.375));
  assert.deepEqual(full.report.storyAudio.cues.map(row=>[row.asset,row.processing?.profiles]),[['call',undefined],['call',['pipe']]]);
  assert(level(waves,10400,440)>2*level(waves,2400,440));
  assert(level(waves,10400,3000)<.15*level(waves,2400,3000));
  assert.deepEqual(ink.decodeWav(render(0,false).waves.spatial).samples,waves);
});

test('a recorded emitter follows a closing and reopening hatch with its playhead intact', () => {
  const run=R.create(require('../examples/world-acoustic-hatch.json'));
  run.advance(20);
  const tape=run.recording(), source={sampleRate:rate,channels:1,samples:Float32Array.from({length:rate},(_,i)=>
    .12*Math.sin(i*2*Math.PI*2200/rate))};
  const plan=ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial:{
    distance:{reference:5},cues:{tone:'tone'},emitters:{alarm:{cue:'tone',at:{entity:'beacon',socket:'speaker'}}},
    processing:{path:'acoustics/path',profiles:{hatch:{lowpass:510}},
      rules:[{id:'closed',profile:'hatch',when:{opening:'hatch',maxOpen:.01}}]}
  },listener:{at:{entity:'listen-post'},forward:[1,0,0]}},{kit,resolveAsset:()=>source});
  const render=start=>plan.render({startPoint:T.read(start),endPoint:T.read(2)},
    {runtime:()=>R.openRecording(tape),recordedThrough:20,trace:true});
  const full=ink.decodeWav(render(0).waves.spatial).samples;
  const trimmed=ink.decodeWav(render(1).waves.spatial).samples;
  assert.deepEqual(trimmed,full.subarray(rate*2));
  const rms=(second,length)=>Math.sqrt(full.subarray(second*rate*2,(second+length)*rate*2)
    .reduce((sum,value)=>sum+value*value,0)/(length*rate*2));
  const open=rms(.3,.2), closed=rms(1,.2), reopened=rms(1.75,.2);
  assert(closed<open*.13);
  assert(reopened>open*.95);
});

test('world sound duration and level drive audio at the same beat as the hearing report', () => {
  const world={id:'listener-audio',dt:.125,systems:{intel:{kind:'perception',config:{
    profiles:{ears:{hearing:{range:10,thresholdDb:45}}},
    factions:{yard:{observers:{watch:{at:[0,0,0],profile:'ears'}}}}
  }}},commands:[{tick:2,action:'world/event',args:K.world.timedEvents.at(.1875,{
    kind:'world-sound',cue:'signal',at:[0,0,-1],sourceLevelDb:64,band:'high',duration:.125
  })}]};
  const run=R.create(world);
  run.advance(2);
  const [hearing]=run.query().probe('intel/hearing',undefined,{faction:'yard'}).value.observations;
  assert.equal(hearing.audible,true);
  assert.equal(hearing.levelDb,64);
  run.advance(5);
  const tape=run.recording(), plan=ink.createSceneAudio({
    format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial:{soundReferenceDb:70,cues:{signal:'signal'}}
  },{kit,resolveAsset:()=>audio(.25,rate)});
  const render=start=>plan.render({startPoint:T.read(start),endPoint:T.read(.625)},
    {runtime:()=>R.openRecording(tape),recordedThrough:5,trace:true});
  const full=render(0), wave=ink.decodeWav(full.waves.spatial);
  const [row]=full.report.storyAudio.cues;
  assert.equal(row.source.beatId,hearing.beatId);
  assert.deepEqual(row.sound,{cue:'signal',at:[0,0,-1],sourceLevelDb:64,band:'high',duration:.125});
  assert.deepEqual([row.onsetSample,row.endSample],[1500,2500]);
  assert.equal(select(wave,.18)[0],0);
  assert(Math.abs(select(wave,.2)[0]-.25*Math.SQRT1_2*10**(-6/20))<1e-6);
  assert.equal(select(wave,.3125)[0],0);
  assert.deepEqual(ink.decodeWav(render(.25).waves.spatial).samples,wave.samples.subarray(4000));
});

test('recorded voice limits drop bursts, steal from loud voices and resume loops at their original phase',()=>{
  const event=(tick,cue,gain=1)=>({tick,action:'world/event',args:{kind:'audio-cue',cue,gain}});
  const run=R.create({id:'bounded-foley',dt:.125,commands:[
    event(1,'collision'),event(1,'collision'),event(1,'collision'),event(2,'warning'),
    event(2,'feedback'),event(2,'dialogue')
  ]});
  run.advance(9);
  const recording=run.recording(), mix=ink.createSceneAudio({
    format:'ink-studio/scene-audio',version:1,sampleRate:rate,post:{},spatial:{
      voiceBudget:{maxVoices:3,reservedVoices:1,groups:{collision:1},stealFade:.008},
      cues:{rain:{asset:'rain',bus:'ambience',priority:-3},collision:{asset:'collision',bus:'effects',group:'collision'},
        warning:{asset:'short',bus:'effects',protected:true,priority:90,gain:.08},
        feedback:{asset:'short',bus:'foley',protected:true,priority:45,gain:.07},
        dialogue:{asset:'dialogue',bus:'dialogue',gain:.06}},
      emitters:{rain:{cue:'rain'}}
    }
  },{kit,resolveAsset:asset=>asset==='rain'?{sampleRate:rate,channels:1,
    samples:Float32Array.from({length:rate},(_,i)=>.15*i/rate)}:
    audio(asset==='collision'?.3:.2,asset==='collision'?rate:2000)});
  const render=start=>mix.render({startPoint:T.read(start),endPoint:T.read(1.125)},
    {runtime:()=>R.openRecording(recording),recordedThrough:9,trace:true});
  const result=render(0), {voiceBudget}=result.report;
  assert.equal(voiceBudget.peakVoices,3);
  assert.equal(voiceBudget.stolen,2);
  assert.equal(voiceBudget.dropped,2);
  assert.equal(voiceBudget.resumed,1);
  const cuts=voiceBudget.decisions.filter(row=>row.action==='stolen');
  assert.deepEqual(cuts.map(row=>[row.cue,row.sample]).sort(),[['collision',2000],['rain',2000]]);
  const renderCue=result.report.storyAudio.cues;
  assert.equal(renderCue.find(row=>row.cue==='warning').voiceBudget.action,'admitted');
  assert.equal(renderCue.filter(row=>row.voiceBudget.action==='dropped').length,2);
  const decode=stem=>ink.decodeWav(result.waves[stem]);
  const ambient=decode('ambience'), effects=decode('effects'), dialog=decode('dialogue');
  assert(select(effects,.18)[0]>.29);
  assert(select(effects,.254)[0]>.12);
  assert(select(effects,.26)[0]<.02);
  assert(select(dialog,.26)[0]>.01);
  assert.equal(select(ambient,.38)[0],0);
  assert(Math.abs(select(ambient,.55)[0]-.15*.55)<1e-6);
  assert.deepEqual(ink.decodeWav(render(.3).waves.mix).samples,decode('mix').samples.subarray(4800));
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
