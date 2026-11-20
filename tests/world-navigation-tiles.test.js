const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const bounds={min:[0,-1,0],max:[14,2,8]};
const nav=config=>({kind:'navigation',config:{bounds,cell:.5,tiles:{size:4},...config}});
const command=(tick,action,args)=>({tick,action,args});
const trace=(query,from,to,args={})=>query.trace('nav/route',from,{to,...args}).value;
const water=(origin,depth=0)=>({kind:'water',config:{width:1,height:1,cell:1,origin,
  accounts:{well:origin.map(n=>n+.5)},initial:depth?[{bounds:{min:origin,max:origin.map(n=>n+1)},value:depth}]:[]}});
const runsAt=(query,agent)=>query.probe('crew/agent',{agent}).value;
const json=value=>JSON.parse(JSON.stringify(value));

test('walking routes connect cached tile boundaries across sparse large worlds',()=>{
  const world={systems:{nav:nav({bounds:{min:[0,-2,0],max:[500,3,500]},cell:.5})}};
  const query=W.runtime.create(world).query(), from=[1,0,1], to=[14,0,1];
  const cold=trace(query,from,to), warm=trace(query,from,to);
  assert.equal(cold.status,'ok');
  assert(cold.tiles.length>3);
  assert.equal(cold.crossings.length,cold.tiles.length-1);
  assert(cold.work.built.length>3&&cold.work.built.length<30);
  assert.deepEqual(warm.points,cold.points);
  assert.deepEqual(warm.crossings,cold.crossings);
  assert.deepEqual(warm.work.built,[]);
  assert(warm.work.reused.length>=cold.tiles.length);
});

test('flooding reroutes a ford crossing and preserves a distant active route beyond its retry tick',()=>{
  const from=[1,0,1.5], to=[12,0,1.5], remote=[1,0,6.5], far=[12,0,6.5];
  const world={dt:.05,systems:{nav:nav({water:'ford/water'}),ford:water([6,1]),tank:water([20,1],1),
    crew:{kind:'agents',config:{navigation:'nav',replanTicks:1,
      species:{worker:{mode:'walk',speed:.5}},agents:{local:{species:'worker',position:from,goal:to},
        remote:{species:'worker',position:remote,goal:far}}}}
  }};
  const run=W.runtime.create(world);
  run.step();
  const oldQuery=run.query();
  const routeArgs={radius:.15,maxWade:.14}, old=trace(oldQuery,from,to,routeArgs);
  const oldRemote=runsAt(oldQuery,'remote'), oldLocal=runsAt(oldQuery,'local');
  assert.equal(old.status,'ok');
  assert(old.points.every(p=>p[2]===1.5));
  const flood=command(2,'world/transfer',{from:'tank/well',to:'ford/well',amount:.6});
  run.schedule([flood]);
  run.step();
  const now=run.query(), revised=runsAt(now,'local'), remoteStill=runsAt(now,'remote');
  assert.equal(now.probe('ford/water',[6.5,0,1.5]).value.depth,.6);
  assert.notDeepEqual(revised.route,oldLocal.route);
  assert.strictEqual(remoteStill.route,oldRemote.route);
  assert.equal(remoteStill.retry,oldRemote.retry);
  assert.deepEqual(run.dependencies().work.filter(row=>row.kind==='agent-route').map(row=>row.detail.entity),['local']);
  const detour=trace(now,from,to,routeArgs);
  assert.equal(detour.status,'ok');
  assert(detour.points.some(p=>p[2]!==1.5));
  assert(detour.work.invalidated.length>0);
  assert(detour.work.invalidated.every(key=>Number(key.split(',')[1])<=1));
  assert.deepEqual(trace(oldQuery,from,to,routeArgs).points,old.points);
  run.schedule([command(3,'world/transfer',{from:'ford/well',to:'tank/well',amount:.6})]);
  run.step();
  assert.deepEqual(trace(run.query(),from,to,routeArgs).points,old.points);
  assert(runsAt(run.query(),'local').route.slice(1).every(p=>p[2]===1.5));
  assert.strictEqual(runsAt(run.query(),'remote').route,oldRemote.route);
  const saved=json(run.checkpoint());
  const resumed=W.runtime.create(saved.world,{checkpoint:saved});
  resumed.advance(8);
  run.advance(8);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('a moving door restores a shortcut and blocks it again without changing the destination',()=>{
  const from=[1,0,2], to=[12,0,2], closed=[6,.6,2], open=[6,.6,4];
  const run=W.runtime.create({dt:.05,entities:{door:{position:closed}},systems:{
    nav:nav({clearance:'rig/clearance'}),
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{door:{entity:'door',fixed:true,follow:true,half:[.3,.75,.25]}}}},
    crew:{kind:'agents',config:{navigation:'nav',replanTicks:250,
      species:{worker:{mode:'walk',speed:.5}},agents:{local:{species:'worker',position:from,goal:to}}}}
  }});
  const move=(tick,value)=>command(tick,'world/patch',{edits:[{op:'set',path:'/entities/door/position',value}]});
  run.schedule([move(2,open),move(4,closed)]);
  run.step();
  const detour=runsAt(run.query(),'local').route;
  assert(detour.some(p=>p[2]!==from[2]));
  run.step();
  const saved=json(run.checkpoint()), restored=W.runtime.create(saved.world,{checkpoint:saved});
  for(const current of [run,restored]){
    current.step();
    const direct=runsAt(current.query(),'local');
    assert(direct.route.slice(1).every(p=>p[2]===from[2]));
    current.advance(5);
    const rerouted=runsAt(current.query(),'local');
    assert(rerouted.route.some(p=>p[2]!==from[2]));
    assert.deepEqual(rerouted.goal,to);
  }
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
});

