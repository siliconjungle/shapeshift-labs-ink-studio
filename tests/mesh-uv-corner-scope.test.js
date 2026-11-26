'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;

function fixture() {
  const points = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0],
    [0,2,0],[1,2,0],[1,3,0],[0,3,0],[2,2,0],[3,2,0],[3,3,0],[2,3,0]];
  const vertices = points.map((position,i)=>({id:'v'+i,position}));
  const p = [[.2,.75],[.5,.75],[.5,.3],[.2,.3]], q = [[.5,.75],[.8,.75],[.8,.3],[.5,.3]];
  const face = (id,ring,uv,material='paint')=>({id,material,corners:ring.map((vertex,i)=>({
    id:id+'/'+i,vertex:'v'+vertex,uv:[i%2,Number(i<2)],attributes:{'uv/1':uv[i]}
  }))});
  const faces = [face('front',[0,1,2,3],p),face('wing',[1,4,5,2],q),
    face('stack',[6,7,8,9],p),face('other-sheet',[10,11,12,13],p,'trim')];
  return T.create({id:'painted-tiles',vertices,faces,uvBindings:{pigment:1},
    edges:[{id:'hinge',vertices:['v1','v2']}]});
}

const op = (scope,fields={})=>({op:'move-corners',ids:['front/1'],scope,...fields});
const plan = (doc,...operations)=>UV.plan(doc,{revision:T.revision(doc),uvSet:'pigment',operations});
const moveEvidence = result=>result.report.operations.at(-1).evidence;
const movers = result=>moveEvidence(result).moving.map(row=>row.id);
const holders = result=>moveEvidence(result).held.map(row=>row.id);

test('inspect a stacked corner scope and move just one side or the whole cohort',()=>{
  const doc = fixture();
  const selection = UV.select(doc,{domain:'corners',uvSet:'pigment',atlas:{at:[.5,.75],face:'front'}});
  const together = {...op('together'),selection};
  delete together.ids;
  const inspect = plan(doc,together);
  assert(inspect.report.canCommit);
  assert.deepEqual(inspect.patch,{});
  assert.deepEqual(movers(inspect),['front/1','stack/1','wing/0']);
  assert.deepEqual(holders(inspect),[]);
  assert(moveEvidence(inspect).moving.every(row=>row.material==='paint' && row.uv[0]===.5 && row.uv[1]===.75));

  for (const scope of ['together','independent']) {
    const result = plan(doc,op(scope,{translate:[.0625,-.0625]}));
    assert(result.report.canCommit,JSON.stringify(result.report.operations));
    assert.deepEqual(result.document.vertices,doc.vertices);
    assert.deepEqual(result.document.faces.map(face=>face.corners.map(corner=>corner.uv)),
      doc.faces.map(face=>face.corners.map(corner=>corner.uv)));
    assert.deepEqual(result.report.corners.map(row=>row.id).sort(),
      scope==='together' ? ['front/1','stack/1','wing/0'] : ['front/1']);
    assert(result.report.corners.every(row=>row.after[0]===.5625 && row.after[1]===.6875));
    assert.deepEqual(holders(result),scope==='independent' ? ['stack/1','wing/0'] : []);
    assert.deepEqual(moveEvidence(result).edgeChanges,
      scope==='independent' ? [{edge:'hinge',before:'continuous',after:'seam'}] : []);
    assert.deepEqual(T.edit(doc,result.patch),result.document);
  }
});

test('pins and invalid UVs block the requested move without losing scope evidence',()=>{
  const doc = fixture(), pinned = plan(doc,{op:'pin',ids:['stack/1'],pinned:true}).document;
  const blocked = plan(pinned,op('together',{translate:[.05,0]}));
  assert(!blocked.report.canCommit);
  assert.deepEqual(blocked.document,pinned);
  assert.deepEqual(blocked.patch,{});
  assert.equal(blocked.report.operations[0].conflicts[0].corner,'stack/1');
  assert(moveEvidence(blocked).moving.find(row=>row.id==='stack/1').pinned);
  const single = plan(pinned,op('independent',{translate:[.05,0]}));
  assert(single.report.canCommit);
  assert(moveEvidence(single).held.find(row=>row.id==='stack/1').pinned);

  const outside = plan(doc,op('independent',{translate:[.75,0]}));
  assert(outside.report.operations[0].conflicts.some(row=>row.code==='outside-atlas'));
  assert.deepEqual(outside.document,doc);
  const flipped = plan(doc,op('independent',{translate:[-.35,-.5]}));
  assert(flipped.report.operations[0].conflicts.some(row=>row.code==='flipped-uv-triangle'));
  assert.deepEqual(flipped.document,doc);
  assert.throws(()=>plan(doc,{op:'move-corners',ids:['front/1'],translate:[0,.1]}),/scope/);
});

test('scene corner edits journal only the moved face and invalidate its affected bake',()=>{
  const doc = fixture(), scene = {id:'tiles',style:'slate',solids:[],topologyMeshes:{panel:{document:doc,
    bakes:[{id:'paint-bake',material:'paint',maps:{roughness:.4}},{id:'trim-bake',material:'trim',maps:{roughness:.65}}]}}};
  const editor = ink.createSceneEditor(scene), before = editor.snapshot();
  const request = {revision:T.revision(doc),uvSet:'pigment',operations:[op('independent',{translate:[.05,0]})]};
  const planned = editor.planMeshUV('panel',request), edited = editor.editMeshUV('panel',request);
  assert.deepEqual(edited.uv,planned.report);
  assert.deepEqual(editor.meshTopology('panel').bakes[0].invalidated.faces,['front']);
  assert.equal(editor.meshTopology('panel').bakes[1].invalidated,undefined);
  const after = editor.snapshot();
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});
