'use strict';

const assert = require('node:assert/strict'), {test} = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT, P = K.authoring.scenePrefabs, {M,V} = K;
const link = {source:'west',instance:'east',plane:{origin:[.14,0,0],normal:[2,0,0]}};
const commit = {action:'commit',instance:'east'};
const render = (world,view) => R.render(world,{...view,raw:true,px:1,passes:['objectId']});

function setup(options = {}) {
  const {scene,library,view,request} = fixture();
  const source = {...scene,topologyMeshes:{},instances:{west:{prefab:'bay',transform:{
    translation:[-1.32,.06,.08],rotation:[.11,-.03,.09],scale:1.07,pivot:[.2,.1,0]}}},
    ...(options.carrier && {instances:{west:{...scene.instances.west,parent:'carrier'},carrier:{prefab:'locator',
      transform:{translation:[-.25,.31,.08],rotation:[.17,0,.12],scale:1.1}}}})};
  const env = {prefabs:{...library,locator:{revision:1,solids:{}}}};
  if (options.motion) {
    env.prefabs.bay.solids.body.part = 'arm';
    env.prefabs.bay.parts = {arm:{joint:[0,.44,-.13]}};
    env.prefabs.bay.motion = {turn:{do:'turn',part:'arm',axis:[.1,1,.3]}};
    env.prefabs.bay.effects = {lamp:{do:'lamp',at:[-.25,.7,.18],r:1.3,follow:'arm'}};
  }
  return {editor:ink.createSceneEditor(source,{env}),env,view:{...view,w:250,camera:{...view.camera,zoom:1.35}},request};
}

function near(actual,expected) {
  assert.equal(actual.length,expected.length);
  assert(actual.every((value,i)=>Math.abs(value-expected[i])<1e-7),
    `Expected ${actual} near ${expected}`);
}
const mirrorPoint = ([x,y,z]) => [.28-x,y,z];
const named = (result,id) => result.passes.objectId.reduce((sum,value)=>sum+Number(result.passes.objects[value]===id),0);

test('reflects geometry, winding and exact UV corner identity while linked',()=>{
  const {editor,env,view,request} = setup({motion:true}), input = editor.snapshot();
  const preview = editor.previewPrefabMirror(link);
  assert(preview.report.canCommit,JSON.stringify(preview.report));
  const after = render(preview.after,view);
  assert(named(after,'west.panel')>0 && named(after,'east.panel')>0);
  assert.deepEqual(editor.snapshot(),input);
  editor.applyPrefabMirror(link);
  const expanded = P.expand(editor.snapshot(),env), left = expanded.meshPlacements.get('west.panel');
  const right = expanded.meshPlacements.get('east.panel'), point = [.31,.23,.07];
  near(K.sceneGraph.point(right,point),mirrorPoint(K.sceneGraph.point(left,point)));
  assert(M.det(right.matrix)<0);
  const world = editor.build(), mesh = id => world.topologyMeshes[id+'.panel'].mesh;
  const a = K.meshTopology.triangleSource(mesh('west'),0), b = K.meshTopology.triangleSource(mesh('east'),0);
  assert.deepEqual(b,{face:a.face,corners:[a.corners[0],a.corners[2],a.corners[1]]});
  near(expanded.spec.effects[1].at,mirrorPoint(expanded.spec.effects[0].at));
  const [axis,mirrorAxis] = expanded.spec.motion.map(row=>row.axis);
  near(mirrorAxis,[axis[0],-axis[1],-axis[2]]);
  assert.deepEqual(expanded.spec.effects.map(row=>row.follow),['west.arm','east.arm']);
  assert.equal(expanded.spec.solids[1].id,'east.body');

  editor.editIsolatedPrefab(request);
  const edited = editor.build();
  assert.deepEqual(edited.topologyMeshes['east.panel'].document,edited.topologyMeshes['west.panel'].document);
  assert.deepEqual(editor.snapshot().instances.east,{mirror:{source:'west',plane:{origin:[.14,0,0],normal:[1,0,0]}}});
  assert.equal(editor.planPrefabIsolation({...request,instance:'east'}).conflicts[0].reason,'commit-live-mirror-first');
  editor.undo();
  assert.deepEqual(editor.snapshot().instances.west,input.instances.west);
});

