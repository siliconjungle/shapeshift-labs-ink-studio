const test=require('node:test');
const assert=require('node:assert/strict');
const Ink=require('..');
const g=Ink.load().KIT.procedural.graphImages, mapper=g.scatterMappers;
const pixels=image=>Array.from(image.raster.data);
const plane=(values,width,channels=1,descriptor={})=>g.declare({
  width,height:values.length/width/channels,channels,data:Float32Array.from(values)
},{intent:'data',...descriptor});
const fixture=(changes={})=>mapper.surface({
  instanceId:plane([1,1,2,0,3,3,2,0],4),
  shapeId:plane([1,1,2,0,1,1,2,0],4),
  uv:plane([.25,.5,.75,.5,.25,.5,0,0,.25,.5,.75,.5,.75,.5,0,0],4,2,{units:'uv'}),
  coverage:plane([1,.5,1,0,1,.25,1,0],4,1,{intent:'mask'}),
  height:plane(Array(8).fill(.75),4,1,{intent:'height',units:'mm'}),
  normal:g.uniform([.5,.5,1],4,2,{intent:'normal',precision:'unorm8'}),
  layout:{placements:[{id:1,shapeId:1},{id:2,shapeId:2},{id:3,shapeId:1},{id:4,shapeId:2}]},
  ...changes
});

test('scatter selections intersect, invert among visible stamps, and keep exact fractional coverage',()=>{
  const surface=fixture();
  const selected=mapper.mask(surface,{shapeIds:[1],instanceRange:[2,3]});
  assert.deepEqual(selected.selection.ids,[3]);
  assert.deepEqual(pixels(selected.value),[0,0,0,0,1,.25,0,0]);
  assert.deepEqual(pixels(mapper.mask(surface,{shapeIds:[1],invert:true}).value),[0,0,1,0,0,0,1,0]);
  const half=mapper.mask(surface,{fraction:.5,seed:19});
  assert.deepEqual(half,mapper.mask(surface,{fraction:.5,seed:19}));
  for(const [first,next] of [[0,1],[2,6],[4,5]])assert.equal(Boolean(pixels(half.value)[first]),Boolean(pixels(half.value)[next]));
  assert.deepEqual(mapper.mask(surface,{fraction:0}).selection.ids,[]);
  assert.deepEqual(pixels(mapper.mask(surface,half.selection).value),pixels(half.value));
});

test('color replaces in linear light, preserves outside bytes, and retains coverage without a base',()=>{
  const surface=fixture(), select={instanceIds:[1]};
  const base=g.uniform([0,0,0,1],4,2,{intent:'color',layout:'rgba',precision:'unorm8'});
  const layer=mapper.color(surface,null,[],select,{value:'#ffffff'}).value;
  assert.deepEqual(pixels(layer).slice(0,12),[255,255,255,255,255,255,255,128,0,0,0,0]);
  const result=mapper.color(surface,base,[],select,{value:'#ffffff'}).value;
  assert.deepEqual(pixels(result).slice(0,8),[255,255,255,255,188,188,188,255]);
  assert.deepEqual(pixels(result).slice(8),pixels(base).slice(8));
  assert.equal(result.descriptor,base.descriptor);
  const transparent=g.uniform([.32,.14,.28,.4],4,2,{intent:'color',layout:'rgba',precision:'unorm8',alpha:'premultiplied'});
  const tinted=mapper.color(surface,transparent,[],select,{mode:'tint',value:'#00ffff'}).value;
  assert.equal(pixels(tinted)[0],0);
  assert.equal(pixels(tinted)[3],pixels(transparent)[3]);
  assert.deepEqual(pixels(tinted).slice(8),pixels(transparent).slice(8));
  const tile=g.declare({width:2,height:1,channels:4,data:Uint8Array.from([255,0,0,255,0,255,0,0])},
    {intent:'color',sampling:'linear'});
  const filtered=mapper.color(surface,null,[tile],select,{uvOffset:[.25,0]}).value;
  assert.deepEqual(pixels(filtered).slice(0,4),[255,0,0,128]);
});

test('grayscale samples local UVs, stable texture slots and inherited wrap addressing',()=>{
  const surface=fixture(), a=plane([.25,.75],2),b=plane([.5,1],2);
  const byShape=mapper.grayscale(surface,null,[a,b]).value;
  assert.deepEqual(pixels(byShape),[.25,.375,.5,0,.25,.1875,1,0]);
  const byInstance=mapper.grayscale(surface,null,[a,b,plane([1,1],2)],{},{textureBy:'instance'}).value;
  assert.deepEqual(pixels(byInstance).slice(4,6),[1,.25]);
  const wrapped=plane([.25,.75],2,1,{tiling:{u:'wrap'}});
  assert.deepEqual(pixels(mapper.grayscale(surface,null,[wrapped],{instanceIds:[1]},{uvOffset:[1,0]}).value).slice(0,2),[.25,.375]);
  const solid=(value)=>plane([value],1);
  const random=mapper.grayscale(surface,null,[solid(.5),solid(1)],{},{textureBy:'random',seed:27}).value;
  const r=pixels(random);
  assert.equal(r[0],r[1]*2);
  assert.equal(r[2],r[6]);
  assert.equal(r[4],r[5]*4);
});

