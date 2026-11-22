const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const {runtime:R} = load().KIT.world;

const file = '../examples/story-documents/pressure-shifts.world.json';
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const copy = value=>JSON.parse(JSON.stringify(value));
const id = name=>'pressure-shifts/'+name;
const rescue = id('rescue-shift'), supply = id('supply-shift'), mediation = id('mediation'), ridge = id('ridge-watch');
const probe = (run,field,args)=>run.query().probe(field,undefined,args).value;
const pressure = run=>probe(run,'world/incident-pressure');
const selections = run=>probe(run,'world/incident-selections').selections;
const status = (run,key)=>probe(run,'world/story-lifecycle')[key]?.status;
const candidate = (run,incident)=>{
  const rows = probe(run,'world/incident-candidates',{incident});
  return [...rows.ready,...rows.blocked,...rows.closed][0];
};
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const dispatch = (tick,incident)=>({tick,action:'world/dispatch-candidate',args:{incident,reason:'dispatch-at-once'}});
const loads = run=>Object.fromEntries(Object.entries(pressure(run).dimensions).map(([key,row])=>[key,row.used]));

test('commitments and independent pressure dimensions block, pause and release with native lifecycle',()=>{
  const world = source(), run = R.create(world);
  assert.deepEqual(R.storyPreflight(world).incidentPressure.demands[rescue],{danger:2,travel:1});
  run.advance(2);
  assert.deepEqual(pressure(run).commitments,{limit:2,used:2,remaining:0});
  assert.deepEqual(loads(run),{danger:2,scarcity:2,'social-tension':0,travel:2});
  assert.deepEqual(candidate(run,mediation).pressure.blockers,[{kind:'commitments'}]);
  assert.deepEqual(candidate(run,ridge).pressure.blockers,[
    {kind:'commitments'},{kind:'pressure',id:'danger'},{kind:'pressure',id:'travel'}
  ]);
  run.advance(4);
  assert.equal(status(run,supply),'completed');
  assert.deepEqual(pressure(run).holds.map(row=>[row.candidate,row.status]),[[mediation,'active'],[rescue,'suspended']]);
  assert.deepEqual(loads(run),{danger:2,scarcity:0,'social-tension':1,travel:1});
  assert.equal(run.history.find(row=>row.kind==='story-candidate-rejected').reason,'pressure-budget-exhausted');
  assert.deepEqual(selections(run)[0].candidates.map(row=>[row.candidate,row.status]),[[mediation,'eligible'],[ridge,'blocked']]);
  const resumed = restore(run.checkpoint());
  run.advance(6);
  assert.equal(pressure(run).commitments.remaining,1);
  assert.deepEqual(candidate(run,ridge).pressure.blockers,[{kind:'pressure',id:'danger'}]);
  assert.equal(candidate(run,ridge).report.ready,true);
  run.advance(10);
  resumed.advance(10);
  assert.deepEqual(selections(run).map(({tick,winner})=>[tick,winner]),[[4,mediation],[8,ridge]]);
  assert.deepEqual(loads(run),{danger:0,scarcity:0,'social-tension':0,travel:0});
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  const bad = copy(run.checkpoint());
  bad.incidentCandidateState[ridge].pressure.dimensions.danger.used = 99;
  assert.throws(()=>restore(bad),/Invalid saved incident candidate/);
});

test('capacity is reserved between manual choices and independently weighted pools on the same tick',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  world.incidentPressure.commitments = 1;
  stories['rescue-shift'].lifecycle.candidate.release = 'manual';
  stories['supply-shift'].lifecycle.candidate.release = 'manual';
  const explicit = R.create(world);
  explicit.schedule([dispatch(1,supply),dispatch(1,rescue)]);
  explicit.advance(1);
  assert.equal(status(explicit,supply),'active');
  assert.equal(status(explicit,rescue),undefined);
  assert.equal(candidate(explicit,rescue).status,'blocked');
  assert.equal(pressure(explicit).commitments.used,1);
  for (const name of ['rescue-shift','supply-shift']) {
    const settings = stories[name].lifecycle.candidate;
    settings.release = 'automatic';
    settings.selection = {pool:name,weight:1};
  }
  const pools = R.create(world);
  pools.advance(1);
  assert.deepEqual(selections(pools).map(row=>row.winner),[rescue]);
  assert.equal(candidate(pools,supply).status,'blocked');
  assert.equal(pressure(pools).commitments.used,1);
  assert.deepEqual(restore(pools.checkpoint()).checkpoint(),pools.checkpoint());
});

test('weighted receipts keep eligibility from before the winning commitment takes the remaining seat',()=>{
  const world = source();
  world.incidentPressure.limits.danger = 3;
  const run = R.create(world);
  run.advance(4);
  const [choice] = selections(run);
  assert.equal(choice.reason,'seeded-weighted-draw');
  assert.deepEqual(choice.candidates.map(row=>row.status),['eligible','eligible']);
  const loser = choice.candidates.find(row=>row.candidate!==choice.winner).candidate;
  assert.equal(candidate(run,loser).status,'blocked');
  assert.equal(candidate(run,loser).pressure.blockers[0].kind,'commitments');
  const resumed = restore(run.checkpoint());
  run.advance(10);
  resumed.advance(10);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
});

test('unaccepted offers hold pressure until expiry and free capacity the next tick',()=>{
  const world = source(), {lifecycle} = world.storyDocuments[0].stories['rescue-shift'];
  lifecycle.activation = 'manual';
  lifecycle.offerFor = 0.2;
  world.incidentPressure.commitments = 1;
  world.commands = world.commands.slice(0,2);
  const run = R.create(world);
  run.advance(2);
  assert.equal(pressure(run).holds[0].status,'available');
  assert.equal(candidate(run,supply).status,'blocked');
  run.advance(3);
  assert.equal(status(run,rescue),'expired');
  assert.equal(pressure(run).commitments.used,0);
  run.advance(4);
  assert.equal(status(run,supply),'active');
  assert.equal(pressure(run).commitments.used,1);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('authored loads remain measurable without caps and invalid budgets fail preflight',()=>{
  const world = source();
  delete world.incidentPressure;
  const run = R.create(world);
  run.advance(2);
  assert.deepEqual(pressure(run).commitments,{used:3,limit:null,remaining:null});
  assert.equal(pressure(run).dimensions.danger.limit,null);
  world.incidentPressure = {commitments:-1};
  assert.throws(()=>R.storyPreflight(world),/Incident pressure needs a commitment limit/);
  world.incidentPressure = {limits:{danger:-1}};
  assert.throws(()=>R.storyPreflight(world),/integer pressure limits/);
  const settings = world.storyDocuments[0].stories['rescue-shift'].lifecycle.candidate;
  settings.pressure.danger = 0.5;
  assert.throws(()=>validateStoryDocument(world.storyDocuments[0]),/expected integer pressure units/);
});
