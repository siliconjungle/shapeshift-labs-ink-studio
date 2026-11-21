const assert = require('node:assert/strict');
const { test } = require('node:test');
const studio = require('..');
const kit = studio.load(), { KIT: K } = kit, P = K.procedural;
const { compile, harmony } = K.music.score;
const WAV = require('../cli/wav.js');
const { createSceneAudio } = require('../cli/scene-audio.js');
const near = (a,b,tolerance=1e-8) => assert(Math.abs(a-b) <= tolerance, `${a} != ${b}`);
const json = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  tempoMap: { tempo: 120, swing: .625, barsPerPhrase: 2, changes: [{beat:8,tempo:96}] },
  duration: {bar:4}, tuning: 'just', endFade: .08,
  voices: [{id:'root',phase:.125,motion:{cyclesPerBar:2}}, {id:'middle',waveform:'triangle'},
    {id:'upper',waveform:'pulse',duty:.35,motion:{cyclesPerBar:2},rhythm:{length:2,hits:[
      {beat:.5,duration:1.25}
    ]}} ],
  harmonies: {
    home:{root:'C4',fade:0},
    turn:{root:'A3',quality:'minor',notes:['A4','C4','E4'],fade:.4},
    away:{root:'G3',voicing:{root:'B3',upper:'G4'}}
  },
  changes:[{time:0,harmony:'home'},{time:{bar:1},harmony:'turn'}],
  bindings:{
    angle:{voice:'root',from:'signal',range:[-2,2]},
    opacity:{voice:'upper',from:'level',range:[.25,1]},
    anchor:{voice:'middle',from:'pitch',colors:{E:'#6699ef'},fallback:'#101018'},
    light:{voice:'upper',from:'pitch',colors:{G:'#78b7fa',A:'#e59335'},fallback:'#101018'}
  }
});

