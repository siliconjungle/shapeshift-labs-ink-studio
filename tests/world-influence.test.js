const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const clone=value=>JSON.parse(JSON.stringify(value));
const p=(x,z=0)=>[x,.1,z];
const command=(tick,action,args)=>({tick,action,args});
const post=(tick,offer,template,rest={})=>command(tick,'public/post',{offer,template,...rest});
const amend=(tick,offer,rest)=>command(tick,'public/amend',{offer,...rest});
const withdraw=(tick,offer)=>command(tick,'public/withdraw',{offer});
const transfer=(tick,from,to,amount)=>command(tick,'world/transfer',{from,to,amount,mode:'exact'});
const input=(tick,port,value)=>command(tick,'world/input',{port,value});
const read=(run,name,args)=>run.query().probe(name,undefined,args).value;
const offer=(run,offer)=>read(run,'public/offers',{offer});
const scan=run=>read(run,'public/scan');
const balance=(run,account)=>read(run,'world/account',{account}).balance;
const currency=(initial,max=100)=>({resource:'coin',units:'coin',type:'integer',max,initial});
const total=run=>['coins/treasury','coins/ada','coins/bo','public/escrow'].reduce((sum,key)=>sum+balance(run,key),0);

function scene(){
  return {id:'council-yard',dt:.1,entities:{east:{position:p(1.9)},west:{position:p(-.9,.4)}},
    systems:{
      coins:{kind:'store',config:{accounts:{treasury:currency(40),ada:currency(0,20),bo:currency(0,20)}}},
      valve:{kind:'puzzle',config:{inputs:{open:'bool'},outputs:{water:'open'}}},
      public:{kind:'influence',config:{interval:1,retryTicks:2,
        funding:{treasury:'coins/treasury',resource:'coin',units:'coin'},templates:{
          clear:{at:{entity:'east'},target:'site',order:{task:'clear'}},
          rebuild:{at:{entity:'west'},target:'site',order:{task:'rebuild'}},
          irrigate:{at:{entity:'west'},target:'site',requires:[{
            field:'world/signal',args:{port:'valve/water'},when:{value:true}
          }],order:{task:'rebuild'}}
        }}},
      crew:{kind:'agents',config:{ground:.1,cell:.18,bounds:{min:[-4,0,-1.3],max:[4,2,1.3]},
        species:{worker:{mode:'walk',speed:2.5,radius:.13}},
        agents:{ada:{species:'worker',position:p(-1)},bo:{species:'worker',position:p(-2.3)}},
        orders:{historyLimit:1,tasks:{
          clear:{steps:[{op:'move',at:{target:'site'}},{op:'wait',ticks:2},{op:'emit',kind:'route-cleared'}]},
          rebuild:{steps:[{op:'move',at:{target:'site'}},{op:'wait',ticks:3}]},
          rest:{steps:[{op:'wait',ticks:8}]}
        }},
        influence:{board:'public',profiles:{builder:{
          templates:['clear','rebuild','irrigate'],minScore:6,distanceCost:1
        }},members:{ada:{profile:'builder',wallet:'coins/ada'},bo:{profile:'builder',wallet:'coins/bo'}}}
      }}
    }};
}
function gate(world){
  world.systems.rig={kind:'mechanics',config:{bodies:{
    door:{position:[0,.62,0],half:[.12,.58,1.48]}
  },joints:{lift:{kind:'slider',mode:'position',anchor:[0,.62,0],axis:[0,1,0],range:[0,1.4],
    speed:30,child:'door'}}}};
  world.systems.crew.config.clearance='rig/clearance';
}
function issue(tick,agent,task,mode){
  return command(tick,'crew/issue-order',{agent,order:{task},...(mode&&{mode})});
}
function orders(run,agent){return read(run,'crew/orders',{agent});}

