'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T=K.meshTopology;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

function fixture(tilt=false) {
  const coords = [[0,0],[1,0],[1,1],[0,1]];
  const normal=tilt ? K.V.norm([-.3,-.2,1]) : [0,0,1];
  const doc=T.create({id:'panel',vertices:coords.map(([x,y],i)=>({id:'v'+i,
    position:[x,y,tilt ? .3*x+.2*y : 0],...(i===0 && {weights:{root:1}})})),
    faces:[{id:'painted',corners:[[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({
      id:'c'+i,vertex:'v'+i,uv,normal,attributes:{'uv/1':uv},...(i===0 && {uvPinned:true})
    }))}],edges:[{id:'seam',vertices:['v0','v3'],uvSeam:true,crease:.6}]});
  const scene={id:'shop',style:'slate',solids:[],topologyMeshes:{plate:{document:doc,pivot:[0,0,0]}}};
  return {doc,scene,normal,selection:T.select(doc,{domain:'faces',ids:['painted']})};
}
const areaDirection = (doc,face)=> {
  const [a,b,c]=face.corners.map(({vertex})=>doc.vertices.find(row=>row.id===vertex).position);
  return K.V.norm(K.V.cross(K.V.sub(b,a),K.V.sub(c,a)));
};
const near=(actual,expected)=>actual.forEach((value,i)=>
  assert(Math.abs(value-expected[i])<1e-7,JSON.stringify({actual,expected})));
const viewFrom=[0,0,5];
const edges=doc=>new Map(doc.edges.map(edge=>[edge.id,edge]));
const repair=(doc,op)=>({revision:T.revision(doc),operations:[{kind:'winding',viewFrom,...op}]});

test('explicit winding repair supports a saved selection and reports facing while preserving corner identity',()=>{
  const {doc,scene,selection,normal}=fixture(), editor=ink.createSceneEditor(scene);
  const request=repair(doc,{selection});
  const plan=editor.planMeshRepair('plate',request), evidence=plan.report.steps[0];
  assert.deepEqual(evidence.reversed,['painted']);
  assert.deepEqual(evidence.facing,[{face:'painted',
    before:{corners:['c0','c1','c2','c3'],vertices:['v0','v1','v2','v3'],normal:[0,0,1],facing:'front'},
    after:{corners:['c0','c3','c2','c1'],vertices:['v0','v3','v2','v1'],normal:[0,0,-1],facing:'back'}}]);
  assert.deepEqual(plan.document.faces[0].corners[1],doc.faces[0].corners[3]);
  assert.deepEqual(plan.document.vertices,doc.vertices);
  assert.deepEqual(edges(plan.document),edges(doc));
  assert.deepEqual(plan.document.faces[0].corners[0].normal,normal);
  assert.deepEqual(editor.repairMeshTopology('plate',request).repair,plan.report);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  const reversedNormals=T.planRepair(doc,repair(doc,{faces:['painted'],normals:'reverse'}));
  assert.deepEqual(reversedNormals.document.faces[0].corners[0].normal,[0,0,-1]);
});

test('in-place reflection explicitly corrects winding and transforms authored normals in an affine frame',()=>{
  const {doc,selection}=fixture(true);
  const frame=K.sceneGraph.transform({position:[.2,-.3,0],matrix:[.7,.1,0,0,1.5,.1,0,0,2]});
  const pivot=[0,0,0], base={kind:'mirror',normal:[1,0,0],viewFrom};
  const run=winding=>T.planTransform(doc,{selection,space:'world',frame,pivot,
    operation:{...base,winding},pins:{vertices:['v0']}});
  const raw=run('preserve'), fixed=run('reverse');
  assert.deepEqual(raw.patch.vertices,fixed.patch.vertices);
  assert.deepEqual(raw.report.operation.reversed,[]);
  assert.deepEqual(fixed.report.operation.reversed,['painted']);
  assert.equal(raw.report.operation.facing[0].after.facing,'back');
  assert.equal(fixed.report.operation.facing[0].after.facing,'front');
  for (const plan of [raw,fixed]) {
    const face=plan.document.faces[0], geometric=areaDirection(plan.document,face);
    for (const corner of face.corners) {
      near(corner.normal,geometric);
      assert.deepEqual(corner.uv,doc.faces[0].corners.find(row=>row.id===corner.id).uv);
    }
    assert.deepEqual(edges(plan.document),edges(doc));
  }
  assert.throws(()=>T.planTransform(doc,{selection,operation:base}),/explicit winding/);
});

test('a face-only mirror commit works on a plane and can be undone inside a placed prefab',()=>{
  const {doc,scene,selection}=fixture(), editor=ink.createSceneEditor(scene);
  const operation={kind:'mirror',normal:[0,0,1],winding:'reverse'};
  const plan=editor.planMeshTransform('plate',{selection,operation});
  assert.deepEqual(plan.patch.vertices,[]);
  assert.equal(plan.patch.faces.length,1);
  editor.transformMeshTopology('plate',{selection,operation});
  assert.deepEqual(editor.meshTopology('plate').document,plan.document);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  const placed={id:'placed',style:'slate',solids:[],instances:{rack:{prefab:'panel',transform:{translation:[1,2,3],scale:2}}}};
  const prefabs={panel:{revision:1,solids:{},topologyMeshes:{plate:{document:doc}}}};
  const isolated=ink.createSceneEditor(placed,{env:{prefabs}});
  const request={instance:'rack',faces:{plate:['painted']},edits:[{member:'plate',transform:{operation}}]};
  assert(isolated.planPrefabIsolation(request).canCommit);
  isolated.editIsolatedPrefab(request);
  assert.deepEqual(isolated.snapshot().instances.rack.meshOverrides.plate.mesh.document,plan.document);
  assert(isolated.undo());
  assert.deepEqual(isolated.snapshot(),placed);
});

test('partial reflections report deformed neighbors and winding conflicts',()=>{
  const doc=T.fromIndexed({id:'neighbor',positions:[-1,0,0,0,0,0,0,1,0,1,0,0],indices:[0,1,2,1,3,2]});
  const [left,right]=doc.faces.map(row=>row.id);
  const selection=T.select(doc,{domain:'faces',ids:[right]});
  const mirrored=T.planTransform(doc,{selection,pivot:[0,0,0],operation:{kind:'mirror',normal:[1,0,0],winding:'reverse'}});
  assert.deepEqual(mirrored.report.operation.reversed,[right]);
  assert.deepEqual(mirrored.report.operation.windingConflicts[0].faces,[left,right]);
  const partial=T.planTransform(doc,{selection:T.select(doc,{domain:'vertices',ids:['v/3']}),pivot:[2,0,0],
    operation:{kind:'mirror',normal:[1,0,0],winding:'reverse'}});
  assert.deepEqual(partial.report.operation.partialFaces,[right]);
  assert.deepEqual(partial.report.operation.reversed,[]);
  assert.equal(partial.patch.faces,undefined);
});

test('the retained mirror reports both facing policies and keeps the old corrected default',()=>{
  const {doc}=fixture(), base={kind:'mirror',id:'reverse-copy',normal:[1,0,0]};
  const corrected=T.evaluateModifiers(doc,[{...base,winding:'reverse',viewFrom}]);
  const uncorrected=T.evaluateModifiers(doc,[{...base,winding:'preserve',viewFrom}]);
  assert(corrected.report.canApply && uncorrected.report.canApply);
  assert.deepEqual(T.evaluateModifiers(doc,[base]).document,corrected.document);
  const stage=plan=>plan.report.stages[0].evidence;
  assert.equal(stage(corrected).facing[0].after.facing,'front');
  assert.equal(stage(uncorrected).facing[0].after.facing,'back');
  assert.equal(stage(uncorrected).seamWinding[0].edge,'seam');
  assert.equal(stage(corrected).seamWinding.length,0);
  assert.equal(uncorrected.document.faces[1].corners[0].normal[2],-1);
});

test('reversing a painted triangle reorders the retained crop slots by stable corner',()=>{
  const {doc,scene}=fixture();
  const revised=T.edit(doc,{vertices:[{id:'ridge',position:[.5,1.5,0]}]});
  scene.topologyMeshes.plate.document=revised;
  scene.tilesets={tile:ink.createBlankTileset({width:4,height:4,background:'#776451'})};
  const selection=ink.pickTilesetRectangle(scene,'tile',{x:0,y:0,width:4,height:4});
  const editor=ink.createSceneEditor(scene);
  editor.createTilesetFaceFromVertices({object:'plate',face:'roof',selection,vertices:['v3','v2','ridge'],paint:{rotation:90}});
  const original=editor.eyedropTilesetFace({object:'plate',face:'roof'});
  const withRoof=editor.meshTopology('plate').document;
  editor.repairMeshTopology('plate',repair(withRoof,{faces:['roof']}));
  const flipped=editor.eyedropTilesetFace({object:'plate',face:'roof'});
  assert(flipped.canStamp);
  assert.equal(flipped.orientationStatus,'retained');
  assert.deepEqual(flipped.selection,original.selection);
  assert.deepEqual(flipped.paint,original.paint);
  assert.deepEqual(flipped.uvCorners,[0,3,1]);
  assert(editor.undo());
  assert.deepEqual(editor.eyedropTilesetFace({object:'plate',face:'roof'}),original);
});

test('CLI mirrors and explicitly repairs the reflected winding with matching reports',t=>{
  const {doc,scene,selection}=fixture(), cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mirror-winding-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write=(name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read=name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run=(...args)=>execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  write('original.json',scene);
  const base={selection,operation:{kind:'mirror',normal:[1,0,0],winding:'preserve',viewFrom}};
  write('mirror.json',base);
  const mirror=['transform','original.json','mirror.json','--object','plate'];
  const preview=JSON.parse(run(...mirror)).report;
  run(...mirror,'--out','raw.json','--report','raw-report.json');
  assert.deepEqual(read('raw-report.json').transform,preview);
  write('repair.json',repair(read('raw.json').topologyMeshes.plate.document,{faces:['painted'],normals:'reverse'}));
  run('repair','raw.json','repair.json','--object','plate','--out','fixed.json','--report','fixed-report.json');
  const corrected=read('fixed.json').topologyMeshes.plate.document;
  const direct=T.planTransform(doc,{...base,pivot:[0,0,0],operation:{...base.operation,winding:'reverse'}});
  assert.deepEqual(corrected,direct.document);
  assert.deepEqual(read('original.json'),scene);
});
