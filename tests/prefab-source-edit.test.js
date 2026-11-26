'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');

const paint = (scene,face,index) => ({member:'panel',reskin:{face,
  selection:ink.pickTilesetRectangle(scene,'enamel',{x:index*24,y:0,width:24,height:24})}});
const bodyColor = value => ({op:'set',path:'/solids/body/mat',value});
function placed({external=false,overrides}={}) {
  const {scene,library,request,view} = fixture(), {prefabLibrary,...base} = scene;
  const editor = external ? ink.createSceneEditor(scene,{env:{prefabs:library}}) :
    ink.createSceneEditor({...base,prefabs:library});
  editor.editIsolatedPrefab(request);
  if (overrides) editor.setPrefabInstance('east',{...scene.instances.east,overrides});
  return {editor,library,scene,view};
}

test('source changes propagate to every instance while disjoint face overrides survive and path overrides are reported', () => {
  const {editor,scene} = placed({overrides:[bodyColor('dark')]}), before = editor.snapshot();
  const request = {instance:'west',revision:3,sourceEdits:[bodyColor('stone')],edits:[paint(scene,'grille',0)]};
  const preview = editor.previewPrefabSourceEdit(request,{render:false});
  const {report} = preview;
  assert(report.canCommit);
  assert.equal(report.afterRevision,4);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(report.instances.map(row=>row.instance),['east','west']);
  const [east,west] = report.instances;
  assert.deepEqual(east.overrides[0].touched,[['solids','body','mat']]);
  assert.equal(east.members.find(row=>row.member==='body').status,'masked');
  assert.equal(west.meshOverrides[0].status,'rebased');
  assert.deepEqual(west.members.find(row=>row.member==='panel').elements.faces,['grille']);

  assert.deepEqual(editor.editPrefabSource(request),report);
  const after = editor.snapshot(), definition = after.prefabs.bay, retained = after.instances.west.meshOverrides.panel.mesh;
  assert.deepEqual(after,preview.scene);
  assert.equal(definition.topologyMeshes.panel.bindings.find(row=>row.element==='sign').data.selection.x,0);
  assert.equal(definition.topologyMeshes.panel.bindings.find(row=>row.element==='grille').data.selection.x,0);
  assert.equal(retained.bindings.find(row=>row.element==='sign').data.selection.x,48);
  assert.equal(retained.bindings.find(row=>row.element==='grille').data.selection.x,0);
  assert.equal(after.instances.west.meshOverrides.panel.revision,4);
  assert.equal(after.instances.west.meshOverrides.panel.base,ink.load().KIT.meshTopology.revision(definition.topologyMeshes.panel.document));
  assert.deepEqual(after.instances.east.overrides,before.instances.east.overrides);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
  assert.throws(()=>editor.planPrefabSourceEdit(request),/Stale prefab source revision/);
});

test('overlapping face changes and removal of a locally edited face cannot silently discard a mesh override', () => {
  const {editor,scene} = placed(), before = editor.snapshot();
  for (const edit of [paint(scene,'sign',1),{member:'panel',patch:{removeFaces:['sign']}}]) {
    const request = {instance:'east',edits:[edit]};
    const {report} = editor.previewPrefabSourceEdit(request,{render:false});
    assert(!report.canCommit);
    assert(report.conflicts.some(row=>row.instance==='west' && row.member==='panel' && row.path.includes('sign')));
    assert.equal(report.instances.find(row=>row.instance==='west').meshOverrides[0].status,'conflict');
    assert.throws(()=>editor.editPrefabSource(request),/Prefab source edit needs review/);
    assert.deepEqual(editor.snapshot(),before);
  }
});

test('an override test or an indexed path to a moved face blocks the revision', () => {
  const {editor} = placed({overrides:[{...bodyColor('dark'),op:'test'}]});
  const tested = editor.previewPrefabSourceEdit({instance:'west',sourceEdits:[bodyColor('stone')]},{render:false});
  assert(!tested.scene);
  assert.equal(tested.report.instances[0].overrides[0].status,'conflict');
  assert.match(tested.report.instances[0].overrides[0].reason,/Test failed/);

  const indexed = placed({overrides:[{op:'set',path:'/topologyMeshes/panel/document/faces/1/smoothingGroup',value:'trim'}]}).editor;
  const request = {instance:'west',edits:[{member:'panel',patch:{removeFaces:['sign']}}]};
  const review = indexed.planPrefabSourceEdit(request);
  assert(!review.canCommit);
  assert.match(review.instances[0].overrides[0].reason,/different authored element/);
});

test('CLI reviews the shared library, writes matched captures, and publishes a separate revision and scene',t=>{
  const {editor,scene,library,view} = placed({external:true});
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-source-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (file,doc)=>fs.writeFileSync(path.join(folder,file),JSON.stringify(doc));
  const read = file=>JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
  const run = args=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:folder}));
  const saved = editor.snapshot();
  write('station.json',saved);
  write('library.json',library);
  write('view.json',view);
  write('edit.json',{instance:'west',edits:[paint(scene,'grille',0)]});
  const args = ['mesh-topology','edit-prefab','station.json','edit.json','--preview','review','--view','view.json'];
  const report = run(args);
  assert(report.canCommit);
  assert.equal(report.source,'library');
  assert(report.preview.instances.every(row=>row.changedPixels>0));
  assert.deepEqual(report.preview.files,['before.png','after.png','changes.png']);
  for (const file of report.preview.files) assert(fs.existsSync(path.join(folder,'review',file)));
  assert.deepEqual(run([...args,'--out','revised.json','--library-out','library-r4.json']),report);
  const newScene = read('revised.json');
  assert.equal(newScene.prefabLibrary,'library-r4.json');
  assert.equal(read('library-r4.json').bay.revision,4);
  assert.deepEqual(read('station.json'),saved);
  assert.deepEqual(read('library.json'),library);
  assert(ink.createSceneEditor(newScene,{env:{prefabs:read('library-r4.json')}}).build().topologyMeshes['west.panel']);

  write('edit.json',{instance:'west',edits:[paint(scene,'sign',1)]});
  const rejected = spawnSync(process.execPath,[cli,...args,'--preview','blocked','--out','blocked.json','--library-out','blocked-lib.json'],
    {cwd:folder,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert(JSON.parse(rejected.stdout).conflicts.length);
  assert(!fs.existsSync(path.join(folder,'blocked.json')));
  assert(!fs.existsSync(path.join(folder,'blocked-lib.json')));
});
