const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: K } = studio.load(), C = K.music.composer;
const recipe = require('../examples/lock-signal-audition.json');

test('generated phrases quote their opening, make space, and land on an authored degree', () => {
  const options={beatsPerBar:5,bars:4,style:'syncopated',degrees:[1,2,4,6],end:4,seed:51};
  const motif=C.makePhrase(options);
  assert.deepEqual(motif,C.makePhrase(options));
  assert.equal(motif.length,20);
  const signature = event=>[event.beat%5,event.duration,event.degree,event.velocity];
  assert.deepEqual(motif.events.slice(0,2).map(signature),motif.events.slice(5,7).map(signature));
  assert.equal(motif.events.at(-1).degree,4);
  assert(motif.events.at(-1).duration>motif.events[0].duration);
  assert(motif.events[3].beat>5);
});

test('analysis uses relative written notes and exact rendered windows for mix and stems', () => {
  const plan=C.compose(recipe.arrangement);
  const report=C.analyze(plan,{audio:{start:3.5,end:6,sampleRate:8000}});
  assert.deepEqual(report.findings.find(row=>row.id==='lead-repeat-1').bars,[1,8]);
  assert.equal(report.parts.pad.sections[0].material,'sustain');
  assert.equal(report.parts.pad.sections[0].occupied,1);
  assert.equal(report.parts.snare.sections[0].material,'none');
  assert.deepEqual(report.audio.bars.map(({bar,start,end})=>[bar,start,end]),[[2,3.5,4],[3,4,6]]);
  const [idle,jam]=report.audio.bars;
  assert.equal(idle.stems.snare.rms,0);
  assert(jam.stems.snare.rms>0 && jam.mix.peak>jam.mix.rms);
  assert.equal(jam.stems.beam.peak,0);
});

test('critique proposes audible section edits, keeps protected roles, and names blocked pins', () => {
  const plan=C.compose(recipe.arrangement);
  const options={part:'lead',section:'jam',seed:81};
  const pinned=C.suggest(plan,options);
  assert.equal(pinned.variants.length,0);
  assert(pinned.blocked.every(row=>row.blockedBy.includes('part:lead')));
  assert(pinned.blocked.length>0);
  const bound=structuredClone(recipe.arrangement);
  bound.score.bindings.camera.voice='lead';
  const bindingPin=C.suggest(bound,{...options,unpin:['part:lead']});
  assert.equal(bindingPin.variants.length,0);
  assert(bindingPin.blocked.some(row=>row.blockedBy.includes('binding:camera')));
  const reply=C.suggest(plan,{...options,unpin:['part:lead']});
  const index=reply.proposals.findIndex(row=>row.kind==='call-and-answer');
  const proposal=reply.proposals[index];
  assert.deepEqual(proposal.bars,[5,6]);
  assert(proposal.after.onsets<proposal.before.onsets);
  assert(proposal.after.longestRest>proposal.before.longestRest);
  const {takes:[before,after]}=C.audition(plan,[{id:'baseline'},reply.variants[index]],{start:8,end:12,sampleRate:8000});
  assert.notDeepEqual(before.audio.samples,after.audio.samples);
  const outside = value=>value.parts.lead.voice.sequence.filter(note=>note.beat<16 || note.beat>=24);
  assert.deepEqual(outside(plan),outside(after.arrangement));
  for (const part of ['bass','kick','snare','hat','pad','beam'])
    assert.deepEqual(plan.parts[part],after.arrangement.parts[part]);
  assert.deepEqual(plan.score.bindings,after.arrangement.score.bindings);
});

test('section edits resume a seeded inherited motif at its original phase', () => {
  const arrangement=structuredClone(recipe.arrangement);
  arrangement.motifs.cycle={length:3,events:[{beat:.5,duration:.23,degree:3},{beat:1.75,duration:.22,degree:5}]};
  arrangement.parts.hat.material={motif:'cycle',operations:[{type:'thin',keep:.9}],seed:12};
  for (const section of arrangement.sections) delete section.parts?.hat;
  const base=C.compose(arrangement);
  const changed=C.revise(base,{edits:[{part:'hat',section:'jam',scope:'section',material:null}]}).value;
  assert(changed.parts.hat.notes<base.parts.hat.notes);
  const beforeOrAfter=plan=>plan.parts.hat.voice.sequence.filter(note=>note.beat<8 || note.beat>=24);
  assert.deepEqual(beforeOrAfter(base),beforeOrAfter(changed));
  assert.deepEqual(C.reference(base,{part:'hat',section:'clear'}).motif,
    C.reference(changed,{part:'hat',section:'clear'}).motif);
});

