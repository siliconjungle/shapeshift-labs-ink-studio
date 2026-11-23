const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const http=require('node:http');
const kit=require('..').load(), {KIT:K}=kit, W=K.world;
const hatch=require('../examples/world-acoustic-hatch.json');
const contacts=require('../examples/world-contact-effects.json');
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,a+' differs from '+b);
const event=(tick,kind,detail)=>({tick,action:'world/event',args:{kind,...detail}});

test('socket emitters track world positions and acoustic transmission without doubling distance falloff',()=>{
  const scene={...hatch,commands:[...hatch.commands,
    {tick:17,action:'world/patch',args:{edits:[{op:'set',path:'/entities/beacon/position',value:[4,0,1]}]}}]};
  const run=W.runtime.create(scene);
  const audio=W.spatialAudio.create({
    cues:{alarm:{asset:'alarm.wav',distance:{reference:1,max:12,rolloff:1,fade:0}}},
    emitters:{wallAlarm:{cue:'alarm',at:{entity:'beacon',socket:'speaker'}}},
    occlusion:{acoustic:'acoustics/audible'},propagationDelay:true
  });
  const sample=()=>audio.frame({query:run.query(),time:run.view().time,listener:{entity:'listen-post'}}).active[0];
  const open=sample();
  const query=run.query().probe('acoustics/audible',{entity:'listen-post'},{from:{entity:'beacon',socket:'speaker'}}).value;
  near(open.gain,query.gain);
  near(open.delay,query.delaySeconds);
  assert.deepEqual(open.apparentSource,query.apparentSource);
  run.advance(8);
  const closed=sample();
  assert(closed.gain<open.gain*.1&&closed.bands.high<closed.bands.low*.03);
  run.advance(16);
  near(sample().gain,open.gain);
  run.advance(17);
  assert.deepEqual(sample().position,[4,1,1]);
  assert(sample().gain<open.gain);
  assert.equal(audio.frame({query:run.query(),listener:[20,1,0]}).active[0].status,'out-of-range');
});

test('simulation events use cue bindings and geometry supplies material-specific occlusion',()=>{
  const run=W.runtime.create({dt:.1,systems:{
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{panel:{fixed:true,half:[.12,.8,1],position:[0,.8,0],material:'glass'}}}},
    rock:{kind:'volume',config:{bounds:{min:[-.6,0,-2],max:[.6,2,2]},cell:.2,materials:{stone:[1,2,3,4]},
      initial:[{op:'fill',material:'stone',shape:{kind:'box',at:[0,.8,0],half:[.1,.8,1]}}]}}
  },commands:[event(1,'door-latched',{at:[2,.8,0],zone:'service'})]});
  run.step();
  const planner=type=>W.spatialAudio.create({cues:{latch:{asset:'latch.wav',distance:{rolloff:0}}},
    bindings:{door:{on:{kind:'door-latched',where:{path:'/zone',value:'service'}},cue:'latch'}},
    occlusion:{[type]:[type==='rays'?'rig/ray':'rock/segment'],materials:{glass:{lossDb:6,cutoff:2200}}}});
  const frame={query:run.query(),listener:[-2,.8,0],events:[...run.events,...run.events]};
  const ray=planner('rays').frame(frame);
  assert.equal(ray.cues.length,1);
  assert.equal(ray.cues[0].status,'occluded');
  assert.equal(ray.cues[0].blocker.id,'panel');
  assert.equal(ray.cues[0].cutoff,2200);
  near(ray.cues[0].gain,10**(-6/20));
  const volume=planner('segments').frame(frame).cues[0];
  assert.equal(volume.status,'occluded');
  assert.equal(volume.blocker.trace,'rock/segment');
  assert.equal(volume.cutoff,1200);
});

