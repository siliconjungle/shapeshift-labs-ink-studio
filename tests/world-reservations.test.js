const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();

const json=value=>JSON.parse(JSON.stringify(value));
const point=(x,z=0)=>[x,0,z];
const command=(tick,action,args)=>({tick,action,args});
const one=(...anyOf)=>({anyOf});
const issue=(tick,agent,task,require,{system='crew',id=task,mode='append',targets,params,timeout}={})=>
  command(tick,system+'/issue-order',{agent,mode,order:{id,task,
    ...(require&&{reservation:{board:'board',require}}),...(targets&&{targets}),...(params&&{params}),...(timeout&&{timeout})}});
const cancel=(tick,agent,order)=>command(tick,'crew/cancel-order',{agent,order});
const probe=(run,field,args)=>run.query().probe(field,undefined,args).value;
const orders=(run,agent,system='crew')=>probe(run,system+'/orders',{agent});
const claims=run=>probe(run,'board/claims');
const pool=(run,pool)=>probe(run,'board/pools',{pool});
const job=(run,job)=>probe(run,'board/jobs',{job});

function agents(names,extras={}){
  return {kind:'agents',config:{
    bounds:{min:[-1,-1,-3],max:[14,3,12]},
    species:{worker:{mode:'walk',speed:4}},
    agents:Object.fromEntries(names.map((agent,i)=>[agent,{species:'worker',position:point(0,i*.2)}])),
    orders:{tasks:{
      use:{steps:[{op:'wait',ticks:4}]},
      urgent:{steps:[{op:'wait',ticks:3}]},
      visit:{steps:[{op:'move',at:{target:'destination'}},{op:'emit',kind:'site-reached'}]}
    }},
    ...extras
  }};
}
function scene(board,names=['ana','bo']){
  return {dt:.1,systems:{board:{kind:'reservations',config:board},crew:agents(names)}};
}

test('two rosters compete for a posted job and only one reaches its reserved socket',()=>{
  const source=scene({},['ana']);
  source.systems.other=agents(['bo']);
  source.entities={crate:{position:point(2),sockets:{handle:point(.3)}}};
  const run=W.runtime.create(source);
  const need={crate:one('unload')}, targets={destination:{claim:'crate'}};
  run.schedule([issue(1,'bo','visit',need,{system:'other',targets}),issue(1,'ana','visit',need,{targets}),
    command(2,'board/post-job',{job:'unload',at:{entity:'crate',socket:'handle'},metadata:{kind:'haul'}})]);
  run.advance(1);
  assert(claims(run).every(row=>row.reason==='not-offered'));
  run.advance(3);
  assert.deepEqual(claims(run).map(row=>[row.owner.agent,row.status]),[['ana','held'],['bo','waiting']]);
  const saved=json(run.checkpoint()), resumed=W.runtime.create(saved.world,{checkpoint:saved});
  run.advance(20);
  resumed.advance(20);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
  assert.equal(job(run,'unload').status,'completed');
  assert.equal(job(run,'unload').completedBy.agent,'ana');
  assert.equal(job(run,'unload').available,0);
  assert.equal(orders(run,'bo','other').outcomes[0].reason,'job-completed');
  const arrive=run.history.filter(row=>row.kind==='site-reached');
  assert.equal(arrive.length,1);
  assert.equal(arrive[0].grants[0].pool,'unload');
  assert(arrive[0].at[0]>2.2);
  assert.deepEqual(claims(run),[]);
});

test('twenty villagers time-share five shelter spaces without exceeding capacity',()=>{
  const names=Array.from({length:20},(_,i)=>'villager-'+String(i).padStart(2,'0'));
  const run=W.runtime.create(scene({pools:{shelter:{capacity:5}}},names));
  run.schedule(names.slice().reverse().map(name=>issue(1,name,'use',{cover:one('shelter')})));
  const admissions=[];
  for(let t=1;t<=18;t++){
    run.step();
    assert(pool(run,'shelter').reserved<=5);
    admissions.push(...run.events.filter(row=>row.kind==='reservation-granted').map(row=>[row.agent,row.tick]));
    if(t===1)assert.equal(claims(run).filter(row=>row.status==='waiting').length,15);
  }
  assert.deepEqual(admissions.map(([name])=>name),names);
  assert.deepEqual([...new Set(admissions.map(([,tick])=>tick))],[1,5,9,13]);
  assert.equal(pool(run,'shelter').available,5);
  assert(names.every(name=>orders(run,name).outcomes[0].phase==='succeeded'));
});

