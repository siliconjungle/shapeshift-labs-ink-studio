const test=require('node:test');
const assert=require('node:assert/strict');
const Ink=require('..');
const {graphImages:g}=Ink.load().KIT.procedural;
const rect={type:'rectangle',size:[1,1]};
const stamps=[rect,{type:'disc',radius:.47},{type:'star',tips:4,innerRadius:.21,radius:.49}];
const raster=(data,n,channels=1,intent='data',settings={})=>g.declare({
  width:n,height:data.length/(n*channels),channels,data:Float64Array.from(data)
},{intent,...settings});
const map=(...values)=>raster(values,values.length);
const pixels=(r,port='value')=>r[port].raster.data;
const pcolor=(r,index)=>Array.from(pixels(r).subarray(index*4,index*4+4));
const bake=(maps={},options={},controls={},params={})=>{
  const {width=48,height=32,columns=4,rows=2,shapes=stamps}=params;
  return g.tileSampler(width,height,columns,rows,shapes,maps,{seed:38,...options},controls);
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' differs from '+b);

test('selection, displacement, rotation and scale use the same original cell anchor',()=>{
  const sample=bake({selection:map(0,.33,.5,1),position:raster([1,.5,0,.5,.5,1,.5,0],4,2),
    rotation:map(0,.5,1,.75),scale:raster([0,1,1,0,.5,.5,.25,.75],4,2)},
    {size:[1,1],gutter:[0,0]},{positionAmount:[1,.5],scaleRange:[.5,1.5],rotationAmount:80},{rows:1});
  const rows=sample.layout.placements;
  assert.deepEqual(rows.map(x=>x.stampId),[1,1,2,3]);
  assert.deepEqual(rows.map(x=>x.rotation),[-80,0,80,40]);
  assert.deepEqual(rows.map(x=>x.size),[[.5,1.5],[1.5,.5],[1,1],[.75,1.25]]);
  assert.deepEqual(rows.map(x=>x.anchor),[[.125,.5],[.375,.5],[.625,.5],[.875,.5]]);
  assert.deepEqual(rows.map(x=>x.center),[[.375,.5],[.125,.5],[.625,1],[.875,0]]);
  assert(pixels(sample,'stampId').some(n=>n===3));
});

test('map color respects alpha, unassociates before filtering and uses a linear tint',()=>{
  const color=raster([1,0,0,1,0,1,0,0],2,4,'color',{sampling:'linear'});
  const single={width:3,height:3,columns:1,rows:1,shapes:[rect]};
  const sample=bake({color},{color:'#ffffff',gutter:[0,0]}, {},single);
  assert.deepEqual(pcolor(sample,4),[255,0,0,128]);
  assert.equal(pixels(sample,'coverage')[4],1);
  const half=bake({color:map(.5)},{color:'#ffffff',gutter:[0,0]}, {},single);
  assert.deepEqual(pcolor(half,4),[188,188,188,255]);
  const premul=raster([.25,0,0,.25],1,4,'color',{alpha:'premultiplied',colorSpace:'srgb-linear'});
  assert.deepEqual(pcolor(bake({color:premul},{color:'#ffffff'}, {},single),4),[255,0,0,64]);
});

test('priority only changes overlap order, with highest one-based ID breaking exact ties',()=>{
  const config={columns:2,rows:1,width:13,height:7,shapes:[rect]};
  const opt={size:[1.7,1],gutter:[0,0],palette:['#f24835','#3070df'],colorMode:'cycle'};
  const front=bake({priority:map(1,0)},opt,{},config);
  const tie=bake({priority:map(.5,.5)},opt,{},config);
  const index=3*13+6;
  assert.equal(pixels(front,'tileId')[index],1);
  assert.equal(pixels(tie,'tileId')[index],2);
  assert.deepEqual(pcolor(front,index),[242,72,53,255]);
  assert.deepEqual(pcolor(tie,index),[48,112,223,255]);
  const withoutPriority=({priority,...rest})=>rest;
  assert.deepEqual(front.layout.placements.map(withoutPriority),tie.layout.placements.map(withoutPriority));
});

test('density removes a monotonic subset while visibility uses a deterministic map threshold',()=>{
  const params={columns:14,rows:8};
  const base=bake({}, {},{},params);
  const reduced=bake({density:map(.7)}, {},{seeds:{density:17}},params);
  const sparse=bake({density:map(.35)}, {},{seeds:{density:17}},params);
  const ids=sample=>new Map(sample.layout.placements.map(x=>[x.id,x]));
  const iBase=ids(base),iReduced=ids(reduced),iSparse=ids(sparse);
  assert(iSparse.size<iReduced.size&&iReduced.size<iBase.size);
  for(const [id,placement] of iSparse) assert.deepEqual(iReduced.get(id),placement);
  for(const [id,placement] of iReduced) assert.deepEqual(iBase.get(id),placement);
  const visible=bake({visibility:map(.49,.5,.95,0),density:map(1)}, {},{},{rows:1});
  assert.deepEqual(visible.layout.placements.map(x=>x.id),[2,3]);
  assert.deepEqual(visible.layout.rejected,{density:0,visibility:2});
  assert.equal(bake({density:map(0)}).layout.placements.length,0);
});

