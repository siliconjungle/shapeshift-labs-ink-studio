'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T = K.meshTopology;
const cli = path.resolve(__dirname,'../cli/ink-studio.js');

function fixture() {
  const doc=T.fromIndexed({id:'relay-panels',positions:[
    -2,0,0, -1,0,0, -1,1,0,
     1,0,0, 2,0,0, 1,1,0,
     4,0,1, 5,0,1, 4,1,1
  ],indices:[0,1,2,3,4,5,6,7,8]});
  const scene={id:'bench',style:'slate',solids:[],topologyMeshes:{plates:{document:doc}}};
  return {doc,scene,faces:doc.faces.map(({id})=>id)};
}

const near=(actual,expected)=>actual.forEach((value,i)=>
  assert(Math.abs(value-expected[i])<1e-8,JSON.stringify({actual,expected})));
const at=(doc,id)=>doc.vertices.find(row=>row.id===id).position;
const fixed=value=>({min:value,max:value});
const authored={
  kind:'randomize',seed:173,mode:'individual',
  translation:{x:{min:-.23,max:.32,step:.1,rounding:'floor'},y:{min:-.25,max:.43,step:.125,rounding:'ceiling'}},
  rotation:{y:{min:-22,max:43,step:15},z:{min:-35,max:17}},
  scale:{x:{min:.73,max:1.31,step:.125},z:{min:.3,max:.3,step:.1}}
};

test('axis rolls are seeded, quantized inside bounds, and stable across selection order and unrelated groups',()=>{
  const {doc,faces}=fixture();
  const plan=(ids,operation)=>T.planTransform(doc,{selection:T.select(doc,{domain:'faces',ids}),operation});
  const [a,b]=faces;
  const first=plan([a,b],authored), again=plan([b,a],authored);
  assert.deepEqual(first,again);
  const evidence=first.report.operation;
  assert.equal(evidence.seed,173);
  assert.equal(evidence.mode,'individual');
  assert.equal(evidence.bounds.rotation.y.rounding,'nearest');
  assert.deepEqual(evidence.groups[0],plan([a],authored).report.operation.groups[0]);
  assert.deepEqual(evidence.groups[0],plan(faces,authored).report.operation.groups[0]);
  for (const seed of [0,1,173,901,0xffffffff]) for (const group of plan([a,b],{...authored,seed}).report.operation.groups) {
    const [x,y,z]=group.translation, [,turn]=group.rotation, [sx,sy,sz]=group.scale;
    assert(x>=-.23 && x<=.32 && y>=-.25 && y<=.43);
    assert(turn>=-22 && turn<=43 && sx>=.73 && sx<=1.31);
    near([x/.1,y/.125,turn/15,sx/.125],[x/.1,y/.125,turn/15,sx/.125].map(Math.round));
    assert.deepEqual([z,group.rotation[0],sy,sz],[0,0,1,.3]);
  }
  const different=plan([a,b],{...authored,seed:174});
  assert.notDeepEqual(first.patch,different.patch);
  assert.deepEqual(first.document.faces,doc.faces);
  assert.deepEqual(first.document.edges,doc.edges);
});

test('rounding modes choose values within the grid even for negative and offset bounds',()=>{
  const {doc,faces}=fixture(), selection=T.select(doc,{domain:'faces',ids:[faces[0]]});
  const draw=(min,max,rounding)=>T.planTransform(doc,{selection,operation:{kind:'randomize',seed:47,
    translation:{x:{min,max,step:.1,rounding}}}}).report.operation.groups[0].translation[0];
  assert.equal(draw(-.201,-.199,'floor'),-.2);
  assert.equal(draw(.299,.301,'ceiling'),.30000000000000004);
  const floor=draw(-.25,.25,'floor'), ceiling=draw(-.25,.25,'ceiling'), nearest=draw(-.25,.25,'nearest');
  assert(floor<=nearest && nearest<=ceiling && ceiling-floor<=.1000000001);
  const operation=settings=>T.planTransform(doc,{selection,operation:{kind:'randomize',seed:0,...settings}});
  assert.throws(()=>operation({scale:{x:{min:0,max:1}}}),/positive scale/);
  assert.throws(()=>operation({translation:{x:{min:.11,max:.19,step:.1}}}),/no representable step/);
  assert.throws(()=>operation({translation:{x:{min:1,max:0}}}),/ordered bounds/);
  assert.throws(()=>operation({translation:{x:{min:0,max:1,rounding:'floor'}}}),/needs a step/);
  assert.throws(()=>operation({seed:-1,rotation:{z:fixed(5)}}),/unsigned seed/);
});

test('assembly applies scale, then X/Y/Z rotations, then translation in the requested coordinates',()=>{
  const {doc,faces}=fixture(), selection=T.select(doc,{domain:'faces',ids:[faces[0]]});
  const frame=K.sceneGraph.transform({position:[3,1,2],matrix:[0,-2,0, 3,0,0, 0,0,4]});
  const operation={kind:'randomize',seed:0,translation:{x:fixed(1),z:fixed(-2)},
    rotation:{x:fixed(90),y:fixed(90),z:fixed(90)},scale:{x:fixed(2),z:fixed(3)}};
  const result=T.planTransform(doc,{selection,frame,space:'world',pivot:[0,0,0],operation});
  for (const {id,after} of result.patch.vertices.map(({id,position:after})=>({id,after}))) {
    const [x,y,z]=K.sceneGraph.point(frame,at(doc,id)), p=[(x-3)*2,y-1,(z-2)*3];
    // X then Y then Z quarter turns send [a,b,c] to [c,b,-a].
    near(K.sceneGraph.point(frame,after),[4+p[2],1+p[1],-p[0]]);
  }
  assert.equal(result.report.operation.groups.length,1);
  assert.deepEqual(result.report.operation.groups[0].pivot,[0,0,0]);
});

