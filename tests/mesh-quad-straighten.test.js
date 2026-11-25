'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const cli = path.resolve(__dirname,'../cli/ink-studio.js');

const faceUV = [[0,1],[1,1],[1,0],[0,0]];
const plane = {origin:[0,0,0],normal:[0,0,3]};
const request = (doc,...operations)=>({revision:T.revision(doc),operations});
const op = options=>({kind:'straighten-quad',...options});
const plan = (doc,options)=>T.planRepair(doc,request(doc,op(options)));

function panel({guideWarp=0} = {}) {
  const face = (id,vertices)=>({id,material:'paint',corners:vertices.map((vertex,i)=>({
    id:id+'/c'+i,vertex:'v'+vertex,uv:faceUV[i],normal:[0,0,1],attributes:{'uv/1':faceUV[i],tint:i}
  }))});
  return T.create({id:'panel',uvBindings:{pigment:1},
    vertices:[[-2,0,guideWarp],[0,0,0],[0,1,0],[-2,1,0],[2,0,.25],[2,1,.75],[3,.5,.35]].map((position,i)=>({
      id:'v'+i,position,weights:{root:.75,tip:.25}
    })),
    edges:[{id:'hinge',vertices:['v1','v2'],uvSeam:true,crease:.5}],
    faces:[face('brace',[0,1,2,3]),{...face('cover',[1,4,5,2]),diagonal:['cover/c0','cover/c2']},
      face('tab',[5,4,6])]});
}

test('explicit plane reuses flatten projection and retains paint, weights, diagonal, and corner identity',()=>{
  const doc = panel(), selection = T.select(doc,{domain:'faces',ids:['cover']});
  const out = plan(doc,{selection,plane}), [step] = out.report.steps;
  assert(out.report.canCommit);
  assert.deepEqual(step.plane,{origin:[0,0,0],normal:[0,0,1],source:'explicit'});
  assert.deepEqual(step.faces[0].corners.filter(row=>row.moved).map(row=>[row.corner,row.vertex,row.delta]),[
    ['cover/c1','v4',[0,0,-.25]],['cover/c2','v5',[0,0,-.75]]
  ]);
  assert.equal(step.faces[0].maxBefore,.75);
  assert.equal(step.faces[0].maxAfter,0);
  assert.deepEqual(step.adjacent.map(row=>[row.face,row.corners.map(corner=>corner.corner)]),[['tab',['tab/c0','tab/c1']]]);
  assert.deepEqual(out.document.faces,doc.faces);
  assert.deepEqual(out.document.edges,doc.edges);
  assert.deepEqual(out.document.vertices.map(row=>row.weights),doc.vertices.map(row=>row.weights));
  assert.deepEqual(out.document,T.planTransform(doc,{selection,operation:{kind:'flatten',plane}}).document);
  assert.deepEqual(T.edit(doc,out.patch),out.document);
  assert.deepEqual(plan(out.document,{faces:['cover'],plane}).patch,{});
  assert.throws(()=>plan(out.document,{selection,plane}),/same topology revision/);
});

test('neighbor orientation uses the actual hinge and leaves a warped guide precisely in place',()=>{
  const doc = panel({guideWarp:.3}), out = plan(doc,{faces:['cover'],neighbor:'brace'});
  assert(out.report.canCommit);
  const [step] = out.report.steps;
  assert.equal(step.plane.source,'neighbor');
  assert.equal(step.plane.neighbor,'brace');
  assert.equal(step.plane.edge,'hinge');
  assert.deepEqual(step.plane.hinge,['v1','v2']);
  assert(Math.abs(step.plane.normal[0])>.05);
  assert(Math.abs(step.plane.normal[1])<1e-14);
  assert(step.faces[0].maxAfter<1e-12);
  const before = doc.vertices.slice(0,4), after = out.document.vertices.slice(0,4);
  assert.deepEqual(after,before);
  assert.deepEqual(step.adjacent.map(face=>face.face),['tab']);
  assert.deepEqual(plan(out.document,{faces:['cover'],neighbor:'brace'}).patch,{});
  assert.throws(()=>plan(doc,{faces:['cover'],neighbor:'cover'}),/distinct neighboring face/);
  assert.throws(()=>plan(doc,{faces:['cover'],neighbor:'absent'}),/distinct neighboring face/);
  assert.throws(()=>plan(doc,{faces:['tab'],plane}),/four-corner faces/);
  assert.throws(()=>plan(doc,{faces:['brace','cover'],neighbor:'tab'}),/one quad/);
  assert.throws(()=>plan(doc,{faces:['cover'],plane,neighbor:'brace'}),/plane or a neighboring face/);
  assert.throws(()=>plan(doc,{faces:['cover'],plane:{origin:[0,0,0],normal:[0,0,0]}}),/nonzero XYZ/);
  const nonManifold = T.edit(doc,{faces:[{id:'extra',corners:['v1','v2','v6'].map((vertex,i)=>({
    id:'extra/c'+i,vertex,uv:[0,0],attributes:{'uv/1':[0,0]}
  }))}]});
  assert.throws(()=>plan(nonManifold,{faces:['cover'],neighbor:'brace'}),/manifold edge/);
});