test('a fill that would exceed motif capacity leaves its finding available for inspection', () => {
  const events=Array.from({length:508},(_,i)=>({
    beat:i/16+Math.floor(i/64)*.001,duration:.03,degree:1,velocity:i%2===0?.35:.9
  }));
  for (const beat of [32,33,36,37]) events.push({beat,duration:.15,degree:1,velocity:.75});
  const source={score:{harmonies:{home:{root:'C4',quality:'unison'}}},motifs:{grid:{length:40,events}},
    parts:{drum:{role:'percussion',material:'grid'}},sections:[{id:'build',bars:10,harmony:'home'}]};
  assert.deepEqual(C.analyze(source).findings.find(row=>row.kind==='repeated-bar').bars,[9,10]);
  assert.deepEqual(C.suggest(source).variants,[]);
});

test('motifs vary deterministically, keeping timing, note IDs or contour where requested', () => {
  const seed = {length:4,events:[{id:'first',beat:0,duration:.25,degree:1,velocity:.96},
    {id:'up',beat:1,duration:.3,degree:3,velocity:.45},{id:'land',beat:2.5,duration:.4,degree:2,velocity:.8}]};
  const echo=C.motif.vary(seed,[{type:'repeat',count:2},{type:'accentShift',steps:1}]);
  assert.equal(echo.length,8);
  assert.deepEqual(echo.events.map(event=>event.beat),[0,1,2.5,4,5,6.5]);
  assert.deepEqual(echo.events.slice(0,3).map(event=>event.id),['first','up','land']);
  assert.deepEqual(echo.events.slice(0,3).map(event=>event.velocity),[.8,.96,.45]);
  const answer=C.motif.vary(seed,[{type:'answer'}]);
  assert.deepEqual(answer.events.map(row=>row.degree),[1,-1,0]);
  assert.deepEqual(C.motif.inspect(answer).contour,[-1,1]);
  const options={length:8,count:12,degrees:[1,2,4,5],first:1,last:5};
  const a=C.motif.generate({...options,seed:10}), b=C.motif.generate({...options,seed:32});
  assert.deepEqual(a,C.motif.generate({...options,seed:10}));
  assert.notDeepEqual(a,b);
  assert.equal(a.events[0].degree,1);
  assert.equal(a.events.at(-1).degree,5);
  assert.throws(()=>C.motif.motif({length:1,events:[{beat:0,duration:.75},{beat:.5,duration:.3}]}),/overlap/);
});

test('roles inherit through a section, and motif notes drive pitches and visual cues on the same clock', () => {
  const plan=C.compose(recipe.arrangement), program=K.music.score.compile(plan.score);
  assert.equal(plan.report.bars,8);
  assert.equal(plan.report.duration,16);
  assert.equal(plan.materials.pad[1].sourceSection,'idle');
  assert.equal(plan.materials.snare[0].sustain,false);
  assert(plan.cues.filter(cue=>cue.part==='snare').every(cue=>cue.section==='jam'));
  const events=plan.cues.filter(cue=>cue.part==='lead');
  assert.deepEqual(events.map(cue=>[cue.time,cue.endTime, cue.degree]),
    plan.cues.filter(cue=>cue.part==='beam').map(cue=>[cue.time,cue.endTime,cue.degree]));
  const note=events.find(cue=>cue.degree===3);
  const current=program.sample(note.time+.03);
  assert.equal(current.voices.lead.note,'F4');
  assert(current.voices.beam.level>.1);
  assert.equal(program.sample(3.9).voices.pad.note,'G3');
  assert.equal(program.sample(4.04).voices.pad.note,'G3');
  assert.equal(program.sample(4.04).voices.snare.level,0);
  const scheduled=K.music.score.compile(plan.score,{requests:[{harmony:'tension',time:.1,quantize:'bar'}]});
  const natural=program.sample(2.06).voices.bass.midi;
  assert.notEqual(scheduled.sample(2.06).voices.bass.midi,natural);
});