test('a moving platform reopens an unreachable route ahead of the retry, including slower agents',()=>{
  const from=[1,.2,1.5],to=[12,.2,1.5], narrow={min:[0,-1,1.3],max:[14,2,1.7]};
  const run=W.runtime.create({dt:.05,entities:{platform:{position:[6.5,.1,4]}},systems:{
    nav:nav({bounds:narrow,water:'ford/water',support:'rig/support',clearance:'rig/clearance'}),
    ford:water([6,1],.24),
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{
      west:{fixed:true,position:[2.5,.1,1.5],half:[3.5,.1,.5]},
      east:{fixed:true,position:[11,.1,1.5],half:[4,.1,.5]},
      platform:{entity:'platform',fixed:true,follow:true,half:[.5,.1,.5]}
    }}},
    crew:{kind:'agents',schedule:{every:2},config:{navigation:'nav',replanTicks:250,
      species:{worker:{mode:'walk',speed:.5}},agents:{local:{species:'worker',position:from,goal:to}}}}
  }});
  run.schedule([command(3,'world/patch',{edits:[{op:'set',path:'/entities/platform/position',value:[6.5,.1,1.5]}]})]);
  run.advance(2);
  const blocked=runsAt(run.query(),'local');
  assert.equal(blocked.mode,'blocked');
  assert.equal(blocked.retry,8);
  run.advance(4);
  const walking=runsAt(run.query(),'local');
  assert.equal(walking.mode,'walk');
  assert(walking.route.some(p=>p[0]>6&&p[0]<7&&p[1]>.19));
  assert(walking.position[0]>from[0]);
});

test('reshaping and fracturing a wall changes seam connectivity in its own tiles',()=>{
  const from=[1,0,2],to=[13,0,2], side=[1,0,6.5], far=[5,0,6.5];
  const run=W.runtime.create({dt:.05,systems:{nav:nav({clearance:'rig/clearance'}),
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{
      wall:{fixed:true,position:[6,0,2],half:[.3,.75,.15]}
    }}}
  }});
  const initial=run.query(), detour=trace(initial,from,to);
  assert.equal(detour.status,'ok');
  assert(detour.points.some(p=>p[2]!==2));
  const other=trace(initial,side,far);
  run.schedule([
    command(1,'rig/reshape',{body:'wall',half:[.3,.75,2]}),
    command(2,'rig/fracture',{body:'wall',axis:2,parts:2,omit:[0,1]})
  ]);
  run.step();
  const expanded=trace(run.query(),from,to);
  assert.equal(expanded.status,'ok');
  assert(expanded.cost>detour.cost);
  assert(expanded.work.invalidated.length>0);
  assert.deepEqual(trace(run.query(),side,far).points,other.points);
  run.step();
  const open=trace(run.query(),from,to);
  assert(open.cost<detour.cost);
  assert(open.points.every(p=>p[2]===2));
});

test('construction refits and live solid cuts reopen local passages',()=>{
  const from=[1,0,1],to=[13,0,1], narrow={min:[0,-1,0],max:[14,2,2]};
  const run=W.runtime.create({dt:.1,systems:{nav:nav({bounds:narrow,clearance:'work/clearance'}),
    work:{kind:'construction',config:{points:{barrier:{position:[6,0,1]}},
      constraints:[{id:'site',type:'pin',point:'barrier',position:[6,0,1]}],
      blocks:[{id:'wall',at:'barrier',half:[.3,.8,1.1]}]}}
  }});
  assert.equal(trace(run.query(),from,to).status,'unreachable');
  run.schedule([command(1,'work/refit',{pins:{site:[6,0,5]}})]);
  run.step();
  assert.equal(trace(run.query(),from,to).status,'ok');

  const cut=W.runtime.create({systems:{nav:nav({bounds:narrow,clearance:'rock/clearance'}),
    rock:{kind:'volume',config:{
      bounds:{min:[4,-1,0],max:[8,2,2]},cell:.5,materials:{stone:[1,2,3,4]},
      initial:[{op:'fill',material:'stone',shape:{kind:'box',at:[6,0,1],half:[.5,1,1.1]}}]
    }},
    crew:{kind:'agents',config:{navigation:'nav',
      species:{worker:{mode:'walk',speed:.5}},agents:{local:{species:'worker',position:from,goal:to}}}}
  }});
  assert.equal(trace(cut.query(),from,to).status,'unreachable');
  cut.step();
  assert.equal(runsAt(cut.query(),'local').mode,'blocked');
  cut.schedule([command(2,'rock/cut',{shape:{kind:'box',at:[6,0,1],half:[.8,.75,.6]}})]);
  cut.step();
  const entrance=trace(cut.query(),from,to);
  assert.equal(entrance.status,'ok');
  assert(entrance.crossings.length>0);
  assert.equal(runsAt(cut.query(),'local').mode,'walk');
});
