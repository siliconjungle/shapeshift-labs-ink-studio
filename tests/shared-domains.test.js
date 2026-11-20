const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const D = K.cellular.domain;
const plane = (p, u, v) => ({ sample: ([a,b]) => ({ p: p.map((n,i) => n + a * u[i] + b * v[i]) }) });
const sheet = (x = 0) => plane([x,0,0], [2,0,0], [0,1,0]);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);

function strips() {
  return [
    D.image({width:4,height:1}),
    D.charts({charts:[
      {id:'west',width:2,height:1,carrier:sheet()},
      {id:'east',width:2,height:1,carrier:sheet(50)}
    ],seams:[{a:['west','u1'],b:['east','u0']}]}),
    D.graph({nodes:['a','b','c','d'],edges:[['a','b'],['b','c'],['c','d']].map(([from,to])=>({from,to,bidirectional:true}))}),
    D.volume({width:4,height:1,depth:1})
  ];
}

test('one discrete rule and one named-channel rule give identical series on equivalent domains',()=>{
  const pulse=K.cellular.rules.briansBrain({birth:1}), diffuse=D.rules.diffusion({channel:'heat'});
  for(const domain of strips()){
    const run=D.create({domain,rule:pulse,initial:({cell})=>+(cell===domain.cells[0])});
    assert.deepEqual(Array.from(run.frame().data()),[1,0,0,0]);
    for(const expected of [[2,1,0,0],[0,2,1,0],[0,0,2,1]]){
      run.step();
      assert.deepEqual(Array.from(run.frame().data()),expected);
    }
    const thermal=D.create({domain,channels:['heat','mask'],dt:.25,timeUnit:'s',rule:diffuse,
      initial:({cell})=>({heat:+(cell===domain.cells[0]),mask:.7})});
    const first=thermal.frame();
    thermal.step();
    const frame=thermal.frame();
    assert.equal(frame.time,.25);
    assert.equal(frame.timeUnit,'s');
    assert.deepEqual(Array.from(frame.data('heat')),[.75,.125,0,0]);
    assert.deepEqual(Array.from(frame.data('mask')),[.7,.7,.7,.7]);
    assert.deepEqual(Array.from(first.data('heat')),[1,0,0,0]);
  }
});

test('Cartesian adapters expose metric centers and preserve each wrapped neighbor slot',()=>{
  const open=D.image({width:4,height:2,origin:[10,20],spacing:[2,3],units:'mm',
    boundary:['wrap','closed'],mask:({address:[x,y]})=>x!==1||y!==0});
  const {address,position,units}=open.cell([0,0]);
  assert.deepEqual(address,[0,0]);
  assert.deepEqual(position,[11,21.5,0]);
  assert.equal(units,'mm');
  assert.deepEqual(open.boundary,['wrap','closed']);
  assert.equal(open.cell([1,0]),null);
  assert.equal(open.cell([-1,0]),null);
  assert.deepEqual(open.cells.map(cell=>cell.id),['0,0','2,0','3,0','0,1','1,1','2,1','3,1']);
  let input, clockSeen;
  const sim=D.create({domain:open,dt:.1,timeUnit:'s',rule(ctx){
    if(ctx.cell===open.cells[0]) {
      input=ctx.inputs;
      clockSeen=[ctx.time,ctx.dt,ctx.timeUnit];
    }
    return ctx.state;
  }});
  sim.step();
  assert.deepEqual(clockSeen,[.1,.1,'s']);
  assert.deepEqual(input.map(row=>[row.id,row.edge.length,row.edge.data.periodic,row.edge.units]).sort(),[
    ['0,1',3,false,'mm'],['3,0',2,true,'mm']
  ]);
  const single=D.image({width:1,height:1,boundary:['wrap','closed']});
  const count=D.create({domain:single,states:5,initial:1,rule:({neighbors})=>neighbors.reduce((a,b)=>a+b,0)});
  count.step();
  assert.equal(count.get([0,0]),2);
  const two=D.image({width:2,height:1,boundary:['wrap','closed']});
  const doubled=D.create({domain:two,states:5,initial:({cell})=>+(cell.id==='0,0'),
    rule:({neighbors})=>neighbors.reduce((a,b)=>a+b,0)});
  doubled.step();
  assert.equal(doubled.get([1,0]),2);
});

test('a volume exposes physical voxel spacing and distinct face or full neighborhoods',()=>{
  for(const [neighborhood,count] of [['faces',6],['full',26]]){
    const d=D.volume({width:3,height:3,depth:3,spacing:[2,3,4],neighborhood});
    assert.deepEqual(d.cell([1,1,1]).position,[3,4.5,6]);
    const sim=D.create({domain:d,rule:K.cellular.rules.briansBrain({birth:1}),
      initial:({cell})=>+(cell.id==='1,1,1')});
    sim.step();
    assert.equal(sim.frame().data().filter(n=>n===1).length,count);
    assert.equal(sim.frame().data()[13],2);
    if(neighborhood==='full')assert.ok(d.edges.some(edge=>Math.abs(edge.length-Math.hypot(2,3,4))<1e-9));
  }
});

