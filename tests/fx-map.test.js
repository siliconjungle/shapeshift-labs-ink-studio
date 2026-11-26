const assert=require('node:assert/strict');
const test=require('node:test');
const Ink=require('..');
const P=Ink.load().KIT.procedural;
const {compile}=P.fxMap;
const box={shape:{type:'rectangle',size:[1,1]}};
const location=(image,x,y)=>Array.from(image.raster.data.subarray(
  (y*image.raster.width+x)*image.raster.channels,(y*image.raster.width+x+1)*image.raster.channels));
const map=(fields)=>({format:'ink-studio/fx-map',version:1,root:'root',patterns:{box},...fields});
const stamp=(id,fields={})=>({id,pattern:'box',...fields});
const quadrant=(stamps=[],fields={})=>({kind:'quadrant',stamps,...fields});
const program=(parameters,outputs,result)=>({format:'ink-studio/value-processor',version:1,precision:'f32',
  parameters:Object.fromEntries(Object.entries(parameters).map(([name,type])=>[name,{type}])),outputs,result});
const i=n=>['i32',n], arg=key=>['param',key], lane=(v,n)=>['component',v,n];
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-6,actual+' ≠ '+expected);

test('quadrants draw in order, subdivide the local frame and preserve child IDs',()=>{
  const doc=map({nodes:{
    root:quadrant([stamp('base',{color:'#131e42'})],{children:['red',null,'green','green']}),
    red:quadrant([stamp('color',{color:'#ff0000'})],{branchOffset:[.1,0]}),
    green:quadrant([stamp('color',{color:'#00ff00'})])
  }});
  const value=compile(doc).run({width:8,height:8,options:{wrap:[false,false]}});
  assert.deepEqual(location(value.value,2,1),[255,0,0,255]);
  assert.deepEqual(location(value.value,6,1),[19,30,66,255]);
  assert.deepEqual(location(value.value,6,6),[0,255,0,255]);
  assert.deepEqual(location(value.stampId,6,6),[4]);
  assert.deepEqual(value.layout.stamps.map(({depth,quadrant})=>[depth,quadrant]),[[0,-1],[1,0],[1,2],[1,3]]);
  assert.deepEqual(value.layout.stamps[1].position,[.3,.25]);
  assert.equal(value.layout.stamps[2].path,'root/q2/green/stamp/color');
  assert(Object.isFrozen(value.layout.stamps[2].position));
  const turned=compile(map({nodes:{
    root:quadrant([],{rotation:90,scale:[.6,.6],children:['cell',null,null,null]}),
    cell:quadrant([stamp('rotated')])
  }})).run({width:8,height:8}).layout.stamps[0];
  near(turned.position[0],.65);
  near(turned.position[1],.35);
  near(turned.axes[1],.3);
  near(turned.axes[2],-.3);
});

test('iteration state carries between passes, switch is lazy and path random is stable',()=>{
  const n=arg('iteration'), state=arg('state'), random=arg('random');
  const go=program({iteration:'i32'},{select:'bool'},{select:['eq',['mod',n,i(2)],i(0)]});
  const advance=program({state:'vec4'},{state:'vec4'},
    {state:['vec4',['add',lane(state,0),.125],0,0,0]});
  const variation=program({random:'vec4',state:'vec4',position:'vec2'},
    {opacity:'f32',size:'vec2',offset:'vec2'},{
      opacity:['add',.25,['mul',lane(random,0),.5]],
      size:['vec2',lane(state,0),lane(state,0)],offset:['vec2',0,['mul',lane(arg('position'),0),-.05]]
    });
  const doc=map({parameters:{passes:{type:'i32',default:4}},nodes:{
    root:{kind:'iterate',body:'choose',base:'base',limit:8,step:[.09,0],stepProgram:advance,
      program:program({passes:'i32'},{count:'i32'},{count:arg('passes')})},
    base:quadrant([stamp('paper',{color:'#aaaaaa'})]),
    choose:{kind:'switch',program:go,whenTrue:'alive',whenFalse:null},
    alive:quadrant([stamp('ink',{program:variation,color:'#310922'})])
  }});
  const plan=compile(doc), request={width:24,height:12,seed:498};
  const first=plan.run(request), again=plan.run(request), fewer=plan.run({...request,parameters:{passes:1}});
  const rows=first.layout.stamps;
  assert.deepEqual(rows.map(row=>row.iteration),[-1,0,2]);
  assert.deepEqual(rows.map(row=>row.depth),[0,0,0]);
  assert.deepEqual(rows[2].state,[.375,0,0,0]);
  deepEqualImage(first.value,again.value);
  assert.deepEqual(rows,again.layout.stamps);
  assert.deepEqual(rows[1],fewer.layout.stamps[1]);
  assert.notEqual(rows[1].opacity,plan.run({...request,seed:499}).layout.stamps[1].opacity);
  const lazy=map({nodes:{
    root:{kind:'switch',whenFalse:'valid',whenTrue:'tooMany'},
    valid:quadrant([stamp('ok')]),
    tooMany:{kind:'iterate',body:'valid',limit:2,program:program({},{count:'i32'},{count:i(5)})}
  }});
  assert.equal(compile(lazy).run(request).layout.stamps.length,1);
  assert.throws(()=>compile({...lazy,nodes:{...lazy.nodes,root:{...lazy.nodes.root,select:true}}}).run(request),/iteration bound/);
  assert.throws(()=>plan.run({...request,parameters:{passes:9}}),/iteration bound/);
});

