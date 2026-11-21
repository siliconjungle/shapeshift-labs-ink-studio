const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: K } = studio.load(), C = K.music.composer;
const recipe = require('../examples/lock-signal-audition.json');

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
    vary:{op:'music.motif',inputs:{source:{node:'reference',port:'motif'},operations:[{type:'answer'}]}}
  },outputs:{audio:{node:'audio'},varied:{node:'vary'},original:{node:'reference',port:'motif'}}});
  const {outputs}=graph.evaluate({});
  assert.equal(outputs.audio.samples.length,2000);
  assert.notDeepEqual(outputs.varied.events.map(row=>row.degree),outputs.original.events.map(row=>row.degree));
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
