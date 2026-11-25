'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T = K.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

const rectangle = [[0,1],[1,1],[1,0],[0,0]];
const request = (doc,...operations) => ({revision:T.revision(doc),operations});
const join = (doc,fields) => T.planRepair(doc,request(doc,{kind:'join-triangles',...fields}));
const split = doc => T.planRepair(doc,request(doc,{kind:'split-quad',faces:[doc.faces[0].id]}));
const sharedEdge = doc => T.inspect(doc).edges.find(edge=>edge.uses.length === 2);

function mesh(diagonal) {
  return T.create({id:'panel',vertices:[[-1,0,0],[1,0,0],[1,1.5,.75],[-1,1.5,0]].map((position,i)=>
    ({id:'v'+i,position,weights:{base:i/4,top:1-i/4}})),
    faces:[{id:'tile',material:'enamel',diagonal,corners:rectangle.map((uv,i)=>({
      id:'c'+i,vertex:'v'+i,uv,normal:[0,i/10,1],attributes:{'uv/1':uv,tint:i},
      ...(i%2 && {uvPinned:true,uvPins:{1:true}})
    }))}],uvBindings:{pigment:1},
    edges:[{id:'rim',vertices:['v0','v1'],crease:.5,uvSeams:{1:true}}]});
}

function triangleData(doc) {
  const corners = new Map(doc.faces.flatMap(face=>face.corners.map(({id,...data})=>[id,data])));
  return T.triangulate(doc).triangleSources.map(row=>JSON.stringify(
    row.corners.map(id=>corners.get(id)).sort((a,b)=>a.vertex.localeCompare(b.vertex)))).sort();
}

test('both render diagonals round trip through an editable quad with exact corners and merge lineage',()=>{
  for (const diagonal of [['c0','c2'],['c1','c3']]) {
    const authored = mesh(diagonal), triangles = split(authored).document;
    const selection = T.select(triangles,{domain:'faces',ids:['tile/triangle','tile']});
    const result = join(triangles,{selection}), {document:quad,report,patch} = result;
    assert(report.canCommit);
    assert.deepEqual(quad.vertices,triangles.vertices);
    assert.deepEqual(quad.faces.map(face=>[face.id,face.material,face.diagonal]),[['tile','enamel',diagonal]]);
    assert.deepEqual(quad.faces[0].corners.map(row=>row.id).sort(),['c0','c1','c2','c3']);
    assert.deepEqual(triangleData(quad),triangleData(triangles));
    assert.deepEqual(quad.edges.find(edge=>edge.id === 'rim'),authored.edges[0]);
    assert(!quad.edges.some(edge=>edge.id === sharedEdge(triangles).id));
    assert.deepEqual(patch.lineage.faces,[{from:'tile/triangle',to:'tile'}]);
    assert.equal(patch.lineage.corners.length,2);
    assert.deepEqual(T.edit(triangles,patch),quad);
    assert.deepEqual(join(triangles,{edge:sharedEdge(triangles).id}).patch,patch);
    assert.deepEqual(report.steps[0].triangles.map(row=>row.sourceQuad),triangles.faces.map(face=>face.sourceQuad));
    assert.deepEqual(T.editWithCorrespondence(triangles,patch).correspondence.domains.faces.groups.map(row=>row.status),['merged']);
    assert.throws(()=>join(quad,{selection}),/same topology revision/);

    const paired = T.planRepair(authored,request(authored,{kind:'split-quad',faces:['tile']},
      {kind:'join-triangles',faces:['tile','tile/triangle'],keep:'tile/triangle'}));
    assert.deepEqual(paired.patch.lineage.faces,[{from:'tile',to:'tile/triangle'}]);
    assert.deepEqual(T.edit(authored,paired.patch),paired.document);
    assert.deepEqual(triangleData(paired.document),triangleData(authored));
  }
});

