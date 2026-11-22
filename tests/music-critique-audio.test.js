const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, A=KIT.music.production, C=A.critique;
const WAV=require('../cli/wav'), rate=16000;
const sine={type:'graph',tail:.06,output:'out',nodes:{
  tone:{type:'oscillator',wave:'sine'},shape:{type:'envelope',env:{attack:.006,decay:.1,sustain:.85,release:.06}},
  out:{type:'gain',input:'tone',amount:{base:0,from:{shape:.62}}}
}};
const part=(id,rows,extra={})=>({patch:'sine',...extra,clips:[{id,beat:0,length:8,voices:[{id:'top',
  notes:rows.map(([beat,duration,midi,velocity],i)=>({id:'n'+i,beat,duration,midi,velocity}))}]}]});
function source() {
  return {seed:259,arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120,changes:[{beat:4,tempo:108}]},
    harmonies:{home:{root:'C4',quality:'unison'}},endFade:0},motifs:{},parts:{hook:{role:'lead'},keys:{role:'pad'},
    bass:{role:'bass'}},sections:[{id:'lead-in',bars:1,harmony:'home'},{id:'arrival',bars:1,harmony:'home'}]},
  patches:{sine},tracks:{
    hook:part('melody',[[2.4,.43,72,.52],[4.12,.39,76,.72],[4.75,.75,79,.78],[5.76,.60,76,.69]],{gain:-13,send:.18}),
    keys:part('figure',[[2.4,.43,64,.52],[4,.70,76,.78],[4.75,.75,79,.76],[5.76,.60,76,.82]],{gain:-8}),
    bass:part('pedal',[[2,.60,40,.61],[4.0,1.40,43,.58],[6,1.28,40,.60]],{gain:-16,send:.11})
  }};
}
const beat=n=>({beat:n});
const span=(from,to)=>({from:beat(from),to:beat(to)});
const configuration={range:span(4,6.65),context:{beforeBeats:1,afterBeats:.7},sampleRate:rate,lead:'hook'};
const near=(a,b,tol)=>assert(Math.abs(a-b)<tol,a+' vs '+b);
const sameSamples=(a,b)=>a.length===b.length && a.every((value,i)=>value===b[i]);

test('probe returns clock-aligned original mix, stem, mono and subtraction with lead-in and aftermath',()=>{
  const score=source(), before=A.render(score,{}, {sampleRate:rate,stems:true});
  const raw={...configuration,range:{from:{samples:32371},to:{seconds:{numerator:19,denominator:6}}},views:[
    {id:'mix',mode:'mix'},{id:'context',mode:'mix',span:'context'},{id:'keys',mode:'solo',tracks:['keys']},
    {id:'less',mode:'without',tracks:['keys']},{id:'mono',mode:'mono'}]};
  const desk=C.openAudio(score), {report,audio}=desk.inspect(raw);
  assert.equal(report.focus.firstSample,32371);
  assert.equal(report.focus.endSample,50666);
  assert(report.context.firstSample<report.focus.firstSample && report.context.endSample>report.focus.endSample);
  assert.equal(report.previewGain,1);
  const {firstSample,endSample}=report.focus;
  assert.deepEqual(audio.mix.samples,before.value.samples.slice(firstSample*2,endSample*2));
  assert.deepEqual(audio.keys.samples,before.stems.keys.samples.slice(firstSample*2,endSample*2));
  near(audio.less.samples[310],audio.mix.samples[310]-audio.keys.samples[310],1e-7);
  near(audio.mono.samples[201],(audio.mix.samples[402]+audio.mix.samples[403])*.5,1e-7);
  assert(report.notes.keys.some(({clip,voice,note})=>clip==='figure' && voice==='top' && note==='n2'));
  assert(report.issues.some(issue=>issue.kind==='band-overlap' && issue.track==='keys' && issue.suggestion.hz>=260));
  assert.deepEqual(desk.inspect(raw).audio.keys,audio.keys);
});