test('material feedback and authored animation contacts produce positioned cue requests',()=>{
  const run=W.runtime.create(contacts);
  run.advance(22);
  const planner=W.spatialAudio.create({
    cues:{'trackside/clay.roll':'wheel.wav',boot:'boot.wav',tap:'tap.wav'},
    materials:{oak:{step:'tap'}},
    bindings:{plant:{on:{kind:'animation-contact',where:{path:'/action',value:'plant'}},interaction:'step'}}
  });
  const base={query:run.query(),listener:[0,1,0],time:.3};
  const wheels=planner.frame({...base,events:run.events}).cues;
  const wet=run.events.find(row=>row.kind==='material-sound'&&row.cue==='trackside/clay.roll');
  assert(wheels.some(shot=>shot.position.every((v,i)=>v===wet.at[i])&&shot.rate===wet.pitch));
  const B=kit.makeBuilder(1,[0x141820,0xb34e59]);
  B.iso(0,.25,0,.24,B.P[1],3);
  const world=B.finish({cam:{target:[0,.4,0],yaw:.3,pitch:.2,dist:4}});
  const puppet=K.puppet(world,{parts:{foot:{ids:[0],pivot:[0,.25,0]}}});
  const clip=K.anim.clip({dur:1,tracks:{'foot.pos':[[0,[0,0,0]],[1,[0,.7,0]]]},
    events:[{name:'down',time:.25}]});
  const machine=K.anim.machine({layers:[{id:'base',entry:'moving',states:[{id:'moving',clip}]}],
    eventBindings:{down:[{type:'contact',contact:'sole',action:'plant'},{type:'sound',cue:'boot',contact:'sole'}]}});
  const at=[.4,.25,0];
  const animation=machine.bind({world,puppet,contacts:{sole:{part:'foot',point:[0,.25,0],target:at}}});
  world.anim.update(.3,.3);
  const frame=planner.frame({...base,animation:[{id:'hero',at:[4,1,0],frame:animation.frame(),contacts:{sole:{material:'oak'}}}]});
  assert.deepEqual(frame.cues.map(({cue,position})=>[cue,position]),[['tap',at],['boot',at]]);
});

test('audio tracks retain timeline offsets across trimming and handle one-shot cues once per interval',()=>{
  const timeline=K.timeline.compile({duration:3,sequences:{part:{duration:2,audio:[
    {id:'sustain',time:0,cue:'hum',duration:2,offset:.2},{id:'once',time:1.25,cue:'hit'}
  ]}},clips:[{id:'cut',sequence:'part',time:1,in:.5,out:1.5,duration:2}]});
  const audio=W.spatialAudio.create({cues:{hum:{asset:'hum.wav',at:[1,0,0]},hit:'hit.wav'}});
  const listener=[0,0,0], frame=audio.frame({timeline,from:2,time:2.75,listener});
  assert.equal(frame.cues[0].mode,'cue');
  near(frame.active[0].rate,.5);
  near(frame.active[0].offset,.2+.5+1.75*.5);
  near(frame.active[0].duration,.25);
  assert.deepEqual(audio.frame({timeline,time:2.75,listener}).cues,[]);
});

test('event sound context selects one eligible family member and preserves fallback and layered bindings',()=>{
  const audio=W.spatialAudio.create({soundSeed:19,
    cues:{soft:'wet-tap',hit:'wet-hit',thud:'board-thud',fallback:'default',layer:'extra'},
    soundFamilies:{
      wet:{takes:{soft:{cue:'soft',strength:[0,.5]},hard:{cue:'hit',strength:[.5,1]}}},
      dry:{takes:{thud:'thud'}}
    },
    bindings:{contact:{on:{kind:'contact'},cue:'fallback',speedForFullStrength:4,select:[
      {id:'water',when:{action:'drop',object:'hook',surface:'stone',wetness:[.5,1]},family:'wet'},
      {id:'wood',when:{action:'drop',object:'hook',surface:'boards'},family:'dry'}
    ]}, layer:{on:{kind:'contact',where:{path:'/extra',value:true}},cue:'layer'}}
  });
  const base={kind:'contact',object:'hook',action:'drop',surface:'stone',wetness:1,at:[0,0,-1]};
  const selected=audio.frame({listener:[0,0,0],events:[
    {...base,id:'1.0',strength:0},
    {...base,id:'2.0',contact:{strength:.5}},
    {...base,id:'3.0',speed:9},
    {...base,id:'4.0'},
    {...base,id:'5.0',object:undefined,action:undefined,surface:undefined,extra:true,
      fact:{data:{action:'drop',object:'hook',surface:'boards',strength:.9}}},
    {...base,id:'6.0',object:'wrench',strength:1}
  ]}).cues;
  assert.deepEqual(selected.map(voice=>voice.cue),['soft','hit','hit','fallback','thud','layer','fallback']);
  assert.deepEqual(selected[0].selection,{binding:'contact',rule:'water',family:'wet',take:'soft',
    context:{action:'drop',object:'hook',surface:'stone',strength:0,wetness:1},eligible:['soft']});
  assert.equal(selected[2].selection.context.strength,1);
  assert.equal(selected[3].selection,undefined);
  assert.deepEqual(selected[4].selection.context,{action:'drop',object:'hook',surface:'boards',strength:.9,wetness:1});
});

