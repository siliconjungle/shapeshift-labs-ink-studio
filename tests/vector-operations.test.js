const assert=require('node:assert/strict');
const test=require('node:test');
const Ink=require('..');

const P=Ink.load().KIT.procedural;
const op=(type,operation,inputs)=>({op:'fn.vector',type,inputs:{operation,...inputs}});
const cast=(from,type,a,rounding)=>({op:'fn.cast',type,inputs:{from,a,...(rounding!==undefined && {rounding})}});
const node=(node,port='value')=>({node,port});
const input=input=>({input});
function evaluate(spec){
  const graph=P.graph.create({nodes:{op:spec},outputs:{result:node('op')}});
  return {value:graph.evaluate().outputs.result,type:graph.sockets('op').outputs.value.type};
}

test('vectors compose, broadcast, append, and extract without reshaping earlier inputs',()=>{
  assert.deepEqual(evaluate(op('vec2','compose',{x:2,y:-3})),{value:[2,-3],type:'vec2'});
  assert.deepEqual(evaluate(op('vec3','splat',{a:-.25})),{value:[-.25,-.25,-.25],type:'vec3'});
  assert.deepEqual(evaluate(op('vec2','append',{a:1,b:2})).value,[1,2]);
  assert.deepEqual(evaluate(op('vec3','append',{a:[1,2],b:3})).value,[1,2,3]);
  assert.deepEqual(evaluate(op('vec4','append',{a:[1,2],b:[3,4],operands:['vec2','vec2']})).value,[1,2,3,4]);
  assert.deepEqual(evaluate(op('vec4','append',{a:-1,b:[1,2,3],operands:['number','vec3']})).value,[-1,1,2,3]);
  assert.deepEqual(evaluate(op('vec4','component',{a:[1,2,3,4],index:3})),{value:4,type:'number'});
  assert.throws(()=>evaluate(op('vec3','append',{a:[1,2],b:[3,4],operands:['vec2','vec2']})),/declared vec3/);
});

test('swizzles return the declared width and reject mixed alphabets or unavailable lanes',()=>{
  const a=[1,2,3,4];
  for (const [pattern,value,type] of [
    ['z',3,'number'],['yx',[2,1],'vec2'],['bgr',[3,2,1],'vec3'],['qqst',[4,4,1,2],'vec4'],
    ['xxxy',[1,1,1,2],'vec4']
  ]) assert.deepEqual(evaluate(op('vec4','swizzle',{a,pattern})),{value,type});
  assert.deepEqual(evaluate(op('vec2','swizzle',{a:[5,3],pattern:{value:'yxyx'}})),{value:[3,5,3,5],type:'vec4'});
  for (const pattern of ['','xyxyx','xr','XX','z0',{input:'selector'}])
    assert.throws(()=>evaluate(op('vec4','swizzle',{a,pattern})),/literal components/);
  assert.throws(()=>evaluate(op('vec2','swizzle',{a:[1,2],pattern:'xz'})),/outside vec2/);
});

test('binary overloads resolve port types and preserve scalar operand order',()=>{
  assert.deepEqual(evaluate(op('vec3','add',{a:[1,2,3],b:[3,2,1]})).value,[4,4,4]);
  assert.deepEqual(evaluate(op('vec2','subtract',{a:8,b:[1,3],operands:['number','vec2']})).value,[7,5]);
  assert.deepEqual(evaluate(op('vec4','divide',{a:[2,4,6,8],b:2,operands:['vec4','number']})).value,[1,2,3,4]);
  assert.deepEqual(evaluate(op('vec2','power',{a:2,b:[-2,3],operands:{value:['number','vec2']}})).value,[.25,8]);
  assert.deepEqual(evaluate(op('vec3','min',{a:[-2,6,4],b:2,operands:['vec3','number']})).value,[-2,2,2]);
  assert.throws(()=>evaluate(op('vec2','multiply',{a:1,b:2,operands:['number','number']})),/declared vec2/);
  assert.throws(()=>evaluate(op('vec2','multiply',{a:[1,2,3],b:2,operands:['vec3','number']})),/literal socket types/);
  assert.throws(()=>evaluate(op('vec2','add',{a:[1,2],b:3,operands:{input:'types'}})),/literal socket types/);
  assert.throws(()=>evaluate(op('vec2','divide',{a:2,b:[1,0],operands:['number','vec2']})),/division by zero/);
  assert.throws(()=>evaluate(op('vec2','add',{a:[1,2],b:3})),/expected vec2/);
});

