const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, M=P.mediaGraph;
const WAV=require('../cli/wav.js'), {exampleFor}=require('../cli/graph-catalog-examples.js');
const example=exampleFor('music.performanceBallot',{inputs:{},outputs:{test:'record'}}).project.nodes.example.inputs;
const make=()=>structuredClone(example);
const findings=({token})=>({token,listener:'test-listener',answers:{
  identity:{choices:['c','a'],reason:'Both contours stay recognizable after the gap.'},
  replay:{choices:['b'],reason:'The bass entrance makes me want to hear the passage again.'}}});

test('scout separates the four treatments and envelopes level-matched full context and linked excerpts',()=>{
  const {source,brief}=make(), editor=M.musicSession.create();
  brief.sources.push({id:'bad-source',change:'Catch an unusable instrument.',patch:{type:'invalid'}});
  const before=JSON.stringify(source), result=editor.performanceBallot(source,brief);
  const {test:publicTest,key,report,sessions,audio}=result;
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual(sessions.current,source);
  assert.deepEqual(sessions.source.production.tracks.bass,source.production.tracks.bass);
  assert.deepEqual(sessions.source.production.tracks.lead.clips,source.production.tracks.lead.clips);
  assert.notEqual(sessions.source.production.tracks.lead.patch,source.production.tracks.lead.patch);
  assert.deepEqual(sessions.performance.production,source.production);
  assert.deepEqual(sessions.arrangement.comp,sessions.performance.comp);
  assert.deepEqual(sessions.arrangement.takes.bend.tracks.lead,sessions.performance.takes.bend.tracks.lead);
  assert.notDeepEqual(sessions.arrangement.production.tracks.bass,sessions.performance.production.tracks.bass);
  assert(report.search.source.batch.candidates.some(row=>row.status==='rejected' && row.axes.sound.id==='bad-source'));
  const [identity,replay]=publicTest.questions;
  const gap=identity.sequence[1].firstFrame-identity.sequence[0].endFrame;
  assert.equal(gap,publicTest.sampleRate*1.5);
  assert.equal(replay.frames,report.ranges.context.to-report.ranges.context.from);
  assert(!JSON.stringify(publicTest).includes('pedal'));
  for (const question of publicTest.questions) {
    assert.equal(new Set(Object.values(key.map[question.id]).map(row=>row.stage)).size,4);
    for (const clip of Object.values(audio[question.id])) {
      const meter=P.musicProduction.meters(clip,true);
      assert(Math.abs(meter.lufs-question.lufs)<.15);
      assert(20*Math.log10(meter.truePeak)<=-1.19);
    }
  }
  const vote=findings(publicTest), saved=M.performanceBallot.archive(key,vote,audio);
  assert.equal(saved.answers.identity.tie,true);
  assert.deepEqual(saved.answers.identity.choices,['a','c']);
  assert.equal(saved.answers.replay.reason,vote.answers.replay.reason);
  const tampered=structuredClone(audio);
  tampered.identity.a.samples[10]=.23;
  assert.throws(()=>M.performanceBallot.archive(key,vote,tampered),/audio no longer matches/);
  assert.throws(()=>M.performanceBallot.archive(key,{...vote,token:'invalid'},audio),/for this blind ballot/);
});

test('a performance comp cannot borrow a different written lead or patch',()=>{
  const {source,brief}=make(), editor=M.musicSession.create();
  const changed=editor.edit(source,[{op:'score-take',take:'wrong-voice',revision:{tracks:{lead:{patch:'metal'}}}}]);
  brief.performances=[{id:'different-source',change:'Reject a hidden source swap.',edits:[
    {op:'comp',lane:'lead',take:'wrong-voice',from:{beat:0},to:{beat:11}}]}];
  assert.throws(()=>editor.performanceBallot(changed,brief),/retain the written lead and its source/);
});

test('CLI writes blind WAVs, editable recipes and an immutable per-listener ballot',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-four-way-ballot-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','session',...args],{cwd:dir,encoding:'utf8'}));
  const {source,brief}=make();
  save('session.json',{session:source});
  save('brief.json',brief);
  const review=run('performance-ballot','session.json','brief.json','--out','review');
  const publicTest=read(review.manifest), key=read(review.key);
  assert(!fs.readFileSync(review.player,'utf8').includes('A low pedal'));
  assert.deepEqual(fs.readdirSync(path.dirname(review.player)).sort(),['identity','index.html','replay','test.json']);
  assert.equal(WAV.read(file('review/public/replay/a.wav')).samples.length,publicTest.questions[1].frames*2);
  assert.deepEqual(read(file('review/sessions/current.json')).session,source);
  assert.equal(publicTest.token,key.test.token);
  save('choice.json',findings(publicTest));
  const archive=()=>run('record-ballot',review.key,'choice.json','--out','archive');
  const result=archive();
  assert.deepEqual(archive(),result);
  assert.equal(read(result.ballot).answers.identity.versions.length,2);
  const vote=findings(publicTest);
  vote.answers.identity.reason='Trying to replace the previously archived ballot.';
  save('choice.json',vote);
  assert.throws(archive,/already submitted a different ballot/);
});