test('weighted sound choices use stable event IDs and reject invalid rules and take ranges',()=>{
  const families={tools:{takes:{b:{cue:'b',weight:5},a:{cue:'a',weight:1}}}};
  const config={soundSeed:721,cues:{a:'a',b:'b',original:'original'},soundFamilies:families,bindings:{
    tools:{on:{kind:'material-sound'},select:[{id:'hook',when:{object:'hook'},family:'tools'}]}
  }};
  const events=Array.from({length:80},(_,i)=>({id:(i+1)+'.0',entity:'hook',kind:'material-sound',cue:'original'}));
  const frame=(audio,events,time)=>audio.frame({listener:[0,0,0],events,time}).cues;
  const planner=W.spatialAudio.create(config), first=frame(planner,events,1);
  const reordered=W.spatialAudio.create({...config,soundFamilies:{tools:{takes:{a:families.tools.takes.a,b:families.tools.takes.b}}}});
  const next=frame(reordered,[...events].reverse(),12).slice().reverse();
  assert.deepEqual(first,next);
  assert(first.some(row=>row.cue==='a'));
  assert(first.filter(row=>row.cue==='b').length>45);
  const fallback=frame(planner,[{...events[0],entity:'other'}],1);
  assert.equal(fallback[0].cue,'original');
  assert.throws(()=>W.spatialAudio.create({...config,soundFamilies:{tools:{takes:{a:'missing'}}}}),/Invalid sound take/);
  assert.throws(()=>W.spatialAudio.create({...config,soundFamilies:{tools:{takes:{a:{cue:'a',strength:[.8,.2]}}}}}),/Invalid sound take/);
  assert.throws(()=>W.spatialAudio.create({...config,soundFamilies:{}}),/Invalid sound selection rule/);
});

test('velocity layers blend adjacent takes using strength, normal load, or speed and prioritize prop rules',()=>{
  const family=(soft,hard)=>({takes:{soft,hard},layers:[{at:0,takes:['soft']},{at:1,takes:['hard']}]});
  const config={cues:{soft:'felt',hard:'metal',board:'wood',default:'tap'},
    soundFamilies:{board:{takes:{knock:'board'}},handle:family('soft','hard'),fragile:{
      ...family('soft','hard'),takes:{soft:{cue:'soft',strength:[0,.2]},hard:{cue:'hard',strength:[.8,1]}}
    }},
    bindings:{impact:{on:{kind:'impact'},cue:'default',speedForFullStrength:4,loadForFullStrength:100,select:[
      {id:'floor',when:{surface:'wood'},family:'board'},
      {id:'handle',when:{prop:'brass-handle'},family:'handle'},
      {id:'fragile',when:{prop:'cabinet-knob'},family:'fragile'}
    ]}}
  };
  const audio=W.spatialAudio.create(config);
  const base={kind:'impact',id:'1.0',entity:'brass-handle',surface:'wood',at:[0,0,-1]};
  const voices=other=>audio.frame({listener:[0,0,0],events:[{...base,...other},{...base,...other}]}).cues;
  const blend=voices({speed:1});
  assert.deepEqual(blend.map(voice=>[voice.cue,voice.gain]),[['soft',.75],['hard',.25]]);
  assert.deepEqual(blend.map(row=>row.selection.layer),[{at:0,weight:.75},{at:1,weight:.25}]);
  assert(blend.every(row=>row.selection.rule==='handle' && row.selection.context.prop==='brass-handle'));
  assert.deepEqual(blend[0].selection.measurement,{kind:'speed',value:1,reference:4});
  assert.deepEqual(voices({contact:{force:[900,-50,0],normal:[0,2,0]},speed:4})
    .map(row=>[row.gain,row.selection.measurement]),[[.5,{kind:'load',value:50,reference:100}],[.5,{kind:'load',value:50,reference:100}]]);
  const measured=voices({strength:.2,load:100,speed:4});
  near(measured[1].gain,.2);
  assert.equal(measured[1].selection.measurement.kind,'strength');
  assert.deepEqual(voices({load:500}).map(row=>[row.cue,row.gain]),[['hard',1]]);
  assert.deepEqual(voices({load:0}).map(row=>[row.cue,row.gain]),[['soft',1]]);
  assert.equal(voices({})[0].selection.fallback,'quiet-layer');
  assert.deepEqual(voices({prop:'cabinet-knob',load:50}).map(row=>row.cue),['board']);
  assert.deepEqual(voices({prop:'cabinet-knob',load:10}).map(row=>[row.cue,row.gain,row.selection.fallback]),
    [['soft',1,'available-layer']]);
  assert.deepEqual(voices({prop:'different',surface:'stone'}).map(row=>row.cue),['default']);
  assert.throws(()=>W.spatialAudio.create({...config,soundFamilies:{...config.soundFamilies,
    handle:{takes:{soft:'soft'},layers:[{at:.5,takes:['soft']},{at:.4,takes:['missing']}]}}}),/Invalid velocity layer/);
});

