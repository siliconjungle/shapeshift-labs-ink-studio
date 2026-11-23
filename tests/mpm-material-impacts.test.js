const assert=require('node:assert/strict');
const {test}=require('node:test');
const {KIT}=require('..').load();
const {rasterSimulation:sim,graph}=KIT.procedural;

const mask=(width,height)=>({width,height,channels:1,data:new Uint8Array(width*height).fill(255)});
const sample=(image,x,y)=>image.data[y*image.width+x];
const sum=plane=>plane.data.reduce((a,b)=>a+b,0);
const clock={dt:.02,maxTicks:150,seed:37};
const material=(density=1,type='fluid')=>({type,density,stiffness:0});
const session=(settings,options={})=>sim.session(sim.define('mpm',settings,clock),{materialPasses:true,...options});
const single={width:34,height:24,cell:1.5,substeps:5,gravity:[0,0],maxSpeed:85,damping:0};

test('MPM deposits per-material coverage and mass independently of the legacy density field',()=>{
  const bodies=[{points:[[6.5,7.5]],spacing:2},{points:[[21.5,9.5]],material:1,spacing:2}];
  const state=session({...single,bodies,materials:[material(1),material(3),material(2)]}).seekTick(0);
  const {materialCoverage,materialDensity,compression,materialCompression,contact}=state.passes;
  assert.equal(sum(materialDensity[0]),4);
  assert.equal(sum(materialDensity[1]),12);
  assert.equal(sum(materialDensity[2]),0);
  assert.equal(sum(state.field),8);
  assert.equal(sample(materialCoverage[0],6,7),1);
  assert.equal(sample(materialCoverage[1],6,7),0);
  assert.equal(sum(compression),0);
  assert.equal(sum(materialCompression[0]),0);
  assert.equal(sum(contact),0);
  assert.deepEqual(state.report.impact,{total:0,peak:0,at:null});
  assert.equal(sim.session(state.checkpoint.recipe).seekTick(0).passes,undefined);
});

test('Impulses respect body and material selection, radius, seconds and fixed-tick replay',()=>{
  const bodies=[{points:[[6.5,7.5],[7.5,8.5]]},{points:[[22.5,10.5]],material:1},
    {points:[[13.5,18.5]],material:1,release:.4}];
  const recipe={...single,bodies,materials:[material(),material()],
    impulses:[{tick:2,body:0,deltaVelocity:[24,0]}, {time:.021,material:1,at:[22.5,10.5],radius:2,deltaVelocity:[0,18]}]};
  const run=session(recipe,{every:2});
  const before=run.seekTick(1), tick2=run.seekTick(2), after=run.seekTick(3), later=run.seekTick(5);
  assert.deepEqual(before.points.map(p=>p.velocity),[[0,0],[0,0],[0,0],[0,0]]);
  assert(tick2.points[0].velocity[0]>23);
  assert.equal(tick2.points[2].velocity[1],0);
  assert(after.points[2].velocity[1]>17);
  assert(later.points[2].velocity[1]<19);
  assert.deepEqual(later.points[3].velocity,[0,0]);
  assert.deepEqual(run.seekTick(2).points,tick2.points);
  assert.deepEqual(run.seekTick(5).points,later.points);
  assert.deepEqual(sim.session(null,{checkpoint:JSON.parse(JSON.stringify(tick2.checkpoint)),materialPasses:true})
    .seekTick(5).points,later.points);
  assert.throws(()=>session({...recipe,impulses:[{tick:2,time:.02,deltaVelocity:[0,20]}]}),/timed MPM impulse/);
});

