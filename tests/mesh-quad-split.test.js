'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T=K.meshTopology;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

const coords=[[-1,0,0],[1,0,0],[1,1.4,.7],[-1,1.4,0]];
const spec=(doc,...operations)=>({revision:T.revision(doc),operations});
const split=(doc,faces)=>T.planRepair(doc,spec(doc,{kind:'split-quad',faces}));
const position=(doc,id)=>doc.vertices.find(row=>row.id===id).position;
function panel(diagonal) {
  return T.create({id:'tile',vertices:coords.map((position,i)=>({id:'v'+i,position,
    ...(i===1 && {weights:{root:.8,tip:.2}})})),
    faces:[{id:'tile',material:'paint',corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({
      id:'c'+i,vertex:'v'+i,uv,normal:[0,i/8,1],attributes:{'uv/1':uv,pigment:[i,.25,1],tint:i*.1},
      ...(i===1 && {uvPinned:true,uvPins:{1:true}})
    })),...(diagonal && {diagonal})}],uvBindings:{pigment:1},
    edges:[{id:'rim',vertices:['v0','v1'],uvSeam:true,crease:.5}]});
}

function surfaces(doc) {
  const corners=new Map(doc.faces.flatMap(face=>face.corners.map(row=>[row.id,row.vertex])));
  return T.triangulate(doc).triangleSources.map(row=>row.corners.map(id=>corners.get(id)).sort().join(' ')).sort();
}

test('the split materializes the active diagonal and copies exact corner records and lineage',()=>{
  for (const diagonal of [undefined,['c0','c2']]) {
    const doc=panel(diagonal), selection=T.select(doc,{domain:'faces',ids:['tile']});
    const plan=T.planRepair(doc,spec(doc,{kind:'split-quad',selection}));
    assert(plan.report.canCommit);
    const step=plan.report.steps[0].faces[0], after=plan.document;
    assert.equal(step.sourceFace,'tile');
    assert.equal(after.faces.length,2);
    assert.deepEqual(after.vertices,doc.vertices);
    assert.deepEqual(surfaces(after),surfaces(doc));
    assert.deepEqual(step.vertices,diagonal ? ['v0','v2'] : ['v1','v3']);
    for (const edge of doc.edges) assert.deepEqual(after.edges.find(row=>row.id===edge.id),edge);
    const joint=T.inspect(after).edges.find(row=>row.id===step.edge);
    assert.deepEqual(joint.vertices,step.vertices);
    assert.deepEqual(joint.uses.map(row=>row.face).sort(),['tile','tile/triangle']);
    assert.equal(T.health(after).counts.winding,0);
    for (const child of step.triangles) {
      const face=after.faces.find(row=>row.id===child.face);
      assert.equal(face.material,doc.faces[0].material);
      assert.equal(face.diagonal,undefined);
      assert.deepEqual(face.sourceQuad,{mesh:doc.id,face:'tile',revision:T.revision(doc),corners:child.corners.map(row=>row.from)});
      assert.deepEqual(face.corners,child.corners.map(({from,to})=>({...doc.faces[0].corners.find(row=>row.id===from),id:to})));
    }
    assert.deepEqual(plan.patch.lineage.faces,[{from:'tile',to:'tile/triangle'}]);
    assert.equal(plan.patch.lineage.corners.length,2);
    const {correspondence}=T.editWithCorrespondence(doc,plan.patch);
    const group=correspondence.domains.faces.groups.find(row=>row.from.includes('tile'));
    assert.equal(group.status,'split');
    assert.deepEqual(group.to,['tile','tile/triangle']);
    assert.deepEqual(T.create(JSON.parse(JSON.stringify(after))),after);
    assert.deepEqual(T.edit(doc,plan.patch),after);
  }
});

test('batched flips and splits use the current tessellation and replay in order',()=>{
  const doc=panel();
  const combined=T.planRepair(doc,spec(doc,{kind:'flip-diagonal',faces:['tile']},{kind:'split-quad',faces:['tile']}));
  assert.deepEqual(combined.report.steps[1].faces[0].vertices,['v0','v2']);
  assert.deepEqual(T.edit(doc,combined.patch),combined.document);
  const copies={
    vertices:doc.vertices.map(({id,position})=>({id:'copy/'+id,position:[position[0]+3,...position.slice(1)]})),
    corners:doc.faces[0].corners.map(row=>({...row,id:'copy/'+row.id,vertex:'copy/'+row.vertex}))
  };
  const nested=T.edit(doc,{vertices:copies.vertices,faces:[{id:'tile/triangle',material:'paint',corners:copies.corners}]});
  const plan=split(nested,['tile/triangle','tile']);
  assert.equal(plan.report.steps[0].faces[0].triangles[1].face,'tile/triangle/2');
  assert.deepEqual(T.edit(nested,plan.patch),plan.document);
  assert.deepEqual(plan.patch,split(nested,['tile','tile/triangle']).patch);
  const one=split(nested,['tile/triangle']);
  const ordered=T.planRepair(nested,spec(nested,{kind:'split-quad',faces:['tile/triangle']},{kind:'split-quad',faces:['tile']}));
  assert.deepEqual(ordered.document.faces.find(row=>row.id==='tile/triangle/triangle'),one.document.faces.at(-1));
  assert.deepEqual(T.edit(nested,ordered.patch),ordered.document);
});

