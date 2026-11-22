const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{KIT}=require('..').load(),WAV=require('../cli/wav.js');
const P=KIT.procedural,A=P.mediaGraph, lab=A.playableSound,rate=16000;
const breath=()=>A.synthesizeGesture({model:'breath',sampleRate:rate,duration:.82,seed:21,
  parameters:{pitchStart:226,pitchEnd:318,roughTail:.76,voice:.95}}).value;
const variants=[
  {id:'capture',family:'sample'},
  {id:'strike',family:'attack'},
  {id:'moving',family:'contour'},
  {id:'steady',family:'contour',motion:0},
  {id:'breath-tail',family:'handoff',tail:'breath',phase:.64},
  {id:'wire-tail',family:'handoff',tail:'wire',phase:.64}
];

test('all builds play the same addressed phrase and expose separate source-matching evidence',()=>{
  const {value,assets,report}=lab.build(breath(),{id:'bench',variants});
  assert(report.trackedPitchFrames>5);
  assert(report.fit.particulars.harmonics.length>0);
  const {root}=value, settings={pitches:[root-4,root],velocities:[.36,.85],sampleRate:rate};
  const audition=lab.audition(value,assets,settings);
  const {candidates,anchor,phaseMatches}=audition.report;
  assert.equal(candidates.length,variants.length);
  assert.equal(audition.report.cells.length,4);
  assert.equal(audition.report.reel.clips.length,7);
  const phrase=candidates[0].cells.find(row=>row.id===anchor.id).events;
  assert.deepEqual(phrase.map(row=>row.kind),['attack','attack','repeat','attack','legato','attack']);
  for (const row of candidates.slice(1)) {
    assert.deepEqual(row.cells.map(cell=>cell.events),candidates[0].cells.map(cell=>cell.events));
    assert.equal(audition.clips[row.id][anchor.id].samples.length,audition.clips.capture[anchor.id].samples.length);
  }
  const moving=candidates.find(row=>row.id==='moving'), steady=candidates.find(row=>row.id==='steady');
  assert(moving.pitchSpanCents>180);
  assert(steady.pitchSpanCents===null || steady.pitchSpanCents<moving.pitchSpanCents*.45);
  assert(moving.contourErrorCents!==null);
  assert(phaseMatches.some(row=>['attack','body','tail'].every(phase=>Number.isFinite(row.phases[phase]))));
  const compare=(first,second)=>{
    const a=audition.clips[first][anchor.id], b=audition.clips[second][anchor.id];
    return a.samples.some((sample,i)=>Math.abs(sample-b.samples[i])>.003);
  };
  assert(compare('strike','moving'));
  assert(compare('breath-tail','wire-tail'));
  const again=lab.audition(value,assets,{...settings,candidates:['moving']});
  assert.deepEqual(again.clips.moving[anchor.id].samples,audition.clips.moving[anchor.id].samples);
});

test('kept zones dispatch native patches at the velocity boundary and project a single new gesture',()=>{
  const {value,assets}=lab.build(breath(),{id:'bench',variants});
  const {root}=value, selection={candidate:'moving',trigger:{key:root,velocity:.84},
    projection:{beats:2.5,pitchStep:1.4},zones:[
      {id:'close',candidate:'strike',low:root-4,high:root+4,velocity:[0,.55]},
      {id:'open',candidate:'wire-tail',low:root-4,high:root+4,velocity:[.55,1]}
    ],fallback:'breath-tail'};
  const result=lab.keep(value,assets,selection);
  const {patch,motif}=result.value;
  assert.equal(patch.type,'zoned');
  assert.deepEqual(Object.keys(patch.instruments),['strike','wire-tail','breath-tail']);
  assert.deepEqual(Object.keys(result.assets),['fitted-attack']);
  assert.equal(result.report.from,'performed');
  assert(motif.motifs.contour.events.length>=2);
  assert(motif.motifs.attacks.events.length>=1);
  assert.equal(motif.motifs.tail.events.length,1);
  assert(motif.motifs.contour.events.every(row=>row.id.startsWith('pitch-')));
  assert.equal(result.report.profile.source.frames,result.reference.samples.length/result.reference.channels);
  function render(player,key,velocity) {
    const gate=.34, sound=player.prepare({midi:key,frequency:P.musicInstruments.hz(key),
      time:0,gate,velocity,play:{},salt:4,roundRobin:0},rate,gate);
    return Float64Array.from({length:8000},(_,i)=>sound.signal(i/rate,i,0));
  }
  const player=P.musicGestures.patch(patch,result.assets).player;
  for (const [key,velocity,name] of [[root,.54,'strike'],[root,.55,'wire-tail'],[root,1,'wire-tail'],[root-8,.65,'breath-tail']]) {
    const expected=P.musicInstruments.compile(value.candidates[name].patch,result.assets);
    assert.deepEqual(render(player,key,velocity),render(expected,key,velocity),name);
  }
  assert.throws(()=>lab.keep(value,assets,{...selection,zones:[selection.zones[0],
    {...selection.zones[1],velocity:[.54,1]}]}),/cannot overlap/);
});

test('unpitched gestures still project an attack motif',()=>{
  const samples=Float64Array.from({length:rate*.3},(_,i)=>P.musicInstruments.noise(i,49)*.4*
    (i<rate*.13 || i>rate*.19 ? 1 : .01));
  const {value,assets}=lab.build({sampleRate:rate,channels:1,samples},{variants:[{id:'sample',family:'sample'}]});
  const result=lab.keep(value,assets,{candidate:'sample',from:'source'});
  assert.equal(result.value.motif.motifs.contour,null);
  assert(result.value.motif.motifs.attacks.events.length>=1);
});

test('CLI keeps a portable source slice, auditions files and writes a native instrument and motif',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-playable-sound-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','instrument',...args],{cwd:dir,encoding:'utf8'}));
  fs.writeFileSync(path.join(dir,'breath.wav'),WAV.encode(breath(),{encoding:'float32'}));
  save('source.json',{source:{wav:'breath.wav',fromSample:400,toSample:11800},
    options:{variants:[{id:'capture',family:'sample'},{id:'air',family:'handoff'}]}});
  run('workshop','source.json','--out','bank');
  const bank=read('bank/workshop.json');
  assert.equal(bank.source.fromSample,400);
  assert.equal(bank.workshop.profile.source.frames,11400);
  save('audition.json',{pitches:[bank.workshop.root],velocities:[.84],sampleRate:rate});
  const {audio}=run('audition-workshop','bank/workshop.json','audition.json','--out','audition');
  assert(WAV.read(audio).samples.some(Boolean));
  const review=read('audition/report.json');
  assert(WAV.read(path.join(dir,'audition',review.takes.air[review.anchor.id])).samples.some(Boolean));
  save('selection.json',{candidate:'capture',from:'source'});
  run('keep-workshop','bank/workshop.json','selection.json','--out','kept');
  const kept=read('kept/instrument.json'), assets=Object.fromEntries(Object.entries(kept.assets).map(([name,file])=>
    [name,WAV.read(path.join(dir,'kept',file))]));
  assert(P.musicGestures.patch(kept.patch,assets).player);
  assert(read('kept/motif.json').motifs.attacks.events.length);
  save('procedural.json',{source:{gesture:{model:'metal',seed:4,duration:.32}},
    options:{variants:[{id:'capture',family:'sample'}]}});
  run('workshop','procedural.json','--out','procedural');
  assert.equal(read('procedural/workshop.json').source.gesture.model,'metal');
});
