const {test}=require('node:test'),assert=require('node:assert/strict');
const {KIT}=require('..').load(), P=KIT.procedural,A=KIT.music.production;
const rate=8000, E=P.mediaGraph.musicSession.create();
const note=(id,beat,duration,midi)=>({id,beat,duration,midi,velocity:.72});
const score=()=>({format:'ink-studio/music-edit-session',version:1,id:'phrase-bench',sampleRate:rate,pins:{lead:'pitch'},
  production:{seed:52,arrangement:{
    score:{tempoMap:{tempo:120,changes:[{beat:2,tempo:98}],swing:.57},key:{root:'C4'},endFade:0,
      harmonies:{home:{root:'C4',quality:'unison'}}},
    sections:[{id:'home',bars:1,harmony:'home'}],motifs:{},parts:{lead:{role:'lead'}}
  },patches:{reed:{type:'graph',tail:.26,output:'out',nodes:{
    tone:{type:'oscillator',wave:'sine'},env:{type:'envelope',env:{attack:.013,decay:.18,sustain:.81,release:.22}},
    body:{type:'gain',input:'tone',amount:{base:.02,by:{pressure:.77}}},
    out:{type:'gain',input:'body',amount:{base:0,from:{env:.78}}}
  },echo:{delay:.16,feedback:.41,send:.22}}},room:{gain:-18},tracks:{
    lead:{patch:'reed',send:.15,gain:-9,clips:[{id:'part',beat:0,length:4,voices:[
      {id:'line',notes:[note('head',.5,.38,60),note('hold',1.1,1.30,63)]},
      {id:'answer',notes:[note('reply',1.5,.55,67)]}
    ]}]}
  }},mixer:{output:'main',strips:{main:{}},taps:{lead:{strip:'lead'}},peakPolicy:'error'}});
const mapping={pressure:{base:.1,from:{effort:.85}},amplitude:{base:.04,from:{effort:.93}},
  pitchCents:{base:-26,from:{effort:52}},roughness:{base:0,from:{effort:.4}}};
const timing=(fields)=>({clip:'part',voice:'line',note:'hold',...fields});
const capture=(take,values,edit)=>({op:'record-phrase',lane:'lead',take,
  phrase:{id:'call',from:.25,to:3.75,drivers:{effort:values.map(([beat,value],i)=>({id:'p'+i,beat,value}))},
    mapping,notes:[timing(edit)]}});
const address=value=>({beat:value});
const watch=(phrase,t)=>P.musicNoteExpression.compile(undefined,1,rate,phrase).controls.pressure(t);

function setup() {
  return E.edit(score(),[
    capture('push',[[.25,.31],[1.32,.75],[1.95,.64],[2.75,.31],[3.75,.12]],{gate:.91,accent:1.16,delay:.018}),
    capture('carry',[[.25,.2],[1.21,.54],[2.15,.86],[2.85,.76],[3.75,.04]],{gate:1.65,accent:.87})
  ]);
}

test('phrase controls share a clock across concurrent notes and through tempo changes',()=>{
  const session=setup(), saved=E.inspect(session);
  assert.deepEqual(saved.lanes.lead.takes.push.map(row=>row.midi),[60,63,67]);
  assert.equal(saved.lanes.lead.performances.push[0].drivers.effort[1].id,'p1');
  assert(saved.lanes.lead.takes.push.every(row=>row.phrase==='call'));
  const source=A.revise(session.production,session.takes.push), run=A.compile(source);
  const [,held,answer]=run.events.lead;
  const now=run.clock.timeAt(address(1.72)), prior=run.clock.timeAt(address(1.32)), after=run.clock.timeAt(address(1.95));
  const expected=.1+.85*(.75+(.64-.75)*(now-prior)/(after-prior));
  assert(Math.abs(watch(held.phrase,now-held.time)-expected)<1e-8);
  assert(Math.abs(watch(answer.phrase,now-answer.time)-expected)<1e-8);
  const tail=run.clock.timeAt(address(2.2))-held.time;
  const expression=P.musicNoteExpression.compile(undefined,.075,rate,held.phrase,tail);
  assert(Math.abs(expression.controls.pressure(0)-watch(held.phrase,tail))<1e-12);
});

test('a comp retains the attack from one take and gate and continuous release controls from another',()=>{
  const session=setup();
  const sections=[{take:'push',from:.25,to:1.81},{take:'carry',from:1.81,to:3.75,blend:.1}];
  const operation={op:'comp-phrase',lane:'lead',take:'kept',phrase:'call',sections};
  const kept=E.edit(session,[operation]), before=E.inspect(kept);
  assert.deepEqual(before.lanes.lead.performances.kept[0].sources,sections);
  const a=before.lanes.lead.takes.push[1], b=before.lanes.lead.takes.carry[1], c=before.lanes.lead.takes.kept[1];
  assert.equal(c.time,a.time);
  assert.equal(c.velocity,a.velocity);
  assert.equal(c.midi,a.midi);
  assert.equal(c.gate,b.gate);
  assert(c.gate>a.gate);
  const audition={lane:'lead',phrase:'call',takes:['push','carry','kept'],from:address(.12),to:address(3.91)};
  const paired=E.auditionPhrase(kept,audition), {firstSample,endSample}=paired.report;
  const printed=E.render(kept);
  assert.deepEqual(paired.audio.kept.samples,printed.value.samples.slice(firstSample*2,endSample*2));
  const compiled=A.compile(A.revise(kept.production,kept.takes.kept));
  const seam=Math.round(compiled.clock.timeAt(address(1.81))*rate);
  for (let i=0;i<(seam-firstSample)*2-4;i++)
    assert(Math.abs(paired.audio.kept.samples[i]-paired.audio.push.samples[i])<2e-6);
  const original=kept.takes.kept.tracks.lead.phrases[0], knot=original.drivers.effort.find(row=>row.beat===2.85);
  const adjusted=E.edit(kept,[{op:'phrase-point',lane:'lead',take:'kept',phrase:'call',driver:'effort',point:knot.id,set:{value:.24}}]);
  const after=E.render(adjusted);
  assert.deepEqual(adjusted.takes.carry,kept.takes.carry);
  assert.deepEqual(E.inspect(adjusted).lanes.lead.takes.kept.map(row=>row.midi),[60,63,67]);
  assert.notDeepEqual(after.value.samples,printed.value.samples);
  assert.deepEqual(after.value.samples.slice(0,seam*2),printed.value.samples.slice(0,seam*2));
  assert.throws(()=>E.edit({...session,pins:{lead:'all'}},[operation]),/unpinned/);
  assert.throws(()=>E.edit(session,[{...operation,sections:[sections[0],{...sections[1],from:1.84}]}]),/contiguous/);
});