test('selective alternatives retain pinned score, palette, camera and lead PCM and expose reusable motifs', () => {
  const {takes}=C.audition(recipe.arrangement,recipe.variants,{start:4,end:6,sampleRate:8000});
  const [base,broken,late]=takes;
  assert.notDeepEqual(base.audio.samples,broken.audio.samples);
  assert.notDeepEqual(late.audio.samples,broken.audio.samples);
  assert.deepEqual(base.arrangement.parts.lead,broken.arrangement.parts.lead);
  assert.deepEqual(base.arrangement.parts.beam,broken.arrangement.parts.beam);
  assert.deepEqual(base.arrangement.score.bindings,broken.arrangement.score.bindings);
  const [a,b]=[base,broken].map(take=>K.music.score.compile(take.arrangement.score));
  assert.deepEqual(a.audio({start:4,end:6,sampleRate:8000,stems:true}).stems.lead,
    b.audio({start:4,end:6,sampleRate:8000,stems:true}).stems.lead);
  assert.deepEqual(a.sample(4.6).bindings,b.sample(4.6).bindings);
  assert.throws(()=>C.revise(base.arrangement,{edits:[{part:'lead',operations:[{type:'answer'}]}]}),/pinned arrangement part/);
  assert.throws(()=>C.revise(base.arrangement,{edits:[{part:'beam',operations:[{type:'answer'}]}]}),/pinned arrangement part/);
  assert.throws(()=>C.revise(base.arrangement,{edits:[{harmony:'home',voicing:{pad:'C4'}}]}),/pinned part: pad/);
  const idea=C.reference(late.arrangement,{section:'jam',part:'hat'});
  assert(idea.traits.offbeats.length);
  assert(idea.cues.every(cue=>cue.section==='jam'));
  const adopted=C.revise(base.arrangement,{unpin:['binding:camera'],
    edits:[{part:'beam',section:'jam',adopt:idea}]}).value;
  assert.deepEqual(C.reference(adopted,{part:'beam',section:'jam'}).motif,idea.motif);
  const drums=b.audio({start:4,end:6,sampleRate:8000,stems:true});
  const cut=b.audio({start:4.5,end:6,sampleRate:8000,stems:true});
  assert.deepEqual(cut.stems.hat.samples,drums.stems.hat.samples.slice(8000));
});

test('stock graph operations pass generated ideas into an arrangement and synth', () => {
  const graph=K.procedural.graph.create({nodes:{
    arrange:{op:'music.arrange',inputs:{source:recipe.arrangement}},
    audio:{op:'music.scoreAudio',inputs:{score:{node:'arrange',port:'score'},options:{end:.125,sampleRate:8000}}},
    reference:{op:'music.reference',inputs:{source:{node:'arrange'},part:'lead',section:'idle'}},
    vary:{op:'music.motif',inputs:{source:{node:'reference',port:'motif'},operations:[{type:'answer'}]}},
    analysis:{op:'music.analyzeArrangement',inputs:{source:{node:'arrange'}}},
    suggestions:{op:'music.suggest',inputs:{source:{node:'arrange'},options:{part:'lead',unpin:['part:lead'],limit:1}}},
    audition:{op:'music.audition',inputs:{source:{node:'arrange'},variants:{node:'suggestions',port:'variants'},
      options:{start:8,end:12,audio:false}}}
  },outputs:{audio:{node:'audio'},varied:{node:'vary'},original:{node:'reference',port:'motif'},
    analysis:{node:'analysis',port:'findings'},takes:{node:'audition'}}});
  const {outputs}=graph.evaluate({});
  assert.equal(outputs.audio.samples.length,2000);
  assert.notDeepEqual(outputs.varied.events.map(row=>row.degree),outputs.original.events.map(row=>row.degree));
  assert(outputs.analysis.some(row=>row.id==='lead-repeat-1'));
  assert.equal(outputs.takes.length,1);
  assert.equal(outputs.takes[0].report.delta.lead,-5);
});

test('CLI audition exports editable takes, stereo audio and a native still', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-phrase-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'recipe.json');
  fs.writeFileSync(file,JSON.stringify({...recipe,variants:recipe.variants.slice(0,2),
    options:{...recipe.options,start:4,end:4.5,sampleRate:8000,width:384,height:288}}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const {manifest}=JSON.parse(execFileSync(process.execPath,[cli,'music','audition',file,'--out',dir,'--frames-only'],{encoding:'utf8'}));
  const data=JSON.parse(fs.readFileSync(manifest));
  assert.equal(data.takes.length,2);
  for (const take of data.takes) {
    const root=path.dirname(manifest);
    const wav=studio.readWav(path.join(root,take.audio));
    assert.equal(wav.samples.length,8000);
    assert.equal(wav.channels,2);
    assert.equal(fs.readFileSync(path.join(root,take.still))[0],137);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,take.arrangement))).format,'ink-studio/phrase-arrangement');
  }
});
