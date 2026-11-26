const test=require('node:test');
const assert=require('node:assert/strict');
const Ink=require('..');
const P=Ink.load().KIT.procedural, g=P.graphImages, reader=g.textureSampling;

const gray=(width,height,values,data=Float64Array,options={})=>g.declare(
  {width,height,channels:1,data:data.from(values)},{intent:'data',...options});
const color=(width,height,channels,values,options={})=>g.declare(
  {width,height,channels,data:Uint8Array.from(values)},{intent:'color',...options});
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,actual+' differs from '+expected);
const input=input=>({input});
const link=(node,port='value')=>({node,port});
const op=(op,inputs,type)=>({op,inputs,...(type && {type})});

test('point UVs follow top-left texel centers, per-axis addressing, and texture defaults',()=>{
  const map=gray(2,2,[0,1,2,3],Float64Array,{sampling:'nearest',tiling:{u:'wrap',v:'clamp'}});
  assert.equal(reader.sampleGray(map,[.25,.25]),0);
  assert.equal(reader.sampleGray(map,[.75,.25]),1);
  assert.equal(reader.sampleGray(map,[.25,.75]),2);
  assert.equal(reader.sampleGray(map,[1.75,1.5]),3);
  assert.equal(reader.sampleGray(map,[1.25,1.5],{wrapU:'mirror',wrapV:'wrap'}),3);
  assert.equal(reader.sampleGray(map,[1.25,1.5],{wrapU:'clamp',wrapV:'transparent'}),0);
  assert.equal(reader.sampleGray(map,[.5,.5],{filter:'linear'}),1.5);
  assert.equal(reader.sampleGray(map,[-Number.MAX_VALUE,.75]),2);
});

test('linear-light RGBA sampling keeps coverage, decodes stored color spaces, and ignores hidden RGB',()=>{
  const rgb=color(2,1,3,[0,0,0,255,255,255],{sampling:'linear'});
  assert.deepEqual(reader.sampleColor(rgb,[.5,.5]),[.5,.5,.5,1]);
  const raw=color(2,1,4,[255,0,0,0,0,255,0,128]);
  const result=[0,1,0,64/255];
  assert.deepEqual(reader.sampleColor(raw,[.5,.5],{filter:'linear'}),result);
  assert.deepEqual(reader.sampleColor(raw,[.5,.5],{mip:1}),result);
  assert.deepEqual(reader.sampleColor(raw,[.25,.5]),[0,0,0,0]);
  assert.deepEqual(reader.sampleColor(rgb,[1,.5],{wrapU:'transparent'}),[1,1,1,.5]);
  const associated=color(1,1,4,[128,0,0,128],{alpha:'premultiplied'});
  assert.deepEqual(reader.sampleColor(associated,[.5,.5]),[1,0,0,128/255]);
  const p3=color(1,1,3,[255,0,0],{colorSpace:'display-p3'});
  const reference=g.convert(p3,{intent:'color',precision:'float64',colorSpace:'srgb-linear'});
  assert.deepEqual(reader.sampleColor(p3,[.5,.5]),[...reference.raster.data,1]);
});

test('explicit mips area-average odd dimensions, blend fractionally, and share levels across reads',()=>{
  const map=gray(3,3,[1,2,3,4,5,6,7,8,9]);
  const cache=reader.createCache();
  assert.equal(reader.sampleGray(map,[1/6,1/6],{mip:0},cache),1);
  near(reader.sampleGray(map,[1/6,1/6],{mip:1},cache),5);
  assert.equal(cache.bytes,8);
  near(reader.sampleGray(map,[1/6,1/6],{mip:.25},cache),2);
  near(reader.sampleGray(map,[1/6,1/6],{mip:.51,mipFilter:'nearest'},cache),5);
  assert.equal(reader.sampleGray(map,[1/6,1/6],{mip:.49,mipFilter:'nearest'},cache),1);
  near(reader.sampleGray(map,[1/6,1/6],{mip:8,wrapU:'mirror'},cache),5);
  assert.equal(cache.bytes,8);
  const integer=gray(2,2,[0,0,65535,65535],Uint16Array);
  near(reader.sampleGray(integer,[.5,.5],{mip:1},cache),.5);
  assert.equal(cache.bytes,16);
  const signed=gray(2,1,[-.75,2.25],Float32Array);
  assert.equal(reader.sampleGray(signed,[.25,.5]),-.75);
  assert.equal(reader.sampleGray(signed,[.75,.5]),2.25);
});

