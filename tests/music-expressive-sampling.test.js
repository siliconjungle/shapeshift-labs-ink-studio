const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const {KIT}=ink.load(), P=KIT.procedural;
const {production,row}=require('../examples/native-sound-library/performances.cjs');
const rate=16000;

function voice(patch,assets,settings={}) {
  const {performance,...instrument}=patch, midi=settings.midi ?? 64, gate=settings.gate ?? 2.6;
  const note={midi,frequency:440*2**((midi-69)/12),velocity:settings.velocity ?? .7,play:settings.play ?? {},
    roundRobin:settings.alternate ?? 0,salt:432};
  const body=P.musicInstruments.compile(instrument,assets).prepare(note,rate,gate);
  return Array.from({length:rate*2},(_,frame)=>{
    const age=frame/rate;
    const left=body.signal(age,frame,0), right=body.stereo ? body.signal(age,frame,1) : left;
    return [left,right];
  });
}

function harmonics(signal,start,end,midi) {
  const frequency=440*2**((midi-69)/12), n=Math.round((end-start)*rate);
  let cosine=0,sine=0;
  for (let i=0;i<n;i++) {
    const tone=signal[Math.round(start*rate)+i][0], phase=2*Math.PI*i*frequency/rate;
    cosine+=tone*Math.cos(phase);
    sine+=tone*Math.sin(phase);
  }
  return 2*Math.hypot(sine,cosine)/n;
}

const rms=(signal,from,to)=>{
  const span=signal.slice(from*rate,to*rate);
  return Math.sqrt(span.reduce((sum,[a,b])=>sum+a*a+b*b,0)/(span.length*2));
};

test('reed goes from breath to fundamental smoothly on the same held sample clock',()=>{
  const {patches,assets}=ink.loadSoundPack('breath-and-reed'), patch=patches['expressive-reed'];
  const air=voice(patch,assets,{play:{pressure:.04,breath:.25}});
  const swell=voice(patch,assets,{play:{breath:.25,curves:{pressure:[[0,.04],[.2,.04],[.5,.95],[1,.95]]}},gate:2.0});
  assert.ok(rms(air,.25,.42)>.003);
  assert.deepEqual(swell.slice(2500,5000),air.slice(2500,5000));
  assert.ok(harmonics(swell,1.15,1.32,64)>harmonics(air,1.15,1.32,64)*8);
  const held=voice(patch,assets,{play:{pressure:.95,breath:.25},gate:2.0});
  assert.ok(swell.slice(rate,1.6*rate).every(([x],i)=>Math.abs(x-held[i+rate][0])<1e-12),
    'The pitched layer stays on the original clock while pressure changes');
});

test('recorded bridges match specific destinations and bare takes retain the same written attacks',()=>{
  const {patches,assets}=ink.loadSoundPack('breath-and-reed'), name='expressive-reed', patch=patches[name];
  const notes=[row(.3,67,.62,.72,{pressure:.8}),row(.945,72,.79,.7,{pressure:.8}),
    row(1.757,76,.8,.7,{pressure:.8}),row(2.58,74,.63,.7,{pressure:.8})];
  const cue=production(patches,{reed:{patch:name,notes}},1);
  const {KIT}=ink.load(), music=KIT.music.production;
  const empty={...cue,patches:{[name]:{...patch,performance:{...patch.performance,rules:[]}}}};
  const played=music.inspect(cue,assets).events.reed;
  assert.deepEqual(played.map(note=>note.play.articulation),[undefined,'slur-g4-c5','slur-c5-e5',undefined]);
  assert.equal(played[3].performance.kind,'attack');
  assert.equal(played[1].performance.attackLead,.054);
  assert.equal(played[2].performance.attackLead,.065);
  assert.deepEqual(played.map(note=>note.time),music.inspect(empty,assets).events.reed.map(note=>note.time));
  const a=music.render(cue,assets,{sampleRate:rate}).value.samples;
  const b=music.render(empty,assets,{sampleRate:rate}).value.samples;
  assert.deepEqual(a.slice(0,.35*rate*2),b.slice(0,.35*rate*2));
  assert.ok(a.slice(.54*rate*2,.74*rate*2).some((sample,i)=>Math.abs(sample-b[i+.54*rate*2])>.01));

  const playedCapture=structuredClone(cue);
  playedCapture.tracks.reed.clips[0].timing='played';
  const capture=music.inspect(playedCapture,assets).events.reed;
  assert.deepEqual(capture.map(note=>note.time),played.map(note=>note.time));
  assert.ok(capture[1].performance.recorded);
});

test('plate pressure layers have different decays and mic mixes preserve both stereo endpoints',()=>{
  const {patches,assets}=ink.loadSoundPack('struck-and-scraped-metal'), patch=patches['expressive-plate'];
  const play=(velocity,room,alternate=0)=>voice(patch,assets,{velocity,alternate,midi:54,play:{room}});
  const quiet=play(.24,0), hard=play(.84,0);
  const decay=frames=>rms(frames,.42,.63)/rms(frames,.025,.13);
  assert.ok(Math.abs(20*Math.log10(decay(quiet)/decay(hard)))>1.5,'Different touch changes the decay profile');
  const near=play(.65,0), far=play(.65,1), center=play(.65,.5);
  assert.ok(far.some(([l,r])=>Math.abs(l-r)>.005),'Room capture is stereo');
  assert.ok(far.some(([l],i)=>Math.abs(l-near[i][0])>.005));
  const maxError=center.reduce((max,[l,r],i)=>Math.max(max,
    Math.abs(l-(near[i][0]+far[i][0])*Math.SQRT1_2),Math.abs(r-(near[i][1]+far[i][1])*Math.SQRT1_2)),0);
  assert.ok(maxError<1e-9,'Matched mic and round-robin clocks support exact equal-power summing');
  assert.notDeepEqual(play(.65,.5,1).slice(200,900),center.slice(200,900));
});
