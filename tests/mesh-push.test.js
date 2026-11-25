'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T = K.meshTopology;

function panels(id, rows) {
  return T.create({ id, vertices:rows.flatMap(([name,x0,x1,y0,y1,z]) =>
    [[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]].map((position,i) => ({id:name+'/'+i,position}))),
    faces:rows.map(([name]) => ({id:name,corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i) =>
      ({id:name+'/c'+i,vertex:name+'/'+i,uv}))})) });
}

const fixture=()=>{
  const moving=panels('plates',[['left',-2,-1,0,1,0],['right',1,2,0,1,.15]]);
  const obstacle=panels('stops',[['near',-2.1,-.9,-.1,1.1,.8],['far',.9,2.1,-.1,1.1,1.5]]);
  const scene={id:'push-bench',style:'slate',solids:[],topologyMeshes:{plates:{document:moving},stops:{document:obstacle}}};
  const selection=T.select(moving,{domain:'faces'});
  const operation={kind:'push',direction:[0,0,1],maxDistance:2,target:{object:'stops'}};
  return {scene,moving,obstacle,selection,operation};
};
function close(actual,expected) {
  assert(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);
}
const z=(doc,id)=>doc.vertices.find(row=>row.id===id).position[2];

test('individual pieces stop independently while a rigid assembly keeps all relative offsets',()=>{
  const {scene,selection,operation,moving}=fixture(), editor=ink.createSceneEditor(scene);
  for (const [mode,distances] of [['individual',[.7,1.25]],['assembly',[.7]]]) {
    const request={selection,operation:{...operation,mode,clearance:.1}};
    const preview=editor.planMeshTransform('plates',request);
    const report=preview.report.operation;
    assert.equal(report.groups.length,distances.length);
    assert.equal(report.target.revision,T.revision(scene.topologyMeshes.stops.document));
    report.groups.forEach((group,i)=>close(group.distance,distances[i]));
    assert.equal(report.groups[0].contact.target.id,'near');
    close(z(preview.document,'left/0'),.7);
    close(z(preview.document,'right/0'),mode==='assembly' ? .85 : 1.4);
    assert.deepEqual(preview.document.faces,moving.faces);
    assert.deepEqual(preview.document.edges,moving.edges);
    assert.deepEqual(editor.transformMeshTopology('plates',request).transform,preview.report);
    assert(editor.undo());
    assert.deepEqual(editor.snapshot(),scene);
  }
});

test('swept faces and edges catch narrow obstacles between their vertices',()=>{
  const moving=panels('plate',[['plate',-1,1,-1,1,0]]);
  const obstacle=panels('peg',[['middle',-.1,.1,-.1,.1,1],['rim',-.1,.1,-1.1,-.9,.65]]);
  const mesh=()=>({document:obstacle});
  const edge=moving.edges.find(({vertices})=>vertices.join()==='plate/0,plate/1');
  const operation={kind:'push',direction:[0,0,1],maxDistance:2,target:{object:'pegs',faces:['middle']}};
  const cast=(domain,ids,extra={})=>T.planTransform(moving,{selection:T.select(moving,{domain,ids}),
    operation:{...operation,...extra}},{mesh});
  const face=cast('faces',['plate']);
  assert.equal(face.report.operation.groups[0].contact.source.domain,'faces');
  close(face.report.operation.groups[0].distance,1);
  const rim=cast('edges',[edge.id],{target:{object:'pegs',faces:['rim']}});
  assert.equal(rim.report.operation.groups[0].contact.source.domain,'edges');
  close(rim.report.operation.groups[0].distance,.65);
  const vertices=cast('vertices',['plate/0','plate/1']);
  assert.deepEqual(vertices.patch.vertices,[]);
  assert(vertices.report.operation.groups.every(({status})=>status==='miss'));
});

test('coplanar contact, initial contact, miss policy and pair budget have deterministic evidence',()=>{
  const moving=panels('plate',[['moving',-2,-1,0,1,0],['stop',0,1,0,1,0]]);
  const selection=T.select(moving,{domain:'faces',ids:['moving']});
  const operation={kind:'push',direction:[1,0,0],maxDistance:2};
  const first=T.planTransform(moving,{selection,operation});
  close(first.report.operation.groups[0].distance,1);
  assert.equal(first.report.operation.groups[0].contact.target.id,'stop');
  assert.equal(first.report.operation.target.triangles,2);
  const placed=first.document;
  const again=T.planTransform(placed,{selection:T.select(placed,{domain:'faces',ids:['moving']}),operation});
  assert.equal(again.report.operation.groups[0].contact.distance,0);
  assert.deepEqual(again.patch.vertices,[]);
  const away={...operation,direction:[-1,0,0]};
  assert.deepEqual(T.planTransform(moving,{selection,operation:away}).patch.vertices,[]);
  close(T.planTransform(moving,{selection,operation:{...away,miss:'limit'}}).report.operation.groups[0].distance,2);
  assert.throws(()=>T.planTransform(moving,{selection,operation:{...away,miss:'error'}}),/missed its target/);
  assert.throws(()=>T.planTransform(moving,{selection,operation:{...operation,maxPairs:1}}),/contact pair limit/);
  assert.throws(()=>T.planTransform(moving,{selection,operation:{...operation,target:{faces:['moving']}}}),/must remain stationary/);
});