test('mis-tagged textures, malformed UVs, and invalid sampling controls are diagnosed',()=>{
  const data=gray(1,1,[.5]);
  const height=g.toHeight(data,{scale:2,units:'mm'});
  assert.throws(()=>reader.sampleGray(height,[.5,.5]),/grayscale/);
  assert.throws(()=>reader.sampleColor(data,[.5,.5]),/color texture/);
  assert.throws(()=>reader.sampleGray(data,[.5,NaN]),/finite UV/);
  assert.throws(()=>reader.sampleGray(data,[.5,.5],{mip:-.1}),/mip choice/);
  assert.throws(()=>reader.sampleGray(data,[.5,.5],{filter:'cubic'}),/filter/);
  assert.throws(()=>reader.sampleGray(data,[.5,.5],{wrapU:'zero'}),/border policy/);
  const group={ result:'grayImage',inputs:{texture:'grayImage'},nodes:{},outputs:{result:input('texture')} };
  assert.throws(()=>P.graph.create(group),/declared value type/);
});

test('a saved texture function reads independently bound pigment and mask ports at different UVs',()=>{
  const body={result:'srgb-linear',
    inputs:{item:'vec2',pigment:'colorImage',stencil:'grayImage',offset:'vec2',mip:'number'},
    nodes:{
      paint:op('fn.sampleColor',{source:input('pigment'),uv:input('item'),wrapU:'wrap',mip:input('mip')}),
      shifted:op('fn.vector',{operation:'add',a:input('item'),b:input('offset')},'vec2'),
      mask:op('fn.sampleGray',{source:input('stencil'),uv:link('shifted'),filter:'nearest',wrapU:'wrap'}),
      mixed:op('fn.color',{operation:'mix',a:[0,0,0,1],b:link('paint'),t:link('mask')},'srgb-linear')
    },outputs:{result:link('mixed')}};
  const maps={pigment:link('pigment'),stencil:link('stencil'),offset:[.5,0],mip:0};
  const spec={format:'ink-studio/graph-project',version:1,groups:{coat:body},nodes:{
    pigment:op('image.declare',{source:{width:2,height:1,channels:3,data:[255,0,0,0,0,255]},
      descriptor:{intent:'color',precision:'unorm8'}}),
    stencil:op('image.declare',{source:{width:2,height:1,channels:1,data:[0,1]},descriptor:{intent:'mask'}}),
    one:op('coat',{item:[.25,.5],...maps}),
    many:{op:'array.map',group:'coat',inputs:{items:[[.25,.5],[.75,.5],[1.25,.5]],...maps}}
  },outputs:{value:link('one','result'),array:link('many')}};
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'sample-test'})));
  const graph=Ink.createGraphProject(saved), out=graph.run().outputs;
  assert.deepEqual(out.value,[1,0,0,1]);
  assert.deepEqual(out.array,[[1,0,0,1],[0,0,0,1],[1,0,0,1]]);
  assert.equal(graph.describeSubgraph({group:'coat'}).inputs.stencil.type,'grayImage');
  assert.equal(graph.sockets('many').outputs.value.type,'array<srgb-linear>');
  assert.equal(graph.inspect({node:'one/mask'}).value,1);

  spec.nodes.stencil.inputs.descriptor={intent:'height',units:'mm'};
  assert.throws(()=>Ink.createGraphProject(spec),/expected typed unitless grayscale/);
});

test('an evaluation rebuilds its mip levels when linked texture content changes',()=>{
  const body={result:'number',inputs:{source:'grayImage',uv:'vec2'},
    nodes:{read:op('fn.sampleGray',{source:input('source'),uv:input('uv'),mip:1})},outputs:{result:link('read')}};
  const graph=P.graph.create(body);
  const original=gray(2,2,[0,0,0,1]), replaced=gray(2,2,[1,1,1,0]);
  assert.equal(graph.evaluate({source:original,uv:[.25,.25]}).outputs.result,.25);
  assert.equal(graph.evaluate({source:replaced,uv:[.25,.25]}).outputs.result,.75);
  assert.equal(graph.evaluate({source:original,uv:[.75,.75]}).outputs.result,.25);
});
