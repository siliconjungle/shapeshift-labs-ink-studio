const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const clone=value=>JSON.parse(JSON.stringify(value));
const queue=run=>run.query().probe('crew/route-queue').value;
const status=(run,agent)=>run.query().probe('crew/route-status',{agent}).value;
const actor=(run,agent)=>run.query().probe('crew/agent',{agent}).value;
const walk=(x,z,goal=[12,0,z],extra={})=>({position:[x,0,z],goal,species:'walker',...extra});
const command=(tick,action,args)=>({tick,action,args});

function world(agents,{max=1,substeps=1,nav={},crew={}}={}){
  return {dt:.1,systems:{
    nav:{kind:'navigation',config:{bounds:{min:[0,-1,0],max:[14,2,8]},cell:.5,tiles:{size:4},...nav}},
    crew:{kind:'agents',...(substeps>1&&{schedule:{substeps}}),config:{navigation:'nav',routeQueue:{maxRequestsPerTick:max},
      species:{walker:{mode:'walk',speed:.5}},agents,...crew}}
  }};
}

test('the queue admits a stable priority order once per world tick across substeps',()=>{
  const run=W.runtime.create(world({z:walk(1,1),b:walk(1,2),a:walk(1,3),
    urgent:walk(1,4,[12,0,4],{routePriority:5})},{max:2,substeps:4}));
  run.step();
  assert.deepEqual(queue(run).served,[]);
  assert.deepEqual(queue(run).pending.map(row=>row.agent),['urgent','a','b','z']);
  assert.equal(status(run,'urgent').status,'waiting');
  assert.deepEqual(actor(run,'urgent').position,[1,0,4]);
  const saved=clone(run.checkpoint());
  const branch=run.fork(), restored=W.runtime.create(saved.world,{checkpoint:saved});
  for(const continuation of [run,branch,restored]){
    continuation.step();
    assert.deepEqual(queue(continuation).served.map(row=>row.agent),['urgent','a']);
    assert.deepEqual(queue(continuation).pending.map(row=>row.agent),['b','z']);
    assert.equal(status(continuation,'urgent').status,'ready');
    assert(actor(continuation,'urgent').position[0]>1);
    continuation.step();
    assert.deepEqual(queue(continuation).served.map(row=>row.agent),['b','z']);
    assert.equal(queue(continuation).pending.length,0);
  }
  assert.deepEqual(run.checkpoint(),restored.checkpoint());
  assert.deepEqual(run.checkpoint(),branch.checkpoint());
  assert.deepEqual(run.checkpoint(),W.runtime.replay(clone(run.recording())).checkpoint());
});

test('flooded crossing queues replacements and walkers continue verified prefixes',()=>{
  const scene=world({
    lead:walk(1,1.5,[12,0,1.5],{routePriority:5}),
    middle:walk(1.5,1.5),
    edge:walk(5.6,1.5),
    distant:walk(8,1.5)
  },{nav:{bounds:{min:[0,-1,1.2],max:[14,2,1.8]},water:'ford/water',tiles:{size:4,flowFields:{}}}});
  scene.dt=.05;
  scene.systems.ford={kind:'water',config:{width:1,height:1,origin:[6,1],accounts:{site:[6.5,1.5]}}};
  scene.systems.tank={kind:'water',config:{width:1,height:1,origin:[20,1],accounts:{site:[20.5,1.5]},
    initial:[{bounds:{min:[20,1],max:[21,2]},value:1}]}};
  const run=W.runtime.create(scene);
  run.advance(5);
  assert.equal(queue(run).pending.length,0);
  const prior=actor(run,'middle'), distant=actor(run,'distant');
  run.schedule([command(6,'world/transfer',{from:'tank/site',to:'ford/site',amount:.6})]);
  run.step();
  assert.equal(queue(run).served.length,0);
  assert.equal(status(run,'lead').status,'safe-segment');
  assert.equal(status(run,'middle').status,'safe-segment');
  assert.equal(status(run,'edge').status,'waiting');
  assert(actor(run,'middle').position[0]>prior.position[0]);
  assert(actor(run,'middle').route.every(point=>point[0]<6));
  assert.strictEqual(actor(run,'distant').route,distant.route);
  run.step();
  assert.deepEqual(queue(run).served.map(row=>[row.agent,row.status]),[['lead','unreachable']]);
  assert.deepEqual(status(run,'lead'),{status:'blocked',reason:'unreachable'});
  assert.equal(status(run,'middle').status,'safe-segment');
  assert.strictEqual(actor(run,'distant').route,distant.route);
});

test('a reopened shortcut queues a cheaper route while the existing detour stays usable',()=>{
  const scene=world({walker:walk(1,1.5)},{nav:{water:'ford/water'},crew:{replanTicks:250}});
  const account=(origin,initial)=>({kind:'water',config:{width:1,height:1,origin,
    accounts:{site:origin.map(n=>n+.5)},
    initial:[{bounds:{min:origin,max:origin.map(n=>n+1)},value:initial}]}});
  scene.systems.ford=account([6,1],.6);
  scene.systems.tank=account([20,1],0);
  const run=W.runtime.create(scene);
  run.advance(2);
  const detour=actor(run,'walker');
  assert(detour.route.some(point=>point[2]!==1.5));
  run.schedule([command(3,'world/transfer',{from:'ford/site',to:'tank/site',amount:.6})]);
  run.step();
  const waiting=actor(run,'walker');
  assert.equal(status(run,'walker').status,'safe-segment');
  assert.strictEqual(waiting.route,detour.route);
  assert(waiting.position[0]>detour.position[0]);
  run.step();
  assert.equal(status(run,'walker').status,'ready');
  assert(actor(run,'walker').route.slice(1).every(point=>point[2]===1.5));
});

