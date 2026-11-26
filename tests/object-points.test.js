'use strict';

const assert = require('node:assert/strict'), {test} = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT, {V,M} = K, P = K.authoring.objectPoints;
const hinge = {kind:'object-point',object:'panel',id:'hinge'};
const dock = {kind:'object-point',instance:'west',id:'dock'};
const retained = {hinge:{position:[-.75,.3,0],direction:[0,1,1]},lip:{position:[.75,.3,0]}};

function source() {
  const {scene,panel,library} = fixture();
  const {prefabLibrary,...base} = scene;
  return {...base,prefabs:{bay:{...library.bay,points:{dock:{position:[.75,.35,.22],direction:[1,0,0]}}}},
    topologyMeshes:{panel,reference:{...panel,label:'Alignment reference'}},
    instances:{west:{prefab:'bay',transform:{translation:[-1.45,0,0],rotation:[.17,.03,0]}}}};
}

function near(actual,expected) {
  assert.equal(actual.length,expected.length);
  assert(V.dist(actual,expected)<1e-8,`Expected ${actual} near ${expected}`);
}

test('authors and inspects points without rewriting topology, with removal and undo',()=>{
  const editor = ink.createSceneEditor(source()), original = editor.snapshot();
  const request = {object:'panel',points:retained};
  assert(editor.planObjectPoints(request).canCommit);
  assert.deepEqual(editor.snapshot(),original);
  editor.editObjectPoints(request);
  const authored = editor.snapshot();
  assert.deepEqual(authored.topologyMeshes.panel.document,original.topologyMeshes.panel.document);
  near(P.resolve(authored,{},hinge).target,retained.hinge.position);
  near(editor.planObjectPoints({object:'panel'}).after[0].local.direction,[0,Math.SQRT1_2,Math.SQRT1_2]);
  editor.editObjectPoints({object:'panel',points:{lip:null}});
  assert(!Object.hasOwn(editor.snapshot().topologyMeshes.panel.points,'lip'));
  editor.undo();
  assert.deepEqual(editor.snapshot(),authored);
  editor.undo();
  assert.deepEqual(editor.snapshot(),original);
  assert.throws(()=>editor.editObjectPoints({object:'panel',points:{bad:{position:[0,0,0],direction:[0,0,0]}}}),/nonzero/);
  assert.throws(()=>P.resolve(original,{},hinge),/Unknown object point/);
});

test('uses the same point for a pivot, plane origin and component alignment',()=>{
  const editor = ink.createSceneEditor(source());
  editor.editObjectPoints({object:'panel',points:retained});
  const pivot = editor.setMeshPivot('reference',{target:hinge});
  near(pivot.after.world,retained.hinge.position);
  assert.equal(pivot.target.id,'hinge');
  const point = P.resolve(editor.snapshot(),{},dock).target;
  const old = editor.snapshot();
  const result = editor.snapConstructionOrigin(dock);
  near(result.plane.origin,point);
  const socket = editor.planMeshPivot('reference',{target:{kind:'instance',instance:'west',instanceKind:'prefab',anchor:'dock'}});
  near(socket.after.world,point);
  const doc = editor.snapshot().topologyMeshes.reference.document, vertex = doc.vertices[0].id;
  const transform = {selection:K.meshTopology.select(doc,{domain:'faces',ids:['sign','grille']}),space:'world',operation:{kind:'move',offset:[0,0,0]},
    snap:{...dock,anchor:vertex}};
  const plan = editor.planMeshTransform('reference',transform);
  near(plan.document.vertices.find(row=>row.id===vertex).position,point);
  const asSocket = editor.planMeshTransform('reference',{...transform,snap:{
    kind:'socket',instance:'west',instanceKind:'prefab',binding:'dock',anchor:vertex}});
  near(asSocket.document.vertices.find(row=>row.id===vertex).position,point);
  assert.deepEqual(editor.snapshot().instances,old.instances);
});