test('sound rotation exhausts eligible takes, ignores duplicate events, and keeps velocity histories separate',()=>{
  const planner=W.spatialAudio.create({soundSeed:142,
    cues:{a:'a',b:'b',c:'c',x:'x',y:'y',z:'z'},
    soundFamilies:{latch:{takes:{a:'a',b:'b',c:'c',x:'x',y:'y',z:'z'},variation:{rotate:true,pitchCents:[-80,80]},
      layers:[{at:0,takes:['a','b','c']},{at:1,takes:['x','y','z']}]}},
    bindings:{drop:{on:{kind:'impact'},select:[{id:'latch',family:'latch'}]}}
  });
  const events=Array.from({length:9},(_,i)=>({id:(i+1)+'.0',kind:'impact',strength:.5,pitch:1.12}));
  const listen=(rows,playback,time=1)=>planner.frame({listener:[0,0,0],time,events:rows,playback}).cues;
  const all=listen(events,planner.createPlayback());
  for(const anchor of [0,1]){
    const rows=all.filter(row=>row.selection.layer.at===anchor);
    for(let i=0;i<rows.length;i+=3)assert.equal(new Set(rows.slice(i,i+3).map(row=>row.cue)).size,3);
    assert(rows.every((row,i)=>!i||rows[i-1].cue!==row.cue));
  }
  for(const row of all){
    const {pitchCents,rate}=row.selection.variation;
    assert(pitchCents>=-80 && pitchCents<=80);
    near(rate,1.12*2**(pitchCents/1200));
    assert.equal(row.rate,rate);
  }
  const playback=planner.createPlayback();
  const streamed=events.flatMap((event,i)=>{
    const first=listen([event,event],playback,i+1);
    assert.deepEqual(first,listen([event],playback,i+1));
    return first;
  });
  assert.deepEqual(streamed,all);
  assert.deepEqual(listen([events[0]],playback,0),all.slice(0,2));
});

test('rotation tolerates forced repeats and resumes avoiding them when more takes qualify',()=>{
  const planner=W.spatialAudio.create({cues:{a:'a',b:'b',c:'c'},
    soundFamilies:{tool:{takes:{a:'a',b:{cue:'b',strength:[.5,1]},c:{cue:'c',strength:[.5,1]}},variation:{rotate:true}}},
    bindings:{tool:{on:{kind:'impact'},select:[{id:'tool',family:'tool'}]}}
  });
  const events=[.1,.1,.8,.8,.8].map((strength,i)=>({id:(i+1)+'.0',kind:'impact',strength}));
  const voices=planner.frame({events,listener:[0,0,0]}).cues;
  assert.deepEqual(voices.slice(0,2).map(row=>row.cue),['a','a']);
  assert.deepEqual(new Set(voices.slice(2,4).map(row=>row.cue)),new Set(['b','c']));
  assert.equal(voices[4].cue,'a');
  assert.throws(()=>W.spatialAudio.create({cues:{a:'a'},soundFamilies:{
    tool:{takes:{a:'a'},variation:{rotate:true,pitchCents:[60,-30]}}}
  }),/ordered integer-cent range/);
});

test('continuous contact events keep phase through speed changes, material switches, and release',()=>{
  const audio=W.spatialAudio.create({cues:{wood:{asset:'wood',pitch:1.25},stone:'stone'},
    contactLoops:{attack:.125,crossfade:.25,release:.25,response:.125,interactions:{
      drag:{cue:'wood',materials:{stone:'stone'},speedForFullRate:4,loadForFullGain:100,rate:[.5,1.5]}}}});
  const listener=[0,0,0], id='crate', at=[0,0,-1];
  const command=(kind,time,contact)=>W.timedEvents.at(time,{id:String(time),kind,contact:{id,...contact}});
  const start=command('contact-start',.125,{interaction:'drag',at,material:'wood',speed:2,load:50});
  const update=command('contact-update',.375,{speed:4,load:100});
  const change=command('contact-update',.625,{material:'stone'});
  const halt=command('contact-end',1,{});
  const frame=(time,events=[],playback)=>audio.frame({time,events,listener,playback});
  let state=frame(.25,[start,start]);
  assert.deepEqual(state.cues,[]);
  const [wood]=state.active;
  near(wood.offset,.15625);
  near(wood.gain,.5);
  assert.deepEqual(state.contactChanges.map(row=>row.time),[.125,.25]);
  state=frame(.5,[update]);
  assert.equal(state.active[0].id,wood.id);
  near(state.active[0].offset,.25*1.25+.125*1.875);
  near(state.active[0].rate,1.875);
  near(state.active[0].gain,1);
  state=frame(.75,[change]);
  assert.deepEqual(state.active.map(voice=>[voice.cue,voice.contact.material]),[['wood','wood'],['stone','stone']]);
  assert.equal(state.active[0].id,wood.id);
  for(const voice of state.active)near(voice.gain,.5);
  near(state.active[1].offset,.125*1.5);
  state=frame(.875,[change]);
  assert.deepEqual(state.active.map(voice=>voice.cue),['stone']);
  assert(state.contactChanges.some(row=>row.ended&&row.voice.id===wood.id));
  near(frame(1.125,[halt]).active[0].gain,.5);
  state=frame(1.25);
  assert.deepEqual(state.active,[]);
  assert.deepEqual(state.contactChanges.map(row=>[row.time,row.ended]),[[1.25,true]]);
  assert.deepEqual(frame(1.25,[halt]).active,[]);
  assert.deepEqual(frame(.25,[start]).active,[wood]);
  assert.deepEqual(frame(.25,[start],audio.createPlayback()).active,[wood]);
});

