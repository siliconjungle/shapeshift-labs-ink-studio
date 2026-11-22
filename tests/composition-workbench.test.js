const {test}=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load(), P=KIT.procedural, A=KIT.music.production, M=P.mediaGraph;
const rate=8000, b=beat=>({beat}), map={tempo:108,swing:.56};
const frac=(numerator,denominator)=>({numerator,denominator});
const pcm=(scale=1)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:1800},(_,i)=>
  scale*Math.sin(i*.48)*Math.exp(-i/600)*.4)});
const assets={wire:pcm(),other:pcm(.63)};
const voices={melody:{from:'call',pitches:[{degree:3},'A4']},
  octave:{from:'call',pitches:[{degree:3},'A4'],transpose:12}};
const foley={take:'main',takes:{main:{asset:'wire',sync:{sample:0}}}};
const pattern={id:'pattern',length:2,seed:289,steps:[
  {id:'pick',beat:frac(1,3),pad:'call',gate:.14,offset:-.021,velocity:.79,
    play:{sample:'other',tune:-150,pan:.24,sends:{room:.15}}},
  {id:'reply',beat:1.25,pad:'call',gate:.18,offset:.033},
  {id:'ring',beat:.6,pad:'open',velocity:.72},
  {id:'close',beat:.8,pad:'close',velocity:.64}
]};
const kit={id:'wire',pads:{
  wire:{articulations:{default:[{id:'main',takes:[{asset:'wire'},{asset:'other'}]}]}},
  open:{choke:'hat',articulations:{default:[{id:'open',takes:[{asset:'wire'}]}]}},
  close:{choke:'hat',articulations:{default:[{id:'close',takes:[{asset:'other'}]}]}}
},buses:{room:{}}};
const notes={
  id:'solo',beat:0,length:4,voices:[{id:'line',notes:[
    {id:'pickup',beat:.35,duration:.26,midi:62,velocity:.68},
    {id:'body',beat:1.24,duration:.38,midi:65,velocity:.72},
    {id:'end',beat:2.62,duration:.61,midi:69,velocity:.63}
  ]}]
};
const source=()=>({format:'ink-studio/music-edit-session',version:1,id:'latch',sampleRate:rate,
  production:{arrangement:{score:{tempoMap:map,key:{root:'D4',mode:'dorian'},harmonies:{d:{root:'D3',quality:'minor'}}},
    motifs:{theme:{length:2,events:[{id:'x',beat:.1,duration:.4,midi:62},{id:'y',beat:1,duration:.44,midi:65}]}},
    parts:{lead:{role:'lead'},keys:{role:'pad'},reed:{role:'lead'}},
    sections:[{id:'intro',bars:1,harmony:'d'},{id:'outro',bars:1,harmony:'d'}]},
    patches:{fm:{type:'fm',env:{attack:.008,decay:.23,sustain:.58,release:.48}}},
    tracks:{lead:{patch:'fm',gain:-18,clips:[notes]},keys:{patch:'fm',gain:-23},reed:{patch:'fm',gain:-19}}},
  editorial:{picture:{fps:24,shots:[{id:'one',frames:100}]}},
  mixer:{output:'master',peakPolicy:'error',tail:'cut',strips:{master:{}},taps:{lead:{strip:'lead'}}}
});
const routes={call:{pad:'wire'},open:{pad:'open'},close:{pad:'close'}};

test('one pad pattern preserves roles, articulation and identity and spots notes, samples and Foley on the same clock',()=>{
  const R=M.rhythmProjection, bindings={notes:voices,pads:routes,foley:{call:foley}};
  const settings={map,sampleRate:rate,startBeat:4,scale:{root:'D4',mode:'dorian'}};
  const played=R.project(pattern,bindings,settings);
  const grid=R.project(pattern,bindings,{...settings,timing:0});
  assert.deepEqual(grid.report.hits.map(({id,beat})=>[id,beat]),played.report.hits.map(({id,beat})=>[id,beat]));
  const alternate=R.project(pattern,bindings,{...settings,scale:{root:'D4',mode:'major'}});
  assert.deepEqual(alternate.report.hits,played.report.hits);
  assert.deepEqual(played.clip.voices.map(voice=>voice.notes.map(note=>note.midi)),[[65,69],[77,81]]);
  assert.deepEqual(alternate.clip.voices.map(voice=>voice.notes.map(note=>note.midi)),[[66,69],[78,81]]);
  const crossed=R.project({...pattern,steps:pattern.steps.map(step=>step.id==='pick' ? {...step,beat:1.65} : step)},
    bindings,settings);
  const pitches=clip=>Object.fromEntries(clip.voices[0].notes.map(note=>[note.id,note.midi]));
  assert.deepEqual(pitches(crossed.clip),pitches(played.clip));
  assert.notEqual(crossed.clip.voices[0].notes[0].id,played.clip.voices[0].notes[0].id);
  const {events,options}=played.pads.performance, rendered=M.sampleKit.render(kit,assets,events,options);
  assert.equal(rendered.report.events[0].layers[0].take,'other');
  assert.equal(rendered.report.events[0].play.tune,-150);
  assert.equal(rendered.report.events.find(row=>row.pad==='open').chokeAt,rendered.report.events.find(row=>row.pad==='close').at);
  const base=source(), E=M.musicSession.create(assets);
  const session=E.edit(base,[
    {op:'revise-score',revision:{tracks:{reed:{clips:[played.clip]}}}},
    {op:'audio-take',lane:'kit',take:'main',source:{kit,...played.pads}},
    {op:'audio-take',lane:'foley',take:'main',source:played.foley}
  ]);
  const hits=played.report.hits.filter(row=>row.logicalPad==='call');
  const trace=E.render(session).report.timeline;
  const proof=trace.lanes.reed[0].notes.filter(row=>row.address[2]==='melody');
  assert.deepEqual(proof.map(row=>row.fromSample),hits.map(row=>row.sample));
  assert.deepEqual(played.foley.clips.map(row=>row.spot.samples),hits.map(row=>row.sample));
  assert.deepEqual(rendered.report.events.filter(row=>row.pad==='wire').map(row=>row.at+played.pads.at.samples),
    hits.map(row=>row.sample));
  assert.deepEqual(trace.lanes.kit[0].clips[0].kitEvents.filter(row=>row.pad==='wire').map(row=>row.sessionSample),
    hits.map(row=>row.sample));
  const edited=E.edit(session,[{op:'pad-events',lane:'kit',take:'main',
    edits:[{op:'set',id:events[0].id,changes:{play:{tune:-700}}}]}]);
  assert.notDeepEqual(E.render(edited).value.samples,E.render(session).value.samples);
});