test('an oblique working plane follows the source hierarchy and preserves the published pose through commit',()=>{
  const {editor,env,view,request} = setup({carrier:true});
  const plane = {origin:[0,0,-.03],right:[0,1,0],up:[-.13,0,1]};
  editor.setConstructionPlane(plane);
  editor.applyPrefabMirror({source:'west',instance:'east'});
  assert.deepEqual(editor.snapshot().instances.east.mirror.plane.origin,plane.origin);
  const original = P.placements(editor.snapshot().instances).get('east').mesh.position;
  const carrier = editor.snapshot().instances.carrier;
  editor.setPrefabInstance('carrier',{...carrier,transform:{...carrier.transform,translation:[-.55,.41,.08]}});
  const current = P.placements(editor.snapshot().instances);
  assert(V.dist(original,current.get('east').mesh.position)>.1);
  const {origin,normal} = editor.snapshot().instances.east.mirror.plane;
  near(current.get('east').mesh.position,V.mad(current.get('west').mesh.position,normal,
    -2*V.dot(V.sub(current.get('west').mesh.position,origin),normal)));
  editor.editIsolatedPrefab(request);
  const before = editor.snapshot(), preview = editor.previewPrefabMirror(commit);
  assert(preview.report.canCommit,JSON.stringify(preview.report));
  assert.deepEqual(render(preview.before,view).rgb,render(preview.after,view).rgb);
  editor.applyPrefabMirror(commit);
  const independent = editor.snapshot();
  assert(independent.instances.east.flipX);
  assert(!independent.instances.east.mirror);
  assert.deepEqual(independent.instances.east.meshOverrides,independent.instances.west.meshOverrides);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),independent);
  editor.setPrefabInstance('carrier',carrier);
  near(P.placements(editor.snapshot().instances).get('east').mesh.position,current.get('east').mesh.position);
  const pick = ink.pickTilesetRectangle(editor.snapshot(),'enamel',{x:24,y:0,width:24,height:24});
  editor.editIsolatedPrefab({instance:'east',faces:{panel:['sign']},edits:[
    {member:'panel',reskin:{face:'sign',selection:pick}}]});
  assert.notDeepEqual(editor.build().topologyMeshes['east.panel'].document,editor.build().topologyMeshes['west.panel'].document);
  editor.reparentPrefab({instance:'east',parent:'carrier'});
  const placed = P.expand(editor.snapshot(),env).instances.get('east');
  assert(M.det(placed.frame.matrix)<0);
  near(placed.frame.position,current.get('east').mesh.position);
});

test('interlocks dependent placements, reports shared source revisions and supports composition',()=>{
  const {editor,env,view} = setup();
  editor.applyPrefabMirror(link);
  const blocked = editor.planPrefabReparent({instance:'west',parent:'east'});
  assert.equal(blocked.conflicts[0].reason,'parent-cycle');
  assert.equal(editor.planPrefabMirror({source:'east',instance:'other'}).conflicts[0].reason,'choose-an-authored-source');
  assert.equal(editor.planPrefabMirror({...link,instance:'west'}).conflicts[0].reason,'instance-in-use');
  assert(editor.planPrefabVariant({instance:'west',mode:'detach'}).conflicts.some(row=>row.reason==='dependent-live-mirror'));
  const def = editor.planPrefabSourceEdit({instance:'west',sourceEdits:[{op:'set',path:'/solids/body/mat',value:'stone'}]});
  assert(def.canCommit,JSON.stringify(def));
  assert(def.instances.some(row=>row.instance==='east' && row.objects.includes('east.body')));
  const original = editor.snapshot();
  assert.throws(()=>ink.createSceneEditor({...original,instances:{east:original.instances.east}},{env}),/authored prefab source/);
  const module = editor.previewPrefabCombination({instances:['east','west'],prefab:'paired',mode:'replace',instance:'paired'});
  assert(module.report.canCommit,JSON.stringify(module.report));
  assert.deepEqual(render(module.before,view).rgb,render(module.after,view).rgb);
  editor.applyPrefabMirror(commit);
  const detached = editor.previewPrefabVariant({instance:'east',mode:'detach'});
  assert(detached.report.canCommit);
  assert.deepEqual(render(detached.before,view).rgb,render(detached.after,view).rgb);
});

test('CLI previews and commits a live external prefab mirror without altering inputs',t=>{
  const {editor,env,view} = setup(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-mirror-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','mirror-prefab',...args],{cwd:dir}));
  write('scene.json',editor.snapshot());
  write('library.json',env.prefabs);
  write('view.json',view);
  write('mirror.json',link);
  write('commit.json',commit);
  assert(run('scene.json','mirror.json','--out','live.json').canCommit);
  const merged = run('live.json','commit.json','--preview','review','--view','view.json','--out','independent.json');
  assert(merged.preview.instances.every(row=>row.beforePixels>0 && row.changedPixels===0));
  assert.equal(read('live.json').instances.east.mirror.source,'west');
  assert.equal(read('independent.json').instances.east.flipX,true);
  assert.deepEqual(read('scene.json'),editor.snapshot());
  const rejected = spawnSync(process.execPath,[cli,'mesh-topology','mirror-prefab','scene.json','commit.json',
    '--out','blocked.json'],{encoding:'utf8',cwd:dir});
  assert.equal(rejected.status,1);
  assert(!fs.existsSync(path.join(dir,'blocked.json')));
});