test('inspection yields portable stamp statistics, precise sample coordinates and status',()=>{
  const original=fixture();
  const surface=JSON.parse(JSON.stringify(original,(key,value)=>ArrayBuffer.isView(value)?Array.from(value):value));
  const {value,mask}=mapper.inspect(surface,{pixel:[1,0]});
  assert.equal(value.instanceId,1);
  assert.equal(value.shapeId,1);
  assert.equal(value.visiblePixels,2);
  assert.equal(value.coverageSum,1.5);
  assert.deepEqual(value.bounds,[0,0,2,1]);
  assert.deepEqual(value.sample.texel,[1,0]);
  assert.deepEqual(value.sample.uv,[.75,.5]);
  assert.equal(value.sample.height,.75);
  assert.equal(value.sample.normal[2],1);
  assert(Math.abs(value.sample.normal[0])<=1/255+1e-9);
  assert.equal(value.sample.coverage,.5);
  assert.deepEqual(pixels(mask),[1,.5,0,0,0,0,0,0]);
  assert.equal(mapper.inspect(sourceWithoutLayout(),{instanceId:4}).value.status,'missing');
  assert.equal(mapper.inspect(surface,{instanceId:4}).value.status,'occluded');
  assert.equal(mapper.inspect(surface,{pixel:[3,0]}).value.status,'background');
  function sourceWithoutLayout(){return fixture({layout:null});}
});

test('hide rebakes occlusion and replacement keeps the selected placement transform',()=>{
  const disc={type:'disc',radius:.47}, star={type:'star',tips:4,innerRadius:.18};
  const library=[disc,star], opts={scale:[.96,.45,.96],heightJitter:.15,jitter:0,seed:40};
  const bake=edits=>g.shapeSplatter(50,25,2,1,library,[],{},opts,0,0,edits);
  const original=bake(), caught=new Set(pixels(original.instanceId));
  assert(caught.has(1)&&caught.has(2));
  const selection=mapper.mask(original.surface,{instanceIds:[1]}).selection;
  const hidden=bake(mapper.edit(selection));
  const other=bake(mapper.edit(mapper.mask(original.surface,{instanceIds:[2]}).selection));
  assert.equal(hidden.layout.rejected.hidden,1);
  assert.deepEqual(hidden.layout.placements,[original.layout.placements[1]]);
  assert(pixels(original.instanceId).some((id,i)=>id===1&&pixels(hidden.instanceId)[i]===2)||
    pixels(original.instanceId).some((id,i)=>id===2&&pixels(other.instanceId)[i]===1));
  const old=original.layout.placements[0], shapeId=3-old.shapeId;
  const replacement=bake(mapper.edit(selection,{action:'replace',shapeId}));
  const next=replacement.layout.placements[0];
  assert.equal(next.shapeId,shapeId);
  for(const key of ['id','base','uv','scale','rotation'])assert.deepEqual(next[key],old[key]);
  assert.notDeepEqual(pixels(replacement.value),pixels(original.value));
  assert.throws(()=>bake(mapper.edit(selection,{action:'replace',shapeId:3})),/edit|replacement/i);
});

test('scatter maps reject incompatible descriptors, IDs and selections',()=>{
  assert.throws(()=>fixture({shapeId:plane([1,2,2,0,1,1,2,0],4)}),/visible instance/);
  assert.throws(()=>fixture({coverage:plane([1,1],2,1,{intent:'mask'})}),/aligned/);
  assert.throws(()=>fixture({instanceId:plane([1,1,2,0,3,3,2,0],4,1,{sampling:'linear'})}),/discrete/);
  assert.throws(()=>mapper.mask(fixture(),{instanceRange:[3,1]}),/invalid scatter/i);
  assert.throws(()=>mapper.color(fixture(),null,[],{},{mode:'tint'}),/base/);
  assert.throws(()=>mapper.grayscale(fixture(),null,[g.uniform([1,0,0],1,1,{intent:'color'})]),/type/);
  assert.throws(()=>mapper.inspect(fixture(),{pixel:[4,1]}),/in-bounds/);
});

test('a saved graph shares one selection between both mappers and a second geometry bake',()=>{
  const link=(node,port='value')=>({node,port});
  const bake={width:32,height:16,columns:4,rows:2,options:{seed:40,scale:.33,jitter:.4}};
  const map={source:link('first','surface'),selection:link('subset','selection')};
  const input={format:'ink-studio/graph-project',version:1,nodes:{
    first:{op:'image.shapeSplatter',inputs:bake},
    subset:{op:'image.scatterMask',inputs:{source:map.source,options:{fraction:.7,seed:40}}},
    ink:{op:'image.scatterColor',inputs:{...map,options:{value:{mode:'replace',value:'#da8166'}}}},
    glaze:{op:'image.scatterGrayscale',inputs:{...map,options:{value:{mode:'replace',value:.65}}}},
    inspect:{op:'image.scatterInspect',inputs:{source:map.source,options:{instanceId:1}}},
    edit:{op:'image.scatterEdit',inputs:{selection:map.selection}},
    second:{op:'image.shapeSplatter',inputs:{...bake,edits:link('edit')}}
  },outputs:{mask:link('subset'),ink:link('ink'),inkMask:link('ink','mask'),glaze:link('glaze'),
    glazeMask:link('glaze','mask'),inspect:link('inspect'),selected:map.selection,layout:link('second','layout')}};
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(input,{id:'scatter-test'})));
  const project=Ink.createGraphProject(saved), out=project.run().outputs;
  assert(out.selected.ids.length>0&&out.selected.ids.length<8);
  assert.deepEqual(pixels(out.mask),pixels(out.inkMask));
  assert.deepEqual(pixels(out.mask),pixels(out.glazeMask));
  assert.equal(out.inspect.status,'visible');
  assert.equal(out.layout.rejected.hidden,out.selected.ids.length);
  assert.deepEqual(pixels(project.run().outputs.ink),pixels(out.ink));
});