test('safe join reports every authored UV seam while the explicit keeper picks the resulting values and pins',()=>{
  const straight = split(mesh(['c0','c2'])).document, edge = sharedEdge(straight);
  const other = straight.faces[1];
  const changed = T.edit(straight,{edges:[{id:edge.id,uvSeams:{3:true}}],faces:[{...other,corners:other.corners.map(row=>
    row.vertex !== 'v0' ? row : {...row,uv:[.125,1],uvPinned:true,uvPins:{1:true},attributes:{...row.attributes,'uv/1':[.25,.5]}}
  )}]});
  const guarded = join(changed,{faces:['tile','tile/triangle']});
  assert.equal(guarded.report.canCommit,false);
  assert.deepEqual(guarded.patch,{});
  assert.deepEqual(guarded.document,changed);
  assert.deepEqual(guarded.report.blockers.map(({code,sets})=>[code,sets]),[['join-uv-seam',[0,1,3]]]);
  const override = join(changed,{edge:edge.id,uvs:'keep',keep:'tile/triangle'});
  assert(override.report.canCommit);
  const step = override.report.steps[0];
  assert.deepEqual(step.uvSets.map(({set,authored,discontinuous})=>[set,authored,discontinuous]),
    [[0,false,true],[1,false,true],[3,true,false]]);
  const moved = step.uvSets[1].endpoints.find(row=>row.vertex === 'v0');
  assert.deepEqual(moved.before,[{face:'tile/triangle',uv:[.25,.5],pinned:true},{face:'tile',uv:[0,1],pinned:false}]);
  assert.deepEqual(moved.after,[.25,.5]);
  assert.deepEqual(moved.delta,[.25,-.5]);
  const output = override.document.faces[0].corners.find(row=>row.vertex === 'v0');
  assert.deepEqual([output.uv,output.attributes['uv/1'],output.uvPins,output.uvPinned],[[.125,1],[.25,.5],{1:true},true]);
  const opposite = join(changed,{edge:edge.id,uvs:'keep'}).document.faces[0].corners.find(row=>row.vertex === 'v0');
  assert.deepEqual([opposite.uv,opposite.uvPins,opposite.uvPinned],[[0,1],{1:true},true]);
  const composite = T.planRepair(changed,request(changed,{kind:'winding',faces:['tile','tile/triangle']},
    {kind:'join-triangles',edge:edge.id}));
  assert.equal(composite.report.canCommit,false);
  assert.deepEqual(composite.patch,{});
  assert.deepEqual(composite.document,changed);
});

test('join works for independently authored triangles and protects geometry, material and non-UV attributes',()=>{
  const base = split(mesh()).document;
  const doc = T.create({...base,faces:base.faces.map(({sourceQuad,...face})=>face)});
  const edge = sharedEdge(doc), [a,b] = doc.faces;
  const operation = {edge:edge.id,uvs:'keep'};
  assert(join(doc,operation).report.canCommit);
  assert.throws(()=>join(doc,{edge:'rim'}),/manifold edge/);
  assert.throws(()=>join(doc,{edge:edge.id,keep:'other'}),/keeper/);
  assert.throws(()=>join(T.edit(doc,{faces:[{...b,material:'other'}]}),operation),/material boundary/);
  assert.throws(()=>join(T.edit(doc,{edges:[{id:edge.id,crease:.5}]}),operation),/crease/);
  assert.throws(()=>join(T.edit(doc,{edges:[{id:edge.id,smooth:false}]}),operation),/hard edge/);
  assert.throws(()=>join(T.edit(doc,{faces:[{...b,corners:b.corners.slice().reverse()}]}),operation),/winding/);
  const corners = b.corners.map(row=>({...row,attributes:{...row.attributes,tint:12}}));
  assert.throws(()=>join(T.edit(doc,{faces:[{...b,corners}]}),operation),/non-UV attributes/);
  const invalid = T.edit(doc,{vertices:[{id:'v3',position:[.5,-1,0]},{id:'v2',position:[1,1.5,0]}]});
  assert.throws(()=>join(invalid,operation),/simple polygon|diagonal/);
  const extra = T.edit(doc,{vertices:[{id:'v4',position:[0,0,-1]}],faces:[{id:'extra',material:a.material,
    corners:[...edge.vertices,'v4'].map((vertex,i)=>({id:'extra/c'+i,vertex,attributes:{'uv/1':[0,0]}}))}]});
  assert.throws(()=>join(extra,{faces:[a.id,b.id],uvs:'keep'}),/manifold shared edge/);
});

