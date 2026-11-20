const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const clone=value=>JSON.parse(JSON.stringify(value));
const actor=(id,generation)=>({system:'crew',id,...(generation!==undefined&&{generation})});
const send=(tick,action,args)=>({tick,action,args});
const start=(tick,id,who,target,verb)=>send(tick,'use/start',{id,actor:actor(who),target,verb});
const cancel=(tick,id,who)=>send(tick,'use/cancel',{id,actor:actor(who)});
const field=(run,name,args)=>run.query().probe(name,undefined,args).value;
const attempt=(run,id)=>field(run,'use/attempts',{id});
const target=(run,target)=>field(run,'use/target',{target});
const gate=run=>field(run,'rig/bodies').gate.position[1];
const account=(run,account)=>field(run,'world/account',{account}).balance;
const order=(tick,who,id,task,params,mode='append')=>send(tick,'crew/issue-order',{
  agent:who,mode,order:{id,task,...(params!==undefined&&{params})}
});

function world(){
  const faction=(name,position)=>({species:'worker',position,metadata:{faction:name,trained:true}});
  return {id:'interaction-yard',dt:.1,causality:{limit:256},
    entities:{
      control:{position:[0,0,0],sockets:{handle:[0,0,0]},metadata:{faction:'river'}},
      patch:{position:[-1,0,0]}, bench:{position:[3,0,0]}
    },systems:{
      crew:{kind:'agents',config:{bounds:{min:[-6,-1,-4],max:[6,4,4]},ground:0,
        species:{worker:{mode:'walk',radius:.13,speed:2}},
        agents:{guard:faction('river',[-.3,0,0]),medic:faction('river',[-2.8,0,0]),
          patient:faction('river',[1.1,0,0]),outsider:faction('hill',[.2,0,0]),helper:faction('river',[-.5,0,0])},
        orders:{tasks:{
          help:{steps:[{op:'interact',system:'use',target:{param:'recipient'},verb:'heal'}]},
          pause:{steps:[{op:'wait',ticks:4}]},
          gather:{steps:[{op:'interact',system:'use',target:'patch',verb:'harvest'}]}
        }}}},
      rig:{kind:'mechanics',config:{bodies:{gate:{position:[0,.6,1.3],half:[.1,.6,.48]}},
        joints:{lift:{kind:'slider',mode:'position',anchor:[0,.6,1.3],axis:[0,1,0],range:[0,1.5],speed:30,child:'gate'}}}},
      stock:{kind:'store',config:{accounts:{
        patch:{resource:'berry',units:'basket',type:'integer',initial:3},
        depot:{resource:'berry',units:'basket',type:'integer',initial:0,max:2}
      }}},
      weather:{kind:'fields',config:{fields:{safe:{default:1}}}},
      use:{kind:'targeted-interactions',config:{
        verbs:{
          open:{range:.55,ticks:3,access:{relation:'same'},cue:'gate-opened'},
          heal:{range:.65,ticks:5,access:{relation:'same'},actorWhen:{path:'/metadata/trained',value:true},
            targetWhen:{path:'/values/health',op:'lt',value:10},
            requires:[{field:'weather/safe',at:'target',when:{value:1}}]},
          harvest:{range:.8,ticks:1,access:{factions:['river']},cue:'harvested'},
          claim:{range:1,ticks:0,targetWhen:{path:'/values/occupied',value:0}},
          tag:{range:.95,ticks:0,access:{relation:'different'},cue:'tag-scored'}
        },
        targets:{
          gate:{at:{entity:'control',socket:'handle'},tags:['secure'],
            verbs:{open:{effect:{action:'world/input',args:{port:'rig/drive.lift',value:1.5}}}}},
          patient:{at:{agent:actor('patient')},attributes:{health:{initial:4,min:0,max:10}},
            verbs:{heal:{changes:{health:{add:4}}},tag:{changes:{health:{add:-1}}}}},
          patch:{at:{entity:'patch'},attributes:{pickings:{initial:0,min:0}},capacity:2,
            verbs:{harvest:{changes:{pickings:{add:1}},
              effect:{action:'world/transfer',args:{from:'stock/patch',to:'stock/depot',amount:2}}}}},
          bench:{at:{entity:'bench'},attributes:{occupied:{initial:0,min:0,max:1}},
            verbs:{claim:{changes:{occupied:{set:1}}}}}
        }
      }}
    }};
}

