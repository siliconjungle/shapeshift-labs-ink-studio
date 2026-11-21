const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('..').load().KIT.music.production;
const source={
  arrangement:{
    score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:120,changes:[{beat:4,tempo:100}]},harmonies:{
      drift:{root:'G2',quality:'minor7',notes:[43,58,62,65]},
      home:{root:'D3',quality:'minor',notes:[38,62,65]}
    }},
    motifs:{
      walk:{length:4,events:[{beat:0,duration:1.2,degree:1},{beat:2,duration:1.4,degree:1}]},
      hook:{length:4,events:[{beat:0,duration:.61,midi:65},{beat:1,duration:.48,midi:69}]}
    },
    parts:{bass:{role:'bass',material:'walk'},lead:{role:'lead',material:'hook'},
      glass:{role:'lead'},drum:{role:'percussion'}},
    sections:[{id:'drift',bars:1,harmony:'drift'},{id:'return',bars:1,harmony:'home'}]
  },
  patches:{pluck:{type:'fm'},brush:{type:'drum',kind:'brush'}},
  tracks:{bass:{patch:'pluck',gain:-17},lead:{patch:'pluck',gain:-18,send:.35},
    glass:{patch:'pluck',gain:-20},drum:{patch:'brush',gain:-17}}
};
const brief={section:'return',goal:'Bring the theme forward at the return.',lead:'lead',layer:'glass'};
const drum={id:'strike',summary:'Play a brush on the downbeat.',revision:{edits:[{
  section:'return',part:'drum',scope:'section',adopt:{length:4,events:[{beat:0,duration:.2}]}
}]}};
const schedule={sampleRate:8000,start:{bar:0},end:{bar:2},focus:[
  {id:'arrival',start:{bar:1},end:{bar:1,beat:2}},
  {id:'glass',start:{bar:1},end:{bar:1,beat:2},tracks:['glass']}
]};

test('producer takes offer distinct score and ensemble decisions, with aligned context and solos',()=>{
  const session=A.planProducer(source,brief);
  assert.deepEqual(session.takes.map(take=>take.id),['reference','harmony','orchestration'],JSON.stringify(session.blocked));
  assert.deepEqual(A.planProducer(source,brief),session);
  const {takes,report}=A.reviewProducer(source,JSON.parse(JSON.stringify(session)),{},schedule);
  const [original,cadence,orchestra]=takes;
  assert.deepEqual(orchestra.evidence.context.harmony,original.evidence.context.harmony);
  assert.equal(orchestra.evidence.focus.glass.attacks.glass,2);
  assert.equal(cadence.evidence.context.attacks.glass,0);
  assert.deepEqual(cadence.evidence.context.harmony.map(row=>[row.root,row.beat]),[['G2',0],['A2',2],['D3',4]]);
  assert(report.takes.every(row=>row.lufs===report.takes[0].lufs));
  const range=report.focus[0];
  assert.equal(range.firstSample,16000);
  assert.deepEqual(orchestra.focus.arrival.samples,orchestra.value.samples.slice(range.firstSample*2,range.endSample*2));
  assert(original.focus.glass.samples.every(value=>value===0));
  assert(orchestra.focus.glass.samples.some(value=>Math.abs(value)>.001));
  assert.notDeepEqual(original.value.samples,cadence.value.samples);
  const pinned=structuredClone(source);
  pinned.arrangement.pins=['part:bass','part:glass'];
  const guarded=A.planProducer(pinned,brief);
  assert.deepEqual(guarded.takes.map(take=>take.id),['reference']);
  assert(guarded.blocked.every(row=>/pinned/.test(row.reason)));
});

test('a return with a dominant can audition a chromatic substitute instead of repeating the same change',()=>{
  const altered=structuredClone(source);
  altered.arrangement.score.harmonies.drift={root:'A2',quality:'dominant7',notes:[45,49,52,55]};
  const session=A.planProducer(altered,{...brief,strategies:['harmony']});
  const take=session.takes.find(row=>row.id==='harmony');
  assert.match(take.hypothesis,/tritone substitution/);
  const [substitute]=Object.values(take.components[0].revision.harmonies);
  assert.equal(substitute.root,51);
  assert.equal(substitute.quality,'dominant7');
});

test('a decision can keep one named change from a compound take and replay its saved revision',()=>{
  const initial=A.planProducer(source,brief);
  const layer=initial.takes.find(take=>take.id==='orchestration').components[0];
  const compound={id:'wide',hypothesis:'Double the hook and accent the first hit.',
    components:[layer,{...drum,revision:{id:'brush-idea',...drum.revision}}]};
  const session=A.planProducer(source,{...brief,takes:[compound]});
  const compare=A.reviewProducer(source,session,{},schedule);
  const take=compare.takes.find(take=>take.id==='wide');
  assert.equal(take.evidence.context.attacks.drum,1);
  const selection={keep:[{take:'harmony',component:'cadence'},{take:'wide',component:'octave-double'}],
    reason:'Use the harmonic pull and leave room for the doubled hook.',listened:['arrival','glass']};
  const kept=A.keepProducer(source,session,selection);
  assert.equal(A.inspect(kept.production).events.drum.length,0);
  assert.equal(A.inspect(kept.production).events.glass.length,2);
  const reference=JSON.parse(JSON.stringify(kept.reference));
  assert.equal(reference.reason,selection.reason);
  assert.deepEqual(A.revise(source,reference.revision),kept.production);
  const changed={...source,seed:17};
  assert.throws(()=>A.keepProducer(changed,session,selection),/original production/);
  assert.throws(()=>A.keepProducer(source,session,{...selection,
    keep:[...selection.keep,{take:'orchestration',component:'octave-double'}]}),/overlap/);
});