test('agents decline a low reward, reject a blocked route, and take it once the route opens',()=>{
  const world=scene();
  gate(world);
  world.history={enabled:false};
  const run=W.runtime.create(world);
  run.schedule([post(1,'road','clear',{reward:2}),amend(3,'road',{reward:12}),
    input(5,'rig/drive.lift',1.4)]);
  run.advance(2);
  assert.equal(offer(run,'road').status,'open');
  assert(scan(run).responses.every(row=>row.reason==='insufficient-incentive'));
  run.advance(4);
  assert.equal(offer(run,'road').status,'open');
  assert(scan(run).responses.every(row=>row.reason==='unreachable'));
  assert.equal(balance(run,'public/escrow'),12);
  assert.equal(balance(run,'coins/treasury'),28);
  run.advance(7);
  const accepted=offer(run,'road');
  assert.equal(accepted.status,'assigned');
  assert.equal(accepted.owner.agent,'ada');
  assert.equal(orders(run,'bo').serial,0);
  const resume=W.runtime.create(world,{checkpoint:clone(run.checkpoint())});
  run.advance(27);
  resume.advance(27);
  assert.equal(offer(run,'road').status,'completed');
  assert.equal(balance(run,'coins/ada'),12);
  assert.equal(balance(run,'public/escrow'),0);
  assert.equal(total(run),40);
  assert.equal(run.history.length,0);
  assert.deepEqual(run.checkpoint(),resume.checkpoint());
  assert.deepEqual(run.checkpoint(),W.runtime.replay(clone(run.recording())).checkpoint());
});

test('public priority and a live local condition can attract an agent with no bounty',()=>{
  const world=scene();
  const run=W.runtime.create(world);
  run.schedule([post(1,'garden','irrigate',{priority:25}),post(1,'shed','rebuild',{priority:1}),
    amend(3,'shed',{priority:12}),input(4,'valve/open',true)]);
  run.advance(2);
  assert(scan(run).responses.some(row=>row.offer==='garden'&&row.reason==='condition-unmet'));
  assert(scan(run).responses.some(row=>row.offer==='shed'&&row.reason==='insufficient-incentive'));
  run.advance(3);
  assert.equal(offer(run,'shed').owner.agent,'ada');
  run.advance(5);
  assert.equal(offer(run,'garden').owner.agent,'bo');
  run.advance(25);
  assert.equal(offer(run,'shed').paid,0);
  assert.equal(offer(run,'garden').paid,0);
  assert.equal(total(run),40);
});

test('agent preferences and an activity commitment can outweigh an offer',()=>{
  const world=scene(), crew=world.systems.crew.config;
  crew.decisions={interval:1,needs:{hunger:{max:100}},members:{
    ada:['break'],bo:{activities:['idle'],needs:{hunger:90}}
  },activities:{break:{duration:5,commitment:'finish',destinations:{bench:{at:p(-1)}}},
    idle:{destinations:{ledge:{at:p(-2.3)}}}}};
  crew.influence.profiles.builder.when={path:'/needs/hunger',op:'lte',value:60};
  const run=W.runtime.create(world);
  run.schedule([post(2,'shed','rebuild',{priority:30})]);
  run.advance(5);
  assert.equal(offer(run,'shed').status,'open');
  assert(scan(run).responses.some(row=>row.agent==='ada'&&row.reason==='activity-committed'));
  assert(scan(run).responses.some(row=>row.agent==='bo'&&row.reason==='agent-condition'));
  run.advance(7);
  assert.equal(offer(run,'shed').owner.agent,'ada');
});

test('escrow is private, underfunded updates are atomic, and withdrawal or expiry refunds it',()=>{
  const run=W.runtime.create(scene());
  run.schedule([post(1,'a','clear',{reward:4}),post(1,'b','clear',{reward:4,expires:3}),
    amend(2,'a',{reward:38}),transfer(2,'public/escrow','coins/bo',1),withdraw(3,'a')]);
  run.advance(2);
  assert.equal(offer(run,'a').reward,4);
  assert.equal(balance(run,'public/escrow'),8);
  assert(run.history.some(row=>row.kind==='offer-rejected'&&row.reason==='funding-unavailable'));
  assert(run.checkpoint().transfers.some(row=>row.status==='blocked'&&row.limitedBy.includes('access')));
  run.advance(3);
  assert.equal(offer(run,'a').status,'withdrawn');
  assert.equal(offer(run,'b').status,'expired');
  assert.equal(balance(run,'coins/treasury'),40);
  assert.equal(balance(run,'public/escrow'),0);
});

test('the offer can use an existing job reservation and withdrawal honors its accepted reward',()=>{
  const world=scene();
  world.systems.jobs={kind:'reservations',config:{jobs:{road:{at:{entity:'east'}}}}};
  world.systems.public.config.templates.clear.order.reservation={board:'jobs',require:{road:{anyOf:['road']}}};
  const run=W.runtime.create(world);
  run.schedule([post(1,'road','clear',{reward:12}),withdraw(3,'road'),amend(4,'road',{reward:1})]);
  run.advance(4);
  assert.equal(offer(run,'road').withdrawn,true);
  assert.equal(offer(run,'road').status,'assigned');
  assert.equal(offer(run,'road').reward,12);
  const claims=read(run,'jobs/claims');
  assert.equal(claims[0].owner.agent,'ada');
  run.advance(30);
  assert.equal(offer(run,'road').status,'completed');
  assert.equal(read(run,'jobs/jobs',{job:'road'}).status,'completed');
  assert.equal(balance(run,'coins/ada'),12);
});

