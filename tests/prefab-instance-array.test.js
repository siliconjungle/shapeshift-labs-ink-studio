'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;

const request = {id:'rack',instance:'west',count:[2,2,2],spacing:[1.75,1.25,-.5]};
function setup({external=false,rotated=false}={}) {
  const {scene,library,request:local,view} = fixture(), {prefabLibrary,...base} = scene;
  const west = {...scene.instances.west,...(rotated && {transform:{translation:[-1.31,0,0],
    rotation:[0,0,Math.PI/2],scale:.85,pivot:[-.25,.5,0]}})};
  const prefabs = {...library,alternate:{...library.bay,revision:8}};
  const source = {...(external ? scene : {...base,prefabs}),instances:{...scene.instances,west}};
  const editor = ink.createSceneEditor(source,external ? {env:{prefabs}} : undefined);
  editor.editIsolatedPrefab(local);
  return {editor,prefabs,view};
}
function close(actual,expected) {
  assert(actual.every((value,index)=>Math.abs(value-expected[index])<1e-9),JSON.stringify({actual,expected}));
}

test('duplicates across three axes and preserves surviving IDs, local edits and placement offsets after resize',()=>{
  const {editor} = setup({rotated:true}), before = editor.snapshot();
  const preview = editor.planPrefabArray(request);
  assert(preview.canCommit);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.applyPrefabArray(request),preview);
  const original = editor.snapshot(), copy = original.instances['rack.1.1.1'];
  assert.equal(Object.keys(original.instances).length,9);
  assert.deepEqual(original.instances.west,before.instances.west);
  assert.deepEqual(copy.meshOverrides,before.instances.west.meshOverrides);
  close(K.authoring.scenePrefabs.origin(copy.transform),
    K.V.add(K.authoring.scenePrefabs.origin(before.instances.west.transform),request.spacing));
  assert.deepEqual(copy.transform.pivot,before.instances.west.transform.pivot);
  assert.deepEqual(copy.transform.rotation,before.instances.west.transform.rotation);

  editor.replacePrefabs({instances:['rack.1.0.0'],to:'alternate'});
  const current = editor.snapshot().instances['rack.1.0.0'], shift = [.4,.07,-.2];
  editor.setPrefabInstance('rack.1.0.0',{...current,transform:{...current.transform,
    translation:K.V.add(current.transform.translation,shift),scale:1.1}});
  const edited = editor.snapshot(), reopened = ink.createSceneEditor(edited);
  const resize = {id:'rack',count:[3,1,2],spacing:[2.25,1.25,-.5]};
  const report = reopened.applyPrefabArray(resize);
  assert(report.canCommit);
  assert.deepEqual(report.retired.map(row=>row.instance),['rack.0.1.0','rack.0.1.1','rack.1.1.0','rack.1.1.1']);
  const saved = reopened.snapshot(), survivor = saved.instances['rack.1.0.0'];
  assert.equal(survivor.prefab,'alternate');
  assert.equal(survivor.transform.scale,1.1);
  assert.deepEqual(survivor.meshOverrides,edited.instances['rack.1.0.0'].meshOverrides);
  close(survivor.transform.translation,K.V.add(edited.instances['rack.1.0.0'].transform.translation,[.5,0,0]));
  assert.equal(saved.instances['rack.2.0.1'].prefab,'bay');
  assert(saved.instances['rack.0.0.1']);
  assert(!saved.instances['rack.1.1.1']);
  assert(reopened.build().topologyMeshes['rack.2.0.1.panel']);
  assert.equal(reopened.planPrefabArray({id:'rack'}).changed,false);
  reopened.undo();
  assert.deepEqual(reopened.snapshot(),edited);
  reopened.redo();
  assert.deepEqual(reopened.snapshot(),saved);
});

test('local and construction-plane axes control distances in scene units',()=>{
  const {editor} = setup({rotated:true});
  editor.setConstructionPlane({origin:[4,7,8],right:[0,0,-1],up:[0,1,0],grid:[2,3]});
  const source = K.authoring.scenePrefabs.origin(editor.snapshot().instances.west.transform);
  for (const [space,spacings] of [
    ['local',[[0,2,0],[-3,0,0],[0,0,4]]],
    ['plane',[[0,0,-2],[0,3,0],[4,0,0]]]
  ]) {
    const report = editor.planPrefabArray({id:space,instance:'west',count:[2,2,2],spacing:[2,3,4],space});
    assert(report.canCommit);
    [[1,0,0],[0,1,0],[0,0,1]].forEach((cell,axis)=>{
      const row = report.cells.find(row=>row.cell.every((n,i)=>n===cell[i]));
      close(row.at,K.V.add(source,spacings[axis]));
    });
  }
});

