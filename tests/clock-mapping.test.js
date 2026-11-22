const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const ink=require('..'), {KIT:K}=ink.load(), W=K.world, A=K.procedural.mediaGraph;
const fps={numerator:30000,denominator:1001}, rate={numerator:60000,denominator:1001};
const clock={fps,simulationRate:rate,sampleRate:48000}, dt=K.timeDomains.take(clock).dt;
const words=[
  {id:'early',text:'Hold',from:{sample:2205},to:{sample:6615}},
  {id:'land',text:'land',from:{sample:8820},to:{sample:13230}}
];
const run=()=>{
  const engine=W.runtime.create({format:W.format,version:1,id:'harbor',dt,takeClock:clock,
    commands:[{tick:12,action:'world/event',args:{kind:'arrival'}},{tick:14,action:'world/event',args:{
      kind:'contact',timing:{format:'ink-studio/event-time',time:.21}
    }}]},{recordRun:true});
  engine.advance(18);
  return engine.recording();
};
const plan=events=>({format:W.clockMapping.format,version:1,id:'new-cut',clock,sources:{
  harbor:{clock:{fps,simulationRate:rate,sampleRate:44100},events,words}
},clips:[{id:'entry',source:'harbor',in:{tick:6},out:{tick:18},at:{frame:10},duration:{frame:8}}],
  cues:{arrive:{source:'harbor',at:{event:'12.0',branch:'main'},preset:'amber'},
    phrase:{source:'harbor',at:{word:'land',edge:'end'},preset:'blue'}}});

test('maps exact addresses for simulation, picture, samples, dialogue and show cue boundaries',()=>{
  const clockAPI=K.timeDomains.take(clock);
  assert.deepEqual(clockAPI.address({frame:14}).timecode,{numerator:7007,denominator:15000});
  assert.equal(clockAPI.address({sample:4410}).sample,4410);
  assert.equal(clockAPI.address({tick:12}).frame,6);
  const log=run(), spec=plan(W.storyEvents.envelopes(log)), mapped=W.clockMapping.map(spec);
  const [arrival,contact]=mapped.events;
  assert.equal(arrival.event.tick,12);
  assert.deepEqual(arrival.original.timecode,{numerator:1001,denominator:5000});
  assert.deepEqual([arrival.edited.frame,arrival.edited.tick,arrival.edited.sample],[14,28,22422]);
  const nodes=W.graphPorts.operations;
  const world=nodes['sim.world'].instantiate();
  const frame=world({source:log,commands:[],options:{tick:12}},{time:0}).value;
  assert.deepEqual(nodes['sim.worldPulse'].run({source:frame,options:{kind:'arrival'}}).value.entries[0].at,
    arrival.original.timecode);
  assert.deepEqual(contact.original.timecode,{numerator:21,denominator:100});
  assert.equal(contact.event.tick,14);
  assert.equal(mapped.cues[0].at.showFrame,14);
  assert.deepEqual([mapped.cues[1].at.frame,mapped.cues[1].at.showFrame],[17,18]);
  const [trimmed,land]=mapped.words;
  assert.equal(trimmed.original.from.sample,2205);
  assert.deepEqual(trimmed.visible.from,{numerator:1001,denominator:10000});
  assert.equal(trimmed.edited.from.frame,10);
  assert.equal(land.original.to.sample,13230);
  assert.deepEqual(mapped.issues,[]);
  const shifted=W.clockMapping.map({...spec,clips:[{...spec.clips[0],at:{frame:6},duration:{frame:10}}]});
  assert.deepEqual(shifted.events[0].original,arrival.original);
  assert.equal(shifted.events[0].edited.frame,11);
  const trimmedCue=W.clockMapping.map({...spec,clips:[{...spec.clips[0],in:{tick:13}}]});
  assert.deepEqual(trimmedCue.issues.map(issue=>[issue.cue,issue.reason]),[['arrive','outside-clip']]);
  const repeated=W.clockMapping.map({...spec,clips:[...spec.clips,{...spec.clips[0],id:'again',at:{frame:24}}]});
  assert.equal(repeated.cues.filter(row=>row.id==='arrive').length,2);
  assert.deepEqual(repeated.events.filter(row=>row.event.id==='12.0').map(row=>row.original),
    [arrival.original,arrival.original]);
});