test('contact snapshots release missing contacts and use stable native wheel identities',()=>{
  const audio=W.spatialAudio.create({cues:{wheel:'wheel',clay:'clay',stone:'stone'},
    contactLoops:{fields:['feedback/contacts'],attack:0,crossfade:.1,release:.1,interactions:{
      roll:{cue:'wheel',materials:{stone:'stone','trackside/clay':'clay'}},
      scrape:{cue:'stone'}}}});
  const run=W.runtime.create(contacts), playback=audio.createPlayback();
  const listener=[0,1,0], find=frame=>frame.active.flatMap(row=>row.contact.interaction==='roll'?[row.id]:[]);
  const options={listener,playback};
  run.advance(21);
  const first=find(audio.frame({...options,time:run.view().time,query:run.query()}));
  assert(first.length>=2);
  run.advance(22);
  const second=find(audio.frame({...options,time:run.view().time,query:run.query()}));
  assert.deepEqual(first,second);
  const fieldContact=(time,rows)=>audio.frame({...options,time,contacts:rows});
  const scrape={id:'tool',interaction:'scrape',speed:2,load:9,material:'stone',at:[0,1,-1]};
  assert.equal(fieldContact(.5,[scrape]).active[0].contact.id,'tool');
  assert.equal(fieldContact(.625,[]).active[0].contact.targetGain,0);
  assert.deepEqual(fieldContact(.75,[]).active,[]);
  assert.throws(()=>W.spatialAudio.create({cues:{wheel:'wheel'},contactLoops:{interactions:{roll:{cue:'missing'}}}}),
    /Invalid continuous contact audio interaction/);
});

test('compound impacts gate each voice, resolve material and prop cues, and keep native fallback scoped',()=>{
  const cues={hit:{asset:'hit',bus:'effects'},wood:'wood',clink:'clink',ring:{asset:'ring',bus:'ambience'}};
  const create=impactLayers=>W.spatialAudio.create({cues,materials:{boards:{impact:'wood'}},
    soundFamilies:{parts:{takes:{clink:'clink'}}},bindings:{
      tool:{on:{kind:'material-sound',where:{path:'/interaction',value:'impact'}},gain:.8,impactLayers}
    }
  });
  const layers={
    strike:{cue:'hit',bus:'foley',threshold:{measure:'speed',min:.5}},
    surface:{interaction:'impact',threshold:{measure:'speed',min:1}},
    rattle:{threshold:{measure:'load',min:12},delay:.025,
      select:[{id:'box',when:{prop:'toolbox'},family:'parts'}]},
    tail:{cue:'ring',threshold:{measure:'strength',min:.5},speedForFullStrength:4,
      at:[1,0,0],gain:.5,delay:.05}
  };
  const audio=create(layers);
  const frame=(...events)=>audio.frame({listener:[0,0,0],events}).cues;
  const event={id:'hit-1',kind:'material-sound',interaction:'impact',entity:'toolbox',point:[0,0,-1],
    cue:'hit',material:'boards'};
  assert.deepEqual(frame({...event,speed:.2}),[]);
  assert.deepEqual(frame(event),[]);
  assert.deepEqual(frame({...event,interaction:'roll'}).map(row=>row.cue),['hit']);
  const tap=frame({...event,speed:.5,contact:{load:12,prop:'plain-box'}});
  assert.deepEqual(tap.map(row=>[row.impact.layer,row.bus,row.startDelay]),[['strike','foley',0]]);
  const hard={...event,contact:{speed:2,force:[0,-12,0],normal:[0,2,0]}};
  const hit=frame(hard,hard);
  assert.deepEqual(hit.map(row=>[row.impact.layer,row.cue,row.bus,row.startDelay]),[
    ['strike','hit','foley',0],['surface','wood','effects',0],
    ['rattle','clink','effects',.025],['tail','ring','ambience',.05]
  ]);
  assert.deepEqual(hit.map(row=>row.impact.threshold.value),[2,2,12,.5]);
  assert.deepEqual(hit[3].position,[1,0,0]);
  near(hit[3].gain,.4);
  assert.equal(new Set(hit.map(row=>row.id)).size,4);
  assert.equal(hit[2].selection.binding,'impact:tool/rattle');
  assert.throws(()=>create({strike:{cue:'unknown'}}),/Invalid cue binding/);
  assert.throws(()=>create({strike:{cue:'hit',bus:'custom'}}),/Invalid compound impact layer/);
  assert.throws(()=>create({strike:{cue:'hit',threshold:{min:2,measure:'strength'}}}),/Invalid compound impact layer/);
  assert.throws(()=>create({squeak:{cue:'hit'}}),/Invalid compound impact binding/);
});

