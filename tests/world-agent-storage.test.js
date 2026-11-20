const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const estuary=require('../examples/world-aggregate-estuary.json');
const resident=require('../examples/world-resident-shelter.json');

const json=value=>JSON.parse(JSON.stringify(value));
const bird=(position=[0,1,0],extra={})=>({species:'bird',position,...extra});
const action=(tick,key,args)=>({tick,action:'flock/'+key,args});
const inspect=(run,id,field='agent',args)=>run.query().probe('flock/'+field,{agent:id},args);
const scene=(agents={},options={})=>({dt:.25,systems:{flock:{kind:'agents',config:{
  bounds:{min:[-32,-1,-32],max:[32,8,32]},species:{bird:{mode:'fly',speed:1}},agents,...options
}}}});

test('scheduled births, destinations, task changes and removal survive replay and branch independently',()=>{
  const run=W.runtime.create(scene({guard:bird()}));
  assert(run.query().inspect().systems[0].actions.includes('spawn'));
  run.schedule([
    action(1,'spawn',{agent:'scout',...bird([1,1,0],{entity:'rover',name:'Robin',metadata:{team:'north'}})}),
    action(1,'set-task',{agent:'scout',task:'survey'}),
    action(1,'seek',{agent:'scout',to:[4,1,0]}),
    action(2,'despawn',{agent:'guard'})
  ]);
  run.advance(1);
  const scout=inspect(run,'scout').value;
  assert.equal(scout.name,'Robin');
  assert.deepEqual(scout.metadata,{team:'north'});
  assert.deepEqual(scout.position,[1.25,1,0]);
  assert.deepEqual(inspect(run,'scout','velocity').value,[1,0,0]);
  assert.deepEqual(run.query().target({entity:'rover'}).point,scout.position);
  assert.deepEqual(run.query().probe('position',{entity:'rover'}).value,scout.position);
  assert.equal(run.query().probe('flock/task',{entity:'rover'}).value,'survey');

  const first=run.checkpoint();
  const branch=run.fork(), resumed=W.runtime.create(first.world,{checkpoint:json(first)});
  branch.schedule([action(2,'set-task',{agent:'scout',task:null})]);
  for(const continuation of [run,branch,resumed])continuation.advance(2);
  assert.equal(inspect(run,'guard').status,'missing');
  assert.equal(inspect(branch,'scout').value.task,null);
  assert.equal(inspect(run,'scout').value.task,'survey');
  assert.equal(inspect(run,'scout').value.generation,scout.generation);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
  assert.deepEqual(run.checkpoint(),W.runtime.replay(json(run.recording())).checkpoint());
  assert.equal(run.history.find(event=>event.kind==='agent-spawned').generation,scout.generation);
  assert.equal(run.history.find(event=>event.kind==='agent-despawned').agent,'guard');

  run.schedule([action(3,'despawn',{agent:'scout',generation:scout.generation}),
    action(3,'spawn',{agent:'scout',...bird()})]);
  run.advance(3);
  assert(inspect(run,'scout').value.generation>scout.generation);
  assert.equal(inspect(run,'scout','agent',{generation:scout.generation}).status,'missing');
  assert.equal(run.query().target({entity:'rover'}),null);
  run.schedule([action(4,'seek',{agent:'scout',generation:scout.generation,to:[2,1,0]})]);
  const before=run.checkpoint();
  assert.throws(()=>run.step(),/Stale agent generation/);
  assert.strictEqual(run.checkpoint(),before);
});

test('large rosters share unchanged pages, keep components dense, and validate portable state',()=>{
  const agents=Object.fromEntries(Array.from({length:1664},(_,i)=>['unit-'+String(i).padStart(4,'0'),bird()]));
  const run=W.runtime.create(scene(agents));
  run.advance(1);
  const ready=run.checkpoint().states.flock.roster;
  run.schedule([action(2,'set-task',{agent:'unit-0000',task:'harvest'})]);
  run.advance(2);
  const edited=run.checkpoint().states.flock.roster;
  assert.equal(edited.pages.length,13);
  assert.notStrictEqual(edited.pages[0],ready.pages[0]);
  assert.strictEqual(edited.pages[0].positions,ready.pages[0].positions);
  assert.strictEqual(edited.pages[0].details,ready.pages[0].details);
  assert(edited.pages.slice(1).every((page,i)=>page===ready.pages[i+1]));
  const batch=run.query().probe('flock/components',{}, {page:0}).value;
  assert.equal(batch.total,1664);
  assert.equal(batch.pages[0].positions.length,128*3);
  assert.equal(batch.pages[0].tasks[0],1);
  assert.deepEqual(batch.taskNames,['harvest']);
  assert(!Object.hasOwn(batch.pages[0],'details'));
  run.schedule([action(3,'despawn',{agent:'unit-0000'})]);
  run.advance(3);
  const final=run.checkpoint(), last=inspect(run,'unit-1663').value;
  assert.equal(last.generation,1664);
  assert.equal(final.states.flock.roster.pages[0].ids[0],last.id);
  assert.equal(run.query().probe('flock/population').value.total,1663);
  assert(!Object.hasOwn(final.states.flock,'agents'));
  assert.equal(run.view().states.flock.agents[last.id].generation,1664);
  assert.equal(run.query().probe('flock/components',{}, {page:99}).status,'missing');
  const broken=json(final);
  broken.states.flock.roster.pages[0].positions.pop();
  assert.throws(()=>W.runtime.create(broken.world,{checkpoint:broken}),/Invalid packed agent page/);
});

