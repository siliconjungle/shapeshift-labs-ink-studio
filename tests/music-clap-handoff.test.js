const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), {musicProduction:A,mediaGraph:M}=KIT.procedural;
const Midi=require('../cli/handoff-midi.js'), WAV=require('../cli/wav.js');
const rate=8000, timing={tempo:120,swing:.6,changes:[{beat:2,tempo:150}]};
const clip=(a=65,b=65)=>[{id:'line',beat:0,length:4,voices:[
  {id:'call',notes:[{id:'slide',midi:a,beat:.5,duration:1,velocity:.8,
    play:{curves:{pressure:[[0,.25],[.5,.75]],pitchCents:[[0,-125],[1,140]]}}}]},
  {id:'answer',notes:[{id:'hit',midi:b,beat:.75,duration:.375,velocity:.5,play:{pressure:.2}}]},
  {id:'late',notes:[{id:'end',midi:76,beat:2.5,duration:.5,velocity:.6}]}
]}];
const parameters={17:{unit:'beats',curve:'hold',points:[{at:0,value:.3},{at:2,value:.65}]}};
const source=()=>({arrangement:{score:{key:{root:'C4'},tempoMap:timing,endFade:0,
  harmonies:{home:{root:'C3',quality:'unison'}}},motifs:{},parts:{reed:{role:'lead'}},
  sections:[{id:'open',bars:1,harmony:'home'}]},tracks:{reed:{patch:'reed',clips:clip(),send:.4}},
  patches:{reed:{type:'clap',plugin:'glass',identity:'expected',parameters}}});

function fake(override={}) {
  const jobs=[];
  const host={adapters:{clap:{
    describe:request=>{
      assert.equal(request.kind,'instrument');
      assert.equal(request.initial['17'],.3);
      return {latency:11,tail:800,sidechain:false,notes:'clap',identity:'expected',
        parameters:{17:{min:0,max:1,automatable:true,stepped:false}},...override};
    },
    render:request=>{
      jobs.push(request);
      const result=new Float64Array(request.frames*2);
      for (const event of request.notes) if (event.type===-3) result.fill(.2,2*event.sample,2*event.sample+2);
      return result;
    }
  }}};
  return {host,jobs};
}

test('CLAP patches sequence performed unisons with independent pitch and pressure on the render sample grid',()=>{
  const p=source(), {host,jobs}=fake();
  const result=A.render(p,{}, {sampleRate:rate,start:.4,end:1.6,stems:true,tail:.2},host);
  assert.equal(result.report.instruments.reed.latencySamples,11);
  const job=jobs[0];
  const performed=A.inspect(p).events.reed;
  assert.equal(job.notes[0].sample,Math.ceil(performed[0].time*rate-1e-7));
  assert.deepEqual(job.notes.filter(row=>row.type===-3).slice(0,2).map(({id,key})=>[id,key]),[[0,65],[1,65]]);
  assert.deepEqual(job.notes.filter(row=>row.type===6 && row.id===1).map(row=>row.value),[.2]);
  assert(job.notes.some(row=>row.type===2 && row.id===0 && row.value< -1));
  assert(job.notes.some(row=>row.type===6 && row.id===0 && row.value===.75));
  assert.equal(job.parameters['17'].points[1].sample,rate);
  assert.deepEqual(job.transport,{meter:4,changes:[{sample:0,beat:0,tempo:120},{sample:8000,beat:2,tempo:150}]});
  assert.equal(job.frames,Math.floor(1.8*rate));
  assert.equal(job.input,undefined);
  assert(job.notes.every((row,i)=>i===0 || row.sample>=job.notes[i-1].sample));
  assert.throws(()=>A.render(p,{}, {sampleRate:rate}),/registered audio adapter/);
  assert.throws(()=>A.render(p,{}, {sampleRate:rate},fake({identity:'wrong'}).host),/identity differs/);
  assert.throws(()=>A.render(p,{}, {sampleRate:rate},fake({notes:'midi'}).host),/CLAP note input/);
});

function editSession(production) {
  return {format:'ink-studio/music-edit-session',version:1,id:'glass-bench',sampleRate:rate,production,
    takes:{alternate:{tracks:{reed:{clips:clip(61,63)}}}},comp:[{lane:'reed',from:{samples:3500},to:{samples:4400},take:'alternate'}],
    mixer:{output:'master',strips:{master:{},reed:{output:'group',sends:{return:{tap:'pre',level:.2}}},return:{},group:{}}},
    automation:{move:{target:{strip:'reed',parameter:'fader'},unit:'samples',curve:'hold',
      points:[{id:'first',at:0,value:.5},{id:'other',at:5000,value:1}]}}};
}

