'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const atlas = [65,49], density = 8;
const face = (id,ids,bounds,material='paint')=>{
  const [l,t,r,b] = bounds;
  return {id,material,corners:ids.map((vertex,i)=>({id:id+'/'+i,vertex,uv:[[l,b],[r,b],[r,t],[l,t]][i]}))};
};
const snapshotUV = (doc,id)=>doc.faces.find(row=>row.id===id).corners.map(corner=>corner.uv);
const flatten = fields=>({op:'flatten',...fields});
const ready = plan=>assert(plan.report.canCommit,JSON.stringify(plan.report.operations));
const close = (n,expected)=>assert(Math.abs(n-expected)<1e-8,JSON.stringify({n,expected}));
const bindings = row=>row.bindings?.filter(item=>item.data.format==='ink-studio/uv-flatten-binding') ?? [];
const editorRow = editor=>editor.snapshot().topologyMeshes.panels;

function panelScene() {
  const vertices = [
    ['a',0,0,0],['b',1,0,0],['c',1,1,0],['d',0,1,0],
    ['e',2,0,0],['f',3,0,0],['g',3,1,0],['h',2,1,0]
  ].map(([id,...position])=>({id,position}));
  const document = T.create({id:'panels',vertices,faces:[
    face('follow',['a','b','c','d'],[4/64,4/48,9/64,10/48]),
    face('static',['e','f','g','h'],[28/64,4/48,35/64,10/48])
  ]});
  const scene = {id:'panels',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:density},
    tilesets:{grid:ink.createBlankTileset({width:atlas[0],height:atlas[1],background:'#426971'})},
    topologyMeshes:{panels:{document,materials:[{id:'paint',texture:{tileset:'grid'}}],
      bakes:[{id:'pigment-bake',material:'paint',maps:{roughness:.45}}]}}};
  return {scene,document};
}

test('unfold a warped quad without distorting any rendered triangle edge',()=>{
  const points = [[0,0,0],[2,0,0],[2,1,0],[0,1,1]];
  const vertices = points.map((position,i)=>({id:'v'+i,position}));
  const polygon = face('bend',vertices.map(row=>row.id),[.1,.1,.8,.8]);
  const doc = T.create({id:'bend',vertices,faces:[{...polygon,diagonal:[polygon.corners[0].id,polygon.corners[2].id]}]});
  const selected = UV.select(doc,{domain:'islands',ids:['bend']});
  const op = flatten({selection:selected,atlas,origin:[4,6],texelsPerUnit:density});
  const plan = UV.plan(doc,{operations:[op]});
  ready(plan);
  const [row] = plan.report.operations[0].evidence.faces;
  assert.deepEqual(row.texelBounds.slice(0,2),[4,6]);
  close(row.metrics.after.density,density);
  close(row.metrics.after.maxStretch,1);
  const after = UV.inspect(plan.document,0,{atlas});
  const corners = new Map(after.corners.map(row=>[row.id,row.texel]));
  for (const tri of T.triangulate(doc).triangleSources) {
    for (const [i,id] of tri.corners.entries()) {
      const next = tri.corners[(i+1)%3];
      const xyz = key=>points[Number(key.split('/').at(-1))];
      close(Math.hypot(...corners.get(id).map((n,i)=>n-corners.get(next)[i])),
        density*Math.hypot(...xyz(id).map((n,i)=>n-xyz(next)[i])));
    }
  }
  assert.deepEqual(plan.document.vertices,doc.vertices);
  assert.throws(()=>UV.plan(doc,{operations:[{...op,refit:true}]}),/editable scene/);
  const noRoom = UV.plan(doc,{operations:[{...op,origin:[60,45]}]});
  assert.equal(noRoom.report.operations[0].conflicts[0].code,'flatten-outside-atlas');
  assert.deepEqual(noRoom.patch,{});
});

test('use scene and project density and refit only opted-in faces in one geometry transaction',()=>{
  const {scene} = panelScene(), editor = ink.createSceneEditor(scene);
  const request = {operations:[flatten({ids:['follow'],refit:true}),flatten({ids:['static']})]};
  const preview = editor.planMeshUV('panels',request,{projectTexelsPerUnit:12});
  ready(preview);
  assert.deepEqual(preview.report.operations.map(row=>row.evidence.texelsPerUnit),[8,8]);
  assert.deepEqual(preview.report.operations[0].evidence.faces[0].texelBounds,[4,4,12,12]);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(editor.editMeshUV('panels',request).uv,preview.report);
  const starting = editor.snapshot(), row = editorRow(editor);
  assert.deepEqual(bindings(row).map(item=>item.element),['follow']);
  const selection = T.select(row.document,{domain:'vertices',ids:['b','c','f','g']});
  const move = {selection,operation:{kind:'move',offset:[.5,0,0]}};
  const planned = editor.planMeshTransform('panels',move), edited = editor.transformMeshTopology('panels',move);
  assert.deepEqual(edited.transform,planned.report);
  assert.deepEqual(edited.transform.uvRefits.map(item=>[item.face,item.status,item.texelBounds]),[
    ['follow','refit',[4,4,16,12]]
  ]);
  const after = editorRow(editor);
  assert.deepEqual(after.document,planned.document);
  assert.deepEqual(snapshotUV(after.document,'static'),snapshotUV(row.document,'static'));
  assert.notDeepEqual(snapshotUV(after.document,'follow'),snapshotUV(row.document,'follow'));
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),starting);
  assert(editor.redo());
  assert.deepEqual(editorRow(editor),after);

  const {tilesetDefaults,...withoutDensity} = scene;
  const noDefault = ink.createSceneEditor(withoutDensity);
  const project = noDefault.planMeshUV('panels',{operations:[flatten({ids:['follow']})]},{projectTexelsPerUnit:12});
  ready(project);
  assert.equal(project.report.operations[0].evidence.texelsPerUnit,12);
  assert.deepEqual(project.report.operations[0].evidence.faces[0].texelBounds,[4,4,16,16]);

  const original = scene.topologyMeshes.panels;
  const baked = ink.createSceneEditor({...scene,topologyMeshes:{panels:{...original,bakes:[
    {id:'old-small-bake',material:'paint',maps:{texture:{width:9,height:9,pixels:new Array(9*9*4).fill(255)}}}
  ]}}});
  const authoring = baked.planMeshUV('panels',{operations:[flatten({ids:['follow']})]});
  ready(authoring);
  assert.deepEqual(authoring.report.operations[0].evidence.faces[0].atlas,atlas);
});