test('the workbench compares a planned cue, exact-note gesture and two independent rhythm dimensions',()=>{
  const E=M.musicSession.create(assets), session=source();
  const brief={preview:{from:b(0),to:b(7.7)},moves:[
    {id:'story',form:{theme:{themes:{theme:{motif:'theme',fragments:{hint:['x']}}},appearances:[
      {id:'hint',theme:'theme',section:'intro',beat:0,stage:'fragment',fragment:'hint',targets:[{part:'keys',transpose:-12}]},
      {id:'return',theme:'theme',section:'outro',beat:0,stage:'statement',targets:[{part:'reed'}]}
    ]},withhold:[{from:0,to:4,parts:['reed']}],ending:{at:7.3,mode:'cut'}}},
    {id:'touch',gesture:{lane:'lead',clip:'solo',voice:'line',notes:[
      {note:'body',play:{delay:-.018,attackFade:.1,breath:.68,releaseLimit:.035}}
    ]}},
    {id:'beat',rhythm:{pattern,written:{reply:1.5},settings:{startBeat:4},
      notes:{lane:'reed',voices},pads:{lane:'drums',take:'main',kit,routes},foley:{lane:'foley',take:'main',routes:{call:foley}}}}
  ]};
  session.pins={lead:'pitch'};
  const result=E.compose(session,brief);
  assert.deepEqual(Object.keys(result.clips),['reference','story','touch','beat-grid','beat-written','beat-timing','beat-both']);
  assert.equal(new Set(Object.values(result.clips).map(pcm=>pcm.samples.length)).size,1);
  const plan=id=>result.value.candidates.find(row=>row.id===id).evidence;
  assert.equal(plan('story').appearances[1].tracks[0].part,'reed');
  assert.deepEqual(plan('story').sections[0].after.theme.withheld,['y']);
  assert.equal(plan('story').ending.mode,'cut');
  const base=A.compile(session.production).events.lead;
  const varied=A.compile(result.sessions.touch.production).events.lead;
  assert.deepEqual(varied.map(({beat,midi})=>[beat,midi]),base.map(({beat,midi})=>[beat,midi]));
  assert.equal(varied[1].play.releaseLimit,.035);
  assert.notEqual(varied[1].time,base[1].time);
  assert(varied[1].play.attackFade>.08);
  const beforeRelease=E.trace(session).lanes.lead[0].notes.find(row=>row.address[3]==='body');
  const afterRelease=E.trace(result.sessions.touch).lanes.lead[0].notes.find(row=>row.address[3]==='body');
  assert(afterRelease.toSample-afterRelease.releaseSample<beforeRelease.toSample-beforeRelease.releaseSample);
  const off=id=>plan(id).hits.map(({id,offset})=>[id,offset]).sort();
  const grid=id=>plan(id).hits.map(({id,beat})=>[id,beat]).sort();
  assert.deepEqual(off('beat-timing'),off('beat-both'));
  assert.deepEqual(off('beat-grid'),off('beat-written'));
  assert.deepEqual(grid('beat-grid'),grid('beat-timing'));
  assert.deepEqual(grid('beat-written'),grid('beat-both'));
  assert.notDeepEqual(grid('beat-written'),grid('beat-grid'));
  assert.notDeepEqual(result.clips['beat-grid'].samples,result.clips['beat-timing'].samples);
  assert.throws(()=>E.edit({...session,pins:{lead:'all'}},result.value.candidates.find(row=>row.id==='touch').edits),/pinned/);
  const voice=result.value.candidates.find(row=>row.id==='beat-timing');
  assert.deepEqual(E.edit(session,voice.edits),result.sessions['beat-timing']);
});
