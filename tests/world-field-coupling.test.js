const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const close = (a,b) => assert(Math.abs(a-b)<1e-10,`${a} differs from ${b}`);
const fields = values => ({kind:'fields',config:{fields:values}});
const coupling = values => ({kind:'field-coupling',config:{fields:values}});
const box = (min,max) => ({min,max});
const cell = (bounds,value) => ({bounds,value});
const thermal = {units:'degC',axes:'xz',default:20};
const edit = (tick, bounds, value) => ({tick,action:'weather/set',args:{field:'heat',region:cell(bounds,value)}});

test('neighborhoods sample world points and moving sockets with typed stencils and explicit missing values',()=>{
  const world={entities:{probe:{position:[.5,2,.5],sockets:{tip:[.5,0,.5]}}},systems:{weather:fields({
    heat:{units:'degC',axes:'xz',bounds:box([0,0],[2,2]),grid:{counts:[2,2],values:[0,4,6,10]}},
    wind:{type:'vec2',components:'xy',units:'world/s',default:[4,8]}
  })}};
  const run=W.runtime.create(world);
  const socket={entity:'probe',socket:'tip'};
  const before=run.query();
  const stencil={radius:1,axes:'xz',operation:'gradient',explain:true};
  const gradient=before.neighborhood('weather/heat',socket,stencil);
  assert.deepEqual(gradient.value,[2,0,3]);
  assert.equal(gradient.units,'degC/world');
  assert.deepEqual(gradient.neighborhood.samples.map(row=>row.point),
    [[1,2,1],[0,2,1],[2,2,1],[1,2,0],[1,2,2]]);
  const edge=[0,2,0];
  assert.deepEqual(before.neighborhood('heat',edge,stencil).value,[2,0,3]);
  assert.equal(before.neighborhood('heat',edge,{...stencil,missing:'strict'}).status,'unavailable');
  assert.equal(before.neighborhood('heat',[-5,2,-5],stencil).status,'outside');
  assert.equal(before.neighborhood('heat',[0,2,0],{axes:'x',radius:1,operation:'max'}).value,2);
  assert.equal(before.neighborhood('heat',[0,2,0],{axes:'x',radius:1,operation:'min'}).value,0);
  assert.deepEqual(before.neighborhood('wind',socket,{radius:2}).value,[4,8]);
  assert.throws(()=>before.neighborhood('wind',socket,stencil),/needs a scalar field/);
  assert.equal(before.neighborhood('heat',{entity:'probe',socket:'missing'}).status,'missing');
  run.schedule([{tick:1,action:'world/patch',args:{edits:[
    {op:'set',path:['entities','probe','position'],value:[1.25,2,.5]}
  ]}}]);
  run.step();
  assert.equal(run.query().neighborhood('heat',socket).value,6.5);
  assert.equal(before.neighborhood('heat',socket).value,5);
});

test('live neighborhood temperature heats adjacent water and neighborhood wind moves an entity',()=>{
  const boxAt=box([1.2,-1],[2,1]);
  const fieldSpec={
    heat:{...thermal,default:5},
    wind:{type:'vec3',units:'world/s',axes:'xz',regions:[cell(boxAt,[6,0,0])]}
  };
  const ambient={source:'weather/heat',units:'degC',axes:'x',radius:1};
  const wind={source:'weather/wind',units:'world/s',type:'vec3',axes:'x',radius:1};
  const world={dt:.1,entities:{raft:{position:[.5,.3,0],sockets:{sail:[0,.4,0]}}},systems:{
    weather:fields(fieldSpec),
    near:coupling({ambient,wind}),
    pond:{kind:'water',config:{width:2,height:1,origin:[-1,-.5],initial:[cell(box([-1,-.5],[1,.5]),.4)],
      thermal:{ambientField:'near/ambient',ambientTemperature:5,heatCapacity:5,waterHeatCapacity:5,conductance:10,
        conductivity:0,evaporation:0,condensation:0,vaporDiffusivity:0}}},
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{raft:{half:[.2,.1,.2],position:[.5,.3,0]}},
      forces:{canvas:{kind:'sail',body:'raft',field:'near/wind',axis:[1,0,0],magnitude:.02}}}}
  },commands:[edit(1,boxAt,65)]};
  const direct={...world,systems:{...world.systems,
    pond:{...world.systems.pond,config:{...world.systems.pond.config,
      thermal:{...world.systems.pond.config.thermal,ambientField:'weather/heat'}}},
    rig:{...world.systems.rig,config:{...world.systems.rig.config,
      forces:{canvas:{...world.systems.rig.config.forces.canvas,field:'weather/wind'}}}}
  }};
  const run=W.runtime.create(world), baseline=W.runtime.create(direct);
  run.advance(3);
  baseline.advance(3);
  const q=run.query(), b=baseline.query(), right=[.5,0,0], left=[-.5,0,0], sail={entity:'raft',socket:'sail'};
  assert.equal(q.probe('weather/heat',right).value,5);
  assert.equal(q.probe('near/ambient',right).value,25);
  assert(q.probe('pond/temperature',right).value>b.probe('pond/temperature',right).value+4);
  close(q.probe('pond/temperature',left).value, b.probe('pond/temperature',left).value);
  assert.deepEqual(q.probe('near/wind',sail).value,[2,0,0]);
  assert(q.target({entity:'raft'}).point[0]>b.target({entity:'raft'}).point[0]);
  const restored=W.runtime.replay(JSON.parse(JSON.stringify(run.recording())));
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
});

