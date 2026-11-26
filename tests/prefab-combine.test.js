'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;
const combine = {prefab:'pair',instances:['west','east'],mode:'replace',instance:'station'};
const render = (world,view) => R.render(world,{...view,raw:true,px:1}).rgb;

function setup({external=false,rotated=false}={}) {
  const {scene,library,request,view} = fixture(), {prefabLibrary,...base} = scene;
  const source = external ? scene : {...base,prefabs:library};
  if (rotated) source.instances = {...source.instances,east:{...scene.instances.east,transform:{
    translation:[1.28,-.08,-.14],rotation:[.23,.08,-.06],scale:1.12,pivot:[.18,0,0]}}};
  const editor = ink.createSceneEditor(source,external ? {env:{prefabs:library}} : undefined);
  editor.editIsolatedPrefab(request);
  editor.addSurfaceDecal({id:'badge',kind:'lettering',anchor:{object:'west.panel',face:'sign',
    uv:{min:[.68,.15],max:[.75,.30]},bias:.006},image:{width:1,height:1,pixels:[245,200,116,255]}});
  return {editor,library,view};
}

test('replacement preserves rotated placements, effective paint, and scene receivers in one undo',()=>{
  const {editor,view} = setup({rotated:true}), input = editor.snapshot();
  const request = {...combine,origin:[.1,-.2,.3]};
  const preview = editor.previewPrefabCombination(request);
  assert(preview.report.canCommit,JSON.stringify(preview.report));
  assert.deepEqual(render(preview.before,view),render(preview.after,view));
  assert.deepEqual(editor.snapshot(),input);
  const report = editor.combinePrefabs(request), output = editor.snapshot(), module = output.prefabs.pair;
  assert.deepEqual(report,preview.report);
  assert.deepEqual(output.instances,{station:{prefab:'pair',transform:{translation:request.origin}}});
  assert.deepEqual(output.prefabs.bay,input.prefabs.bay);
  assert.deepEqual(module.usesTilesets,['enamel']);
  assert.deepEqual(module.provenance,[
    {instance:'west',prefab:'bay',revision:3},{instance:'east',prefab:'bay',revision:3}
  ]);
  assert.deepEqual(module.topologyMeshes['west.panel'],input.instances.west.meshOverrides.panel.mesh);
  assert.deepEqual(module.topologyMeshes['east.panel'].document,input.prefabs.bay.topologyMeshes.panel.document);
  assert.equal(output.surfaceDecals.decals[0].anchor.object,'station.west.panel');
  assert.equal(report.anchors[0].id,'badge');
  assert.deepEqual(Object.keys(module.meshFrames),['west.panel','east.panel']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),input);
  editor.redo();
  assert.deepEqual(editor.snapshot(),output);
});

test('keep mode saves an unstamped module and composes its member frames when stamped, forked or detached',()=>{
  const {editor,view} = setup({rotated:true}), before = editor.snapshot();
  const {instance,...base} = combine;
  const report = editor.combinePrefabs({...base,mode:'keep'});
  assert(report.canCommit);
  assert.deepEqual(editor.snapshot().instances,before.instances);
  assert.deepEqual(editor.snapshot().surfaceDecals,before.surfaceDecals);
  const marked = editor.snapshot(), world = editor.build();
  const plane = {origin:[0,2,0],grid:[1,1]};
  editor.setConstructionPlane(plane);
  const stamped = editor.stampPrefab({id:'upper',prefab:'pair',at:[0,0],angle:0});
  assert(stamped.canCommit);
  const sourceFrame = K.authoring.scenePrefabs.expand(marked).meshPlacements.get('east.panel');
  const placed = K.authoring.scenePrefabs.expand(editor.snapshot()).meshPlacements.get('upper.east.panel');
  const rel = K.V.sub(sourceFrame.position,report.origin);
  assert.deepEqual(placed.position,K.V.add(plane.origin,rel));
  assert.deepEqual(placed.matrix,sourceFrame.matrix);
  assert(world.topologyMeshes['east.panel']);
  assert(editor.build().topologyMeshes['upper.east.panel']);

  editor.applyPrefabVariant({instance:'upper',mode:'fork',prefab:'forked-pair'});
  assert.deepEqual(editor.snapshot().prefabs['forked-pair'].meshFrames,marked.prefabs.pair.meshFrames);
  const detached = editor.previewPrefabVariant({instance:'upper',mode:'detach'});
  assert(detached.report.canCommit);
  assert.deepEqual(render(detached.before,view),render(detached.after,view));
  editor.applyPrefabVariant({instance:'upper',mode:'detach'});
  assert(editor.snapshot().topologyMeshes['upper.east.panel']);
});

