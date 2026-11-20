const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { coupledFluid, stableFluid } = KIT.procedural.motion;
const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const sum = values => values.reduce((total, value) => total + value, 0);
const clean = {diffusion:0, dissipation:0, viscosity:0};
const dye = { diffusion:0, dissipation:0 };

test('named dyes advect and decay independently with restorable fluid state', () => {
  const fluid = stableFluid({width:12,height:10,cell:.2,origin:[-1.2,-1],maxDt:.1,dyes:{jade:dye,rose:{...dye,dissipation:4}},
    initial:(x,z)=>({velocity:[-z,x], dyes:{jade:x<-.3&&z<0 ? .6 : 0,rose:x<-.3&&z<0 ? .6 : 0}})});
  const before = fluid.snapshot(), saved = fluid.checkpoint();
  const after = fluid.step(.2,clean);
  assert.notDeepEqual(after.dye('jade'),before.dye('jade'));
  close(sum(after.dye('rose')) / sum(after.dye('jade')), Math.exp(-.8));
  const red = after.dye('rose');
  red.fill(42);
  assert.ok(after.sampleDye('rose',-.6,-.2) < .6);
  fluid.restore(saved);
  assert.deepEqual(fluid.step(.2,clean).dye('rose'), after.dye('rose'));
  assert.throws(() => fluid.step(.1,{dyeSource:()=>({ultraviolet:1})}), /Unknown fluid dye/);
  assert.equal(fluid.snapshot().time,after.time);
});

test('payload loss matches cell-area normalized deposits at rest, including clipped weights', () => {
  const sim = coupledFluid({width:3,height:4,cell:[.4,.25],dt:.1,mask:(_x,_z,i)=>i!==1,
    release:3, dyes:{cyan:dye, rose:dye}, particles:[{at:[.38,.22],density:.045,dyes:{cyan:.035,rose:.012}}]});
  const frame = sim.step(2,clean), [p] = frame.particles;
  const retain = Math.exp(-.6);
  close(p.density,.045*retain);
  close(p.dyes.cyan,.035*retain);
  close(sum(frame.fluid.density)*.1,.045*(1-retain));
  close(sum(frame.fluid.dye('cyan'))*.1,.035*(1-retain));
  close(sum(frame.fluid.dye('rose'))*.1,.012*(1-retain));
  assert.equal(frame.sample('cyan',.6,.125),null);
  assert.equal(frame.fluid.dye('cyan')[1],0);
  assert.deepEqual(frame.source('velocity').sample(.38,0,.22),[0,0,0]);
  const mapped = frame.source('cyan',{bounds:{min:[0,0,2],max:[1.2,1,2]},project:([x,y])=>[x,y]});
  assert.equal(mapped.sample(.38,.22,2),frame.sample('cyan',.38,.22));
});

test('particle feedback stirs the fluid and the later field carries a passive tracer', () => {
  function run(feedback) {
    const sim = coupledFluid({width:12,height:12,cell:.2,origin:[-1.2,-1.2],dt:.07,drag:7,feedback,
      particles:[{at:[-.29,-.15],velocity:[1.3,0],mass:.06}]});
    const first = sim.step(1,clean);
    const [id] = sim.spawn([{at:[-.19,-.15],mass:0}]);
    const later = sim.step(2,clean);
    return { first, tracer:later.particles.find(p=>p.id===id) };
  }
  const active = run(1), passive = run(0);
  assert.ok(active.first.fluid.vx.some(v=>v>.1));
  assert.ok(passive.first.fluid.vx.every(v=>v===0));
  assert.ok(active.tracer.at[0] > passive.tracer.at[0]+.007);
  assert.equal(passive.tracer.at[0],-.19);
});

test('wind carries particles but neither particles nor dye can cross a sealed corner', () => {
  const sim = coupledFluid({width:2,height:2,cell:1,dt:1,windDrag:120,drag:0,release:1,dyes:{jade:dye},
    mask:(_x,_z,i)=>i===0||i===3,particles:[{at:[.5,.5],dyes:{jade:1}}]});
  const frame = sim.step(2,{...clean,wind:()=>[4,4]});
  const [x,z] = frame.particles[0].at;
  assert.ok(x>.9 && x<1 && z>.9 && z<1);
  assert.deepEqual(frame.particles[0].velocity,[0,0]);
  assert.ok(frame.fluid.dye('jade')[0]>0);
  assert.equal(frame.fluid.dye('jade')[3],0);
  assert.equal(frame.sample('jade',1.02,1.02),0);
});

test('checkpoint replay restores deposits, particle IDs and lifetime across batched failures', () => {
  const sim = coupledFluid({width:7,height:6,dt:.05,dyes:{cyan:dye},particles:[{at:[.25,.25],density:.03}]});
  const saved = sim.checkpoint(), before = sim.frame();
  assert.throws(()=>sim.step(2,{force:(_x,_z,t)=>t ? [NaN,0] : [1,0]}),/finite/);
  assert.equal(sim.frame().tick,0);
  assert.deepEqual(sim.frame().particles,before.particles);
  assert.deepEqual(sim.frame().fluid.density,before.fluid.density);
  assert.throws(()=>sim.step(1,{wind:()=>sim.spawn([])}),/during a step/);
  assert.throws(()=>sim.step(1,{source:()=> '1'}),/finite rate/);
  const item = {at:[.35,.25],lifetime:.075,dyes:{cyan:.005}};
  function finish() {
    assert.deepEqual(sim.spawn([item]),[1]);
    return sim.step(3,clean);
  }
  const expected = finish();
  assert.equal(expected.particles.length,1);
  assert.ok(expected.fluid.dye('cyan').some(Boolean));
  sim.restore(saved);
  const again = finish();
  assert.deepEqual(again.particles,expected.particles);
  assert.deepEqual(again.fluid.dye('cyan'),expected.fluid.dye('cyan'));
  sim.reset();
  assert.equal(sim.frame().tick,0);
});