function deepEqualImage(left,right) {
  assert.deepEqual(left.descriptor,right.descriptor);
  assert.deepEqual(left.raster.data,right.raster.data);
}

test('image filters sample premultiplied color and expose both source and ignored alpha',()=>{
  const source=P.graphImages.declare({width:2,height:1,channels:4,data:[255,0,0,255,0,0,255,0]},
    {intent:'color',precision:'unorm8',colorSpace:'srgb'});
  const build=(alpha,filter)=>compile(map({
    images:{image:'colorImage'},patterns:{ink:{image:'image',alpha,filter}},
    nodes:{root:quadrant([stamp('ink',{pattern:'ink'})])}
  }));
  const input={width:1,height:1,images:{image:source}};
  const filtered=build('source','linear').run(input), ignore=build('ignore','linear').run(input);
  assert.deepEqual(location(filtered.value,0,0),[255,0,0,128]);
  assert.deepEqual(location(ignore.value,0,0),[188,0,188,255]);
  near(location(filtered.coverage,0,0)[0],.5);
  const point=build('source','nearest').run({...input,width:2});
  assert.deepEqual(location(point.value,0,0),[255,0,0,255]);
  assert.deepEqual(location(point.value,1,0),[0,0,0,0]);
  const luminance=build('luminance','linear').run(input);
  assert.deepEqual(location(luminance.value,0,0),[255,255,255,27]);
});

test('wrapped stamps cross seams and their periodic copies composite once per sample',()=>{
  const wrapped=compile(map({nodes:{root:quadrant([stamp('edge',{offset:[-.5,0],size:[.5,1]})])}}));
  const request={width:4,height:1};
  assert.deepEqual(Array.from(wrapped.run(request).stampId.raster.data),[1,0,0,1]);
  assert.deepEqual(Array.from(wrapped.run({...request,options:{wrap:[false,false]}}).stampId.raster.data),[1,0,0,0]);
  const self=compile(map({nodes:{root:quadrant([stamp('wide',{size:[1.75,1],opacity:.5})])}}));
  assert.deepEqual(Array.from(self.run({...request,options:{samples:4}}).coverage.raster.data),[.5,.5,.5,.5]);
});

test('material graph retains image ports, gray background, timing and typed outputs',()=>{
  const doc=map({mode:'gray',images:{shape:'grayImage'},patterns:{ink:{image:'shape'}},
    nodes:{root:quadrant([stamp('ink',{pattern:'ink',program:program({},{opacity:'f32'},{opacity:['time']})})])}});
  const ref=(node,port='value')=>({node,port});
  const mat=Ink.openMaterialGraph({format:'ink-studio/graph-project',version:1,
    nodes:{
      stencil:{op:'image.uniform',inputs:{width:2,height:2,value:.5,descriptor:{intent:'mask',precision:'float32'}}},
      base:{op:'image.uniform',inputs:{width:3,height:2,value:.25,descriptor:{intent:'data',precision:'float32'}}},
      fx:{op:'image.fxMap',inputs:{map:doc,width:4,height:2,shape:ref('stencil'),background:ref('base'),
        options:{precision:'float32'}}}
    },outputs:{value:ref('fx'),mask:ref('fx','coverage')}},{id:'test-fx-map'});
  const runtime=Ink.createGraphProject(JSON.parse(JSON.stringify(mat)));
  const first=runtime.run({time:0}), later=runtime.run({time:1});
  assert.equal(runtime.snapshot().graph.nodes.fx.inputs.shape.type,'grayImage');
  assert.equal(runtime.snapshot().graph.nodes.fx.outputs.value.type,'grayImage');
  near(location(first.outputs.value,0,0)[0],.25);
  near(location(first.outputs.mask,0,0)[0],0);
  near(location(later.outputs.value,0,0)[0],.625);
  near(location(later.outputs.mask,0,0)[0],.5);
});

test('invalid structures and work are rejected before an unbounded draw',()=>{
  assert.throws(()=>compile(map({nodes:{root:quadrant([],{children:'root'})}})),/cycle/);
  assert.throws(()=>compile(map({nodes:{root:quadrant([],{children:['unknown',null,null,null]})}})),/unknown node/);
  assert.throws(()=>compile(map({nodes:{root:quadrant([stamp('a'),stamp('a')])}})),/duplicate stamp/);
  assert.throws(()=>compile(map({nodes:{root:quadrant([stamp('a',{program:program(
    {depth:'vec2'},{opacity:'f32'},{opacity:1}
  )})])}})),/incompatible program input/);
  assert.throws(()=>compile(map({nodes:{
    root:{kind:'iterate',limit:512,count:512,body:'child'},
    child:{kind:'iterate',limit:512,count:512,body:'ink'},
    ink:quadrant([stamp('ink')])
  }})).run({width:2,height:2}),/stamp budget/);
});
