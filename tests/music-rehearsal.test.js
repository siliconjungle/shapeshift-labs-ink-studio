const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), A=K.music.production,R=A.rehearsal;
const rate=8000;
const cue=(pitch,gain=-16)=>({
  arrangement:{score:{tempoMap:{tempo:120},key:{root:'C4'},harmonies:{home:{root:'C4',quality:'unison'}}},
    parts:{lead:{role:'lead',material:'line'}},sections:[{id:'cue',bars:1,harmony:'home'}],
    motifs:{line:{length:2,events:[{beat:0,duration:1.55,midi:pitch,velocity:.85}]}}},
  patches:{bow:{type:'fm',index:.44,env:{attack:.008,decay:.27,sustain:.71,release:.18}}},
  tracks:{lead:{patch:'bow',gain,send:.24}},room:{gain:-24,damping:.55,decay:.5}});
const sources={search:cue(60),reveal:cue(67,-10),accent:cue(78,-6),tone:cue(67,-17)};
const timeline={entry:'search',end:8,segments:{search:{source:'search',end:1.8},reveal:{source:'reveal'},
  pickup:{source:'accent',end:.36,loop:false},mark:{source:'accent',end:.3,loop:false},
  thread:{source:'tone',end:.68,loop:false}},
  transitions:[{from:'search',to:'reveal',exit:1.5,bridge:'pickup',pickup:.04,tail:.12}],
  stingers:{strike:'mark'}};
const adaptive={tempo:120,entry:'search',sections:{search:{resource:'search'},reveal:{resource:'reveal'}},
  parameters:{open:{default:0}},cues:{hit:{resource:'strike'}},
  transitions:[{id:'open',from:'search',to:'reveal',quantize:'bar',
    when:{path:'/parameters/open',op:'gte',value:.5}}]};
const input=(tick,value)=>({tick,action:'world/input',args:{port:'score/parameter.open',value}});
function recording(commands,ticks=136) {
  const world={id:'test-score',dt:.05,systems:{score:{kind:'adaptive-music',config:adaptive}},commands};
  const run=K.world.runtime.create(world);
  run.advance(ticks);
  return run.recording();
}
const log=recording([input(43,1),{tick:83,action:'score/cue',args:{cue:'hit'}},
  {tick:84,action:'world/event',args:{kind:'audio-cue',cue:'latch'}}]);
const early=R.capture(log,{id:'late'});
const cancel=R.capture(recording([input(6,1),input(28,0)]),{id:'reversal'});
const revision={id:'soft-join',transitions:[{from:'search',to:'reveal',exit:1.8,pickup:.20,
  commonTone:{segment:'thread',pickup:.13}}],stingerRules:[{resource:'strike',section:'reveal',linked:false}]};

test('capture replays world logs, tracks cancelled and committed requests, and preserves world cue times',()=>{
  assert.equal(early.origin.kind,'world-recording');
  assert.equal(early.intents.find(row=>row.kind==='music-transition').time,4);
  assert(early.requests.some(row=>row.outcome==='committed' && row.due===4 && row.time>2));
  assert.deepEqual(early.worldEvents,[{cue:'latch',time:4.2,beatId:'ink:beat:test-score/main/84.0'}]);
  const linked=A.live.fromTrace(early,{worldCues:{latch:'latch'}});
  assert.equal(linked.events.find(row=>row.intent.cue==='latch').intent.beatId,early.worldEvents[0].beatId);
  assert.equal(linked.events.find(row=>row.intent.kind==='music-transition').intent.beatId,'ink:beat:test-score/main/80.0');
  assert.equal(cancel.intents.length,0);
  assert.equal(cancel.requests[0].outcome,'cancelled');
  assert.equal(cancel.requests[0].due,2);
  assert.equal(cancel.requests[0].resolvedAt,1.4);
  const standalone=R.captureScore(adaptive,[{time:2.15,parameters:{open:1}},{time:4.15,cues:[{cue:'hit'}]}],
    {id:'standalone',end:6.8});
  const timestamps=trace=>trace.intents.map(row=>[row.kind,Math.round(1000*row.time)]);
  assert.deepEqual(timestamps(standalone),timestamps(early));
  assert.throws(()=>R.capture({...log,end:{...log.end,manual:{}}},{id:'bad'}),/diverges/);
});

