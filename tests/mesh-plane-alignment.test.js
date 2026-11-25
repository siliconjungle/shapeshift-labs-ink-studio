'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T = K.meshTopology;

function fixture() {
  const document = T.fromIndexed({ id:'docking-plates', positions:[
    -2,0,.1, -1,0,.5, -1,1,.5,
    1,0,-.4, 2,0,.2, 1,1,-.4,
    3,0,.5, 4,0,1, 3,1,.5
  ], indices:[0,1,2,3,4,5,6,7,8] });
  const working = {origin:[0,0,.25]};
  const scene = {id:'docking-bench',style:'slate',solids:[],constructionPlane:working,
    topologyMeshes:{plates:{document,pivot:[0,.8,.25]}}};
  return { document, scene, working, faces: document.faces.map(face=>face.id) };
}

const position = (doc,id) => doc.vertices.find(row=>row.id===id).position;
function close(actual, expected) {
  assert(Math.abs(actual-expected)<1e-8, `${actual} differs from ${expected}`);
}

test('near, center, and far place signed bounds with one translation and honor the working plane',()=>{
  const { document,scene,faces }=fixture(), editor=ink.createSceneEditor(scene);
  const selection=T.select(document,{domain:'faces',ids:faces.slice(0,2)});
  for (const [side,expected] of [['near',-.25],['center',.2],['far',.65]]) {
    const {patch,document:next,report}=editor.planMeshTransform('plates',{selection,operation:{kind:'align',side}});
    assert.equal(report.operation.plane.source,'construction');
    close(report.operation.delta[2],expected);
    close(report.operation.after[side],0);
    close(report.operation.after.near-report.operation.after.far,.9);
    assert.deepEqual(patch.vertices.map(row=>row.id),['v/0','v/1','v/2','v/3','v/4','v/5']);
    assert.deepEqual(next.faces,document.faces);
    assert.deepEqual(next.edges,document.edges);
  }
  const plane={origin:[0,0,.25],normal:[0,0,-2]};
  const pins={vertices:['v/3','v/5']};
  const {document:next,report}=T.planTransform(document,{selection,pins,operation:{kind:'align',side:'near',plane}});
  assert.deepEqual(report.operation.measured,['v/0','v/1','v/2','v/4']);
  assert.deepEqual(position(next,'v/3'),position(document,'v/3'));
  close(report.operation.after.near,0);
  close(position(next,'v/0')[2],.25);
});

test('flatten is per-vertex in world space with falloff, pins, and coincident copies',()=>{
  const {document}=fixture();
  const copy=T.edit(document,{vertices:[{id:'copy',position:[-1,1,.50001]}]});
  const selection=T.select(copy,{domain:'vertices',ids:['v/2']});
  const frame={position:[1,2,4],scale:[2,3,4]};
  const operation={kind:'flatten',plane:{origin:[0,0,5],normal:[0,0,1]}};
  const plan=T.planTransform(copy,{selection,frame,operation,falloff:{radius:5,curve:'linear'},
    pins:{vertices:['v/0']},coincident:{tolerance:.001}});
  assert.deepEqual(plan.patch.vertices.map(row=>row.id),['copy','v/1','v/2']);
  assert.equal(plan.report.coincident.groups.length,1);
  close(position(plan.document,'copy')[2],.25);
  close(position(plan.document,'v/2')[2],.25);
  close(position(plan.document,'v/1')[2],.40);
  assert.deepEqual(position(plan.document,'v/0'),position(copy,'v/0'));
  close(plan.report.operation.after.near,0);
  close(plan.report.operation.after.far,0);
});

test('collapse uses a world point or retained pivot and preserves separate identities and undo',()=>{
  const {document,scene}=fixture(), editor=ink.createSceneEditor(scene);
  const selection=T.select(document,{domain:'vertices',ids:['v/2','v/5']});
  const request={selection,operation:{kind:'collapse'}};
  const preview=editor.planMeshTransform('plates',request), result=editor.transformMeshTopology('plates',request);
  assert.deepEqual(result.transform,preview.report);
  assert.equal(result.transform.operation.source,'pivot');
  assert.deepEqual(position(preview.document,'v/2'),[0,.8,.25]);
  assert.deepEqual(position(preview.document,'v/5'),[0,.8,.25]);
  assert.deepEqual(preview.document.faces,document.faces);
  assert.deepEqual(preview.document.edges,document.edges);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('plates').document,preview.document);
  const explicit=T.planTransform(document,{selection,frame:{position:[1,2,3],scale:2},
    operation:{kind:'collapse',point:[1,4,3]}});
  assert.deepEqual(position(explicit.document,'v/2'),[0,1,0]);
  assert.deepEqual(position(explicit.document,'v/5'),[0,1,0]);
  close(explicit.report.operation.maxError,0);
});

