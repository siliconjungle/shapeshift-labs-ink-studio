const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime, story = 'live-passage/escort';
const directory = path.resolve(__dirname,'../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const source = () => embedStoryDocuments(read('live-passage.world.json'),path.join(directory,'live-passage.world.json'));
const script = () => read('live-passage.actions.json');
const query = (run,field,args) => run.query().probe(field,undefined,args);
const subject = (run,reference = 'pilot') => query(run,'world/story-references',{story,reference}).value;
const target = (run,reference = 'pilot') => query(run,'world/story-reference-target',{story,reference});
const lifecycle = run => query(run,'world/story-lifecycle').value[story];
const policies = world => world.storyDocuments[0].stories.escort.lifecycle.liveReferences;
const json = value => JSON.parse(JSON.stringify(value));
const restore = checkpoint => R.create(checkpoint.world,{checkpoint});
const patch = (tick, path, value) => ({tick,action:'world/patch',args:{edits:[{op:'set',path,value}]}});
const gate = (tick,value) => ({tick,action:'world/input',args:{port:'passage/gate',value}});

test('movement follows live coordinates, access pauses active work, and adoption drives a fresh objective receipt', () => {
  const world = source(), run = R.create(world);
  assert.equal(R.storyPreflight(world).liveReferences[story].pilot.target.agent.generation,2);
  assert.deepEqual(target(run).value.position,[0.3,0,0.3]);
  run.schedule(script());
  run.advance(3);
  assert.deepEqual(target(run,'dock').value.position,[1.75,0,-0.5]);
  assert(run.history.some(row => row.kind==='story-reference-changed' && row.change==='moved' && row.reference==='pilot'));
  run.advance(6);
  assert.equal(target(run).value.accessible,false);
  assert.equal(lifecycle(run).status,'suspended');
  assert(run.history.some(row => row.kind==='story-transition-rejected' && row.reason==='live-reference-blocked'));
  assert.equal(lifecycle(run).deadlines.work.spentTicks,4);
  run.advance(9);
  assert.equal(lifecycle(run).transitions.at(-1).reference.cause,'died');
  assert.equal(target(run).status,'unavailable');
  assert.equal(subject(run).death.kind,'population-death');
  const checkpoint = json(run.checkpoint()), resumed = restore(checkpoint);
  const corrupt = json(checkpoint);
  corrupt.storyReferenceState[story].pilot.identity = 999;
  assert.throws(() => restore(corrupt),/Invalid live reference/);
  run.advance(11);
  assert.equal(lifecycle(run).status,'active');
  assert.deepEqual(subject(run).adopted,{tick:11,from:2,to:3});
  assert.equal(query(run,'world/story-roles',{story,role:'pilot'}).value.value.generation,2);
  assert.equal(query(run,'crew/agent',{agent:'pilot',generation:2}).status,'missing');
  run.advance(27);
  resumed.advance(27);
  const ending = lifecycle(run);
  assert.equal(ending.outcome,'met');
  assert.equal(ending.flow.route[0].objectives.handoff.receipt.value.generation,3);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('faction changes can withdraw a story, and a death policy can fail it before later replacement', () => {
  const run = R.create(source());
  run.schedule([...script(),patch(13,'/entities/dock/metadata/faction','rival')]);
  run.advance(27);
  const ending = lifecycle(run);
  assert.equal(ending.status,'withdrawn');
  assert.deepEqual(ending.transitions.at(-1).reference,{reference:'dock',cause:'faction-changed',action:'withdraw'});
  assert.deepEqual(subject(run,'dock').issues['faction-changed'].detail,{from:'harbor',to:'rival'});
  assert(!run.history.some(row => row.kind==='story-objective-resolved'));
  const strict = source();
  policies(strict).pilot.on.died = 'fail';
  const loss = R.create(strict);
  loss.schedule(script());
  loss.advance(27);
  assert.equal(lifecycle(loss).status,'failed');
  assert.equal(subject(loss).tick,9);
  assert.equal(target(loss).status,'unavailable');
  assert.equal(query(loss,'crew/agent',{agent:'pilot'}).value.generation,3);
  assert.deepEqual(restore(json(loss.checkpoint())).checkpoint(),loss.checkpoint());
});

test('stale death events and unadopted replacements respect the explicitly pinned identity', () => {
  const world = source();
  delete policies(world).pilot.death.event.system;
  const stale = {tick:12,action:'world/event',args:{kind:'population-death',actor:{system:'crew',agent:'pilot',generation:2}}};
  const run = R.create(world);
  run.schedule([...script(),stale]);
  run.advance(12);
  assert.equal(subject(run).death,undefined);
  assert.equal(target(run).value.generation,3);
  policies(world).pilot.on.replaced = 'track';
  const pinned = R.create(world);
  pinned.schedule(script());
  pinned.advance(12);
  assert.deepEqual(subject(pinned).issues.replaced.detail,{expected:2,observed:3});
  assert.equal(target(pinned).status,'unavailable');
  assert.equal(lifecycle(pinned).status,'suspended');
});

test('native offers respect access and releasing a policy does not resume a manually suspended story', () => {
  const run = R.create(source());
  run.schedule([gate(3,true)]);
  run.advance(2);
  assert.equal(lifecycle(run).status,'available');
  assert(!run.history.some(row => row.kind==='story-started'));
  run.advance(3);
  assert.equal(lifecycle(run).since,3);
  run.schedule([{tick:4,action:'world/story-transition',args:{
    document:'live-passage',story:'escort',to:'suspended',reason:'live-reference-suspended'
  }},gate(5,false),gate(6,true)]);
  run.advance(7);
  assert.equal(lifecycle(run).status,'suspended');
  assert.equal(lifecycle(run).transitions.at(-1).reference,undefined);
});

test('template parameters can watch a socket and track an explicit scene identity change', () => {
  const world = source(), [{format,version,id,...document}] = world.storyDocuments;
  const dock = policies(world).dock;
  dock.on.replaced = {$param:'replacement'};
  dock.on.inaccessible = 'suspend';
  delete world.storyDocuments;
  world.storyTemplates = [{id,template:{format:'ink-studio/story-template',version:1,id:'watch',revision:1,
    parameters:{replacement:{type:'string',default:'adopt'}},document}}];
  const run = R.create(world);
  run.schedule([gate(1,true),patch(2,'/entities/dock/metadata/incarnation',2),
    {tick:3,action:'world/patch',args:{edits:[{op:'remove',path:'/entities/dock/sockets/landing'}]}},
    patch(4,'/entities/dock/sockets/landing',[-0.2,0,0])]);
  run.advance(3);
  assert.equal(lifecycle(run).status,'suspended');
  assert.equal(subject(run,'dock').adopted.to,2);
  assert.equal(subject(run,'dock').issues.inaccessible.detail.reason,'position-unavailable');
  run.advance(4);
  assert.equal(lifecycle(run).status,'active');
  assert.deepEqual(target(run,'dock').value.position,[1.3,0,-0.5]);
});
