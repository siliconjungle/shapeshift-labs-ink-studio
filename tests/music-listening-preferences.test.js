const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), A=KIT.music.production, C=A.critique;
const rate=8000;
function score(tempo=108,bass='bass') {
  const motif=events=>({length:4,events:events.map(([beat,duration,midi,velocity])=>({beat,duration,midi,velocity}))});
  return {seed:78,arrangement:{
    score:{tempoMap:{tempo},key:{root:'D3',mode:'minor'},harmonies:{home:{root:'D3',quality:'minor'}}},
    sections:[{id:'warm',bars:1,harmony:'home'},{id:'reveal',bars:1,harmony:'home'}],
    motifs:{call:motif([[0,.23,69,.66],[.62,.71,72,.84],[1.7,.64,74,.7]]),
      harmony:motif([[.12,.8,69,.72],[1.46,.9,72,.62]]),
      ground:motif([[0,.63,38,.72],[1.32,.48,45,.63],[2.7,.50,38,.69]]),
      drums:motif([[0,.23,36,.74],[.89,.12,36,.52],[2.06,.19,36,.68]])},
    parts:{hook:{role:'lead',material:'call'},pad:{role:'pad',material:'harmony'},
      [bass]:{role:'bass',material:'ground'},drums:{role:'percussion',material:'drums',voice:{instrument:'kick'}}}
  },patches:{lead:{type:'fm',index:.15},bed:{type:'analog'},drum:{type:'drum',kind:'kick'}},
  tracks:{hook:{patch:'lead',gain:-14,send:.15},pad:{patch:'bed',gain:-17},[bass]:{patch:'bed',gain:-8},
    drums:{patch:'drum',gain:-13,send:.55}},room:{gain:-4,size:1.05,decay:.9}};
}
const context={scene:'suspense',moment:'before-reveal',role:'bass'};
const brief={section:'reveal',kind:'both',goal:'Let the figure establish itself before the bass enters.',
  sampleRate:rate,leadInBeats:1,focusBeats:2,withholdBeats:1.1};
const query={context,criterion:'shape',moves:['reference','delay-bass','mix-cut']};
const label=(key,move)=>Object.keys(key.labels).find(name=>key.labels[name]===move);
function decision(key,chosen,opponent,votes,reason='The bass entry answers the exposed figure.') {
  const take=label(key,chosen), other=label(key,opponent);
  const trial=key.test.trials.find(row=>row.takes.includes(take) && row.takes.includes(other));
  return {token:key.test.token,take,reason,votes:votes.map((preferences,i)=>({trial:trial.id,listener:'listener-'+i,
    preferences:Object.fromEntries(Object.entries(preferences).map(([criterion,move])=>[criterion,move==='tie' ? move : label(key,move)]))}))};
}
function kept(name,ctx,winner='delay-bass',votes=[{shape:'delay-bass',identity:'reference'}],against) {
  const source=score(), plan=C.plan(source,{...brief,...(ctx && {listeningContext:ctx})});
  const {test,key,audio}=C.blind(source,plan,{}, {id:name,seed:123});
  const selection=decision(key,winner,against ?? (winner==='reference' ? 'delay-bass' : 'reference'),votes);
  return {source,plan,test,key,audio,selection,reference:C.keep(source,key,selection).reference};
}

test('blind exports retain contextual ballots, outcomes and the editor rationale without revealing labels',()=>{
  const capture=kept('hallway',context), {key,test,audio,reference}=capture;
  assert(!JSON.stringify(test).includes('delay-bass'));
  assert(!JSON.stringify(test).includes('before-reveal'));
  assert.equal(audio.a.samples.length/2,test.range.endSample-test.range.firstSample);
  assert.deepEqual(key.listeningContext,context);
  assert.deepEqual(reference.listening.context,context);
  const pair=reference.listening.pairs.find(row=>row.moves.includes('delay-bass'));
  assert.deepEqual(pair.criteria.shape,[1,0,0]);
  const memory=C.rememberPreference(undefined,reference);
  assert.deepEqual(C.rememberPreference(JSON.parse(JSON.stringify(memory)),reference),memory);
  assert.equal(memory.entries.length,1);
  assert.throws(()=>C.rememberPreference(memory,{...reference,reason:'Another reason.'}),/already archived/);
  assert.throws(()=>C.keep(capture.source,key,{...capture.selection,listeningContext:{scene:'large'}}),/fixed by the blind test/);
  const changed=structuredClone(reference);
  changed.listening.pairs[0].criteria.shape=[0,1,0];
  assert.throws(()=>C.rememberPreference(undefined,changed),/must match the blind ballots/);
  const recall=C.recallPreferences(memory,query);
  assert.equal(recall.preferred,'delay-bass');
  assert.equal(recall.pairs[0].rationale[0].reason,reference.reason);
  assert.deepEqual(recall.pairs[0].rationale[0].focus,reference.focus);
  assert.equal(C.recallPreferences(memory,{...query,criterion:'identity'}).preferred,'reference');
  assert.equal(C.recallPreferences(memory,{...query,moves:['delay-bass','mix-cut']}).preferred,null);
});

