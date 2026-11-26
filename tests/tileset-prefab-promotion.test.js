'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');

function source() {
  const {scene,panel,view,shared} = fixture();
  const {prefabLibrary,instances,...base} = scene;
  const editor = ink.createSceneEditor({...base,topologyMeshes:{panel},
    constructionPlane:{origin:[-.75,0,0]}});
  editor.addSurfaceDecal({id:'pin',kind:'paint',anchor:{object:'panel',face:'sign',
    at:[-.5,.14,0],normal:[0,0,1],size:[.12,.12],bias:.003},
    grid:[2,2],image:{width:1,height:1,pixels:[255,222,128,255]}});
  return {editor,view,shared};
}

const request = {prefab:'station-sign',instance:'west',faces:{panel:['sign']}};
const selection = editor => editor.selectMeshTopology('panel',{domain:'faces',ids:['sign']});
const image = (editor,view) => R.render(editor.build(),{...view,raw:true,px:1}).rgb;

test('promotion keeps the placed picture, selected paint and shared edge identities and undoes in one step', () => {
  const {editor,view,shared} = source(), before = editor.snapshot();
  const beforeImage = image(editor,view);
  const selected = {...request,faces:{panel:selection(editor)}};
  const plan = editor.planTilesetPrefab(selected);
  assert(plan.canCommit);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(plan.origin,{kind:'plane',at:[-.75,0,0]});
  assert.equal(plan.sources[0].sharedEdges.length,1);
  assert.deepEqual(editor.promoteTilesetPrefab(selected),plan);
  const after = editor.snapshot(), original = before.topologyMeshes.panel;
  const member = after.prefabs['station-sign'].topologyMeshes.panel;
  const sign = original.document.faces.find(row => row.id === 'sign');
  assert.deepEqual(member.document.faces,[sign]);
  assert.deepEqual(member.bindings,original.bindings.filter(row => row.element === 'sign'));
  assert.deepEqual(after.prefabs['station-sign'].usesTilesets,['enamel']);
  assert.deepEqual(member.document.vertices[0].position,[0,0,0]);
  assert.deepEqual(after.topologyMeshes.panel.document.faces.map(row => row.id),['grille']);
  for (const id of shared) {
    assert(member.document.vertices.some(row => row.id === id));
    assert(after.topologyMeshes.panel.document.vertices.some(row => row.id === id));
  }
  assert.deepEqual(after.surfaceDecals.decals[0].anchor,{...before.surfaceDecals.decals[0].anchor,object:'west.panel'});
  assert.deepEqual(image(editor,view),beforeImage);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
  editor.setPrefabInstance('east',{prefab:'station-sign',transform:{translation:[1,0,0]}});
  assert.deepEqual(Object.keys(editor.build().topologyMeshes).sort(),['east.panel','panel','west.panel']);
});

test('a named point and scene vertex rebase a whole mesh and retain its tileset dependency', () => {
  const {editor} = source();
  const all = {panel:['sign','grille']}, picked = {kind:'point',id:'threshold',at:[.25,-.5,0]};
  const vertex = editor.meshTopology('panel').document.vertices[0];
  assert.deepEqual(editor.planTilesetPrefab({...request,faces:all,origin:{kind:'vertex',object:'panel',vertex:vertex.id}}).origin.at,
    vertex.position);
  const report = editor.promoteTilesetPrefab({...request,faces:all,origin:picked});
  assert.deepEqual(report.origin,picked);
  assert.deepEqual(report.placement.transform.translation,picked.at);
  assert.equal(editor.snapshot().topologyMeshes.panel,undefined);
  assert.equal(editor.planTilesetPrefab(request).canCommit,false);
  assert.throws(() => editor.promoteTilesetPrefab(request),/promotion needs review/);
});

test('an edge-based plane keeps its frame while the removed anchor is reported', () => {
  const {editor} = source(), kit = ink.load().KIT;
  const mesh = editor.meshTopology('panel').document;
  const {edges} = kit.meshTopology.inspect(mesh);
  const edge = edges.find(row => row.uses.length === 1 && row.uses[0].face === 'sign').id;
  const scene = editor.snapshot();
  const {plane} = kit.authoring.constructionPlane.tilt(scene,{object:'panel',edge,at:.5,degrees:33});
  const hinged = ink.createSceneEditor({...scene,constructionPlane:plane});
  const report = hinged.promoteTilesetPrefab(request);
  assert.deepEqual(report.origin.at,plane.origin);
  assert.deepEqual(report.detachedPlaneEdge,plane.edgeAnchor);
  const {edgeAnchor,...frame} = plane;
  assert.deepEqual(hinged.constructionPlane(),frame);
  hinged.undo();
  assert.deepEqual(hinged.constructionPlane(),plane);
});

test('CLI accepts a saved face selection and rejects stale or unpainted selections before writing', t => {
  const {editor} = source(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-prefab-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value) => fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const sel = selection(editor);
  write('scene.json',editor.snapshot());
  write('faces.json',sel);
  write('promote.json',{...request,faces:{panel:null}});
  const args = [cli,'tileset','promote-prefab','promote.json','--scene','scene.json','--selection','faces.json'];
  const plan = JSON.parse(execFileSync(process.execPath,args,{cwd:dir}));
  assert(plan.canCommit);
  assert.equal(read('scene.json').prefabs,undefined);
  const committed = JSON.parse(execFileSync(process.execPath,[...args,'--out','promoted.json'],{cwd:dir}));
  assert.deepEqual(committed,plan);
  assert(read('promoted.json').prefabs['station-sign']);
  write('faces.json',{...sel,revision:'outdated'});
  let rejected = spawnSync(process.execPath,[...args,'--out','rejected.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/same topology revision/);
  const snapshot = editor.snapshot();
  write('scene.json',{...snapshot,topologyMeshes:{panel:{...snapshot.topologyMeshes.panel,bindings:[]}}});
  write('faces.json',sel);
  rejected = spawnSync(process.execPath,[...args,'--out','rejected.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).conflicts[0].kind,'face-has-no-tile-binding');
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
