'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT, P = K.authoring.scenePrefabs, S = K.diorama.solidFrames;
const reparent = {instance:'sign',parent:'east'};
const render = (world,view) => R.render(world,{...view,raw:true,px:1}).rgb;

function setup() {
  const {scene,library,view,request} = fixture();
  const source = {...scene,instances:{
    badge:{prefab:'bay',parent:'sign',transform:{translation:[.86,.2,.12],scale:.32}},
    sign:{prefab:'bay',parent:'west',transform:{translation:[.52,1.03,.31],rotation:[.15,-.08,.09],
      scale:.69,pivot:[.16,.11,0]}},
    west:{prefab:'bay',transform:{translation:[-1.28,0,0],rotation:[.15,-.10,.02],scale:.9}},
    east:{prefab:'bay',transform:{translation:[1.32,.1,-.05],rotation:[-.33,.07,.12],scale:1.21,pivot:[.2,.1,.1]}}
  }};
  const env = {prefabs:library}, editor = ink.createSceneEditor(source,{env});
  editor.editIsolatedPrefab({...request,instance:'sign'});
  return {editor,env,view:{...view,h:156,camera:{...view.camera,target:[0,.95,0],zoom:1.32}}};
}

function close(actual,expected,epsilon=1e-8) {
  assert.equal(actual.length,expected.length);
  for (const [i,value] of expected.entries()) assert(Math.abs(actual[i]-value)<epsilon,
    `Expected ${actual[i]} near ${value} at index ${i}`);
}

test('rewrites only the local placement and holds the rendered subtree through undo and redo',()=>{
  const {editor,env,view} = setup(), before = editor.snapshot();
  const preview = editor.previewPrefabReparent(reparent);
  assert(preview.report.canCommit,JSON.stringify(preview.report));
  assert.deepEqual(render(preview.before,view),render(preview.after,view));
  assert.deepEqual(preview.report.instances.map(row=>row.instance),['sign','badge']);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.reparentPrefab(reparent),preview.report);
  const after = editor.snapshot();
  assert.equal(after.instances.sign.parent,'east');
  assert.deepEqual(after.instances.sign.transform.pivot,before.instances.sign.transform.pivot);
  assert.deepEqual(after.instances.sign.meshOverrides,before.instances.sign.meshOverrides);
  assert.deepEqual(after.instances.badge,before.instances.badge);
  const tree = editor.tree();
  const sign = tree.children.find(row=>row.key==='prefab:east').children.find(row=>row.key==='prefab:sign');
  assert(sign.children.some(row=>row.key==='prefab:badge'));
  const frames = P.placements(after.instances);
  const selection = editor.selectTilesetComponents({domain:'instances',query:{kind:'prefab',ids:['sign']}});
  close(selection.instances[0].target,frames.get('sign').mesh.position);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
  const delta = [.24,.43,.17];
  editor.setPrefabInstance('east',{...after.instances.east,transform:{...after.instances.east.transform,
    translation:K.V.add(after.instances.east.transform.translation,delta)}});
  const moved = P.expand(editor.snapshot(),env);
  for (const id of ['sign','badge']) {
    close(moved.meshPlacements.get(id+'.panel').position,K.V.add(frames.get(id).mesh.position,delta));
    close(moved.meshPlacements.get(id+'.panel').matrix,frames.get(id).mesh.matrix);
  }
  assert.notDeepEqual(render(editor.build(),view),render(preview.after,view));
  const root = editor.reparentPrefab({instance:'sign',parent:null});
  assert(!Object.hasOwn(editor.snapshot().instances.sign,'parent'));
  close(root.after.world.position,moved.instances.get('sign').frame.position);
  close(root.after.world.matrix,moved.instances.get('sign').frame.matrix);
});

test('authored and live hierarchies compose parent-relative motion, independent of declaration order',()=>{
  const {editor,env} = setup();
  const scene = editor.snapshot(), {west,sign,badge} = scene.instances;
  const expected = S.compose(S.compose(S.authored(west.transform),S.authored(sign.transform)),S.authored(badge.transform)).mesh;
  const world = editor.build(), {graph,geometry} = K.sceneGraph.fromDiorama(world,env);
  assert.equal(graph.node('prefab.badge').parent.node,'prefab.sign');
  close(graph.frame('prefab.badge').position,expected.position);
  close(graph.frame('prefab.badge').matrix,expected.matrix);
  const binding = K.sceneGraph.attach(world,graph,{geometry});
  const point = geometry.find(row=>row.node==='geometry.badge.body').indices[0]*16;
  const old = Array.from(world.data.slice(point,point+3)), delta = [.2,.38,.14];
  const westFrame = graph.frame('prefab.west');
  graph.setWorld('prefab.west',{matrix:westFrame.matrix,position:K.V.add(westFrame.position,delta)});
  binding.apply();
  close(Array.from(world.data.slice(point,point+3)),K.V.add(old,delta),1e-6);
  binding.dispose();
});

