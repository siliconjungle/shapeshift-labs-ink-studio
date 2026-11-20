const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const clone=value=>JSON.parse(JSON.stringify(value));
const point=(x,z=0)=>[x,.1,z];
const action=(tick,action,args)=>({tick,action,args});
const change=(tick,name,args)=>action(tick,'county/'+name,args);
const read=(run,field,args)=>run.query().probe(field,undefined,args).value;
const totals=run=>read(run,'county/totals');
const person=(run,resident)=>read(run,'county/residents',{resident});
const agent=(run,agent)=>read(run,'crew/agent',{agent});
const house=(run,household)=>read(run,'county/households',{household});
const district=(run,district)=>read(run,'county/districts',{district});
const workplace=(run,workplace)=>read(run,'county/workplaces',{workplace});
const demand=(run,args)=>read(run,'county/demand',args);
const cap=(tick,workplace,capacity)=>change(tick,'set-capacity',{workplace,capacity});
const field=(tick,name,value)=>action(tick,'conditions/set',{
  field:name,region:{bounds:{min:[-4,-1,-4],max:[4,2,4]},value}
});

function village(){
  return {id:'households',dt:.1,entities:{hill:{position:point(2)},low:{position:point(-2)},mill:{position:point(-1.2,.8)}},
    systems:{
      conditions:{kind:'fields',config:{fields:{flood:{default:0},admission:{default:0}}}},
      pantry:{kind:'store',config:{accounts:{grain:{resource:'food',units:'serving',type:'integer',initial:6}}}},
      county:{kind:'population',config:{
        interval:4,rosters:['crew'],resources:{food:'serving',fuel:'bundle'},householdDemand:{fuel:1},
        groups:{adult:{work:true,demand:{food:2}},child:{demand:{food:1}},elder:{demand:{food:1}}},
        districts:{low:{at:{entity:'low'},capacity:20,supply:{food:'pantry/grain'}},
          hill:{at:{entity:'hill'},capacity:40}},
        workplaces:{mill:{district:'low',at:{entity:'mill'},capacity:2},works:{district:'hill',capacity:3}},
        households:{
          alder:{district:'low',groups:{adult:2,child:1},demand:{food:1},residents:{
            ada:{group:'adult',name:'Ada',age:30,actor:{system:'crew',agent:'ada'}},
            olin:{group:'elder',name:'Olin',age:80}
          }},
          birch:{district:'hill',groups:{adult:1}}
        }
      }},
      crew:{kind:'agents',config:{ground:.1,bounds:{min:[-4,0,-4],max:[4,2,4]},
        species:{walker:{mode:'walk',radius:.14,speed:2}},agents:{ada:{species:'walker',position:point(-2.45)}}}}
    }};
}

test('households share demand, account supply, and retain named assignments across slot revisions',()=>{
  const run=W.runtime.create(village());
  assert.equal(totals(run).population,6);
  assert.equal(totals(run).named,2);
  assert.equal(totals(run).anonymous,4);
  assert.equal(totals(run).workers,4);
  assert.equal(person(run,'ada').employment,'mill');
  assert.deepEqual(workplace(run,'mill').position,point(-1.2,.8));
  assert.equal(workplace(run,'mill').cohorts.alder.adult,1);
  assert.equal(demand(run,{household:'alder'}).values.fuel.requested,1);
  assert.equal(demand(run,{district:'low'}).values.food.requested,9);
  assert.equal(demand(run,{district:'low'}).values.food.shortfall,3);
  assert.equal(read(run,'world/signal',{port:'county/population'}),6);
  assert.equal(read(run,'world/signal',{port:'county/demand'}).food,11);
  run.schedule([cap(1,'mill',1),cap(2,'mill',2),change(3,'move-household',{household:'alder',district:'hill'})]);
  run.advance(1);
  assert.equal(workplace(run,'mill').employed,1);
  assert.equal(person(run,'ada').employment,'mill');
  run.advance(2);
  assert.equal(workplace(run,'mill').employed,2);
  run.advance(3);
  assert.equal(district(run,'low').population,0);
  assert.equal(district(run,'hill').population,6);
  assert.equal(person(run,'ada').employment,'works');
  assert.equal(person(run,'ada').actor.generation,agent(run,'ada').generation);
  assert.equal(agent(run,'ada').position[0],-2.45);
  assert.equal(demand(run,{district:'hill'}).values.food.requested,11);
  assert.equal(totals(run).moved,5);
});