test('rehearsal exposes same absolute comparison windows with editable bridges, exits, held notes and stingers',()=>{
  const cases=[{trace:'late',id:'transition-1'},{trace:'late',id:'cue-1'},{trace:'reversal',id:'request-1'}];
  const run=R.run(sources,timeline,[early,cancel],[revision],{}, {sampleRate:rate,cases,watchTracks:['lead']});
  const [entry,hit,reversal]=run.report.listening;
  assert.equal(entry.time,4);
  assert.equal(entry.firstSample,24000);
  assert.equal(entry.takes[0].join.exit,1.5);
  assert.equal(entry.takes[1].join.exit,1.8);
  assert(entry.takes[1].join.joinedLayers.some(row=>row.kind==='common-tone' && row.start<4 && row.end>4));
  assert(entry.takes[1].nearby.some(row=>row.kind==='transition' && row.time===4));
  assert.equal(hit.takes[0].join.status,'played');
  assert(hit.takes[0].join.issues.some(issue=>issue.kind==='hook-collision'));
  assert.equal(hit.takes[1].join.status,'withheld');
  assert.equal(reversal.kind,'cancelled-request');
  assert(run.report.traces[1].dwells[0].loops>=3);
  assert(run.report.matrix.some(row=>row.from==='search' && row.to==='reveal' && row.cancelled===1 && row.count===1));
  for (const listening of run.report.listening) for (const take of listening.takes) {
    const audio=run.audio[listening.trace+':'+listening.id][take.id];
    assert.equal(audio.samples.length/2,listening.endSample-listening.firstSample);
    assert.equal(audio.sampleRate,rate);
    assert(Math.abs(A.loudness(audio)-take.playback.lufs)<.002);
  }
  const next=R.revise(sources,timeline,revision);
  assert.equal(next.timeline.transitions[0].commonTone.segment,'thread');
  const full=A.renderTimeline(next.sources,{...next.timeline,end:early.end},early.intents,{}, {sampleRate:rate});
  const from=entry.firstSample,to=entry.endSample;
  const kept=run.audio['late:transition-1']['soft-join'].samples;
  assert(kept.every((x,i)=>Math.abs(x-full.value.samples[2*from+i]*entry.takes[1].playback.gain)<.000001));
  assert.equal(kept.length,2*(to-from));
  assert.throws(()=>R.revise(sources,timeline,{transitions:[{from:'search',to:'reveal',
    commonTone:{segment:'thread',pickup:.8}}]}),/common tone pickup/);
});

test('conditional stinger holds use the destination on a shared boundary and preserve linked cues',()=>{
  const intents=[{kind:'music-cue',time:2,serial:1,cue:'hit',resource:'strike'},
    {kind:'music-transition',time:2,serial:2,from:'search',to:'reveal'},
    {kind:'music-cue',time:2,serial:3,cue:'hit',resource:'strike',transition:'open'}];
  const version=R.revise(sources,timeline,revision);
  const {report}=A.renderTimeline(version.sources,version.timeline,intents,{}, {sampleRate:rate});
  assert.deepEqual(report.cueDecisions.map(row=>[row.section,row.status]),[['reveal','withheld'],['reveal','played']]);
  assert.equal(report.placements.filter(row=>row.kind==='stinger').length,1);
});

test('CLI captures recordings, publishes snippets and exports a production timeline',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-rehearsal-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music','rehearsal',...args],{cwd:dir});
  write('world.run.json',log);
  write('capture.json',{id:'late'});
  cli('capture','world.run.json','capture.json','--out','late.json');
  assert.deepEqual(read('late.json').intents,early.intents);
  write('timeline.json',{sources,timeline});
  write('suite.json',{traces:['late.json'],variants:[revision],options:{sampleRate:rate,cases:[{trace:'late',id:'cue-1'}]}});
  cli('run','timeline.json','suite.json','--out','out');
  const manifest=read('out/manifest.json');
  assert.equal(manifest.listening[0].takes[1].join.status,'withheld');
  assert(fs.existsSync(path.join(dir,'out',manifest.listening[0].takes[1].file)));
  write('take.json',revision);
  cli('keep','timeline.json','take.json','late.json','--out','kept.json');
  assert.equal(read('kept.json').timeline.transitions[0].pickup,.2);
  assert.deepEqual(read('kept.json').intents,early.intents);
});