test('a whole bundle finds a compatible combination and never holds an incomplete set',()=>{
  const run=W.runtime.create(scene({pools:{bench:{capacity:1},spare:{capacity:1},tool:{capacity:2}}}));
  run.schedule([issue(1,'ana','use',{counter:one('bench','spare'),seat:one('bench'),kit:{anyOf:['tool'],units:2}}),
    issue(1,'bo','use',{kit:{anyOf:['tool'],units:2},other:one('future')})]);
  run.advance(1);
  const [a,b]=claims(run);
  assert.deepEqual(a.grants.map(g=>[g.claim,g.pool,g.units]),[['counter','spare',1],['seat','bench',1],['kit','tool',2]]);
  assert.equal(b.reason,'not-offered');
  assert.deepEqual(b.grants,[]);
  run.advance(4);
  for(const name of ['bench','spare','tool'])assert.equal(pool(run,name).reserved,0);
  assert.equal(orders(run,'bo').active.reason,'not-offered');
});

test('interrupting releases the slot immediately and resumed work reacquires its selected destination',()=>{
  const run=W.runtime.create(scene({pools:{west:{capacity:1},east:{capacity:1}}}));
  run.schedule([issue(1,'ana','use',{cover:one('west','east')}),
    issue(1,'bo','use',{cover:one('west')}),
    issue(2,'ana','urgent',null,{mode:'interrupt'})]);
  run.advance(2);
  assert.deepEqual(claims(run).map(row=>[row.owner.agent,row.status,row.grants[0]?.pool]),
    [['ana','paused','west'],['bo','held','west']]);
  assert(run.events.some(event=>event.agent==='ana'&&event.kind==='reservation-released'&&event.reason==='interrupted'));
  run.advance(5);
  assert.equal(pool(run,'west').reserved,0);
  run.advance(6);
  assert.deepEqual(claims(run).map(row=>[row.owner.agent,row.status,row.grants[0]?.pool]),[['ana','held','west']]);
  run.advance(10);
  assert.equal(orders(run,'ana').outcomes.at(-1).phase,'succeeded');
});

test('leases expire before transfer settlement and the next worker can claim the released resource',()=>{
  const source=scene({pools:{crate:{capacity:1,leaseTicks:1}}});
  source.systems.stock={kind:'store',config:{accounts:{
    supply:{initial:2,max:2,type:'integer',resource:'gear',units:'item'},
    pack:{initial:0,max:2,type:'integer',resource:'gear',units:'item'}
  }}};
  source.systems.crew.config.orders.tasks.load={steps:[{op:'transfer',from:'stock/supply',to:'stock/pack',amount:1}]};
  const run=W.runtime.create(source);
  run.schedule([issue(1,'ana','load',{crate:one('crate')}),issue(1,'bo','use',{crate:one('crate')})]);
  run.advance(1);
  assert.equal(orders(run,'ana').active.phase,'settling');
  run.advance(2);
  assert.equal(probe(run,'world/account',{account:'stock/pack'}).balance,0);
  assert.equal(orders(run,'ana').outcomes[0].reason,'reservation-expired');
  assert.equal(claims(run)[0].owner.agent,'bo');
  assert.equal(claims(run)[0].status,'held');
  assert(run.events.some(row=>row.agent==='ana'&&row.kind==='reservation-released'&&row.reason==='reservation-expired'));
});

test('a failed claimant frees its job, and withdrawn revisions cannot complete a newly posted job',()=>{
  const source=scene({jobs:{target:{metadata:{role:'haul'}}}});
  const run=W.runtime.create(source);
  const exact={job:one('target')}, filter={job:{job:{path:'/metadata/role',value:'haul'}}};
  run.schedule([issue(1,'ana','use',exact,{timeout:1}),issue(1,'bo','use',filter),
    command(4,'board/withdraw-job',{job:'target'}),
    command(4,'board/post-job',{job:'target',metadata:{role:'haul'}})]);
  run.advance(3);
  assert.equal(orders(run,'ana').outcomes[0].reason,'timeout');
  assert.equal(claims(run)[0].owner.agent,'bo');
  assert.equal(claims(run)[0].status,'held');
  run.advance(4);
  assert.equal(orders(run,'bo').outcomes[0].reason,'reservation-withdrawn');
  const replacement=job(run,'target');
  assert.equal(replacement.status,'open');
  assert.equal(replacement.revision,2);
  assert.equal(replacement.available,1);
});

