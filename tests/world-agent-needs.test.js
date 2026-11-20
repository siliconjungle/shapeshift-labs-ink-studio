const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const clone=value=>JSON.parse(JSON.stringify(value));
const home=[-1.5,.1,0], across=[1.5,.1,0], ford=[0,.1,0];
const at=(tick,action,args)=>({tick,action,args});
const sample=(run,name,args,point)=>run.query().probe(name,point,args).value;
const needs=(run)=>sample(run,'crew/needs',{agent:'worker'});
const decision=run=>sample(run,'crew/decisions').worker;
const orders=run=>sample(run,'crew/orders',{agent:'worker'});
const stock=(run,account)=>sample(run,'world/account',{account}).balance;
const setNeed=(tick,need,value)=>at(tick,'crew/set-need',{agent:'worker',need,value});
const issue=(tick,task)=>at(tick,'crew/issue-order',{agent:'worker',order:{id:task,task}});
const transfer=(from,to,amount)=>({op:'transfer',from,to,amount});

function world(){
  return {id:'need-shift',dt:.1,systems:{
    river:{kind:'water',config:{width:1,height:1,cell:[1,4],origin:[-.5,-2],base:0,accounts:{ford:[0,0]}}},
    supplies:{kind:'store',config:{accounts:{
      head:{resource:'water',units:'world^3',initial:4},
      depot:{resource:'grain',units:'bag',type:'integer',initial:2},
      cargo:{resource:'grain',units:'bag',type:'integer',initial:0,max:2},
      store:{resource:'grain',units:'bag',type:'integer',initial:0,max:2}
    }}},
    crew:{kind:'agents',config:{ground:.1,cell:.18,replanTicks:1,water:'river/water',
      bounds:{min:[-2.5,0,-1.4],max:[2.5,2,1.4]},
      species:{walker:{mode:'walk',speed:2,radius:.12,maxWade:.1}},agents:{worker:{species:'walker',position:home}},
      orders:{tasks:{
        haul:{steps:[transfer('supplies/depot','supplies/cargo',1),{op:'wait',ticks:5},
          transfer('supplies/cargo','supplies/store',1)]},
        ford:{blockedTimeout:3,steps:[transfer('supplies/depot','supplies/cargo',1),{op:'move',at:across},
          transfer('supplies/cargo','supplies/store',1)]}
      }},
      decisions:{
        interval:1,cycle:12,needs:{hunger:{max:100,perTick:1},alarm:{max:1}},
        members:{worker:{activities:['work','eat','shelter'],needs:{hunger:1}}},
        activities:{
          work:{priority:8,duration:6,commitment:'finish',destinations:{here:{at:home}}},
          eat:{needWhen:{path:'/hunger',op:'gte',value:3},needPriority:{hunger:2},
            duration:1,needEffects:{hunger:-100},destinations:{table:{at:home}}},
          shelter:{priority:100,urgent:true,schedule:[{start:10,end:2}],needWhen:{path:'/alarm',value:1},
            destinations:{high:{at:home}}}
        }
      }
    }}
  }};
}

test('needs change priority and a commitment finishes before the worker eats',()=>{
  const run=W.runtime.create(world());
  assert.equal(needs(run).values.hunger,1);
  run.advance(5);
  assert.equal(decision(run).choice.activity,'work');
  assert.equal(decision(run).evidence.committed,'work');
  assert(decision(run).evidence.scores.eat>decision(run).evidence.scores.work);
  run.advance(7);
  assert.equal(decision(run).phase,'complete');
  run.advance(8);
  assert.equal(decision(run).choice.activity,'eat');
  assert.equal(needs(run).values.hunger,9);
  run.advance(9);
  assert.equal(needs(run).values.hunger,0);
  assert.equal(run.history.find(row=>row.kind==='activity-completed'&&row.choice.activity==='eat').needs.hunger,0);
  run.advance(10);
  assert.equal(decision(run).choice.activity,'work');
  assert.equal(run.history.filter(row=>row.kind==='activity-completed'&&row.choice.activity==='eat').length,1);
});

