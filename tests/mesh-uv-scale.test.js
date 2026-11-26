'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const atlas = [33,25];
const uv = (x,y)=>[x/32,y/24];
const close = (actual,expected)=>assert(actual?.every((n,i)=>Math.abs(n-expected[i])<1e-12),
  JSON.stringify({actual,expected}));
const plan = (doc,...operations)=>UV.plan(doc,{uvSet:'pigment',operations});
const scale = settings=>({op:'scale',domain:'faces',ids:['left','right'],...settings});
const evidence = result=>result.report.operations[0].evidence;
const point = (document,id)=>UV.inspect(document,'pigment').corners.find(row=>row.id===id).uv;
const ready = result=>assert(result.report.canCommit,JSON.stringify(result.report.operations));

function fixture() {
  const vertices = [
    ['a',0,0],['b',1,0],['c',1,1],['d',0,1],['e',2,0],['f',2,1]
  ].map(([id,x,y])=>({id,position:[x,y,0]}));
  const face = (id,ids,x)=>({id,material:'paint',corners:ids.map((vertex,i)=>({
    id:id+'/'+vertex,vertex,uv:[[0,1],[1,1],[1,0],[0,0]][i],
    attributes:{'uv/1':uv(...[[x,10],[x+8,10],[x+8,4],[x,4]][i])}
  }))});
  const doc = T.create({id:'two-plates',vertices,faces:[face('left',['a','b','c','d'],6),face('right',['b','e','f','c'],14)],
    uvBindings:{pigment:1}});
  const shared = UV.inspect(doc,'pigment').edges.find(row=>row.kind==='continuous').id;
  return {doc,shared};
}

test('scale independent axes about a fixed dedicated or explicit pivot',()=>{
  const {doc} = fixture();
  const selection = UV.select(doc,{domain:'faces',uvSet:'pigment',ids:['left','right']});
  const setup = {op:'set-pivot',target:{kind:'point',uv:uv(8,6)}};
  const edit = {op:'scale',selection,factor:[1.5,.5]};
  const combined = plan(doc,setup,edit), anchored = plan(doc,setup).document;
  ready(combined);
  const separate = plan(anchored,edit);
  assert.deepEqual(combined.document,separate.document);
  assert.equal(evidence(separate).pivotSource,'dedicated');
  assert.deepEqual(evidence(separate).pivots,[{uv:uv(8,6)}]);
  close(point(separate.document,'left/a'),uv(5,8));
  close(point(separate.document,'right/e'),uv(29,8));
  assert.deepEqual(separate.document.vertices,doc.vertices);
  assert.deepEqual(separate.document.uvPivots,anchored.uvPivots);
  assert.deepEqual(UV.inspect(separate.document,0).corners,UV.inspect(doc,0).corners);
  const explicit = plan(anchored,{...edit,pivot:uv(14,7),factor:.5,aspectLock:true});
  ready(explicit);
  assert.equal(evidence(explicit).pivotSource,'explicit');
  close(point(explicit.document,'left/a'),uv(10,8.5));
  assert.deepEqual(evidence(explicit).bounds[0].factors,[.5,.5]);
  assert.throws(()=>plan(doc,scale({factor:[.8,1],aspectLock:true})),/uniform scale factor/);
});

test('snap both bounds to exact texels and use a common compatible factor with aspect lock',()=>{
  const {doc} = fixture();
  const request = scale({ids:['left'],factor:1.75,snapBounds:true,atlas});
  const free = plan(doc,request), locked = plan(doc,{...request,aspectLock:true});
  ready(free);
  ready(locked);
  assert.deepEqual(evidence(free).bounds[0],{
    units:'texels',before:[6,4,14,10],requested:[3,1.75,17,12.25],factors:[1.75,5/3],applied:[3,2,17,12]
  });
  assert.deepEqual(evidence(locked).bounds[0].applied,[2,1,18,13]);
  assert.deepEqual(evidence(locked).bounds[0].factors,[2,2]);
  assert.deepEqual(point(locked.document,'left/a'),uv(2,13));
  assert.deepEqual(point(locked.document,'left/c'),uv(18,1));
  assert.deepEqual(point(free.document,'left/a'),uv(3,12));
  assert.deepEqual(point(free.document,'right/b'),point(doc,'right/b'));
  const tie = plan(doc,{...request,factor:1.125});
  ready(tie);
  assert.deepEqual(evidence(tie).bounds[0].factors,[1,1]);
  assert.deepEqual(tie.patch,{});
});