test('gate access uses the live faction, due ticks, and the typed signal path',()=>{
  const run=W.runtime.create(world());
  assert(run.composition().systems.use.emits.includes('gate-opened'));
  const preview=field(run,'use/check',{actor:actor('outsider'),target:'gate',verb:'open'});
  assert.equal(preview.reason,'access-denied');
  assert.equal(preview.subject.tags[0],'secure');
  run.schedule([start(1,'denied','outsider','gate','open'),start(1,'open','guard','gate','open'),
    start(1,'waiting','helper','gate','open'),cancel(2,'open','outsider')]);
  run.advance(3);
  assert.equal(attempt(run,'denied').reason,'access-denied');
  assert.equal(attempt(run,'waiting').reason,'target-busy');
  assert.equal(attempt(run,'open').due,4);
  assert.equal(field(run,'use/check',{actor:actor('guard'),target:'gate',verb:'open'}).reason,'actor-busy');
  assert.equal(gate(run),.6);
  assert(run.history.some(row=>row.kind==='interaction-denied'&&row.reason==='cancel-not-owner'));
  const restored=W.runtime.create(world(),{checkpoint:clone(run.checkpoint())});
  restored.advance(5);
  run.advance(5);
  assert.equal(attempt(run,'open').status,'completed');
  assert.equal(attempt(run,'open').port,'rig/drive.lift');
  assert.equal(gate(run),2.1);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.equal(run.history.filter(row=>row.kind==='gate-opened').length,1);
  const cause=run.query().trace('world/cause',undefined,{port:'rig/drive.lift'});
  assert.equal(cause.status,'ok');
});

test('range is evaluated again after live socket edits and author cancellation takes precedence',()=>{
  const run=W.runtime.create(world());
  run.schedule([start(1,'mobile','guard','gate','open'),send(2,'world/patch',{
    edits:[{op:'set',path:'/entities/control/position',value:[-2,0,0]}]
  }),start(3,'far','guard','gate','open'),start(3,'near','medic','patch','harvest'),
    start(4,'abort','medic','patch','harvest'),cancel(4,'abort','medic')]);
  run.advance(3);
  assert.equal(attempt(run,'mobile').reason,'out-of-range');
  assert.equal(attempt(run,'far').status,'rejected');
  assert.equal(attempt(run,'near').reason,'out-of-range');
  run.schedule([start(4,'reserved','helper','patch','harvest'),cancel(5,'reserved','helper')]);
  run.advance(6);
  assert.equal(attempt(run,'reserved').status,'cancelled');
  assert.equal(account(run,'stock/depot'),0);
  assert.equal(gate(run),.6);
});

