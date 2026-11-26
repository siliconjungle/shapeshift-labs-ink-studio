'use strict';

const assert = require('node:assert/strict'), {test} = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT, {V} = K;
const inspect = {action:'inspect',layer:'station'};
const center = {action:'center',layer:'station'};
const batch = {action:'set-origins',layer:'station',target:{kind:'module-center'}};
const near = (left,right) => assert(V.dist(left,right)<1e-8,JSON.stringify({left,right}));
const render = (world,view) => R.render(world,{...view,raw:true,px:1}).rgb;

function setup({external=false}={}) {
  const {scene,library,view} = fixture(), {prefabLibrary,...base} = scene;
  library.bay.points = {socket:{position:[.52,.27,.11],direction:[0,1,0]}};
  library.pier = {revision:1,solids:{footing:{kind:'box',at:[0,1,0],half:[.4,.5,.2],mat:'stone'}}};
  const source = {...(external ? scene : {...base,prefabs:library}),constructionPlane:{origin:[.4,-.2,.5],
    right:[0,0,-1],up:[0,1,0],grid:[.25,.5],rounding:'floor'},
    instances:{west:scene.instances.west,east:scene.instances.east,
      upper:{prefab:'bay',parent:'east',transform:{translation:[.2,1.02,.14],rotation:[.1,.04,.05],scale:.65}},
      post:{prefab:'pier',transform:{translation:[1,0,0]}}},
    sceneLayers:{layers:{station:{},floor:{parent:'station'},upper:{parent:'station',visible:false},survey:{}},
      members:{west:'floor',east:'floor',upper:'upper',post:'survey'}}};
  const env = external ? {prefabs:library} : {};
  return {editor:ink.createSceneEditor(source,{env}),env,library,view:{...view,w:250,h:145,camera:{...view.camera,target:[0,.85,0],zoom:1.12}}};
}

test('measures mixed world-rest bounds, inherited branches and hidden modules',()=>{
  const {editor,env} = setup();
  const world = editor.snapshot(), result = editor.planSceneLayers(inspect);
  const {measurement} = result;
  assert.equal(measurement.space,'world-rest');
  assert(measurement.complete);
  assert.deepEqual(measurement.modules.map(row=>row.instance),['east','upper','west']);
  assert(measurement.bounds.max[1]>1.55);
  const visible = editor.planSceneLayers({...inspect,includeHidden:false}).measurement;
  assert.deepEqual(visible.modules.map(row=>row.instance),['east','west']);
  assert(visible.bounds.max[1]<measurement.bounds.max[1]);
  const pier = editor.planSceneLayers({...inspect,layer:'survey'}).measurement;
  near(pier.bounds.min,[.6,.5,-.2]);
  near(pier.bounds.max,[1.4,1.5,.2]);
  near(pier.center,[1,1,0]);
  const mesh = measurement.modules.find(row=>row.instance==='upper').members.find(row=>row.kind==='mesh');
  const {spec,meshPlacements} = K.authoring.scenePrefabs.expand(world,env);
  const vertices = spec.topologyMeshes['upper.panel'].document.vertices.map(row=>
    K.sceneGraph.point(meshPlacements.get('upper.panel'),row.position));
  const bounds = K.procedural.spatial.boxOf(vertices);
  near(mesh.bounds.min,bounds.min);
  near(mesh.bounds.max,bounds.max);
  assert.deepEqual(editor.snapshot(),world);
});

test('centers the construction frame once, preserving its axes and grid, with a deliberate edge detach',()=>{
  const {editor} = setup(), before = editor.snapshot();
  const result = editor.editSceneLayers(center);
  assert(result.canCommit && result.changed);
  near(editor.constructionPlane().origin,result.measurement.center);
  assert.deepEqual({...editor.constructionPlane(),origin:before.constructionPlane.origin},before.constructionPlane);
  assert.deepEqual(editor.snapshot().instances,before.instances);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  const origin = editor.snapshot().topologyMeshes.pillar.document.vertices[0].position;
  const edge = K.meshTopology.create(editor.snapshot().topologyMeshes.pillar.document).edges[0];
  editor.setConstructionPlane({edgeAnchor:{object:'pillar',edge:edge.id,vertices:edge.vertices,
    at:0,degrees:0,referenceUp:[0,0,1]}});
  assert.throws(()=>editor.planSceneLayers(center),/Detach the edge anchor/);
  const detached = editor.editSceneLayers({...center,detachEdge:true,basis:'origins'});
  assert.notDeepEqual(detached.frame.target,origin);
  assert(!editor.constructionPlane().edgeAnchor);
  near(editor.constructionPlane().origin,detached.measurement.originCenter);
});

