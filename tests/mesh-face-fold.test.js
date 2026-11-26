'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology;
const byId = rows=>new Map(rows.map(row=>[row.id,row]));
const close = (actual,expected)=>actual.forEach((n,i)=>assert(Math.abs(n-expected[i])<1e-9));

function fixture() {
  const scene = {id:'service-awning',style:'slate',solids:[],tilesets:{
    wall:ink.createBlankTileset({width:8,height:8,background:'#a2886e'}),
    paint:ink.createBlankTileset({width:8,height:8,background:'#517982'})}};
  const choose = tileset=>ink.pickTilesetRectangle(scene,tileset,{x:1,y:2,width:5,height:4});
  const pick = choose('paint'), editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'panel',face:'wall',selection:choose('wall'),worldSize:[2,1],origin:[-1,0,0]});
  const first = editor.meshTopology('panel').document;
  const edge = first.edges.find(row=>row.vertices.every(vertex=>['wall/v2','wall/v3'].includes(vertex)));
  editor.editMeshTopology('panel',{edges:[{id:edge.id,uvSeam:true,crease:.4}]});
  editor.growTilesetFace({object:'panel',edge:edge.id,face:'awning',selection:pick,depth:.75});
  const grown = editor.meshTopology('panel').document;
  editor.editMeshTopology('panel',{uvBindings:{pigment:1},faces:grown.faces.map(face=>({...face,corners:face.corners
    .map(corner=>({...corner,attributes:{'uv/1':corner.uv,tint:.4},uvPinned:true,uvPins:{1:true},normal:[0,0,1]}))}))});
  editor.setMeshPivot('panel',{target:{kind:'point',point:[.4,-.3,.2]}});
  const doc = editor.meshTopology('panel').document;
  const request = (degrees,from='wall/v3',source=doc)=>({selection:T.select(source,{domain:'faces',ids:['awning']}),
    operation:{kind:'fold',edge:edge.id,from,degrees}});
  return {editor,doc,pick,edge:edge.id,request};
}

test('a fold fixes both hinge vertices and keeps the paint, topology, and retained object pivot',()=>{
  const {editor,doc,pick,edge,request} = fixture(), before = editor.snapshot();
  const plan = editor.planMeshTransform('panel',request(-90));
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert.deepEqual(plan.report.operation.hinge,{edge,from:'wall/v3',vertices:['wall/v3','wall/v2'],
    endpoints:[[-1,1,0],[1,1,0]],axis:[1,0,0]});
  assert.deepEqual(plan.report.pivot,[0,1,0]);
  assert.equal(plan.report.operation.stationary,'wall');
  assert.equal(plan.patch.vertices.length,2);
  const positions = byId(plan.document.vertices), original = byId(doc.vertices);
  for (const id of ['wall/v3','wall/v2']) assert.deepEqual(positions.get(id),original.get(id));
  assert.deepEqual(plan.document.edges,doc.edges);
  assert.deepEqual(plan.document.faces[0],doc.faces[0]);
  for (const [i,{normal,...corner}] of plan.document.faces[1].corners.entries()) {
    const {normal:oldNormal,...before} = doc.faces[1].corners[i];
    assert.deepEqual(corner,before);
    close(normal,[0,1,0]);
    const position = positions.get(corner.vertex).position;
    const [x,y] = original.get(corner.vertex).position;
    close(position,[x,1,1-y]);
  }
  assert.deepEqual(T.planTransform(doc,plan.report.operation.replay),plan);
  const reversed = T.planTransform(doc,request(90,'wall/v2'));
  assert.deepEqual(reversed.document,plan.document);
  assert.throws(()=>T.planTransform(plan.document,request(-90)),/same topology revision/);
  assert.deepEqual(T.planTransform(doc,request(360)).document,doc);
  const applied = editor.transformMeshTopology('panel',request(-90));
  assert.deepEqual(applied.transform,plan.report);
  assert.deepEqual(editor.meshTopology('panel').pivot,[.4,-.3,.2]);
  assert.deepEqual(editor.eyedropTilesetFace({object:'panel',face:'awning'}).selection,pick);
  assert.deepEqual(editor.meshTopology('panel').bindings,before.topologyMeshes.panel.bindings);
  const after = editor.snapshot();
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('unshared edges, off-hinge attachments and a colliding final pose are rejected',()=>{
  const {editor,doc,request} = fixture(), before = editor.snapshot();
  assert.throws(()=>T.planTransform(doc,{...request(60),operation:{...request(60).operation,
    edge:doc.edges.find(row=>row.vertices.every(id=>['wall/v0','wall/v1'].includes(id))).id}}),/shared by/);
  const jam = editor.planMeshTransform('panel',request(-180));
  assert(!jam.report.canCommit);
  assert(jam.report.issues.some(issue=>issue.kind==='fold-contact'));
  assert.throws(()=>editor.transformMeshTopology('panel',request(-180)),error=>error.report.canCommit===false);
  assert.deepEqual(editor.snapshot(),before);
  const [vertex] = jam.patch.vertices.map(row=>row.id);
  const joined = T.edit(doc,{vertices:[{id:'brace/v1',position:[0,2,1]},{id:'brace/v2',position:[0,2,2]}],faces:[
    {id:'brace',corners:[vertex,'brace/v1','brace/v2'].map((vertex,i)=>({id:'brace/c'+i,vertex,attributes:{'uv/1':[0,0]}}))}
  ]});
  const blocked = T.planTransform(joined,request(60,'wall/v3',joined));
  assert(!blocked.report.canCommit);
  assert.deepEqual(blocked.report.issues,[{kind:'off-hinge-attachments',faces:[{face:'brace',vertices:[vertex]}]}]);
  assert.deepEqual(blocked.document,joined);
});

test('the CLI previews and applies a recorded fold and writes evidence for a blocked commit',t=>{
  const {editor,request} = fixture(), before = editor.snapshot();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-fold-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = [path.resolve(__dirname,'../cli/ink-studio.js'),'mesh-topology','transform',
    'before.json','request.json','--object','panel'];
  write('before.json',before);
  write('request.json',request(-68));
  const preview = JSON.parse(execFileSync(process.execPath,args,{cwd,encoding:'utf8'}));
  assert(preview.report.canCommit);
  write('request.json',preview.report.operation.replay);
  execFileSync(process.execPath,[...args,'--out','folded.json','--report','fold.json'],{cwd});
  assert.deepEqual(read('fold.json').transform,preview.report);
  editor.transformMeshTopology('panel',request(-68));
  assert.deepEqual(read('folded.json'),editor.snapshot());
  write('request.json',request(-180));
  const blocked = spawnSync(process.execPath,[...args,'--out','blocked.json','--report','blocked-report.json'],{cwd});
  assert.equal(blocked.status,1);
  assert(!fs.existsSync(file('blocked.json')));
  assert.equal(read('blocked-report.json').issues[0].kind,'fold-contact');
  assert.deepEqual(read('before.json'),before);
});
