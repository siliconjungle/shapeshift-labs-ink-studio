const test=require('node:test');
const assert=require('node:assert/strict');
const studio=require('..'), {KIT:{world:W}}=studio.load();
const json=value=>JSON.parse(JSON.stringify(value));
const area=(x0,z0,x1,z1)=>({min:[x0,z0],max:[x1,z1]});
const row=(kind,bounds,options={})=>({kind,bounds,...options});
const wall=x=>row('wall',area(x,0,x,1),{axis:'x'});
const tolerance=(actual,expected,epsilon=1e-8)=>
  assert.ok(Math.abs(actual-expected)<epsilon,`${actual} differs from ${expected}`);
const world=(config={},systems={})=>({dt:.1,systems:{
  basin:{kind:'water',config:{width:3,height:1,...config}},...systems
}});
const edit=(tick,id,rule)=>({tick,action:'basin/boundary',args:{id,rule}});
const basin=(run,field,args)=>run.query().probe('basin/'+field,{},args).value;
const depth=(run,x,z=.5)=>run.query().probe('basin/depth',[x,0,z]).value;
const warmWater={
  ambientTemperature:15,heatCapacity:10,waterHeatCapacity:4,latentFusion:20,latentVaporization:100,
  conductance:0,conductivity:0,evaporation:0,condensation:0,vaporDiffusivity:0
};

test('live source, sink and wall edits conserve water and survive a checkpoint with pending commands',()=>{
  const run=W.runtime.create(world({
    initial:[{bounds:area(2,0,3,1),value:.1}],
    boundaries:{
      inlet:row('source',area(0,0,1,1),{rate:.4}),
      sink:row('sink',area(2,0,3,1),{rate:4}),
      north:wall(1), south:wall(2)
    }
  }));
  run.step();
  tolerance(depth(run,.5),.04);
  tolerance(depth(run,1.5),0);
  tolerance(depth(run,2.5),0);
  tolerance(basin(run,'boundaries',{id:'inlet'}).added,.04);
  tolerance(basin(run,'boundaries',{id:'sink'}).drained,.1);
  tolerance(basin(run,'mass').error,0);

  run.schedule([
    edit(2,'inlet',row('source',area(1,0,2,1),{rate:.5})),
    edit(2,'sink',row('sink',area(2,0,3,1),{rate:4,enabled:false})),
    edit(3,'south',null)
  ]);
  const saved=json(run.checkpoint());
  const restored=W.runtime.create(saved.world,{checkpoint:saved});
  restored.advance(4);
  run.advance(4);
  assert.deepEqual(json(restored.checkpoint()),json(run.checkpoint()));
  assert.deepEqual(json(W.runtime.replay(json(run.recording())).checkpoint()),json(run.checkpoint()));
  assert.ok(depth(restored,2.5)>0);
  const rules=basin(restored,'boundaries');
  assert.deepEqual(Object.keys(rules),['inlet','north','sink']);
  assert.deepEqual(rules.inlet.bounds,area(1,0,2,1));
  assert.equal(rules.sink.enabled,false);
  assert.equal(rules.sink.drained,0);
  assert.deepEqual(restored.history.filter(event=>event.kind.startsWith('boundary-')).map(event=>event.kind),
    ['boundary-set','boundary-set','boundary-removed']);
  tolerance(basin(restored,'mass').error,0);
});

test('open outer faces discharge water, sediment and liquid heat, and closing them preserves the remainder',()=>{
  const sides={
    west:row('open',area(-2,0,-2,1),{side:'x-min'}),
    east:row('open',area(0,0,0,1),{side:'x-max'}),
    north:row('open',area(-2,0,0,0),{side:'z-min'}),
    south:row('open',area(-2,1,0,1),{side:'z-max'})
  };
  const tile=area(-2,0,0,1);
  const run=W.runtime.create(world({width:1,height:1,origin:[-2,0],cell:[2,1],
    initial:[{bounds:tile,value:1}],boundaries:sides,thermal:warmWater,
    sediment:{erodibleDepth:0,capacity:.25,settling:0,initial:[{bounds:tile,value:.1}]}
  }));
  run.step();
  const flows=Object.values(basin(run,'boundaries')), mass=basin(run,'mass');
  assert.ok(flows.every(flow=>flow.added===0&&flow.drained>0&&flow.targets===1));
  tolerance(flows.reduce((sum,flow)=>sum+flow.drained,0),mass.drained);
  tolerance(flows[0].drained,flows[3].drained);
  assert.ok(mass.volume<2&&mass.volume>0);
  tolerance(mass.error,0);
  tolerance(basin(run,'heat').error,0);
  tolerance(basin(run,'sediment').error,0);
  assert.ok(basin(run,'heat').exportedEnergy>0&&basin(run,'sediment').exported>0);

  run.schedule(Object.keys(sides).map(id=>edit(2,id,null)));
  run.advance(4);
  tolerance(basin(run,'mass').volume,mass.volume);
  tolerance(basin(run,'mass').drained,mass.drained);
  const saved=json(run.checkpoint());
  assert.deepEqual(json(W.runtime.create(saved.world,{checkpoint:saved}).checkpoint()),saved);
});