test('handoff keeps the active comp, source timing, MPE, desk automation and aligned audio',()=>{
  const p=source(), {host}=fake(), session=editSession(p), desk=M.musicSession.create({},host);
  const {value,stems,plan}=desk.handoff(session);
  assert.deepEqual(value.samples,desk.render(session).value.samples);
  const alt=plan.tracks.reed.notes.find(row=>row.take==='alternate' && row.midi===61);
  assert.deepEqual([alt.startSample,alt.endSample,alt.address],[3500,4400,['reed','line','call','slide',0]]);
  assert(alt.performedStartSample<alt.startSample && alt.performedEndSample>alt.endSample);
  assert(alt.expression.every(event=>event.sample>=3500 && event.sample<4400));
  assert.deepEqual(plan.routing.strips.reed.fader,{curve:'hold',points:[{sample:0,value:.5},{sample:5000,value:1}]});
  assert(plan.routing.routes.some(route=>route.from==='reed' && route.to==='return' && route.tap==='pre' && route.level.points[0].value===.2));
  assert(stems['score-room'].samples.some(Boolean));
  assert(Object.values(stems).every(stem=>stem.samples.length===value.samples.length));
  const midi=Midi.compile(plan), raw=Midi.encode(plan,midi);
  const parsed=require('../cli/midi-notes.js').decode(raw,{performance:true});
  assert(parsed.notes.some(note=>note.pitch===61));
  assert(parsed.channelEvents.some(event=>event.type===14));
  assert.equal(midi.tick(2400),576);
  assert.equal(parsed.tempos.length,2);
  assert.equal(midi.notices.length,0);
});

