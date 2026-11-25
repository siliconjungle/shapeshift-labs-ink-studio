'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const near = (a,b)=>assert(Math.abs(a-b)<1e-9,String(a)+' vs '+String(b));
const vector = (a,b)=>a.forEach((n,i)=>near(n,b[i]));
const uv = [[.1,.85],[.85,.85],[.85,.15],[.1,.15]];
const directions = [[0,0,1],[0,0,1],[.55,0,1],[.55,0,1]];
const request = (doc,operation,fields={},selection=['panel'])=>({id:'raised-tile',revision:T.revision(doc),
  selection:T.select(doc,{domain:'faces',ids:selection}),operation:{kind:'extrude',distance:.35,...operation},...fields});

function panel(obstacle = false) {
  const positions = [[-1,0,0],[1,0,0],[1,1.4,0],[-1,1.4,0],[-.2,.45,.13],[.2,.45,.13],[0,.82,.13]];
  const vertices = positions.slice(0,obstacle ? 7 : 4).map((position,i)=>({id:'v'+i,position,weights:{stem:1}}));
  const face = {id:'panel',material:'paint',diagonal:['c0','c2'],corners:uv.map((uv,i)=>({
    id:'c'+i,vertex:'v'+i,uv,uvPinned:true,normal:directions[i],
    attributes:{'uv/1':uv,'uv/2':uv.map(n=>.2+n*.5),tint:i},uvPins:{1:true}
  }))};
  const stop = {id:'stop',material:'fixture',corners:[4,5,6].map(i=>({id:'c'+i,vertex:'v'+i,attributes:{'uv/1':[0,0]}}))};
  return T.create({id:'tile',vertices,faces:[face,...(obstacle ? [stop] : [])],uvBindings:{pigment:1}});
}

test('face and vertex modes preserve the textured cap and give sidewalls independent UVs',()=>{
  const doc = panel(), rim = {material:'trim',uv:'per-edge',uvSets:[1]};
  const face = T.planFaceRegion(doc,request(doc,{normals:'face'},{rim}));
  const vertex = T.planFaceRegion(doc,request(doc,{normals:'vertex'},{rim}));
  for (const [mode,plan] of [['face',face],['vertex',vertex]]) {
    assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
    const motion = plan.report.extrusion.motion, cap = plan.document.faces.find(face=>face.id==='panel');
    assert.equal(plan.report.extrusion.normals,mode);
    assert.deepEqual(plan.report.extrusion.sidewall,{uv:'per-edge',material:'trim',uvSets:[0,1]});
    assert.deepEqual(plan.report.extrusion.cap,{uv:'preserve',material:null});
    assert.deepEqual(cap,{...doc.faces[0],corners:doc.faces[0].corners.map((corner,i)=>({...corner,vertex:motion[i].to}))});
    assert(plan.document.vertices.every(vertex=>vertex.weights.stem===1));
    motion.forEach((row,i)=>{
      const normal = mode === 'vertex' ? doc.faces[0].corners[i].normal : [0,0,1];
      vector(row.axis,normal);
      vector(row.displacement,normal.map(n=>n*.35));
      if (mode === 'vertex') assert.equal(row.contributors[0].source,'authored');
    });
    const walls = plan.document.faces.filter(face=>face.material==='trim');
    assert.equal(walls.length,4);
    for (const wall of walls) {
      assert.deepEqual(wall.corners.map(row=>row.uv),[[0,0],[1,0],[1,1],[0,1]]);
      assert.deepEqual(wall.corners.map(row=>row.attributes['uv/1']),wall.corners.map(row=>row.uv));
      assert(wall.corners.every(row=>row.attributes['uv/2'][0]>.2 && row.attributes['uv/2'][1]>.2));
    }
    assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  }
  assert.notDeepEqual(vertex.patch.vertices,face.patch.vertices);
  const strip = T.planFaceRegion(doc,request(doc,{normals:'vertex'},{rim:{material:'trim',uv:'strip'}}));
  assert.deepEqual(strip.report.extrusion.sidewall.uvSets,[0,1]);
  const raised = strip.document.faces.filter(face=>face.material==='trim');
  assert.equal(raised[0].corners[0].attributes['uv/1'][0],0);
  assert.equal(raised.at(-1).corners[1].attributes['uv/1'][0],1);
  assert.throws(()=>T.planFaceRegion(doc,request(doc,{normals:'vertex',direction:[0,0,1]})),/or provide a direction/);
});

