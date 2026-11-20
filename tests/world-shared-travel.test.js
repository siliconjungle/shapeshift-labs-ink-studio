const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:K}=require('..').load();
const W=K.world;
const json=value=>JSON.parse(JSON.stringify(value));
const cmd=(tick,action,args)=>({tick,action,args});
const agent=(x,z=0)=>({position:[x,0,z],species:'walker'});
const actor=(run,id)=>run.query().probe('crew/agent',{agent:id}).value;
const rides=run=>run.query().probe('crew/rides').value;
const bounds={min:[0,-2,-4],max:[14,4,6]};
const scene=(agents,config)=>({dt:.1,systems:{
  nav:{kind:'navigation',config:{bounds,cell:.3,tiles:{}}},
  crew:{kind:'agents',config:{navigation:'nav',species:{walker:{mode:'walk',speed:1.6,radius:.2}},agents,...config}}
}});
const board=(agent,extra)=>cmd(1,'crew/board-ride',{agent,ride:'shuttle',from:'west',to:'east',...extra});

test('walkers share an authored path in either direction with local avoidance and queued route planning',()=>{
  const world=scene({east:agent(2),west:agent(10)},{
    crowd:{},routeQueue:{maxRequestsPerTick:1},paths:{main:{points:[[2,0,0],[6,0,0],[10,0,0]]}}
  });
  world.commands=[cmd(1,'crew/follow-path',{agent:'east',path:'main'}),
    cmd(1,'crew/follow-path',{agent:'west',path:'main',reverse:true})];
  const run=W.runtime.create(world);
  let turned=false, queued=false;
  run.advance(110,{onTick(){
    const a=actor(run,'east'), b=actor(run,'west');
    turned ||= ['avoiding','yielding'].includes(a.crowd.status)||['avoiding','yielding'].includes(b.crowd.status);
    queued ||= run.query().probe('crew/route-queue').value.pending.length>0;
    assert(K.V.dist(a.position,b.position)>=.4-1e-6);
  }});
  assert(turned&&queued);
  assert(actor(run,'east').position[0]>9.8);
  assert(actor(run,'west').position[0]<2.2);
  assert.equal(run.query().probe('crew/travel-status',{agent:'east'}).value.phase,'idle');
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

function shuttle(agents,extra={}){
  return scene(agents,{
    paths:{track:{points:[[2,0,1],[8,0,1]]}},
    rides:{shuttle:{path:'track',motion:{mode:'pingpong',speed:3,stops:[
      {at:0,duration:.5},{at:6,duration:.5}
    ]},...extra,docks:{
      west:{at:[2,0,0],reach:1.15,queue:[[1.45,0,0],[.9,0,0]]},
      east:{at:[8,0,0],reach:1.15}
    }}}
  });
}

test('ride queues are FIFO, preserve one seat across restore, and release at the requested dock',()=>{
  const world=shuttle({first:agent(2),second:agent(1.45),third:agent(.9)});
  world.commands=[board('third'),board('second'),board('first'),
    cmd(29,'crew/seek',{agent:'first',to:[10,0,0]})];
  const run=W.runtime.create(world);
  run.advance(10);
  assert.deepEqual(rides(run).shuttle.seats,['first']);
  assert.deepEqual(rides(run).shuttle.docks.west.queue,['second','third']);
  assert.deepEqual(actor(run,'first').position,rides(run).shuttle.frame.point);
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint});
  for(const sim of [run,restored]){
    sim.advance(31);
    assert.equal(actor(sim,'first').travelPlan,undefined);
    assert.equal(actor(sim,'second').travelPlan.phase,'queueing');
    sim.advance(58);
    assert.deepEqual(rides(sim).shuttle.seats,['second']);
    assert.deepEqual(rides(sim).shuttle.docks.west.queue,['third']);
    assert.deepEqual(actor(sim,'second').position,rides(sim).shuttle.frame.point);
  }
  assert.deepEqual(run.checkpoint(),restored.checkpoint());
});

test('entity riders follow the current rigid transform and wait safely at a closed exit',()=>{
  const world=scene({rider:agent(2)},{
    rides:{shuttle:{entity:'car',seats:[[0,.2,.35]],docks:{
      west:{at:[2,0,0],reach:1.1},
      east:{at:[8,0,0],reach:1.2,open:false}
    }}}
  });
  world.systems.rig={kind:'mechanics',config:{gravity:[0,0,0],drag:0,bodies:{
    car:{position:[2,0,.4],velocity:[1,0,0],angular:[0,Math.PI,0],half:[.2,.1,.25]}
  }}};
  world.commands=[board('rider'),cmd(61,'world/input',{port:'crew/dock.shuttle.east',value:true})];
  const run=W.runtime.create(world);
  run.advance(18);
  const row=actor(run,'rider'), frame=rides(run).shuttle.frame;
  assert.equal(row.travelPlan.phase,'riding');
  assert.deepEqual(row.position,K.V.add(frame.point,K.M.app(frame.rotation,[0,.2,.35])));
  assert(Math.hypot(...row.velocity)>0);
  run.advance(60);
  assert.equal(actor(run,'rider').travelPlan.phase,'riding');
  run.advance(61);
  assert.deepEqual(actor(run,'rider').position,[8,0,0]);
  assert.deepEqual(rides(run).shuttle.seats,[null]);
});

test('coarse agents retain attached poses and release a seat on despawn',()=>{
  const world=shuttle({rider:agent(2),next:agent(1.45)});
  world.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},
    {id:'far',within:40,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['crew']}},focus:{viewer:{at:[4,0,4]}}};
  world.commands=[board('rider'),board('next'),
    cmd(5,'world/chunk-focus',{id:'viewer',at:[30,0,4]}),
    cmd(15,'world/chunk-focus',{id:'viewer',at:[4,0,4]}),
    cmd(17,'crew/despawn',{agent:'rider'})];
  const run=W.runtime.create(world);
  run.advance(12);
  assert.equal(run.checkpoint().states.crew.model,'cohorts');
  assert.deepEqual(actor(run,'rider').position,rides(run).shuttle.frame.point);
  run.advance(17);
  assert.deepEqual(rides(run).shuttle.seats,[null]);
  run.advance(58);
  assert.deepEqual(rides(run).shuttle.seats,['next']);
});

test('boarding waits while a collider blocks the transfer to an empty seat',()=>{
  const world=scene({rider:agent(2)},{
    rides:{shuttle:{entity:'car',docks:{
      west:{at:[2,0,0],reach:1.2},east:{at:[8,0,0],reach:1.2}
    }}}
  });
  world.systems.nav.config.clearance='rig/clearance';
  world.systems.rig={kind:'mechanics',config:{gravity:[0,0,0],bodies:{
    car:{fixed:true,position:[2,0,1],half:[.3,.1,.3]},
    gate:{fixed:true,position:[2,.5,.5],half:[.8,.5,.05]}
  }}};
  world.commands=[board('rider'),cmd(4,'rig/fracture',{body:'gate',parts:2,omit:[0,1]})];
  const run=W.runtime.create(world);
  run.advance(3);
  assert.equal(actor(run,'rider').travelPlan.phase,'queueing');
  assert.deepEqual(rides(run).shuttle.seats,[null]);
  run.step();
  assert.equal(actor(run,'rider').travelPlan.phase,'riding');
  assert.deepEqual(rides(run).shuttle.seats,['rider']);
});
