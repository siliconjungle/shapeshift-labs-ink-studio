'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), {KIT:K} = ink.load(), T = K.meshTopology;
const change = (doc,fields)=>T.planShading(doc,{id:'tiles',revision:T.revision(doc),...fields});

function tiles() {
  const points = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[1.8,0,.55],[1.8,1,.55],[2.13,0,.95],[2.13,1,.95]];
  const vertices = points.map((position,i)=>({id:'v'+i,position}));
  const faces = [[0,1,2,3],[1,4,5,2],[4,6,7,5]].map((ring,i)=>({
    id:'tile-'+i,material:i===2 ? 'rim' : 'body',corners:ring.map((vertex,j)=>({
      id:i+'/c'+j,vertex:'v'+vertex,uv:[[0,1],[1,1],[1,0],[0,0]][j]
    }))
  }));
  return T.create({id:'tile-panel',vertices,faces,edges:[{id:'body-join',vertices:['v1','v2']},
    {id:'rim-join',vertices:['v4','v5']} ]});
}

test('matching groups smooth across UV islands and different groups hold a hard join',()=>{
  const doc = tiles(), firstTwo = T.select(doc,{domain:'faces',ids:['tile-0','tile-1']});
  const plan = change(doc,{groups:[{group:'body',selection:firstTwo},{group:0,faces:['tile-2']}],
    edges:[{id:'rim-join',smooth:true}]});
  assert.deepEqual(plan.report.groups,[{face:'tile-0',before:null,after:'body'},{face:'tile-1',before:null,after:'body'},
    {face:'tile-2',before:null,after:0}]);
  assert.equal(T.revision(T.edit(doc,plan.patch)),plan.report.afterRevision);
  const shape = plan.document, {groups,edges,faces} = T.inspectShading(shape);
  assert.deepEqual(groups,[{group:'body',faces:['tile-0','tile-1']},{group:0,faces:['tile-2']}]);
  assert.equal(edges.find(edge=>edge.id==='body-join').rule,'smooth-group');
  assert.equal(edges.find(edge=>edge.id==='rim-join').rule,'group-boundary');
  assert.deepEqual(faces[0].corners[1].shading,faces[1].corners[0].shading);
  assert.notDeepEqual(faces[0].corners[1].shading,faces[0].geometric);
  assert.deepEqual(faces[1].corners[1].shading,faces[1].geometric);
  assert.deepEqual(faces[2].corners[0].shading,faces[2].geometric);
  assert.deepEqual(T.select(shape,{domain:'faces',filter:{smoothingGroups:[0]}}).ids,['tile-2']);
  assert.deepEqual(T.select(shape,{domain:'faces',filter:{smoothingGroups:['body']}}).ids,firstTwo.ids);
  assert(T.triangulate(shape).normals.length>0);
  assert(K.model.fromTopology(shape).cornerNormals.length>0);
  assert.throws(()=>change(shape,{groups:[{group:'old',selection:firstTwo}]}),/same topology revision/);
  assert.throws(()=>change(shape,{groups:[{group:-1,faces:['tile-0']}]}),/smoothing group/);
  assert.throws(()=>change(shape,{groups:[{group:'first',faces:['tile-0']},{group:'second',faces:['tile-0']}]}),/once per face/);
  const cleared = change(shape,{groups:[{group:null,faces:['tile-0','tile-1','tile-2']}],edges:[{id:'rim-join',smooth:null}]}).document;
  assert.deepEqual(cleared,doc);
});

test('hard edges, fully creased edges, and authored UV seams stop grouped smoothing',()=>{
  const doc = change(tiles(),{groups:[{group:'shell',faces:['tile-0','tile-1','tile-2']}]}).document;
  for (const [settings,rule] of [[{smooth:false},'hard-edge'],[{crease:1},'crease'],
    [{uvSeam:true},'uv-seam'],[{uvSeams:{1:true}},'uv-seam']]) {
    const shape = T.edit(doc,{edges:[{id:'body-join',...settings}]});
    const {edges,faces} = T.inspectShading(shape);
    assert.equal(edges.find(edge=>edge.id==='body-join').rule,rule);
    assert.deepEqual(faces[0].corners[1].shading,faces[0].geometric);
    assert.deepEqual(faces[1].corners[0].shading,faces[1].geometric);
    assert.notDeepEqual(faces[1].corners[1].shading,faces[1].geometric);
  }
  const joinedAtTip = T.edit(doc,{faces:[{id:'tip',smoothingGroup:'shell',corners:[
    {id:'tip/0',vertex:'v0'},{id:'tip/1',vertex:'v7'},{id:'tip/2',vertex:'v6'}]}]});
  const original = T.inspectShading(joinedAtTip).faces[0];
  assert.deepEqual(original.corners[0].shading,original.geometric);
});

test('groups follow child faces and keep scene bindings and material bakes through undo',()=>{
  const doc = tiles(), scene = {id:'painted-parts',style:'slate',solids:[],topologyMeshes:{panel:{
    document:doc,bindings:[{id:'paint',domain:'faces',element:'tile-0'}],
    bakes:[{id:'body-bake',material:'body',maps:{roughness:.45}}]}}};
  const editor = ink.createSceneEditor(scene);
  const req = {id:'shell',revision:T.revision(doc),groups:[{group:'shell',faces:['tile-0','tile-1']}]};
  const result = editor.editMeshShading('panel',req);
  assert.equal(result.topology.faces.length,2);
  assert.deepEqual(result.topology.bindings,[]);
  assert.deepEqual(result.topology.bakes,[]);
  const grouped = editor.snapshot();
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),grouped);

  const mesh = editor.meshTopology('panel').document;
  const grid = T.planEdgeEdit(mesh,{id:'split-tile',revision:T.revision(mesh),
    operation:{kind:'subdivide-face',face:'tile-0',rows:2,columns:2}});
  assert(grid.report.canCommit);
  for (const id of grid.report.detail.children)
    assert.equal(grid.document.faces.find(face=>face.id===id).smoothingGroup,'shell');
  const split = T.planRepair(mesh,{revision:T.revision(mesh),operations:[{kind:'split-quad',faces:['tile-0']}]});
  assert(split.report.canCommit);
  assert.equal(split.document.faces.filter(face=>face.smoothingGroup==='shell').length,3);
  const refined = T.subdivide(T.edit(mesh,{edges:[{id:'body-join',uvSeams:{1:true}}]}),{levels:1});
  assert.equal(refined.faces.filter(face=>face.smoothingGroup==='shell').length,8);
  assert.equal(refined.edges.filter(edge=>edge.uvSeams?.[1]).length,2);
});