test('capacity and duplicate ID failures roll back the whole tick',()=>{
  const run=W.runtime.create(scene({}, {maxAgents:1}));
  run.schedule([action(1,'spawn',{agent:'one',...bird()}),action(1,'spawn',{agent:'two',...bird()})]);
  assert.throws(()=>run.step(),/capacity exceeded/);
  assert.deepEqual(run.query().probe('flock/population').value,{total:0,counts:{bird:0}});
  assert.equal(run.history.length,0);
  const duplicate=W.runtime.create(scene({one:bird()}));
  duplicate.schedule([action(1,'spawn',{agent:'one',...bird()})]);
  assert.throws(()=>duplicate.step(),/Agent already exists one/);
});

test('cohorts retain runtime membership and handles through sleeping checkpoints and reconstruction',()=>{
  const run=W.runtime.create(estuary);
  run.schedule([
    action(7,'spawn',{agent:'visitor',species:'shorebird',position:[4,0,5.8],name:'Visitor',task:'eat'}),
    action(8,'despawn',{agent:'bird-1'}),
    action(20,'set-task',{agent:'visitor',task:'rest'})
  ]);
  run.advance(10);
  assert.equal(run.checkpoint().states.flock.model,'cohorts');
  assert.equal(run.query().probe('flock/population').value.total,6);
  const visitor=inspect(run,'visitor').value;
  assert.equal(visitor.task,'eat');
  assert.equal(visitor.name,'Visitor');
  assert.equal(inspect(run,'bird-1').status,'missing');
  run.advance(24);
  const saved=json(run.checkpoint());
  const resumed=W.runtime.create(saved.world,{checkpoint:saved});
  for(const next of [run,resumed])next.advance(30);
  assert.equal(inspect(resumed,'visitor').value.task,'rest');
  assert.equal(inspect(resumed,'visitor').value.generation,visitor.generation);
  assert.equal(inspect(resumed,'bird-1').status,'missing');
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
  assert.deepEqual(run.checkpoint(),W.runtime.replay(json(run.recording())).checkpoint());
});

test('removing a managed agent clears activity state and respawning starts it fresh',()=>{
  const run=W.runtime.create(resident);
  const managed=(tick,key,args)=>({...action(tick,key,args),action:'folk/'+key});
  const {species,position}=resident.systems.folk.config.agents.resident;
  run.schedule([
    managed(2,'despawn',{agent:'resident'}),
    managed(4,'spawn',{agent:'resident',species,position})
  ]);
  run.advance(2);
  assert.equal(run.query().trace('folk/why',{agent:'resident'},{agent:'resident'}).status,'missing');
  assert.deepEqual(run.query().probe('folk/decisions').value,{});
  const saved=json(run.checkpoint());
  const resumed=W.runtime.create(saved.world,{checkpoint:saved});
  resumed.advance(6);
  assert.equal(resumed.query().probe('folk/task',{agent:'resident'}).value,'work');
});

test('version-one row checkpoints and recordings still restore, replay and detect divergence',()=>{
  const run=W.runtime.create(scene({scout:bird([0,1,0],{goal:[5,1,0]})}));
  run.advance(3);
  const previous=json(run.recording());
  for(const saved of [previous.origin,previous.end]){
    const state=saved.states.flock;
    const {roster,...rest}=state;
    const old=roster.pages.flatMap(page=>page.ids.map((id,i)=>
      [id,{...page.details[i],id,position:page.positions.slice(i*3,i*3+3)}]));
    saved.states.flock={...rest,agents:Object.fromEntries(old)};
  }
  assert.deepEqual(W.runtime.replay(previous).checkpoint(),run.checkpoint());
  const restored=W.runtime.create(previous.end.world,{checkpoint:previous.end});
  restored.advance(4);
  assert.deepEqual(inspect(restored,'scout','velocity').value,[1,0,0]);
  previous.end.states.flock.agents.scout.position[0]+=1;
  assert.throws(()=>W.runtime.replay(previous),/Replay diverged at tick 3/);
});
