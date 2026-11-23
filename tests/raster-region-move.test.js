const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..');
const {KIT} = ink.load();
const {pixelEffects, generator} = KIT.procedural;
const move = pixelEffects.moveRegions;

const red=[240,24,8,255], blue=[12,70,220,255], gray=[72,89,95,255], empty=[0,0,0,0];
const raster=(width,height,channels,data)=>({width,height,channels,data});
const row=(...pixels)=>raster(pixels.length,1,4,pixels.flat());
const ids=(...values)=>raster(values.length,1,1,values);
const at=(image,x,y=0)=>{
  const i=(y*image.width+x)*image.channels;
  return Array.from(image.data.slice(i,i+image.channels));
};

test('Integer motion carries exact paint and sparse IDs, clips the viewport, and reports only lost coverage',()=>{
  const key=4294967295;
  const source={...row(red,blue,empty,gray,gray),pivot:[2.5,1]};
  const labels=ids(key,key,key,0,5);
  const result=move(source,labels,[{id:key,offset:[2,0],depth:-1},{id:5,offset:[4,0]}]);
  assert.deepEqual(Array.from(result.value.data),[...empty,...empty,...red,...blue,...empty]);
  assert.deepEqual(Array.from(result.labels.data),[0,0,key,key,0]);
  assert.deepEqual(Array.from(result.gaps.data),[255,255,0,0,255]);
  assert.deepEqual(result.value.pivot,[2.5,1]);
  assert.deepEqual(source.data,[...red,...blue,...empty,...gray,...gray]);
  assert.deepEqual(labels.data,[key,key,key,0,5]);
  assert.deepEqual(at(move(source,labels).value,3),gray);
  assert.deepEqual(at(move(source,labels,[],{keepUnlabeled:false}).value,3),empty);
});

test('Depth, transparency and equal-depth IDs give deterministic overlap independent of transform order',()=>{
  const source=row(red,blue,gray);
  const labels=ids(8,3,0);
  const front={id:8,offset:[1,0],depth:-2,opacity:.5};
  const fixed={id:3,depth:2};
  const result=move(source,labels,[front,fixed]);
  assert.deepEqual(at(result.value,1),[126,47,114,255]);
  assert.deepEqual(at(result.labels,1),[8]);
  assert.deepEqual(at(result.gaps,1),[0]);
  assert.deepEqual(at(move(source,labels,[fixed,front]).value,1),at(result.value,1));
  assert.deepEqual(at(move(source,labels,[{...front,depth:2},fixed]).labels,1),[8]);
  assert.deepEqual(at(move(source,labels,[{...front,depth:3},fixed]).value,1),blue);
  assert.deepEqual(at(move(source,labels,[{...front,opacity:0},fixed]).labels,1),[3]);
});

test('Rotation, scaling and reflection use source-art pixel pivots and preserve disconnected membership',()=>{
  const pixels=Array.from({length:25},()=>empty);
  const labels=Array(25).fill(-1);
  for (const [at,ink] of [[11,red],[13,blue]]) {pixels[at]=ink;labels[at]=0;}
  const source=raster(5,5,4,pixels.flat()), map=raster(5,5,1,labels);
  const rotated=move(source,map,[{id:0,angle:Math.PI/2}],{background:-1});
  assert.deepEqual(at(rotated.value,2,1),red);
  assert.deepEqual(at(rotated.value,2,3),blue);
  assert.deepEqual(at(rotated.labels,2,2),[-1]);
  assert.deepEqual(at(rotated.gaps,3,2),[255]);
  const flipped=move(source,map,[{id:0,pivot:[2.5,2.5],scale:[-1,1]}],{background:-1});
  assert.deepEqual(at(flipped.value,1,2),blue);
  assert.deepEqual(at(flipped.value,3,2),red);
  const enlarged=move(source,map,[{id:0,pivot:[2.5,2.5],scale:[2,1]}],{background:-1});
  assert.deepEqual(at(enlarged.value,0,2),red);
  assert.deepEqual(at(enlarged.value,4,2),blue);
  assert.deepEqual(at(enlarged.value,2,2),empty);
});

test('Linear samples stay inside each label, handle fractional alpha, and never report preexisting holes',()=>{
  const result=move(row(red,blue,empty,empty),ids(1,2,1,0),[{id:1,offset:[.5,0],depth:-1},{id:2,offset:[8,0]}],{filter:'linear'});
  assert.deepEqual(at(result.value,0),[...red.slice(0,3),128]);
  assert.deepEqual(at(result.value,1),[...red.slice(0,3),128]);
  assert.deepEqual(Array.from(result.labels.data),[1,1,0,0]);
  assert.deepEqual(Array.from(result.gaps.data),[127,127,0,0]);
  const partial=move(row([30,200,150,120],empty),ids(1,0),[{id:1,opacity:.25}]);
  assert.deepEqual(at(partial.value,0),[30,200,150,30]);
  assert.deepEqual(at(partial.gaps,0),[90]);
});

test('Invalid label grids, IDs, singular transforms and excessive resampling fail early',()=>{
  const source=row(red,blue);
  assert.throws(()=>move(source,ids(1)),/aligned/);
  assert.throws(()=>move(source,raster(2,1,2,[1,0,2,0])),/one-channel/);
  assert.throws(()=>move(source,ids(1,.5)),/integer IDs/);
  assert.throws(()=>move(source,ids(1,2),[{id:1},{id:1}]),/unique/);
  assert.throws(()=>move(source,ids(1,2),[{id:0}]),/background ID/);
  assert.throws(()=>move(source,ids(1,2),[{id:1,scale:0}]),/scale/);
  assert.deepEqual(at(move(source,ids(1,2),[{id:9,offset:[1,1]}]).value,0),red);
  const size=512, labels=new Uint16Array(size*size), transforms=[];
  for (let id=1;id<=160;id++) {
    labels[id*size]=id;
    labels[(size-id)*size-1]=id;
    transforms.push({id,angle:.06});
  }
  const white=raster(size,size,1,new Uint8Array(size*size).fill(255));
  assert.throws(()=>move(white,raster(size,size,1,labels),transforms,{filter:'linear'}),/sample budget/);
});

test('Stock movement composes with tracked regions and numeric Voronoi labels',async()=>{
  const frames=[row(empty,red,empty,empty),row(empty,empty,red,empty)];
  const project=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    tracker:{op:'fx.trackRegions',inputs:{frames,options:{fps:1,minArea:1}}},
    shift:{op:'fx.moveRegions',inputs:{source:frames[1],labels:{node:'tracker',port:'labels'},transforms:[{id:1,offset:[1,0]}]}}
  },outputs:{value:{node:'shift'},labels:{node:'shift',port:'labels'},gaps:{node:'shift',port:'gaps'}}});
  const preview=await project.previewFrame({image:{output:'value'}},{time:1});
  assert.deepEqual(at(preview.values.image,3),red);
  assert.deepEqual(Array.from(preview.outputs.labels.data),[0,0,0,1]);
  assert.deepEqual(Array.from(preview.outputs.gaps.data),[0,0,255,0]);
  project.clear();
  const cells=generator.cellEdges({width:7,height:5,spacing:3,seed:9}).index;
  const input=raster(7,5,1,new Uint8Array(35).fill(155));
  assert.deepEqual(move(input,cells).labels.data,cells.data);
});