test('batch-sets origins without moving geometry, nested placements or sockets',()=>{
  const {editor,env,view} = setup();
  const source = editor.snapshot(), preview = editor.previewSceneLayers(batch);
  assert(preview.report.canCommit && preview.report.changed);
  assert.deepEqual(render(preview.before,view),render(preview.after,view));
  assert.deepEqual(editor.snapshot(),source);
  const receipt = editor.editSceneLayers(batch);
  const after = editor.snapshot(), a = K.authoring.scenePrefabs.expand(source,env), b = K.authoring.scenePrefabs.expand(after,env);
  assert.deepEqual(a.meshPlacements,b.meshPlacements);
  assert.deepEqual(after.instances.upper.parent,source.instances.upper.parent);
  assert.deepEqual(after.instances.upper.transform,source.instances.upper.transform);
  const {graph} = K.sceneGraph.fromDiorama(editor.build(),env);
  for (const row of receipt.origins) {
    near(row.after,receipt.measurement.modules.find(module=>module.instance===row.instance).center);
    near(graph.frame('prefab.'+row.instance).position,row.after);
    const target = {kind:'object-point',instance:row.instance,id:'socket'};
    near(K.authoring.objectPoints.resolve(source,env,target).target,K.authoring.objectPoints.resolve(after,env,target).target);
    near(graph.frame({node:'prefab.'+row.instance,socket:'socket'}).position,K.authoring.objectPoints.resolve(source,env,target).target);
  }
  const selected = editor.selectTilesetComponents({domain:'instances',query:{layer:'station'}});
  for (const row of selected.instances) near(row.target,b.instances.get(row.instance).origin);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('handles shared targets, live mirror dependents and layers with no usable geometry center',()=>{
  const {editor,env} = setup();
  editor.applyPrefabMirror({source:'west',instance:'echo',plane:{origin:[0,0,0],normal:[1,0,0]}});
  const blocked = editor.planSceneLayers(batch), before = editor.snapshot();
  assert.equal(blocked.canCommit,false);
  assert(blocked.conflicts.some(row=>row.reason==='commit-live-mirror-first'));
  assert.throws(()=>editor.editSceneLayers(batch),/need review/);
  assert.deepEqual(editor.snapshot(),before);
  editor.editSceneLayers({action:'move',layer:'survey',instances:['echo']});
  const target = {kind:'object-point',instance:'post',id:'ground'};
  editor.editObjectPoints({instance:'post',points:{ground:{position:[.2,.3,.4]}}});
  const updated = editor.editSceneLayers({...batch,target,includeHidden:false});
  const origin = K.authoring.objectPoints.resolve(editor.snapshot(),env,target).target;
  near(updated.origins.find(row=>row.instance==='east').after,origin);
  near(updated.origins.find(row=>row.source==='west').after,[-origin[0],origin[1],origin[2]]);
  editor.applyPrefabMirror({action:'commit',instance:'echo'});
  near(K.authoring.scenePrefabs.expand(editor.snapshot(),env).instances.get('echo').origin,[-origin[0],origin[1],origin[2]]);
  editor.editSceneLayers({action:'set',layer:'empty'});
  assert.equal(editor.planSceneLayers({...inspect,layer:'empty'}).measurement.bounds,null);
  assert.equal(editor.planSceneLayers({...center,layer:'empty'}).conflicts[0].reason,'no-finite-layer-center');
});

test('CLI reports bounds, centers the plane, and commits a matched rest-frame origin edit',t=>{
  const {editor,library,view} = setup({external:true}), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-layer-frames-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), original = editor.snapshot();
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','scene-layer',...args],{cwd:dir}));
  for (const [name,value] of Object.entries({source:original,library,view,inspect,center,batch})) write(name+'.json',value);
  const measured = run('source.json','inspect.json');
  const centered = run('source.json','center.json','--out','centered.json');
  near(read('centered.json').constructionPlane.origin,measured.measurement.center);
  const result = run('centered.json','batch.json','--preview','review','--view','view.json','--out','origins.json');
  assert(result.canCommit && result.changed);
  assert.deepEqual(fs.readFileSync(path.join(dir,'review/before.png')),fs.readFileSync(path.join(dir,'review/after.png')));
  assert.deepEqual(read('source.json'),original);
  write('bad.json',{...batch,layer:'missing'});
  const bad = spawnSync(process.execPath,[cli,'mesh-topology','scene-layer','source.json','bad.json','--out','bad-out.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(bad.status,1);
  assert(!fs.existsSync(path.join(dir,'bad-out.json')));
});