test('non-quads, stale selections and a diagonal with an existing incident face are protected',()=>{
  const doc=panel(['c0','c2']), selected=T.select(doc,{domain:'faces'});
  const after=split(doc,['tile']).document;
  assert.throws(()=>split(after,['tile']),/four-corner face/);
  assert.throws(()=>T.planRepair(after,spec(after,{kind:'split-quad',selection:selected})),/same topology revision/);
  const shared=T.edit(doc,{vertices:[{id:'point',position:[.5,2,-.5]}],faces:[{id:'strut',
    corners:['v0','v2','point'].map((vertex,i)=>({id:'strut/c'+i,vertex,attributes:{'uv/1':[0,0]}}))}]});
  const blocked=split(shared,['tile']);
  assert.equal(blocked.report.canCommit,false);
  assert.equal(blocked.report.blockers[0].code,'new-non-manifold-edge');
});

function paintedScene() {
  const scene={id:'shop',style:'slate',solids:[],tilesets:{
    green:ink.createBlankTileset({width:8,height:8,background:'#618176'}),
    copper:ink.createBlankTileset({width:8,height:8,background:'#b47745'})}};
  const selection=ink.pickTilesetRectangle(scene,'green',{x:1,y:2,width:6,height:5});
  const editor=ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'panel',face:'tile',selection,worldSize:[2,1.4],origin:[-1,0,0],
    paint:{rotation:90,flipX:true},uvInset:{top:.5}});
  editor.editMeshTopology('panel',{vertices:[{id:'tile/v2',position:coords[2]}]});
  const before=JSON.parse(JSON.stringify(editor.snapshot()));
  before.topologyMeshes.panel.bindings.push({id:'hand-placed-anchor',domain:'faces',element:'tile',data:{name:'hinge'}});
  before.topologyMeshes.panel.bakes=[{id:'paint',material:'tileset/green',maps:{roughness:.4}}];
  return {before,selection,doc:before.topologyMeshes.panel.document};
}

test('tileset bindings fan out, custom face data gets review, and one triangle can be reskinned',()=>{
  const {before,selection,doc}=paintedScene(), editor=ink.createSceneEditor(before);
  const request=spec(doc,{kind:'flip-diagonal',faces:['tile']},{kind:'split-quad',faces:['tile']});
  const preview=editor.planMeshRepair('panel',request);
  const result=editor.repairMeshTopology('panel',request), after=editor.snapshot();
  assert.deepEqual(result.repair,preview.report);
  assert.deepEqual(result.topology.bakes[0].after.faces,['tile','tile/triangle']);
  const [first,second,anchor]=after.topologyMeshes.panel.bindings;
  assert.deepEqual([first.element,second.element],['tile','tile/triangle']);
  assert.deepEqual(anchor.review,{reason:'split',candidates:['tile','tile/triangle']});
  for (const face of ['tile','tile/triangle']) {
    const eye=editor.eyedropTilesetFace({object:'panel',face});
    assert(eye.canStamp);
    assert.equal(eye.sourceStatus,'retained');
    assert.deepEqual(eye.selection,selection);
    assert.deepEqual(eye.paint,{rotation:90,flipX:true,flipY:false});
  }
  const other=ink.pickTilesetRectangle(before,'copper',{x:0,y:0,width:4,height:4});
  editor.applyTilesetReskin({object:'panel',face:second.element,selection:other});
  assert.deepEqual(editor.eyedropTilesetFace({object:'panel',face:first.element}).selection,selection);
  assert.deepEqual(editor.eyedropTilesetFace({object:'panel',face:second.element}).selection,other);
  assert.deepEqual(editor.meshTopology('panel').document.faces[0],after.topologyMeshes.panel.document.faces[0]);
  assert(editor.undo() && editor.undo());
  assert.deepEqual(editor.snapshot(),before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('CLI preview, commit and inspected topology agree and a stale retry writes nothing',t=>{
  const {before,doc}=paintedScene(), cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-split-quad-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write=(file,data)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(data));
  const read=file=>JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('original.json',before);
  write('request.json',spec(doc,{kind:'split-quad',faces:['tile']}));
  const args=['repair','original.json','request.json','--object','panel'];
  const preview=JSON.parse(run(...args));
  run(...args,'--out','split.json','--report','receipt.json');
  assert.deepEqual(read('original.json'),before);
  assert.deepEqual(read('receipt.json').repair,preview.report);
  const changed=read('split.json').topologyMeshes.panel.document;
  assert.deepEqual(changed,T.edit(doc,preview.patch));
  assert.deepEqual(position(changed,'tile/v2'),position(doc,'tile/v2'));
  const stale=spawnSync(process.execPath,[cli,'mesh-topology','repair','split.json','request.json',
    '--object','panel','--out','stale.json'],{cwd,encoding:'utf8'});
  assert.equal(stale.status,1);
  assert(!fs.existsSync(path.join(cwd,'stale.json')));
});