test('urgent activity interrupts an eligible commitment and a wrapping schedule closes on its boundary',()=>{
  const scene=world();
  scene.systems.crew.config.decisions.interval=7;
  scene.systems.crew.config.decisions.activities.work.duration=50;
  const run=W.runtime.create(scene);
  run.schedule([setNeed(10,'alarm',1)]);
  run.advance(9);
  assert.equal(decision(run).choice.activity,'work');
  run.advance(10);
  assert.equal(needs(run).values.alarm,1);
  assert.equal(decision(run).choice.activity,'shelter');
  assert(run.history.some(row=>row.kind==='activity-interrupted'&&row.tick===10&&row.by==='shelter'));
  run.advance(13);
  assert.equal(decision(run).choice.activity,'shelter');
  run.advance(14);
  assert.notEqual(decision(run).choice.activity,'shelter');
  assert(decision(run).evidence.rejected.some(row=>row.activity==='shelter'&&row.reason==='outside-schedule'));
  assert.deepEqual(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('a hauling order keeps its progress while needs rise and leaves a meal eligible after delivery',()=>{
  const scene=world();
  scene.systems.crew.config.decisions.activities.eat.needPriority.hunger=4;
  scene.systems.crew.config.decisions.activities.work.priority=1;
  const run=W.runtime.create(scene);
  run.advance(2);
  run.schedule([issue(3,'haul')]);
  run.advance(6);
  assert.equal(decision(run).phase,'idle');
  assert.equal(needs(run).values.hunger,7);
  assert.equal(stock(run,'supplies/cargo'),1);
  const resume=W.runtime.create(scene,{checkpoint:clone(run.checkpoint())});
  run.advance(15);
  resume.advance(15);
  assert.deepEqual(resume.checkpoint(),run.checkpoint());
  const result=orders(run).outcomes[0], meal=run.history.find(row=>row.kind==='activity-started'&&row.choice.activity==='eat');
  assert.equal(result.phase,'succeeded');
  assert.equal(stock(run,'supplies/store'),1);
  assert(meal.tick>result.ended);
  assert.equal(stock(run,'supplies/cargo'),0);
});

test('a flooded route abandons an order after consecutive confirmed blocks and keeps posted cargo',()=>{
  const scene=world();
  const run=W.runtime.create(scene);
  run.schedule([issue(1,'ford'),at(3,'world/transfer',{from:'supplies/head',to:'river/ford',amount:1.8})]);
  run.advance(3);
  assert(sample(run,'river/depth',undefined,ford)>.4);
  assert.equal(stock(run,'supplies/cargo'),1);
  assert.equal(orders(run).active.blockedTicks,1);
  const restored=W.runtime.create(scene,{checkpoint:clone(run.checkpoint())});
  run.advance(7);
  restored.advance(7);
  const outcome=orders(run).outcomes[0];
  assert.equal(outcome.phase,'failed');
  assert.equal(outcome.reason,'route-blocked');
  assert.equal(outcome.blockedTicks,3);
  assert(outcome.lastBlocker);
  assert.equal(stock(run,'supplies/cargo'),1);
  assert.equal(stock(run,'supplies/store'),0);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
});

test('short obstructions reset the blocked streak and substeps do not multiply it',()=>{
  const scene=world();
  scene.systems.crew.schedule={substeps:4};
  const run=W.runtime.create(scene);
  const flood=(tick,from,to)=>at(tick,'world/transfer',{from,to,amount:1.8});
  run.schedule([issue(1,'ford'),flood(3,'supplies/head','river/ford'),flood(5,'river/ford','supplies/head'),
    flood(6,'supplies/head','river/ford')]);
  run.advance(4);
  assert.equal(orders(run).active.blockedTicks,2);
  run.advance(5);
  assert.equal(orders(run).active.blockedTicks,undefined);
  run.advance(7);
  assert.equal(orders(run).active.blockedTicks,2);
  assert.equal(needs(run).values.hunger,8);
  run.advance(8);
  assert.equal(orders(run).outcomes[0].reason,'route-blocked');
});

test('need rates follow confirmed activity, and editing a meter sets the value at that tick',()=>{
  const scene=world(), config=scene.systems.crew.config.decisions;
  config.members.worker.activities=['work'];
  config.activities.work={destinations:{here:{at:home}},needRates:{hunger:-2}};
  config.members.worker.needs.hunger=12;
  scene.systems.crew.schedule={every:2};
  const run=W.runtime.create(scene);
  run.schedule([setNeed(5,'hunger',7)]);
  run.advance(4);
  assert.equal(needs(run).values.hunger,12);
  run.advance(5);
  assert.equal(needs(run).values.hunger,7);
  run.advance(6);
  assert.equal(needs(run).values.hunger,6);
  assert.throws(()=>run.schedule([setNeed(8,'hunger',101)]),/Invalid need/);
  const bad=clone(run.checkpoint());
  bad.states.crew.decisions.worker.needs.hunger=101;
  assert.throws(()=>W.runtime.create(scene,{checkpoint:bad}),/Invalid saved activity/);
});

test('a schedule requires a clock and modifiers refer to declared meters',()=>{
  const scene=world();
  delete scene.systems.crew.config.decisions.cycle;
  assert.throws(()=>W.runtime.validate(scene),/Activity schedule needs a cycle/);
  const names=world();
  names.systems.crew.config.decisions.activities.eat.needEffects.energy=-3;
  assert.throws(()=>W.runtime.validate(names),/Invalid activity need effects/);
  const ongoing=world();
  delete ongoing.systems.crew.config.decisions.activities.eat.duration;
  assert.throws(()=>W.runtime.validate(ongoing),/Activity need effects need a duration/);
});
