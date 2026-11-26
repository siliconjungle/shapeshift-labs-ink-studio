'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;

const pick = (scene,column) => ink.pickTilesetRectangle(scene,'enamel',{x:column*24,y:0,width:24,height:24});
const crop = (row,face) => row.bindings.find(binding=>binding.element===face).data.selection.x;
function setup({external=false,rotated=false,attach=true}={}) {
  const {scene,library,request,view} = fixture(), {prefabLibrary,...base} = scene;
  library.bay.topologyMeshes.panel = {...library.bay.topologyMeshes.panel,pivot:[-.5,.5,0]};
  const west = { ...scene.instances.west, ...(rotated && {transform:{translation:[-1.31,0,0],
    rotation:[.32,.09,.17],scale:.86}}),
    overrides:[{op:'set',path:'/solids/body/mat',value:'stone'}] };
  const source = {...(external ? scene : {...base,prefabs:library}),instances:{...scene.instances,west}};
  const editor = ink.createSceneEditor(source,external ? {env:{prefabs:library}} : undefined);
  editor.editIsolatedPrefab(request);
  if (attach) editor.addSurfaceDecal({id:'badge',kind:'paint',
    anchor:{object:'west.panel',face:'sign',uv:{min:[.07,.1],max:[.16,.25]},bias:.004},
    image:{width:1,height:1,pixels:[237,186,63,255]}});
  return {editor,library,scene,view};
}
const render = (world,view) => R.render(world,{...view,raw:true,px:1}).rgb;

test('fork adopts the chosen placement and local edits without affecting the original prefab', () => {
  const {editor,scene,view} = setup(), source = editor.snapshot();
  const request = {instance:'west',revision:3,mode:'fork',prefab:'west-bay'};
  const preview = editor.previewPrefabVariant(request);
  assert(preview.report.canCommit);
  assert.deepEqual(render(preview.before,view),render(preview.after,view));
  assert.deepEqual(editor.snapshot(),source);
  assert.deepEqual(preview.report.overrides,{paths:[['solids','body','mat']],meshes:['panel']});
  const receipt = editor.applyPrefabVariant(request), saved = editor.snapshot();
  assert.deepEqual(receipt,preview.report);
  assert.deepEqual(saved.prefabs.bay,source.prefabs.bay);
  assert.deepEqual(saved.instances.east,source.instances.east);
  assert.deepEqual(saved.instances.west,{prefab:'west-bay',transform:source.instances.west.transform});
  assert.deepEqual(saved.surfaceDecals,source.surfaceDecals);
  const variant = saved.prefabs['west-bay'];
  assert.equal(variant.revision,1);
  assert.equal(crop(variant.topologyMeshes.panel,'sign'),48);
  assert.equal(variant.solids.body.mat,'stone');
  assert.deepEqual(variant.usesTilesets,['enamel']);
  assert.deepEqual(variant.provenance,{prefab:'bay',revision:3,instance:'west'});
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
  editor.redo();
  assert.deepEqual(editor.snapshot(),saved);
  editor.editPrefabSource({instance:'east',edits:[{member:'panel',reskin:{face:'grille',selection:pick(scene,0)}}]});
  assert.equal(crop(editor.snapshot().prefabs['west-bay'].topologyMeshes.panel,'grille'),24);
  assert.equal(crop(editor.snapshot().prefabs.bay.topologyMeshes.panel,'grille'),0);
});