test('audio editorial and an exact scene timeline preserve source time while playing at edited positions',()=>{
  const log=run(), mapped=W.clockMapping.map(plan(W.storyEvents.envelopes(log)));
  const session={format:'ink-studio/audio-editorial',version:1,id:'word-spot',sampleRate:48000,clockMap:mapped,
    picture:{fps,shots:[{id:'new-cut',frames:24}]},clips:[{id:'cue',spot:{cue:'phrase'},take:'main',
      takes:{main:{asset:'tap',sync:{sample:12}}}}]};
  const samples=new Float64Array(40);samples[12]=.5;
  const rendered=A.audioEditorial.render(session,{tap:{samples,sampleRate:48000,channels:1}});
  const {spot}=rendered.report.clips[0];
  assert.equal(spot.sample,mapped.cues[1].at.sample);
  assert.deepEqual(spot.original,mapped.cues[1].original);
  assert(rendered.value.samples[spot.sample*2]>.1);
  const p=W.presentationCues, sheet=p.project(W.storyEvents.envelopes(log),{
    format:p.planFormat,version:1,id:'contact-replay',rules:{contact:{on:{kind:'contact'},cue:{kind:'flash',delay:.05}},
      arrival:{on:{kind:'arrival'},cue:{kind:'marker'}}}
  });
  const timeline=K.timeline.compile({sequences:{take:{duration:1,presentationCues:sheet}},
    clips:[{id:'cut',sequence:'take',time:1,in:0,out:1,duration:2}]},{exact:true});
  const [arrival,cue]=timeline.presentationCues;
  assert.deepEqual(arrival.source.timecode,{numerator:1001,denominator:5000});
  assert.deepEqual(cue.timecode,{numerator:23507,denominator:15000});
  assert.deepEqual(cue.originalTimecode,sheet.cues[1].timecode);
  assert.deepEqual(cue.source.timecode,{numerator:21,denominator:100});
  const mappedTimeline=K.timeline.compile(W.clockMapping.timeline(mapped),{exact:true});
  const [placed]=mappedTimeline.forTake(K.timeDomains.take(clock).at(14)).cues;
  assert.equal(placed.source.tick,12);
  assert.deepEqual(placed.source.timecode,mapped.events[0].original.timecode);
});

test('take map resolves local sources and patch show consumes the same exact cue map',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-clock-map-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=name=>path.join(folder,name), save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const spec=plan({file:'source.run.json'});
  spec.sources.harbor.words={file:'words.json'};
  save('source.run.json',run());
  save('words.json',words);
  save('map.json',spec);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const command=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:folder,encoding:'utf8'});
  const built=command('take','map','map.json','--out','mapped.json');
  assert.equal(built.status,0,built.stderr);
  const report=JSON.parse(fs.readFileSync(file('mapped.json')));
  assert.equal(command('take','map','map.json','--out','words.json').status,1);
  const show={format:'ink-studio/patch-show',version:1,patch:'graph.json',output:'picture',fps:'30000/1001',
    frames:24,presets:{amber:{},blue:{}},cueMap:'mapped.json'};
  save('show.json',show);
  const {readShow}=require('../cli/patch-show-config.js');
  const config=await readShow(file('show.json'),true);
  assert.deepEqual(config.cues.map(cue=>[cue.frame,cue.preset]),[[14,'amber'],[18,'blue']]);
  assert.deepEqual(config.cues[0].clockCue.original,report.events[0].original);
  save('show.json',{...show,fps:30});
  await assert.rejects(readShow(file('show.json'),true),/show frame rate/);
  report.cues[1].at.sample+=1;
  save('mapped.json',report);
  save('show.json',show);
  await assert.rejects(readShow(file('show.json'),true),/differ from its exact time/);
});
