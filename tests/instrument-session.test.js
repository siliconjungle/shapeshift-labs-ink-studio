const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, I=P.musicInstruments, S=P.mediaGraph.instrumentSession;
const WAV=require('../cli/wav');
const rate=8000, length=8000, offset=37;
function fixture() {
  const kinds=[
    [60,'soft','clear'],[60,'soft','clear'],[60,'firm','clear'],
    [67,'firm','clear'],[60,'firm','airy'],[60,'firm','airy']
  ];
  const pcm=(frames,channels)=>({sampleRate:rate,channels,samples:new Float64Array(frames*channels)});
  const close=pcm(length*kinds.length,1), room=pcm(length*kinds.length+offset,2);
  const takes=kinds.map(([key,dynamic,articulation],i)=>{
    const fromSample=length*i,toSample=length*(i+1), releaseSample=fromSample+5250;
    for (let n=0;n<length;n++) {
      const t=n/rate, age=Math.max(0,t-.014);
      const f=2*Math.PI*I.hz(key)*age, v=dynamic==='firm'?.51:.25;
      const held=Math.sin(f)+(articulation==='airy'?.35:.08)*Math.sin(f*3+i*.7);
      const tail=articulation==='airy' ? Math.sin(n*.81) : Math.sin(n*.49);
      const signal=Math.max(0,Math.min(1,age*42,(length-n-1)/90))*
        (n<5250 ? v*held : .18*tail*Math.exp(-(n-5250)/600));
      close.samples[fromSample+n]=signal;
      room.samples[(fromSample+n+offset)*2]=signal*.65;
      room.samples[(fromSample+n+offset)*2+1]=signal*.42;
    }
    return {id:'take-'+i,key,dynamic,articulation,fromSample,toSample,releaseSample};
  });
  return {assets:{close,room},session:{format:'ink-studio/instrument-session',version:1,id:'test-bank',sampleRate:rate,
    perspectives:{close:{asset:'close'},room:{asset:'room',offsetSamples:offset}},analyze:'close',
    registers:[60,67],range:[57,70],dynamics:[{id:'soft',velocity:.28},{id:'firm',velocity:.79}],
    articulations:['clear','airy'],takes}};
}
const build=options=>{const {session,assets}=fixture();return S.build(session,assets,options);};

test('proposals share the take clock, retain signed offsets, and can be accepted or overridden',()=>{
  const {session,assets}=fixture(), before=JSON.stringify(session), {value,report}=S.analyze(session,assets);
  const first=value.takes[0];
  assert.equal(JSON.stringify(session),before);
  assert(first.onsetSample>10 && first.attackEndSample>first.onsetSample);
  assert.deepEqual(report.takes[0].offsets.room,{asset:'room',fromSample:37,toSample:8037});
  assert(first.loop[0]>first.attackEndSample && first.loop[1]<first.releaseSample);
  assert.equal(first.releaseSample,5250);
  first.loop=null;
  first.releaseEndSample=6000;
  const next=S.analyze(value,assets);
  assert.equal(next.value.takes[0].loop,null);
  assert.equal(next.value.takes[0].releaseEndSample,6000);
  const list=S.auditionTakes(session,assets,{takes:[{take:'take-0'},{take:'take-0',perspective:'room'}]});
  assert.deepEqual(list.report.sources.map(row=>row.fromSample),[0,37]);
  const invalid=structuredClone(session);
  invalid.perspectives.room.offsetSamples=-1;
  assert.throws(()=>S.analyze(invalid,assets),/does not cover/);
  assert.throws(()=>S.analyze(session,{...assets,room:{...assets.room,sampleRate:16000}}),/shared sample rate/);
});

test('native builds flag coverage holes or borrow only within the requested articulation',()=>{
  const {value,assets,report}=build();
  const expected=value.coverage.find(row=>row.key===67 && row.dynamic==='soft' && row.articulation==='clear');
  assert.equal(expected.status,'borrowed');
  assert.match(expected.donor,/\.clear$/);
  assert.equal(Object.values(report.models).find(row=>row.alternates.includes('take-0')).attackSamples.length,2);
  const soft=report.models['key-60.soft.clear'], firm=report.models['key-60.firm.clear'];
  assert(firm.bodyRms>soft.bodyRms*1.5);
  assert.notDeepEqual(soft.fit.harmonics,firm.fit.harmonics);
  const a=I.zoneFor(value.patch.zones,60,.8,'clear'), b=I.zoneFor(value.patch.zones,60,.8,'airy');
  assert.notEqual(a.instrument,b.instrument);
  assert(!S.audition(value,assets).report.probes.some(row=>row.silent));
  const exact=build({fill:'none'}), review=S.audition(exact.value,exact.assets);
  assert(review.report.probes.some(row=>row.status==='missing' && row.silent));
  assert(review.report.probes.some(row=>row.status==='recorded' && !row.silent));
});