test('selected corners agree on one offset at a shared vertex and honor smooth fallback elsewhere',()=>{
  const doc = T.create({id:'fans',shading:{smooth:true},
    vertices:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0]].map((position,i)=>({id:'v'+i,position})),
    faces:[[0,1,2,3],[1,4,5,2]].map((ring,i)=>({id:i ? 'next':'panel',corners:ring.map((v,j)=>({
      id:i+'/'+j,vertex:'v'+v,...([1,2].includes(v) && {normal:[i ? -.5:.5,0,1]})
    }))}))});
  const plan = T.planFaceRegion(doc,request(doc,{normals:'vertex'},{},['panel','next']));
  assert(plan.report.canCommit);
  const motion = plan.report.extrusion.motion;
  const shared = motion.find(row=>row.from==='v1');
  assert.equal(shared.contributors.length,2);
  vector(shared.axis,[0,0,1]);
  assert.equal(motion.find(row=>row.from==='v0').contributors[0].source,'face');
  const tilted = T.edit(doc,{vertices:[{id:'v4',position:[2,0,-.15]},{id:'v5',position:[2,1,-.15]}],
    faces:doc.faces.map(face=>({...face,corners:face.corners.map(({normal,...row})=>row)}))});
  const smooth = T.planFaceRegion(tilted,request(tilted,{normals:'vertex'},{},['panel','next']));
  assert(smooth.report.canCommit,JSON.stringify(smooth.report.issues));
  const blend = smooth.report.extrusion.motion.find(row=>row.from==='v1');
  assert(blend.contributors.every(row=>row.source==='smooth'));
  assert(blend.axis[0]>.05 && blend.axis[2]>.9);
});

test('moving cap triangles catch a stationary obstacle between their start and end positions',()=>{
  const doc = panel(true), plan = T.planFaceRegion(doc,request(doc,{normals:'vertex'}));
  assert.equal(plan.report.canCommit,false);
  assert(plan.report.issues.some(row=>row.kind==='swept-contact'));
  const contact = plan.report.sweep.hits.find(row=>row.method==='deformed-face' && row.obstacle==='stop');
  assert(contact && contact.face==='panel' && contact.travel>0 && contact.travel<1);
  const longEdge = T.edit(doc,{vertices:[
    {id:'v4',position:[-3,.65,.13]},{id:'v5',position:[3,.65,.13]},{id:'v6',position:[3,.75,.13]}
  ]});
  const edgeContact = T.planFaceRegion(longEdge,request(longEdge,{normals:'vertex'}));
  assert.equal(edgeContact.report.canCommit,false);
  assert(edgeContact.report.sweep.hits.some(row=>row.method==='deformed-edge' && row.obstacle==='stop' &&
    row.travel>0 && row.travel<1));
});

function paintedScene() {
  const scene = {id:'painted-cover',style:'slate',solids:[],tilesets:{
    enamel:ink.createBlankTileset({width:16,height:12,background:'#64847c'})}};
  const pick = ink.pickTilesetRectangle(scene,'enamel',{x:2,y:1,width:12,height:10});
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'sign',face:'panel',selection:pick,worldSize:[2,1.4],origin:[-1,0,0]});
  const row = editor.meshTopology('sign');
  editor.editMeshTopology('sign',{faces:row.document.faces.map(face=>({...face,corners:face.corners.map((corner,i)=>
    ({...corner,normal:directions[i]}))}))});
  return {scene:editor.snapshot(),doc:editor.meshTopology('sign').document,pick};
}

test('scene undo and CLI preview preserve the cap binding and an invalid mode writes nothing',t=>{
  const {scene,doc,pick} = paintedScene(), editor = ink.createSceneEditor(scene);
  const spec = request(doc,{normals:'vertex'},{rim:{material:'trim',uv:'strip'}});
  const preview = editor.planMeshFaceRegion('sign',spec), result = editor.editMeshFaceRegion('sign',spec);
  assert.deepEqual(result.faceRegion,preview.report);
  assert.deepEqual(editor.eyedropTilesetFace({object:'sign',face:'panel'}).selection,pick);
  const resultScene = editor.snapshot();
  assert.deepEqual(resultScene.topologyMeshes.sign.bindings,scene.topologyMeshes.sign.bindings);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),resultScene);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-extrude-normals-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name), cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','face-region','scene.json','extrude.json','--object','sign'];
  write('scene.json',scene);
  write('extrude.json',{...spec,operation:{...spec.operation,normals:'both'}});
  const refused = spawnSync(process.execPath,[cli,...args,'--out','rejected.json'],{cwd,encoding:'utf8'});
  assert.equal(refused.status,1);
  assert(!fs.existsSync(file('rejected.json')));
  write('extrude.json',spec);
  const planned = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','raised.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').faceRegion,planned.report);
  assert.deepEqual(read('raised.json'),resultScene);
  assert.deepEqual(read('scene.json'),scene);
});
