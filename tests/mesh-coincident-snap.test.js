'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { fixture } = require('../examples/tileset-pick/coincident-snap-fixture.cjs');
const { KIT: K } = ink.load(), T = K.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const close = (actual, expected) => assert(actual.every((x,i)=>Math.abs(x-expected[i])<1e-8), JSON.stringify({actual,expected}));
const positions = document => new Map(document.vertices.map(row=>[row.id,row.position]));

test('endpoint snaps reach a placed prefab edge while compatible copies travel and authored seams hold', ()=>{
  const { scene,library,document,request,offset } = fixture();
  const editor=ink.createSceneEditor(scene,{env:{prefabs:library}});
  const baseline = editor.planMeshTransform('panels',{...request,coincident:false});
  assert(!baseline.report.coincident);
  assert(!baseline.patch.vertices.some(row=>row.id.startsWith('east/')));
  const preview=editor.planMeshTransform('panels',request), before=positions(document), after=positions(preview.document);
  assert.deepEqual(preview.report.snap.pairs.map(({source,target})=>[source,target]),[['sign/v1','base'],['sign/v2','top']]);
  assert(preview.report.snap.residual < 1e-8);
  for (const [a,b] of [['sign/v1','east/v0'],['sign/v2','east/v3']]) {
    assert.deepEqual(after.get(a),after.get(b));
    close(K.V.sub(after.get(a),before.get(a)),offset);
  }
  assert.deepEqual(after.get('west/v1'),before.get('west/v1'));
  assert(preview.report.coincident.blocked.some(row=>row.reason==='authored-seam' && row.edges.includes('west/right')));
  assert.deepEqual(preview.document.faces,document.faces);
  assert.deepEqual(preview.document.edges,document.edges);
  editor.transformMeshTopology('panels',request);
  assert.deepEqual(editor.meshTopology('panels').document,preview.document);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('split edge UV discontinuities on any layout block copy travel across the whole edge',()=>{
  const { document }=fixture();
  const changed=T.edit(document,{faces:document.faces.map(face=>({...face,corners:face.corners.map((corner,i)=>({
    ...corner,attributes:{'uv/1':face.id==='east' && i===0 ? [.1,.85] : corner.uv}
  }))}))});
  const selection=T.select(changed,{domain:'vertices',ids:['sign/v2']});
  const plan=T.planTransform(changed,{selection,coincident:true,operation:{kind:'move',offset:[0,.12,0]}});
  assert.deepEqual(plan.patch.vertices.map(row=>row.id),['sign/v2']);
  assert.deepEqual(plan.report.coincident.blocked,[{vertices:['east/v3','sign/v2'],reason:'uv-discontinuity',edges:['east/left','sign/right']}]);
  const painted=T.edit(document,{edges:[{id:'east/left',uvSeams:{2:true}}]});
  const alternate=T.planTransform(painted,{selection:T.select(painted,{domain:'vertices',ids:['sign/v2']}),
    coincident:true,operation:{kind:'move',offset:[0,.12,0]}});
  assert.deepEqual(alternate.patch.vertices.map(row=>row.id),['sign/v2']);
  assert.equal(alternate.report.coincident.blocked[0].reason,'authored-seam');
});

test('world tolerance keeps near copies at the same offset and any eligible pin holds the group',()=>{
  const {document}=fixture(), original=positions(document);
  const epsilon = .00004;
  const changed=T.edit(document,{vertices:['east/v0','east/v3'].map(id=>({id,position:K.V.add(original.get(id),[epsilon,0,0])}))});
  const selection=T.select(changed,{domain:'vertices',ids:['sign/v1']});
  const options={selection,frame:{scale:2},pivot:[0,0,0],operation:{kind:'rotate',axis:[0,0,1],degrees:17}};
  const strict=T.planTransform(changed,{...options,coincident:{tolerance:.00005}});
  assert.deepEqual(strict.patch.vertices.map(row=>row.id),['sign/v1']);
  const matched=T.planTransform(changed,{...options,coincident:{tolerance:.0001}});
  const after=positions(matched.document);
  close(K.V.sub(after.get('east/v0'),after.get('sign/v1')),[epsilon,0,0]);
  const held=T.planTransform(changed,{...options,coincident:{tolerance:.0001},pins:{vertices:['east/v0']}});
  assert.deepEqual(held.patch.vertices,[]);
  assert.deepEqual(held.report.pinned,['east/v0','sign/v1']);
  assert.equal(held.report.coincident.groups[0].held,true);
  assert.throws(()=>T.planTransform(changed,{...options,coincident:{tolerance:.0001,maxPairs:1}}),/pair limit/);
});

test('source edge fractions and endpoint matching use proposed positions and validate constraints',()=>{
  const source=T.fromIndexed({id:'source',positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]});
  const target=T.fromIndexed({id:'target',positions:[3,5,0,3,4,0,4,4,0],indices:[0,1,2]});
  const id=doc=>doc.edges.find(edge=>edge.vertices.join()==='v/0,v/1').id;
  const anchor={edge:id(source),from:'v/0'};
  const request={selection:T.select(source,{domain:'faces'}),pivot:[0,0,0],
    operation:{kind:'rotate',axis:[0,0,1],degrees:90},
    snap:{kind:'edge',id:id(target),object:'phone',anchor,match:'endpoints',maxDistance:5}};
  const context={mesh:()=>({document:target})};
  const end=T.planTransform(source,request,context);
  close(positions(end.document).get('v/0'),[3,4,0]);
  close(positions(end.document).get('v/1'),[3,5,0]);
  assert.deepEqual(end.report.snap.pairs.map(row=>row.target),['v/1','v/0']);
  const quarter=T.planTransform(source,{...request,snap:{kind:'vertex',id:'v/0',object:'phone',anchor:{...anchor,at:.25}}},context);
  close(quarter.report.snap.from,[0,.25,0]);
  close(quarter.report.snap.point,[3,5,0]);
  const onEdge=T.planTransform(source,{...request,snap:{kind:'edge',id:id(target),object:'phone',from:'v/1',at:.25,anchor:'v/0'}},context);
  close(onEdge.report.snap.point,[3,4.25,0]);
  assert(!Object.isFrozen(anchor));
  assert.throws(()=>T.planTransform(source,{...request,operation:{kind:'scale',factors:2}},context),/matching length and direction/);
  assert.throws(()=>T.planTransform(source,{...request,pins:{vertices:['v/1']}},context),/two unpinned endpoints/);
  assert.throws(()=>T.planTransform(source,{...request,snap:{...request.snap,maxDistance:4}},context),/maximum distance/);
});

test('headless transform and vertex shortcut publish the planned coincident edits',t=>{
  const {scene,library,request,document}=fixture();
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-coincident-snap-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('scene.json',scene);
  write('library.json',library);
  write('request.json',request);
  run('transform','scene.json','request.json','--object','panels','--out','snapped.json','--report','receipt.json');
  assert.deepEqual(read('receipt.json').transform.snap.pairs.map(row=>row.source),['sign/v1','sign/v2']);
  const moved=positions(read('snapped.json').topologyMeshes.panels.document);
  assert.deepEqual(moved.get('east/v0'),moved.get('sign/v1'));
  assert.deepEqual(read('scene.json'),scene);
  write('mesh.json',document);
  const snap=JSON.parse(run('move','mesh.json','--vertex','sign/v1','--by','0,.1,0','--coincident','--coincident-distance','0'));
  assert.deepEqual(snap.vertices.map(row=>row.id),['east/v0','sign/v1']);
});
