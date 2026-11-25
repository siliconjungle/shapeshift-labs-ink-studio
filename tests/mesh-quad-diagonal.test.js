'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T=K.meshTopology;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

const positions=[[-1,0,0],[1,0,0],[1,1.4,.8],[-1,1.4,0]];
function quad(points=positions,diagonal) {
  return T.create({id:'tile',vertices:points.map((position,i)=>({id:'v'+i,position})),
    faces:[{id:'tile',corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({
      id:'c'+i,vertex:'v'+i,uv,normal:[0,0,1],attributes:{'uv/1':uv},...(i===1 && {uvPinned:true})
    })),...(diagonal!==undefined && {diagonal})}],uvBindings:{pigment:1},
    edges:[{id:'rim',vertices:['v0','v1'],uvSeam:true,crease:.5}]});
}
const request=(doc,op={faces:['tile']})=>({revision:T.revision(doc),operations:[{kind:'flip-diagonal',...op}]});
const flip=(doc,op)=>T.planRepair(doc,request(doc,op));
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} differs from ${b}`);
const ray=doc=>K.sceneMeshes.rayQuery(T.toSceneMesh(doc),K)({origin:[0,.7,2],direction:[0,0,-1],maxDistance:4});

test('flipping a warped quad changes derived triangle normals and the center ray hit',()=>{
  const before=quad(), selection=T.select(before,{domain:'faces',ids:['tile']});
  const plan=flip(before,{selection}), {document:after}=plan;
  const effect=plan.report.steps[0];
  assert.equal(effect.uvSet,1);
  const [row]=effect.faces;
  assert.deepEqual(row.before.diagonal,['c1','c3']);
  assert.deepEqual(row.after.diagonal,['c0','c2']);
  assert.deepEqual(row.before.midpointUV,row.after.midpointUV);
  assert.notEqual(row.before.bendDegrees,row.after.bendDegrees);
  assert.deepEqual(row.after.triangles.map(row=>row.corners),T.triangulate(after).triangleSources.map(row=>row.corners));
  assert.equal(after.faces.length,1);
  assert.deepEqual(after.faces[0].corners,before.faces[0].corners);
  assert.deepEqual(after.edges,before.edges);
  assert.deepEqual(after.vertices,before.vertices);
  assert.deepEqual(plan.patch,{faces:after.faces});
  near(ray(before).point[2],0);
  near(ray(after).point[2],.4);
  assert.deepEqual(T.create(JSON.parse(JSON.stringify(after))),after);
  const again=flip(after);
  assert.deepEqual(again.document.faces[0].diagonal,row.before.diagonal);
  near(ray(again.document).point[2],0);
  assert.throws(()=>flip(after,{selection}),/same topology revision/);
});

test('explicit diagonals must be opposite corners and both projected triangles must remain inside',()=>{
  assert.deepEqual(quad(positions,['c2','c0']).faces[0].diagonal,['c0','c2']);
  assert.throws(()=>quad(positions,['c1','c2']),/opposite corner IDs/);
  assert.throws(()=>quad(positions,['c0','absent']),/opposite corner IDs/);
  const concave=quad([[-1,0,0],[0,.65,0],[1,0,0],[0,1,0]]);
  const collinear=quad([[-1,0,0],[0,0,0],[1,0,0],[0,1,0]]);
  for (const doc of [concave,collinear]) assert.throws(()=>flip(doc),/leave the quad or collapse a triangle/);
  const triangle=T.fromIndexed({id:'triangle',positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]});
  assert.throws(()=>flip(triangle,{faces:[triangle.faces[0].id]}),/four-corner face/);
});

test('the authored diagonal follows surviving corners through winding, copies, and ordinary edits',()=>{
  const doc=flip(quad()).document;
  const reversed=T.planRepair(doc,{revision:T.revision(doc),operations:[{kind:'winding',faces:['tile']}]}).document;
  assert.deepEqual(reversed.faces[0].diagonal,doc.faces[0].diagonal);
  for (const row of T.triangulate(reversed).triangleSources) assert(row.corners.every(id=>doc.faces[0].corners.some(c=>c.id===id)));
  near(ray(reversed).point[2],ray(doc).point[2]);
  const moved=T.edit(doc,{vertices:[{id:'v2',position:[1,1.4,.95]}]});
  assert.deepEqual(moved.faces,doc.faces);
  for (const op of [{kind:'array',id:'repeat',count:2,step:[3,0,0]},
    {kind:'mirror',id:'mirror',normal:[1,0,0],weld:false,winding:'reverse'}]) {
    const result=T.evaluateModifiers(doc,[op]);
    assert(result.report.canApply);
    const [source,copy]=result.document.faces;
    assert.deepEqual(source.diagonal,doc.faces[0].diagonal);
    const originalVerts=doc.faces[0].corners.filter(c=>doc.faces[0].diagonal.includes(c.id)).map(c=>c.vertex);
    const actual=copy.corners.filter(c=>copy.diagonal.includes(c.id)).map(c=>
      result.document.vertices.find(v=>v.id===c.vertex).position[2]).sort((a,b)=>a-b);
    assert.deepEqual(actual,originalVerts.map(id=>doc.vertices.find(v=>v.id===id).position[2]).sort((a,b)=>a-b));
  }
});

test('splitting a quad strip yields valid new rings with their own tessellation',()=>{
  const {coupler,edgeSelection,request:edgeRequest}=require('../examples/mesh-edge-edit/fixture.cjs');
  const original=T.create(coupler(false));
  const face=original.faces.find(row=>['heel/0','nose/0'].every(vertex=>row.corners.some(corner=>corner.vertex===vertex)));
  const doc=flip(original,{faces:[face.id]}).document;
  const operation={kind:'insert-loop',selection:edgeSelection(T,doc,ends=>
    ends.includes('heel/0') && ends.includes('nose/0')),start:'heel/0',fraction:.4};
  const plan=T.planEdgeEdit(doc,edgeRequest(T,doc,'insert',operation));
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert.equal(plan.document.faces.find(row=>row.id===face.id).diagonal,undefined);
});

function paintedScene() {
  const base={id:'bench',style:'slate',solids:[],tilesets:{
    trim:ink.createBlankTileset({width:8,height:8,background:'#608277'})
  }};
  const editor=ink.createSceneEditor(base);
  const selection=ink.pickTilesetRectangle(base,'trim',{x:1,y:1,width:6,height:5});
  editor.placeTilesetFace({object:'plate',face:'tile',selection,worldSize:[2,1.4],origin:[-1,0,0]});
  editor.editMeshTopology('plate',{vertices:[{id:'tile/v2',position:positions[2]}]});
  const scene=JSON.parse(JSON.stringify(editor.snapshot()));
  scene.topologyMeshes.plate.bakes=[{id:'paint',material:'tileset/trim',maps:{roughness:.4}}];
  return {scene,selection,doc:scene.topologyMeshes.plate.document};
}

test('the scene transaction preserves painted source bindings and journals bake invalidation',()=>{
  const {scene,selection,doc}=paintedScene(), editor=ink.createSceneEditor(scene);
  const spec=request(doc);
  const preview=editor.planMeshRepair('plate',spec);
  assert.deepEqual(editor.snapshot(),scene);
  const receipt=editor.repairMeshTopology('plate',spec);
  assert.deepEqual(receipt.repair,preview.report);
  assert.deepEqual(receipt.topology.bakes[0].after.faces,['tile']);
  assert.equal(receipt.topology.faces[0].id,'tile');
  const next=editor.snapshot();
  assert.deepEqual(next.topologyMeshes.plate.bindings,scene.topologyMeshes.plate.bindings);
  assert.deepEqual(editor.eyedropTilesetFace({object:'plate',face:'tile'}).selection,selection);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),next);
});

test('the CLI previews and commits the same derived triangle change',t=>{
  const {scene,doc}=paintedScene(), cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-quad-diagonal-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write=(name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read=name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('original.json',scene);
  write('request.json',request(doc));
  const args=['repair','original.json','request.json','--object','plate'];
  const preview=JSON.parse(run(...args));
  run(...args,'--out','flipped.json','--report','receipt.json');
  assert.deepEqual(read('original.json'),scene);
  assert.deepEqual(read('receipt.json').repair,preview.report);
  assert.deepEqual(read('flipped.json').topologyMeshes.plate.document,T.edit(doc,preview.patch));
});
