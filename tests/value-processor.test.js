const assert=require('node:assert/strict');
const test=require('node:test');
const Ink=require('..');

const project=fields=>({format:'ink-studio/graph-project',version:1,...fields});
const program=fields=>({format:'ink-studio/value-processor',version:1,precision:'f32',...fields});
const input=input=>({input});
const link=(node,port='value')=>({node,port});
const op=(op,inputs)=>({op,inputs});
const i=n=>['i32',n], get=id=>['get',id], param=id=>['param',id];
const model=program({
  parameters:{width:{type:'i32',default:136},desired:{type:'vec2',default:[.3,.65]},active:{type:'bool',default:true}},
  outputs:{width:{type:'i32',port:'pixelCount'},score:{type:'f32',port:'unitScalar'},range:'vec2',fit:'bool'},
  body:[
    {let:'width',type:'i32',value:['mul',['div',param('width'),i(8)],i(8)]},
    {let:'passes',value:i(0)},
    {for:'step',count:i(3),limit:4,body:[{set:'passes',value:['add',get('passes'),get('step')]}]},
    {let:'score',value:['mul',['toF32',get('passes')],.25]},
    {if:['not',param('active')],then:[{set:'score',value:0}]}
  ],
  result:{
    width:get('width'),score:get('score'),range:['vec2',['component',param('desired'),0],['component',param('desired'),1]],
    fit:['eq',param('width'),get('width')]
  }
});

test('one evaluation emits typed dimensions, a score, a range and a Boolean',()=>{
  const plan=Ink.load().KIT.procedural.valueProcessor.compile(JSON.parse(JSON.stringify(model)));
  assert.deepEqual(plan.ports,{width:'pixelCount',score:'unitScalar',range:'vec2',fit:'boolean'});
  assert.equal(plan.sockets.width.default,136);
  assert.deepEqual(plan.run(),{width:136,score:.75,range:[Math.fround(.3),Math.fround(.65)],fit:true});
  const adjusted=plan.run({parameters:{width:139,desired:[-3,4],active:false}});
  assert.deepEqual(adjusted,{width:136,score:0,range:[-3,4],fit:false});
  assert(Object.isFrozen(adjusted)&&Object.isFrozen(adjusted.range));
  assert.throws(()=>plan.run({parameters:{width:5}}),/result width.*pixelCount/);
  assert.throws(()=>plan.run({parameters:{width:2147483648}}),/width needs i32/);
  assert.throws(()=>plan.run({parameters:{missing:1}}),/declared parameter/);
});

test('the compiler checks uniform operations, result contracts and work bounds',()=>{
  const compile=Ink.load().KIT.procedural.valueProcessor.compile;
  for(const coord of ['x','u','width','height'])
    assert.throws(()=>compile({...model,result:{...model.result,score:[coord]}}),/uniform system value/);
  for(const expression of [['load','source',i(0),i(1)],['sample','source',['vec2',0,1]]])
    assert.throws(()=>compile({...model,result:{...model.result,score:expression}}),/uniform value expression/);
  assert.throws(()=>compile({...model,outputs:{...model.outputs,width:{type:'vec2',port:'pixelCount'}}}),/cannot expose/);
  assert.throws(()=>compile({...model,result:{...model.result,range:0}}),/range needs vec2, received f32/);
  assert.throws(()=>compile({...model,result:{...model.result,extra:0}}),/every declared output exactly once/);
  assert.throws(()=>compile({...model,body:[{for:'i',count:3,limit:4,body:[]}]}),/i32 count/);
  const loop=body=>({for:'i',count:i(1),limit:64,body});
  assert.throws(()=>compile({...model,body:[loop([loop([loop([])])])]}),/uniform work budget/);
  assert.throws(()=>compile({...model,result:{...model.result,score:1.1}}).run(),/result score.*unitScalar/);
});

test('editable materials preserve non-image ports and wire the same values to raster nodes',()=>{
  const spec=project({inputs:{requested:{type:'integer',default:139}},nodes:{
    dimensions:op('fn.valueProcessor',{program:model,width:input('requested')}),
    fill:op('raster.canvas',{width:link('dimensions','width'),height:4,color:[45,30,65,255]})
  },outputs:{image:link('fill'),score:link('dimensions','score'),window:link('dimensions','range')}});
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'sizing'})));
  const runner=Ink.createGraphProject(saved);
  const frame=runner.run();
  assert.equal(frame.outputs.image.width,136);
  assert.equal(frame.outputs.image.height,4);
  assert.equal(frame.outputs.score,.75);
  assert.equal(runner.snapshot().graph.nodes.dimensions.outputs.width.type,'pixelCount');
  assert.deepEqual(runner.inspect({node:'dimensions',port:'range'}).value,[Math.fround(.3),Math.fround(.65)]);
  assert.equal(runner.run({inputs:{requested:152}}).outputs.image.width,152);
});

test('uniform programs work inside declared functions with the correct clock and project seed',()=>{
  const clock=program({parameters:{offset:{type:'f32',default:.25}},outputs:{value:'f32'},
    result:{value:['add',['time'],['add',['toF32',['seed']],param('offset')]]}});
  const functions={measure:{inputs:{},result:'number',nodes:{formula:op('fn.valueProcessor',{program:clock})},
    outputs:{result:link('formula')}}};
  const runner=Ink.createGraphProject(project({groups:functions,nodes:{
    direct:op('measure',{}),other:{op:'anim.retime',group:'measure',inputs:{timing:{rate:2,range:[0,10]}}}
  },outputs:{direct:link('direct','result'),retimed:link('other','result')}}));
  assert.deepEqual(runner.run({time:1,seed:7}).outputs,{direct:8.25,retimed:9.25});
  assert.deepEqual(runner.run({time:2,seed:7}).outputs,{direct:9.25,retimed:11.25});
  assert.deepEqual(runner.run({time:2,seed:-1}).outputs,{direct:1.25,retimed:3.25});
});
