const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const adaptive = KIT.procedural.routes.adaptiveTransport;
const near = (a,b,eps=1e-8) => assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('pressure solve conserves flow and exposes signed arc-length routes', () => {
  const sim=adaptive({nodes:[{id:'source',at:[0,0,0],pressure:1},{id:'middle',at:[1,0,0]},{id:'sink',at:[2,0,0],pressure:0}],
    edges:[{id:'supply',from:'source',to:'middle',capacity:.2,resistance:0,points:[[0,0,0],[.4,.35,0],[1,0,0]]},
      {id:'return',from:'sink',to:'middle',capacity:.2,resistance:1}]});
  const frame=sim.frame(), supply=frame.edge('supply');
  near(frame.node('middle').pressure,2/3);
  near(supply.flow,1/15);
  near(frame.edge('return').flow,-1/15);
  near(frame.node('middle').net,0);
  near(frame.stats.supplied,frame.stats.delivered);
  assert.ok(supply.utilization<=1 && supply.route.length>1);
  assert.deepEqual(supply.route.sample(1).point,[1,0,0]);
  assert.ok(Object.isFrozen(supply.route.points[1]));
});

test('a cut transfers flow to a bypass which widens while the damaged link fades', () => {
  const sim=adaptive({
    nodes:[{id:'in',pressure:1},{id:'out',pressure:0},{id:'bypass'},{id:'spur'}],dt:.1,
    edges:[
      {id:'main',from:'in',to:'out',capacity:.39},
      {id:'b1',from:'in',to:'bypass',capacity:.11,resistance:2},
      {id:'b2',from:'bypass',to:'out',capacity:.11,resistance:2},
      {id:'idle',from:'out',to:'spur',capacity:.43}
    ]
  });
  const before=sim.step(8), cut=sim.edit({integrity:{main:0}});
  const after=sim.step(18);
  assert.equal(cut.tick,before.tick);
  assert.equal(cut.edge('main').flow,0);
  assert.equal(before.edge('idle').flow,0);
  assert.ok(before.edge('main').capacity>.39 && before.edge('idle').capacity<.43);
  assert.ok(after.edge('b1').capacity>cut.edge('b1').capacity);
  assert.ok(after.stats.delivered>cut.stats.delivered);
  assert.ok(after.edge('main').capacity<cut.edge('main').capacity);
  assert.ok(sim.edit({integrity:{main:.3}}).edge('main').flow>0);
});

test('edited boundary pressures reverse flow and floating components settle at zero flow', () => {
  const sim=adaptive({nodes:[{id:'a',pressure:1},{id:'b',pressure:0},{id:'c'},{id:'d'}],edges:[
    {id:'x',from:'a',to:'b',capacity:.4},{id:'y',from:'c',to:'d',capacity:.3}
  ]});
  const before=sim.frame(), flip=sim.edit({pressures:{a:0,b:1}});
  assert.equal(flip.edge('x').flow,-before.edge('x').flow);
  assert.equal(flip.node('c').pressure,null);
  assert.equal(flip.edge('y').flow,0);
  assert.throws(()=>sim.edit({pressures:{a:1},integrity:{bad:0}}),/integrity edit/);
  assert.equal(sim.frame().node('a').pressure,0);
  assert.equal(sim.edit({pressures:{b:null}}).edge('x').flow,0);
});

test('work failure and checkpoint replay preserve all graph controls', () => {
  const config={
    nodes:[{id:'a',pressure:1},{id:'junction'},{id:'b',pressure:0}],maxWork:70,
    edges:[{id:'x',from:'a',to:'junction'},{id:'y',from:'junction',to:'b'}]
  };
  const sim=adaptive(config), saved=sim.checkpoint();
  assert.throws(()=>sim.step(3),/work budget/);
  assert.equal(sim.frame().tick,0);
  near(sim.frame().edge('x').capacity,.18);
  const run=()=>{
    sim.edit({pressures:{a:.75},integrity:{y:.5}});
    const step=sim.step();
    return [step.nodes,step.edges,step.stats,step.tick];
  };
  const expected=run();
  sim.restore(saved);
  assert.deepEqual(run(),expected);
  assert.equal(sim.reset().node('a').pressure,1);
  assert.throws(()=>sim.restore(adaptive(config).checkpoint()),/different network/);
});

test('sparse solve balances a long chain with low and high conductance links', () => {
  const count=440, nodes=Array.from({length:count},(_,i)=>({id:'n'+i,...(i===0?{pressure:1}:i===count-1?{pressure:0}:{})}));
  const edges=nodes.slice(1).map((n,i)=>({id:'e'+i,from:nodes[i].id,to:n.id,capacity:.1+(i%13)*.063,resistance:i%5}));
  const frame=adaptive({nodes,edges}).frame();
  const reference=1/edges.reduce((sum,e)=>sum+(1+e.resistance)/e.capacity,0);
  near(frame.stats.delivered,reference,4e-8);
  assert.ok(frame.edges.every(e=>Math.abs(e.flow-reference)<4e-8));
  assert.ok(frame.stats.imbalance<1e-8);
});