test('depth and hydrostatic pressure retain units when published as neighborhood fields',()=>{
  const run=W.runtime.create({entities:{gauge:{position:[.5,.2,.5]}},systems:{
    tank:{kind:'enclosed-water',config:{chambers:{basin:{bounds:box([0,0,0],[2,2,2]),initial:4}}}},
    near:coupling({
      pressureGradient:{source:'tank/pressure',units:'Pa',operation:'gradient',radius:.1,axes:'y'},
      depth:{source:'tank/depth',units:'world',radius:.3,axes:'xz'}
    })
  }});
  const query=run.query(), gauge={entity:'gauge'};
  assert.equal(query.field('near/pressureGradient').units,'Pa/world');
  close(query.probe('near/pressureGradient',gauge).value[1],-9810);
  close(query.probe('near/depth',gauge).value,.8);
  assert.equal(query.field('near/depth').units,'world');
});

test('spatial invalidations propagate in one boundary, expand only stencil axes, clip and survive slow-reader checkpoints',()=>{
  const watcher=()=>({
    initial:()=>[], dependencies:{reads:['near/transect','near/local']},
    step:(_,ctx)=>ctx.spatial.changes().map(({field,bounds})=>({field,bounds}))
  });
  const world={systems:{
    weather:fields({heat:thermal}),
    near:coupling({
      edge:{source:'weather/heat',units:'degC',radius:1,axes:'x',bounds:box([0,-2,0],[5,2,5])},
      transect:{source:'near/edge',units:'degC',radius:.5,axes:'z'},
      local:{source:'weather/heat',units:'degC',radius:1,axes:'x',bounds:box([8,0,8],[9,1,9])}
    }),
    watcher:{kind:'watch',schedule:{every:2}}
  },commands:[edit(1,box([-.5,1],[.5,2]),60)]};
  const options={implementations:{watch:watcher}}, run=W.runtime.create(world,options);
  run.step();
  const rows=run.dependencies().changes;
  assert.deepEqual(rows.map(row=>[row.field,row.bounds,row.because]),[
    ['weather/heat',{axes:'xz',min:[-.5,1],max:[.5,2]},undefined],
    ['near/edge',{axes:'xyz',min:[0,-2,1],max:[1.5,2,2]},[1]],
    ['near/transect',{axes:'xyz',min:[0,-2,.5],max:[1.5,2,2.5]},[2]]
  ]);
  const saved=JSON.parse(JSON.stringify(run.checkpoint()));
  const restored=W.runtime.create(saved.world,{...options,checkpoint:saved});
  for (const instance of [run,restored]) {
    instance.step();
    assert.deepEqual(instance.view().states.watcher,[{field:'near/transect',bounds:rows[2].bounds}]);
    assert.equal(instance.dependencies().changes[0].deliveredTo,'watcher');
  }
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
});

test('coupling definitions reject incompatible references and cyclic or oversized sampling chains',()=>{
  const systems={
    weather:fields({heat:thermal,wind:{type:'vec2',components:'xy',units:'world/s'}})
  };
  const add=values=>W.runtime.validate({systems:{...systems,near:coupling(values)}});
  assert.throws(()=>add({bad:{source:'weather/missing'}}),/Incompatible spatial coupling source/);
  assert.throws(()=>add({bad:{source:'weather/heat',units:'K'}}),/Incompatible spatial coupling source/);
  assert.throws(()=>add({bad:{source:'weather/wind',type:'vec2',units:'world/s'}}),/Incompatible spatial coupling source/);
  assert.throws(()=>add({a:{source:'near/b'},b:{source:'near/a'}}),/Cyclic spatial coupling/);
  const chain=Object.fromEntries(Array.from({length:5},(_,i)=>['stage'+i,
    {source:i?'near/stage'+(i-1):'weather/heat',units:'degC',radius:1}]));
  assert.throws(()=>add(chain),/Spatial coupling sample budget/);
});

test('CLI probes a neighborhood using the same stencil and socket provenance',()=>{
  const response=JSON.parse(execFileSync(process.execPath,[resolve(__dirname,'../cli/ink-studio.js'),
    'probe',resolve(__dirname,'../examples/world-spatial-fields.json'),'--field','world/neighborhood',
    '--entity','station','--socket','vane',
    '--args','{"field":"weather/temperature","axes":"y","radius":0.5,"operation":"gradient"}','--explain'
  ],{encoding:'utf8'}));
  assert.deepEqual(response.value,[0,-2,0]);
  assert.equal(response.neighborhood.field,'weather/temperature');
});