test('record no-op opt-ins and keep rigid edits, manual UV overrides and clearing deterministic',()=>{
  const {scene} = panelScene(), editor = ink.createSceneEditor(scene);
  const one = refit=>({operations:[flatten({ids:['follow'],refit})]});
  editor.editMeshUV('panels',one(false));
  assert.equal(bindings(editorRow(editor)).length,0);
  const installed = editor.editMeshUV('panels',one(true));
  assert.equal(installed.uv.corners.length,0);
  const initial = editorRow(editor), active = bindings(initial)[0];
  assert.equal(active.element,'follow');
  const rigid = initial.document.vertices.filter(row=>'abcd'.includes(row.id)).map(({id,position:[x,y,z]})=>({
    id,position:[-y+1.5,x+2.25,z]
  }));
  const moved = editor.editMeshTopology('panels',{vertices:rigid});
  assert.equal(moved.uvRefits,undefined);
  assert.deepEqual(bindings(editorRow(editor)),[active]);
  assert.deepEqual(snapshotUV(editorRow(editor).document,'follow'),snapshotUV(initial.document,'follow'));
  const revised = editor.editMeshUV('panels',{operations:[{op:'nudge',ids:['follow'],steps:[1,0]}]});
  assert.equal(revised.topology.uvRefits[0].reason,'flatten-mapping-changed');
  const current = editorRow(editor);
  assert.equal(bindings(current)[0].review.reason,'flatten-mapping-changed');
  const b = current.document.vertices.find(row=>row.id==='b');
  editor.editMeshTopology('panels',{vertices:[{...b,position:[b.position[0]+.25,...b.position.slice(1)]}]});
  assert.deepEqual(snapshotUV(editorRow(editor).document,'follow'),snapshotUV(current.document,'follow'));
  editor.editMeshUV('panels',one(false));
  assert.deepEqual(bindings(editorRow(editor)),[]);
});

test('keep geometry edits while a refit exceeds its atlas or hits a pinned corner',()=>{
  const {scene} = panelScene(), editor = ink.createSceneEditor(scene);
  editor.editMeshUV('panels',{operations:[flatten({ids:['follow'],refit:true})]});
  const initial = editorRow(editor);
  const b = initial.document.vertices.find(row=>row.id==='b');
  const overflow = editor.editMeshTopology('panels',{vertices:[{...b,position:[12,0,0]}]});
  assert.equal(overflow.uvRefits[0].reason,'flatten-outside-atlas');
  assert.deepEqual(snapshotUV(editorRow(editor).document,'follow'),snapshotUV(initial.document,'follow'));
  assert.equal(editorRow(editor).document.vertices.find(row=>row.id==='b').position[0],12);
  assert.equal(bindings(editorRow(editor))[0].review.reason,'flatten-outside-atlas');
  assert(editor.undo());
  editor.editMeshUV('panels',{operations:[{op:'pin',ids:['follow/1'],pinned:true}]});
  const pin = editor.editMeshTopology('panels',{vertices:[{...b,position:[1.5,0,0]}]});
  assert.equal(pin.uvRefits[0].reason,'flatten-pinned-corner');
  assert.deepEqual(pin.uvRefits[0].corners,['follow/1']);
  assert.deepEqual(snapshotUV(editorRow(editor).document,'follow'),snapshotUV(initial.document,'follow'));

  const active = ink.createSceneEditor(scene);
  active.editMeshUV('panels',{operations:[flatten({ids:['follow'],refit:true})]});
  const changedAtlas = ink.createSceneEditor({...active.snapshot(),tilesets:{
    grid:ink.createBlankTileset({width:81,height:49,background:'#426971'})
  }});
  const change = changedAtlas.editMeshTopology('panels',{vertices:[{...b,position:[1.5,0,0]}]});
  assert.equal(change.uvRefits[0].reason,'flatten-atlas-changed');
});