test('seeded regression groups real joins, compares revisions over the same routes and gates by affected route',()=>{
  const scenarios=[{id:'entry',count:6,end:[6.5,7.2],updates:[
    {time:[2.17,2.39],parameters:{open:1}},{time:[4.13,4.21],cues:[{cue:'hit'}]}]},
    {id:'dwell',count:4,end:[7.5,8]}];
  const options={sampleRate:rate,watchTracks:['lead'],limit:3,listenFor:['hook-collision','exhausted-dwell'],
    checks:{dwells:[{id:'idle-hook',segment:'search',maxConsecutive:3}]},
    maxAffected:{'hook-collision':0}};
  const seed=37;
  const actual=R.regression(sources,timeline,{score:adaptive,scenarios,seed,variants:[revision],options});
  const {report,audio,traces}=actual;
  assert.equal(report.count,10);
  assert.deepEqual(R.seedTraces(adaptive,scenarios,seed),traces);
  assert.notDeepEqual(R.seedTraces(adaptive,scenarios,seed+1),traces);
  const collision=report.groups.find(row=>row.family==='hook-collision');
  assert.equal(collision.versions[0].routes,6);
  assert.equal(collision.versions[1].routes,0);
  assert.equal(collision.representative.repair.stingerRules[0].resource,'strike');
  const dwell=report.groups.find(row=>row.family==='exhausted-dwell');
  assert.equal(dwell.versions[0].routes,4);
  assert.deepEqual(report.gates.map(gate=>gate.pass),[false,true]);
  const join=report.listening.find(row=>row.key===collision.key), trace=traces.find(row=>row.id===join.trace);
  const original=A.renderTimeline(sources,{...timeline,end:trace.end},trace.intents,{}, {sampleRate:rate});
  const samples=original.value.samples.slice(join.firstSample*2,join.endSample*2);
  const audition=audio[join.id].reference.samples, {gain}=join.takes[0].playback;
  assert.equal(audition.length,samples.length);
  assert(audition.every((value,i)=>Math.abs(value-samples[i]*gain)<.000001));
  assert.equal(join.takes[1].issues.length,0);
});

test('live and offline comparison pairs captured beat IDs and measures joins, source tails and cue onsets',async()=>{
  const options={live:{sampleRate:rate,traceLimit:1},traceOptions:{arrivalOffset:.125,worldCues:{latch:'strike'}}};
  const result=await R.compare(sources,timeline,early,options);
  const {report,liveReport,value}=result;
  assert.equal(report.format,'ink-studio/music-path-comparison');
  assert.equal(report.endSample,54400);
  assert.equal(report.input.count,3);
  assert.equal(liveReport.trace.length,1);
  const [join]=report.transitions;
  assert.equal(join.beatId,'ink:beat:test-score/main/80.0');
  assert.equal(join.offline.sample,32000);
  assert.equal(join.live.sample,40800);
  assert.equal(join.onsetDeltaSamples,8800);
  assert.equal(join.tail.live[0].firstSample,40800);
  assert.equal(join.tail.offline[0].firstSample,32000);
  assert.equal(join.tail.directReleaseDeltaSamples,join.live.tail.directReleaseEndSample-40800-
    (join.offline.tail.directReleaseEndSample-32000));
  assert.equal(join.variantStatus,'same');
  assert.deepEqual(report.cues.map(row=>[row.cue,row.live.sample,row.offline.sample,row.variantStatus]),
    [['hit',34200,33200,'same'],['latch',34600,33600,'same']]);
  assert.equal(report.cues[1].beatId,'ink:beat:test-score/main/84.0');
  assert.equal(report.audio.live.endSample,value.live.samples.length/2);
  assert.equal(value.offline.samples.length,value.live.samples.length);
  const repeated=await R.compare(sources,timeline,early,options);
  assert.deepEqual(repeated.report,report);
  assert.deepEqual(repeated.value,value);
});

test('comparison retains duplicate cues, records selected sample assets and distinguishes voice budget drops',async()=>{
  const samples=new Float32Array(1024).fill(.1), wave={samples,channels:1,sampleRate:rate};
  const sampled={...sources.accent,patches:{bow:{type:'sample',zones:[{samples:['bright','soft']}]}}};
  const route={end:1.2,events:[
    {observedAt:.15,intent:{kind:'music-cue',time:.15,cue:'sample',resource:'strike'}},
    {observedAt:.4,intent:{kind:'music-cue',time:.4,cue:'drop',resource:'pcm'}},
    {observedAt:.4,intent:{kind:'music-cue',time:.4,cue:'drop',resource:'pcm'}},
    {observedAt:1.5,intent:{kind:'music-cue',time:.9,cue:'late',resource:'pcm'}}
  ]};
  const options={sampleRate:rate,traceLimit:1,maxVoices:1,reservedVoices:0,
    assets:{bright:wave,soft:wave},
    streams:{pcm:{frames:1024,channels:1,sampleRate:rate,foreground:true}},
    readPage:(_name,first,frames)=>samples.slice(first,first+frames)};
  const spec={...timeline,segments:{...timeline.segments,search:{...timeline.segments.search,layers:{lead:0}}}};
  const {report}=await R.compare({...sources,accent:sampled},spec,route,{live:options});
  assert.deepEqual(report.cues.map(row=>[row.input,row.live.status,row.offline.status]),
    [[0,'played','played'],[1,'played','played'],[2,'dropped','played'],[3,'not-arrived','played']]);
  assert.equal(report.cues[0].variantStatus,'same');
  assert.equal(report.cues[0].live.variants[0].assets.length,1);
  assert.deepEqual(report.cues[1].offline.variants[0].assets,['pcm']);
  assert.equal(report.cues[1].onsetDeltaSamples,0);
  assert.equal(report.cues[2].onsetDeltaSamples,null);
  assert.deepEqual(report.cues[2].live.misses,['voice-budget']);
  assert.equal(report.cues[3].arrivalSample,12000);
});

