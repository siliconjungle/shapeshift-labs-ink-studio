'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..'), fixture=require('../examples/mesh-retopology/fixture.cjs');
const K=ink.load().KIT, api=K.meshTopology;
const empty={id:'patch',vertices:[],faces:[]};

test('SDF patch follows a joint guide, keeps pins exact, and reuses each rim edge',()=>{
  const doc=api.create(fixture.rim('sdf')), request=fixture.request(api,'sdf',doc);
  const plan=api.planRetopology(doc,request);
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert.equal(plan.patch.faces.length,48);
  assert(plan.patch.faces.every(row=>row.corners.length===4));
  assert.equal(plan.patch.vertices.length,54);
  assert.deepEqual(plan.document.faces.slice(0,doc.faces.length),doc.faces);
  assert(plan.report.rims.every(({edge})=>api.inspect(plan.document).edges.find(row=>row.id===edge).uses.length===2));
  const seam=plan.report.guides.find(row=>row.kind==='seam');
  assert.equal(seam.vertices.length,7);
  assert.equal(seam.edges.length,6);
  assert(seam.edges.every(id=>plan.report.pins.edges.includes(id)));
  for (const vertex of plan.report.vertices) {
    if (vertex.pins.length) assert.deepEqual(vertex.position,vertex.authored);
    else assert(Math.abs(K.V.len(vertex.position)-1.5)<2e-5);
  }
  const joint=plan.report.guides.find(row=>row.kind==='joint');
  const pivot=plan.report.vertices.find(row=>row.id===joint.vertices[4]);
  assert(pivot.paths.includes('pivot-arc') && pivot.paths.includes('center-flow'));
  assert(plan.report.maxDeviation>0 && plan.report.maxDeviation<request.projection.maxDeviation);
  assert.deepEqual(api.planRetopology(doc,request).report,plan.report);
  assert.throws(()=>api.planRetopology(plan.document,request),/Stale retopology target/);
});

test('mesh and scan proxies give barycentrics and reject a quad spanning missing measured data',()=>{
  const reference=fixture.meshProxy(api);
  for (const kind of ['mesh','scan-proxy']) {
    const doc=api.create(fixture.rim('mesh')), base=fixture.request(api,'mesh',doc);
    const plan=api.planRetopology(doc,{...base,surface:{kind,document:reference,revision:api.revision(reference)}});
    assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
    assert.equal(plan.report.surface.kind,kind);
    assert(plan.report.vertices.every(row=>row.hit.triangle.length===3 &&
      Math.abs(row.hit.barycentric.reduce((n,w)=>n+w,0)-1)<1e-8));
  }
  const positions=[-.55,-.55,0,-.2,-.55,0,-.2,.55,0,-.55,.55,0,
    .2,-.55,0,.55,-.55,0,.55,.55,0,.2,.55,0];
  const gap=api.fromIndexed({id:'measured',positions,indices:[0,1,2,0,2,3,4,5,6,4,6,7]});
  const command={id:'tear',revision:api.revision(empty),size:[1,1],material:'repair',
    surface:{kind:'scan-proxy',document:gap},projection:{direction:[0,0,-1],maxDistance:.18},
    rails:{bottom:{points:[[-.4,-.4,.06],[.4,-.4,.06]]},top:{points:[[-.4,.4,.06],[.4,.4,.06]]}}};
  const plan=api.planRetopology(empty,command);
  assert.equal(plan.report.canCommit,false);
  assert(plan.report.vertices.every(row=>row.hit));
  assert(plan.report.issues.some(row=>row.kind==='unsupported-quad'));
  assert.deepEqual(plan.patch,{});
});

test('conflicting guide pins and missing projection stay visible in a blocked review',()=>{
  const doc=api.create(fixture.rim('sdf')), command=fixture.request(api,'sdf',doc);
  command.pins=[{at:[2,6],kind:'seam',position:[-.45,.2,1.5]}];
  command.guides[1].points[2]=[.01,0,2.6];
  const bad=api.planRetopology(doc,command);
  assert.equal(bad.report.canCommit,false);
  assert(bad.report.issues.some(row=>row.kind==='guide-conflict'));
  assert(bad.report.issues.some(row=>row.kind==='projection-miss'));
  assert.deepEqual(bad.patch,{});
});

test('a scene SDF retopology preview yields ordinary pixel transaction evidence, undo and replay',()=>{
  const doc=api.create(fixture.rim('sdf'));
  const scene={id:'studio',style:'slate',solids:[{id:'form',kind:'ball',at:[0,0,0],r:1.5,mat:'stone'}],
    topologyMeshes:{sleeve:{document:doc,part:'plate'}}};
  const source=ink.createSceneEditor(scene), request={...fixture.request(api,'sdf',doc),surface:{kind:'sdf',object:'form'}};
  const plan=source.planMeshRetopology('sleeve',request,{part:'plate'});
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  const drawing={format:'ink-studio/pixel-art',version:2,width:8,height:8,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'sleeve',scene:'studio',object:'sleeve',part:'plate'}],
    destinations:[{id:'geometry',kind:'mesh-topology',binding:'sleeve'}]};
  const editor=ink.createPixelEditor(drawing,{sceneEditor:source});
  const edit={id:'sleeve-patch',frame:'front',revision:editor.describe().revision,destination:'geometry',
    operation:{retopology:request}};
  edit.sourceRevision=editor.previewEdit(edit).sourceRevision;
  const preview=editor.previewEdit(edit,{exact:true});
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].retopology,plan.report);
  editor.apply(edit);
  assert.deepEqual(source.meshTopology('sleeve').document,plan.document);
  const receipt=editor.receipts().at(-1);
  assert(editor.undo());
  assert.deepEqual(source.snapshot(),scene);
  editor.replay(receipt);
  assert.deepEqual(source.meshTopology('sleeve').document,plan.document);
});

test('nearest projection can bridge two ordered rims without changing adjacent quads',()=>{
  const vertices=[],faces=[];
  for (const [id,y0,y1] of [['lower',-.8,-.5],['upper',.5,.8]]) {
    for (const [i,[x,y]] of [[-.5,y0],[.5,y0],[.5,y1],[-.5,y1]].entries())
      vertices.push({id:id+i,position:[x,y,0]});
    faces.push({id,material:'rim',corners:[0,1,2,3].map(i=>({id:id+'-c'+i,vertex:id+i}))});
  }
  const doc=api.create({id:'two-rims',vertices,faces});
  const request={id:'bridge',revision:api.revision(doc),size:[1,3],material:'skin',surface:{kind:'sdf',object:'plane'},
    rims:{bottom:['lower3','lower2'],top:['upper0','upper1']},projection:{maxDistance:.12}};
  const plan=api.planRetopology(doc,request,{sdf:()=>((x,y,z)=>z)});
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert.deepEqual(plan.document.faces.slice(0,2),doc.faces);
  assert.equal(plan.patch.faces.length,3);
  assert.equal(plan.report.rims.length,2);
  assert(plan.report.rims.every(({edge})=>api.inspect(plan.document).edges.find(row=>row.id===edge).uses.length===2));
});
