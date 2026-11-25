const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const kit=ink.load(), {KIT:K}=kit, T=K.meshTopology;
const identity=[1,0,0,0,1,0,0,0,1,0,0,0];
function shape(move=0) {
  const face=(id,vs)=>({id,corners:vs.map((vertex,i)=>({id:id+'/'+i,vertex}))});
  const before=T.create({id:'panel',skin:{joints:['base','swing']},
    vertices:[{id:'a',position:[0,0,0],weights:{base:1}},{id:'b',position:[2,0,0],weights:{swing:1}},
      {id:'c',position:[0,2,0],weights:{base:1}}],
    faces:[face('panel',['a','b','c'])]});
  const patch={vertices:[{id:'new',position:[1,0,move]}],removeFaces:['panel'],
    faces:[face('p-a',['a','new','c']),face('p-b',['new','b','c'])],
    lineage:{faces:[{from:'panel',to:'p-a'},{from:'panel',to:'p-b'}]}};
  const {document:target,correspondence:map}=T.editWithCorrespondence(before,patch);
  const tri=T.triangulate(before).triangleSources[0];
  const attachments=T.attachments.create(before,[
    {id:'bracket',kind:'socket',node:'base',socket:'slot',anchor:{...tri,weights:[.4,.4,.2]}},
    {id:'thread',kind:'curve-root',anchor:{...tri,weights:[.3,.5,.2]}},
    {id:'glow',kind:'splat-group',group:'shine',members:['dab'],anchor:{...tri,weights:[.4,.2,.4]}}
  ]);
  const poses=[{id:'lift',matrices:{base:identity,swing:[...identity.slice(0,9),.2,.1,0]}}];
  return {before,target,map,attachments,patch,poses};
}

test('split faces transfer weights and all attachment kinds with retained native consumers',()=>{
  const {before,target,map,attachments,poses}=shape();
  const result=T.transferAttachments(before,target,map,{attachments,poses});
  assert(result.report.canCommit,JSON.stringify(result.report.issues));
  assert.deepEqual(result.document.vertices.at(-1).weights,{base:.5,swing:.5});
  assert.equal(result.attachments.revision,T.revision(result.document));
  assert.equal(result.report.attachments.length,3);
  assert(result.report.attachments.every(row=>row.method==='mapped-surface'));
  assert(result.report.maxRestError<1e-10);
  assert(result.report.maxPoseError<1e-6);
  const mesh=T.toSceneMesh(result.document), binding=T.attachments.bind(mesh,result.attachments);
  const graph=K.sceneGraph.create({nodes:{base:{sockets:{slot:{}}},part:{parent:{node:'base',socket:'slot'}}}});
  const B=kit.makeBuilder(1,[0x114422,0xd4ab67]);
  B.disc(.4,.8,.1,[0,0,1],.05,.015,B.P[1],1);
  const curves=K.curveSplats.grow(B,{kind:'mesh',binding},{roots:[{attachment:'thread',length:.25}]},
    {width:.025,color:'#deaa67',edge:'hard'});
  const world=B.finish({meshes:[mesh]});
  world.splatIds=['dab'];
  const splats=binding.bindSplats(world), initial=world.data.slice(0,3);
  const rest=binding.frame('glow');
  T.skin.bind(mesh).pose(poses[0].matrices);
  binding.poseSockets(graph);
  splats.pose();
  curves.pose(world);
  assert.deepEqual(graph.frame('part').position,binding.frame('bracket').position);
  assert.deepEqual(curves.snapshot().strands[0].roots[0].point,binding.root('thread').p);
  assert(K.V.dist(initial,world.data.slice(0,3))>0);
  const again=world.data.slice();
  splats.pose();
  assert.deepEqual(world.data,again);
  assert(K.V.dist(rest.position,binding.frame('glow').position)>0);
});

test('revision pinning and an explicit posed budget block acceptance',()=>{
  const {before,target,map,attachments,patch,poses}=shape(.02);
  assert.throws(()=>T.transferAttachments(before,target,{...map,afterRevision:'old'},{attachments}),/pinned/);
  const restOnly=T.transferAttachments(before,target,map,{attachments});
  assert(!restOnly.report.canCommit);
  assert(restOnly.report.issues.some(row=>row.reason==='pose-evidence-required'));
  const options={attachments,poses,maxRestError:.04,maxPoseError:.005};
  const result=T.transferAttachments(before,target,map,options);
  assert(!result.report.canCommit);
  assert(result.report.issues.some(row=>row.reason==='pose-error'&&row.pose==='lift'));
  assert(result.report.maxRestError<=.04);
  const scene={id:'attachment-test',solids:[],topologyMeshes:{panel:{document:before,attachments}}};
  const editor=ink.createSceneEditor(scene);
  assert.throws(()=>editor.transferMeshAttachments('panel',patch,options),/needs review/);
  assert.equal(editor.snapshot().topologyMeshes.panel.attachments.revision,T.revision(before));
  editor.transferMeshAttachments('panel',patch,{...options,maxPoseError:.04});
  const row=editor.build().topologyMeshes.panel;
  assert.equal(row.attachmentStatus,'ready');
  assert.equal(typeof row.attachments.frame,'function');
  assert.equal(editor.undo(),true);
  assert.equal(editor.snapshot().topologyMeshes.panel.attachments.revision,T.revision(before));
});

test('coincident candidate faces stay ambiguous instead of picking array order',()=>{
  const {before,target,attachments}=shape();
  const extra=target.faces.map(face=>({id:face.id+'copy',
    corners:face.corners.map(row=>({id:row.id+'copy',vertex:row.vertex+'copy',uv:row.uv}))}));
  const replacement=T.edit(target,{faces:extra,vertices:target.vertices.map(row=>({...row,id:row.id+'copy'}))});
  const map=T.correspond(before,replacement,{lineage:{faces:replacement.faces.map(row=>({from:'panel',to:row.id}))}});
  const preview=T.transferAttachments(before,replacement,map,{attachments});
  assert.equal(preview.report.canCommit,false);
  assert(preview.report.issues.some(row=>row.attachment==='glow'&&row.reason==='ambiguous-surface'));
});
