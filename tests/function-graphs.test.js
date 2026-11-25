const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ink = require('..');

const P = Ink.load().KIT.procedural;
const source = input => ({input});
const link = (node,port='value') => ({node,port});
const node = (op,inputs={},type) => ({op,inputs,...(type && {type})});
const project = fields => ({format:'ink-studio/graph-project',version:1,...fields});
const compare = (type,a,b,operation='eq') => node('fn.compare',{operation,a,b},type);
const math = (type,operation,inputs) => node('fn.math',{operation,...inputs},type);
const fn = (result, inputs, nodes, binding) => ({result,inputs,nodes,outputs:{result:binding}});
const output = (nodes,ref,type) => P.graph.create({nodes,outputs:{result:ref},...(type && {result:type})}).evaluate().outputs.result;
const near = (actual,expected) => assert(Math.abs(actual-expected)<1e-9,actual+' differs from '+expected);

const gain = fn('number',{level:'number',multiplier:{type:'number',default:2}},
  { multiply:math('number','multiply',{a:source('level'),b:source('multiplier')}) },link('multiply'));

test('typed constants and declared results accept all supported value kinds',()=>{
  const cases = {
    number:.375,integer:-12,vec2:[1,2],vec3:[1,2,3],vec4:[1,2,3,4],
    srgb:[.25,.5,.75,.3],'srgb-linear':[4,-.125,.75,.3],unitScalar:.625,
    boolean:false,string:'Cinder'
  };
  for (const [type,value] of Object.entries(cases)) {
    const body=fn(type,{}, {typed:node('data.typed',{value},type)},link('typed'));
    const planned=Ink.createGraphProject(project(body));
    assert.equal(planned.snapshot().graph.result,type);
    assert.equal(planned.snapshot().graph.outputs.result.type,type);
    assert.deepEqual(planned.run().outputs.result,value);
  }
  assert.equal(output({},-2,'integer'),-2);
  assert.deepEqual(output({},[0,1,2,3],'vec4'),[0,1,2,3]);
});

test('numeric and vector functions handle arity, precision, integer policy and errors',()=>{
  assert.equal(output({value:math('integer','divide',{a:-17,b:5})},link('value')),-3);
  assert.equal(output({value:math('integer','power',{a:3,b:32})},link('value')),1853020188851841);
  assert.throws(()=>output({value:math('integer','power',{a:2,b:-9999})},link('value')),/integer domain/);
  assert.equal(output({value:math('integer','modulo',{a:-17,b:5})},link('value')),-2);
  near(output({value:math('number','atan2',{y:1,x:1})},link('value')),Math.PI/4);
  near(output({value:math('number','smoothstep',{a:0,min:-Number.MAX_VALUE,max:Number.MAX_VALUE})},link('value')),.5);
  for (const [rounding,expected] of [['floor',-2],['ceil',-1],['round',-1],['trunc',-1]])
    assert.equal(output({value:node('fn.toInteger',{a:-1.25,rounding})},link('value')),expected);
  assert.deepEqual(output({value:node('fn.vector',{operation:'cross',a:[1,0,0],b:[0,2,0]},'vec3')},link('value')),[0,0,2]);
  const normal=output({value:node('fn.vector',{operation:'normalize',a:[1e308,1e308,0,0]},'vec4')},link('value'));
  near(normal[0],Math.SQRT1_2);
  near(normal[1],Math.SQRT1_2);
  assert.equal(output({value:node('fn.vector',{operation:'dot',a:[1,2],b:[3,4]},'vec2')},link('value')),11);
  assert.throws(()=>output({value:math('integer','add',{a:Number.MAX_SAFE_INTEGER,b:1})},link('value')),/integer domain/);
  assert.throws(()=>output({value:math('number','divide',{a:1,b:0})},link('value')),/division by zero/);
  assert.throws(()=>output({value:math('number','sqrt',{a:-4})},link('value')),/number domain/);
  assert.throws(()=>output({value:node('fn.toInteger',{a:2.5})},link('value')),/integer domain/);
  assert.throws(()=>output({value:node('fn.vector',{operation:'component',a:[0,1],index:2},'vec2')},link('value')),/out of range/);
});

test('color functions mix straight RGB(A) in linear light, alongside comparisons and Boolean choices',()=>{
  const stock = [0,.1,.3], highlight = [1,1,1];
  const shade = node('fn.color',{operation:'mix',a:stock,b:highlight,t:.5},'srgb');
  const ops = {
    tint:shade,
    mode:compare('string','reduce','reduce'),
    samples:compare('vec4',[1,2,3,4],[1,2,4,3],'ne'),
    test:node('fn.logic',{a:link('mode'),b:link('samples')}),
    branch:node('fn.select',{condition:link('test'),whenTrue:link('tint'),whenFalse:stock},'srgb')
  };
  const selected=output(ops,link('branch'),'srgb');
  near(selected[0],.7353569830524495);
  near(output({color:node('fn.color',{operation:'luminance',a:[0,1,0]},'srgb')},link('color')),.7152);
  const a=[1,0,0,0], b=[0,0,1,1];
  const blue=output({mix:node('fn.color',{a,b,t:.5},'srgb')},link('mix'));
  near(blue[2],1);
  assert.deepEqual([blue[0],blue[1],blue[3]],[0,0,.5]);
  assert.equal(output({label:node('fn.text',{a:'Fired ',b:'glaze'})},link('label')),'Fired glaze');
  assert.equal(output({label:node('fn.text',{operation:'length',a:'🟩'})},link('label')),2);
});