test('narrow EQ and addressed note trials keep unrelated audio and audition the actual editable revision',()=>{
  const score=source(), desk=C.openAudio(score), {report:probe}=desk.inspect(configuration);
  const evidence=probe.issues.find(issue=>issue.kind==='band-overlap' && issue.track==='keys');
  const edits=[{id:'band',label:'Local bell cut',edits:[{...evidence.suggestion,gainDb:-8}]},
    {id:'note',edits:[{op:'note',part:'keys',clip:'figure',voice:'top',note:'n2',set:{velocity:.34}}]},
    {id:'illegal',edits:[{op:'level',parts:['keys'],range:span(0,1),gainDb:-5}]}];
  const out=desk.compare({...configuration,candidates:edits,level:'fixed'});
  assert.deepEqual(out.report.takes.map(take=>take.id),['reference','band','note']);
  assert(out.report.blocked.some(row=>row.id==='illegal' && /context/.test(row.reason)));
  assert(out.report.takes[1].differenceRms>.001);
  assert(out.report.takes.every(row=>row.previewGainDb===out.report.takes[0].previewGainDb));
  const keep=(id,key=out.key)=>C.applyEdit(score,key,{token:key.token,take:id,reason:'The hook reads through the original bed.'});
  const kept=keep('band');
  const mix=A.render(kept.production,{}, {sampleRate:rate,stems:true});
  const original=A.render(score,{}, {sampleRate:rate,stems:true});
  assert.deepEqual(mix.stems.hook.samples,original.stems.hook.samples);
  const clock=A.compile(score).clock;
  const frame=beat=>Math.ceil(clock.timeAt({beat})*rate-1e-8);
  const firstSample=frame(evidence.range.fromBeat), endSample=frame(evidence.range.toBeat);
  assert(sameSamples(mix.stems.keys.samples.slice(0,firstSample*2),original.stems.keys.samples.slice(0,firstSample*2)));
  assert(sameSamples(mix.stems.keys.samples.slice(endSample*2),original.stems.keys.samples.slice(endSample*2)));
  assert.notDeepEqual(mix.stems.keys.samples.slice(firstSample*2,endSample*2),original.stems.keys.samples.slice(firstSample*2,endSample*2));
  const {context}=out.report;
  assert(sameSamples(out.audio.band.samples,mix.value.samples.slice(context.firstSample*2,context.endSample*2)));
  assert.equal(keep('note').production.tracks.keys.clips[0].voices[0].notes[2].velocity,.34);
  assert.equal(score.tracks.keys.clips[0].voices[0].notes[2].velocity,.76);
  assert.throws(()=>C.applyEdit({...score,gain:-1},out.key,{token:out.key.token,take:'band',reason:'Changed score'}),/original production/);
  const altered=structuredClone(out.key);
  altered.candidates[0].revision.cueMap.eq[0].gainDb=8;
  assert.throws(()=>keep('band',altered),/original production/);

  const matched=desk.compare({...configuration,candidates:edits.slice(0,2)});
  assert(matched.report.takes.every(row=>row.previewLufs===matched.report.takes[0].previewLufs));
  for (const pcm of Object.values(matched.audio)) near(A.loudness(pcm),matched.report.target,.01);
});

test('a comparison surfaces a protected lane while retaining valid independent alternatives',()=>{
  const score=source();
  score.arrangement.pins=['part:keys'];
  const out=C.openAudio(score).compare({...configuration,candidates:[
    {id:'locked',edits:[{op:'eq',parts:['keys'],hz:700,q:1,gainDb:-4}]},
    {id:'other',edits:[{op:'level',parts:['bass'],gainDb:-5}]}
  ]});
  assert(out.report.blocked.some(row=>row.id==='locked' && /pinned part keys/.test(row.reason)));
  assert.deepEqual(Object.keys(out.audio),['reference','other']);
});