test('individual seed overrides affect only their named streams',()=>{
  const options={palette:['#c65b40','#543b7a','#eeb886'],jitter:{
    position:[.1,.2],size:[.15,.2],rotation:28,color:.20
  }};
  const params={columns:8,rows:6};
  const base=bake({},options,{density:.7},params);
  const byId=result=>new Map(result.layout.placements.map(n=>[n.id,n]));
  const a=byId(base);
  const variations={selection:['stampId'],position:['center'],rotation:['rotation'],scale:['size'],color:['color'],density:[]};
  for(const [name,keys] of Object.entries(variations)){
    const modified=bake({},options,{density:.7,seeds:{[name]:38+2**32}},params);
    const b=byId(modified);
    if(name==='density') assert.notDeepEqual([...a.keys()],[...b.keys()]);
    else assert.deepEqual([...a.keys()],[...b.keys()]);
    for(const [id,placement] of b) {
      if(!a.has(id)) continue;
      for(const field of Object.keys(placement)) if(!keys.includes(field)) assert.deepEqual(placement[field],a.get(id)[field],name+' '+field);
    }
    for(const field of keys) assert([...b].some(([id,n])=>JSON.stringify(n[field])!==JSON.stringify(a.get(id)[field])));
    assert.equal(modified.layout.seeds[name],38+2**32);
  }
});

test('large and cropped bakes retain placement attributes and wrapped copies preserve stamp and tile labels',()=>{
  const maps={selection:map(0,.5,1),position:raster([1,0,.2,.9],2,2),
    rotation:map(.35,.6,.5),scale:map(.4,.8),density:map(.9,1),
    visibility:map(1,.5,1,.3),priority:map(.4,1),color:map(.6,1,.8)};
  const opt={pattern:'brick',gutter:[.04,.03],samples:2,color:'#e0b174'};
  const size={width:32,height:24,columns:5,rows:5};
  const a=bake(maps,opt,{},size);
  const b=bake(maps,{...opt,crop:[-1,0,1,2]}, {},{...size,width:64,height:48});
  assert.deepEqual(a.layout,b.layout);
  for(const port of ['value','coverage','tileId','course','stampId']) for(let y=0;y<48;y++) for(let x=0;x<64;x++){
    const channels=a[port].raster.channels, i=(y*64+x)*channels,j=((y%24)*32+x%32)*channels;
    assert.deepEqual(pixels(b,port).subarray(i,i+channels),pixels(a,port).subarray(j,j+channels));
  }
});

test('a no-map sampler with one stamp preserves the Tile Generator samples',()=>{
  const options={pattern:'brick',seed:38,palette:['#8a6448','#e6ba75'],size:[1.02,.89],
    jitter:{color:.12,position:[.12,.03],rotation:5,size:[.05,.14]}};
  const generator=g.tileGenerator(48,32,4,2,rect,options);
  const sampler=bake({},options,{}, {shapes:[rect]});
  for(const port of ['value','coverage','tileId','course']) assert.deepEqual(pixels(generator,port),pixels(sampler,port));
});

test('map input types and saved graph links retain repeatable typed behavior',()=>{
  const link=(node,port='value')=>({node,port});
  const graph={format:'ink-studio/graph-project',version:1,nodes:{
    color:{op:'image.uniform',inputs:{value:[.2,.6,.7],width:4,height:4,descriptor:{intent:'color'}}},
    select:{op:'image.uniform',inputs:{value:.85,width:1,height:1,descriptor:{intent:'data'}}},
    stamps:{op:'data.typed',type:'array<shape2d>',inputs:{value:stamps}},
    tiles:{op:'image.tileSampler',inputs:{stamps:link('stamps'),selection:link('select'),color:link('color'),width:23,height:17,
      options:{color:'#ffffff',seed:34},controls:{seeds:{selection:13}}}}
  },outputs:{value:link('tiles'),stamps:link('tiles','stampId'),layout:link('tiles','layout')}};
  const material=JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph,{id:'tile-sampler-test'})));
  const a=Ink.createGraphProject(material).run().outputs,b=Ink.createGraphProject(material).run().outputs;
  assert.deepEqual(a.value.raster.data,b.value.raster.data);
  assert(a.layout.placements.every(x=>x.stampId===3));
  assert(a.stamps.raster.data.some(n=>n===3));
  near(a.layout.placements[0].color[1],.6);
  assert.throws(()=>bake({position:map(.5)}),/2 channel/);
  assert.throws(()=>bake({rotation:raster([.2,.3],1,2)}),/1 channel/);
  assert.throws(()=>bake({density:raster([.5],1,1,'height',{units:'mm'})}),/unitless/);
  assert.throws(()=>bake({}, {},{seeds:{visibility:1}}),/seed stream/);
  assert.throws(()=>bake({}, {},{scaleRange:[2,1]}),/map range/);
  assert.throws(()=>bake({}, {},{}, {shapes:[]}),/1–32/);
});