test('context and the feasible edit both matter when applying listening evidence to a fresh cue',()=>{
  const memory=C.rememberPreference(undefined,kept('stairwell',context).reference);
  const later=score(123,'sub');
  const initial=C.plan(later,{...brief,listeningContext:context});
  assert.equal(initial.session.takes[1].id,'mute-layer');
  const reused=C.plan(later,{...brief,listeningContext:{...context,style:'glass'},memory,criterion:'shape'});
  const {id,components}=reused.session.takes[1];
  assert.equal(id,'delay-bass');
  assert.deepEqual(components[0].revision.cueMap.silence[0].parts,['sub']);
  assert.equal(components[0].revision.cueMap.silence[0].to,5.1);
  const scenic=C.plan(later,{...brief,listeningContext:{...context,moment:'opening'},memory,criterion:'shape'});
  assert.equal(scenic.preference.preferred,null);
  assert.equal(scenic.preference.matchingTests,0);
  assert.equal(scenic.session.takes[1].id,initial.session.takes[1].id);
  const missing=score(123,'sub'); missing.arrangement.pins=['part:sub'];
  const blocked=C.plan(missing,{...brief,listeningContext:context,memory,criterion:'shape'});
  assert.equal(blocked.preference.preferred,null);
  assert(!blocked.session.takes.some(row=>row.id==='delay-bass'));
  assert.equal(C.recallPreferences(memory,{...query,context:{scene:'suspense'}}).preferred,null);
});

test('specific tests take precedence per pair and equal conflicting evidence remains unresolved',()=>{
  const broad=kept('general',{scene:'suspense'},'reference',[{shape:'reference'}]);
  const local=kept('local',context);
  const contrary=kept('second-editor',context,'reference',[{shape:'reference'}]);
  let memory=C.rememberPreference(undefined,broad.reference);
  memory=C.rememberPreference(memory,local.reference);
  const scoped=C.recallPreferences(memory,query);
  assert.equal(scoped.matchingTests,2);
  assert.equal(scoped.usedTests,1);
  assert.equal(scoped.suppressed,1);
  assert.equal(scoped.preferred,'delay-bass');
  memory=C.rememberPreference(memory,contrary.reference);
  const unresolved=C.recallPreferences(memory,query);
  assert.deepEqual(unresolved.pairs[0].votes,[1,1,0]);
  assert.equal(unresolved.preferred,null);
  assert.equal(unresolved.pairs[0].rationale.length,2);
  const tied=kept('tie-test',context,'reference',[{shape:'tie',replay:'reference'}]);
  const tieResult=C.recallPreferences(C.rememberPreference(memory,tied.reference),query);
  assert.deepEqual(tieResult.pairs[0].votes,[1,1,1]);
  assert.equal(tieResult.preferred,null);
});

test('dry drums and authored alternatives participate in blind memory, with legacy decisions recoverable',()=>{
  const source=score(), scene={scene:'intimate',moment:'opening',role:'drums'};
  const config={...brief,kind:'space',section:'warm',listeningContext:scene,takes:[{
    id:'closer-bass',hypothesis:'Turn the bass up during the drum figure.',revision:{tracks:{bass:{gain:-5}}}
  }]};
  const planned=C.plan(source,config);
  assert.deepEqual(planned.session.takes.map(row=>row.id),['reference','dry-drums','closer-bass']);
  const audition=C.blind(source,planned,{}, {id:'dry-drums'});
  const selection=decision(audition.key,'dry-drums','reference',[{identity:'dry-drums'}],'The short drum accents read up close.');
  const {production,reference}=C.keep(source,audition.key,selection);
  assert.deepEqual(production.cueMap.room[0].parts,['drums']);
  assert.equal(production.cueMap.room[0].send,0);
  assert.equal(C.recallPreferences(C.rememberPreference(undefined,reference),{context:scene}).preferred,'dry-drums');
  const unscoped=kept('old-test');
  assert.throws(()=>C.rememberPreference(undefined,unscoped.reference),/kept blind decision with listening context/);
  const restored=C.keep(unscoped.source,unscoped.key,{...unscoped.selection,listeningContext:context});
  assert.equal(C.recallPreferences(C.rememberPreference(undefined,restored.reference),query).preferred,'delay-bass');
  const custom=C.plan(source,{...config,kind:'custom'});
  assert.deepEqual(custom.session.takes.map(row=>row.id),['reference','closer-bass']);
});

