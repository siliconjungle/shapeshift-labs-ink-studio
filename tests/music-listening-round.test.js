const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, M=P.mediaGraph, B=M.listeningRound;
const {exampleFor}=require('../cli/graph-catalog-examples');
const WAV=require('../cli/wav');
const example=exampleFor('music.runListeningRound',{inputs:{},outputs:{test:'record'}}).project.nodes.example.inputs;
const fixture=()=>structuredClone(example);
const R=P.musicCritiqueReferences, vote=(test,answers)=>({token:test.token,listener:'test-listener',answers});

test('integrity checks identify quiet attacks, exact join spikes and gain-aligned twins',()=>{
  const support={}, scope={KIT:{procedural:{mediaGraphSupport:support,musicInstruments:P.musicInstruments}}};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../src/kit/par-audio-session-experiment-evidence.js'),'utf8'),scope);
  const E=support.sessionExperimentEvidence, rate=8000, first=128;
  const make=()=>({sampleRate:rate,channels:2,samples:new Float32Array(1024)});
  const main=make(), lead=make();
  main.samples.fill(.37,2*240);
  main.samples[950]=1.07;
  lead.samples[2*70]=.16;
  const checks={attackWindowMs:10,attackFloorDb:-50,joinJump:.12,peakLimit:1,
    attacks:[first+60,first+150],joins:[first+240]};
  const result=E.integrity({value:main,taps:{lead}},'lead',{from:first,to:first+512},checks,rate);
  assert.equal(result.over,true);
  assert.deepEqual(Array.from(result.missing,row=>({...row})),[{sample:first+150,peak:0}]);
  assert.deepEqual(Array.from(result.broken,row=>row.sample),[first+240]);
  const scaled={...main,samples:main.samples.map(value=>value*.72)};
  assert(E.near(E.sketch(main),E.sketch(scaled),.005));
  assert(!E.near(E.sketch(main),E.sketch({...main,samples:main.samples.slice().reverse()}),.005));
});

test('a round crosses only heard instruments, preserves the lead, and keeps verified preferences on exact audio',()=>{
  const {source,brief}=fixture(), E=M.musicSession.create();
  brief.series='fixture-series';
  brief.sources.push({id:'broken',patch:{type:'unavailable'}});
  const result=E.listeningRound(source,brief), {ballot,sessions,value}=result;
  assert.equal(value.instrument.attempted,3);
  assert.equal(value.ensemble.attempted,value.instruments.length*brief.relationships.length);
  assert(value.instrument.candidates.some(row=>row.status==='rejected' && row.axes.sound.id==='broken'));
  assert.deepEqual(ballot.test.questions.map(row=>row.id),['identity','groove','replay']);
  assert(!JSON.stringify(ballot.test).includes('lighter'));
  for (const recipe of Object.values(sessions))
    assert.deepEqual(recipe.production.tracks.lead.clips,source.production.tracks.lead.clips);
  const map=ballot.key.ballot.map.groove, left=Object.keys(map).find(label=>map[label].stage==='reference');
  const right=Object.keys(map).find(label=>map[label].stage!=='reference'), chosen=map[right].stage;
  const submission=vote(ballot.test,{groove:{choices:[right],reason:'A later strike leaves space for the call.'},
    identity:{choices:[left,right],reason:'Both calls stay distinct after the gap.'}});
  const record=B.archive(ballot.key,submission,ballot.audio);
  assert.equal(record.answers.identity.tie,true);
  const saved=B.keep(ballot.key,submission,ballot.audio,sessions[chosen],{question:'groove',candidate:chosen});
  assert.equal(saved.decision.audioHash,R.excerptHash(ballot.audio.groove[right].samples));
  assert.equal(saved.decision.reason,submission.answers.groove.reason);
  assert.deepEqual(saved.session,sessions[chosen]);
  assert.equal(saved.next.parent.sessionHash,saved.decision.sessionHash);
  assert.throws(()=>B.keep(ballot.key,submission,ballot.audio,source,{question:'groove',candidate:chosen}),/exact favored session/);
  const damaged=structuredClone(ballot.audio);
  damaged.groove[right].samples[12]=.9;
  assert.throws(()=>B.archive(ballot.key,submission,damaged),/audio no longer matches/);

  const L=P.musicProduction.critique.listener;
  const pack=L.pack({a:ballot.audio.groove[left],b:ballot.audio.groove[right]},{cases:[
    {id:'comparison',criterion:'groove',kind:'preference',question:'Which pocket would you keep?',left:'a',right:'b'}
  ]});
  const votes=B.calibrationVotes(pack.key,[record,record]);
  assert.deepEqual(votes,{comparison:['right']});
  const output={token:pack.key.token,model:'fixture',responses:pack.key.cases[0].records.map(row=>({trial:row.id,
    choice:row.control==='identical' ? 'tie' : row.order[0]==='right' ? 'A' : 'B'}))};
  assert.equal(L.evaluate(pack.key,output).criteria[0].humanAccuracy,null);
  const scored=L.evaluate(pack.key,output,{humanVotes:votes});
  assert.equal(scored.criteria[0].humanAccuracy,1);
  assert.equal(scored.criteria[0].status,'insufficient');
  const wrong={...saved.next.parent,sessionHash:'different'};
  assert.throws(()=>E.listeningRound(saved.session,{...brief,parent:wrong}),/optional parent/);
});

