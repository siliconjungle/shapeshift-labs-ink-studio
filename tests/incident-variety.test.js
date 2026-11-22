const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load,validateStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;

const file = '../examples/story-documents/harbor-rotation.world.json';
const copy = value=>JSON.parse(JSON.stringify(value));
const source = ()=>embedStoryDocuments(copy(require(file)),path.resolve(__dirname,file));
const id = story=>'harbor-rotation/'+story;
const names = ['a-bank-call','b-bridge-bell','c-mira-survey','d-bank-lantern','e-upland-water','f-night-market'];
const [bank,bell,survey,lantern,watch,market] = names.map(id);
const probe = (run,field,args)=>run.query().probe('world/'+field,undefined,args).value;
const releases = run=>run.history.filter(row=>row.kind==='story-candidate-dispatched');
const restore = saved=>R.create(saved.world,{checkpoint:copy(saved)});
const choices = report=>Object.fromEntries(report.considered.map(({candidate,repeated})=>
  [candidate,Object.fromEntries(Object.entries(repeated).map(([axis,indices])=>
    [axis,indices.map(index=>report.history[index].candidate)]))]));

test('rotation defers repeated casts, places, families and reskinned situations at the same cadence',()=>{
  const world = source(), rotated = R.create(world);
  const {identities,repeats} = R.storyPreflight(world).incidentVariety;
  assert.deepEqual(identities[bank].cast,['crew/mira']);
  assert.deepEqual(identities[watch].family,['flood']);
  assert.equal(identities[bank].situation.source,'mechanics');
  assert.deepEqual(repeats,[{situation:identities[bank].situation,incidents:[bank,bell]}]);
  rotated.advance(3);
  const last = probe(rotated,'incident-variety').last;
  assert.equal(last.winner,market);
  assert.deepEqual(choices(last),{
    [bell]:{situation:[bank]},[survey]:{cast:[bank]},[lantern]:{location:[bank]},[watch]:{family:[bank]},[market]:{}
  });
  const resumed = restore(rotated.checkpoint());
  rotated.advance(13);
  resumed.advance(13);
  world.storyteller.active = 'sequence';
  const sequential = R.create(world);
  sequential.advance(13);
  assert.deepEqual(releases(rotated).map(row=>row.candidate),[bank,market,survey,bell,watch,lantern]);
  assert.deepEqual(releases(sequential).map(row=>row.candidate),[bank,bell,survey,lantern,watch,market]);
  assert.deepEqual(releases(rotated).map(row=>row.tick),releases(sequential).map(row=>row.tick));
  assert.deepEqual(probe(sequential,'incident-variety').repeats,repeats);
  assert.deepEqual(resumed.checkpoint(),rotated.checkpoint());
  assert.deepEqual(R.replay(copy(rotated.recording())).checkpoint(),rotated.checkpoint());
});

test('variety runs ahead of weighted draws, respects pressure and verifies saved preferences',()=>{
  const world = source(), {stories} = world.storyDocuments[0];
  stories[names[1]].lifecycle.candidate.selection = {pool:'harbor',weight:100};
  stories[names[5]].lifecycle.candidate.selection = {pool:'harbor',weight:1};
  world.incidentPressure = {commitments:1};
  const run = R.create(world);
  run.advance(3);
  const [picked] = probe(run,'incident-selections').selections;
  assert.deepEqual(picked.candidates.map(row=>[row.candidate,row.weight,row.status]),[
    [bell,100,'blocked'],[market,1,'eligible']
  ]);
  assert.equal(picked.winner,market);
  assert.equal(probe(run,'incident-pressure').commitments.used,1);
  run.advance(5);
  assert.equal(releases(run).length,2);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  const bad = copy(run.checkpoint());
  bad.incidentCandidateState[market].variety.considered.find(row=>row.candidate===bell).score.situation = 0;
  assert.throws(()=>restore(bad),/Invalid saved variety decision/);
});

test('forced releases inform rotation and a repeated candidate can still use an otherwise empty beat',()=>{
  const run = R.create(source());
  run.schedule([{tick:3,action:'world/dispatch-candidate',args:{incident:survey,reason:'inspect-the-orchard'}}]);
  run.advance(3);
  assert.equal(releases(run)[1].storyteller.mode,'manual');
  assert.equal(releases(run)[1].variety,undefined);
  const manualHistory = probe(run,'incident-variety').last;
  assert.deepEqual(manualHistory.history,[{candidate:survey,tick:3},{candidate:bank,tick:1}]);
  assert.equal(manualHistory.winner,lantern);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
  const sparse = source(), {stories} = sparse.storyDocuments[0];
  for (const name of names.slice(2)) delete stories[name];
  const onlyRepeat = R.create(sparse);
  onlyRepeat.advance(3);
  const last = probe(onlyRepeat,'incident-variety').last;
  assert.equal(last.winner,bell);
  assert.deepEqual(last.preferred,[bell]);
  assert.deepEqual(last.considered[0].score,{situation:1,total:1});
});

test('changed mechanics stay distinct and authored situation IDs can span template instances',()=>{
  const world = source(), doc = world.storyDocuments[0], {stories} = doc;
  stories[names[1]].stages['stage-stock'].objectives.stock.params.amount = 3;
  const changed = R.storyPreflight(world).incidentVariety;
  assert.deepEqual(changed.repeats,[]);
  assert.notDeepEqual(changed.identities[bank].situation,changed.identities[bell].situation);
  const definition = copy(stories[names[0]]);
  definition.title = {$param:'headline'};
  definition.incident.variety.situation = 'stock/braces';
  definition.incident.variety.location = [{$param:'site'}];
  definition.stages['stage-stock'].objectives.stock.params.amount = {$param:'amount'};
  const template = {format:'ink-studio/story-template',version:1,id:'brace-request',revision:1,
    parameters:{headline:{type:'string'},site:{type:'string'},amount:{type:'integer'}},
    document:{references:doc.references,stories:{request:definition}}};
  delete world.storyDocuments;
  world.storyTemplates = [
    {id:'bank',template,parameters:{headline:'Bank crew calls',site:'harbor/bank',amount:2}},
    {id:'bridge',template,parameters:{headline:'Bridge crew calls',site:'upland/bridge',amount:3}}
  ];
  const {identities,repeats} = R.storyPreflight(world).incidentVariety;
  assert.deepEqual(identities['bridge/request'].location,['upland/bridge']);
  assert.deepEqual(repeats,[{situation:{source:'authored',id:'stock/braces'},incidents:['bank/request','bridge/request']}]);
});

test('invalid identities and history lengths fail preflight',()=>{
  const world = source(), doc = world.storyDocuments[0], variety = doc.stories[names[0]].incident.variety;
  variety.cast = ['crew/mira','crew/mira'];
  assert.throws(()=>validateStoryDocument(doc),/variety.cast.*unique scope ID/);
  variety.cast = [{$role:'missing'}];
  assert.throws(()=>validateStoryDocument(doc),/variety.cast.*unknown role/);
  variety.cast = ['crew/mira'];
  world.storyteller.profiles.rotate.variety.family = 33;
  assert.throws(()=>R.storyPreflight(world),/variety needs cast, location, family or situation windows/);
});
