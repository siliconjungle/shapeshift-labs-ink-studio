'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const unwrap = settings=>({op:'unwrap',across:'geometry',atlas:[128,128],...settings});
const plan = (document,operation,protect)=>UV.plan(document,{operations:[operation],protect});
const ready = result=>assert(result.report.canCommit,JSON.stringify(result.report.operations));
const evidence = result=>result.report.operations[0].evidence;
const faceOf = (doc,id)=>doc.faces.find(face=>face.id===id);
const paint = (...faces)=>({painted:[{id:'approved-enamel',faces}]});

function fixture() {
  const vertices = Array.from({length:4},(_,x)=>[
    {id:'b'+x,position:[x,0,0]},{id:'t'+x,position:[x,1,0]}
  ]).flat();
  const faces = ['a','b','c'].map((id,i)=>{
    const [l,r] = [[.10,.28],[.32,.53],[.53,.73]][i];
    const uvs = [[l,.50],[r,.50],[r,.25],[l,.25]];
    return {id,material:'enamel',corners:['b'+i,'b'+(i+1),'t'+(i+1),'t'+i].map((vertex,j)=>({
      id:id+'/'+j,vertex,uv:uvs[j]
    }))};
  });
  const doc = T.create({id:'facade',vertices,faces});
  const edges = UV.inspect(doc).edges;
  const edge = (x,y)=>edges.find(row=>row.sides.some(side=>side.face===x) && row.sides.some(side=>side.face===y)).id;
  return {doc,ab:edge('a','b'),bc:edge('b','c')};
}

test('join an inferred seam while holding the exact painted and unselected corner coordinates',()=>{
  const {doc,ab,bc} = fixture(), ids = ['a','b'];
  assert.throws(()=>plan(doc,{op:'unwrap',ids}),/one connected region/);
  const output = plan(doc,unwrap({ids}),paint('a'));
  ready(output);
  const report = evidence(output);
  assert.deepEqual(report.joinedEdges,[ab]);
  assert.deepEqual(report.cuts,[]);
  assert.deepEqual(report.components.map(({id,faces,fixed,free})=>({id,faces,fixed,free})),[
    {id:'a',faces:['a','b'],fixed:6,free:0}
  ]);
  assert.deepEqual(report.edgeChanges,[{edge:ab,before:'seam',after:'continuous'}]);
  assert.deepEqual(faceOf(output.document,'a'),faceOf(doc,'a'));
  assert.deepEqual(faceOf(output.document,'c'),faceOf(doc,'c'));
  assert.deepEqual(faceOf(output.document,'b').corners.map(row=>row.uv),
    [[.28,.50],[.53,.50],[.53,.25],[.28,.25]]);
  assert.equal(UV.inspect(output.document).edges.find(row=>row.id===bc).kind,'continuous');
  assert.deepEqual(report.protectedCorners,['a/0','a/1','a/2','a/3','c/0','c/3']);

  const boundary = plan(doc,unwrap({ids:['b'],cuts:[bc],rect:[.33,.62,.20,.20]}));
  ready(boundary);
  assert.deepEqual(faceOf(boundary.document,'c'),faceOf(doc,'c'));
  assert.deepEqual(boundary.report.seams,[{id:bc,uvSeam:true}]);
});