test('a replaced order releases the offer and a full wallet keeps a completed reward funded',()=>{
  const run=W.runtime.create(scene());
  run.schedule([post(1,'road','clear',{reward:12}),issue(3,'ada','rest','replace'),
    transfer(10,'coins/treasury','coins/bo',10)]);
  run.advance(9);
  assert.equal(offer(run,'road').owner.agent,'bo');
  assert(run.history.some(row=>row.kind==='offer-released'&&row.reason==='cancelled'));
  run.advance(33);
  assert.equal(offer(run,'road').status,'payable');
  assert.equal(balance(run,'public/escrow'),12);
  assert.equal(balance(run,'coins/bo'),10);
  run.schedule([transfer(34,'coins/bo','coins/treasury',10)]);
  run.advance(34);
  assert.equal(offer(run,'road').status,'completed');
  assert.equal(balance(run,'coins/bo'),12);
  assert.equal(balance(run,'public/escrow'),0);
  assert.equal(total(run),40);
  assert.equal(run.history.filter(row=>row.kind==='offer-completed').length,1);
});

test('pair budget rotates across open offers and carries its cursor through a checkpoint',()=>{
  const world=scene();
  world.systems.public.config.maxPairs=1;
  const run=W.runtime.create(world);
  run.schedule([post(1,'a','rebuild',{priority:0}),post(1,'b','rebuild',{priority:14})]);
  run.advance(1);
  assert.equal(scan(run).limited,true);
  const resume=W.runtime.create(world,{checkpoint:clone(run.checkpoint())});
  run.advance(20);
  resume.advance(20);
  assert.equal(offer(run,'b').status,'completed');
  assert.deepEqual(run.checkpoint(),resume.checkpoint());
});

test('route budget reaches a viable lower-scoring offer after unreachable bids',()=>{
  const world=scene();
  gate(world);
  world.systems.public.config.routeBudget=1;
  const run=W.runtime.create(world);
  run.schedule([post(1,'east','clear',{priority:50}),post(1,'west','rebuild',{priority:15})]);
  run.advance(1);
  assert.equal(scan(run).limited,true);
  assert.equal(scan(run).responses[0].reason,'unreachable');
  run.advance(4);
  assert.equal(offer(run,'east').status,'open');
  assert.equal(offer(run,'west').status,'assigned');
});

test('a full treasury retains a pending refund until it can receive the exact amount',()=>{
  const world=scene();
  world.systems.coins.config.accounts.treasury.max=40;
  world.systems.coins.config.accounts.bo.initial=4;
  const run=W.runtime.create(world);
  run.schedule([post(1,'road','clear',{reward:4}),transfer(2,'coins/bo','coins/treasury',4),withdraw(2,'road'),
    transfer(3,'coins/treasury','coins/bo',4)]);
  run.advance(2);
  assert.equal(offer(run,'road').status,'refundable');
  assert.equal(balance(run,'public/escrow'),4);
  assert.equal(run.checkpoint().transfers.filter(row=>row.requester==='public').length,1);
  run.advance(3);
  assert.equal(offer(run,'road').status,'withdrawn');
  assert.equal(balance(run,'public/escrow'),0);
  assert.equal(total(run),44);
});

test('unknown templates, wallet types, and corrupted escrow are rejected',()=>{
  const invalid=scene();
  invalid.systems.crew.config.influence.profiles.builder.templates=['missing'];
  assert.throws(()=>W.runtime.validate(invalid),/Unknown public influence template/);
  const mismatch=scene();
  mismatch.systems.coins.config.accounts.ada.resource='shell';
  assert.throws(()=>W.runtime.validate(mismatch),/Incompatible transfer accounts/);
  const run=W.runtime.create(scene());
  assert.throws(()=>run.schedule([post(1,'bad','missing')]),/Invalid influence posting/);
  const save=clone(run.checkpoint());
  save.states.public.escrow=2;
  assert.throws(()=>W.runtime.create(scene(),{checkpoint:save}),/escrow does not match/);
});