test('competing timed harvests settle conservative stock and adjust attributes together',()=>{
  const run=W.runtime.create(world());
  run.schedule([start(1,'winner','helper','patch','harvest'),start(1,'blocked','guard','patch','harvest')]);
  run.advance(2);
  assert.equal(attempt(run,'winner').status,'completed');
  assert.equal(attempt(run,'blocked').reason,'transfer-blocked');
  assert.equal(attempt(run,'blocked').receipt.status,'blocked');
  assert.equal(account(run,'stock/patch'),1);
  assert.equal(account(run,'stock/depot'),2);
  assert.equal(target(run,'patch').values.pickings,1);
  assert.equal(run.history.filter(row=>row.kind==='harvested').length,1);
  assert.equal(run.checkpoint().transfers.length,2);
  assert.deepEqual(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('an order approaches its live target, holds range, and restarts a cancelled attempt after interruption',()=>{
  const run=W.runtime.create(world());
  run.schedule([order(1,'medic','aid','help',{recipient:'patient'})]);
  for(let t=1;t<50&&!field(run,'use/attempts').active.length;t++)run.advance(t);
  const running=field(run,'use/attempts').active[0];
  assert(running);
  assert.equal(running.target,'patient');
  assert.equal(target(run,'patient').values.health,4);
  run.schedule([order(running.started+1,'medic','short-pause','pause',undefined,'interrupt')]);
  run.advance(running.started+1);
  assert.equal(attempt(run,running.id).reason,'order-inactive');
  const branch=W.runtime.create(world(),{checkpoint:clone(run.checkpoint())});
  run.advance(55);
  branch.advance(55);
  const outcomes=field(run,'crew/orders',{agent:'medic'}).outcomes;
  assert.deepEqual(outcomes.map(row=>row.phase),['succeeded','succeeded']);
  const aid=outcomes[1].results[0];
  assert.equal(aid.op,'interact');
  assert.notEqual(aid.attempt,running.id);
  assert.equal(target(run,'patient').values.health,8);
  assert.deepEqual(branch.checkpoint(),run.checkpoint());
});

test('a timed interaction cannot affect a recycled target and an ineligible request has no consequence',()=>{
  const run=W.runtime.create(world());
  run.schedule([send(1,'world/patch',{edits:[{op:'set',path:'/entities/bench/position',value:[0,0,0]}]}),
    start(1,'claim-first','guard','bench','claim'),start(2,'claim-again','guard','bench','claim'),
    start(1,'tag','outsider','patient','tag'),order(3,'medic','aid','help',{recipient:'patient'})]);
  run.advance(2);
  assert.equal(target(run,'bench').values.occupied,1);
  assert.equal(attempt(run,'claim-again').reason,'ineligible');
  assert.equal(target(run,'patient').values.health,3);
  for(let t=3;t<50&&!field(run,'use/attempts').active.length;t++)run.advance(t);
  const active=field(run,'use/attempts').active[0];
  assert(active);
  const t=active.started+1;
  run.schedule([send(t,'crew/despawn',{agent:'patient'}),send(t,'crew/spawn',{
    agent:'patient',species:'worker',position:[1.1,0,0],metadata:{faction:'river'}
  })]);
  run.advance(t);
  assert.equal(attempt(run,active.id).reason,'target-replaced');
  assert.notEqual(target(run,'patient').agent.generation,active.targetActor.generation);
  assert.equal(target(run,'patient').values.health,3);
});

test('a new field condition or faction revocation stops a pending consequence',()=>{
  const scene=world();
  scene.systems.crew.config.agents.medic.position=[.65,0,0];
  const run=W.runtime.create(scene);
  run.schedule([start(1,'medic','medic','patient','heal'),start(1,'keeper','guard','gate','open'),
    send(2,'weather/set',{field:'safe',region:{bounds:{min:[0,-1, -1],max:[2,1,1]},value:0}}),
    send(2,'world/patch',{edits:[{op:'set',path:'/entities/control/metadata/faction',value:'hill'}]})]);
  run.advance(9);
  assert.equal(attempt(run,'medic').reason,'requirement-unmet');
  assert.equal(attempt(run,'medic').field,'weather/safe');
  assert.equal(attempt(run,'keeper').reason,'access-denied');
  assert.equal(target(run,'patient').values.health,4);
  assert.equal(gate(run),.6);
});

test('the same runtime can call an existing transactional construction effect',()=>{
  const scene=world();
  scene.systems.wall={kind:'construction',config:{initiallyBuilt:false,
    points:{center:{position:[3,.4,-2]}},
    blocks:[{id:'wall',at:'center',half:[.22,.4,1]}]
  }};
  scene.systems.use.config.targets.bench.verbs.claim.effect={action:'wall/build',args:{}};
  scene.entities.bench.position=[0,0,0];
  const run=W.runtime.create(scene);
  run.schedule([start(1,'claim','guard','bench','claim')]);
  run.advance(1);
  assert.equal(attempt(run,'claim').status,'completed');
  assert(field(run,'wall/bodies').wall);
});

test('bad effect, missing verb, invalid attribute and damaged checkpoint fail validation',()=>{
  const unknown=world();
  unknown.systems.use.config.targets.gate.verbs.open.effect.action='rig/fracture';
  assert.throws(()=>W.runtime.validate(unknown),/Unsupported targeted interaction effect/);
  const badPort=world();
  badPort.systems.use.config.targets.gate.verbs.open.effect.args.value='up';
  assert.throws(()=>W.runtime.validate(badPort),/Invalid value for rig\/drive.lift/);
  const badOrder=world();
  badOrder.systems.crew.config.orders.tasks.help.steps[0].system='absent';
  assert.throws(()=>W.runtime.validate(badOrder),/Unknown targeted interaction service/);
  const run=W.runtime.create(world());
  const cp=clone(run.checkpoint());
  cp.states.use.values.patient.health=12;
  assert.throws(()=>W.runtime.create(world(),{checkpoint:cp}),/Invalid saved interaction attributes/);
  assert.throws(()=>run.schedule([start(1,'bad','guard','gate','heal')]),/Unknown interaction offering/);
});