test('birth, household departure, return, materialization, and death preserve civic identity',()=>{
  const scene=village(), run=W.runtime.create(scene), generation=person(run,'ada').actor.generation;
  run.schedule([
    change(1,'birth',{household:'alder',group:'child',resident:'nell',name:'Nell'}),
    change(2,'materialize',{resident:'nell',system:'crew',species:'walker',at:point(-2,1)}),
    change(3,'emigrate',{household:'alder'}),
    change(5,'immigrate',{household:'alder',district:'hill'}),
    change(6,'materialize',{resident:'ada',system:'crew',species:'walker',at:point(2)}),
    change(7,'death',{resident:'nell'})
  ]);
  run.advance(2);
  assert.equal(person(run,'nell').born,1);
  assert.equal(agent(run,'nell').generation,person(run,'nell').actor.generation);
  assert.equal(totals(run).births,1);
  run.advance(3);
  assert.equal(house(run,'alder').status,'away');
  assert.equal(totals(run).population,1);
  assert.equal(person(run,'ada').status,'away');
  assert.equal(agent(run,'ada'),undefined);
  assert.equal(agent(run,'nell'),undefined);
  const branch=W.runtime.create(scene,{checkpoint:clone(run.checkpoint())});
  run.advance(8);branch.advance(8);
  assert.equal(person(run,'ada').name,'Ada');
  assert.equal(person(run,'ada').born,-30);
  assert.notEqual(person(run,'ada').actor.generation,generation);
  assert.equal(person(run,'nell').status,'deceased');
  assert.equal(person(run,'nell').ageTicks,6);
  assert.equal(totals(run).arrivals,6);
  assert.equal(totals(run).departures,6);
  assert.equal(totals(run).deaths,1);
  assert.equal(totals(run).population,6+1+6-6-1);
  assert.deepEqual(branch.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('population rules respect world conditions and preserve rate remainders across a fork',()=>{
  const scene=village(), config=scene.systems.county.config;
  config.rules={
    arrivals:{kind:'immigrate',district:'hill',group:'adult',count:2,when:[{field:'conditions/admission',when:{value:1}}]},
    babies:{kind:'birth',district:'low',from:'adult',group:'child',rate:.25},
    flight:{kind:'move',district:'low',to:'hill',count:1,when:[{field:'conditions/flood',when:{value:1}}]},
    maturity:{kind:'transition',from:'child',group:'adult',rate:.5}
  };
  const run=W.runtime.create(scene);
  run.schedule([field(5,'admission',1),field(5,'flood',1)]);
  run.advance(4);
  assert.equal(totals(run).lastPulse,4);
  assert.equal(run.checkpoint().states.county.remainder['babies/alder'],.75);
  assert.equal(totals(run).arrivals,0);
  run.advance(7);
  assert.equal(district(run,'low').population,5);
  const branch=W.runtime.create(scene,{checkpoint:clone(run.checkpoint())});
  bothAdvance(8);
  assert.equal(totals(run).lastPulse,8);
  assert.equal(district(run,'low').population,0);
  assert.equal(house(run,'alder').district,'hill');
  assert.equal(totals(run).births,1);
  assert.equal(totals(run).arrivals,2);
  assert.equal(house(run,'arrivals.8').anonymous,2);
  assert.equal(totals(run).population,9);
  assert.equal(totals(run).moved,6);
  bothAdvance(16);

  function bothAdvance(tick){
    run.advance(tick);branch.advance(tick);
    assert.deepEqual(branch.checkpoint(),run.checkpoint());
  }
});

test('a named resident ages into work, and retirement removes only the pinned generation',()=>{
  const scene=village(), cfg=scene.systems.county.config;
  cfg.groups.child.after=4;
  cfg.groups.child.next='adult';
  cfg.groups.elder.after=8;
  cfg.households.alder.residents.ada={...cfg.households.alder.residents.ada,group:'child'};
  cfg.households.alder.residents.olin.actor={system:'crew',agent:'olin'};
  scene.systems.crew.config.agents.olin={species:'walker',position:point(-3)};
  cfg.workplaces.mill.capacity=4;
  const run=W.runtime.create(scene), adult=person(run,'ada').actor.generation, old=person(run,'olin').actor.generation;
  run.schedule([
    action(6,'crew/despawn',{agent:'olin'}),
    action(6,'crew/spawn',{agent:'olin',species:'walker',position:point(-3)})
  ]);
  run.advance(4);
  assert.equal(person(run,'ada').group,'adult');
  assert.equal(person(run,'ada').employment,'mill');
  assert.equal(person(run,'ada').actor.generation,adult);
  run.advance(8);
  assert.equal(person(run,'olin').status,'deceased');
  assert.equal(person(run,'olin').closed,8);
  assert.notEqual(agent(run,'olin').generation,old);
});

test('a coarse roster applies a named removal and keeps the remaining census representation',()=>{
  const scene=village();
  scene.systems.county.config.households.alder.residents.olin.actor={system:'crew',agent:'olin'};
  scene.systems.crew.config.agents.olin={species:'walker',position:point(-3)};
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},{id:'far',within:40,every:2,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{village:{index:[0,0],systems:['crew']}},focus:{camera:{at:[25,0,4]}}};
  const run=W.runtime.create(scene);
  assert.equal(read(run,'world/representation',{system:'crew'}).representation,'aggregate');
  run.schedule([action(2,'world/chunk-focus',{id:'camera',at:[75,0,4]}),change(3,'death',{resident:'olin'}),
    action(5,'world/chunk-focus',{id:'camera',at:[5,0,4]})]);
  run.advance(3);
  const representation=read(run,'world/representation',{system:'crew'});
  assert.equal(run.checkpoint().simulationChunks.entries.village.sleeping,true);
  assert.equal(representation.representation,'aggregate');
  assert.equal(representation.quantities.population.value,1);
  assert.equal(person(run,'olin').status,'deceased');
  assert.equal(person(run,'ada').actor.generation,agent(run,'ada').generation);
  assert.deepEqual(W.runtime.create(scene,{checkpoint:clone(run.checkpoint())}).checkpoint(),run.checkpoint());
  run.advance(5);
  assert.equal(read(run,'world/representation',{system:'crew'}).representation,'detail');
  assert.equal(agent(run,'olin'),undefined);
});

test('cohort mortality and automatic emigration preserve named identities while changing counts',()=>{
  const scene=village(), cfg=scene.systems.county.config;
  cfg.households.alder.groups.elder=2;
  cfg.rules={
    deaths:{kind:'death',district:'low',from:'elder',rate:.5},
    leave:{kind:'emigrate',district:'low',count:1,when:[{field:'conditions/flood',when:{value:1}}]}
  };
  const run=W.runtime.create(scene);
  run.schedule([field(5,'flood',1)]);
  run.advance(4);
  assert.equal(totals(run).deaths,1);
  assert.equal(person(run,'olin').status,'present');
  run.advance(8);
  assert.equal(person(run,'olin').status,'away');
  assert.equal(totals(run).deaths,1);
  assert.equal(totals(run).departures,6);
  assert.equal(totals(run).population,1);
});

test('housing caps and named/anonymous boundaries reject unlawful changes atomically',()=>{
  const scene=village(), config=scene.systems.county.config;
  config.districts.low.capacity=5;
  const run=W.runtime.create(scene);
  run.schedule([
    change(1,'birth',{household:'alder',group:'adult',count:1}),
    change(1,'death',{household:'alder',group:'elder',count:1}),
    change(1,'immigrate',{household:'duplicate',district:'hill',residents:{ada:{group:'adult'}}}),
    change(2,'set-capacity',{district:'low',capacity:6}),
    change(2,'birth',{household:'alder',group:'child',count:1})
  ]);
  run.advance(1);
  assert.equal(totals(run).population,6);
  assert.equal(person(run,'olin').status,'present');
  assert.deepEqual(run.history.filter(row=>row.kind==='population-rejected').map(row=>row.reason),
    ['housing-capacity','cohort-capacity','identity-in-use']);
  run.advance(2);
  assert.equal(totals(run).births,1);
  assert.equal(district(run,'low').population,6);
});

test('a named death updates the physical roster and releases a job before transfers settle',()=>{
  const scene=village();
  scene.systems.board={kind:'reservations',config:{jobs:{crate:{at:point(-2.45)}}}};
  scene.systems.crew.config.orders={tasks:{carry:{steps:[{op:'wait',ticks:20}]}}};
  const run=W.runtime.create(scene);
  run.schedule([
    action(1,'crew/issue-order',{agent:'ada',order:{task:'carry',reservation:{board:'board',require:{crate:{anyOf:['crate']}}}}}),
    change(3,'death',{resident:'ada'})
  ]);
  run.advance(2);
  assert.equal(read(run,'board/claims')[0].status,'held');
  run.advance(3);
  assert.equal(agent(run,'ada'),undefined);
  assert.equal(read(run,'board/claims').length,0);
  assert.equal(read(run,'board/jobs',{job:'crate'}).available,1);
  assert.equal(workplace(run,'mill').employed,2);
  assert.deepEqual(workplace(run,'mill').named,[]);
});

test('anonymous residents and slots scale independently of physical actors',()=>{
  const scene=village(), config=scene.systems.county.config;
  config.rosters=[];
  config.households=Object.fromEntries(Array.from({length:50},(_,i)=>['home'+i,{district:'low',groups:{adult:1000}}]));
  config.districts.low.capacity=60000;
  config.workplaces.mill.capacity=30000;
  config.rules={births:{kind:'birth',from:'adult',group:'child',rate:.1}};
  delete scene.systems.crew;
  const run=W.runtime.create(scene);
  run.advance(4);
  assert.equal(totals(run).population,55000);
  assert.equal(totals(run).named,0);
  assert.equal(totals(run).employed,30000);
  assert.equal(demand(run,{district:'low'}).values.food.requested,105000);
  assert.equal(Object.keys(workplace(run,'mill').cohorts).length,30);
});

test('mismatched supplies, unknown species and tampered employment fail validation',()=>{
  const invalid=village();
  invalid.systems.pantry.config.accounts.grain.units='kilo';
  assert.throws(()=>W.runtime.validate(invalid),/Population supply account/);
  const scene=village(), run=W.runtime.create(scene);
  assert.throws(()=>run.schedule([change(1,'materialize',{resident:'olin',system:'crew',species:'absent'})]),/Unknown population actor species/);
  const corrupt=clone(run.checkpoint());
  corrupt.states.county.employment.cohorts.mill.alder.adult=3;
  assert.throws(()=>W.runtime.create(scene,{checkpoint:corrupt}),/Invalid saved employment assignments/);
});