test('detects occupied IDs and in-use copies and preserves intentionally detached cells across updates',()=>{
  const {editor} = setup();
  editor.setPrefabInstance('rack.1.0.0',{prefab:'bay'});
  let report = editor.planPrefabArray(request);
  assert(!report.canCommit);
  assert(report.conflicts.some(row=>row.instance==='rack.1.0.0' && row.reason==='instance-in-use'));
  editor.setPrefabInstance('rack.1.0.0',null);
  editor.applyPrefabArray(request);
  editor.applyPrefabVariant({instance:'rack.1.0.0',mode:'detach'});
  report = editor.applyPrefabArray({id:'rack',count:[3,2,2]});
  assert.equal(report.cells.find(row=>row.instance==='rack.1.0.0').status,'missing');
  assert(editor.snapshot().topologyMeshes['rack.1.0.0.panel']);
  editor.addSurfaceDecal({id:'plate',kind:'lettering',anchor:{object:'rack.2.0.0.panel',face:'sign',
    uv:{min:[.70,.2],max:[.85,.38]}},image:{width:1,height:1,pixels:[255,218,120,255]}});
  const before = editor.snapshot(), shrink = {id:'rack',count:[2,2,2]};
  report = editor.planPrefabArray(shrink);
  assert(!report.canCommit);
  assert(report.problems.some(row=>row.path==='surfaceDecals'));
  assert.throws(()=>editor.applyPrefabArray(shrink),/needs review/);
  assert.deepEqual(editor.snapshot(),before);
});

test('refresh follows the source origin and holds dependent arrays and indexed controls in review',()=>{
  const {editor} = setup({rotated:true});
  editor.applyPrefabArray({id:'rack',instance:'west',count:[3,1,1],spacing:[2,0,0]});
  const seed = editor.snapshot().instances.west;
  editor.setPrefabInstance('west',{...seed,transform:{...seed.transform,rotation:[0,0,0],scale:1}});
  const report = editor.applyPrefabArray({id:'rack'});
  close(report.cells[1].at,K.V.add(report.source.target,[2,0,0]));
  assert.deepEqual(editor.snapshot().instances['rack.1.0.0'].transform.rotation,seed.transform.rotation);

  const source = editor.snapshot(), shrink = {id:'rack',count:[2,1,1]};
  const controlled = ink.createSceneEditor({...source,parameterBindings:{controls:{width:.8},
    bindings:[{path:'/solids/3/half/0',parameter:'width'}]}});
  assert(controlled.planPrefabArray(shrink).conflicts.some(row=>row.reason==='indexed-parameter-target-moved'));
  editor.applyPrefabArray({id:'secondary',instance:'rack.2.0.0',count:[1,2,1],spacing:[0,1,0]});
  assert(editor.planPrefabArray(shrink).conflicts.some(row=>row.reason==='array-source-would-be-removed'));
});

test('CLI previews and reopens an array over an external prefab and blocks a colliding request',t=>{
  const {editor,prefabs,view} = setup({external:true}), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-array-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = args=>JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','array-prefab',...args],{cwd:dir}));
  write('scene.json',editor.snapshot());
  write('library.json',prefabs);
  write('view.json',view);
  write('array.json',request);
  const report = run(['scene.json','array.json','--view','view.json','--preview','review','--out','created.json']);
  assert.equal(report.cells.length,8);
  assert.deepEqual(report.preview.files,['before.png','after.png','changes.png']);
  assert.equal(read('created.json').prefabLibrary,'library.json');
  write('resize.json',{id:'rack',count:[1,2,2]});
  const resize = run(['created.json','resize.json','--out','resized.json']);
  assert.equal(resize.retired.length,4);
  assert(read('resized.json').instances['rack.0.1.1']);
  write('conflict.json',{...request,id:'east',count:[2,1,1]});
  const scene = read('scene.json');
  write('occupied.json',{...scene,instances:{...scene.instances,'east.1.0.0':scene.instances.east}});
  const blocked = spawnSync(process.execPath,[cli,'mesh-topology','array-prefab','occupied.json','conflict.json','--out','blocked.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(blocked.status,1);
  assert.equal(JSON.parse(blocked.stdout).conflicts[0].reason,'instance-in-use');
  assert(!fs.existsSync(path.join(dir,'blocked.json')));
});