test('individual groups rotate around their own pivots and honor pins and copied vertices',()=>{
  const {doc,faces}=fixture();
  const source=T.edit(doc,{vertices:[{id:'copy',position:at(doc,'v/0')}]});
  const selection=T.select(source,{domain:'faces',ids:faces.slice(0,2)});
  const run=(opts,pivot)=>T.planTransform(source,{selection,coincident:true,pivot,
    operation:{kind:'randomize',seed:52,mode:'individual',rotation:{z:fixed(15)},translation:{z:fixed(.2)}},...opts});
  const plan=run({});
  const [left,right]=plan.report.operation.groups;
  near(left.pivot,[-4/3,1/3,0]);
  near(right.pivot,[4/3,1/3,0]);
  assert.deepEqual(at(plan.document,'copy'),at(plan.document,'v/0'));
  const pinned=run({pins:{vertices:['copy']}},[0,0,0]);
  assert(pinned.report.operation.groups.every(row=>row.pivot.every(value=>value===0)));
  assert.equal(pinned.patch.vertices.some(row=>row.id==='v/0' || row.id==='copy'),false);
});

test('recorded positions replay through scene, SDK and transaction without live axes or another roll',()=>{
  const {doc,scene,faces}=fixture();
  const editor=ink.createSceneEditor(scene);
  const selection=T.select(doc,{domain:'faces',ids:[faces[0]]});
  const request={selection,space:'camera',camera:{right:[0,0,-1],up:[0,1,0],back:[1,0,0]},
    falloff:{radius:2,curve:'linear'},operation:{...authored,mode:'assembly'}};
  const preview=editor.planMeshTransform('plates',request);
  const receipt=editor.transformMeshTopology('plates',request).transform;
  assert.deepEqual(receipt,preview.report);
  assert.deepEqual(receipt.operation.replay.operation.vertices,preview.patch.vertices);
  assert.throws(()=>editor.planMeshTransform('plates',receipt.operation.replay),/Stale recorded/);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  const replay=JSON.parse(JSON.stringify(receipt.operation.replay));
  const exact=T.planTransform(doc,replay);
  assert.deepEqual(exact.document,preview.document);
  assert.deepEqual(exact.patch,preview.patch);
  editor.transformMeshTopology('plates',replay);
  assert.deepEqual(editor.meshTopology('plates').document,preview.document);
  assert(editor.undo());
  replay.operation.vertices[0].position[2]+=.1;
  assert.throws(()=>editor.transformMeshTopology('plates',replay),/output revision differs/);
  assert.deepEqual(editor.snapshot(),scene);
});

test('headless replay accepts a scene transform receipt and rejects stale inputs before writing',t=>{
  const {doc,scene,faces}=fixture();
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-seeded-transforms-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write=(file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const read=file=>fs.readFileSync(path.join(cwd,file));
  const run=(...args)=>execFileSync(process.execPath,[cli,'mesh-topology','transform',...args],{cwd,encoding:'utf8'});
  write('original.json',scene);
  write('recipe.json',{selection:T.select(doc,{domain:'faces',ids:faces.slice(0,2)}),operation:authored});
  const preview=JSON.parse(run('original.json','recipe.json','--object','plates'));
  run('original.json','recipe.json','--object','plates','--out','variant.json','--report','receipt.json');
  assert.deepEqual(preview.report,JSON.parse(read('receipt.json')).transform);
  run('original.json','receipt.json','--replay','--object','plates','--out','replay.json');
  assert.deepEqual(read('variant.json'),read('replay.json'));
  const stale=spawnSync(process.execPath,[cli,'mesh-topology','transform','variant.json','receipt.json','--replay',
    '--object','plates','--out','stale.json'],{cwd,encoding:'utf8'});
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/Stale recorded random transform revision/);
  assert(!fs.existsSync(path.join(cwd,'stale.json')));
});

test('isolated prefab transforms and recorded replays honor the active member',()=>{
  const {doc,faces}=fixture();
  const scene={id:'panels',style:'slate',solids:[],instances:{rig:{prefab:'panels',transform:{translation:[1,2,3],scale:2}}}};
  const prefabs={panels:{revision:1,solids:{},topologyMeshes:{plates:{document:doc}}}};
  const editor=ink.createSceneEditor(scene,{env:{prefabs}});
  const isolate=transform=>({instance:'rig',faces:{plates:[faces[0]]},edits:[{member:'plates',transform}]});
  const request=isolate({space:'world',operation:{...authored,mode:'assembly'}});
  const planned=editor.planPrefabIsolation(request);
  assert(planned.canCommit);
  editor.editIsolatedPrefab(request);
  const after=editor.snapshot();
  assert(editor.undo());
  const replay=isolate(planned.edits[0].evidence.operation.replay);
  assert(editor.planPrefabIsolation(replay).canCommit);
  editor.editIsolatedPrefab(replay);
  assert.deepEqual(editor.snapshot(),after);
});
