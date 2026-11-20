const assert = require('node:assert/strict');
const test = require('node:test');
const {KIT:K, SurfaceLook} = require('..').load();
const simulate = K.procedural.motion.trailAgents;
const near = (a,b,eps=1e-6) => assert(Math.abs(a-b)<=eps,`${a} differs from ${b}`);
const sum = a => a.reduce((a,b)=>a+b,0);
const grid = options => K.deposition.grid({width:18,height:12,cell:1,channels:{trail:{}},...options});

test('dense deposition spreads and decays on an anisotropic, insulated grid',()=>{
  const field=grid({width:5,height:5,cell:[1,2],channels:{trail:{diffusion:.4,decay:.2},guide:{}}});
  field.edit({bounds:{min:[2.5,5],max:[2.5,5]},values:{trail:2,guide:.75}});
  const start=field.frame();
  field.step();
  const f=field.frame();
  near(f.sample('trail',2.5,5),.96);
  near(f.sample('trail',3.5,5),.256);
  near(f.sample('trail',2.5,7),.064);
  near(sum(f.data('trail')),1.6);
  near(sum(f.data('guide')),.75);
  near(start.sample('trail',2.5,5),2);
  field.edit({bounds:{min:[3,0],max:[4,10]},blocked:true});
  field.step(14);
  assert.equal(field.frame().source('trail').sample(3.5,0,5),null);
  near(field.frame().sample('trail',4.5,5),0);
});

test('sensing precedes writing and signed weights support attraction and repulsion',()=>{
  const field=grid({channels:{trail:{},guide:{}}});
  field.stamp({at:[6.5,7.5],radius:1,values:{guide:2}});
  const config={speed:1,sensorDistance:Math.SQRT2,sensorAngle:Math.PI/4,turnAngle:Math.PI/4,jitter:0};
  const scene=simulate({field,agents:[{id:'nose',at:[5.5,6.5],heading:0,group:'drawn'},{id:'away',at:[5.5,6.5],heading:0,group:'avoid'}],
    groups:{drawn:{...config,sense:{guide:1},deposit:{trail:2}},avoid:{...config,sense:{guide:-1},deposit:{}}}});
  scene.step();
  assert(scene.frame().agents[0].at[1]>7);
  assert(scene.frame().agents[1].at[1]<7);
  near(sum(field.frame().data('trail')),2);

  const clock=grid(), straight={speed:1,sensorDistance:Math.SQRT2,sensorAngle:Math.PI/4,turnAngle:Math.PI/4,jitter:0};
  const run=simulate({field:clock,groups:{default:straight},agents:[
    {at:[6.5,8.5],heading:-Math.PI/2},{at:[5.5,6.5],heading:0}]});
  run.step();
  // The first deposit is in the second agent's left sensor cell.
  near(run.frame().agents[1].at[0],6.5);
  near(run.frame().agents[1].at[1],6.5);
});

test('edits cut diffusion and traversal, pause covered agents, and reopen live routes',()=>{
  const field=grid({channels:{trail:{diffusion:.32,decay:.02}}});
  const edge={min:[5,0],max:[6,12]};
  field.edit({bounds:edge,blocked:true});
  const g={speed:5,sensorDistance:0,turnAngle:0,jitter:0};
  const run=simulate({field,agents:[{at:[2.5,6.5],heading:0}],groups:{default:g},seed:77});
  run.step();
  assert.deepEqual(run.frame().agents[0].at,[2.5,6.5]);
  near(sum(field.frame().data('trail')),0);
  const trapped={min:[2,6],max:[3,7]};
  field.edit({bounds:trapped,blocked:true});
  run.step(4);
  assert.equal(run.frame().agents[0].active,false);
  field.edit({bounds:trapped,blocked:false});
  field.edit({bounds:edge,blocked:false});
  assert.equal(run.frame().agents[0].active,true);
  const cp=run.checkpoint();
  cp.poses[2]=0;
  run.restore(cp); run.step();
  near(run.frame().agents[0].at[0],7.5);
  assert(field.frame().sample('trail',7.5,6.5)>0);
  const diagonal=grid({width:2,height:2,mask:(x,z)=>(x<1)===(z<1)});
  const corner=simulate({field:diagonal,agents:[{at:[.5,.5],heading:Math.PI/4}],
    groups:{default:{...g,speed:Math.SQRT2}}});
  corner.step();
  assert.deepEqual(corner.frame().agents[0].at,[.5,.5]);
});

test('spatial edits can import a field and validate the whole write before committing',()=>{
  const field=grid({width:5,height:5,channels:{trail:{},guide:{}}});
  field.edit({values:(x,z)=>z<3?{guide:x+z}:null});
  near(field.frame().sample('guide',2.5,1.5),4);
  near(field.frame().sample('guide',2.5,3.5),0);
  const snapshot=field.checkpoint();
  assert.throws(()=>field.edit({values:x=>({guide:x>3?NaN:10})}),/invalid value/);
  assert.deepEqual(field.checkpoint(),snapshot);
});

test('seeded populations replay through external edits and preserve retained frames',()=>{
  const setup=()=>{
    const field=grid({channels:{trail:{diffusion:.53,decay:.032},food:{diffusion:.62,decay:.11}}});
    return simulate({field,agents:Array.from({length:14},(_,i)=>({at:[3.1+i*.69,4.7]})),seed:59,capacity:2,
      groups:{default:{sense:{trail:1,food:2}}},emitters:[{at:[11,8],radius:2,values:{food:1.2}}]});
  };
  const a=setup(),b=setup();
  a.step(19);
  const saved=a.frame();
  b.restore(JSON.parse(JSON.stringify(a.checkpoint())));
  for(const sim of [a,b]){
    sim.field.edit({bounds:{min:[7,5],max:[9,10]},blocked:true});
    sim.step(34);
  }
  assert.deepEqual(a.checkpoint(),b.checkpoint());
  assert.equal(saved.tick,19);
  const before=a.checkpoint();
  assert.throws(()=>a.restore({...before,poses:before.poses.slice(3)}),/invalid agent/);
  assert.throws(()=>a.field.edit({values:{trail:0},select:()=>a.step()}),/cannot mutate/);
  assert.throws(()=>a.step(10001),/work budget/);
  assert.deepEqual(a.checkpoint(),before);
  a.reset();
  assert.deepEqual(a.checkpoint(),setup().checkpoint());
});

test('the live field binds to projected material masks and world contour sources',()=>{
  const field=grid();
  field.stamp({at:[4.5,4.5],radius:2.5,values:{trail:1}});
  const source=field.frame().source('trail');
  assert(K.fieldViews.contours(source,{levels:[.35],cell:.33}).paths.some(x=>x.closed));
  const context=K.splatEffects.context({fields:{paint:field}});
  const prepared=SurfaceLook.prepare({layers:{ink:{type:'projected',field:'paint',maskChannel:'trail',
    color:'#fde8a0',projection:([x,,z])=>[x,z]}}},[],[0,1,0],context);
  const lit=SurfaceLook.shade(prepared,{position:[4.5,0,4.5],normal:[0,1,0],view:[0,1,0]},[0,0,0]);
  assert(lit[0]>.9);
});