test('the CLI publishes a self-contained edit session, REAPER project and WAVs',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-handoff-test-'));
  try {
    const p=source();
    p.patches.reed={type:'subtractive'};
    const session=editSession(p), recipe=path.join(tmp,'session.json'), out=path.join(tmp,'out');
    session.mixer.processors={keyed:{type:'compressor',thresholdDb:-24}};
    session.mixer.strips.group.inserts=[{processor:'keyed',sidechain:{strip:'air',tap:'input'}}];
    session.audio={air:{take:'live',takes:{live:{asset:'sound',at:{samples:100}}}}};
    fs.writeFileSync(path.join(tmp,'source.wav'),WAV.encode({sampleRate:rate,channels:1,
      samples:Float64Array.from({length:200},(_,i)=>i===1 ? .4 : 0)},{encoding:'pcm24'}));
    fs.writeFileSync(recipe,JSON.stringify({session,assets:{sound:'source.wav'}}));
    const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music','session',...args],
      {encoding:'utf8'}));
    const files=cli('handoff',recipe,'--out',out), manifest=JSON.parse(fs.readFileSync(files.manifest));
    const rpp=fs.readFileSync(files.project,'utf8');
    assert.match(rpp,/<SOURCE MIDI\s+HASDATA 1 960 QN/);
    assert.match(rpp,/<VOLENV2[\s\S]*?PT 0\.625 1 1/);
    assert.match(rpp,/AUXRECV \d+ 3 0\.2/);
    assert.match(rpp,/NCHAN 4[\s\S]+?AUXRECV \d+ 1 1 0 0 0 0 0 2 -1:U 31/);
    assert.match(rpp,/FILE "audio\/stems\/reed.wav"/);
    assert(manifest.midi.mpeTracks.includes('reed'));
    assert.equal(manifest.files.ink,'ink/session.json');
    assert.deepEqual(fs.readFileSync(path.join(out,'ink/assets/sound.wav')),fs.readFileSync(path.join(tmp,'source.wav')));
    const replay=cli('render',files.session,'--out',path.join(tmp,'replay'));
    const emitted=WAV.read(files.master).samples, expected=WAV.read(replay.mix).samples;
    assert.equal(emitted.length,expected.length);
    assert(emitted.every((x,i)=>Math.abs(x-expected[i])<2e-7));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('native worker renders a CLAP instrument and preserves the old effect contract',{skip:!process.env.INK_CLAP_TEST_SDK},()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-native-clap-'));
  const repo=path.resolve(__dirname,'..');
  const sdk=process.env.INK_CLAP_TEST_SDK;
  const cxx=(source,destination,flags=[])=>execFileSync(process.env.CXX ?? 'c++',['-std=c++17','-O2','-I',path.join(sdk,'include'),
    ...flags,path.resolve(repo,source),'-o',path.join(tmp,destination),...(process.platform==='linux' && !flags.length ? ['-ldl'] : [])]);
  try {
    cxx('scripts/clap-host.cpp','worker');
    cxx('examples/clap-instrument/glass-reed.cpp','Glass.clap',['-shared','-fPIC']);
    cxx('examples/audio-racks/clap-fixture.cpp','Relay.clap',['-shared','-fPIC']);
    const file=path.join(tmp,'manifest.json');
    fs.writeFileSync(file,JSON.stringify({worker:'worker',plugins:{
      glass:{file:'Glass.clap',id:'org.ink.glass-reed'},
      aux:{file:'Glass.clap',id:'org.ink.glass-reed-aux'},
      midi:{file:'Glass.clap',id:'org.ink.glass-reed-midi'},relay:{file:'Relay.clap',id:'org.ink.rack-fixture'}
    }}));
    const {load}=require('../cli/clap-adapter.js'), host=load(file);
    const probe=host.inspect('glass',{kind:'instrument',sampleRate:rate});
    assert.equal(probe.notes,'clap');
    assert.equal(probe.latency,11);
    assert.equal(host.inspect('midi',{kind:'instrument',sampleRate:rate}).notes,'midi');
    const p=source(), saved=host.snapshot('glass',{kind:'instrument',sampleRate:rate,parameters:{17:.74}});
    p.patches.reed={type:'clap',...saved};
    const run=()=>A.render(p,{}, {sampleRate:rate,stems:true,tail:.4},host);
    const a=run(), first=Math.ceil(A.inspect(p).events.reed[0].time*rate-1e-7)*2;
    assert(a.stems.reed.samples.slice(0,first).every(x=>x===0));
    assert(a.stems.reed.samples[first]!==0);
    assert.deepEqual(run(),a);
    for (const {notes} of p.tracks.reed.clips[0].voices) for (const note of notes) delete note.play;
    const neutral=run(), elapsed=neutral.stems.reed.samples;
    assert(neutral.stems.reed.samples.some((x,i)=>Math.abs(x-a.stems.reed.samples[i])>.005));
    p.patches.reed={type:'clap',plugin:'midi'};
    p.tracks.reed.clips[0].voices[1].notes[0].midi=64;
    assert(A.render(p,{}, {sampleRate:rate},host).value.samples.some(Boolean));
    assert(elapsed.some(Boolean));
    const preset=path.join(tmp,'color.txt');
    fs.writeFileSync(preset,'0.81');
    const presetSaved=host.snapshot('aux',{kind:'instrument',sampleRate:rate,preset});
    assert.equal(Buffer.from(presetSaved.state,'base64').readDoubleLE(),.81);
    assert.throws(()=>host.snapshot('aux',{kind:'instrument',preset,state:presetSaved.state}),/either state or a preset/);
    p.patches.reed={type:'clap',...presetSaved};
    const aux=A.render(p,{},{sampleRate:rate,stems:true},host);
    assert(aux.stems.reed.samples.some(Boolean));
    assert(aux.stems.reed.samples.every(x=>Math.abs(x)<.75));
    const backing={sampleRate:rate,channels:1,samples:Float32Array.from({length:rate*2},(_,i)=>.04*Math.sin(i*.12))};
    fs.writeFileSync(path.join(tmp,'bed.wav'),WAV.encode(backing));
    const suite=path.join(tmp,'suite.json'), output=path.join(tmp,'bench');
    const baseline=source();
    baseline.patches.reed={type:'subtractive'};
    fs.writeFileSync(suite,JSON.stringify({format:'ink-studio/instrument-benchmark',version:1,reference:'Fixture',cases:[{
      id:'fixture',title:'Playable tone',production:baseline,preset:'color.txt',reference:{type:'clap',plugin:'aux'},
      mixer:{id:'fixed-bed',sampleRate:rate,output:'out',end:{seconds:2},tail:'cut',strips:{
        out:{clips:[{id:'voice',source:'instrument'},{id:'backing',source:'bed'}]}}},
      assets:{bed:'bed.wav'}
    }]}));
    const cli=path.join(repo,'cli/ink-studio.js');
    const runSuite=(...args)=>execFileSync(process.execPath,[cli,'music','production','instrument-benchmark',suite,
      '--clap-host',file,'--out',output,...args],{encoding:'utf8'});
    runSuite('--case','fixture');
    const result=JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8')).cases[0];
    assert.equal(result.notes,3);
    assert.equal(result.referenceInstrument.latencySamples,11);
    assert(Math.abs(result.context.native.integratedLufs-result.context.reference.integratedLufs)<.1);
    assert(WAV.read(path.join(output,result.audio.context.reference)).samples.some(Boolean));
    const performance=require('../cli/midi-notes.js').decode(fs.readFileSync(path.join(output,'fixture','performance.mid')));
    assert(performance.notes.some(note=>note.pitch===65));
    execFileSync(process.execPath,[path.join(repo,'examples/audio-racks/clap-smoke.cjs'),file,'relay']);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