test('source profiles combine with live acoustic opening and medium rules without replacing a cue asset',()=>{
  const audio=W.spatialAudio.create({cues:{call:{asset:'single-call',audioProfile:'source'}},
    processing:{path:'acoustics/path',profiles:{
      source:{highpass:80,gainDb:-3},
      pipe:{highpass:350,peaks:[{hz:740,q:4,gainDb:14}]},
      hatch:{lowpass:680,peaks:[{hz:310,q:2,gainDb:5}]},
      water:{lowpass:480}
    },rules:[
      {id:'submerged',when:{medium:'water',minMeters:1},profile:'water'},
      {id:'closed',when:{opening:'hatch',maxOpen:.1},profile:'hatch'},
      {id:'steel',when:{object:'steel-pipe',cue:'call'},profile:'pipe'}
    ]}});
  const run=W.runtime.create(hatch);
  const call=(config={})=>audio.cue({query:run.query(),listener:{entity:'listen-post'},at:{entity:'beacon',socket:'speaker'},cue:'call',...config});
  assert.equal(call().asset,'single-call');
  assert.deepEqual(call().processing.profiles,['source']);
  assert.deepEqual(call({object:'steel-pipe'}).processing.profiles,['source','pipe']);
  assert.deepEqual(call({audioProfile:'pipe',object:'steel-pipe'}).processing.profiles,['pipe']);
  near(call().gain,10**(-3/20)/4.7);
  run.advance(8);
  assert.equal(call({object:'steel-pipe'}).processing.rule,'closed');
  assert.equal(call().processing.lowpass,680);
  run.advance(16);
  assert.equal(call({object:'steel-pipe'}).processing.rule,'steel');
  const pool=W.runtime.create({systems:{
    wet:{kind:'enclosed-water',config:{chambers:{pool:{bounds:{min:[1,0,-1],max:[3,4,1]},initial:8}}}},
    acoustics:{kind:'acoustics',config:{layout:'wet/acoustic-layout'}}
  }});
  const inPool=(at,listener)=>call({query:pool.query(),at,listener}).processing;
  assert.equal(inPool([1.1,1,0],[2.7,1,0]).rule,'submerged');
  assert.equal(inPool([1.1,1,0],[1.6,1,0]).rule,undefined);
  assert.equal(inPool([1.1,3,0],[2.7,3,0]).rule,undefined);
  const event=audio.frame({listener:[0,0,0],events:[{kind:'audio-cue',cue:'call',object:'steel-pipe'}]}).cues[0];
  assert.deepEqual(event.processing.profiles,['source','pipe']);
  assert.throws(()=>W.spatialAudio.create({cues:{call:{asset:'dry',audioProfile:'unlisted'}}}),/Invalid audio cue/);
  assert.throws(()=>W.spatialAudio.create({processing:{profiles:{bad:{lowpass:20}}}}),/Invalid sound profile/);
  assert.throws(()=>W.spatialAudio.create({processing:{profiles:{room:{}},
    rules:[{id:'invalid',profile:'room',when:{medium:'water'}}]}}),/Invalid sound processing rule/);
});