test('lost-area faces require explicit removal, with topology evidence and atomic undo',()=>{
  const {document,scene,faces}=fixture(), [left,right]=faces;
  const row=scene.topologyMeshes.plates;
  row.bindings=[{id:'badge',domain:'faces',element:left}];
  const editor=ink.createSceneEditor(scene);
  const selection=T.select(document,{domain:'faces',ids:[left]});
  for (const base of [{kind:'collapse',point:[0,1,0]},{kind:'flatten',plane:{origin:[0,0,0],normal:[5,0,2]}}]) {
    assert.throws(()=>editor.transformMeshTopology('plates',{selection,operation:base}),/nonzero area/);
    assert.deepEqual(editor.snapshot(),scene);
    const request={selection,operation:{...base,removeCollapsed:true}};
    const preview=editor.planMeshTransform('plates',request);
    assert.deepEqual(preview.patch.removeFaces,[left]);
    const receipt=editor.transformMeshTopology('plates',request);
    assert.deepEqual(receipt.transform.operation.removedFaces,[left]);
    assert.equal(receipt.topology.bindings[0].change,'needs-review');
    assert.deepEqual(editor.meshTopology('plates').document.faces[0],document.faces.find(face=>face.id===right));
    assert(editor.undo());
    assert.deepEqual(editor.snapshot(),scene);
  }
  assert.throws(()=>editor.transformMeshTopology('plates',{selection:T.select(document,{domain:'faces'}),
    operation:{kind:'collapse',point:[0,0,0],removeCollapsed:true}}),/retain at least one polygon/);
  assert.deepEqual(editor.snapshot(),scene);
});

test('isolated prefab alignment uses the placed frame and retains the active edit scope',()=>{
  const {document,working,faces}=fixture();
  const scene={id:'bench',style:'slate',solids:[],constructionPlane:working,
    instances:{rig:{prefab:'racks',transform:{translation:[2,-3,6],scale:2}}}};
  const editor=ink.createSceneEditor(scene,{env:{prefabs:{racks:{revision:1,solids:{},topologyMeshes:{plates:{document}}}}}});
  const request={instance:'rig',faces:{plates:faces.slice(0,2)},edits:[{member:'plates',
    transform:{operation:{kind:'align',side:'center'}}}]};
  const report=editor.planPrefabIsolation(request);
  assert(report.canCommit);
  const edit=report.edits[0];
  close(edit.evidence.operation.before.center,5.85);
  close(edit.evidence.operation.after.center,0);
  editor.editIsolatedPrefab(request);
  assert.deepEqual(editor.snapshot().instances.rig.meshOverrides.plates.mesh.document.faces,document.faces);
  assert(editor.undo());
  const outside={...request,edits:[{member:'plates',transform:{operation:{kind:'align',side:'near'},
    selection:T.select(document,{domain:'faces',ids:[faces[2]]})}}]};
  assert.equal(editor.planPrefabIsolation(outside).conflicts[0].reason,'outside-active-faces');
});

test('an explicit oblique plane projects in the normal direction and validates target settings',()=>{
  const {document,faces}=fixture(), selection=T.select(document,{domain:'faces',ids:faces.slice(0,2)});
  const frame=K.sceneGraph.transform({position:[1,2,4],matrix:[1,0,.25,0,2,0,0,0,1]});
  const plane={origin:[0,1,2],normal:[-.2,.3,1]}, normal=K.V.norm(plane.normal);
  const make=(operation,extra)=>T.planTransform(document,{selection,frame,operation,...extra});
  const {report}=make({kind:'flatten',plane});
  for (const {before,after} of report.vertices) {
    const start=K.sceneGraph.point(frame,before), end=K.sceneGraph.point(frame,after);
    close(K.V.dot(K.V.sub(end,plane.origin),normal),0);
    close(K.V.len(K.V.cross(K.V.sub(end,start),normal)),0);
  }
  assert.throws(()=>make({kind:'align',side:'closest'}),/near, center, or far/);
  assert.throws(()=>make({kind:'flatten',plane:{...plane,normal:[0,0,0]}}),/nonzero XYZ direction/);
  assert.throws(()=>make({kind:'collapse'},{snap:{kind:'plane',...plane}}),/already define their target/);
});

test('CLI reuses transform previews and receipts for plane operations',t=>{
  const {scene,document,faces}=fixture();
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-plane-transform-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('bench.json',scene);
  write('request.json',{operation:{kind:'flatten'},selection:T.select(document,{domain:'faces',ids:faces.slice(0,2)})});
  const args=['transform','bench.json','request.json','--object','plates'];
  const preview=JSON.parse(run(...args));
  run(...args,'--out','flat.json','--report','receipt.json');
  assert.deepEqual(preview.report,read('receipt.json').transform);
  close(preview.report.operation.after.near,0);
  assert.deepEqual(read('bench.json'),scene);
  assert.deepEqual(read('flat.json').topologyMeshes.plates.document.faces,document.faces);
});