test('invalid parents, dependencies, cycles and unrepresentable relative scales have review evidence',()=>{
  const {editor,env} = setup(), before = editor.snapshot();
  for (const [parent,reason] of [['sign','parent-cycle'],['badge','parent-cycle'],['unknown','unknown-parent']]) {
    const report = editor.planPrefabReparent({instance:'sign',parent});
    assert.equal(report.canCommit,false);
    assert.equal(report.conflicts[0].reason,reason);
    assert.throws(()=>editor.reparentPrefab({instance:'sign',parent}),/needs review/);
    assert.deepEqual(editor.snapshot(),before);
  }
  const bad = parent => ({...before,instances:{...before.instances,west:{...before.instances.west,parent}}});
  assert.throws(()=>ink.createSceneEditor(bad('badge'),{env}),/parent cycle/);
  assert.throws(()=>ink.createSceneEditor(bad('unknown'),{env}),/Parent must name/);
  const detach = editor.planPrefabVariant({instance:'sign',mode:'detach'});
  assert(detach.conflicts.some(row=>row.reason==='child-needs-reparent' && row.instance==='badge'));
  const combine = editor.planPrefabCombination({instances:['east','sign'],prefab:'joined',instance:'sign',mode:'replace'});
  assert(combine.conflicts.some(row=>row.reason==='child-needs-reparent' && row.instance==='badge'));
  editor.setPrefabInstance('tiny',{prefab:'bay',transform:{scale:.02}});
  const scale = editor.planPrefabReparent({instance:'east',parent:'tiny'});
  assert.equal(scale.canCommit,false);
  assert.match(scale.problems[0].problem,/uniform scale/);
});

test('nested placements work with arrays, forks, detached leaf members and combined modules',()=>{
  const {editor,env,view} = setup(), scene = editor.snapshot(), frames = P.placements(scene.instances);
  const array = editor.applyPrefabArray({id:'row',instance:'sign',count:[2,1,1],spacing:[2.25,0,0],space:'local'});
  const copy = array.cells[1], origin = frames.get('sign').mesh.position;
  close(copy.at,K.V.mad(origin,frames.get('sign').direction([1,0,0]),2.25));
  assert.equal(editor.snapshot().instances[copy.instance].parent,'west');
  const shift = [.38,.17,.11], carrier = scene.instances.west;
  editor.setPrefabInstance('west',{...carrier,transform:{...carrier.transform,
    translation:K.V.add(carrier.transform.translation,shift)}});
  const resized = editor.applyPrefabArray({id:'row',spacing:[2.85,0,0]});
  close(resized.cells[1].at,K.V.mad(K.V.add(copy.at,shift),frames.get('sign').direction([1,0,0]),.60));
  editor.applyPrefabVariant({instance:'sign',mode:'fork',prefab:'sign-revision'});
  assert.equal(editor.snapshot().instances.sign.parent,'west');
  const detached = editor.previewPrefabVariant({instance:'badge',mode:'detach'});
  assert(detached.report.canCommit);
  assert.deepEqual(render(detached.before,view),render(detached.after,view));
  const module = editor.previewPrefabCombination({instances:['sign','badge'],prefab:'joined',instance:'sign',mode:'replace'});
  assert(module.report.canCommit,JSON.stringify(module.report));
  close(module.report.origin,K.V.add(frames.get('badge').mesh.position,shift));
  assert.deepEqual(render(module.before,view),render(module.after,view));
});

test('CLI previews and publishes a library-backed reparent and blocks invalid requests atomically',t=>{
  const {editor,env,view} = setup(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-reparent-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), input = editor.snapshot();
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const command = [cli,'mesh-topology','reparent-prefab','source.json','request.json'];
  write('source.json',input);
  write('library.json',env.prefabs);
  write('view.json',view);
  write('request.json',reparent);
  const report = JSON.parse(execFileSync(process.execPath,[...command,'--preview','review','--view','view.json',
    '--out','nested.json'],{cwd:dir}));
  assert(report.canCommit);
  assert(report.preview.instances.every(row=>row.changedPixels===0 && row.beforePixels>0));
  assert.deepEqual(fs.readFileSync(path.join(dir,'review/before.png')),fs.readFileSync(path.join(dir,'review/after.png')));
  assert.equal(read('nested.json').instances.sign.parent,'east');
  assert.deepEqual(read('source.json'),input);
  write('request.json',{instance:'sign',parent:'badge'});
  const failed = spawnSync(process.execPath,[...command,'--out','invalid.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(failed.status,1);
  assert.equal(JSON.parse(failed.stdout).conflicts[0].reason,'parent-cycle');
  assert(!fs.existsSync(path.join(dir,'invalid.json')));
});