test('rejects a collapsing projection with proposed corners and rolls back preceding repair steps',()=>{
  const doc = panel(), collapse = op({faces:['cover'],plane:{origin:[0,0,0],normal:[0,1,0]}});
  const result = T.planRepair(doc,request(doc,{kind:'flip-diagonal',faces:['cover']},collapse));
  assert.equal(result.report.canCommit,false);
  assert.equal(result.report.blockers[0].code,'invalid-straightened-quad');
  assert.deepEqual(result.document,doc);
  assert.deepEqual(result.patch,{});
  assert(result.report.steps[1].faces[0].corners.some(row=>row.moved));
  const valid = T.planRepair(doc,request(doc,{kind:'flip-diagonal',faces:['cover']},op({faces:['cover'],plane})));
  assert(valid.report.canCommit);
  assert.deepEqual(valid.document.faces[1].diagonal,['cover/c1','cover/c3']);
  assert.deepEqual(T.edit(doc,valid.patch),valid.document);
});

function paintedScene() {
  const source = {id:'workshop',style:'slate',solids:[],tilesets:{
    ink:ink.createBlankTileset({width:8,height:8,background:'#5e8b78'})}};
  const crop = ink.pickTilesetRectangle(source,'ink',{x:1,y:0,width:5,height:6});
  const editor = ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'panel',face:'cover',selection:crop,worldSize:[2,1],origin:[-1,0,0]});
  editor.editMeshTopology('panel',{vertices:[{id:'cover/v2',position:[1,1,.65]}]});
  const scene = JSON.parse(JSON.stringify(editor.snapshot())), row = scene.topologyMeshes.panel;
  row.bakes = [{id:'pigment',material:'tileset/ink',maps:{roughness:.4}}];
  return {scene,crop,doc:row.document};
}

test('scene keeps the painted crop, invalidates the bake, and restores both in one undo',()=>{
  const {scene,crop,doc} = paintedScene(), editor = ink.createSceneEditor(scene);
  const spec = request(doc,op({faces:['cover'],plane}));
  const preview = editor.planMeshRepair('panel',spec), result = editor.repairMeshTopology('panel',spec);
  assert.deepEqual(result.repair,preview.report);
  assert.equal(result.topology.bindings[0].change,'displaced');
  assert.deepEqual(result.topology.bakes[0].after.faces,['cover']);
  const flat = editor.snapshot();
  assert.deepEqual(flat.topologyMeshes.panel.bindings,scene.topologyMeshes.panel.bindings);
  const picked = editor.eyedropTilesetFace({object:'panel',face:'cover'});
  assert.equal(picked.sourceStatus,'retained');
  assert.deepEqual(picked.selection,crop);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),flat);
});

test('headless CLI refuses the invalid repair and publishes the same preview and commit for a valid plane', t=>{
  const {scene,doc} = paintedScene();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-straighten-quad-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','repair','warped.json','request.json','--object','panel'];
  write('warped.json',scene);
  write('request.json',request(doc,op({faces:['cover'],plane:{origin:[0,0,0],normal:[0,1,0]}})));
  const refused = spawnSync(process.execPath,[cli,...args,'--out','flat.json','--report','blocked.json'],{cwd,encoding:'utf8'});
  assert.equal(refused.status,1);
  assert.match(refused.stderr,/Cannot straighten quad/);
  assert(!fs.existsSync(file('flat.json')));
  assert.equal(read('blocked.json').blockers[0].code,'invalid-straightened-quad');
  write('request.json',request(doc,op({faces:['cover'],plane})));
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','flat.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').repair,preview.report);
  assert.deepEqual(read('warped.json'),scene);
  assert.deepEqual(read('flat.json').topologyMeshes.panel.document,T.edit(doc,preview.patch));
});
