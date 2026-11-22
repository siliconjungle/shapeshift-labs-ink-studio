const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');

const directory = '../examples/story-documents/';
const copy = value=>JSON.parse(JSON.stringify(value));
const example = file=>copy(require(directory+file));
const source = ()=>{
  const file = 'quay-candidates.world.json';
  return embedStoryDocuments(example(file),path.resolve(__dirname,directory+file));
};
const {runtime:R,storyEvents:E} = load().KIT.world;
const repair = 'quay-opportunities/repair-shift', barge = 'quay-opportunities/relief-barge';
const survey = 'quay-opportunities/survey-window', ferry = 'quay-followups/shallow-load';
const query = (run,field,args)=>run.query().probe(field,undefined,args).value;
const queue = (run,args)=>query(run,'world/incident-candidates',args);
const row = (run,incident)=>{
  const {ready,blocked,closed} = queue(run,{incident});
  return [...ready,...blocked,...closed][0];
};
const story = (run,incident)=>query(run,'world/story-lifecycle')[incident];
const stock = (run,name)=>query(run,'world/account',{account:'stock/'+name}).balance;
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const dispatch = (tick,incident)=>({tick,action:'world/dispatch-candidate',args:{incident,reason:'scheduled-selection'}});

test('a pending candidate can move back and forth between ready and blocked before the offer opens',()=>{
  const world = source(), run = R.create(world,{traceSteps:2});
  assert.equal(R.storyPreflight(world).incidentCandidates[repair].windowTicks,10);
  assert(run.query().inspect().actions.includes('world/dispatch-candidate'));
  run.schedule(example('quay-candidates.actions.json'));
  run.advance(1);
  assert.equal(row(run,repair).status,'blocked');
  assert.equal(story(run,repair),null);
  run.advance(2);
  assert.equal(row(run,repair).status,'ready');
  assert.equal(run.stepFrame().boundary.incidentCandidateState[repair].status,'ready');
  assert.equal(story(run,repair),null);
  assert.equal(stock(run,'work'),0);
  run.advance(3);
  assert.equal(row(run,repair).status,'blocked');
  assert.deepEqual(row(run,repair).report.checks.timber.actual.blockers,['source']);
  const resumed = restore(run.checkpoint());
  run.advance(6);
  resumed.advance(6);
  assert.equal(row(run,repair).status,'dispatched');
  assert.deepEqual(row(run,repair).source.evidence.events,['1.0']);
  assert.equal(story(run,repair).outcome,'provisioned');
  assert.deepEqual(query(run,'world/story-feasibility',{story:repair}).request,{tick:1,source:row(run,repair).source});
  assert.equal(stock(run,'work'),2);
  assert.deepEqual(run.history.filter(event=>event.kind==='story-candidate-rejected').map(event=>event.reason),
    ['candidate-blocked','candidate-expired']);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
});

test('expiry can close an unused opportunity or queue a linked follow-up from another document',()=>{
  const run = R.create(source());
  run.advance(5);
  assert.deepEqual(row(run,barge).followUp,{incident:ferry,status:'queued'});
  assert.deepEqual(row(run,ferry).origin,{kind:'follow-up',incident:barge});
  assert.equal(row(run,ferry).queuedAt,row(run,barge).terminal.tick);
  assert.equal(row(run,ferry).status,'dispatched');
  assert.equal(row(run,survey).status,'expired');
  assert.equal(row(run,survey).report.ready,true);
  assert.equal(story(run,barge),null);
  assert.equal(query(run,'world/incident-catalog',{incident:barge}).incidents[0].status,'expired');
  run.advance(9);
  assert.equal(stock(run,'ferry'),1);
  assert.equal(stock(run,'pier'),0);
  assert.equal(run.history.find(event=>event.kind==='ferry-alternative-announced').tick,6);
  const report = E.analyze(run.recording(),{story:barge});
  assert(report.timeline.some(({event})=>event.kind==='relief-barge-spotted'));
  const damaged = copy(run.checkpoint());
  damaged.incidentCandidateState[ferry].origin.incident = survey;
  assert.throws(()=>restore(damaged),/Invalid saved incident candidate/);
});

