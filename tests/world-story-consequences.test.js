const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const file = '../examples/story-documents/low-bank.world.json';
const salvage = require('../examples/story-documents/low-bank.salvaged.actions.json');
const late = require('../examples/story-documents/low-bank.late-salvage.actions.json');
const world = ()=>embedStoryDocuments(structuredClone(require(file)),path.resolve(__dirname,file));
const json = value=>JSON.parse(JSON.stringify(value));
const restore = saved=>R.create(saved.world,{checkpoint:json(saved)});
const probe = (run,field,args)=>run.query().probe(field,undefined,args).value;
const arc = 'low-bank/evacuate', certify = 'low-bank/certify-salvage', jules = 'low-bank/jules-escape';
const roll = 'archive/roll', level = 'archive/level';
const archive = {kind:'site',id:'river/low-bank'}, watch = {kind:'faction',id:'river-watch'};
const closure = run=>probe(run,'world/story-consequences',{story:arc});
const custody = (run,object)=>probe(run,'world/custody',{object});
const command = (tick,action,args)=>({tick,action:'world/'+action,args});
const outcome = authored=>authored.storyDocuments[0].stories.evacuate.outcomes['partial-evacuation'];

test('an arc closes with mixed child and state evidence and leaves a site effect for a later faction decision',()=>{
  const run = R.create(world());
  run.schedule(salvage);
  run.advance(6);
  assert.equal(run.query().probe('world/story-consequences',undefined,{story:arc}).status,'missing');
  run.advance(7);
  const closed = closure(run);
  assert.equal(closed.terminal,'completed');
  assert.equal(closed.outcome,'partial-evacuation');
  assert.equal(closed.coverage,'partial');
  assert.deepEqual(closed.totals,{destroyed:1,escaped:1,salvaged:1,unresolved:1});
  assert.equal(closed.subjects.mira.proof.kind,'child');
  assert.equal(closed.subjects.mira.proof.story,'mira-escape');
  assert.equal(closed.subjects.jules.reason,'evidence-unavailable');
  assert.equal(closed.subjects.level.irreversible,true);
  assert.equal(closed.subjects.level.proof.evidence,'3.1');
  assert.equal(closed.subjects.roll.proof.evidence,'5.0');
  const publication = run.events.find(row=>row.kind==='story-consequences');
  assert.deepEqual(publication.consequences,closed);
  assert.equal(probe(run,'world/story-lifecycle')[arc].status,'completed');
  const resumed = restore(run.checkpoint());
  run.advance(10);
  const site = probe(run,'world/site-history',{site:'river/low-bank'});
  assert.equal(site.state.access,'salvage-only');
  assert.equal(site.consequences.access.source.id,publication.id);
  assert.equal(probe(run,'world/chunks',{chunk:'low-bank'}).sleeping,true);
  assert.equal(probe(run,'world/knowledge',{holder:watch,fact:'9.0'}).status,'unknown');
  assert.equal(probe(run,'world/story-lifecycle')[certify],null);
  assert.equal(run.events.find(row=>row.kind==='custody-rejected').reason,'object-destroyed');
  run.advance(11);
  assert.equal(probe(run,'world/story-lifecycle')[certify].status,'active');
  assert.equal(probe(run,'world/knowledge',{holder:watch,fact:'9.0'}).status,'complete');
  run.advance(14);
  resumed.advance(14);
  assert.equal(probe(run,'world/story-lifecycle')[certify].outcome,'certified');
  assert.equal(probe(run,'world/chunks',{chunk:'low-bank'}).sleeping,false);
  assert.deepEqual(closure(run),closed);
  assert.deepEqual(run.history,[]);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('late recovery and a second escape change current state while the closure evidence remains fixed',()=>{
  const run = R.create(world());
  run.schedule(late);
  run.advance(7);
  const closed = closure(run);
  assert.equal(closed.subjects.roll.result,'lost');
  assert.equal(closed.subjects.jules.result,'unresolved');
  run.advance(12);
  assert.equal(custody(run,roll).status,'held');
  assert.equal(probe(run,'world/story-lifecycle')[jules].outcome,'safe');
  assert.deepEqual(closure(run),closed);
  const [candidate] = probe(run,'world/incident-candidates').blocked;
  assert.equal(candidate.candidate,certify);
  assert.equal(candidate.report.checks['saved-at-close'].actual.value,'lost');
  assert.equal(probe(run,'world/story-lifecycle')[certify],null);
  run.advance(14);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('destroyed identities remain unavailable for transfer or revival even after custody history is evicted',()=>{
  const run = R.create({custody:{objects:{[roll]:{},[level]:{}},historyLimit:1}});
  const at = {place:'river/low-bank'};
  run.schedule([
    command(1,'destroy-object',{object:roll}),
    command(1,'discover-object',{object:roll,to:archive,at}),
    command(1,'discover-object',{object:level,to:archive,at}),
    command(2,'destroy-object',{object:level}),
    command(2,'lose-object',{object:roll,from:archive}),
    command(3,'destroy-object',{object:roll}),
    command(3,'destroy-object',{object:level,from:archive}),
    command(4,'recover-object',{object:roll,to:watch,at}),
    command(4,'discover-object',{object:roll,to:watch,at}),
    command(4,'transfer-object',{object:level,from:archive,to:watch}),
    command(4,'inherit-object',{object:level,from:archive,to:watch})
  ]);
  run.advance(1);
  assert.equal(run.events[0].reason,'not-discovered');
  run.advance(2);
  assert.equal(run.events[0].reason,'holder-mismatch');
  run.advance(4);
  assert(run.events.every(row=>row.reason==='object-destroyed'));
  assert.equal(custody(run,roll).status,'destroyed');
  assert.equal(custody(run,roll).dropped,1);
  assert.equal(custody(run,level).holder,undefined);
  assert.equal(probe(run,'world/custody',{status:'destroyed'}).matched,2);
  assert.deepEqual(restore(run.checkpoint()).checkpoint(),run.checkpoint());
});

test('ordered state cases can record a complete mixed report even when the arc fails',()=>{
  const authored = world(), branch = outcome(authored);
  branch.status = 'failed';
  delete branch.consequences.jules;
  branch.consequences.roll.cases.push({result:'catalogued',state:{
    field:'world/custody',args:{object:roll},select:'/status',when:{value:'held'}
  }});
  const run = R.create(authored);
  run.schedule(salvage);
  run.advance(7);
  assert.equal(closure(run).terminal,'failed');
  assert.equal(closure(run).coverage,'complete');
  assert.equal(closure(run).subjects.roll.result,'salvaged');
  const saved = json(run.checkpoint());
  saved.storyLifecycleState[arc].consequences.subjects.mira.proof.outcome = 'invented';
  assert.throws(()=>restore(saved),/Invalid saved story lifecycle/);
});

test('unknown evidence fields and forged consequences are rejected',()=>{
  const invalid = world();
  outcome(invalid).consequences.level.cases[0].state.field = 'world/unknown-consequence-field';
  assert.throws(()=>R.create(invalid),/Unknown consequence field/);
  const run = R.create(world());
  assert.throws(()=>run.schedule([command(1,'event',{kind:'story-consequences'})]),/published at closure/);
  run.advance(14);
  let saved = json(run.checkpoint());
  saved.storyLifecycleState[arc].consequences.subjects.level.proof.value = 'held';
  assert.throws(()=>restore(saved),/Invalid saved story lifecycle/);
  saved = json(run.checkpoint());
  delete saved.storyLifecycleState[arc].consequences;
  assert.throws(()=>restore(saved),/Invalid saved story lifecycle/);
});
