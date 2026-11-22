const assert=require('node:assert/strict');
const {test}=require('node:test');
const W=require('..').load().KIT.world;
const Live=require('../cli/live-access.js');
const world=require('../examples/world-access/harbor.world.json');
const policy=require('../examples/world-access/harbor.access.json');
const queries=require('../examples/world-access/harbor.queries.json');

test('scoped exports use faction memory and project only explicitly public data and events',()=>{
  const authoring=structuredClone(policy), run=W.runtime.create(world), access=W.worldAccess.compile(authoring,world,{queries});
  authoring.public.events['dispatch-ready'].fields.message='/payload/message';
  run.step();
  const project=name=>access.project(name,run.view(),run.query(),run.committedEvents());
  const full=project('authority'), west=project('west'), east=project('east'), spectator=project('audience');
  assert.equal(full.seed,world.seed);
  assert.equal(full.samples.reserve.value.balance,3);
  assert(full.events.some(row=>row.payload.message?.includes('east cache')));
  assert.deepEqual(Object.keys(spectator.samples),['lanterns']);
  assert.equal(spectator.seed,0);
  assert.equal(spectator.branch,'public');
  assert.equal(spectator.events.length,1);
  assert.deepEqual(spectator.events[0],{
    version:1,id:'1.0',tick:1,world:world.id,branch:'public',beatId:'ink:public-beat:lantern-harbor/public/1.0',
    system:'presentation',kind:'signal-ready',
    story:null,stage:null,visit:null,subjects:[],causes:[],payload:{color:'amber'}
  });
  assert.deepEqual(west.samples.perception.value.contacts.map(row=>row.entity),['west-lantern']);
  assert.deepEqual(east.samples.perception.value.contacts.map(row=>row.entity),['east-cache']);
  assert.equal(west.samples.perception.value.stats,undefined);
  assert.deepEqual(west.samples.knowledge.value.records[0].data,{});
  assert.equal(west.samples.knowledge.value.records[0].status,'partial');
  assert.deepEqual(east.samples.knowledge.value.records[0].data,{severity:'hinge fractured'});
  assert.equal(east.samples.knowledge.value.records[0].receipts,undefined);
  assert.throws(()=>access.audience('missing'),/Unknown audience view/);
  assert.throws(()=>W.worldAccess.compile({...policy,public:{queries:{facts:{field:'world/facts'}}}},world),
    /explicit selectors/);
});

test('grants, scoped cursors and native validation gate a single replayable command',()=>{
  const run=W.runtime.create(world,{recordRun:true}), access=Live.create(W,run,{policy,queries,until:8});
  run.step();
  access.publish(run.committedEvents());
  const {principals}=access.ready(), principal=name=>access.authorize('Bearer '+principals[name].token);
  const west=principal('west-guide'), spectator=principal('projector'), operator=principal('operator');
  const request={id:'release-lantern',request:'change',after:west.publisher.cursor()};
  const good={busy:false,ended:false};
  assert.equal(access.authorize('Bearer outsider'),undefined);
  assert.notEqual(request.after.stream,spectator.publisher.cursor().stream);
  assert.equal(access.submit(spectator,request,good).status,403);
  assert.equal(access.submit(operator,request,good).status,403);
  assert.equal(access.submit(west,{...request,args:{branch:'hold'}},good).status,400);
  assert.equal(access.submit(west,{...request,after:spectator.publisher.cursor()},good).status,409);
  assert.equal(access.submit(west,request,{...good,busy:true}).status,409);
  assert.equal(access.submit(west,{...request,id:'ring-siren'},good).status,422);
  const accepted=access.submit(west,request,good);
  assert.equal(accepted.status,202);
  assert.equal(accepted.body.tick,2);
  assert.equal(access.submit(west,{...request,id:'hold-lantern'},good).status,409);
  const audienceCursor=spectator.publisher.cursor();
  run.step();
  const effects=run.committedEvents();
  access.publish(effects);
  assert.deepEqual(access.submit(west,request,good),accepted);
  assert.equal(access.submit(west,{...request,request:'stale'},good).status,409);
  const pulse=spectator.publisher.pull(audienceCursor);
  assert.deepEqual(pulse.effects.map(row=>[row.kind,row.payload]),[['lantern-lit',{amount:1}]]);
  assert.equal(pulse.state.samples.lanterns.value,1);
  assert.equal(spectator.publisher.pull().effects.length,0);
  const choice=effects.find(row=>row.kind==='story-branch-chosen');
  assert.equal(choice.payload.branch,'release');
  assert(choice.causes.some(row=>row.action==='world/story-choose'&&row.id===accepted.body.command));
  assert.deepEqual(run.recording().commands.map(row=>row.id),[accepted.body.command]);
  assert.equal(W.runtime.verify(run.recording()).status,'verified');
  const replay=Live.create(W,run,{policy,queries,until:8,playback:true});
  replay.publish(effects);
  const replayWest=replay.authorize('Bearer '+replay.ready().principals['west-guide'].token);
  assert.equal(replay.permissions(replayWest,true).writable,false);
  assert.equal(replay.submit(replayWest,{...request,after:replayWest.publisher.cursor()},good).status,409);
});

test('an authored lag budget targets the next open tick and stays within its own stream',()=>{
  const run=W.runtime.create(world), source=structuredClone(policy);
  source.interventions['release-lantern'].maxLag=1;
  const access=Live.create(W,run,{policy:source,queries,until:6});
  access.publish([]);
  const credentials=access.ready().principals, key=name=>access.authorize('Bearer '+credentials[name].token);
  const west=key('west-guide'), initial=west.publisher.cursor();
  run.step();access.publish(run.committedEvents());
  const after=west.publisher.cursor();
  run.step();access.publish(run.committedEvents());
  const attempt=cursor=>access.submit(west,{id:'release-lantern',request:'choice',after:cursor},{busy:false,ended:false});
  assert.equal(attempt(initial).status,409);
  assert.equal(attempt({...after,revision:0}).status,409);
  assert.equal(attempt({...after,stream:key('projector').publisher.cursor().stream}).status,409);
  const accepted=attempt(after);
  assert.equal(accepted.status,202);
  assert.equal(accepted.body.tick,3);
  assert.equal(run.recording().commands[0].maxLag,undefined);
  run.step();
  assert.equal(run.query().probe('world/account',undefined,{account:'stock/in-use'}).value.balance,1);
});
