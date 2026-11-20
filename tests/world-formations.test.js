const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const example=require('../examples/world-expedition-formation.json');
const json=value=>JSON.parse(JSON.stringify(value));
const p=(x,z=0)=>[x,0,z];
const at=(run,field,args)=>run.query().probe('crew/'+field,undefined,args).value;
const formation=(run,group='expedition')=>at(run,'formations',{group});
const bridge=run=>at(run,'bottlenecks').bridge;
const rows=run=>at(run,'agents');
const actor=(run,id)=>rows(run)[id];
const command=(tick,key,args)=>({tick,action:'crew/'+key,args});
const move=(tick,group,to,facing)=>command(tick,'group-move',{group,to,...(facing&&{facing})});
const porters=Array.from({length:5},(_,i)=>'porter-'+(i+1));

function flat({groups={},mode='walk',bounds={min:[-3,-1,-3],max:[12,4,3]},options={}}={}){
  const names=['ace','bob','cal','dax'];
  const agents=Object.fromEntries(names.map((name,i)=>[name,{species:i?'quick':'slow',position:[0,mode==='fly'?1:0,i*.68-1]}]));
  return {dt:.1,systems:{crew:{kind:'agents',config:{bounds,
    species:{slow:{mode,speed:1.2,radius:.12},quick:{mode,speed:3,radius:.12}},
    agents,formations:{groups,...options},orders:{tasks:{stop:{steps:[{op:'wait',ticks:4}]}}}
  }}}};
}

test('a formation narrows through the bridge, reforms on the far bank, and detaches a surveyor',()=>{
  const run=W.runtime.create(example);
  let narrow=false, widest=0, saved;
  for(let tick=1;tick<=128;tick++){
    run.step();
    const people=rows(run), deck=porters.map(id=>people[id]).filter(row=>row.position[0]>4.2&&row.position[0]<7.8);
    assert(bridge(run).holders.length<=2);
    if(deck.length>=2){
      const z=deck.map(row=>row.position[2]), span=Math.max(...z)-Math.min(...z);
      narrow ||= span<.08;
    }
    for(const [i,left] of Object.values(people).entries())for(const right of Object.values(people).slice(0,i))
      assert(Math.hypot(left.position[0]-right.position[0],left.position[2]-right.position[2])>=
        left.radius+right.radius-1e-6);
    widest=Math.max(widest,formation(run).observed.lateralSpan);
    if(tick===40)saved=json(run.checkpoint());
  }
  const group=formation(run);
  assert(narrow&&widest>1.4);
  assert.equal(group.phase,'arrived');
  assert.equal(group.move.assignment.columns,3);
  assert.equal(group.observed.atSlots,5);
  assert(group.observed.lateralSpan>1.45);
  assert.deepEqual(group.members.map(row=>row.agent),porters);
  assert.equal(bridge(run).completed.a,5);
  assert.equal(at(run,'orders',{agent:'surveyor'}).outcomes[0].phase,'succeeded');
  assert(actor(run,'surveyor').position[0]<2&&actor(run,'surveyor').position[2]>2);
  const replay=W.runtime.replay(json(run.recording()));
  const restore=W.runtime.create(saved.world,{checkpoint:saved}), fork=restore.fork();
  for(const resumed of [restore,fork])resumed.advance(128);
  for(const other of [replay,restore,fork])assert.deepEqual(other.checkpoint(),run.checkpoint());
});

test('live terrain detects a narrow corridor even without a passage reservation',()=>{
  const scene=json(example);
  delete scene.systems.crew.config.crowd.bottlenecks;
  scene.commands=scene.commands.slice(0,1);
  const run=W.runtime.create(scene);
  run.advance(4);
  assert.equal(formation(run).phase,'compressing');
  assert(formation(run).move.stages.some(stage=>stage.kind==='passage'));
  run.advance(150);
  const group=formation(run);
  assert.equal(group.phase,'arrived');
  assert.equal(group.observed.atSlots,6);
  assert.equal(group.move.assignment.columns,3);
});

test('a moving formation paces faster flyers and assigns slots in the requested facing',()=>{
  const scene=flat({mode:'fly',groups:{red:{members:['ace','bob','cal'],layout:{columns:3,spacing:.7}}}});
  const run=W.runtime.create(scene);
  run.schedule([move(1,'red',[4,2,0],[0,0,1])]);
  run.advance(2);
  assert.equal(formation(run,'red').observed.pace,1.2);
  assert(Math.hypot(...actor(run,'bob').velocity)<=1.2+1e-6);
  run.advance(70);
  const group=formation(run,'red');
  assert.equal(group.phase,'arrived');
  const slots=Object.values(group.move.assignment.slots);
  assert(slots.every(point=>Math.abs(point[1]-2)<1e-6&&Math.abs(point[2])<1e-6));
  const x=slots.map(point=>point[0]);
  assert(Math.max(...x)-Math.min(...x)>1.35);
});

