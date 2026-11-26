const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');

const input = input => ({input});
const ref = (node,port='value') => ({node,port});
const op = (op,inputs,type) => ({op,inputs,...(type && {type})});
const call = (operator,group,inputs) => ({op:operator,group,inputs});
const fn = (result,inputs,nodes,value) => ({result,inputs,nodes,outputs:{result:value}});
const project = fields => ({format:'ink-studio/graph-project',version:1,...fields});
const scope = (variables,values) => op('fn.scope',{variables,...values});
const get = (scope,name,type='number') => op('fn.get',{scope,name},type);
const set = (scope,name,value,type='number') => op('fn.set',{scope,name,value},type);
const system = (name,key,type) => op('fn.system',{name,...(key && {key})},type);
const math = (operation,a,b,type='number') => op('fn.math',{operation,a,b},type);
const state = input('state');

test('local writes update the nearest frame and preserve prior scopes and shadowed bindings',()=>{
  const runner = Ink.createGraphProject(project({nodes:{
    next: set(ref('child'),'charge',12),
    up: set(ref('next'),'mode','night','string'),
    child: scope({charge:'number'},{parent:ref('outer'),charge:9}),
    outer: scope({charge:'number',mode:'string'},{charge:2,mode:'day'}),
    initial: get(ref('child'),'charge'), parent: get(ref('outer'),'charge'),
    current: get(ref('up'),'charge'),
    mode: get(ref('up'),'mode','string'), oldMode: get(ref('next'),'mode','string')
  },outputs:{
    initial:ref('initial'),parent:ref('parent'),current:ref('current'),mode:ref('mode'),oldMode:ref('oldMode')
  }}));
  assert.deepEqual(runner.run().outputs,{initial:9,parent:2,current:12,mode:'night',oldMode:'day'});
  assert(Object.isFrozen(runner.inspect({node:'up'}).value.parent.bindings.mode));
  assert.equal(Ink.load().KIT.procedural.graphTypes.validator('functionLocals')({
    format:'ink-studio/function-locals',version:1,bindings:{a:{type:'integer',value:1.5}},parent:null
  }),false);
  for(const [name,type,message] of [['missing','number',/Unknown function variable missing/],['charge','integer',/expected integer/]]) {
    const invalid = Ink.createGraphProject(project({nodes:{local:scope({charge:'number'},{charge:2}),
      read:get(ref('local'),name,type)},outputs:{result:ref('read')}}));
    assert.throws(()=>invalid.run(),message);
  }
});

test('branch routes only the chosen function and discovers both dependencies',()=>{
  const args = {level:{type:'number',default:5}};
  const safe = fn('number', args, {gain:math('multiply',input('level'),2)},ref('gain'));
  const failing = fn('number', {level:{default:5,type:'number'}}, {fault:math('divide',input('level'),0)},ref('fault'));
  const spec = project({inputs:{choose:{type:'boolean',default:true}},groups:{safe,failing},
    nodes:{pick:op('fn.branch',{whenTrue:'safe',whenFalse:'failing',condition:input('choose')})},
    outputs:{value:ref('pick'),taken:ref('pick','taken')}});
  const runner = Ink.createGraphProject(JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'routes'}))));
  assert.deepEqual(runner.run().outputs,{value:10,taken:true});
  assert.equal(runner.inspect({node:'pick/gain'}).value,10);
  assert.deepEqual(runner.snapshot().graph.nodes.pick.groupPaths,['safe','failing']);
  const revised=Ink.createGraphProject({...spec,groups:{safe,failing:{...failing,nodes:{fault:math('divide',input('level'),4)}}}});
  const diff=Ink.diffGraphs(runner,revised);
  assert(diff.affectedOutputs.some(({name,causes})=>name==='value'&&causes.includes('/groups/failing/nodes/fault/inputs/b')));
  assert.throws(()=>runner.run({inputs:{choose:false}}),/division by zero/);
  assert.deepEqual(runner.run().outputs,{value:10,taken:true});
  assert.throws(()=>Ink.createGraphProject({...spec,groups:{safe,failing:{...failing,inputs:{level:'number'}}}}),
    /same input and result contracts/);
  const recursive = fn('number',args,{recurse:op('fn.branch',{whenTrue:'safe',whenFalse:'failing',condition:true})},ref('recurse'));
  assert.throws(()=>Ink.createGraphProject({...spec,groups:{safe:recursive,failing}}),/Graph group cycle/);
});

