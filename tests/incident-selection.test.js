const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const {runtime:R,storyEvents:E} = load().KIT.world;

const file = '../examples/story-documents/landing-selection.world.json';
const pool = 'relief-landing', canal = 'landing-selection/canal', ridge = 'landing-selection/ridge';
const copy = value=>JSON.parse(JSON.stringify(value));
const source = (seed=1)=>({...embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file)),seed});
const query = (run,field,args)=>run.query().probe(field,undefined,args).value;
const selections = (run,args)=>query(run,'world/incident-selections',args).selections;
const stock = (run,name)=>query(run,'world/account',{account:'supplies/'+name}).balance;
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const dispatch = incident=>({tick:3,action:'world/dispatch-candidate',args:{incident,reason:'operator-selected'}});

test('a seeded selection records eligible weights, exclusions, the draw, and the outcome',()=>{
  const world = source(), run = R.create(world);
  assert.deepEqual(R.storyPreflight(world).incidentCandidates[canal].selection,{pool,weight:3});
  run.advance(2);
  assert.deepEqual(selections(run),[]);
  const resumed = restore(run.checkpoint());
  run.advance(5);
  resumed.advance(5);
  const [receipt] = selections(run,{pool,winner:canal});
  assert.equal(receipt.algorithm,'weighted-ticket-v1');
  assert.equal(receipt.seed,1);
  assert.equal(receipt.tick,3);
  assert.equal(receipt.winner,canal);
  assert.equal(receipt.totalWeight,4);
  assert.equal(receipt.reason,'seeded-weighted-draw');
  assert.equal(receipt.draw.ticket,0);
  assert.deepEqual(receipt.candidates.map(({candidate,queuedAt,weight,status,tickets})=>[
    candidate,queuedAt,weight,status,tickets?.from,tickets?.to
  ]),[
    [canal,1,3,'eligible',0,3],
    ['landing-selection/deep-quay',1,100,'blocked',undefined,undefined],
    [ridge,1,1,'eligible',3,4],
    ['landing-selection/survey',1,0,'zero-weight',undefined,undefined]
  ]);
  assert.deepEqual([stock(run,'canal'),stock(run,'ridge')],[2,0]);
  assert.equal(run.history.find(row=>row.kind==='landing-selected').route,'canal');
  const event = E.analyze(run.recording(),{story:canal}).timeline.find(({event})=>event.kind==='story-candidate-selected');
  assert.deepEqual(event.event.selection,receipt);
  assert.equal(query(run,'world/incident-candidates',{incident:canal}).closed[0].terminal.reason,receipt.reason);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(copy(run.recording())).checkpoint(),run.checkpoint());
  const damaged = copy(run.checkpoint());
  damaged.incidentCandidateState[canal].selection.draw.ticket = 3;
  assert.throws(()=>restore(damaged),/Invalid saved incident selection/);
  damaged.incidentCandidateState[canal].selection.candidates.pop();
  assert.throws(()=>restore(damaged),/Invalid saved incident selection/);
});

test('changing the world seed or relative weights changes the deterministic choice',()=>{
  const seed = R.create(source(3));
  seed.advance(5);
  assert.deepEqual([selections(seed)[0].winner,selections(seed)[0].draw.ticket],[ridge,3]);
  assert.deepEqual([stock(seed,'canal'),stock(seed,'ridge')],[0,2]);
  const baseline = R.create(source(2)), changed = source(2);
  const {canal:low,ridge:high} = changed.storyDocuments[0].stories;
  low.lifecycle.candidate.selection.weight = 1;
  high.lifecycle.candidate.selection.weight = 3;
  const weighted = R.create(changed);
  baseline.advance(5);
  weighted.advance(5);
  assert.deepEqual([selections(baseline)[0].winner,selections(weighted)[0].winner],[canal,ridge]);
  assert.equal(selections(baseline)[0].draw.ticket,selections(weighted)[0].draw.ticket);
});

test('equal weights use queue age and qualified ID as stable ticket order',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  stories.canal.lifecycle.candidate.selection.weight = 1;
  const reversed = copy(world);
  reversed.storyDocuments[0].stories = Object.fromEntries(Object.entries(reversed.storyDocuments[0].stories).reverse());
  const ordered = R.create(world), shuffled = R.create(reversed);
  ordered.advance(5);
  shuffled.advance(5);
  assert.deepEqual(selections(shuffled),selections(ordered));
  assert.deepEqual(selections(ordered)[0].candidates.filter(row=>row.status==='eligible').map(row=>row.candidate),[canal,ridge]);
  stories.canal.triggers.manifest.event.kind = 'later-canal-manifest';
  world.commands.push({tick:2,action:'world/event',args:{kind:'later-canal-manifest'}});
  const aged = R.create(world);
  aged.advance(3);
  assert.deepEqual(selections(aged)[0].candidates.filter(row=>row.status==='eligible').map(row=>row.candidate),[ridge,canal]);
});

test('manual dispatch precedes weighted selection and the only eligible candidate records its reason',()=>{
  const run = R.create(source());
  run.schedule([dispatch(ridge),dispatch('landing-selection/survey')]);
  run.advance(5);
  const [receipt] = selections(run);
  assert.equal(receipt.winner,canal);
  assert.equal(receipt.draw,null);
  assert.equal(receipt.reason,'only-eligible-candidate');
  assert.deepEqual(receipt.candidates.map(row=>row.candidate),[canal,'landing-selection/deep-quay']);
  assert.equal(query(run,'world/incident-candidates',{incident:ridge}).closed[0].terminal.reason,'operator-selected');
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('each pool releases one candidate per tick while other eligible candidates can wait for the next draw',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  for (const item of Object.values(stories)) item.lifecycle.candidate.for = 0.6;
  stories.survey.lifecycle.candidate.selection = {pool:'survey',weight:1};
  world.systems.supplies.config.accounts.cache.initial = 4;
  const run = R.create(world);
  run.advance(3);
  assert.equal(query(run,'world/incident-candidates',{incident:ridge}).ready[0].candidate,ridge);
  assert.deepEqual(selections(run).map(row=>[row.pool,row.tick]),[['survey',1],[pool,3]]);
  run.advance(6);
  assert.deepEqual(selections(run,{pool}).map(({winner,tick,reason})=>[winner,tick,reason]),[
    [canal,3,'seeded-weighted-draw'],[ridge,4,'only-eligible-candidate']
  ]);
  assert.deepEqual([stock(run,'canal'),stock(run,'ridge')],[2,2]);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('zero-weight pools stay queued and invalid authoring options fail validation',()=>{
  const world = source(), document = world.storyDocuments[0], policy = document.stories.canal.lifecycle.candidate;
  for (const item of Object.values(document.stories)) item.lifecycle.candidate.selection.weight = 0;
  const run = R.create(world);
  run.advance(3);
  assert.deepEqual(selections(run),[]);
  assert.equal(query(run,'world/incident-candidates').ready.length,3);
  run.advance(5);
  assert.equal(query(run,'world/incident-candidates').closed.every(row=>row.status==='expired'),true);
  for (const weight of [-1,1.5,1000001]) {
    policy.selection.weight = weight;
    assert.throws(()=>validateStoryDocument(document),/integer weight from 0 to 1000000/);
  }
  policy.selection.weight = 1;
  policy.release = 'manual';
  assert.throws(()=>validateStoryDocument(document),/weighted selection requires automatic release/);
});