test('shared functions are typed in nested calls, plans, saved materials, and browser-toolkit graphs',()=>{
  const response = fn('number',{level:'number'},
    { nested:node('thermal',{level:source('level')}),
      trim:math('number','clamp',{a:link('nested','result'),min:0,max:1}) }, link('trim'));
  const spec = project({inputs:{level:{type:'number',default:.25}},groups:{thermal:gain,glaze:response},
    nodes:{left:node('glaze',{level:source('level')}),right:node('glaze',{level:.4})},
    outputs:{left:link('left','result'),right:link('right','result')}});
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'fired-glaze'})));
  const runner=Ink.createGraphProject(saved);
  assert.deepEqual(runner.run().outputs,{left:.5,right:.8});
  assert.deepEqual(runner.run({inputs:{level:.7}}).outputs,{left:1,right:.8});
  const info=runner.describeSubgraph({node:'left'});
  assert.equal(info.result,'number');
  assert.equal(info.outputs.result.type,'number');
  assert.equal(runner.inspect({node:'left/nested/multiply'}).value,.5);
  assert.equal(runner.snapshot().groups.glaze.result,'number');
  const group=P.graph.group(gain);
  assert.equal(group.outputs.result.type,'number');
  assert.equal(group.time,false);
  assert.equal(P.graph.create({nodes:{a:node('gain', {level:.2})},
    outputs:{value:link('a','result')}},{groups:{gain:group}}).evaluate().outputs.value,.4);
});

test('an externally published function retains its result, pins, and relative location after saving',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-functions-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'gain.group.json');
  const published=Ink.publishMaterialSubgraph(file,Ink.openMaterialGraph(project(gain),{id:'gain'}),{revision:3});
  assert.equal(published.outputs.result.type,'number');
  assert.equal(JSON.parse(fs.readFileSync(file)).result,'number');
  const initial=Ink.openMaterialGraph(project({
    groups:{gain:{file:'gain.group.json',revision:3,sha256:published.sha256}},nodes:{call:node('gain',{level:.3})},
    outputs:{color:link('call','result')}
  }),{id:'recipe'});
  const target=path.join(directory,'material','nested.material.json');
  Ink.writeMaterialGraph(target,initial,{baseDir:directory});
  const consumer=Ink.readGraphProject(target);
  assert.equal(consumer.run().outputs.color,.6);
  assert.equal(consumer.describeSubgraph({node:'call'}).source.revision,3);
  assert.equal(consumer.describeSubgraph({node:'call'}).result,'number');
});

test('function graphs reject incompatible result links, effect nodes, keyframes and cycles',()=>{
  assert.throws(()=>P.graph.create(fn('integer',{x:'number'},{},source('x'))),/result requires signed safe integer/);
  assert.throws(()=>P.graph.create(fn('string',{}, {}, false)),/result requires string/);
  assert.throws(()=>P.graph.create({result:'number',nodes:{},outputs:{value:1}}),/one output named result/);
  assert.throws(()=>P.graph.create(fn('number',{x:'any'},{},1)),/inputs must use declared value types/);
  assert.throws(()=>P.graph.create(fn('number',{}, {tick:node('image.noise')},1)),/pure value operation/);
  assert.throws(()=>P.graph.create(fn('number',{}, {tick:node('fn.math',{a:{keys:[{time:0,value:1}]},b:2})},1)),
    /keyframes/);
  assert.throws(()=>P.graph.create(fn('number',{}, {}, {keys:[{time:0,value:1}]})),/result requires/);
  assert.throws(()=>P.graph.create(fn('number',{}, {value:math('number','add',{a:1,b:2})},link('value')),
    {operations:{'fn.math':{outputs:{value:'number'},run:()=>({value:0})}}}),/pure value operation/);
  const loop=fn('number',{}, {again:node('loop')},link('again','result'));
  assert.throws(()=>Ink.createGraphProject(project({groups:{loop},nodes:{},outputs:{}})),/group cycle/);
  const generic={inputs:{level:'number'},nodes:{},outputs:{result:source('level')}};
  const typed=fn('number',{}, {call:node('generic',{level:.25})},link('call','result'));
  assert.throws(()=>Ink.createGraphProject(project({groups:{generic,typed},nodes:{},outputs:{}})),/declared function call/);
});