test('field exchange samples spatial heads, handles missing samples and follows a live field edit',()=>{
  const left=area(0,0,1,1), middle=area(1,0,2,1), right=area(2,0,3,1);
  const rule=(bounds,direction='both')=>row('exchange',bounds,{field:'reservoir',rate:2,direction});
  const run=W.runtime.create(world({
    boundaryFields:{reservoir:'outside/head'},
    boundaries:{left:rule(left),middle:rule(middle,'out'),uncovered:rule(right),a:wall(1),b:wall(2)},
    initial:[{bounds:middle,value:.8},{bounds:right,value:.3}]
  },{outside:{kind:'fields',config:{fields:{head:{type:'number',units:'world',axes:'xz',
    bounds:area(0,0,2,1),default:.4,regions:[{bounds:left,value:.7}]
  }}}}}));
  run.step();
  const leftBefore=depth(run,.5), middleBefore=depth(run,1.5);
  assert.ok(leftBefore>0&&middleBefore<.8);
  tolerance(depth(run,2.5),.3);
  tolerance(basin(run,'boundaries',{id:'left'}).added,leftBefore);
  tolerance(basin(run,'boundaries',{id:'middle'}).drained,.8-middleBefore);
  assert.equal(basin(run,'boundaries',{id:'uncovered'}).drained,0);

  run.schedule([{tick:2,action:'outside/set',args:{field:'head',region:{bounds:area(0,0,2,1),value:0}}}]);
  run.step();
  assert.ok(depth(run,.5)<leftBefore);
  assert.ok(basin(run,'boundaries',{id:'left'}).drained>0);
  run.schedule([{tick:3,action:'outside/set',args:{field:'head',region:{bounds:area(0,0,2,1),value:2}}}]);
  const middleAfter=depth(run,1.5);
  run.step();
  tolerance(depth(run,1.5),middleAfter);
  assert.equal(basin(run,'boundaries',{id:'middle'}).added,0);
  tolerance(basin(run,'mass').error,0);
  assert.deepEqual(json(W.runtime.replay(json(run.recording())).checkpoint()),json(run.checkpoint()));
});

test('a wall blocks liquid flux and lateral heat and vapor diffusion until removed',()=>{
  const left=area(0,0,1,1);
  const run=W.runtime.create(world({
    width:2,initial:[{bounds:left,value:.4}],boundaries:{divider:wall(1)},
    thermal:{...warmWater,conductivity:10,vaporDiffusivity:1,
      initialTemperature:[{bounds:left,value:30}],initialVapor:[{bounds:left,value:.2}]}
  }));
  run.step();
  const far=()=>run.query().probe('basin/phase-state',[1.5,0,.5]).value;
  tolerance(depth(run,1.5),0);
  tolerance(far().temperature,15);
  tolerance(far().vapor,0);
  run.schedule([edit(2,'divider',null)]);
  run.step();
  assert.ok(depth(run,1.5)>0&&far().temperature>15&&far().vapor>0);
  tolerance(basin(run,'mass').error,0);
  tolerance(basin(run,'heat').error,0);
});

test('invalid boundary placement or incompatible field units are rejected',()=>{
  const run=W.runtime.create(world({boundaries:{}}));
  assert.throws(()=>run.schedule([edit(1,'bad',row('open',area(1,0,1,1),{side:'x-max'}))]),/cover any faces/);
  assert.throws(()=>run.schedule([edit(1,'bad',row('exchange',area(0,0,1,1),{field:'unknown',rate:1}))]),
    /declared head field/);
  assert.throws(()=>W.runtime.create(world({boundaryFields:{reservoir:'weather/temperature'}},{
    weather:{kind:'fields',config:{fields:{temperature:{type:'number',units:'degC',default:20}}}}
  })),/numeric world-space field in world units/);
});

test('local boundary edits publish identical checkpoints and spatial writes in a worker',t=>{
  const pool=studio.createSimulationWorkers(1);
  t.after(()=>pool.close());
  const source=world({boundaries:{},initial:[{bounds:area(0,0,1,1),value:.3}]});
  const worker=W.runtime.create(source,{workerPool:pool}), host=W.runtime.create(source);
  const schedule=[
    edit(1,'outlet',row('open',area(0,0,0,1),{side:'x-min',opening:.5})),
    edit(2,'divider',wall(1)),
    edit(3,'recharge',row('source',area(1,0,2,1),{rate:.2}))
  ];
  for(const run of [worker,host]){
    run.schedule(schedule);
    run.advance(4);
  }
  assert.deepEqual(worker.partitions().systems,{basin:4});
  assert.deepEqual(json(worker.checkpoint()),json(host.checkpoint()));
  assert.deepEqual(worker.dependencies(),host.dependencies());
  assert.ok(host.dependencies().pending.some(row=>row.field==='basin/depth'));
});