test('key-up and round robins follow the selected instrument cell through a native performance',()=>{
  const {value,assets}=build(), patch=P.musicGestures.patch(value.patch,assets), model=patch.performance;
  const make=(i,midi,articulation)=>({time:i,gate:.37,midi,frequency:I.hz(midi),velocity:.8,
    play:{articulation},salt:17});
  const notes=[make(0,60,'airy'),make(1,67,'clear'),make(2,60,'airy')];
  P.musicPhrasing.apply(model,notes,[],false);
  P.musicPhrasing.releases(notes);
  assert.deepEqual(notes.map(row=>row.roundRobin),[0,0,1]);
  assert.deepEqual(notes.map(row=>row.performance.release.roundRobin),[0,0,1]);
  const heard=(note,suppressRelease)=>{
    const player=patch.player.prepare({...note,suppressRelease},rate,note.gate);
    return Float64Array.from({length:Math.ceil(player.duration*rate)},(_,i)=>player.signal(i/rate,i,0));
  };
  const tail=heard(notes[0],false), cut=heard(notes[0],true);
  const gate=Math.round(notes[0].gate*rate);
  assert.deepEqual(tail.slice(0,gate),cut.slice(0,gate));
  assert(tail.slice(gate,gate+320).some((x,i)=>Math.abs(x-(cut[gate+i] ?? 0))>.004));
  const samples=heard(notes[2],false);
  assert.notDeepEqual(samples.slice(0,240),tail.slice(0,240));
  const room=build({perspective:'room',body:'recorded'});
  const cell=room.report.models['key-60.soft.clear'];
  assert.equal(cell.method,'looped-recording');
  const probe=S.audition(room.value,room.assets,{sampleRate:rate,cases:[
    {id:'held',key:60,velocity:.27,articulation:'clear',gate:1.3}]});
  assert(probe.value.samples.slice(rate*2,rate*2+80).some(x=>Math.abs(x)>.001));
  assert(probe.value.samples.some((x,i)=>i%2===1 && Math.abs(x-probe.value.samples[i-1])>.001));
});

test('native loop crossfade follows the end frame without replaying the overlap',()=>{
  const pcm={sampleRate:rate,channels:1,samples:Float64Array.from({length:600},(_,i)=>i<250 ? -.45 : .45)};
  const play=loopFade=>I.compile({type:'sample',zones:[{samples:['tone'],oneShot:false,loop:[.0125,.055],loopFade}]},
    {tone:pcm}).prepare({midi:60,frequency:I.hz(60),velocity:1,roundRobin:0,play:{}},rate,.2);
  const a=play(0), b=play(.005), signal=(body,frame)=>body.signal(frame/rate,frame,0);
  assert(Math.abs(signal(a,439)-signal(a,440))>.5);
  assert(Math.abs(signal(b,439)-signal(b,440))<.04);
  assert(signal(b,444)<-.3);
});

test('CLI saves relocated originals, editable instruments, and normal production recipes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-session-workshop-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {assets,session}=fixture();
  for (const [name,pcm] of Object.entries(assets)) fs.writeFileSync(path.join(dir,name+'.wav'),WAV.encode(pcm,{encoding:'float32'}));
  fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({session,assets:{close:'close.wav',room:'room.wav'}}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','instrument',...args],{cwd:dir,encoding:'utf8'}));
  const plan=run('analyze-session','session.json','--out','plan');
  const built=run('build-session',plan.session,'--out','build');
  const reviewed=run('audition-session',built.instrument,'--out','review');
  const recipe=JSON.parse(fs.readFileSync(reviewed.production,'utf8'));
  assert(Object.values(recipe.assets).every(file=>fs.existsSync(path.resolve(dir,'review',file))));
  assert.equal(recipe.production.patches.build.type,'zoned');
  assert(WAV.read(reviewed.audio).samples.some(x=>Math.abs(x)>.01));
});
