const {test}=require('node:test');
const assert=require('node:assert/strict');
const {KIT:K}=require('..').load();
const P=K.music.production;

function recipe() {
  return {
    arrangement:{
      score:{harmonies:{home:{root:'C4',quality:'unison'}},tempoMap:{tempo:120},endFade:0},
      motifs:{
        call:{length:4,events:[
          {beat:0,duration:.72,midi:60,velocity:.76},
          {beat:1,duration:.84,midi:67,velocity:.78},
          {beat:2,duration:1.15,midi:65,velocity:.84}
        ]}
      },
      parts:{lead:{role:'lead',material:'call'}},
      sections:[{id:'call',bars:1,harmony:'home'},{id:'rest',bars:1,parts:{lead:null}}]
    },
    patches:{bell:{
      type:'fm',index:1.8,env:{attack:.008,decay:.09,sustain:.55,release:.07},
      articulations:{muted:{index:.5,env:{release:.03}},ring:{index:3.5}},
      echo:{delay:.19,feedback:.45,wow:.25,width:.65},
      gestures:{bloom:{
        articulation:[[0,'muted'],[.25,'ring']],
        cutoff:[[0,450],[.38,3500],[.65,13500],[1,2200]],
        gate:[[0,.77],[.25,1.38],[1,1.28]], glide:[[0,0],[.5,.083]],
        legato:[[0,false],[.5,true]], echo:[[0,0],[.44,.08],[.66,.6],[1,.75]],
        pan:[[0,-.3],[1,.45]]
      }}
    }},
    tracks:{lead:{patch:'bell',gain:-12}},
    gain:-3
  };
}

const written=plan=>JSON.stringify(plan.score.voices.map(voice=>voice.sequence));
const shaped={gesture:'bloom',section:'call'};
const whole={sampleRate:8000,stems:true};

test('named phrase gestures shape notes and continuity while audition keeps the same written score',()=>{
  const source=recipe();
  const planned=P.planPerformances(source,[{id:'plain'},{id:'bloom',tracks:{lead:[shaped]}}]);
  assert.equal(planned.report.takes[1].parts.lead.connected,1);
  const variation=P.revise(source,planned.variants[1]);
  const regular=P.inspect(source), performed=P.inspect(variation);
  assert.equal(written(regular.arrangement),written(performed.arrangement));
  assert.deepEqual(regular.events.lead.map(note=>[note.midi,note.beat,note.time]),
    performed.events.lead.map(note=>[note.midi,note.beat,note.time]));
  assert.equal(performed.events.lead[0].play.articulation,'muted');
  assert.equal(performed.events.lead[1].play.articulation,'ring');
  assert.equal(performed.events.lead[2].connected,true);
  assert.equal(performed.events.lead[2].fromFrequency,performed.events.lead[1].frequency);
  assert.equal(performed.events.lead[1].gate,.5);
  assert(performed.events.lead[2].play.glide>.08);
  const takes=P.audition(source,planned.variants,{}, {sampleRate:8000}).takes;
  assert.equal(takes[0].report.lufs,takes[1].report.lufs);
  assert.notDeepEqual(takes[0].value.samples,takes[1].value.samples);
  assert.throws(()=>P.planPerformances({...source,arrangement:{...source.arrangement,pins:['part:lead']}},
    [{id:'held',tracks:{lead:[shaped]}}]),/pinned part/);
});

test('continuous gesture processing and tape feedback retain history in both trims and render tails',()=>{
  const source=recipe();
  source.tracks.lead.gestures=[shaped];
  const flat=recipe();
  const changed=P.render(source,{},whole), base=P.render(flat,{},whole);
  const trimmed=P.render(source,{}, {...whole,start:1.125,end:3.5});
  const crop=audio=>audio.samples.slice(18000,56000);
  assert.deepEqual(trimmed.value.samples,crop(changed.value));
  assert.deepEqual(trimmed.stems.lead.samples,crop(changed.stems.lead));
  assert.equal(base.stems.lead.samples.some((s,i)=>i>=40000 && Math.abs(s)>1e-5),false);
  assert(changed.stems.lead.samples.some((s,i)=>i>=40000 && Math.abs(s)>1e-5));
  const muted=P.render(source,{}, {...whole,layers:{lead:0}});
  assert.equal(muted.report.peak,0);
  const bounded=P.render(source,{}, {...whole,end:1.5,tail:.8});
  assert(bounded.stems.lead.samples.some((s,i)=>i>=28800 && Math.abs(s)>1e-5));
});

test('zero amounts preserve PCM and placements validate names, ranges, and overlap',()=>{
  const source=recipe(), unchanged=P.render(source,{},whole);
  source.tracks.lead.gestures=[{...shaped,amount:0}];
  assert.deepEqual(P.render(source,{},whole).value.samples,unchanged.value.samples);
  source.tracks.lead.gestures=[shaped,{...shaped,from:1}];
  assert.throws(()=>P.inspect(source),/overlap/);
  source.tracks.lead.gestures=[{gesture:'missing',section:'call'}];
  assert.throws(()=>P.inspect(source),/gesture from the track patch/);
  source.tracks.lead.gestures=[shaped];
  source.patches.bell.gestures.bloom.cutoff=[[.7,500],[.4,1000]];
  assert.throws(()=>P.inspect(source),/Invalid gesture point/);
});

test('a gesture can open a held note without adding another attack',()=>{
  const source=recipe(), patch=source.patches.bell;
  source.arrangement.motifs.call.events=[{beat:0,duration:3.5,midi:64,velocity:.85}];
  patch.gestures.bloom={gain:[[0,-24],[.3,-24],[.4,0],[1,0]],cutoff:[[0,300],[.4,8000]]};
  patch.env={attack:.009,decay:.06,sustain:.88,release:.13};
  source.tracks.lead.gestures=[shaped];
  const result=P.render(source,{},whole), samples=result.stems.lead.samples;
  const power=(start,end)=>samples.slice(start,end).reduce((sum,value)=>sum+value**2,0);
  assert.equal(P.inspect(source).events.lead.length,1);
  assert(power(16000,19200)>power(3200,6400)*50);
});

test('tine keys and a swept brush sound render as native instruments',()=>{
  const source=recipe();
  source.patches.bell={type:'keys',wear:.35,dust:.12};
  const keys=P.render(source,{},whole);
  assert(keys.report.peak>.01);
  source.arrangement.parts.lead.role='percussion';
  source.patches.bell={type:'drum',kind:'brush',decay:.32};
  const brush=P.render(source,{},whole);
  assert(brush.report.peak>.005);
  assert.notDeepEqual(brush.value.samples,keys.value.samples);
});