function paintedTriangles() {
  const source = {id:'gate',style:'slate',solids:[],tilesets:{
    enamel:ink.createBlankTileset({width:16,height:16,background:'#75a58d'})}};
  const crop = ink.pickTilesetRectangle(source,'enamel',{x:2,y:3,width:9,height:8});
  const editor = ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'panel',face:'tile',selection:crop,worldSize:[2,1.4],origin:[-1,0,0],
    paint:{rotation:90,flipY:true},uvInset:{left:.5}});
  const {document} = editor.meshTopology('panel');
  editor.repairMeshTopology('panel',request(document,{kind:'split-quad',faces:['tile']}));
  const scene = JSON.parse(JSON.stringify(editor.snapshot()));
  scene.topologyMeshes.panel.bakes = [{id:'enamel-bake',material:'tileset/enamel',maps:{roughness:.4}}];
  return {scene,crop,row:scene.topologyMeshes.panel};
}

test('scene joins combine a matching crop, consolidate corner ownership, invalidate bakes and undo as one edit',()=>{
  const {scene,crop,row} = paintedTriangles();
  const editor = ink.createSceneEditor(scene), edge = sharedEdge(row.document);
  const spec = request(row.document,{kind:'join-triangles',edge:edge.id,keep:'tile/triangle'});
  const preview = editor.planMeshRepair('panel',spec);
  const committed = editor.repairMeshTopology('panel',spec);
  assert.deepEqual(committed.repair,preview.report);
  const joined = editor.snapshot().topologyMeshes.panel;
  assert.deepEqual(joined.bakes[0].invalidated.faces,['tile','tile/triangle']);
  const [binding] = joined.bindings;
  assert.equal(joined.bindings.length,1);
  assert.equal(binding.element,'tile/triangle');
  assert.equal(binding.data.uvCorners,undefined);
  const picked = editor.eyedropTilesetFace({object:'panel',face:'tile/triangle'});
  assert.deepEqual(picked.selection,crop);
  assert.equal(picked.sourceStatus,'retained');
  assert.equal(picked.orientationStatus,'retained');
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot().topologyMeshes.panel,joined);
});

test('CLI safely refuses a painted seam and commits an explicit override with a review receipt',t=>{
  const {scene,row} = paintedTriangles(), edge = sharedEdge(row.document);
  const other = row.document.faces[1];
  row.document = T.edit(row.document,{faces:[{...other,corners:other.corners.map(corner=>
    edge.vertices.includes(corner.vertex) ? {...corner,uv:[corner.uv[0]+.05,corner.uv[1]]} : corner)}]});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-join-quad-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write = (name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const args = ['mesh-topology','repair','triangles.json','request.json','--object','panel'];
  write('triangles.json',scene);
  write('request.json',request(row.document,{kind:'join-triangles',edge:edge.id}));
  const attempted = spawnSync(process.execPath,[cli,...args,'--out','quad.json','--report','blocked.json'],{cwd,encoding:'utf8'});
  assert.equal(attempted.status,1);
  assert.match(attempted.stderr,/remove a UV seam/);
  assert(!fs.existsSync(path.join(cwd,'quad.json')));
  assert.equal(read('blocked.json').blockers[0].code,'join-uv-seam');
  write('request.json',request(row.document,{kind:'join-triangles',edge:edge.id,uvs:'keep'}));
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','quad.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').repair,preview.report);
  assert.deepEqual(read('triangles.json'),scene);
  const output = read('quad.json').topologyMeshes.panel;
  assert.deepEqual(output.document,T.edit(row.document,preview.patch));
  assert.equal(output.bindings.length,2);
  assert(output.bindings.every(binding=>binding.review?.reason === 'joined-tileset-sources-need-review'));
});
