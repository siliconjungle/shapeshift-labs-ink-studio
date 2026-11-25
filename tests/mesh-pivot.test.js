'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { fixture } = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const assets = require('../examples/asset-part-revisions.cjs');
const { KIT: K } = ink.load(), topology = K.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const mesh = topology.fromIndexed({ id:'panel', positions:[0,0,0,4,0,0,0,2,0], indices:[0,1,2] });
const face = topology.select(mesh,{domain:'faces'});
const edge = mesh.edges.find(row=>row.vertices.join() === 'v/0,v/1');
const close = (actual, expected) => assert(actual.length === expected.length &&
  actual.every((value,i)=>Math.abs(value-expected[i]) < 1e-8), JSON.stringify({actual,expected}));

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-pivot-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const at = file => path.join(cwd,file);
  const call = (...args) => execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  return { at, call, run: (...args)=>JSON.parse(call(...args)),
    write: (file,value)=>fs.writeFileSync(at(file),JSON.stringify(value)),
    read: file=>JSON.parse(fs.readFileSync(at(file),'utf8')),
    reject: (...args)=>spawnSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'}) };
}

test('pivot placement samples edge, vertex and selection anchors without changing topology',()=>{
  const frame = {matrix:[0,-2,0, 2,0,0, 0,0,2],position:[3,4,1]};
  const before = topology.revision(mesh);
  const place = (target, context)=>topology.planPivot(mesh,{frame,target,revision:before},context);
  const corner = place({kind:'vertex',id:'v/2'});
  assert.deepEqual(corner.after,{local:[0,2,0],world:[-1,4,1]});
  const midpoint = place({kind:'edge',id:edge.id});
  assert.deepEqual(midpoint.after,{local:[2,0,0],world:[3,8,1]});
  const directed = place({kind:'edge',id:edge.id,from:'v/1',at:.25},{pivot:corner.after.local});
  assert.deepEqual(directed.before,corner.after);
  assert.deepEqual(directed.after,{local:[3,0,0],world:[3,10,1]});
  assert.deepEqual(directed.target.vertices,['v/1','v/0']);
  assert.equal(place({kind:'edge',id:edge.id},{pivot:midpoint.after.local}).changed,false);
  const center = place({kind:'center',selection:face});
  close(center.after.local,[4/3,2/3,0]);
  assert.deepEqual(place({kind:'center',mode:'bounds',selection:face}).after.local,[2,1,0]);
  const other = place({kind:'vertex',object:'guide',id:'v/1'},
    {mesh:id=>id==='guide' && {document:mesh,frame:{position:[9,0,0]}}});
  close(other.after.local,[-2,-5,-.5]);
  close(other.after.world,[13,0,0]);
  assert.deepEqual(place({kind:'point',point:[3,4,1],space:'world'}).after.local,[0,0,0]);
  assert.equal(place(null,{pivot:midpoint.after.local}).after,null);
  assert.throws(()=>place({kind:'edge',id:edge.id,at:1.1}),/edge ID and fraction/);
  assert.throws(()=>place({kind:'edge',id:edge.id,from:'v/2'}),/one of its endpoints/);
  assert.throws(()=>topology.planPivot(mesh,{target:{kind:'point',point:[0,0,0]},revision:'stale'}),/current topology revision/);
  assert.equal(topology.revision(mesh),before);
});

test('a scene pivot is undoable metadata and takes precedence over transform defaults',()=>{
  const scene = {id:'pivot-bench',style:'slate',solids:[],
    constructionPlane:{origin:[1,1,0],right:[0,1,0],up:[-1,0,0]},
    topologyMeshes:{panel:{document:mesh,part:'flag',bindings:[{id:'paint',domain:'faces',element:'f/0',data:{kind:'test'}}],
      bakes:[{id:'enamel',material:'default',maps:{texture:{width:1,height:1,pixels:[21,109,119,255]}}}]}},
    prefabs:{stand:{revision:1,solids:{}}},
    instances:{post:{prefab:'stand',transform:{translation:[2,0,0],pivot:[1,0,0],scale:2}}}};
  const editor = ink.createSceneEditor(scene), report = editor.setMeshPivot('panel',{target:{kind:'vertex',id:'v/0'}},{part:'flag'});
  assert.deepEqual(report.after.local,[0,0,0]);
  assert.deepEqual(editor.snapshot(),{...scene,topologyMeshes:{panel:{...scene.topologyMeshes.panel,pivot:[0,0,0]}}});
  assert.equal(topology.revision(editor.meshTopology('panel').document),face.revision);
  const request = {space:'plane',selection:face,operation:{kind:'scale',factors:2}};
  const plan = editor.planMeshTransform('panel',request);
  assert.deepEqual(plan.report.worldPivot,[0,0,0]);
  assert.equal(plan.report.pivotSource,'retained');
  assert.deepEqual(plan.document.vertices[1].position,[8,0,0]);
  assert.deepEqual(editor.planMeshTransform('panel',{...request,planePivot:[1,0]}).report.worldPivot,[1,2,0]);
  assert.deepEqual(editor.planMeshTransform('panel',{...request,pivot:[3,3,0]}).report.worldPivot,[3,3,0]);
  const anchor = editor.planMeshPivot('panel',{target:{kind:'instance',instance:'post'}});
  assert.deepEqual(anchor.after.world,[1,0,0]);
  assert.equal(anchor.target.instanceKind,'prefab');
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.equal(editor.setMeshPivot('panel',{target:null}).after,null);
  assert.deepEqual(editor.snapshot(),scene);
});

