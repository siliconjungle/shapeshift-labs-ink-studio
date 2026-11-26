'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;

function fixture() {
  const left = [[.2,.45],[.4,.45],[.4,.25],[.2,.25]], right = [[.6,.75],[.8,.75],[.8,.55],[.6,.55]];
  const vertices = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[3,0,0],[3,1,0],[2,1,0]]
    .map((position,i)=>({id:'v'+i,position}));
  const faces = [['left',left],['right',right]].map(([id,points],i)=>({
    id,material:'paint',corners:points.map((uv,j)=>({
      id:id+'/'+j,vertex:'v'+(i*4+j),uv,attributes:{'uv/1':uv.map(n=>n*.5+.25)},
      ...(i===0 && j===0 && {uvPins:{1:true}})
    }))
  }));
  return T.create({id:'tiles',vertices,faces,uvBindings:{pigment:1}});
}
const set = target=>({op:'set-pivot',target});
const plan = (doc,...operations)=>UV.plan(doc,{revision:T.revision(doc),operations});
const of = (doc,id,uvSet=0)=>UV.inspect(doc,uvSet).corners.find(row=>row.id===id).uv;
const close = (value,expected)=>value.forEach((n,i)=>assert(Math.abs(n-expected[i])<1e-12,JSON.stringify(value)));

test('selection center is a shared retained pivot and keeps saved geometry selections usable',()=>{
  const doc = fixture(), selection = UV.select(doc,{domain:'islands',ids:['left','right']});
  const setup = set({kind:'selection-center',selection}), placement = plan(doc,setup);
  assert(placement.report.canCommit);
  assert.deepEqual(placement.report.pivot,{before:null,after:[.5,.5]});
  assert.deepEqual(placement.patch,{uvPivots:{0:[.5,.5]}});
  assert.deepEqual(placement.report.corners,[]);
  assert.deepEqual(placement.document.faces,doc.faces);
  assert.deepEqual(placement.document.vertices,doc.vertices);
  assert.equal(T.revision(placement.document),T.revision(doc));
  assert.deepEqual(UV.select(placement.document,{domain:'islands',from:selection}),selection);
  assert.deepEqual(T.edit(doc,placement.patch),placement.document);
  assert.deepEqual(UV.inspect(JSON.parse(JSON.stringify(placement.document))).pivot,[.5,.5]);

  const transform = {op:'transform',selection,scale:.5};
  const combined = plan(doc,setup,transform), separate = plan(placement.document,transform);
  assert(combined.report.canCommit);
  assert.deepEqual(combined.document,separate.document);
  assert.deepEqual(combined.report.operations.at(-1).evidence,{pivotSource:'dedicated',
    pivots:[{island:'left',uv:[.5,.5]},{island:'right',uv:[.5,.5]}]});
  close(of(combined.document,'left/0'),[.35,.475]);
  close(of(combined.document,'right/0'),[.55,.625]);
  const override = plan(placement.document,{...transform,pivot:[.25,.25]});
  assert.equal(override.report.operations[0].evidence.pivotSource,'explicit');
  close(of(override.document,'left/0'),[.225,.35]);
  assert.deepEqual(override.document.uvPivots,{0:[.5,.5]});
  assert.deepEqual(plan(placement.document,set(null)).document,doc);
});

test('pins and snapped picks resolve on the selected UV layout',()=>{
  const doc = fixture(), chosen = UV.select(doc,{domain:'corners',uvSet:'pigment',
    atlas:{at:of(doc,'left/0',1),face:'left'}});
  const pin = set({kind:'pinned',selection:chosen});
  const pigment = (...operations)=>UV.plan(doc,{uvSet:'pigment',operations});
  const pinned = pigment(pin,{op:'transform',ids:['left'],rotation:.18});
  assert(pinned.report.canCommit);
  assert.deepEqual(pinned.report.operations[0].evidence.target,{kind:'pinned',corner:'left/0',face:'left',pinned:true});
  assert.deepEqual(of(pinned.document,'left/0',1),of(doc,'left/0',1));
  assert.equal(UV.inspect(pinned.document).pivot,undefined);
  assert.deepEqual(UV.inspect(pinned.document,'pigment').pivot,of(doc,'left/0',1));
  assert.throws(()=>plan(doc,set({kind:'pinned',corner:'left/0'})),/pinned on this UV layout/);
  assert.throws(()=>plan(doc,set({kind:'corner',selection:chosen})),/mesh revision and domain/);

  const snapped = plan(doc,set({kind:'corner',corner:'right/3'}));
  assert.deepEqual(snapped.document.uvPivots,{0:of(doc,'right/3')});
  assert.deepEqual(snapped.report.operations[0].evidence.target,{kind:'corner',corner:'right/3',face:'right',pinned:false});
  const rejected = pigment(pin,{op:'transform',ids:['left'],translate:[.01,0]});
  assert(!rejected.report.canCommit);
  assert.deepEqual(rejected.patch,{});
  assert.deepEqual(rejected.document,doc);
  assert.throws(()=>T.create({...doc,uvPivots:{32:[0,1]}}),/layouts 0 to 31/);
});

test('place and clear scene pivots with one journal entry and keep material bakes valid',()=>{
  const doc = fixture(), scene = {id:'painted-tiles',style:'slate',solids:[],topologyMeshes:{tiles:{
    document:doc,bakes:[{id:'paint-bake',material:'paint',maps:{roughness:.5}}]}}};
  const editor = ink.createSceneEditor(scene);
  const move = editor.editMeshUV('tiles',{operations:[set({kind:'corner',corner:'right/0'})]});
  assert.deepEqual(move.topology.uvPivots,[{uvSet:0,before:null,after:[.6,.75]}]);
  assert.deepEqual(move.topology.bakes,[]);
  editor.editMeshUV('tiles',{uvSet:'pigment',operations:[set({kind:'pinned',corner:'left/0'})]});
  const placed = editor.snapshot(), alternate = of(doc,'left/0',1);
  assert.deepEqual(editor.meshTopology('tiles').document.uvPivots,{0:[.6,.75],1:alternate});
  editor.editMeshUV('tiles',{operations:[set(null)]});
  assert.deepEqual(editor.meshTopology('tiles').document.uvPivots,{1:alternate});
  assert.equal(editor.inspectMeshUV('tiles').pivot,undefined);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),placed);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('tiles').document.uvPivots,{1:alternate});
  editor.editMeshUV('tiles',{uvSet:'pigment',operations:[set(null)]});
  assert.equal(editor.meshTopology('tiles').document.uvPivots,undefined);
  assert.deepEqual(editor.snapshot(),scene);
});
