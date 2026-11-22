const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname,'../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const source = () => embedStoryDocuments(read('sluice-relief.world.json'),path.join(directory,'sluice-relief.world.json'));
const actions = () => read('sluice-relief.actions.json');
const story = 'sluice-relief/relief';
const query = (run,field,args) => run.query().probe(field,undefined,args).value;
const gate = (run,preview = false) => query(run,'world/story-feasibility',{story,preview});
const status = run => query(run,'world/story-lifecycle')[story];
const json = value => JSON.parse(JSON.stringify(value));
const restore = checkpoint => R.create(checkpoint.world,{checkpoint});

test('a pending event survives checkpoint and only offers once route, supplies, room, and work pass', () => {
  const world = source(), run = R.create(world);
  const before = run.checkpoint(), {preview} = gate(run,true);
  assert.deepEqual(run.checkpoint(),before);
  assert.equal(preview.checks['route-to-shelter'].status,'blocked');
  assert.deepEqual(preview.checks['medicine-stock-and-room'].actual.blockers,['source','destination']);
  assert.deepEqual(preview.checks['build-platform'].actual.blockers,
    [{account:'workshop/yard.wood',amount:2,available:0,reason:'missing-stock'}]);
  assert.equal(query(run,'world/account',{account:'supplies/depot'}).balance,1);
  run.schedule(actions());
  run.advance(3);
  assert.equal(status(run),null);
  assert.deepEqual(gate(run).request,{tick:1,source:{trigger:'request',evidence:{kind:'event',events:['1.0']}}});
  const checkpoint = json(run.checkpoint()), resumed = restore(checkpoint);
  const damaged = json(checkpoint);
  damaged.storyFeasibilityState[story] = null;
  assert.throws(() => restore(damaged),/Invalid saved story feasibility/);
  run.advance(5);
  assert.equal(gate(run).report.checks['route-to-shelter'].status,'ready');
  assert.equal(gate(run).report.checks['build-platform'].actual.blockers[0].reason,'output-full');
  assert.equal(status(run),null);
  run.advance(6);
  assert.equal(status(run).status,'available');
  assert.equal(status(run).deadlines.offer.dueTick,13);
  const receipt = gate(run).report;
  assert.equal(receipt.tick,6);
  assert.equal(receipt.ready,true);
  run.advance(28);
  resumed.advance(28);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(gate(run).report,receipt);
  assert.equal(status(run).outcome,'ready');
  assert.equal(status(run).flow.route[0].objectives.platform.receipt.event.kind,'work-completed');
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('a still-blocked request can expire without publication and keeps its last report', () => {
  const run = R.create(source());
  run.schedule(actions().filter(command => command.tick!==6));
  run.advance(30);
  assert.equal(status(run).status,'expired');
  assert.deepEqual(status(run).transitions.map(row => [row.tick,row.to]),[[30,'expired']]);
  assert(run.history.some(row => row.kind==='story-transition-rejected' && row.requestedReason==='accepted-ready-offer'));
  assert(!run.history.some(row => row.kind==='story-started'));
  assert.equal(gate(run).report.tick,29);
  assert.deepEqual(gate(run).report.checks['build-platform'].actual.blockers,
    [{account:'workshop/yard.platform',amount:1,available:0,reason:'output-full'}]);
  assert.deepEqual(restore(json(run.checkpoint())).checkpoint(),run.checkpoint());
});

test('nested requests retain their original opening visit until the questlet is feasible', () => {
  const world = source(), {stories} = world.storyDocuments[0];
  const triggers = stories.relief.triggers;
  delete stories.relief.triggers;
  stories.response = {kind:'arc',title:'Organize the sluice response',entry:'prepare',triggers,lifecycle:{progression:true},
    stages:{prepare:{title:'Prepare',children:{open:['relief'],wait:{all:['relief']}},
      next:{finish:{outcome:'resolved',auto:true,requiresChildren:{relief:{status:'completed'}}}}}},
    outcomes:{resolved:{title:'Response completed'}}};
  const run = R.create(world);
  run.schedule(actions());
  run.advance(3);
  const parent = {document:'sluice-relief',story:'response',stage:'prepare',visit:1,tick:1};
  assert.deepEqual(gate(run).request.parent,parent);
  assert.equal(status(run),null);
  const restored = restore(json(run.checkpoint()));
  restored.advance(28);
  run.advance(28);
  assert.deepEqual(status(restored).parent,parent);
  assert.equal(status(restored).transitions[0].tick,6);
  assert.equal(query(restored,'world/story-lifecycle')['sluice-relief/response'].outcome,'resolved');
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
});

test('native previews enforce generation and effect blockers without changing any solver state', () => {
  const world = source();
  world.systems.workshop.config.processes.platform.work.effect = {action:'crew/recruit',
    args:{prefix:'helper',species:'responder',at:[-1.25,0,0.62]}};
  const run = R.create(world);
  run.schedule(actions().slice(0,6));
  run.advance(6);
  const before = run.checkpoint();
  const {actual} = gate(run,true).preview.checks['build-platform'];
  assert.deepEqual(actual.blockers,[{reason:'recruit-site-occupied',action:'crew/recruit'}]);
  assert.equal(run.query().probe('crew/route-feasibility',undefined,{agent:'courier',generation:99,to:[1,0,0]}).status,'missing');
  assert.deepEqual(run.checkpoint(),before);
});

test('template gates resolve their parameters and reject bad world references during preflight', () => {
  const world = source(), [{format,version,id,...document}] = world.storyDocuments;
  delete world.storyDocuments;
  const {feasibility} = document.stories.relief.lifecycle;
  feasibility['medicine-stock-and-room'].transfer.amount = {$param:'crates'};
  feasibility['input-check'] = {state:{field:'world/account',args:{account:'supplies/depot'},select:'/balance',when:{op:'gte',value:2}}};
  world.storyTemplates = [{id,template:{format:'ink-studio/story-template',version:1,id:'relief-template',revision:1,
    parameters:{crates:{type:'integer',default:2}},document}}];
  assert.equal(R.storyPreflight(world).feasibility[story]['medicine-stock-and-room'].transfer.amount,2);
  const run = R.create(world);
  assert.equal(gate(run,true).preview.checks['input-check'].status,'blocked');
  run.schedule(actions());
  run.advance(6);
  assert.deepEqual(gate(run).report.checks['input-check'].actual,{field:'world/account',value:3});
  feasibility['input-check'].state.field = 'unknown/data';
  assert.throws(() => R.storyPreflight(world),/Unknown feasibility field unknown\/data/);
  feasibility['input-check'].state.field = 'world/story-feasibility';
  assert.throws(() => R.storyPreflight(world),/recursive feasibility query/);
});