test('cancellation and despawn release capacity and a recycled ID has a new reservation owner',()=>{
  const run=W.runtime.create(scene({pools:{slot:{capacity:1}}}));
  const request={slot:one('slot')};
  run.schedule([issue(1,'ana','use',request),issue(1,'bo','use',request),cancel(2,'ana','use'),
    command(3,'crew/despawn',{agent:'bo',generation:2}),
    command(3,'crew/spawn',{agent:'bo',species:'worker',position:point(1)}),issue(3,'bo','use',request)]);
  run.advance(3);
  assert.equal(orders(run,'ana').outcomes[0].phase,'cancelled');
  assert.equal(claims(run).length,1);
  assert.equal(claims(run)[0].owner.generation,3);
  assert(run.events.some(event=>event.kind==='reservation-released'&&event.generation===2));
  assert(run.events.some(event=>event.kind==='reservation-granted'&&event.generation===3));
});

test('job closure survives substeps and an evicted order outcome',()=>{
  const source=scene({jobs:{target:{}}},['ana']);
  source.systems.crew.schedule={substeps:4};
  source.systems.crew.config.orders.historyLimit=1;
  source.systems.crew.config.orders.tasks.now={steps:[{op:'wait',ticks:0}]};
  const run=W.runtime.create(source);
  run.schedule([issue(1,'ana','now',{job:one('target')},{id:'reserved'}),
    issue(1,'ana','now',null,{id:'ordinary'})]);
  run.step();
  assert.equal(orders(run,'ana').outcomes[0].id,'ordinary');
  assert.equal(job(run,'target').status,'completed');
  assert.deepEqual(claims(run),[]);
});

test('non-detailed agents acquire on wake while an existing lease can expire while asleep',()=>{
  const source=scene({pools:{slot:{capacity:1,leaseTicks:2}}});
  source.simulationChunks={grid:{size:16},levels:[{id:'near',within:1,every:1},
    {id:'far',within:40,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},{id:'sleep',sleep:true}],
    chunks:{yard:{index:[0,0],systems:['crew'],wake:{commands:false}}},focus:{viewer:{at:[4,0,4]}}};
  const run=W.runtime.create(source);
  const request={slot:one('slot')};
  run.schedule([issue(1,'ana','use',request),
    command(2,'world/chunk-focus',{id:'viewer',at:[90,0,4]}),issue(2,'bo','use',request),
    command(5,'world/chunk-focus',{id:'viewer',at:[30,0,4]}),
    command(8,'world/chunk-focus',{id:'viewer',at:[4,0,4]})]);
  run.advance(7);
  assert.equal(run.checkpoint().states.crew.model,'cohorts');
  assert.deepEqual(claims(run).map(row=>[row.owner.agent,row.status]),[['ana','failed'],['bo','waiting']]);
  assert.equal(pool(run,'slot').available,1);
  const resumed=run.fork();
  run.advance(8);
  resumed.advance(8);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
  assert.equal(orders(run,'ana').outcomes[0].reason,'reservation-expired');
  assert.deepEqual(claims(run).map(row=>[row.owner.agent,row.status]),[['bo','held']]);
});

test('invalid boards, target bindings and overbooked saved ledgers are rejected',()=>{
  const run=W.runtime.create(scene({pools:{slot:{capacity:1},spare:{capacity:1}}}));
  const invalid=issue(1,'ana','use',{slot:one('slot')});
  invalid.args.order.reservation.board='missing';
  assert.throws(()=>run.schedule([invalid]),/Unknown reservation board/);
  assert.throws(()=>run.schedule([issue(1,'ana','visit',{slot:one('slot')},{targets:{destination:{claim:'wrong'}}})]),
    /Invalid targets/);
  run.schedule([issue(1,'ana','use',{slot:one('slot')})]);
  run.step();
  const saved=json(run.checkpoint());
  Object.values(saved.states.board.sessions)[0].grants[0].units=2;
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved}),/exceed capacity/);
  const badGrant=Object.values(saved.states.board.sessions)[0].grants[0];
  badGrant.units=1;
  badGrant.pool='spare';
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved}),/Invalid grant for saved reservation/);
});
