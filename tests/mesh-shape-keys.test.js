const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const kit=ink.load(), {KIT:K,makeBuilder}=kit, T=K.meshTopology;
const {V,M}=K;
const compare=(a,b,eps=1e-5)=>Array.from(a).forEach((n,i)=>assert(Math.abs(n-b[i])<eps,n+' vs '+b[i]));
const rotation=angle=>M.rot([0,0,1],angle*Math.PI/180);
const affine=angle=>[...rotation(angle),0,0,0];
const pose=angle=>({id:'swing-'+angle,matrices:{body:affine(0),elbow:affine(angle)},rotations:{elbow:rotation(angle)}});

function model() {
  const positions=[0,0,0,1,0,0,0,1,0,1,1,0];
  const doc=T.fromIndexed({id:'hinge',positions,indices:[0,1,2,1,3,2],skin:{joints:['body','elbow']},
    uvs:[0,0,1,0,0,1,1,1],weights:[{body:1},{body:.3,elbow:.7},{elbow:1},{elbow:1}]});
  const face=doc.faces[1], corners=face.corners.map((row,i)=>i===0 ? {...row,uv:[.8,.1]} : row);
  return T.edit(doc,{faces:[{...face,corners}]});
}
function vertex(mesh,id) {
  const xyz=K.sceneMeshes.geometry(mesh).positions;
  return Array.from({length:mesh.vertices},(_,i)=>i).filter(i=>T.sourceVertex(mesh,i)===id)
    .map(i=>Array.from(xyz.subarray(i*3,i*3+3)));
}
const edit=()=>({destination:'pose',id:'spring',pose:pose(80),drivers:[{part:'elbow',radius:40}],
  moves:[{vertex:'v/1',move:[.15,.11,0],keys:[{at:.5,move:[.09,.02,0]}]}]});

test('a captured mesh offset lands at its named pose and follows the shared morph sampler',()=>{
  const doc=model(), request=edit(), plan=T.shapeKeys.plan(doc,request);
  assert.equal(plan.document,doc);
  assert.equal(plan.report.restChanged,false);
  assert.equal(plan.report.beforeRevision,plan.report.afterRevision);
  const plain=T.toSceneMesh(doc), mesh=T.toSceneMesh(doc), skin=T.skin.bind(plain), keys=T.shapeKeys.bind(mesh,plan.shapeKeys);
  assert.equal(vertex(mesh,'v/1').length,2);
  const {matrices,rotations}=request.pose;
  skin.pose(matrices);
  keys.pose(matrices,{rotations});
  assert.equal(keys.state()[0].weight,1);
  const original=vertex(plain,'v/1')[0];
  for (const p of vertex(mesh,'v/1')) compare(p,V.add(original,[.15,.11,0]));
  keys.morph({spring:.5},matrices);
  for (const p of vertex(mesh,'v/1')) compare(p,V.add(original,[.09,.02,0]));
  const half=pose(60);
  keys.pose(half.matrices,half);
  compare([keys.state()[0].weight],[.5]);
  const neutral=pose(0);
  skin.pose(neutral.matrices);
  keys.pose(neutral.matrices,neutral);
  assert.deepEqual(K.sceneMeshes.geometry(mesh).positions,K.sceneMeshes.geometry(plain).positions);
  keys.rest();
  assert(keys.state().every(row=>row.weight===0));
});

test('pose and rest revisions share a scene undo journal and stale corrections are visible',()=>{
  const doc=model(), scene={id:'hinge-scene',solids:[],topologyMeshes:{guard:{document:doc}}}, editor=ink.createSceneEditor(scene);
  assert.throws(()=>T.shapeKeys.plan(doc,{moves:edit().moves}),/explicit rest or pose/);
  const poseEdit=editor.editMeshShapeKeys('guard',edit());
  assert.equal(poseEdit.shape.restChanged,false);
  const authored=editor.snapshot().topologyMeshes.guard;
  assert.equal(editor.build().topologyMeshes.guard.shapeKeyStatus,'ready');
  assert.equal(poseEdit.changes.shapeKeys[0].id,'spring');
  const {shape}=editor.editMeshShapeKeys('guard',{destination:'rest',moves:[{vertex:'v/1',move:[.04,0,0]}]});
  assert.equal(shape.restChanged,true);
  assert.equal(shape.shapeKeyStatus,'needs-recapture');
  const stale=editor.build().topologyMeshes.guard;
  assert.equal(stale.shapeKeyStatus,'needs-recapture');
  assert.equal(stale.shapeKeys,undefined);
  assert.throws(()=>T.shapeKeys.bind(stale.mesh,authored.shapeKeys),/different rest revision/);
  assert.equal(editor.undo(),true);
  assert.equal(editor.build().topologyMeshes.guard.shapeKeyStatus,'ready');
  assert(editor.redo());
  assert.equal(editor.build().topologyMeshes.guard.shapeKeyStatus,'needs-recapture');
  const recaptured=editor.editMeshShapeKeys('guard',edit());
  assert.deepEqual(recaptured.shape.replacedStaleKeys,['spring']);
  assert.equal(editor.build().topologyMeshes.guard.shapeKeyStatus,'ready');
  const removal=editor.editMeshShapeKeys('guard',{destination:'pose',id:'spring',remove:true});
  assert.equal(removal.shape.restChanged,false);
  assert.deepEqual(editor.snapshot().topologyMeshes.guard.shapeKeys.keys,[]);
});

test('one puppet rotation drives mesh keys and existing splat correctives together',()=>{
  const B=makeBuilder(14,[0x161d2a,0xe2a46f]), doc=model();
  B.disc(-.5,0,0,[0,0,1],.1,.03,B.P[1],2);
  B.disc(.55,.1,.2,[0,0,1],.18,.03,B.P[1],2);
  const world=B.finish({});
  const puppet=K.puppet(world,{parts:{body:{ids:[0],pivot:[0,0,0]},
    elbow:{ids:[1],parent:'body',pivot:[0,0,0]}}});
  puppet.pose.elbow={rot:[0,0,80]};
  puppet.flush();
  const point=Array.from(K.bones.posed(world).slice(16,19));
  const corrective=puppet.correctives.capture({id:'bent collar',drivers:[{part:'elbow',radius:40}],
    strokes:[{at:point,radius:.15,move:[0,.07,0]}]});
  const plan=T.shapeKeys.plan(doc,{destination:'pose',id:'mesh-collar',pose:{id:'raised',
    ...puppet.correctives.meshPose(doc.skin.joints)},corrective,moves:[{vertex:'v/1',move:[.07,0,0]}]});
  const mesh=T.toSceneMesh(doc), keys=T.shapeKeys.bind(mesh,plan.shapeKeys);
  const disconnect=puppet.correctives.attachMesh(keys);
  puppet.correctives.set([corrective]);
  for (const [angle,w] of [[80,1],[60,.5],[40,0],[20,0]]) {
    puppet.pose.elbow={rot:[0,0,angle]};
    puppet.flush();
    compare([keys.state()[0].weight,puppet.correctives.state()[0].weight],[w,w]);
  }
  assert(disconnect());
  puppet.pose.elbow={rot:[0,0,80]};
  puppet.flush();
  compare([keys.state()[0].weight,puppet.correctives.state()[0].weight],[0,1]);
});
