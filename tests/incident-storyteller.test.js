const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;

const coast = '../examples/story-documents/glass-coast.world.json';
const harbor = '../examples/story-documents/harbor-recovery.world.json';
const copy = value=>JSON.parse(JSON.stringify(value));
const world = (file=coast)=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const id = story=>'glass-coast/'+story;
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const storyteller = run=>probe(run,'storyteller');
const dispatches = run=>run.history.filter(row=>row.kind==='story-candidate-dispatched');
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const manual = (tick,incident)=>({tick,action:'world/dispatch-candidate',args:{incident,reason:'player-choice'}});
function play(active) {
  const source = world();
  source.storyteller.active = active;
  const run = R.create(source);
  run.advance(42);
  return run;
}

test('cadence changes gaps while the candidate order and intensity stay the same',()=>{
  const slow = dispatches(play('slow-burn')), volatile = dispatches(play('volatile'));
  assert.deepEqual(slow.map(row=>row.tick),[1,6,11,16,21,26,31]);
  assert.deepEqual(volatile.map(row=>row.tick),[1,3,7,9,13,15,18]);
  assert.deepEqual(slow.map(row=>row.candidate),volatile.map(row=>row.candidate));
  assert.deepEqual(slow.map(row=>row.incident.intensity),volatile.map(row=>row.incident.intensity));
  assert.deepEqual(volatile.slice(1).map(row=>row.tick),volatile.slice(0,-1).map(row=>row.storyteller.nextAutomaticAt));
  const run = play('volatile');
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
});

test('the challenge cap filters automatic draws independently of the cadence and keeps native rewards',()=>{
  const gentle = play('generous'), open = play('generous-unrestricted'), exploratory = play('exploratory');
  assert.deepEqual(storyteller(gentle).cadence,storyteller(open).cadence);
  assert.deepEqual(storyteller(gentle).categoryWeights,storyteller(open).categoryWeights);
  assert.deepEqual(dispatches(gentle).map(row=>row.tick),[1,4,7,10]);
  assert.deepEqual(dispatches(open).map(row=>row.tick),[1,4,7,10,13,16,19]);
  assert.equal(Math.max(...dispatches(gentle).map(row=>row.incident.intensity)),2);
  assert.equal(Math.max(...dispatches(open).map(row=>row.incident.intensity)),5);
  assert.deepEqual(dispatches(exploratory).slice(1,3).map(row=>row.incident.category),['discovery','discovery']);
  const receipt = probe(gentle,'incident-selections').selections[0];
  assert.equal(receipt.candidates.find(row=>row.candidate===id('breakwater-collapse')).status,'blocked');
  assert.equal(receipt.candidates.find(row=>row.candidate===id('mutual-aid')).weight,16);
  assert.equal(probe(gentle,'account',{account:'stock/harbor'}).balance,2);
  assert.equal(probe(gentle,'incident-candidates').closed.filter(row=>row.status==='expired').length,3);
  assert.deepEqual(restore(gentle.checkpoint()).checkpoint(),gentle.checkpoint());
});

test('a manual intervention keeps native admission checks and spends no automatic beat',()=>{
  const source = world();
  source.storyteller.active = 'generous';
  const run = R.create(source);
  run.schedule([manual(2,id('breakwater-collapse'))]);
  run.advance(1);
  assert.equal(storyteller(run).nextAutomaticAt,4);
  assert.deepEqual(storyteller(run).pending.find(row=>row.candidate===id('breakwater-collapse')).blockers,
    ['challenge','cadence']);
  run.advance(2);
  assert.equal(storyteller(run).nextAutomaticAt,4);
  const saved = run.checkpoint();
  assert.deepEqual(saved.incidentCandidateState[id('breakwater-collapse')].storyteller,{profile:'generous',mode:'manual'});
  const resumed = restore(saved);
  run.advance(42);
  resumed.advance(42);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  const corrupt = copy(run.checkpoint());
  corrupt.incidentCandidateState[id('mutual-aid')].storyteller.nextAutomaticAt--;
  assert.throws(()=>restore(corrupt),/Invalid saved storyteller dispatch/);
});

test('cooldowns and pressure constrain storyteller releases, including in existing authored pools',()=>{
  const source = world(harbor);
  source.storyteller = {active:'local',profiles:{local:{cadence:{minInterval:0.2},categoryWeights:{recovery:0}}}};
  source.incidentPressure = {commitments:1};
  const run = R.create(source);
  run.advance(3);
  assert.deepEqual(storyteller(run).pending.find(row=>row.candidate==='harbor-recovery/ridge-market').blockers,
    ['recovery-cooldown','zero-weight']);
  assert.equal(run.history.find(row=>row.kind==='story-candidate-rejected').reason,'incident-cooling-down');
  run.advance(5);
  assert.equal(storyteller(run).lastAutomaticAt,null);
  run.advance(6);
  assert.equal(dispatches(run)[0].candidate,'harbor-recovery/union-meeting');
  const [selection] = probe(run,'incident-selections').selections;
  assert.equal(selection.pool,'harbor-beats');
  assert.equal(selection.candidates.find(row=>row.candidate==='harbor-recovery/ridge-market').status,'zero-weight');
  run.advance(8);
  assert.deepEqual(storyteller(run).pending.find(row=>row.candidate==='harbor-recovery/pier-survey').blockers,['pressure']);
  assert.equal(storyteller(run).cadenceReady,true);
  assert.equal(dispatches(run).length,1);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('preflight validates every authored profile and reserves a distinct default pool',()=>{
  const source = world(), {stories} = source.storyDocuments[0];
  source.storyteller.active = 'exploratory';
  stories['drift-chart'].lifecycle.candidate.selection = {pool:'storyteller',weight:3};
  const {storyteller:settings} = R.storyPreflight(source);
  assert.deepEqual(settings.candidates[id('drift-chart')].selection,{pool:'storyteller',weight:48});
  assert.notEqual(settings.candidates[id('lightkeeper-map')].selection.pool,'storyteller');
  const invalid = copy(source);
  invalid.storyteller.profiles.volatile.cadence.maxInterval = 0.1;
  assert.throws(()=>R.storyPreflight(invalid),/volatile needs positive ordered cadence/);
  invalid.storyteller.profiles.volatile.cadence.maxInterval = 0.4;
  invalid.storyteller.profiles.generous.categoryWeights.discovery = 17;
  assert.throws(()=>R.storyPreflight(invalid),/generous needs integer weights/);
  delete invalid.storyteller.profiles.generous.categoryWeights.discovery;
  invalid.storyteller.profiles.generous.challenge.maxIntensity = 6;
  assert.throws(()=>R.storyPreflight(invalid),/generous needs a maximum intensity/);
  delete source.storyteller;
  const run = R.create(source);
  run.advance(1);
  assert.equal(dispatches(run).length,7);
  assert.equal(storyteller(run),undefined);
});