test('UV seams can turn a corner, reverse slots and measure length without crossing the world gap',()=>{
  const a={id:'panel',width:3,height:2,carrier:plane([0,0,0],[6,0,0],[0,2,0])};
  const b={id:'fold',width:2,height:3,carrier:plane([100,0,0],[0,4,0],[0,0,9])};
  const domain=D.charts({charts:[a,b],seams:[{a:['panel','u1'],b:['fold','v0'],reverse:true,weight:2}]});
  const seam=domain.edges.filter(edge=>edge.seam===domain.seams[0].id);
  assert.deepEqual(seam.map(e=>[e.from,e.to]),[['panel/2,0','fold/1,0'],['panel/2,1','fold/0,0']]);
  for(const edge of seam){near(edge.length,2.5);assert.equal(edge.weight,2);}
  assert.deepEqual(domain.cell(['fold',1,0]).uv,[.75,1/6]);
  const sim=D.create({domain,rule:K.cellular.graph.rules.pulse({threshold:2,refractory:2}),
    initial:({cell})=>+(cell.id==='panel/2,0')});
  sim.step();
  assert.equal(sim.get(['fold',1,0]),1);
  assert.equal(sim.get(['fold',0,0]),0);
  assert.equal(sim.get(['panel',1,0]),0);
  const periodic=D.charts({charts:[{id:'one',width:1,height:1,carrier:sheet()}],
    seams:[{a:['one','u0'],b:['one','u1'],length:.75}]});
  assert.equal(periodic.edges.length,2);
  assert.ok(periodic.edges.every(({length})=>length===.75));
});

test('replay preserves graph delays, channel records, locked inputs and seeded state',()=>{
  const raw={units:'m',nodes:[
    {id:'up',position:[0,0,0],data:{material:'oak',cell:'authored'},state:{heat:3,charge:4},locked:true},
    {id:'down',position:[0,0,3]},
    {id:'spare',position:[0,0,.01]}
  ],edges:[{from:'up',to:'down',delay:2,weight:1.5,data:{length:'authored'}}]};
  const domain=D.graph(raw), rebuilt=D.graph({...raw,nodes:raw.nodes.slice().reverse()});
  assert.equal(domain.edges[0].length,3);
  const rule=({state,inputs,random})=>{
    for(const {node,edge,cell} of inputs){
      assert.equal(cell.id,'up');
      assert.deepEqual(cell.position,[0,0,0]);
      assert.equal(node.data.cell,'authored');
      assert.equal(edge.length,3);
      assert.equal(edge.units,'m');
      assert.equal(edge.data.length,'authored');
    }
    return {heat:inputs[0]?.state.heat??state.heat,charge:random()};
  };
  const options={rule,channels:['heat','charge'],dt:.5,timeUnit:'s',seed:41};
  const run=D.create({domain,...options}), replay=D.create({domain:rebuilt,...options});
  assert.equal(run.frame().isLocked('up'),true);
  assert.equal(run.frame().historySize,2);
  assert.equal(run.domain.cell('up').data.material,'oak');
  run.step();
  assert.equal(run.get('down').heat,0);
  assert.equal(run.get('up',1).charge,4);
  run.step();
  assert.equal(run.get('down').heat,3);
  assert.equal(run.get('spare').heat,0);
  replay.restore(JSON.parse(JSON.stringify(run.checkpoint())));
  run.step(3);replay.step(3);
  assert.deepEqual(replay.frame().data(),run.frame().data());
  assert.ok(Object.isFrozen(run.get('down')));
});

test('edits, restore and failed multistep updates remain atomic',()=>{
  const domain=D.image({width:3,height:1,mask:({id})=>id!=='1,0'});
  const run=D.create({domain,channels:['heat'],initial:{heat:.1},rule:({state,tick})=>({heat:tick===2?NaN:state.heat+1})});
  const first=run.checkpoint();
  assert.throws(()=>run.step(2),/valid cell state/);
  assert.deepEqual(run.checkpoint(),first);
  assert.throws(()=>run.edit([{at:[0,0],state:{heat:1}},{at:[1,0],locked:true}]),/masked cell/);
  assert.deepEqual(run.checkpoint(),first);
  run.edit([{at:[0,0],state:{heat:2},locked:true}]);
  assert.equal(run.get([0,0]).heat,2);
  assert.equal(run.get([1,0]),null);
  const copy=run.frame().data('heat');copy[0]=100;
  assert.equal(run.get([0,0]).heat,2);
  const other=D.create({domain,channels:['heat'],dt:.5,rule:D.rules.diffusion({channel:'heat'})});
  assert.throws(()=>other.restore(run.checkpoint()),/incompatible/);
});

test('mismatched seams, ambiguous physical graph lengths and topology-specific rules are rejected',()=>{
  assert.throws(()=>D.charts({charts:[
    {id:'a',width:2,height:2,carrier:sheet()},{id:'b',width:2,height:3,carrier:sheet(2)}
  ],seams:[{a:['a','u1'],b:['b','u0']}]}),/matching sample counts/);
  assert.throws(()=>D.graph({units:'m',nodes:['a','b'],edges:[{from:'a',to:'b'}]}),/positive distance/);
  const domain=D.image({width:3,height:1});
  assert.throws(()=>D.create({domain,rule:K.cellular.rules.rule30()}),/neighborhood rule/);
  assert.throws(()=>D.create({domain,states:3,channels:['heat'],rule:D.rules.diffusion()}),/separate state models/);
});