test('scales author chords and quantize the same motion controls into discrete positions', () => {
  assert.deepEqual(harmony.scale('D4','dorian').notes,[62,64,65,67,69,71,72]);
  assert.deepEqual(harmony.scaleChord('C4','major',5,4),{root:67,quality:'dominant7',notes:[67,71,74,77]});
  assert.deepEqual(harmony.scaleChord('C4','major',6,3,1).notes,[72,76,81]);
  near(harmony.mapScale('majorPentatonic')(.61),7/12);
  near(harmony.mapScale([0,3,6,9],'ceil')(.6),.75);
  assert.equal(harmony.quantizePitch(61.4,'C4','dorian'),62);
  assert.equal(harmony.quantizePitch(61.4,'C4','dorian','floor'),60);
  assert.equal(harmony.quantizePitch(1,'F#4',[0]),6);
  assert.throws(() => harmony.scaleSteps([0,6,3]),/increasing/);
  const config = fixture();
  config.key = {root:'C4',mode:'major'};
  config.harmonies.home = {degree:1,fade:0};
  config.harmonies.turn = {degree:6,notes:['A4','C4','E4']};
  config.bindings.step = {voice:'root',from:'phase',scale:[0,3,6,9],range:[0,12]};
  config.bindings.ramp = {voice:'root',from:'phase',scale:[0,3,6,9],colors:[[0,'#426ada'],[1,'#f3a454']]};
  const frame = compile(config).sample(.47);
  assert.equal(frame.chord.key,'C4');
  assert.equal(frame.chord.degree,1);
  assert([0,3,6,9,12].includes(frame.bindings.step));
  assert.match(frame.bindings.ramp,/^#[\da-f]{6}$/);
  assert.equal(compile(config).sample(2).chord.quality,'minor');
});

test('interval recurrence and spectral roughness expose distinct bounded controls', () => {
  const exact = harmony.interval(220,330), close = harmony.interval(220,328);
  assert.deepEqual([exact.numerator,exact.denominator],[3,2]);
  near(exact.period,2/220);
  assert.equal(close.aligned,false);
  near(close.partialBeat,4);
  assert.equal(harmony.roughness([[[220,1]],[[220,1]]]),0);
  assert(harmony.roughness([[[220,1]],[[235,1]]]) > .6);
  const config = fixture();
  config.bindings.fracture = {from:'roughness',range:[0,4]};
  config.bindings.detail = {from:'roughness',pair:['upper','root'],range:[0,1]};
  const frame = compile(config).sample(.5);
  assert(frame.analysis.pairs.some(pair => pair.voices.includes('upper') && pair.aligned));
  assert(frame.analysis.roughness >= 0 && frame.analysis.roughness <= 1);
  near(frame.bindings.fracture,4*frame.analysis.roughness);
  near(frame.bindings.detail,frame.analysis.pairs.find(row => row.voices.join(',')==='root,upper').roughness);
});

test('just intervals drive matching audio and visual ratios and voice leading keeps shared pitches', () => {
  const score = compile(fixture()), begin = score.sample(.5), before = score.sample(2-1e-8), at = score.sample(2);
  near(begin.voices.upper.frequency/begin.voices.root.frequency,3/2);
  near(begin.voices.middle.frequency/begin.voices.root.frequency,5/4);
  near(begin.voices.upper.rate/begin.voices.root.rate,3/2);
  assert.equal(begin.voices.upper.level,1);
  assert.deepEqual(at.chord.voices.map(v => [v.id,v.note,v.retained]), [
    ['root','C4',true],['middle','E4',true],['upper','A4',false]
  ]);
  near(at.voices.middle.frequency,before.voices.middle.frequency);
  near(at.voices.middle.rate,before.voices.middle.rate);
  near(at.voices.middle.audioPhase,before.voices.middle.audioPhase,4e-6);
  near(at.voices.upper.audioPhase,before.voices.upper.audioPhase,5e-6);
  assert.equal(at.bindings.anchor,score.sample(2.6).bindings.anchor);
  assert.equal(at.bindings.light,'#78b7fa');
  assert.notEqual(score.sample(2.2).bindings.light,at.bindings.light);
  assert.equal(score.sample(2.6).bindings.light,'#e59335');
  assert.deepEqual(harmony.fifths('C','A'),{distance:3,steps:3,path:['C','G','D','A']});
  assert.deepEqual(harmony.fifths('C#','Db'),{distance:0,steps:0,path:['C#']});
});

test('audio carries the visual interval and the same oscillator phases close at independently chosen rates', () => {
  const score = compile({duration:3, voices:[
    {id:'root',pan:-1,gain:.5,phase:.1,motion:{cyclesPerBar:2}},
    {id:'fifth',pan:1,gain:.5,phase:.27,motion:{cyclesPerBar:2}}
  ],harmonies:{home:{root:'A3',quality:'fifth',tuning:'just',fade:0}},changes:[{time:0,harmony:'home'}]});
  const clip = score.audio({sampleRate:8000,start:.5,end:1.5}).value.samples;
  function power(hz,channel) {
    let x=0,y=0;
    for (let i=0;i<8000;i++) {
      const a=i*hz*2*Math.PI/8000, sample=clip[2*i+channel];
      x+=sample*Math.cos(a);
      y+=sample*Math.sin(a);
    }
    return Math.hypot(x,y);
  }
  assert(power(220,0)>1900 && power(330,1)>1900);
  assert(power(330,0)<1e-5 && power(220,1)<1e-5);
  const first=score.sample(.25), back=score.sample(2.25);
  for (const voice of ['root','fifth']) near(first.voices[voice].phase,back.voices[voice].phase);
});

test('swung note gates, voices, rests and interrupted palette fades are deterministic at a seek', () => {
  const config = fixture();
  const score = compile(config,{requests:[{time:2.2,harmony:'away',quantize:'none'}]});
  const baseline = compile(config);
  assert.equal(score.sample(.3).voices.upper.level,0);
  assert(score.sample(.37).voices.upper.level > 0);
  assert.equal(score.sample(2.2).bindings.light,baseline.sample(2.2).bindings.light);
  assert.equal(score.sample(2.4).voices.middle.level,0);
  assert.equal(score.sample(2.6).voices.middle.midi,null);
  assert.deepEqual(score.sample(2.31),score.sample(2.31));
  assert.deepEqual(score.schedule({time:1/60,harmony:'away'}),{time:2,beat:4,harmony:'away'});
  assert.deepEqual(score.schedule({time:2,harmony:'away',quantize:'phrase'}),{time:4,beat:8,harmony:'away'});
  assert.deepEqual(score.schedule({time:4.0001,harmony:'away',quantize:'bar'}),{time:6.5,beat:12,harmony:'away'});
  assert.throws(() => compile({...config,changes:[...config.changes,config.changes[0]]}),/Duplicate chord/);
  assert.throws(() => compile(config,{requests:[{time:0,harmony:'made-up'}]}),/harmony request/);
});

test('absolute PCM slices reproduce the same samples through pitch changes and rhythm gates', () => {
  const score = compile(fixture()), sampleRate=8000;
  const full = score.audio({sampleRate,end:3.1,stems:true});
  const clip = score.audio({sampleRate,start:1.94,end:3.1,stems:true}), first = clip.report.firstSample*2;
  assert.deepEqual(clip.value.samples,full.value.samples.slice(first));
  assert.deepEqual(clip.stems.upper.samples,full.stems.upper.samples.slice(first));
  assert.equal(full.stems.upper.samples[200*2],0);
  assert(full.stems.upper.samples.subarray(3000*2,5000*2).some(value => Math.abs(value) > .005));
  assert(full.report.peak > .03 && full.report.peak < 1);
});

test('graph score frames use the take clock and the same score renders a WAV buffer', () => {
  const definition = fixture();
  const session = P.graph.create({ nodes:{
    control:{op:'music.score',inputs:{score:definition}},
    route:{op:'data.get',inputs:{record:{node:'control',port:'bindings'},key:'angle'}},
    audio:{op:'music.scoreAudio',inputs:{score:definition,options:{sampleRate:8000,end:.25}}},
    circle:{op:'music.fifths',inputs:{from:'C',to:'F'}}
  },outputs:{score:{node:'control'},angle:{node:'route'},audio:{node:'audio'},circle:{node:'circle'}} });
  const take = K.timeDomains.take({fps:{numerator:30000,denominator:1001}}).at(63);
  const outs = session.evaluate({}, {take}).outputs;
  assert.equal(outs.score.chord.harmony,'turn');
  assert.equal(outs.angle,compile(definition).frame(take).bindings.angle);
  assert.equal(outs.audio.samples.length,4000);
  assert.deepEqual(outs.circle.path,['C','F']);
});

test('world event actions queue harmony on a bar and soundtrack export follows replayed requests', () => {
  const score = fixture();
  const world = {
    id:'replay-harmony',dt:1/60, systems:{score:{kind:'procedural-score',config:{score}}},
    timeline:{duration:6,events:[{id:'latch',kind:'latch-open',time:.5}]},
    eventActions:{light:{on:{kind:'latch-open',system:'world'},actions:[
      {action:'score/change',args:{harmony:'away',quantize:'bar'}}
    ]}}
  };
  const run = K.world.runtime.create(world);
  run.advance(50);
  const schedule = () => run.query().probe('score/schedule').value;
  assert.equal(schedule().requests.length,1);
  const checkpoint = json(run.checkpoint()), replay = K.world.runtime.create(world,{checkpoint});
  run.advance(150);
  replay.advance(150);
  assert.deepEqual(run.checkpoint(),replay.checkpoint());
  const cue = run.history.find(row => row.kind === 'music-chord' && row.harmony === 'away');
  assert.equal(cue.time,2);
  assert.equal(cue.beat,4);
  const sound = createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:8000,
    proceduralScore:{system:'score'}},{kit,resolveAsset:() => undefined,runtime:() => K.world.runtime.create(world)});
  const sequence = {startPoint:P.takeTime.read(1.9),endPoint:P.takeTime.read(2.2)};
  const rendered = sound.render(sequence);
  const expected = compile(score,{requests:schedule().requests}).audio({sampleRate:8000,start:1.9,end:2.2});
  assert.deepEqual(rendered.waves.music,WAV.encode(expected.value,{encoding:'pcm24'}));
});
