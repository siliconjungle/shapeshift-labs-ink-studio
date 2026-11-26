'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..');
const T = ink.load().KIT.meshTopology;

function fixture() {
  const scene = {id:'stonework',style:'slate',solids:[],tilesets:{
    brick:ink.createBlankTileset({width:21,height:21,background:'#bca680'}),
    stone:ink.createBlankTileset({width:21,height:21,background:'#686c78'})
  }};
  const crop = (tileset,x,y,width,height)=>ink.pickTilesetRectangle(scene,tileset,{x,y,width,height});
  const editor = ink.createSceneEditor(scene);
  const pick = crop('brick',4,4,13,13);
  editor.placeTilesetFace({object:'panel',face:'front',selection:pick,worldSize:[2,1]});
  const current = editor.meshTopology('panel').document;
  editor.editMeshTopology('panel',{uvBindings:{pigment:1,bake:2},faces:current.faces.map(face=>({...face,
    corners:face.corners.map(corner=>({...corner,attributes:{'uv/1':corner.uv,
      'uv/2':corner.uv.map(n=>.3+.3*n),tint:.5}}))}))});
  const doc = editor.meshTopology('panel').document;
  const edge = T.inspect(doc).edges.find(row=>row.vertices.every(id=>['front/v2','front/v3'].includes(id))).id;
  const request = {id:'depth',revision:T.revision(doc)};
  const region = rim=>({...request,selection:T.select(doc,{domain:'faces',ids:['front']}),
    operation:{kind:'extrude',normals:'face',distance:.25},rim});
  const strip = rules=>({...request,operation:{kind:'extrude-edge',edge,direction:'face',distance:.25,...rules}});
  return {editor,doc,edge,pick,region,strip,brush:{selection:crop('stone',1,2,8,6),paint:{rotation:90},
    uvInset:{left:1,top:1,right:0,bottom:0}}};
}

test('continued UVs unfold over a right angle at source texel density',()=>{
  const {doc,edge,region,strip} = fixture();
  const original = doc.faces[0];
  for (const [kind,plan] of [
    ['source-edge',T.planEdgeEdit(doc,strip({uv:'extend'}))],
    ['cap',T.planFaceRegion(doc,region({uv:'extend'}))]
  ]) {
    assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
    const review = plan.report.sidewallUVs ?? plan.report.detail.sidewallUVs;
    assert.deepEqual(review.sets,[0,1,2]);
    const entry = review.faces.find(row=>row.edge===edge);
    const wall = plan.document.faces.find(row=>row.id===entry.face);
    assert.equal(entry.seam,kind);
    assert.equal(wall.material,original.material);
    const join = kind === 'cap' ? wall.corners.slice(2).reverse() : wall.corners.slice(0,2);
    const other = kind === 'cap' ? wall.corners.slice(0,2) : wall.corners.slice(2).reverse();
    for (const [i,corner] of join.entries()) {
      const adjacent = plan.document.faces[0].corners.find(row=>row.vertex===corner.vertex);
      assert.equal(adjacent.uv[1],.2);
      assert.deepEqual(corner.uv,adjacent.uv);
      assert.deepEqual(corner.attributes,adjacent.attributes);
      assert(Math.abs(other[i].uv[1]-.05)<1e-9);
      assert.equal(other[i].uv[0],corner.uv[0]);
      assert(Math.abs(other[i].attributes['uv/2'][1]-.315)<1e-9);
    }
    assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  }
});

test('a separate brush registers the chosen crop in the pigment layout and undoes with geometry',()=>{
  const {doc,editor,pick,region,strip,brush} = fixture();
  const start = editor.snapshot(), rules = {uv:'brush',brush,material:'tunnel'};
  assert.throws(()=>T.planEdgeEdit(doc,strip(rules)),/retained scene/);
  for (const [planMethod,editMethod,request] of [
    ['planMeshEdgeEdit','editMeshEdges',strip(rules)],
    ['planMeshFaceRegion','editMeshFaceRegion',region(rules)]
  ]) {
    const plan = editor[planMethod]('panel',request);
    const {edgeEdit,faceRegion,topology} = editor[editMethod]('panel',request);
    const report = edgeEdit ?? faceRegion;
    assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
    assert.deepEqual(report,plan.report);
    const sidewall = report.sidewallUVs ?? report.detail.sidewallUVs;
    assert.equal(sidewall.pigmentLayout,1);
    assert(sidewall.createsMaterial);
    assert.equal(editor.meshTopology('panel').materials.at(-1).texture.tileset,'stone');
    assert.deepEqual(editor.eyedropTilesetFace({object:'panel',face:'front'}).selection,pick);
    assert.equal(topology.bindings.filter(row=>row.after?.data.selection.tileset==='stone').length,sidewall.faces.length);
    for (const {face,layouts} of sidewall.faces) {
      const sampled = editor.eyedropTilesetFace({object:'panel',face});
      assert.equal(sampled.sourceStatus,'retained');
      assert.deepEqual(sampled.selection,brush.selection);
      assert.equal(sampled.material,'tunnel');
      assert.deepEqual(sampled.paint.rotation,90);
      assert.deepEqual(layouts[1].map(uv=>uv.map(n=>Math.round(n*20))),[[8,7],[8,3],[2,3],[2,7]]);
      assert.notDeepEqual(layouts[0],layouts[1]);
    }
    const after = editor.snapshot();
    assert(editor.undo());
    assert.deepEqual(editor.snapshot(),start);
    assert(editor.redo());
    assert.deepEqual(editor.snapshot(),after);
    assert(editor.undo());
  }
});

test('out-of-range continuation and occupied brush slots block a transaction',()=>{
  const {editor,strip,brush} = fixture(), start = editor.snapshot();
  const beyond = strip({uv:'extend',distance:.75});
  const wrap = editor.planMeshEdgeEdit('panel',beyond);
  assert(!wrap.report.canCommit);
  assert.equal(wrap.report.issues[0].kind,'extrusion-uv-out-of-bounds');
  assert(wrap.report.issues[0].uvs.flat().some(value=>value<0));
  assert.throws(()=>editor.editMeshEdges('panel',beyond),error=>error.report.issues[0].kind==='extrusion-uv-out-of-bounds');
  const reuse = strip({uv:'brush',brush,material:'tileset/brick'});
  const conflict = editor.planMeshEdgeEdit('panel',reuse);
  assert(!conflict.report.canCommit);
  assert.deepEqual(conflict.report.issues[0],{kind:'extrusion-brush-material-conflict',reason:'material-in-use',
    material:'tileset/brick',tileset:'stone'});
  assert.throws(()=>editor.editMeshEdges('panel',reuse),error=>!error.report.canCommit);
  assert.deepEqual(editor.snapshot(),start);
});