test('sequences pass state in order and bounded loops can stop before the requested count',()=>{
  const stage = (kind,b) => fn('number',{state:'number'},{next:math(kind,state,b)},ref('next'));
  const args = {state:'functionLocals',index:'integer',target:'number'};
  const pedal = fn('functionLocals',args,{
    old:get(state,'charge'), next:math('add',ref('old'),2),
    setIndex:set(state,'step',input('index'),'integer'), setCharge:set(ref('setIndex'),'charge',ref('next'))
  },ref('setCharge'));
  const ready = fn('boolean',args,{
    charge:get(state,'charge'), compare:op('fn.compare',{operation:'lt',a:ref('charge'),b:input('target')},'number')
  },ref('compare'));
  const spec = project({inputs:{turns:{type:'integer',default:7},target:{type:'number',default:14}},
    groups:{prepare:stage('add',3),twice:stage('multiply',2),pedal,ready},
    nodes:{
      staged:op('fn.sequence',{steps:['prepare','twice'],initial:2}),
      local:scope({charge:'number',step:'integer'},{charge:ref('staged'),step:-1}),
      pump:call('fn.loop','pedal',{initial:ref('local'),count:input('turns'),while:'ready',target:input('target'),limit:8}),
      charge:get(ref('pump'),'charge'), index:get(ref('pump'),'step','integer')
    },outputs:{staged:ref('staged'),charge:ref('charge'),index:ref('index'),iterations:ref('pump','iterations')}});
  const runner = Ink.createGraphProject(spec);
  assert.deepEqual(runner.run().outputs,{staged:10,charge:14,index:1,iterations:2});
  assert.equal(runner.inspect({node:'pump/old'}).value,12);
  assert.deepEqual(runner.snapshot().graph.nodes.pump.groupPaths,['pedal','ready']);
  const trace=require('../cli/graph-audio-trace.js').audioTrace(runner.snapshot(),{output:'charge'});
  assert(trace.chain.some(node=>node.node==='pump/pedal/next'));
  assert(trace.chain.some(node=>node.node==='pump/ready/compare'));
  assert.equal(trace.inputs.target,14);
  for(const inputs of [{turns:0},{target:9}])
    assert.deepEqual(runner.run({inputs}).outputs,{staged:10,charge:10,index:-1,iterations:0});
  for(const turns of [-1,9]) assert.throws(()=>runner.run({inputs:{turns}}),/authored bound/);
  assert.throws(()=>Ink.createGraphProject({...spec,nodes:{...spec.nodes,pump:{
    ...spec.nodes.pump,inputs:{...spec.nodes.pump.inputs,limit:1025}
  }}}),/literal integer/);
});

test('nested bounded loops share an evaluation work budget',()=>{
  const idle = fn('integer',{state:'integer'},{},state);
  const nested = fn('integer',{state:'integer',index:'integer'},{
    loop:call('fn.loop','idle',{initial:input('index'),count:1024,limit:1024})
  },ref('loop'));
  const runner = Ink.createGraphProject(project({groups:{nested,idle},
    nodes:{loop:call('fn.loop','nested',{initial:0,count:1024,limit:1024})},outputs:{result:ref('loop')}}));
  assert.throws(()=>runner.run(),/evaluation work budget/);
});

test('system values propagate through reused groups and remain scoped on return',async ()=>{
  const probe = fn('vec4',{},{
    position:system('position'),size:system('size'),time:system('time'),seed:system('seed'),
    x:op('fn.vector',{operation:'component',a:ref('position'),index:0},'vec2'),
    w:op('fn.vector',{operation:'component',a:ref('size'),index:0},'vec2'),
    seedNumber:op('fn.cast',{from:'integer',a:ref('seed')},'number'),
    compose:op('fn.vector',{x:ref('x'),y:ref('w'),z:ref('time'),w:ref('seedNumber')},'vec4')
  },ref('compose'));
  const inner = fn('string',{}, {mode:system('context','mode','string')},ref('mode'));
  const innerCall = fn('string',{}, {read:op('contextValue',{})},ref('read','result'));
  const spec = project({base:{size:{width:48,height:24,lock:false}},
    inputs:{mode:{type:'string',default:'harbor'}},
    groups:{probe,contextValue:inner,innerCall},nodes:{
      env:op('data.record',{mode:input('mode')}),
      scoped:call('fn.withSystem','probe',{position:[.4,.75],size:[80,32]}),
      mode:call('fn.withSystem','innerCall',{position:[2,4],size:[80,32],context:ref('env')}),
      plain:op('probe',{}),
      retimed:call('anim.retime','probe',{timing:{rate:2,range:[0,10]}})
    },outputs:{scoped:ref('scoped'),plain:ref('plain','result'),retimed:ref('retimed','result'),mode:ref('mode')}});
  const runner = Ink.createGraphProject(spec);
  assert.deepEqual(runner.run({time:1,seed:32}).outputs,{scoped:[.4,80,1,32],plain:[0,48,1,32],retimed:[0,48,2,32],mode:'harbor'});
  assert.deepEqual(runner.run({time:2,seed:32,inputs:{mode:'tower'}}).outputs,
    {scoped:[.4,80,2,32],plain:[0,48,2,32],retimed:[0,48,4,32],mode:'tower'});
  const diff=Ink.diffGraphs(runner.snapshot({time:1,seed:32}),runner.snapshot({time:2,seed:32}));
  assert(diff.affectedOutputs.some(({name,causes})=>name==='scoped'&&causes.includes('/settings/time')));
  const asyncFrame = await runner.previewFrame({probe:{output:'scoped'}},{time:3,seed:-5});
  assert.deepEqual(asyncFrame.outputs.scoped,[.4,80,3,-5]);
});
