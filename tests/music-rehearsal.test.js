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
  assert.deepEqual(early.worldEvents,[{cue:'latch',time:4.2}]);
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
