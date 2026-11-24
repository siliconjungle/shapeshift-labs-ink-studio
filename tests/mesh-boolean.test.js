'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..'), {box,gauge}=require('../examples/mesh-boolean/fixture.js');
const K=ink.load().KIT, api=K.meshTopology;
const target=box('body',[-1,-1,-1],[1,1,1],'jade');
const tool=box('cutter',[0,-1,-1],[2,1,1],'cutter');
const request=(a,b,operation,extra={})=>({id:operation,revision:api.revision(a),operation,
  operand:{document:b,revision:api.revision(b)},...extra});

function volume(document) {
  const {positions,indices}=api.triangulate(document);
  const p=i=>positions.slice(indices[i]*3,indices[i]*3+3);
  let sum=0;
  for (let i=0;i<indices.length;i+=3) sum+=K.V.dot(p(i),K.V.cross(p(i+1),p(i+2)))/6;
  return sum;
}

test('mesh Booleans classify coplanar overlaps and keep a conforming oriented boundary',()=>{
  for (const [operation,expected] of [['union',12],['difference',4],['intersection',4]]) {
    const change=api.planBoolean(target,request(target,tool,operation));
    assert(change.report.canCommit,JSON.stringify(change.report.issues));
    assert(Math.abs(volume(change.document)-expected)<1e-5,operation);
    assert(api.inspect(change.document).edges.every(row=>row.uses.length===2),operation);
    const health=api.health(change.document,{intersectionTolerance:1e-7});
    assert.equal(health.counts.winding,0,operation);
    assert.equal(health.counts.selfIntersections,0,operation);
    if (operation==='difference') {
      const old=api.create(target);
      assert.deepEqual(change.document.faces.find(row=>row.id==='body-f0'),old.faces.find(row=>row.id==='body-f0'));
      assert(change.patch.lineage.faces.length>0);
      assert(change.patch.lineage.edges.length>0);
    }
  }
  const same=api.planBoolean(target,request(target,target,'difference'));
  assert.equal(same.report.empty,true);
  assert.deepEqual(same.document.faces,[]);
  const disjoint=box('spare',[4,0,0],[5,1,1],'off');
  const unchanged=api.planBoolean(target,request(target,disjoint,'difference'));
  assert.equal(unchanged.report.afterRevision,api.revision(target));
  assert.deepEqual(unchanged.patch,{});
});

test('closed same-mesh selections consume the operands and leave unrelated authored parts intact',()=>{
  const spare=box('handle',[4,0,0],[5,1,1],'oak');
  const combined={id:'assembly',vertices:[...target.vertices,...tool.vertices,...spare.vertices],
    faces:[...target.faces,...tool.faces,...spare.faces]};
  const revision=api.revision(combined);
  const selection={domain:'faces',ids:target.faces.map(row=>row.id)};
  const toolSelection={domain:'faces',ids:tool.faces.map(row=>row.id)};
  const command={id:'slot',revision,operation:'difference',selection,cutMaterial:'raw-jade',
    operand:{revision,selection:toolSelection}};
  const result=api.planBoolean(combined,command);
  assert(result.report.canCommit,JSON.stringify(result.report.issues));
  assert(Math.abs(volume(result.document)-5)<1e-5);
  assert.deepEqual(result.document.faces.filter(row=>row.material==='oak'),api.create(spare).faces);
  assert(result.report.faces.some(row=>row.operand==='tool' && row.material==='raw-jade'));
  assert.throws(()=>api.planBoolean(combined,{...command,operand:{revision:'stale',selection:toolSelection}}),/Stale mesh Boolean operand/);
  const open={...target,faces:target.faces.slice(1)};
  const rejected=api.planBoolean(open,request(open,tool,'union'));
  assert.equal(rejected.report.canCommit,false);
  assert.equal(rejected.report.issues[0].code,'operand-open-or-winding');
});

test('the requested field fallback reports measured edge, wall and ownership losses',()=>{
  const {target,cutter}=gauge();
  const plan=api.planBoolean(target,request(target,cutter,'difference',{
    cutMaterial:'fresh-copper',solver:{kind:'sdf',cell:.19,probes:[
      {id:'fin',origin:[1.4,0,-2],direction:[0,0,1],distance:4}
    ]}
  }));
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert(plan.reference);
  assert(Math.abs(volume(plan.reference)-3.806694)<1e-5);
  const {edgeShape,shellThickness,materialOwnership}=plan.report.diagnostics;
  assert.equal(edgeShape.reference,'mesh-boolean');
  assert(edgeShape.changed>0 && edgeShape.samples.some(row=>row.projected && row.changed));
  const lost=shellThickness.samples.find(row=>row.probe==='fin' && row.status==='lost-wall');
  assert(lost && Math.abs(lost.expected[1]-lost.expected[0]-.12)<1e-6);
  assert(shellThickness.changed>0);
  assert(materialOwnership.changedMaterial>0 && materialOwnership.changedOwner>0);
  assert(plan.report.faces.some(row=>row.operand==='tool' && row.material==='fresh-copper'));
  assert(api.inspect(plan.document).edges.every(row=>row.uses.length===2));
  assert.throws(()=>api.planBoolean(target,request(target,cutter,'difference',{solver:{kind:'sdf'}})),/explicit cell size/);
  const budget=api.planBoolean(target,request(target,cutter,'difference',{maxWork:1}));
  assert.equal(budget.report.canCommit,false);
  assert.equal(budget.report.solver,'mesh');
  assert.equal(budget.report.field,undefined);
  const fallback=api.planBoolean(target,request(target,cutter,'difference',{maxWork:1,solver:{kind:'sdf',cell:.19}}));
  assert(fallback.report.canCommit,JSON.stringify(fallback.report.issues));
  assert.equal(fallback.report.diagnostics.edgeShape.reference,'eligible-input-edges');
});

test('Boolean preview and pixel transactions retain the operand, its materials, and undo',()=>{
  const scene={id:'workbench',style:'slate',solids:[],topologyMeshes:{
    body:{document:api.create(target),part:'panel',materials:[{id:'jade',color:0x488478}]},
    tool:{document:api.create(tool),part:'blade',materials:[{id:'cutter',color:0xd48f67}]}
  }};
  const source=ink.createSceneEditor(scene);
  const command={id:'splice',revision:api.revision(target),operation:'union',operand:{object:'tool',part:'blade',revision:api.revision(tool)}};
  const planned=source.planMeshBoolean('body',command);
  assert(planned.report.canCommit);
  assert.deepEqual(source.snapshot(),scene);
  const panel={format:'ink-studio/pixel-art',version:2,width:8,height:8,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'body',scene:'workbench',object:'body',part:'panel'}],
    destinations:[{id:'geometry',kind:'mesh-topology',binding:'body'}]};
  const pixels=ink.createPixelEditor(panel,{sceneEditor:source});
  const edit={id:'splice',frame:'front',revision:pixels.describe().revision,destination:'geometry',operation:{boolean:command}};
  edit.sourceRevision=pixels.previewEdit(edit).sourceRevision;
  const preview=pixels.previewEdit(edit,{exact:true});
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].boolean,planned.report);
  pixels.apply(edit);
  assert.deepEqual(source.meshTopology('body').document,planned.document);
  assert.deepEqual(source.meshTopology('body').materials,planned.materials);
  assert.deepEqual(source.meshTopology('tool'),scene.topologyMeshes.tool);
  const receipt=pixels.receipts().at(-1);
  assert(pixels.undo());
  assert.deepEqual(source.snapshot(),scene);
  pixels.replay(receipt);
  assert.deepEqual(source.meshTopology('body').document,planned.document);
});