test('seek, despawn and generation reuse supersede older requests',()=>{
  const run=W.runtime.create(world({one:walk(1,1),two:walk(1,2),three:walk(1,3)}));
  run.step();
  const two=actor(run,'two');
  run.schedule([
    command(2,'crew/seek',{agent:'one',to:[4,0,1],priority:9}),
    command(2,'crew/despawn',{agent:'two',generation:two.generation}),
    command(2,'crew/spawn',{agent:'two',...walk(2,2,[5,0,2])})
  ]);
  run.step();
  assert.deepEqual(queue(run).served.map(row=>row.agent),['three']);
  const [first,second]=queue(run).pending;
  assert.equal(first.priority,9);
  assert.equal(first.tick,2);
  assert.deepEqual(first.to,[4,0,1]);
  assert(second.generation>two.generation);
  assert.deepEqual(second.to,[5,0,2]);
  run.step();
  assert.deepEqual(actor(run,'one').route.at(-1),[4,0,1]);
  assert.equal(status(run,'two').status,'waiting');
  run.step();
  assert.deepEqual(actor(run,'two').route.at(-1),[5,0,2]);
});

test('planner limits and an unresolved request remain distinct from physical blockage',()=>{
  const run=W.runtime.create(world({one:walk(1,1)},{nav:{tiles:{size:4,maxVisits:1}}}));
  run.step();
  assert.equal(status(run,'one').status,'waiting');
  run.step();
  assert.deepEqual(status(run,'one'),{status:'limited',reason:'budget'});
  run.step();
  assert.equal(status(run,'one').status,'limited');
  assert.equal(queue(run).pending.length,0);
});

test('activity selection waits for each candidate and can test an alternative',()=>{
  const scene=world({one:walk(5,1.5,[5,0,1.5])},{nav:{
    bounds:{min:[0,-1,1.2],max:[14,2,1.8]},clearance:'rig/clearance'
  },crew:{decisions:{interval:6,members:{one:['work']},activities:{work:{
    destinations:{near:{at:[7,0,1.5]},far:{at:[1,0,1.5]}}
  }}}}});
  scene.systems.rig={kind:'mechanics',config:{gravity:[0,0,0],bodies:{
    wall:{fixed:true,position:[6,.3,1.5],half:[.25,.75,.55]}
  }}};
  const run=W.runtime.create(scene);
  run.step();
  assert.equal(status(run,'one').status,'waiting');
  assert.equal(queue(run).pending[0].kind,'activity');
  assert.equal(run.query().probe('crew/decisions').value.one.phase,'idle');
  run.step();
  assert.equal(queue(run).served[0].status,'unreachable');
  assert.deepEqual(queue(run).pending[0].to,[1,0,1.5]);
  const saved=clone(run.checkpoint());
  const resumed=W.runtime.create(saved.world,{checkpoint:saved});
  for(const current of [run,resumed]){
    current.step();
    assert.equal(current.query().probe('crew/decisions').value.one.choice.destination,'far');
    assert.equal(status(current,'one').status,'ready');
  }
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
});

test('an older pending request gains priority over newer work',()=>{
  const budget=W.routeRequests.create({maxRequestsPerTick:1});
  const row=(id,routePriority,tick)=>({id,generation:1,routePriority,routing:{request:{tick,kind:'travel',to:[1,0,0]}}});
  const {work}=budget.begin([row('fresh',5,10),row('old',0,4)],11,{tick:0,served:[]},
    ()=>({from:[0,0,0],result:{status:'ok'}}));
  assert.deepEqual(work.served.map(row=>row.agent),['old']);
});

test('cohort checkpoints retain pending requests until detailed locomotion resumes',()=>{
  const scene=world({a:walk(1,2),b:walk(1,3)});
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},
    {id:'far',within:40,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['crew']}},focus:{viewer:{at:[4,0,4]}}};
  scene.commands=[
    command(2,'world/chunk-focus',{id:'viewer',at:[30,0,4]}),
    command(4,'world/chunk-focus',{id:'viewer',at:[4,0,4]})
  ];
  const run=W.runtime.create(scene);
  run.step();
  assert.deepEqual(queue(run).pending.map(row=>row.agent),['a','b']);
  run.advance(3);
  const saved=clone(run.checkpoint());
  assert.equal(saved.states.crew.model,'cohorts');
  assert.equal(queue(run).tick,1);
  assert.deepEqual(queue(run).pending.map(row=>row.agent),['a','b']);
  const restored=W.runtime.create(saved.world,{checkpoint:saved});
  for(const current of [run,restored]){
    current.step();
    assert.deepEqual(queue(current).served.map(row=>row.agent),['a']);
    assert.equal(status(current,'a').status,'ready');
    assert.equal(status(current,'b').status,'waiting');
  }
  assert.deepEqual(run.checkpoint(),restored.checkpoint());
});
