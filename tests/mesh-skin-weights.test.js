const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT:K } = ink.load();
const topology = K.meshTopology, weights = topology.skin;

function fixture() {
  const vertices = [
    {id:'left-low',position:[-1,0,0],weights:{body:.25,rest:.75,cloth:.3}},
    {id:'left-high',position:[-1,1,0],weights:{body:.25,rest:.75}},
    {id:'spine-low',position:[0,0,0],weights:{body:1}},
    {id:'spine-high',position:[0,1,0],weights:{body:1}},
    {id:'right-low',position:[1,0,0],weights:{body:.4,rest:.6}},
    {id:'right-high',position:[1,1,0],weights:{body:.25,rest:.75}}
  ];
  const triangle = (id, order, flip) => ({id,corners:order.map((vertex,i)=>({id:id+'/'+i,vertex,
    uv:flip ? [[1,1],[1,0],[0,1]][i] : [[0,0],[0,1],[1,0]][i]}))});
  const faces = [
    triangle('a',['left-low','spine-low','left-high']),
    triangle('b',['left-high','spine-low','spine-high'],true),
    triangle('c',['spine-low','right-low','right-high']),
    triangle('d',['spine-low','right-high','spine-high'],true)
  ];
  return topology.create({id:'wings',vertices,faces,skin:{
    joints:['body','rest','left','right','trim','tip'],locked:['body'],mirrors:[['left','right']]
  }});
}
const get = (doc,id) => doc.vertices.find(row=>row.id===id).weights;
const identity = [1,0,0,0,1,0,0,0,1,0,0,0];

test('named assignment, brush falloff, mirroring and locks share one normalized preview',()=>{
  const doc = fixture(), source = topology.select(doc,{domain:'faces',ids:['a']});
  const edit = weights.plan(doc,{revision:topology.revision(doc),operations:[
    {op:'assign',joint:'left',weight:.5,selection:['left-low']},
    {op:'paint',joint:'left',weight:.5,at:[-1,0,0],radius:2,strength:1,falloff:'linear',selection:source},
    {op:'mirror',selection:['left-low','left-high','spine-low']},
    {op:'assign',joint:'body',weight:0,selection:['left-low']}
  ]});
  assert(edit.report.canCommit);
  assert.deepEqual(get(edit.document,'left-low'),{body:.25,cloth:.3,left:.5,rest:.25});
  assert.deepEqual(get(edit.document,'left-high'),{body:.25,left:.25,rest:.5});
  const right = get(edit.document,'right-low');
  assert.equal(right.body,.4);
  assert(Math.abs(right.right-.4)<1e-12);
  assert(Math.abs(right.rest-.2)<1e-12);
  assert.deepEqual(get(edit.document,'right-high'),{body:.25,rest:.5,right:.25});
  assert(edit.report.notes.some(row=>row.reason==='joint-locked'));
  assert(edit.report.notes.some(row=>row.reason==='mirror-centerline'));
  assert(edit.report.changes.every(row=>Math.abs(row.after.effectiveTotal-1)<1e-12));
  assert.deepEqual(topology.edit(doc,edit.patch),edit.document);
  assert.throws(()=>weights.plan(edit.document,{operations:[{op:'mirror',selection:source}]}),/same topology revision/);
});

test('normalization trims only editable influences and locking preserves the displayed pose weights',()=>{
  const doc = fixture(), vertex = doc.vertices[0];
  const old = topology.edit(doc,{vertices:[{...vertex,weights:{body:.25,left:.9,right:.8,rest:.7,trim:.7,tip:.4}}]});
  const [prior] = weights.inspect(old,[vertex.id]).vertices;
  assert(Math.abs(prior.total-3.75)<1e-12);
  assert.deepEqual(prior.dropped,['trim','tip']);
  assert.equal(prior.effective.body,.25);
  const edit = weights.plan(old,{operations:[{op:'lock',joint:'left',locked:true},{op:'normalize',selection:[vertex.id]}]});
  const [after] = weights.inspect(edit.document,[vertex.id]).vertices;
  assert.deepEqual(after.effective,prior.effective);
  assert.deepEqual(after.authored,prior.effective);
  assert(edit.document.skin.locked.includes('left'));
  assert.deepEqual(weights.plan(edit.document,{operations:[{op:'normalize',selection:[vertex.id]}]}).patch,{});
  const invalid = topology.edit(doc,{skin:{...doc.skin,locked:['body','rest']},
    vertices:[{...vertex,weights:{body:.7,rest:.7}}]});
  const result = weights.plan(invalid,{operations:[{op:'normalize'}]});
  assert.equal(result.report.canCommit,false);
  assert.deepEqual(result.report.problems,[{id:vertex.id,reason:'locked-influences-exceed-budget'}]);
});

test('ambiguous rest-space mirror reports the alternative vertices without editing them',()=>{
  const doc = fixture();
  const ambiguous = topology.edit(doc,{vertices:[
    {id:'other-right',position:[1,0,0]},
    {id:'left-duplicate',position:[-1,0,0]}
  ]});
  const result = weights.plan(ambiguous,{operations:[{op:'mirror',selection:['left-low']}]});
  assert.deepEqual(result.patch,{});
  assert.deepEqual(result.report.notes,[{operation:0,vertex:'left-low',reason:'ambiguous-mirror',
    candidates:['other-right','right-low']}]);
});

test('normal rendering uses named weights on every UV seam copy and keeps the rest mesh',()=>{
  const doc = weights.plan(fixture(),{operations:[{op:'assign',joint:'left',weight:.5,selection:['left-high']}]}).document;
  const mesh = topology.toSceneMesh(doc), binding = weights.bind(mesh);
  const pose = Object.fromEntries(binding.joints.map(joint=>[joint,identity.slice()]));
  pose.left[10] = 2;
  binding.pose(pose);
  const positions = K.sceneMeshes.geometry(mesh).positions;
  const copies = Array.from({length:mesh.vertices},(_,i)=>i)
    .filter(i=>topology.sourceVertex(mesh,i)==='left-high');
  assert.equal(copies.length,2);
  for (const i of copies) assert.deepEqual([...positions.subarray(i*3,i*3+3)],[-1,2,0]);
  binding.pose(binding.joints.flatMap(()=>identity));
  for (const i of copies) assert.equal(K.sceneMeshes.geometry(mesh).positions[i*3+1],1);
  assert.throws(()=>binding.pose({left:identity}),/each joint/);
});

test('scene skin edits use the shared journal and publish the native rig binding',()=>{
  const doc = fixture(), scene = { id:'skin-test', solids:[], topologyMeshes:{wing:{document:doc}},
    camera:{target:[0,.5,0],dist:3,yaw:0,pitch:0} };
  const editor = ink.createSceneEditor(scene);
  const request = {operations:[{op:'assign',joint:'left',weight:.7,selection:['left-low']}]};
  const planned = editor.planMeshSkin('wing',request);
  assert.deepEqual(editor.snapshot().topologyMeshes.wing.document,doc);
  const result = editor.editMeshSkin('wing',request);
  assert.equal(result.skin.afterRevision,planned.report.afterRevision);
  const scope = editor.build().topologyMeshes.wing;
  assert.deepEqual(scope.skin.joints,doc.skin.joints);
  assert.equal(scope.skin.mesh,scope.mesh);
  assert.equal(get(scope.document,'left-low').left,.7);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot().topologyMeshes.wing.document,doc);
  assert.equal(editor.redo(),true);
  assert.equal(get(editor.snapshot().topologyMeshes.wing.document,'left-low').left,.7);
});