test('preserve a pinned pivot and journal a snapped scene edit with its affected bakes',()=>{
  const {doc} = fixture(), anchor = uv(14,10);
  const document = plan(doc,{op:'pin',ids:['left/b','right/b'],pinned:true},
    {op:'set-pivot',target:{kind:'pinned',corner:'left/b'}}).document;
  const scene = {id:'plates',style:'slate',solids:[],
    tilesets:{paint:ink.createBlankTileset({width:33,height:25,background:'#517f87'})},
    topologyMeshes:{plates:{document,materials:[{id:'paint',texture:{tileset:'paint'}}],
      bakes:[{id:'existing-bake',material:'paint',maps:{roughness:.5}}]}}};
  const editor = ink.createSceneEditor(scene);
  const request = {uvSet:'pigment',revision:T.revision(document),operations:[scale({factor:[.6,1.4],snapBounds:true})]};
  const result = editor.planMeshUV('plates',request);
  ready(result);
  assert.deepEqual(evidence(result).pivots,[{uv:anchor,atlas}]);
  assert.deepEqual(evidence(result).bounds[0].applied,[9,2,19,10]);
  assert.deepEqual(evidence(result).bounds[0].factors,[.625,4/3]);
  assert.deepEqual(point(result.document,'left/b'),anchor);
  assert.deepEqual(point(result.document,'right/b'),anchor);
  assert.deepEqual(evidence(result).edgeChanges,[]);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(editor.editMeshUV('plates',request).uv,result.report);
  assert.deepEqual(editor.snapshot().topologyMeshes.plates.bakes[0].invalidated.faces,['left','right']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('plates').document,result.document);
  assert.throws(()=>editor.planMeshUV('plates',request),/different topology revision/);
});

test('per-face scaling reports UV seam changes and refuses an impossible snapped edit atomically',()=>{
  const {doc,shared} = fixture();
  const perFace = plan(doc,scale({mode:'per-face',factor:.5,aspectLock:true,snapBounds:true,atlas}));
  ready(perFace);
  assert.deepEqual(evidence(perFace).pivots,[
    {face:'left',uv:uv(10,7),atlas},{face:'right',uv:uv(18,7),atlas}
  ]);
  assert.deepEqual(evidence(perFace).bounds.map(row=>row.applied),[[6,4,14,10],[14,4,22,10]]);
  const separate = plan(doc,scale({mode:'per-face',factor:.5}));
  ready(separate);
  assert.deepEqual(evidence(separate).edgeChanges,[{edge:shared,before:'continuous',after:'seam'}]);
  const shifted = {op:'nudge',ids:['left'],steps:[1,0],increment:.5,atlas};
  const impossible = plan(doc,shifted,scale({ids:['left'],factor:1.5,pivot:uv(6.5,7),snapBounds:true,atlas}));
  assert.equal(impossible.report.operations[1].conflicts[0].code,'incompatible-snapped-bounds');
  assert.deepEqual(impossible.patch,{});
  assert.deepEqual(impossible.document,doc);
  const pin = plan(doc,{op:'pin',ids:['left/a'],pinned:true}).document;
  assert(plan(pin,scale({factor:.5})).report.operations[0].conflicts.some(row=>row.code==='pinned-corner'));
  assert(plan(doc,scale({factor:8})).report.operations[0].conflicts.some(row=>row.code==='outside-atlas'));
  assert.throws(()=>plan(doc,scale({factor:1,snapBounds:true})),/atlas dimensions/);
});