test('comparison measures interrupted base and factor ramps on the native mix and phase-aligned PCM stems',async()=>{
  const constant=new Float32Array(256).fill(.25);
  const segments={...timeline.segments,search:{...timeline.segments.search,layers:{lead:0}}};
  const events=[
    {observedAt:.25,intent:{kind:'music-layer',time:.125,part:'wind',gain:1,ramp:.25}},
    {observedAt:.375,intent:{kind:'music-layer',time:.375,part:'wind',factor:'cover',gain:.5,ramp:.25}},
    {observedAt:.4375,intent:{kind:'music-layer',time:.4375,part:'wind',gain:.5,ramp:.25}}
  ];
  const result=await R.compare(sources,{...timeline,segments},
    {end:1.00107,events,layerGains:{wind:0},layerFactors:{wind:{cover:1}}},
    {live:{sampleRate:rate,masterGain:0,traceLimit:1,
      streams:{gust:{frames:256,channels:1,sampleRate:rate}},
      readPage:(_name,first,frames)=>constant.slice(first,first+frames),
      stemGroups:{loop:{frames:256,parts:{wind:{stream:'gust'}}}}}});
  const {report,value}=result;
  assert.equal(report.endSample,8008);
  assert.deepEqual(report.layers.map(row=>[row.live.startSample,row.offline.startSample]),
    [[2000,1000],[3000,3000],[3500,3500]]);
  assert.equal(report.layers[2].live.from,.75);
  assert.equal(report.layers[2].offline.from,1);
  assert.deepEqual(report.layers[1].effectiveGains.at(-1),{sample:5000,live:.28125,offline:.3125,delta:-.03125});
  assert.equal(value.live.samples[3000],0);
  assert(value.offline.samples[3000]>.04);
  assert.equal(value.live.samples.at(-1),value.offline.samples.at(-1));
});

test('comparison CLI renders a native recording with paths that can be inspected by beat',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-audio-paths-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  const argv=[path.resolve(__dirname,'../cli/ink-studio.js')], cli=(...args)=>execFileSync(process.execPath,
    [...argv,...args],{cwd:dir,encoding:'utf8'});
  write('score.json',{sources,timeline,live:{options:{sampleRate:rate},traceOptions:{worldCues:{latch:'strike'}}}});
  write('world.run.json',log);
  write('capture.json',{id:'beat-audit'});
  cli('music','rehearsal','compare','score.json','world.run.json','--capture','capture.json','--out','pass');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'pass','comparison.json'),'utf8'));
  const beat='ink:beat:test-score/main/84.0';
  const inspection=JSON.parse(cli('beat',beat,'pass/comparison.json'));
  assert.equal(manifest.input.id,'beat-audit');
  assert.equal(inspection.matches[0].audioComparison.offline.sample,33600);
  assert(fs.existsSync(path.join(dir,'pass',manifest.files.live.audio)));
  assert(fs.existsSync(path.join(dir,'pass',manifest.files.offline.audio)));
  fs.linkSync(path.join(dir,'score.json'),path.join(dir,'pass','comparison.json.tmp'));
  fs.renameSync(path.join(dir,'pass','comparison.json.tmp'),path.join(dir,'pass','comparison.json'));
  assert.throws(()=>execFileSync(process.execPath,[...argv,'music','rehearsal','compare','score.json','world.run.json',
    '--out','pass'],{cwd:dir,stdio:'pipe'}),/separate from source files/);
});

test('comparison distinguishes substituted score accents from the original printed cue',async()=>{
  const scoring={cues:{hit:{accent:{resource:'alternate'}}}};
  const stingers={...timeline.stingers,alternate:'thread'};
  const route={end:1,events:[{observedAt:.125,intent:{kind:'music-cue',time:.125,cue:'hit',resource:'strike'}}]};
  const {report}=await R.compare(sources,{...timeline,scoring,stingers},route,{live:{sampleRate:rate}});
  const [cue]=report.cues;
  assert.equal(cue.onsetDeltaSamples,0);
  assert.equal(cue.variantStatus,'different');
  assert.equal(cue.live.variants[0].source,'tone');
  assert.equal(cue.offline.variants[0].source,'accent');
  assert.deepEqual(report.notices,['offline-does-not-run-live-scoring-rules']);
});