test('named instance pivots can use the existing bound asset socket',async t=>{
  const {at} = workspace(t);
  ink.writeGltfAsset(assets.source(1),{out:at('relay.glb')});
  const placement = assets.scene().assetParts.relay;
  const imported = await ink.readAssetRevisionPart(at('relay.glb'),'relay',placement);
  const editor = ink.createSceneEditor({id:'socket-pivot',solids:[],topologyMeshes:{panel:{document:mesh}},
    assetParts:{relay:placement}},{env:{assetPartImports:{relay:imported}}});
  const report = editor.planMeshPivot('panel',{target:{kind:'instance',instance:'relay',anchor:'lamp'}});
  close(report.after.world,imported.part.bindings.lamp.resolved.position);
  assert.equal(report.target.anchor,'lamp');
});

test('an isolated prefab batch sets a local pivot and uses it for the following operation',()=>{
  const {scene,library,request,panel,shared} = fixture();
  scene.instances.west.transform.rotation = [.5,0,0];
  const editor = ink.createSceneEditor(scene,{env:{prefabs:library}});
  const hinge = panel.document.edges.find(row=>shared.every(id=>row.vertices.includes(id)));
  const edit = {...request,edits:[{member:'panel',pivot:{target:{kind:'edge',id:hinge.id}}},
    {member:'panel',transform:{operation:{kind:'rotate',axis:[0,1,0],degrees:23},pins:{vertices:shared}}}]};
  const report = editor.editIsolatedPrefab(edit), pivot = report.edits[0], rotated = report.edits[1];
  assert.equal(pivot.beforeRevision,pivot.afterRevision);
  assert.deepEqual(pivot.changedFaces,[]);
  assert.deepEqual(rotated.evidence.pivot,pivot.evidence.after.local);
  close(rotated.evidence.worldPivot,pivot.evidence.after.world);
  assert.deepEqual(rotated.changedFaces,['sign']);
  assert.deepEqual(editor.snapshot().instances.east,scene.instances.east);
  const center = editor.planPrefabIsolation({...request,edits:[{member:'panel',pivot:{target:{kind:'center'}}}]});
  assert.deepEqual(center.edits[0].evidence.target.selection.ids,['sign']);
});

test('headless scene pivots and standalone pivot files preserve revisions and remain reusable',t=>{
  const {call,run,write,read,reject} = workspace(t);
  const scene = {id:'pivot-scene',style:'slate',solids:[],topologyMeshes:{panel:{document:mesh}}};
  const target = {target:{kind:'center',mode:'bounds'}};
  write('scene.json',scene);
  write('mesh.json',mesh);
  write('pick.json',face);
  write('pivot-request.json',target);
  const placed = run('pivot','scene.json','pivot-request.json','--object','panel','--selection','pick.json','--out','pivoted.json');
  assert.deepEqual(placed.after.local,[2,1,0]);
  assert.deepEqual(read('pivoted.json').topologyMeshes.panel,{document:mesh,pivot:[2,1,0]});
  assert.deepEqual(run('pivot','pivoted.json','--object','panel').before,placed.after);
  assert.deepEqual(read('scene.json'),scene);

  run('pivot','mesh.json','pivot-request.json','--selection','pick.json','--out','saved-pivot.json');
  const rotate = {selection:face,operation:{kind:'rotate',axis:[0,0,1],degrees:90}};
  write('rotate.json',rotate);
  const preview = run('transform','mesh.json','rotate.json','--pivot','saved-pivot.json');
  assert.deepEqual(preview.report.worldPivot,[2,1,0]);
  call('transform','mesh.json','rotate.json','--pivot','saved-pivot.json','--out','rotated.json');
  const next = read('rotated.json');
  write('again.json',{...rotate,selection:topology.select(next,{domain:'faces'})});
  assert.deepEqual(run('transform','rotated.json','again.json','--pivot','saved-pivot.json').report.worldPivot,[2,1,0]);
  assert.match(reject('pivot','mesh.json','pivot-request.json','--selection','pick.json','--out','mesh.json').stderr,/separate pivot output/);
});