test('CLI persists separate test records and reads the same archive into a new plan',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-listening-memory-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','critique',...args],{cwd:root,encoding:'utf8'}));
  const {reference}=kept('archived-source',context);
  save('reference.json',reference);
  save('query.json',query);
  const first=cli('remember','memory','reference.json');
  assert.deepEqual(cli('remember','memory','reference.json'),first);
  assert.equal(fs.readdirSync(path.join(root,'memory')).length,1);
  assert.equal(cli('recall','memory','query.json').preferred,'delay-bass');
  save('cue.json',{production:score(116,'sub')});
  save('brief.json',{...brief,listeningContext:context,memory:'memory',criterion:'shape'});
  assert.equal(cli('plan','cue.json','brief.json').session.takes[1].id,'delay-bass');
});

test('priority spends one ballot on the broad decision, preserves two cues, and updates after a tie',()=>{
  const baseline={...score(),gain:0};
  const checkPlan=C.plan(baseline,{...brief,kind:'custom',listeningContext:context,takes:[
    {id:'change-arrival',hypothesis:'Leave a hole in the bass at the return.',
      revision:{cueMap:{silence:[{from:4,to:5,parts:['bass'],mode:'cut'}]}}},
    {id:'closer-drums',hypothesis:'Shorten the room on the playable drum strike.',
      revision:{cueMap:{room:[{from:4,to:5,parts:['drums'],send:.02}]}}},
    {id:'inaudible',hypothesis:'Keep the exact existing overall gain.',revision:{gain:0}}
  ]});
  const question=(id,move,impacts)=>({id,plan:checkPlan,criterion:'shape',question:'Which entrance feels more deliberate?',
    impacts,moves:['reference',move]});
  const arrival={...question('arrival','change-arrival',{timing:3,orchestration:2}),
    later:{fromBeat:6.5,toBeat:8}};
  const small=question('drums','closer-drums',{space:4});
  const identical=question('identical','inaudible',{space:10});
  const initial=C.prioritize(baseline,[arrival,small,identical],undefined,{}, {budget:1,seed:88});
  assert.equal(initial.report.selected[0].request,'arrival');
  assert.equal(initial.report.skipped[0].reason,'negligible-rendered-difference');
  const {test,key,audio}=initial.tests['question-1'];
  assert.equal(test.trials.length,1);
  assert.deepEqual(test.criteria,['shape']);
  assert.equal(test.sequence[1].range.fromBeat,6.5);
  assert.equal(audio.a.samples.length/2,test.sequence[1].endFrame);
  assert(!JSON.stringify(test).includes('change-arrival'));
  const ballot={token:test.token,reason:'Both returns feel equally well set up.',
    votes:[{listener:'one',trial:'pair-1',preferences:{shape:'tie'}}]};
  const archive=C.archiveBallot(undefined,key,ballot,audio);
  assert.equal(archive.entries[0].selected,null);
  assert.equal(archive.entries[0].excerpt.votes[0].preferences.shape,'tie');
  assert.deepEqual(archive.entries[0].excerpt.sequence,test.sequence);
  const recall=C.recallPreferences(archive,{context,criterion:'shape'});
  assert.equal(recall.preferred,null);
  assert.deepEqual(recall.pairs[0].votes,[0,0,1]);
  assert.throws(()=>C.archiveBallot(undefined,key,ballot,{...audio,a:audio.b}),/match the blind listening excerpt/);
  assert.equal(C.prioritize(baseline,[arrival,small],archive,{}, {budget:1,seed:88}).report.selected[0].request,'drums');
});