test('evidence contains the real lead-in, tap solo, source mute and exact addressed repair',()=>{
  const {source}=fixture(), E=M.musicSession.create();
  const span=(from,to)=>({from:{beat:from},to:{beat:to}});
  const focus=span(8,11), context=span(6,12);
  const report=E.listeningEvidence(source,{focus,context,solo:['lead'],mute:['lead'],repairs:[
    {id:'shorter',edits:[{op:'note',take:'reference',lane:'lead',clip:'call',voice:'line',note:'return-b',set:{play:{releaseLimit:.035}}}]}
  ]});
  const {value,clips}=report, start=2*(value.focus.from-value.context.from);
  assert.deepEqual(clips['lead-in'].samples,clips.reference.samples.slice(0,start));
  assert.equal(clips['solo-0'].samples.length,2*(value.focus.to-value.focus.from));
  const direct=E.render(source,{...context,monitor:{mode:'mute',lane:'lead'}});
  assert.deepEqual(clips['mute-0'].samples,Float64Array.from(direct.value.samples,value=>value*report.value.gain));
  const selection={take:'shorter',reason:'The end leaves a little air.'};
  const kept=E.keepListeningRepair(source,value,selection,clips.shorter);
  assert.equal(kept.decision.audioHash,R.excerptHash(clips.shorter.samples));
  assert.throws(()=>E.keepListeningRepair(source,value,selection,clips.reference),/exact auditioned repair/);
});

test('CLI keeps the exact ballot excerpt beside the portable session and reason',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-round-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const file=name=>path.join(root,name);
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music','session',...args],
    {cwd:root,encoding:'utf8'}));
  const {source,brief}=fixture();
  save('session.json',{session:source});save('brief.json',brief);
  const printed=run('listening-round','session.json','brief.json','--out','review');
  const key=read(printed.key), ballot=key.ballot.test;
  const pick=Object.entries(key.ballot.map.replay).find(([,row])=>row.stage!=='reference');
  save('vote.json',vote(ballot,{replay:{choices:[pick[0]],reason:'The end gives me time to hear the room.'}}));
  const archived=run('record-round',printed.key,'vote.json','--out','history');
  save('pick.json',{ballot:archived.ballot,question:'replay',candidate:pick[1].stage});
  const kept=run('keep-round',printed.key,'pick.json','--out','kept');
  assert.equal(read(kept.decision).audioHash,R.excerptHash(WAV.read(kept.excerpt).samples));
  assert.equal(read(file('kept/next-round.json')).parent.candidate,pick[1].stage);
  assert.deepEqual(read(kept.session),read(file('review/sessions/'+pick[1].stage+'.json')));
});