test('mesh transforms in a combined instance use the effective member frame',()=>{
  const {editor} = setup({rotated:true});
  editor.combinePrefabs(combine);
  const object = 'station.east.panel', member = 'east.panel';
  const row = editor.snapshot().prefabs.pair.topologyMeshes[member];
  const frame = K.authoring.scenePrefabs.expand(editor.snapshot()).meshPlacements.get(object);
  const offset = [.25,0,0];
  editor.editIsolatedPrefab({instance:'station',edits:[{member,transform:{space:'world',operation:{kind:'move',offset}}}]});
  const revised = editor.snapshot().instances.station.meshOverrides[member].mesh;
  for (const [i,vertex] of revised.document.vertices.entries()) {
    const localBefore = K.sceneGraph.point(frame,row.document.vertices[i].position);
    const localAfter = K.sceneGraph.point(frame,vertex.position);
    assert(K.V.dist(K.V.sub(localAfter,localBefore),offset)<1e-9);
  }
});

test('reports array sources and shifted indexed references before removing placements',()=>{
  const {editor} = setup();
  editor.applyPrefabArray({id:'some',instance:'west',count:[1,1,1],spacing:[0,0,0]});
  const plan = editor.planPrefabCombination(combine);
  assert(!plan.canCommit);
  assert(plan.conflicts.some(row=>row.reason==='array-source-would-be-removed'));

  const {editor:placed} = setup();
  placed.setPrefabInstance('east',null);
  placed.setPrefabInstance('middle',{prefab:'bay',transform:{translation:[0,2,0]}});
  placed.setPrefabInstance('east',{prefab:'bay',transform:{translation:[1.31,0,0]}});
  const controlled = ink.createSceneEditor({...placed.snapshot(),parameterBindings:{controls:{width:.82},
    bindings:[{path:'/solids/1/half/0',parameter:'width'}]}});
  const blocked = controlled.planPrefabCombination(combine);
  assert(!blocked.canCommit);
  assert(blocked.conflicts.some(row=>row.reason==='indexed-parameter-target-moved'));
});

test('CLI accepts saved prefab selection and requires an explicit keep-or-replace decision',t=>{
  const {editor,library,view} = setup({external:true}), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-combine-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = args=>JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','combine-prefab',...args],{cwd:dir}));
  const original = editor.snapshot();
  write('scene.json',original);
  write('view.json',view);
  write('library.json',library);
  write('selection.json',editor.selectTilesetComponents({domain:'instances',query:{kind:'prefab',ids:['west','east']}}));
  write('combine.json',{prefab:'pair',mode:'replace',instance:'station'});
  const args = ['scene.json','combine.json','--selection','selection.json'];
  const report = run([...args,'--preview','review','--view','view.json','--out','combined.json']);
  assert(report.canCommit);
  assert(report.preview.instances.every(row=>row.changedPixels===0));
  assert.equal(read('combined.json').prefabs.pair.provenance[0].library,'library.json');
  assert.deepEqual(read('scene.json'),original);
  assert.deepEqual(read('library.json'),library);
  write('combine.json',{prefab:'pair'});
  const rejected = spawnSync(process.execPath,[cli,'mesh-topology','combine-prefab',...args,'--out','rejected.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/explicitly keep or replace/);
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
