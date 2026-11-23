const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..');
const {KIT} = ink.load();
const {rasterWarp:warp} = KIT.procedural;

const at = (r,x,y) => {
  const index = (y*r.width+x)*r.channels;
  return Array.from(r.data.subarray(index,index+r.channels));
};
const near = (actual,expected) => assert(Math.abs(actual-expected)<1e-6,`${actual} differs from ${expected}`);
const straight = [[1.5,3.5],[7.5,3.5]];

test('Curve map emits normalized UV and signed pixel coordinates on the same strip',()=>{
  const map=warp.curveMap(straight,{width:10,height:8,strokeWidth:4,caps:'butt'});
  assert.equal(map.length,6);
  assert.deepEqual(at(map.along,4,4),[3]);
  assert.deepEqual(at(map.across,4,4),[1]);
  assert.deepEqual(at(map.across,4,2),[-1]);
  assert.deepEqual(at(map.tangent,4,4),[1,0]);
  assert.deepEqual(at(map.value,4,4),[.5,.75,1]);
  assert.deepEqual(at(map.coverage,4,4),[1]);
  assert.deepEqual(at(map.segment,4,4),[0]);
  assert.deepEqual(at(map.value,4,0),[0,0,0]);
  assert.deepEqual(at(map.segment,4,0),[-1]);
  assert.deepEqual(at(map.coverage,0,3),[0]);

  const reverse=warp.curveMap(straight.slice().reverse(),{width:10,height:8,strokeWidth:4});
  assert.deepEqual(at(reverse.across,4,4),[-1]);
  assert.deepEqual(at(reverse.tangent,4,4),[-1,0]);
  assert.deepEqual(at(reverse.value,4,4),[.5,.25,1]);
});

test('Curve map handles tapered widths, feathering, rounded ends and elbows',()=>{
  const map=warp.curveMap(straight,{width:10,height:8,strokeWidth:[2,6],feather:1});
  near(at(map.value,4,4)[1],.75);
  near(at(map.coverage,4,5)[0],.5);
  assert.deepEqual(at(map.value,0,3),[0,.5,.5]);
  assert.deepEqual(at(map.value,8,3),[1,.5,1]);
  const point=warp.curveMap(straight,{width:10,height:8,strokeWidth:[0,4],caps:'butt'});
  assert.deepEqual(at(point.coverage,1,3),[0]);
  assert.deepEqual(at(point.coverage,5,4),[1]);
  const corner=warp.curveMap([[1.5,4.5],[5.5,4.5],[5.5,1.5]],{width:9,height:8,strokeWidth:4,caps:'butt'});
  assert.deepEqual(at(corner.segment,6,5),[1]);
  assert.deepEqual(at(corner.along,6,5),[4]);
  assert.deepEqual(at(corner.tangent,6,5),[0,-1]);
  assert.deepEqual(at(corner.coverage,7,6),[0]);
});

test('Crossing policies select coherent addresses, tangents, and coverage',()=>{
  const path=[[1.5,1.5],[7.5,7.5],[1.5,7.5],[7.5,1.5]];
  const settings={width:10,height:10,strokeWidth:3,feather:1};
  const first=warp.curveMap(path,{...settings,overlap:'first'});
  const last=warp.curveMap(path,{...settings,overlap:'last'});
  const nearest=warp.curveMap(path,settings);
  assert.deepEqual(at(first.segment,4,4),[0]);
  assert.deepEqual(at(last.segment,4,4),[2]);
  assert.deepEqual(at(nearest.value,4,4),at(first.value,4,4));
  assert.deepEqual(at(first.segment,5,3),[0]);
  assert.deepEqual(at(nearest.segment,5,3),[2]);
  assert(at(first.tangent,4,4)[1]>0);
  assert(at(last.tangent,4,4)[1]<0);
  assert(at(last.along,4,4)[0]>at(first.along,4,4)[0]);
  assert.equal(at(last.value,4,4)[2],at(last.coverage,4,4)[0]);
  assert.deepEqual(at(last.value,2,2),at(first.value,2,2));
  assert.deepEqual(last.coverage.data,first.coverage.data);
  const thin=warp.curveMap(path,{...settings,strokeWidth:2,feather:2,overlap:'last'});
  assert.deepEqual(at(thin.segment,5,5),[0]);
  assert.deepEqual(at(thin.value,5,5).slice(2),[1]);
  assert.deepEqual(at(last.segment,5,5),[2]);
  assert.deepEqual(at(last.coverage,5,5),[1]);
});

test('A closed screen projection preserves its seam, stable segment IDs, and bounded work',()=>{
  const square={closed:true,points:[[2.5,2.5,4],[6.5,2.5,9],[6.5,6.5,9],[2.5,6.5,4],[2.5,2.5,4]]};
  const map=warp.curveMap(square,{width:10,height:10,strokeWidth:[2,2,2,2,2],caps:'butt'});
  assert.equal(map.length,16);
  assert.deepEqual(at(map.segment,2,4),[3]);
  assert.deepEqual(at(map.tangent,2,4),[0,-1]);
  assert.deepEqual(at(map.along,2,4),[14]);
  assert.deepEqual(at(map.segment,2,2),[0]);
  assert.throws(()=>warp.curveMap(square,{width:10,height:10,strokeWidth:[2,2,2,2,3]}),/matching widths/);
  assert.throws(()=>warp.curveMap([[2,2],[2,2]],{width:10,height:10}),/nonzero segments/);
  assert.throws(()=>warp.curveMap(straight,{width:1025,height:1024}),/Invalid curve map grid/);
  const dense=Array.from({length:60},(_,i)=>[i%2?1024:0,i%2?1024:0]);
  assert.throws(()=>warp.curveMap(dense,{width:1024,height:1024}),/work budget/);
});

test('The stock graph maps a generated path into warp.sample and exposes all aligned planes',async()=>{
  const pixels={width:2,height:2,channels:4,data:[180,60,20,255,20,100,180,255,255,220,99,255,62,230,154,255]};
  const project=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    path:{op:'proc.path',inputs:{points:straight,options:{mode:'linear'}}},
    map:{op:'warp.curveMap',inputs:{path:{node:'path'},width:10,height:8,options:{strokeWidth:4,caps:'butt'}}},
    image:{op:'warp.sample',inputs:{source:pixels,field:{node:'map'},options:{filter:'nearest'}}}
  },outputs:{
    color:{node:'image'},
    ...Object.fromEntries(['along','across','tangent','coverage','segment','length'].map(port=>[port,{node:'map',port}]))
  }});
  const results=await project.previewFrame({frame:{output:'color'}},{time:.6});
  assert.deepEqual(at(results.values.frame,4,4),[62,230,154,255]);
  assert.deepEqual(at(results.values.frame,4,0),[0,0,0,0]);
  assert.equal(results.outputs.length,6);
  assert.deepEqual(at(results.outputs.tangent,4,4),[1,0]);
  project.clear();
});