test('geometric vector operations validate zero axes and scalar bounds',()=>{
  assert.deepEqual(evaluate(op('vec2','project',{a:[2,3],b:[8,0]})).value,[2,0]);
  assert.deepEqual(evaluate(op('vec2','reflect',{a:[2,3],b:[0,8]})).value,[2,-3]);
  const extreme=[1.5e308,1.5e308];
  const reflected=evaluate(op('vec2','reflect',{a:extreme,b:[1,1]})).value;
  assert(reflected.every((v,i)=>Math.abs(v/extreme[i]+1)<1e-14));
  assert.deepEqual(evaluate(op('vec4','clamp',{a:[-3,-1,1,3],min:-1,max:1})).value,[-1,-1,1,1]);
  assert.deepEqual(evaluate(op('vec3','abs',{a:[-2,3,-6]})).value,[2,3,6]);
  assert.equal(evaluate(op('vec3','distance',{a:[2,4,2],b:[-1,0,2]})).value,5);
  assert.throws(()=>evaluate(op('vec2','project',{a:[1,2],b:[0,0]})),/zero vector/);
  assert.throws(()=>evaluate(op('vec2','clamp',{a:[1,2],min:2,max:1})),/minimum exceeds/);
});

test('casts explicitly preserve domains, signed rounding, and Boolean truth rules',()=>{
  assert.deepEqual(evaluate(cast('boolean','number',true)),{value:1,type:'number'});
  assert.deepEqual(evaluate(cast('boolean','integer',false)),{value:0,type:'integer'});
  assert.deepEqual(evaluate(cast('integer','number',-Number.MAX_SAFE_INTEGER)),{value:-Number.MAX_SAFE_INTEGER,type:'number'});
  for (const [a,value] of [[-1.25,true],[-0,false],[0,false],[.001,true]])
    assert.deepEqual(evaluate(cast('number','boolean',a)),{value,type:'boolean'});
  assert.deepEqual(evaluate(cast('number','integer',-1.5,'floor')),{value:-2,type:'integer'});
  assert.equal(evaluate(cast('number','integer',-1.5,'round')).value,-1);
  assert.equal(evaluate(cast('number','integer',1.5,'ceil')).value,2);
  assert.equal(evaluate(cast('number','integer',-1.5,'trunc')).value,-1);
  assert.throws(()=>evaluate(cast('number','integer',.5)),/integer domain/);
  assert.throws(()=>evaluate(cast('number','integer',Number.MAX_SAFE_INTEGER+1,'round')),/integer domain/);
  assert.throws(()=>evaluate(cast('number','unitScalar',-1)),/unitScalar domain/);
  assert.throws(()=>evaluate(cast('string','boolean','0')),/fn.cast source/);
  assert.throws(()=>evaluate(cast('number','integer',.5,'near')),/rounding policy/);
});

test('specialized vectors and casts publish typed ports through a saved material',()=>{
  const body={
    result:'vec2',inputs:{tuple:'vec4',offset:'number'},nodes:{
      routed:op('vec4','swizzle',{a:input('tuple'),pattern:'wy'}),
      sum:op('vec2','add',{a:node('routed'),b:input('offset'),operands:['vec2','number']})
    },outputs:{result:node('sum')}
  };
  const spec={
    format:'ink-studio/graph-project',version:1,groups:{offset:body},
    nodes:{
      wired:{op:'offset',inputs:{tuple:[2,4,6,8],offset:-.5}},
      x:op('vec2','swizzle',{a:node('wired','result'),pattern:'x'}),
      quantized:cast('number','integer',node('x'),'floor'),
      active:cast('integer','boolean',node('quantized'))
    },outputs:{vector:node('wired','result'),count:node('quantized'),active:node('active')}
  };
  const doc=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'vector-casts'})));
  const runner=Ink.createGraphProject(doc);
  assert.deepEqual(runner.run().outputs,{vector:[7.5,3.5],count:7,active:true});
  assert.equal(runner.describeSubgraph({node:'wired'}).outputs.result.type,'vec2');
  assert.equal(runner.sockets('quantized').outputs.value.type,'integer');
  assert.equal(runner.sockets('x').outputs.value.type,'number');

  spec.nodes.quantized.inputs.a=node('wired','result');
  assert.throws(()=>Ink.createGraphProject(spec),/quantized.a.*expected number/);
});