test('promotes mesh points, stamps at exact XYZ and exposes live named sockets on nested and mirrored placements',()=>{
  const editor = ink.createSceneEditor(source());
  editor.editObjectPoints({object:'panel',points:retained});
  editor.promoteTilesetPrefab({prefab:'tile-panel',instance:'original',faces:{panel:['sign','grille']},origin:hinge});
  const promoted = {...hinge,object:'original.panel'};
  near(P.resolve(editor.snapshot(),{},promoted).target,retained.hinge.position);
  near(P.resolve(editor.snapshot(),{},promoted).local.position,[0,0,0]);
  editor.editObjectPoints({instance:'original',points:{mount:{position:[.5,.3,0],direction:[1,0,0]}}});
  assert.equal(editor.snapshot().prefabs['tile-panel'].revision,2);
  const stamp = {prefab:'tile-panel',id:'copy',anchor:'mount',target:dock,orientation:'world',angle:-35};
  const preview = editor.planPrefabStamp(stamp);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.equal(preview.snapGrid,false);
  editor.stampPrefab(stamp);
  const target = P.resolve(editor.snapshot(),{},dock).target, mount = {...dock,instance:'copy',id:'mount'};
  near(P.resolve(editor.snapshot(),{},mount).target,target);
  editor.stampPrefab({...stamp,id:'member-copy',anchor:{member:'panel',id:'lip'}});
  near(P.resolve(editor.snapshot(),{},{...hinge,object:'member-copy.panel',id:'lip'}).target,target);

  editor.reparentPrefab({instance:'copy',parent:'west'});
  editor.applyPrefabMirror({source:'copy',instance:'mirrored',plane:{origin:[0,0,0],normal:[1,0,0]}});
  const mirrored = {...mount,instance:'mirrored'};
  near(P.resolve(editor.snapshot(),{},mirrored).target,[-target[0],target[1],target[2]]);
  const {graph} = K.sceneGraph.fromDiorama(editor.build());
  const rootSocket = {node:'prefab.copy',socket:'mount'}, mirroredSocket = {node:'prefab.mirrored',socket:'mount'};
  near(graph.frame(rootSocket).position,target);
  near(graph.frame(mirroredSocket).position,[-target[0],target[1],target[2]]);
  const alignment = P.resolve(editor.snapshot(),{},mount);
  near(V.norm(M.app(graph.frame(rootSocket).matrix,[0,0,1])),alignment.world.direction);
  near(graph.frame({node:'mesh.original.panel',socket:'hinge'}).position,retained.hinge.position);
  const delta = [.25,.5,-.08], west = graph.frame('prefab.west');
  graph.setWorld('prefab.west',{matrix:west.matrix,position:V.add(west.position,delta)});
  near(graph.frame(rootSocket).position,V.add(target,delta));
  const combined = editor.combinePrefabs({prefab:'pair',instance:'assembled',mode:'replace',instances:['copy','mirrored']});
  assert(combined.canCommit);
  near(P.resolve(editor.snapshot(),{},{...mount,instance:'assembled',id:'copy.mount'}).target,target);
});

test('shared library revisions can publish named points without changing the original library',()=>{
  const {scene,library} = fixture(), env = {prefabs:library}, editor = ink.createSceneEditor(scene,{env});
  const point = {position:[.6,.5,.2],direction:[1,0,0]};
  assert.equal(editor.planObjectPoints({instance:'west',points:{dock:point}}).conflicts[0].reason,'publish-prefab-library-revision');
  const revised = editor.previewPrefabSourceEdit({instance:'west',sourceEdits:[{op:'set',path:'/points/dock',value:point}]},
    {render:false});
  assert(revised.report.canCommit,JSON.stringify(revised.report));
  assert.equal(revised.library.bay.revision,library.bay.revision+1);
  assert.deepEqual(revised.library.bay.points.dock,point);
  assert.equal(library.bay.points,undefined);
  const envAfter = {prefabs:revised.library};
  near(P.resolve(revised.scene,envAfter,dock).target,[-.71,.5,.2]);
  near(P.resolve(revised.scene,envAfter,{...dock,instance:'east'}).target,[1.91,.5,.2]);
});

test('CLI writes point edits and reports a preview before placing a prefab at a named target',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-object-points-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), input = source();
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:dir}));
  write('scene.json',input);
  write('points.json',{object:'panel',points:retained});
  write('anchor.json',{instance:'west',points:{foot:{position:[-.75,.06,0]}}});
  write('stamp.json',{prefab:'bay',id:'placed',anchor:'foot',target:hinge,angle:12});
  const request = ['tileset','object-points','points.json','--scene','scene.json'];
  const plan = run(...request);
  assert(plan.canCommit && plan.changed);
  assert.deepEqual(plan,run(...request,'--out','authored.json'));
  const edit = run('tileset','object-points','anchor.json','--scene','authored.json','--out','anchored.json');
  assert.equal(edit.revision,4);
  const plane = run('mesh-topology','plane','anchored.json','--snap-origin','object-point','--object','panel',
    '--point-id','hinge','--out','plane.json');
  near(plane.after.origin,retained.hinge.position);
  const stamp = run('tileset','stamp-prefab','stamp.json','--scene','plane.json','--out','placed.json');
  assert(stamp.canCommit);
  const placed = {...dock,instance:'placed',id:'foot'};
  near(P.resolve(read('placed.json'),{},placed).target,retained.hinge.position);
  assert.deepEqual(read('scene.json'),input);
  write('bad.json',{prefab:'bay',id:'rejected',anchor:'missing',target:hinge});
  const failed = spawnSync(process.execPath,[cli,'tileset','stamp-prefab','bad.json','--scene','anchored.json',
    '--out','rejected.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(failed.status,1);
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