test('detach bakes a rotated, uniformly scaled placement and preserves tile and receiver IDs', () => {
  const {editor,scene,view} = setup({rotated:true}), before = editor.snapshot();
  const request = {instance:'west',mode:'detach'};
  const preview = editor.previewPrefabVariant(request);
  assert(preview.report.canCommit);
  assert.deepEqual(render(preview.before,view),render(preview.after,view));
  editor.applyPrefabVariant(request);
  const saved = editor.snapshot();
  assert(!saved.instances.west);
  assert(saved.solids.some(solid=>solid.id==='west.body' && solid.mat==='stone'));
  const effective = before.instances.west.meshOverrides.panel.mesh, row = saved.topologyMeshes['west.panel'];
  const provenance = {prefab:'bay',revision:3,instance:'west',member:'panel',meshRevision:K.meshTopology.revision(effective.document)};
  assert.deepEqual(row.provenance,provenance);
  assert.deepEqual(row.bindings,effective.bindings);
  assert.deepEqual(saved.surfaceDecals,before.surfaceDecals);
  assert.deepEqual(row.document.faces,effective.document.faces);
  const transform = K.diorama.solidFrames.authored(before.instances.west.transform);
  assert.deepEqual(row.document.vertices,effective.document.vertices.map(vertex=>({...vertex,position:transform.point(vertex.position)})));
  assert.deepEqual(row.pivot,transform.point(effective.pivot));
  assert(saved.instances.east);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),saved);
  editor.applyTilesetReskin({object:'west.panel',face:'sign',selection:pick(scene,1)});
  assert.equal(crop(editor.snapshot().topologyMeshes['west.panel'],'sign'),24);
  assert.deepEqual(editor.snapshot().topologyMeshes['west.panel'].provenance,provenance);
  assert.equal(crop(editor.snapshot().prefabs.bay.topologyMeshes.panel,'sign'),0);
});

test('detach holds selections with index-bound controls when an expanded member would move', () => {
  const {editor} = setup({attach:false}), source = editor.snapshot();
  const controlled = ink.createSceneEditor({...source,parameterBindings:{controls:{size:.6},
    bindings:[{path:'/solids/0/half/0',parameter:'size'}]}});
  const request = {instance:'east',mode:'detach'};
  const report = controlled.planPrefabVariant(request);
  assert(!report.canCommit);
  assert.deepEqual(report.conflicts,[{reason:'indexed-parameter-target-moved',path:['solids','0','half','0']}]);
  assert.throws(()=>controlled.applyPrefabVariant(request),/needs review/);
});

test('fork preserves a retained modifier stack when detaching the transformed mesh would change its frame', () => {
  const {editor} = setup({attach:false}), source = editor.snapshot();
  const bay = source.prefabs.bay, panel = bay.topologyMeshes.panel;
  const revised = {...bay,topologyMeshes:{panel:{...panel,
    modifiers:[{id:'repeat',kind:'array',count:2,step:[3,0,0]}]}}};
  // Use the unmodified placement to exercise a live modifier on the source.
  const shaped = ink.createSceneEditor({...source,prefabs:{bay:revised}});
  const blocked = shaped.planPrefabVariant({instance:'east',mode:'detach'});
  assert(!blocked.canCommit);
  assert.deepEqual(blocked.conflicts,[{reason:'mesh-placement-needs-review',member:'panel',object:'east.panel',dependent:['modifiers']}]);
  assert(shaped.applyPrefabVariant({instance:'east',mode:'fork',prefab:'extended'}).canCommit);
  assert.deepEqual(shaped.snapshot().prefabs.extended.topologyMeshes.panel.modifiers,revised.topologyMeshes.panel.modifiers);
});

test('CLI forks a library prefab into the scene and blocks a conflicting variant ID',t=>{
  const {editor,library,view} = setup({external:true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-variant-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const original = editor.snapshot();
  write('scene.json',original);
  write('library.json',library);
  write('view.json',view);
  write('request.json',{instance:'west',mode:'fork',prefab:'west-local'});
  const args = [cli,'mesh-topology','variant-prefab','scene.json','request.json','--view','view.json','--preview','review'];
  const report = JSON.parse(execFileSync(process.execPath,[...args,'--out','fork.json'],{cwd:dir}));
  assert(report.canCommit);
  assert.equal(report.preview.instances[0].changedPixels,0);
  assert.equal(read('fork.json').prefabs['west-local'].provenance.library,'library.json');
  assert.equal(read('fork.json').instances.east.prefab,'bay');
  assert.deepEqual(read('scene.json'),original);
  assert.deepEqual(read('library.json'),library);
  write('request.json',{instance:'west',mode:'fork',prefab:'bay'});
  const failed=spawnSync(process.execPath,[cli,'mesh-topology','variant-prefab','scene.json','request.json','--out','refused.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(failed.status,1);
  assert.equal(JSON.parse(failed.stdout).conflicts[0].reason,'prefab-in-use');
  assert(!fs.existsSync(path.join(dir,'refused.json')));
});