test('an automatic candidate can clear its blocker before expiry and leave the follow-up dormant',()=>{
  const run = R.create(source());
  run.schedule(example('quay-candidates.berth.actions.json'));
  run.advance(9);
  assert.equal(row(run,barge).status,'dispatched');
  assert.equal(row(run,barge).terminal.tick,4);
  assert.equal(row(run,ferry),undefined);
  assert.equal(story(run,ferry),null);
  assert.equal(stock(run,'pier'),2);
  assert.equal(stock(run,'ferry'),0);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('world deadlines beat selection and a follow-up closes or deduplicates coherently',()=>{
  const world = source(), definitions = world.storyDocuments[0].stories, follow = world.storyDocuments[1].stories['shallow-load'];
  definitions['relief-barge'].lifecycle.deadlines = {world:{at:0.3}};
  follow.lifecycle.deadlines = {world:{at:0.3}};
  const run = R.create(world);
  run.schedule([dispatch(3,barge)]);
  run.advance(3);
  assert.equal(row(run,barge).terminal.reason,'world-deadline');
  assert.deepEqual(row(run,barge).followUp,{incident:ferry,status:'closed'});
  assert.equal(story(run,barge).transitions[0].to,'expired');
  assert.equal(row(run,ferry),undefined);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());

  delete definitions['relief-barge'].lifecycle.deadlines;
  delete follow.lifecycle.deadlines;
  definitions['survey-window'].lifecycle.candidate.onExpire = ferry;
  const converged = R.create(world);
  converged.advance(6);
  assert.deepEqual(row(converged,survey).followUp,{incident:ferry,status:'already-queued'});
  assert.deepEqual(row(converged,ferry).origin,{kind:'follow-up',incident:barge});
  assert.deepEqual(restore(converged.checkpoint()).checkpoint(),converged.checkpoint());
});

test('automatic releases give the older candidate the first chance to post activation costs',()=>{
  const world = source(), document = world.storyDocuments[0];
  const early = document.stories['repair-shift'], late = copy(early);
  for (const item of [early,late]) {
    item.lifecycle.candidate.release = 'automatic';
    item.lifecycle.settlement = {costs:{timber:copy(item.lifecycle.settlement.outcomes.provisioned.timber)}};
  }
  late.triggers.crew.event.kind = 'later-crew';
  document.stories = {'z-older':early,'a-newer':late};
  world.storyDocuments.pop();
  world.eventActions = {};
  world.commands = [
    world.commands[0],
    {tick:2,action:'world/event',args:{kind:'later-crew'}},
    {...world.commands[2],tick:3}
  ];
  const run = R.create(world);
  run.advance(3);
  assert.deepEqual(queue(run).closed.map(item=>item.candidate),['quay-opportunities/z-older','quay-opportunities/a-newer']);
  assert.equal(story(run,'quay-opportunities/z-older').status,'active');
  assert.equal(story(run,'quay-opportunities/a-newer').status,'available');
  assert.equal(stock(run,'work'),2);
});

test('preflight rejects missing or cyclic follow-ups, and dispatch requires a queued definition',()=>{
  const world = source(), bargePolicy = world.storyDocuments[0].stories['relief-barge'].lifecycle.candidate;
  const ferryPolicy = world.storyDocuments[1].stories['shallow-load'].lifecycle.candidate;
  bargePolicy.onExpire = 'missing';
  assert.throws(()=>R.storyPreflight(world),/Unknown queued follow-up/);
  bargePolicy.onExpire = ferry;
  ferryPolicy.onExpire = barge;
  assert.throws(()=>R.storyPreflight(world),/Candidate follow-up cycle/);
  delete ferryPolicy.onExpire;
  delete bargePolicy.onExpire;
  assert.throws(()=>R.storyPreflight(world),/needs an authored trigger or an incoming follow-up/);
  bargePolicy.onExpire = ferry;
  assert.throws(()=>R.create(world).schedule([dispatch(4,'not/a-candidate')]),/registered incident and a reason/);
});
