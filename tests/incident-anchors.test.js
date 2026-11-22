const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;

const file = '../examples/story-documents/tide-calendar.world.json';
const early = require('../examples/story-documents/tide-calendar.early-signal.actions.json');
const late = require('../examples/story-documents/tide-calendar.late-signal.actions.json');
const missed = require('../examples/story-documents/tide-calendar.missed-bell.actions.json');
const copy = value=>JSON.parse(JSON.stringify(value));
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const id = story=>'tide-calendar/'+story;
const bell = id('tide-bell'), signal = id('beacon-signal'), check = id('equipment-check'), notice = id('quiet-notice');
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const anchors = run=>probe(run,'incident-anchors');
const anchor = (run,incident)=>anchors(run).anchors.find(row=>row.candidate===incident);
const releases = run=>run.history.filter(row=>row.kind==='story-candidate-dispatched');
const order = run=>releases(run).map(row=>[row.story,row.tick]);
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const manual = tick=>({tick,action:'world/dispatch-candidate',args:{incident:bell,reason:'manual-rehearsal'}});

test('a scheduled anchor reserves a cadence gap and a state anchor places on its matching tick',()=>{
  const world = source(), run = R.create(world);
  run.schedule(copy(early));
  const {incidentAnchors:authored,diagnostics} = R.storyPreflight(world);
  assert.deepEqual(diagnostics,[]);
  assert.deepEqual(authored[bell].window,{opensAt:6,closesBefore:7});
  assert.deepEqual(authored[signal].state.args,{account:'stock/signal'});
  run.advance(4);
  assert.deepEqual(anchors(run).reserved,{candidate:bell,opensAt:6});
  assert.deepEqual(order(run),[['market-preview',1]]);
  const resumed = restore(run.checkpoint());
  run.advance(8);
  assert.deepEqual(anchor(run,bell).terminal,{tick:6,reason:'authored-anchor'});
  assert.equal(anchor(run,signal).gate.evidence.value,1);
  assert.equal(anchor(run,signal).gate.evidence.tick,8);
  assert.equal(probe(run,'storyteller').nextAutomaticAt,11);
  assert.equal(run.history.find(row=>row.kind==='story-beat-entered').tick,6);
  assert.equal(run.history.find(row=>row.kind==='tide-bell-heard').tick,7);
  run.advance(18);
  resumed.advance(18);
  assert.deepEqual(order(run),[['market-preview',1],['tide-bell',6],['beacon-signal',8],['equipment-check',11],['visitor',14]]);
  const after = releases(run).find(row=>row.candidate===check);
  assert.deepEqual(after.variety.history,[{candidate:signal,tick:8}]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  const bad = copy(run.checkpoint());
  bad.incidentCandidateState[signal].anchor.evidence.value = 0;
  assert.throws(()=>restore(bad),/Invalid saved incident candidate/);
});

test('a late signal leaves room for a filler and a missed window can queue a follow-up',()=>{
  const later = R.create(source());
  later.schedule(copy(late));
  later.advance(18);
  assert.deepEqual(order(later),[['market-preview',1],['tide-bell',6],['equipment-check',9],['beacon-signal',10],['visitor',13]]);
  const outage = R.create(source());
  outage.schedule(copy(missed));
  outage.advance(6);
  assert.equal(anchor(outage,bell).gate.ready,true);
  assert.deepEqual(anchor(outage,bell).blockers,['feasibility']);
  const paused = restore(outage.checkpoint());
  paused.advance(18);
  assert.equal(anchor(paused,bell).status,'missed');
  assert.deepEqual(anchor(paused,bell).terminal,{tick:7,reason:'anchor-window-missed'});
  const expired = paused.history.find(row=>row.kind==='story-candidate-expired');
  assert.deepEqual(expired.followUp,{incident:notice,status:'queued'});
  assert.deepEqual(order(paused),[['market-preview',1],['equipment-check',6],['beacon-signal',8],['visitor',11],['quiet-notice',14]]);
  assert.equal(paused.history.some(row=>row.kind==='tide-bell-heard'),false);
});

test('an event-triggered anchor waits through the opening and can match on the last tick',()=>{
  const world = source(), {stories} = world.storyDocuments[0], {candidate} = stories['tide-bell'].lifecycle;
  stories['tide-bell'].triggers = {request:{event:{kind:'crew-list-posted'}}};
  candidate.for = 0.3;
  candidate.anchor.window.until = 0.8;
  candidate.anchor.state = {field:'world/account',args:{account:'stock/signal'},when:{path:'/balance',value:1}};
  const run = R.create(world);
  run.schedule(copy(early));
  run.advance(4);
  assert.equal(anchor(run,bell).queuedAt,2);
  assert.equal(anchor(run,bell).expiresAt,9);
  assert.equal(anchor(run,bell).gate.reason,'before-anchor-window');
  assert.equal(anchors(run).reserved,null);
  run.advance(6);
  assert.equal(anchor(run,bell).gate.reason,'anchor-condition-unmet');
  run.advance(9);
  assert.equal(anchor(run,bell).terminal.tick,8);
  assert.equal(anchor(run,signal).terminal.tick,9);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('overlapping anchors use the earliest expiry and a manual request cannot bypass their timing',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  delete world.storyteller;
  stories['beacon-signal'].lifecycle.candidate.anchor = {window:{from:0.6,until:0.8}};
  const run = R.create(world);
  run.schedule([manual(4),manual(6)]);
  run.advance(7);
  assert.deepEqual(order(run).slice(-2),[['tide-bell',6],['beacon-signal',7]]);
  assert.deepEqual(run.history.filter(row=>row.kind==='story-candidate-rejected').map(row=>row.reason),
    ['authored-anchor-managed','authored-anchor-managed']);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('anchors still require their pressure capacity and completed recovery',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  world.incidentPressure = {limits:{danger:0}};
  stories['tide-bell'].lifecycle.candidate.pressure = {danger:1};
  stories['market-preview'].lifecycle.cooldown = {for:{world:0.5}};
  const run = R.create(world);
  run.schedule([...copy(early),{tick:3,action:'world/story-transition',args:{
    document:'tide-calendar',story:'market-preview',to:'completed',outcome:'open',reason:'market-closed'
  }}]);
  run.advance(6);
  assert.deepEqual(anchor(run,bell).blockers,['pressure','recovery-cooldown']);
  run.advance(8);
  assert.deepEqual(anchor(run,signal).blockers,['recovery-cooldown']);
  run.advance(9);
  assert.equal(anchor(run,signal).terminal.tick,9);
  assert.equal(anchor(run,bell).status,'missed');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('preflight validates clock resolution, known state queries and dedicated automatic placement',()=>{
  const world = source(), doc = world.storyDocuments[0], {stories} = doc;
  const {candidate} = stories['tide-bell'].lifecycle;
  candidate.release = 'manual';
  assert.throws(()=>validateStoryDocument(doc),/anchor requires automatic release/);
  candidate.release = 'automatic';
  candidate.anchor.window.from = 0.7;
  assert.throws(()=>validateStoryDocument(doc),/expected ordered nonnegative world seconds/);
  candidate.anchor.window.from = 0.65;
  candidate.anchor.window.until = 0.66;
  assert.throws(()=>R.storyPreflight(world),/Anchor window contains no world tick/);
  candidate.anchor.window.from = 0.6;
  stories['tide-bell'].lifecycle.deadlines = {world:{at:0.6}};
  assert.throws(()=>R.storyPreflight(world),/Story deadline leaves no time for authored anchor/);
  delete stories['tide-bell'].lifecycle.deadlines;
  stories['beacon-signal'].lifecycle.candidate.anchor.state.field = 'world/unknown';
  assert.throws(()=>R.storyPreflight(world),/Unknown anchor query field/);
});
