const test = require('node:test');
const assert = require('node:assert/strict');
const { phaseChange } = require('..').load().KIT.procedural.motion;
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} != ${b}`);

test('coupled reaction limits conversion by both reactants and product room', () => {
  const grid = phaseChange({ width:2,height:1,cell:1,dt:.25,channels:{
    water:{initial:1},cold:{initial:.25},ice:{initial:.2,capacity:.6}
  },rules:[{id:'freeze',consume:{water:1,cold:.5},produce:{ice:1},
    rate:({fields,inputs})=>fields.cold * inputs.cooling * 16,emitEvery:.19}],
  finish:({fields})=>({color:[0,fields.ice,.25],roughness:fields.ice+.15,relief:fields.ice*.2}) });
  const before = grid.frame();
  const after = grid.step(1,{drive:()=>({inputs:{cooling:1}})});
  for (const i of [0,1]) {
    close(after.data('water')[i],.6);
    close(after.data('cold')[i],.05);
    close(after.data('ice')[i],.6);
    close(before.data('ice')[i],.2);
  }
  assert.deepEqual(after.events.map(e=>[e.id,e.rule,e.cell,e.time]),
    [[0,'freeze',0,.25],[1,'freeze',0,.25],[2,'freeze',1,.25],[3,'freeze',1,.25]]);
  close(after.sample('roughness',1,.5),.75);
  close(after.sample('relief',1,.5),.12);
  assert.deepEqual(after.source('color').sample(1,0,.5),[0,.6,.25]);
  const mounted = after.source('relief',{bounds:{min:[0,0,4],max:[2,1,4]},project:([x,y])=>[x,y]});
  close(mounted.sample(1,.5,4),.12);
});

test('conservative anisotropic diffusion shares with open neighbors and stays inside its mask', () => {
  const grid = phaseChange({ width:5,height:2,cell:[.25,.5],dt:.2,mask:(_x,_z,i)=>i%5!==2,
    channels:{warm:{diffusion:.4}},initial:(_x,_z,i)=>({warm:i===0 ? 1 : 0}),
    rules:[{id:'source',produce:{warm:1},rate:0}] });
  const frame = grid.step(3), heat = frame.data('warm');
  assert.ok(heat[1]>0 && heat[5]>0);
  assert.ok(heat.every((v,i)=>i%5<2||v===0));
  close(heat.reduce((sum,v)=>sum+v,0),1);
  assert.equal(frame.sample('warm',.6,.25),null);
});

test('rules sense one shared field state, with authored order controlling available stock', () => {
  const grid = phaseChange({width:1,height:1,dt:.5,channels:{ink:{initial:.8},crust:{},air:{}},rules:[
    {id:'dry',consume:{ink:1},produce:{air:1},rate:1},
    {id:'set',consume:{ink:1},produce:{crust:1},rate:({fields})=>fields.ink>.5 ? 1 : 0}
  ]});
  const after = grid.step();
  close(after.data('air')[0],.5);
  close(after.data('crust')[0],.3);
  close(after.data('ink')[0],0);
});

test('emission remainder, sequence, and state survive checkpoint replay and failed batches', () => {
  const grid = phaseChange({width:1,height:1,dt:.1,maxEvents:4,
    channels:{liquid:{initial:1},solid:{}},
    rules:[{id:'set',consume:{liquid:1},produce:{solid:1},rate:1,emitEvery:.17}]});
  const a = grid.step();
  assert.deepEqual(a.events,[]);
  const saved = grid.checkpoint();
  assert.throws(()=>grid.step(2,{drive:({time})=>time>.15 ? {sources:{solid:NaN}} : {}}),/source rate/);
  assert.equal(grid.frame().tick,1);
  assert.throws(()=>grid.step(1,{drive:()=>grid.reset()}),/during a step/);
  const b = grid.step(3);
  assert.deepEqual(b.events.map(e=>[e.id,e.time]),[[0,.2],[1,.4]]);
  assert.ok(Object.isFrozen(b.events[0].at));
  const after = b.data('solid');
  after.fill(2);
  close(b.data('solid')[0],.4);
  grid.restore(saved);
  assert.deepEqual(grid.step(3).events,b.events);
  grid.reset();
  assert.equal(grid.frame().tick,0);
  close(grid.frame().data('solid')[0],0);
  assert.throws(()=>grid.step(10),/emission budget/);
  assert.equal(grid.frame().tick,0);
});

test('masked corners stay isolated when reading material and channel fields', () => {
  const grid = phaseChange({width:2,height:2,cell:1,mask:(_x,_z,i)=>i===0||i===3,channels:{wet:{}},
    initial:(_x,_z,i)=>({wet:i===0 ? 1 : 0}),rules:[{id:'dry',consume:{wet:1},rate:0}],
    finish:({fields})=>({color:[fields.wet,0,0],roughness:fields.wet,relief:fields.wet})});
  const frame = grid.frame();
  assert.deepEqual(frame.sample('color',1.01,1.01),[0,0,0]);
  assert.equal(frame.sample('roughness',.99,.99),1);
});