test('author a cut and solve the remaining connected panels in one transaction',()=>{
  const {doc,ab,bc} = fixture();
  const cuts = UV.select(doc,{domain:'edges',ids:[bc]});
  const selection = UV.select(doc,{domain:'faces',ids:['a','b','c']});
  const request = unwrap({selection,cuts,rects:{c:[.70,.18,.20,.20]}});
  const output = plan(doc,request,paint('a'));
  ready(output);
  const report = evidence(output);
  assert.deepEqual(report.joinedEdges,[ab]);
  assert.deepEqual(report.cuts,[bc]);
  assert.deepEqual(report.components.map(row=>row.faces),[['a','b'],['c']]);
  assert.deepEqual(output.report.seams,[{id:bc,uvSeam:true}]);
  assert.deepEqual(faceOf(output.document,'a'),faceOf(doc,'a'));
  assert.deepEqual(output.document.vertices,doc.vertices);
  assert.deepEqual(T.edit(doc,output.patch),output.document);
  assert.equal(UV.inspect(output.document).edges.find(row=>row.id===bc).authored,true);
  assert.deepEqual(report.edgeChanges,[{edge:ab,before:'seam',after:'continuous'},{edge:bc,before:'continuous',after:'seam'}]);
  assert.throws(()=>plan(doc,{...request,rects:{a:[.10,.18,.2,.2],b:[.35,.18,.2,.2]}}),/one valid rectangle/);
  assert.throws(()=>plan(doc,unwrap({ids:['a'],cuts:[bc]})),/touch a selected face/);

  const blank = T.edit(doc,{faces:doc.faces.map(face=>({...face,corners:face.corners.map(corner=>({...corner,uv:[0,0]}))}))});
  const generated = plan(blank,unwrap({ids:['a','b','c'],rect:[.12,.18,.72,.50]}));
  ready(generated);
  assert.equal(evidence(generated).components[0].before.meanStretch,null);
  assert.equal(evidence(generated).components[0].after.meanStretch,1);
});

test('report incompatible painted anchors and keep an explicit cut when those sides must stay apart',()=>{
  const {doc,ab} = fixture();
  const ids = ['a','b'], protect = paint('a','b');
  const blocked = plan(doc,unwrap({ids}),protect);
  assert.equal(blocked.report.canCommit,false);
  const conflicts = blocked.report.operations[0].conflicts;
  assert.deepEqual(conflicts.map(row=>row.code),['conflicting-unwrap-anchors','conflicting-unwrap-anchors']);
  assert(conflicts.every(row=>row.corners.some(corner=>corner.id.startsWith('a/'))));
  assert.deepEqual(blocked.document,doc);
  const cut = plan(doc,unwrap({ids,cuts:[ab]}),protect);
  ready(cut);
  assert.deepEqual(cut.report.seams,[{id:ab,uvSeam:true}]);
  assert.deepEqual(cut.document.faces,doc.faces);
  const again = plan(cut.document,unwrap({ids}),protect);
  ready(again);
  assert.deepEqual(evidence(again).components.map(row=>row.faces),[['a'],['b']]);
  assert.deepEqual(again.patch,{});
});

test('roll back a requested cut on overlap and journal a valid alternate-layout unwrap',()=>{
  const {doc,bc} = fixture();
  const blocked = plan(doc,unwrap({ids:['b','c'],cuts:[bc],rects:{c:[.12,.29,.12,.12]}}));
  assert.equal(blocked.report.canCommit,false);
  assert(blocked.report.operations[0].conflicts.some(row=>row.code==='new-uv-overlap' && row.faces.includes('a')));
  assert.deepEqual(blocked.patch,{});
  assert.deepEqual(blocked.document,doc);
  const document = T.edit(doc,{uvBindings:{pigment:1},faces:doc.faces.map(face=>({...face,
    corners:face.corners.map(corner=>({...corner,attributes:{'uv/1':corner.uv}}))}))});
  const scene = {id:'facade',style:'slate',solids:[],topologyMeshes:{facade:{document,
    bakes:[{id:'old-bake',material:'enamel',maps:{roughness:.5}}]}}};
  const editor = ink.createSceneEditor(scene);
  const request = {uvSet:'pigment',protect:paint('a'),revision:T.revision(document),operations:[
    unwrap({ids:['a','b','c'],cuts:[bc],rects:{c:[.70,.18,.20,.20]}})
  ]};
  const preview = editor.planMeshUV('facade',request);
  ready(preview);
  assert.deepEqual(editor.editMeshUV('facade',request).uv,preview.report);
  const row = editor.snapshot().topologyMeshes.facade;
  assert.deepEqual(row.document.edges.find(row=>row.id===bc).uvSeams,{1:true});
  assert.equal(row.document.edges.find(row=>row.id===bc).uvSeam,undefined);
  assert.deepEqual(row.bakes[0].invalidated.faces,['b','c']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot().topologyMeshes.facade,row);
});
