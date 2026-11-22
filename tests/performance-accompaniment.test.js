const {test}=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load(), A=KIT.procedural.mediaGraph;
const {exampleFor}=require('../cli/graph-catalog-examples.js');
const rate=8000, addr=beat=>({beat});
const {source,brief}=exampleFor('music.arrangePerformance',{inputs:{},outputs:{report:'record'}})
  .project.nodes.example.inputs;
const make=()=>structuredClone(source);
const edit=(op,fields)=>({op,...fields});
const ready=editor=>editor.edit({
  ...make(),pins:{lead:'pitch'},mixer:{output:'master',strips:{master:{}},
    taps:{lead:{strip:'lead'},bass:{strip:'bass'},metal:{strip:'metal'}},peakPolicy:'error'}
},[
  edit('record-phrase',{lane:'lead',take:'kept',phrase:{id:'reply',from:0,to:7,drivers:{air:[
    {id:'a',beat:0,value:.25},{id:'b',beat:4.75,value:.9},{id:'c',beat:7,value:.4}
  ]},mapping:{amplitude:{base:.08,from:{air:.9}}},
  notes:[{clip:'call',voice:'line',note:'hold',delay:.020,gate:1.48}]}}),
  edit('comp',{lane:'lead',take:'kept',from:addr(0),to:addr(7),fadeSamples:64}),
  edit('score-take',{take:'spot',revision:{tracks:{bass:{clips:[
    {id:'different-bass',beat:0,length:12,mode:'layer',voices:[{id:'line',notes:[]}]}
  ]}}}}),
  edit('comp',{lane:'bass',take:'spot',from:addr(4),to:addr(7.5),fadeSamples:32})
]);

test('performance replies follow the kept articulation and the selected backing comp',()=>{
  const editor=A.musicSession.create(), session=ready(editor), pristine=JSON.stringify(session);
  const {report,clips,sessions}=editor.arrangePerformance(session,{...brief,returnMidi:31});
  assert.equal(JSON.stringify(session),pristine);
  const {hold,from}=report.replies.bass;
  const reference=editor.inspect(session).lanes.lead.takes.reference.find(row=>row.address[3]==='hold');
  assert.equal(hold.take,'kept');
  assert.equal(hold.note,'hold');
  assert(hold.gateEnd/rate>reference.time+reference.gate+.25);
  assert.equal(from-hold.gateEnd,Math.round(rate*.055));
  assert.equal(report.replies.metal.from-report.replies.metal.call.onset,
    Math.round(report.replies.metal.ratio*(report.replies.metal.call.onset-report.replies.metal.previous.onset)));
  assert.equal(report.bassReturn.midi,31);
  assert.equal(report.bassReturn.to,report.ranges.hook.to);
  assert.deepEqual(report.percussionHook.map(row=>row.midi),[60,63]);
  const {from:start,to:end}=report.ranges.hook;
  assert.deepEqual(Object.keys(sessions),['exposed','withheld','handoff']);
  assert.deepEqual(clips.exposed.samples.slice(0,2*(start-rate/50)),
    clips.handoff.samples.slice(0,2*(start-rate/50)));
  const magnitude=(pcm,from,to)=>Math.max(...pcm.samples.slice(2*from,2*to).map(Math.abs));
  for (const [id,take] of Object.entries(sessions)) {
    assert.deepEqual(take.comp,session.comp);
    assert.deepEqual(take.pins,session.pins);
    assert.deepEqual(take.production.tracks.lead,session.production.tracks.lead);
    assert.deepEqual(take.takes.kept.tracks.lead,session.takes.kept.tracks.lead);
    const inspected=editor.inspect(take);
    assert(inspected.lanes.bass.takes.spot.some(row=>row.address[3]==='bass-answer'));
    assert(!inspected.lanes.bass.takes.reference.some(row=>row.address[3]==='bass-answer'));
    const full=editor.render(take);
    assert.deepEqual(clips[id].samples,full.value.samples);
    if (id==='handoff') {
      assert(magnitude(full.taps.lead,start,end)<.00001);
      assert(magnitude(full.taps.metal,start,end)>.001);
      assert.equal(report.returns.find(row=>row.id===id).events.metal.filter(row=>row.id.startsWith('hook-')).length,2);
    } else {
      assert(magnitude(full.taps.lead,start,end)>.001);
      assert(magnitude(full.taps.metal,start,end)<.00001);
      assert.equal(magnitude(full.taps.bass,start,end)>.001,id==='withheld');
    }
  }
});

test('range validation requires context and protects pinned accompaniment',()=>{
  const editor=A.musicSession.create();
  assert.throws(()=>editor.arrangePerformance(make(),{...brief,context:brief.hook}),/context must contain/);
  assert.throws(()=>editor.arrangePerformance({...make(),pins:{bass:'pitch'}},brief),/editable bass/);
  assert.throws(()=>editor.arrangePerformance({...make(),pins:{lead:'all'}},brief),/editable bass/);
});