test('shared vertices keep selected edges together and a pin holds its rigid group',()=>{
  const {moving,selection,operation,obstacle}=fixture(), mesh=()=>({document:obstacle});
  const pins={vertices:['left/0']};
  const independent=T.planTransform(moving,{selection,operation,pins},{mesh});
  assert.deepEqual(independent.report.operation.groups.map(({status})=>status),['pinned','contact']);
  assert(!independent.patch.vertices.some(({id})=>id.startsWith('left/')));
  const assembly=T.planTransform(moving,{selection,pins,operation:{...operation,mode:'assembly'}},{mesh});
  assert.deepEqual(assembly.patch.vertices,[]);
  assert.equal(assembly.report.operation.groups[0].status,'pinned');
  const ids=moving.edges.filter(edge=>edge.vertices.includes('left/0')).map(edge=>edge.id);
  const edges=T.select(moving,{domain:'edges',ids});
  const edgePlan=T.planTransform(moving,{selection:edges,operation},{mesh});
  assert.deepEqual(edgePlan.report.operation.groups[0].vertices,['left/0','left/1','left/3']);
});

test('the planner respects authored seams on coincident copies and scales reach in world units',()=>{
  const {moving,obstacle,operation}=fixture();
  const withCopy=T.edit(moving,{vertices:[{id:'copy',position:moving.vertices[0].position}]});
  const frame={position:[0,0,0],scale:[1,1,2]}, mesh=()=>({document:obstacle});
  const selection=T.select(withCopy,{domain:'vertices',ids:['left/0']});
  const plan=T.planTransform(withCopy,{selection,operation,frame,coincident:{tolerance:0}},{mesh});
  assert.deepEqual(plan.report.operation.groups[0].vertices,['copy','left/0']);
  close(z(plan.document,'copy'),.4);
  close(z(plan.document,'left/0'),.4);
  const edge=withCopy.edges.find(({vertices})=>vertices.includes('left/0'));
  const seamed=T.edit(withCopy,{edges:[{id:edge.id,uvSeam:true}]});
  const blocked=T.planTransform(seamed,{selection:T.select(seamed,{domain:'vertices',ids:['left/0']}),
    operation,frame,coincident:true},{mesh});
  assert.equal(blocked.report.coincident.blocked[0].reason,'authored-seam');
  assert.deepEqual(blocked.patch.vertices.map(({id})=>id),['left/0']);
});

test('isolated prefab pushes use the placed source and working-plane direction',()=>{
  const {scene,moving,operation}=fixture();
  delete scene.topologyMeshes.plates;
  scene.constructionPlane={right:[0,0,1],up:[0,1,0]};
  scene.instances={rig:{prefab:'panels',transform:{translation:[0,0,.2]}}};
  const prefabs={panels:{revision:1,solids:{},topologyMeshes:{plates:{document:moving}}}};
  const editor=ink.createSceneEditor(scene,{env:{prefabs}});
  const request={instance:'rig',faces:{plates:['left']},edits:[{member:'plates',
    transform:{space:'plane',operation:{...operation,direction:[1,0,0]}}}]};
  const preview=editor.planPrefabIsolation(request);
  assert(preview.canCommit);
  assert.deepEqual(preview.edits[0].evidence.operation.direction,[0,0,1]);
  close(preview.edits[0].evidence.operation.groups[0].distance,.6);
  editor.editIsolatedPrefab(request);
  const next=editor.snapshot().instances.rig.meshOverrides.plates.mesh.document;
  close(z(next,'left/0'),.6);
  assert.equal(z(next,'right/0'),z(moving,'right/0'));
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('headless transforms hit a placed prefab target, with matching preview and commit receipts',t=>{
  const {scene,obstacle,selection,operation,moving}=fixture();
  delete scene.topologyMeshes.stops;
  scene.prefabLibrary='library.json';
  scene.instances={rig:{prefab:'fixture',transform:{translation:[0,0,.2]}}};
  const library={fixture:{revision:1,solids:{},topologyMeshes:{stops:{document:obstacle}}}};
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-push-test-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write=(file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const read=file=>JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('original.json',scene);
  write('library.json',library);
  write('request.json',{selection,operation:{...operation,mode:'assembly',target:{object:'rig.stops'}}});
  const args=['transform','original.json','request.json','--object','plates'];
  const preview=JSON.parse(run(...args));
  run(...args,'--out','pushed.json','--report','receipt.json');
  assert.deepEqual(preview.report,read('receipt.json').transform);
  close(preview.report.operation.groups[0].distance,1);
  assert.equal(preview.report.operation.target.object,'rig.stops');
  assert.deepEqual(read('original.json'),scene);
  assert.deepEqual(read('pushed.json').topologyMeshes.plates.document.faces,moving.faces);
});