test('Web Audio renders positional attenuation, muffling, and cancelled late assets',
  {skip:!process.env.INK_TEST_CHROME,timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-spatial-audio-'));
  let finished;
  const reportPending=new Promise(resolve=>{finished=resolve;});
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',chunk=>{body+=chunk;});
    req.on('end',()=>{res.end('ok');finished(body);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const reportURL='http://127.0.0.1:'+server.address().port;
  const page=path.join(dir,'audio.html'), moduleURL=pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href;
  const high=4400, low=220, rate=48000, samples=12000;
  const base={time:0,listener:{position:[0,0,0],forward:[0,0,-1],up:[0,1,0]},active:[]};
  const voice={id:'test',asset:'signal',mode:'cue',offset:0,rate:1,delay:0,position:[2,0,0],gain:.5,
    bands:{low:.5,mid:.5,high:.5},cutoff:22000};
  fs.writeFileSync(page,`<!doctype html><meta charset="utf-8"><script type="module">
  import {createSpatialAudioPlayer} from ${JSON.stringify(moduleURL)};
  const base=${JSON.stringify(base)}, voice=${JSON.stringify(voice)}, rate=${rate}, samples=${samples};
  const report=body=>fetch(${JSON.stringify(reportURL)},{method:'POST',mode:'no-cors',body:JSON.stringify(body)});
  async function play(voice,{duplicate=false,cancel=false,blend=false}={}){
    const context=new OfflineAudioContext(2,samples,rate), signal=context.createBuffer(1,samples,rate);
    for(let i=0;i<samples;i++)signal.getChannelData(0)[i]=.25*Math.sin(i*2*Math.PI*${high}/rate)+.25*Math.sin(i*2*Math.PI*${low}/rate);
    let ready;
    const player=createSpatialAudioPlayer(context,{panning:'equalpower',smoothing:0,
      resolveAsset:()=>cancel?new Promise(resolve=>{ready=resolve;}):signal});
    const cues=blend?[.25,.75].map((weight,i)=>({...voice,id:'layer-'+i,gain:voice.gain*weight,
      bands:Object.fromEntries(Object.entries(voice.bands).map(([name,level])=>[name,level*weight]))})):[voice];
    const frame={...base,cues}, started=player.update(frame);
    if(cancel){await Promise.resolve();player.reset();ready(signal);}
    await started;
    if(duplicate)await player.update(frame);
    const output=await context.startRendering();
    const rms=i=>Math.sqrt(output.getChannelData(i).reduce((a,y)=>a+y*y,0)/samples);
    function energy(hz){
      let x=0,y=0;const rows=output.getChannelData(1);
      for(let i=1200;i<rows.length;i++){const a=i*2*Math.PI*hz/rate;x+=rows[i]*Math.cos(a);y+=rows[i]*Math.sin(a);}
      return Math.hypot(x,y)/(samples-1200);
    }
    player.dispose();
    return {rms:[rms(0),rms(1)],low:energy(${low}),high:energy(${high})};
  }
  async function looping(){
    const context=new OfflineAudioContext(2,rate,rate), buffer=context.createBuffer(1,rate,rate), starts=[];
    const create=context.createBufferSource.bind(context);
    context.createBufferSource=()=>{
      const source=create(), start=source.start.bind(source);
      source.start=(...args)=>{starts.push(args[1]);return start(...args);};
      return source;
    };
    const player=createSpatialAudioPlayer(context,{resolveAsset:()=>buffer});
    const frame=(time,offset)=>({...base,time,cues:[],active:[{...voice,mode:'loop',offset}]});
    await player.update(frame(.1,.1));
    await player.update(frame(.35,.35));
    await player.update(frame(1.6,1.6),{seek:true});
    player.dispose();
    return starts;
  }
  async function continuous(){
    const context=new OfflineAudioContext(2,rate,rate), buffer=context.createBuffer(1,rate,rate);
    buffer.getChannelData(0).fill(.25);
    const create=context.createBufferSource.bind(context), rates=[];
    let starts=0;
    context.createBufferSource=()=>{
      starts++;
      const source=create(), param=source.playbackRate, set=param.setValueAtTime.bind(param);
      param.setValueAtTime=(value,time)=>{rates.push(value);return set(value,time);};
      return source;
    };
    const player=createSpatialAudioPlayer(context,{resolveAsset:()=>buffer});
    const frame=(time,gain,targetGain,remaining,rate)=>({...base,time,cues:[],active:[
      {...voice,mode:'loop',position:null,gain,bands:{low:gain,mid:gain,high:gain},
        rate,contact:{targetGain,remaining}}]});
    await player.update(frame(0,0,1,.125,1));
    const speed=context.suspend(.25).then(async()=>{
      await player.update(frame(.25,1,1,0,1.5));
      await context.resume();
    });
    const release=context.suspend(.5).then(async()=>{
      await player.update(frame(.5,1,0,.125,1.5));
      await context.resume();
    });
    const [output]=await Promise.all([context.startRendering(),speed,release]);
    const channel=output.getChannelData(0);
    const levels=[.015,.085,.42,.555,.72].map(time=>channel[Math.round(time*rate)]);
    player.dispose();
    return {starts,rates,levels};
  }
  async function impact(){
    const context=new OfflineAudioContext(2,samples,rate), buffer=context.createBuffer(1,samples,rate);
    buffer.getChannelData(0).fill(.25);
    const merger=context.createChannelMerger(2), foley=context.createGain(), effects=context.createGain();
    foley.connect(merger,0,0);effects.connect(merger,0,1);merger.connect(context.destination);
    const starts=[], create=context.createBufferSource.bind(context);
    context.createBufferSource=()=>{
      const source=create(), start=source.start.bind(source);
      source.start=(...args)=>{starts.push(args[0]);start(...args);};
      return source;
    };
    const player=createSpatialAudioPlayer(context,{resolveAsset:()=>buffer,destinations:{foley,effects}});
    const strike={...voice,position:null,bus:'foley',startDelay:0};
    const tail={...strike,id:'tail',bus:'effects',startDelay:.0625};
    const frame={...base,cues:[strike,tail]};
    await player.update(frame);
    await player.update(frame);
    const output=await context.startRendering();
    const levels=[.04,.1025].map(time=>[0,1].map(channel=>output.getChannelData(channel)[Math.round(time*rate)]));
    player.dispose();
    return {starts,levels};
  }
  async function contextTone(){
    const context=new OfflineAudioContext(2,rate,rate), buffer=context.createBuffer(1,rate,rate);
    for(let i=0;i<rate;i++)buffer.getChannelData(0)[i]=.08*(Math.sin(i*2*Math.PI*440/rate)+Math.sin(i*2*Math.PI*3600/rate));
    const create=context.createBufferSource.bind(context);
    let starts=0;
    context.createBufferSource=()=>{starts++;return create();};
    const player=createSpatialAudioPlayer(context,{resolveAsset:()=>buffer,smoothing:.015});
    const frame=(time,processing)=>({...base,time,cues:[],active:[{...voice,mode:'loop',position:null,processing}]});
    await player.update(frame(0,{highpass:0,lowpass:22000,peaks:[]}));
    const changed=context.suspend(.45).then(async()=>{
      await player.update(frame(.45,{highpass:0,lowpass:1000,peaks:[{hz:440,q:3,gainDb:9}]}));
      await context.resume();
    });
    const [output]=await Promise.all([context.startRendering(),changed]);
    function measure(start,hz){
      let x=0,y=0;
      const channel=output.getChannelData(0), length=rate/5;
      for(let i=start;i<start+length;i++){
        const angle=i*2*Math.PI*hz/rate;
        x+=channel[i]*Math.cos(angle);
        y+=channel[i]*Math.sin(angle);
      }
      return Math.hypot(x,y)/length;
    }
    player.dispose();
    return {starts,dry:[measure(4800,440),measure(4800,3600)],wet:[measure(33600,440),measure(33600,3600)]};
  }
  try{
    const clear=await play(voice), same=await play(voice,{duplicate:true}),
      obstructed=await play({...voice,gain:.22,bands:{low:.22,mid:.22,high:.06},cutoff:1000}),
      cancelled=await play(voice,{cancel:true});
    await report({clear,same,obstructed,cancelled,blend:await play(voice,{blend:true}),starts:await looping(),continuous:await continuous(),impact:await impact(),tone:await contextTone()});
  }catch(error){await report({error:error.stack});}
  </script>`);
  const child=spawn(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
    '--allow-file-access-from-files','--user-data-dir='+path.join(dir,'profile'),pathToFileURL(page).href],{stdio:'ignore'});
  t.after(async()=>{
    const exited=child.exitCode===null&&new Promise(resolve=>child.once('exit',resolve));
    child.kill();
    if(exited)await exited;
    server.closeAllConnections();server.close();
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const report=JSON.parse(await Promise.race([reportPending,new Promise((_,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>reject(Error('Audio browser exited with code '+code)));
    t.signal.addEventListener('abort',()=>reject(t.signal.reason),{once:true});
  })]));
  assert(!report.error,report.error);
  const {clear,same,obstructed,cancelled}=report;
  assert(clear.rms[1]>.1&&clear.rms[1]>clear.rms[0]*4);
  assert.deepEqual(clear,same);
  near(report.blend.rms[1],clear.rms[1]);
  assert(obstructed.low>0&&obstructed.low<clear.low*.6);
  assert(obstructed.high<clear.high*.03);
  assert.deepEqual(cancelled.rms,[0,0]);
  assert.equal(report.starts.length,2);
  near(report.starts[0],.1);
  near(report.starts[1],.6);
  assert.deepEqual(report.continuous.rates,[1,1.5,1.5]);
  assert.equal(report.continuous.starts,1);
  const [attack,building,full,releasing,silent]=report.continuous.levels;
  assert(attack>0&&attack<building&&building<full);
  assert(releasing>0&&releasing<full);
  near(silent,0);
  assert.deepEqual(report.impact.starts,[0,.0625]);
  const [earlyImpact,lateImpact]=report.impact.levels;
  assert(earlyImpact[0]>.05);
  near(earlyImpact[1],0);
  assert(lateImpact.every(level=>level>.05));
  const {dry,wet,starts}=report.tone;
  assert.equal(starts,1);
  assert(dry.every(level=>level>.01));
  assert(wet[0]>2*dry[0]&&wet[1]<.15*dry[1]);
});