test('A falling fluid produces measured wall contact and compression with portable contact history',()=>{
  const run=session({...single,width:40,height:38,gravity:[0,130],bounce:0,
    walls:[[0,31,40,7]],materials:[{type:'fluid',stiffness:420}],
    bodies:[{rect:[15,6,9,7],spacing:.84,velocity:[0,23]}]},{every:4});
  let hit;
  for (let i=1;i<46;i++) {
    const current=run.seekTick(i);
    if (!hit || current.report.impact.peak>hit.report.impact.peak) hit=current;
  }
  assert(hit.report.impact.peak>1);
  const [x,y]=hit.report.impact.at.map(Math.floor);
  assert(y>=26 && y<31);
  assert.equal(sample(hit.passes.contact,x,y),hit.report.impact.peak);
  assert(sample(hit.passes.collisionMask,x,32)===255);
  assert(hit.passes.materialCompression[0].data.some(value=>value>.03));
  const restored=JSON.parse(JSON.stringify(hit.checkpoint));
  const replay=sim.session(null,{checkpoint:restored,materialPasses:true});
  assert.deepEqual(replay.seekTick(restored.tick).passes,hit.passes);
  assert.deepEqual(run.seekTick(restored.tick).passes,hit.passes);
  const later=run.seekTick(restored.tick+1);
  assert.deepEqual(replay.seekTick(restored.tick+1).passes,later.passes);
  delete restored.state.contacts;
  const legacy=sim.session(null,{checkpoint:restored,materialPasses:true});
  assert.deepEqual(legacy.seekTick(restored.tick).points,hit.points);
  assert.equal(sum(legacy.seekTick(restored.tick).passes.contact),0);
  assert.deepEqual(legacy.seekTick(restored.tick+1).passes,later.passes);
});

test('A moving mask transfers momentum, exposes its registered position, and replays without penetration',()=>{
  const moving={id:'paddle',mask:mask(3,14),maskChannel:0,keys:[{time:0,at:[4,3]},{time:.5,at:[17,3]}]};
  const run=session({...single,bounce:.12,materials:[material()],bodies:[{rect:[12,8,5,4],spacing:1}],
    colliders:[moving]},{every:4});
  const start=run.seekTick(0);
  assert.equal(sample(start.passes.collisionMask,4,8),255);
  let strongest=start;
  for(let i=1;i<=31;i++){
    const result=run.seekTick(i);
    assert(result.points.every(({point:[x,y]})=>sample(result.passes.collisionMask,Math.floor(x),Math.floor(y))===0));
    if (result.report.impact.total>strongest.report.impact.total) strongest=result;
  }
  const final=run.seekTick(30);
  assert.deepEqual(final.report.colliders,[{id:'paddle',at:[17,3]}]);
  assert.equal(sample(final.passes.collisionMask,4,8),0);
  assert.equal(sample(final.passes.collisionMask,17,8),255);
  assert(final.points.some(p=>p.point[0]>22));
  assert(strongest.report.impact.peak>1);
  assert.deepEqual(run.seekTick(strongest.checkpoint.tick).passes,strongest.passes);
  const branch=sim.session(null,{checkpoint:strongest.checkpoint,materialPasses:true});
  assert.deepEqual(branch.seekTick(30).passes,final.passes);
  assert.deepEqual(branch.seekTick(30).points,final.points);
  const invalid={...moving,keys:[moving.keys[0],{time:.001,at:[20,3]}]};
  assert.throws(()=>session({...single,colliders:[invalid]}),/moves too far/);
});

test('Graph MPM ports can isolate one material and color actual contact',()=>{
  const source=graph.create({nodes:{
    make:{op:'sim.define',inputs:{kind:'mpm',clock,settings:{...single,materials:[material(),material(4)],
      bodies:[{points:[[10.5,10.5]],material:1}]}}},
    step:{op:'sim.mpm',inputs:{recipe:{node:'make'}}},
    isolate:{op:'raster.select',inputs:{sources:{node:'step',port:'materialDensity'},index:1}},
    rim:{op:'color.gradient',inputs:{source:{node:'step',port:'contact'}, ramp:['#000000','#ffdf95'],
      options:{channel:0,range:[0,8]}}}
  },outputs:{pigment:{node:'isolate'},rim:{node:'rim'},contact:{node:'step',port:'contact'}}});
  const {pigment,rim,contact}=source.evaluate().outputs;
  assert(sample(pigment,10,10)>1);
  assert.deepEqual(Array.from(rim.data.slice(0,4)),[0,0,0,255]);
  assert.equal(sum(contact),0);
  source.clear();
  assert.throws(()=>sim.session(sim.define('grain'),{materialPasses:true}),/MPM simulation recipe/);
});