test('CLI writes playable context and A/B, saves the choice, and reopens in production',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-audio-critique-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,
    [path.resolve(__dirname,'../cli/ink-studio.js'),'music',...args],{cwd:dir,encoding:'utf8'}));
  save('cue.json',{production:source(),options:{sampleRate:rate}});
  save('where.json',configuration);
  const request=cli('critique','inspect','cue.json','where.json','--out','inspect');
  assert(WAV.read(path.join(dir,'inspect',request.files.context)).samples.length>
    WAV.read(path.join(dir,'inspect',request.files.focus)).samples.length);
  save('edits.json',{...configuration,candidates:[{id:'trim',edits:[{op:'level',parts:['keys'],gainDb:-3}]}]});
  const comparison=cli('critique','compare','cue.json','edits.json','--out','compare');
  assert(!fs.readFileSync(path.join(dir,'compare',comparison.files.trim))
    .equals(fs.readFileSync(path.join(dir,'compare',comparison.files.reference))));
  save('keep.json',{token:comparison.token,take:'trim',reason:'Keep the harmony and make space for the entrance.'});
  const kept=cli('critique','apply','cue.json',comparison.key,'keep.json','--out','kept');
  assert.equal(JSON.parse(fs.readFileSync(kept.production)).production.cueMap.level[0].gainDb,-3);
  assert.equal(JSON.parse(fs.readFileSync(kept.reference)).reason,'Keep the harmony and make space for the entrance.');
  const print=cli('production','render',kept.production,'--out','print');
  assert.equal(WAV.read(print.mix).sampleRate,rate);
});

test('masking probes the real native desk and keeps a scoped edit without modifying the lead or routing',()=>{
  const production=source(), session={format:'ink-studio/music-edit-session',version:1,id:'masking',
    sampleRate:rate,production,pins:{hook:'pitch'},mixer:{output:'master',strips:{master:{},
      hook:{output:'lead-group'},'lead-group':{fader:.7}}}};
  const M=P.mediaGraph.musicSession.create(), studio=C.openAudio(session);
  const request={...configuration,test:{kind:'masking',track:'keys',duckDb:-9},level:'fixed'};
  const {report,audio,key}=studio.diagnose(request);
  assert.deepEqual(report.takes.map(take=>take.id),['reference','mute-rival','move-register','duck-rival']);
  assert.deepEqual(report.diagnosis.clips.map(({id})=>id),['previous','solo-anchor','solo-target']);
  assert(report.diagnosis.tests.every(test=>test.edits.every(({parts})=>parts.join()==='keys')));
  const {firstSample,endSample}=report.context;
  const at={from:{samples:firstSample},to:{samples:endSample}};
  assert.deepEqual(audio.reference.samples,M.render(session,at).value.samples);
  const kept=C.applyEdit(session,key,{token:key.token,take:'duck-rival',reason:'Make room for the lead attacks.'}).session;
  assert.deepEqual(audio['duck-rival'].samples,M.render(kept,at).value.samples);
  assert.deepEqual(kept.production.tracks.hook,session.production.tracks.hook);
  assert.deepEqual(kept.mixer,session.mixer);
  const locked=C.openAudio({...session,pins:{keys:'all'}}).diagnose(request);
  assert(locked.report.blocked.every(row=>/pins protect keys/.test(row.reason)));
  assert.equal(locked.report.takes.length,1);
  const withTake={...session,takes:{quiet:{tracks:{keys:{gain:-15}}}}};
  const comp=M.edit(withTake,[{op:'comp',lane:'keys',take:'quiet',...span(4,6)}]);
  assert.throws(()=>C.openAudio(comp).diagnose(request),/Active alternate take on keys/);
});

test('the diagnostic demo separates accent, scheduled timing, and audible sample lead-in',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-critique-diagnosis-'));
  try {
    execFileSync(process.execPath,[path.resolve(__dirname,'../examples/music-production/audio-critique-diagnosis.cjs'),dir]);
    const report=JSON.parse(fs.readFileSync(path.join(dir,'groove/report.json')));
    const [original,accent,timing,attack]=report.takes.map(row=>row.timing);
    assert(original.triggerGapMs>80 && original.target.triggerToAudioMs>60);
    assert.equal(accent.triggerGapMs,original.triggerGapMs);
    assert.equal(accent.audibleGapMs,original.audibleGapMs);
    assert(accent.target.velocity<original.target.velocity);
    assert.equal(timing.triggerGapMs,0);
    assert.equal(timing.target.triggerToAudioMs,original.target.triggerToAudioMs);
    assert.equal(attack.triggerGapMs,original.triggerGapMs);
    assert(attack.target.triggerToAudioMs<5);
    assert(report.diagnosis.clips.some(({id,range})=>id==='voice-target' &&
      range.firstSample===original.target.triggerSample));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
