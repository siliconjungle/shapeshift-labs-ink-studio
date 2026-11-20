const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const ford=require('../examples/world-tiled-ford.json');

const clone=value=>JSON.parse(JSON.stringify(value));
const goal=[16.2,0,3.6];
const profile={radius:.15,maxWade:.14};
const nav=flowFields=>({kind:'navigation',config:{
  bounds:{min:[0,-1,0],max:[24,2,10]},cell:.5,tiles:{size:6,flowFields}
}});
const trace=(query,from,to=goal,args={})=>
  query.trace('nav/route',from,{to,...profile,...args}).value;
const sample=(query,from,to=goal,args={})=>
  query.probe('nav/flow',from,{to,...profile,...args}).value;
const stats=query=>query.probe('nav/tiles').value.flowFields;
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('one destination field supplies exact tiled costs and descent from multiple origins',()=>{
  const run=W.runtime.create({systems:{nav:nav({})}});
  const query=run.query(), near=[14.8,0,3.6], far=[2.2,0,1.6];
  const first=sample(query,near);
  assert.equal(first.status,'ok');
  assert.equal(first.flow.cached,false);
  assert(first.flow.expanded>0);
  close(Math.hypot(...first.direction),1);

  const second=trace(query,far);
  const baseline=trace(query,far,goal,{strategy:'astar'});
  assert.equal(second.status,'ok');
  assert.equal(second.flow.cached,true);
  assert(second.flow.expanded>0);
  assert(second.crossings.length>0);
  assert.deepEqual(second.points[0],far);
  assert.deepEqual(second.points.at(-1),goal);
  close(second.cost,baseline.cost);
  const repeat=sample(query,far);
  assert.equal(repeat.flow.expanded,0);
  assert.deepEqual(repeat.next,second.points[1]);
  close(repeat.cost,second.cost);
  const destination=sample(query,goal);
  assert.equal(destination.cost,0);
  assert.equal(destination.next,null);
  assert.deepEqual(destination.direction,[0,0,0]);
  assert.equal(stats(query).builds,1);

  assert.equal(sample(query,near,[18,0,2]).flow.cached,false);
  assert.equal(sample(query,near,goal,{radius:.25}).flow.cached,false);
  assert.equal(stats(query).builds,3);
});

test('flood changes the local field and keeps a disjoint destination field across revisions',()=>{
  const world=clone(ford);
  delete world.systems.crew;
  world.systems.nav.config.tiles.flowFields={};
  const run=W.runtime.create(world), before=run.query();
  const from=[1,0,1.5], to=[12,0,1.5], remote=[13,0,7.5], other=[12,0,7.5];
  const dry=trace(before,from,to), far=sample(before,remote,other);
  assert(dry.points.every(point=>point[2]===1.5));
  assert.equal(far.status,'ok');
  run.advance(2);
  const wet=run.query(), detour=trace(wet,from,to), farAfter=sample(wet,remote,other);
  assert.equal(detour.status,'ok');
  assert(detour.points.some(point=>point[2]!==1.5));
  assert(detour.flow.revision>dry.flow.revision);
  assert.equal(detour.flow.cached,false);
  assert.equal(farAfter.flow.cached,true);
  assert.equal(farAfter.flow.expanded,0);
  assert.equal(farAfter.flow.revision,detour.flow.revision);
  assert.equal(stats(wet).invalidated,1);
  close(detour.cost,trace(wet,from,to,{strategy:'astar'}).cost);
  assert.deepEqual(trace(before,from,to).points,dry.points);
  assert.deepEqual(trace(wet,from,to).points,detour.points);
});

test('walking agents use one shared field and replay independently of query warmup',()=>{
  const positions=[[3,0,2],[3,0,3],[3,0,4],[3,0,5],[4,0,3]];
  const world={dt:.05,systems:{nav:nav({}),crew:{kind:'agents',config:{
    navigation:'nav',species:{runner:{mode:'walk',radius:.15,speed:1}},
    agents:Object.fromEntries(positions.map((position,i)=>['unit'+i,{position,goal,species:'runner'}]))
  }}}};
  const run=W.runtime.create(world);
  run.step();
  assert.deepEqual(stats(run.query()),{revision:0,cached:1,builds:1,hits:4,invalidated:0});
  for(const row of Object.values(run.view().states.crew.agents))
    assert.deepEqual(row.route.at(-1),goal);
  const saved=clone(run.checkpoint()), resumed=W.runtime.create(saved.world,{checkpoint:saved});
  sample(run.query(),[1,0,9]);
  sample(resumed.query(),[23,0,9],[21,0,8]);
  resumed.advance(18);
  run.advance(18);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
  assert.deepEqual(run.checkpoint(),W.runtime.replay(clone(run.recording())).checkpoint());
});

test('bounded flow expansion falls back to A* and results do not depend on query order',()=>{
  const world={systems:{nav:nav({maxCells:2,maxFields:1})}};
  const a=W.runtime.create(world).query(), b=W.runtime.create(clone(world)).query(), far=[2,0,3];
  assert.equal(sample(a,goal).status,'ok');
  const strict=trace(a,far,goal,{strategy:'flow'});
  assert.equal(strict.status,'budget');
  assert.equal(strict.reason,'cells');
  const first=trace(a,far), second=trace(b,far);
  assert.equal(first.status,'ok');
  assert.equal(first.flow.fallback,'astar');
  assert.deepEqual(first.points,second.points);
  assert.equal(first.cost,second.cost);
  sample(a,[3,0,2],[3,0,2]);
  assert.equal(stats(a).cached,1);
  assert.equal(sample(a,goal).flow.cached,false);
  assert.throws(()=>W.runtime.create({systems:{nav:nav({maxCells:0})}}),/Invalid navigation flow cache budget/);
});