test('a destination narrows its slot layout when space is limited and widens when clearance returns',()=>{
  const scene=flat({groups:{red:{members:['ace','bob','cal'],layout:{columns:3,spacing:.68}}},
    options:{retryTicks:8}});
  scene.systems.walls={kind:'fields',config:{fields:{gap:{type:'number',axes:'xz',default:10,regions:[
    {id:'upper',bounds:{min:[3.4,.24],max:[7,3]},value:-1},
    {id:'lower',bounds:{min:[3.4,-3],max:[7,-.24]},value:-1}
  ]}}}};
  scene.systems.crew.config.clearance='walls/gap';
  const run=W.runtime.create(scene);
  run.schedule([move(1,'red',p(5))]);
  run.advance(75);
  assert.equal(formation(run,'red').phase,'arrived');
  assert.equal(formation(run,'red').move.assignment.columns,1);
  run.schedule([{tick:76,action:'walls/set',args:{field:'gap',
    region:{bounds:{min:[3.4,-3],max:[7,3]},value:10}}}]);
  run.advance(105);
  assert.equal(formation(run,'red').phase,'arrived');
  assert.equal(formation(run,'red').move.assignment.columns,3);
});
test('joining, stopping and recycled identities remain independent of personal orders',()=>{
  const run=W.runtime.create(flat({groups:{red:{members:['ace','bob']}}}));
  run.schedule([move(1,'red',p(4)),command(3,'group-join',{group:'red',members:['cal']}),
    command(4,'issue-order',{agent:'bob',order:{task:'stop'}}),
    command(9,'despawn',{agent:'cal',generation:3}),
    command(9,'spawn',{agent:'cal',species:'quick',position:p(0,2)})]);
  run.advance(5);
  assert.equal(formation(run,'red').observed.suspended,1);
  assert.equal(formation(run,'red').members.length,3);
  run.advance(10);
  assert.deepEqual(formation(run,'red').members.map(row=>row.agent),['ace','bob']);
  assert.equal(actor(run,'cal').generation,5);
  run.schedule([command(11,'group-stop',{group:'red'}),command(11,'seek',{agent:'bob',to:p(3,2)}),
    command(12,'form-group',{group:'new',members:[{agent:'cal',generation:5},'dax'],layout:{columns:1}}),
    command(13,'group-disband',{group:'new'})]);
  run.advance(40);
  assert.equal(formation(run,'red').phase,'idle');
  assert(actor(run,'bob').position[2]>1.9);
  assert.equal(formation(run,'new'),undefined);
  assert.equal(at(run,'orders',{agent:'bob'}).outcomes[0].phase,'succeeded');
  const restored=json(run.checkpoint());
  restored.states.crew.formations.red.members[0].generation=10;
  assert.throws(()=>W.runtime.create(restored.world,{checkpoint:restored}),/saved formation identity/);
});

test('a mid-bridge detachment clears the passage before following its solo destination',()=>{
  const scene=json(example);
  scene.commands=scene.commands.slice(0,1);
  const run=W.runtime.create(scene);
  let entered;
  for(let tick=1;tick<=42&&!entered;tick++){
    run.step();
    entered=bridge(run).holders.find(row=>row.entered);
  }
  assert(entered);
  const next=run.view().tick+1, {agent,generation}=entered;
  run.schedule([command(next,'group-detach',{group:'expedition',agent,generation}),
    command(next,'seek',{agent,generation,to:p(9.5,2.45)})]);
  run.advance(155);
  assert(bridge(run).completed.a>=6);
  assert.equal(bridge(run).holders.length,0);
  assert(actor(run,agent).position[2]>2.35);
  assert(!formation(run).members.some(row=>row.agent===agent));
  assert.equal(formation(run).phase,'arrived');
});

test('formation route budgets count world ticks even when agents take substeps',()=>{
  const scene=flat({groups:{red:{members:['ace','bob']},blue:{members:['cal','dax']}},options:{maxPlansPerTick:1}});
  scene.systems.crew.schedule={substeps:3};
  const run=W.runtime.create(scene);
  run.schedule([move(1,'red',p(4,-1)),move(1,'blue',p(4,1))]);
  run.advance(1);
  assert.equal(formation(run,'blue').move.plannedAt,1);
  assert.equal(formation(run,'red').reason,'route-budget');
  assert.equal(formation(run,'red').move.plannedAt,null);
  run.advance(2);
  assert.equal(formation(run,'red').move.plannedAt,2);
});

test('sleeping or coarse formations retain their destinations and continue on detail wake',()=>{
  const scene=flat({groups:{red:{members:['ace','bob']}}});
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},{id:'far',within:45,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['crew']}},focus:{viewer:{at:[4,0,4]}}};
  const run=W.runtime.create(scene);
  run.schedule([move(1,'red',p(5)),
    {tick:3,action:'world/chunk-focus',args:{id:'viewer',at:[30,0,4]}},
    {tick:11,action:'world/chunk-focus',args:{id:'viewer',at:[4,0,4]}}]);
  run.advance(2);
  const before=actor(run,'ace').position;
  run.advance(10);
  assert.equal(run.checkpoint().states.crew.model,'cohorts');
  assert.deepEqual(actor(run,'ace').position,before);
  assert.deepEqual(formation(run,'red').move.to,p(5));
  const saved=json(run.checkpoint()), resume=W.runtime.create(saved.world,{checkpoint:saved});
  run.advance(80);
  resume.advance(80);
  assert.equal(formation(run,'red').phase,'arrived');
  assert.deepEqual(resume.checkpoint(),run.checkpoint());
});
