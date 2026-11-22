const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const {runtime:R,storyEvents} = load().KIT.world;

const file = '../examples/story-documents/harbor-recovery.world.json';
const overlap = require('../examples/story-documents/harbor-recovery.overlap.actions.json');
const copy = value=>JSON.parse(JSON.stringify(value));
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const id = story=>'harbor-recovery/'+story;
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const windows = (run,args)=>probe(run,'incident-cooldowns',args);
const choices = run=>probe(run,'incident-selections').selections;
const dispatches = run=>choices(run).map(({winner,tick})=>[winner.split('/')[1],tick]);
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
function candidate(run,story) {
  const {ready,blocked,closed} = probe(run,'incident-candidates',{incident:id(story)});
  return [...ready,...blocked,...closed][0];
}

test('a setback pauses the world then releases matching locations, characters, factions and incident families independently',()=>{
  const world = source(), run = R.create(world);
  const policies = R.storyPreflight(world).incidentCooldowns;
  assert.deepEqual(policies[id('mira-escort')].scopes,{character:['crew/mira']});
  assert.deepEqual(policies[id('flood')].ticks,{world:2,location:4,character:6,faction:3,family:5});
  run.advance(2);
  assert.deepEqual(windows(run).active,[]);
  assert.equal(windows(run).scheduled.length,5);
  run.advance(3);
  assert.equal(probe(run,'incident-candidates').blocked.length,5);
  assert.equal(candidate(run,'pier-survey').report.ready,true);
  assert.deepEqual(candidate(run,'pier-survey').cooldown.blocks.map(row=>row.scope),['world','location']);
  assert.equal(candidate(run,'pier-survey').cooldown.readyAt,7);
  assert.deepEqual(windows(run,{scope:'character',id:'crew/mira'}).active,[{
    scope:'character',id:'crew/mira',source:id('flood'),status:'failed',closedAt:2,from:3,until:9
  }]);
  const rejection = run.history.find(row=>row.kind==='story-candidate-rejected');
  assert.equal(rejection.reason,'incident-cooling-down');
  assert.deepEqual(rejection.cooldown,candidate(run,'pier-survey').cooldown);
  run.advance(5);
  assert.deepEqual(dispatches(run),[['ridge-market',5]]);
  assert.equal(choices(run)[0].candidates.filter(row=>row.status==='blocked').length,4);
  run.advance(12);
  assert.deepEqual(dispatches(run),[['ridge-market',5],['union-meeting',6],['pier-survey',7],['dam-watch',8],['mira-escort',9]]);
  assert.deepEqual(windows(run),{tick:12,active:[],scheduled:[]});
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('overlapping windows keep the latest release per scope through checkpoint restore and replay',()=>{
  const run = R.create(source());
  run.schedule(copy(overlap));
  run.advance(5);
  const resumed = restore(run.checkpoint());
  assert.equal(windows(run,{scope:'family'}).active[0].until,8);
  assert.equal(windows(run,{scope:'family'}).scheduled[0].until,12);
  run.advance(6);
  const [location] = windows(run,{scope:'location'}).active;
  const [family] = windows(run,{scope:'family'}).active;
  assert.deepEqual([location.source,location.until],[id('flood'),7]);
  assert.deepEqual([family.source,family.until],[id('lock-outage'),12]);
  assert.equal(candidate(run,'dam-watch').cooldown.readyAt,12);
  const corrupted = copy(run.checkpoint());
  corrupted.incidentCandidateState[id('dam-watch')].cooldown.blocks[0].until--;
  assert.throws(()=>restore(corrupted),/Invalid saved incident candidate/);
  run.advance(12);
  resumed.advance(12);
  assert.deepEqual(dispatches(run),[['ridge-market',5],['union-meeting',6],['pier-survey',7],['mira-escort',9],['dam-watch',12]]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  assert.deepEqual(storyEvents.read(run.recording()).events.filter(row=>row.kind==='story-cooldown-started')
    .map(({story,tick})=>[story,tick]),[['flood',2],['lock-outage',5]]);
});

test('clocks respect closure policy and candidate expiry and combine with pressure limits',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  assert.doesNotThrow(()=>validateStoryDocument(world.storyDocuments[0]));
  stories['mira-escort'].lifecycle.candidate.for = 0.3;
  stories['ridge-market'].lifecycle.candidate.pressure = {travel:1};
  world.incidentPressure = {limits:{travel:0}};
  const run = R.create(world);
  run.advance(4);
  const market = candidate(run,'ridge-market');
  assert.equal(market.cooldown.ready,false);
  assert.equal(market.pressure.ready,false);
  run.advance(6);
  assert.equal(candidate(run,'ridge-market').cooldown.ready,true);
  assert.equal(candidate(run,'ridge-market').status,'blocked');
  assert.equal(candidate(run,'mira-escort').status,'expired');
  assert.equal(candidate(run,'mira-escort').terminal.tick,6);
  assert.equal(candidate(run,'mira-escort').cooldown.readyAt,9);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  world.commands[1].args.to = 'completed';
  const completed = R.create(world);
  completed.advance(3);
  assert.deepEqual(windows(completed).active,[]);
  assert.equal(candidate(completed,'pier-survey').terminal.tick,3);
});

test('validation rejects unsupported scope keys, unbound or non-ID role values and invalid durations',()=>{
  const world = source(), document = world.storyDocuments[0], {stories} = document;
  const policy = stories.flood.lifecycle.cooldown;
  policy.for.faction = 0;
  assert.throws(()=>validateStoryDocument(document),/cooldown.for.faction.*positive/);
  policy.for.faction = 0.1;
  delete policy.scopes.faction;
  assert.throws(()=>validateStoryDocument(document),/cooldown.for.faction.*scope IDs/);
  delete policy.for.faction;
  policy.scopes.category = ['setback'];
  assert.throws(()=>validateStoryDocument(document),/cooldown.scopes.category.*unknown/);
  delete policy.scopes.category;
  const {escort} = stories['mira-escort'].roles;
  delete escort.ref;
  assert.throws(()=>R.storyPreflight(world),/Missing story role binding/);
  world.storyBindings = {[id('mira-escort')]:{escort:{kind:'character',value:{agent:'mira'}}}};
  assert.throws(()=>R.storyPreflight(world),/cooldown.scopes.character.*scope ID/);
  world.storyBindings[id('mira-escort')].escort.value = 'crew/mira';
  policy.for.world = 1e99;
  assert.throws(()=>R.storyPreflight(world),/cooldown exceeds the world tick budget/);
});
