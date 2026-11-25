const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const {KIT:K,makeBuilder}=ink.load(), A=K.procedural.attributes, T=K.meshTopology;
const value=(n,target)=>assert(Math.abs(n-target)<1e-9,n+' vs '+target);

function panels() {
  const vertices=[
    ['a',-1,0],['b',0,0],['c',1,0],['d',-1,1],['e',0,1],['f',1,1]
  ].map(([id,x,y])=>({id,position:[x,y,0]}));
  const face=(id,ids)=>({id,corners:ids.map(vertex=>({id:id+'/'+vertex,vertex}))});
  const before=T.create({id:'panel',vertices,faces:[face('left',['a','b','e','d']),face('right',['b','c','f','e'])],
    edges:[{id:'seam',vertices:['b','e']}]});
  const result=T.editWithCorrespondence(before,{
    vertices:[{id:'middle',position:[0,.25,0]}],
    faces:[face('left',['a','b','middle','e','d']),face('right',['b','c','f','e','middle'])]
  });
  const {document:after,correspondence}=result;
  const corner=A.entities('corner',before), edge=A.entities('edge',before);
  const authored={
    corner:A.asset('corner',corner,{
      temperature:{type:'number',values:corner.map(row=>row.point[1]+(row.face==='right'?10:0))},
      paint:{values:corner.map(row=>row.face==='right'?'mint':'copper')}
    }),
    edge:A.asset('edge',edge,{width:{type:'number',values:edge.map(row=>row.id==='seam'?.4:.1)},
      role:{values:edge.map(row=>row.id==='seam'?'protected-seam':'rim')}})
  };
  return {before,after,correspondence,...authored};
}
function lookup(asset,id) {
  const data=A.open(asset);
  return data.read(data.entities.findIndex(row=>row.id===id));
}

test('face-corner sampling respects the requested side and edge channels use polygon boundaries',()=>{
  const {before,corner,edge}=panels();
  const sample=A.mesh(before,{corner,edge,edgeMaxDistance:.11});
  const a=sample.sample([0,.25,.1],{face:'left'});
  const b=sample.sample([0,.25,.1],{face:'right',domain:'corner'});
  assert.equal(a.source.edge,'seam');
  assert.equal(a.values.role,'protected-seam');
  assert.equal(a.values.paint,'copper');
  assert.equal(b.source.face,'right');
  assert.equal(b.values.paint,'mint');
  value(b.values.temperature,10.25);
  assert.equal(b.values.role,undefined);
  const center=sample.sample([-.5,.5,.1]);
  assert.equal(center.source.edge,undefined);
  assert.equal(center.values.width,undefined);
  const indexed={points:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],faces:[[0,1,2,3]]};
  const edges=A.entities('edge',indexed);
  assert.deepEqual(edges.map(r=>r.id),['edge/0/1','edge/1/2','edge/2/3','edge/0/3']);
  const native=A.mesh(indexed,{edge:{band:{values:edges.map(row=>row.id)}}});
  const hit=native.sample([.5,.5,0]);
  assert.equal(hit.values.band,'edge/0/1');
});

test('a topology split preserves edge channels and interpolates each side of a corner seam independently',()=>{
  const {before,after,correspondence,corner,edge}=panels();
  const corners=A.remap(corner,'corner',A.entities('corner',after),A.meshLineage('corner',before,after,correspondence));
  const edges=A.remap(edge,'edge',A.entities('edge',after),A.meshLineage('edge',before,after,correspondence));
  assert.deepEqual(corners.report.issues,[]);
  assert.deepEqual(edges.report.issues,[]);
  value(lookup(corners.asset,'left/middle').temperature,.25);
  value(lookup(corners.asset,'right/middle').temperature,10.25);
  assert.equal(lookup(corners.asset,'left/middle').paint,'copper');
  assert.equal(lookup(corners.asset,'right/middle').paint,'mint');
  const seam=edges.report.rows.filter(row=>row.from[0]?.id==='seam');
  assert.equal(seam.length,2);
  for(const {id} of seam) assert.deepEqual(lookup(edges.asset,id),{width:.4,role:'protected-seam'});
  assert.throws(()=>A.meshLineage('edge',before,after,{...correspondence,afterRevision:'stale'}),/pinned/);
});

test('retained cubic splits and copies carry numeric and categorical data through native control lineage',()=>{
  const C=K.curve.retained, before=C.create({format:C.format,version:1,id:'run',
    splines:[{id:'line',points:[{id:'a',position:[0,0,0],outHandle:[.4,.3,0]},{id:'b',position:[1,0,0],inHandle:[-.3,.3,0]}],
      segments:[{id:'span',from:'a',to:'b'}]}]});
  const draft=C.plan(before,{operations:[
    {op:'split',segment:'span',t:.25,point:'middle',rightSegment:'tail'},
    {op:'cut',point:'middle',newSpline:'extension',newStart:'copy'}
  ]});
  const original=A.asset('curve-control',A.entities('curve-control',before),{
    heat:{type:'number',values:[.2,1]}, pigment:{type:'label',values:['amber','turquoise']},
    conductor:{type:'label',interpolation:'constant',values:['copper','tin']}
  });
  const next=A.remap(original,'curve-control',A.entities('curve-control',draft.document),A.curveLineage(draft.report));
  for(const id of ['middle','copy']) {
    const row=lookup(next.asset,id);
    value(row.heat,.4);
    assert.equal(row.pigment,'amber');
    assert(!Object.hasOwn(row,'conductor'));
    assert(next.report.issues.some(row=>row.id===id&&row.reason==='constant-conflict'));
  }
  assert.deepEqual(lookup(next.asset,'a'),{heat:.2,pigment:'amber',conductor:'copper'});
});

test('graph transfer selects a corner side, remaps to splats and reports missing labels distinctly',()=>{
  const {before,corner}=panels(), input=[
    {id:'bead',point:[0,.25,.01],source:{face:'right'}},
    {id:'other',point:[0,.25,.01],source:{face:'left'}}
  ];
  const project=ink.createGraphProject({format:'ink-studio/graph-project',version:1,
    nodes:{
      source:{op:'attributeMesh',inputs:{mesh:before,corner}},
      paint:{op:'attributeTransfer',inputs:{source:{node:'source'},domain:'splat',entities:input,options:{sourceDomain:'corner'}}},
      attrs:{op:'attributeTable',inputs:{domain:'curve-control',entities:[{id:'a',point:[0,0,0]},{id:'b',point:[1,0,0]}],
        channels:{role:{values:[null,'hinge']},heat:{type:'number',values:[0,1]}}}},
      sprouts:{op:'attributeRemap',inputs:{source:{node:'attrs'},domain:'splat',entities:input,
        lineage:[{id:'bead',from:[{id:'a',weight:3},{id:'b',weight:1}]}]}}
    },outputs:{paint:{node:'paint'},sample:{node:'sprouts'},report:{node:'sprouts',port:'report'}}});
  const run=project.run();
  const {paint,sample,report}=run.outputs;
  assert.equal(paint[0].attributes.paint,'mint');
  assert.equal(paint[1].attributes.paint,'copper');
  assert.deepEqual(lookup(sample,'bead'),{role:null,heat:.25});
  assert.deepEqual(lookup(sample,'other'),{});
  assert.deepEqual(report.issues,[{id:'other',reason:'unmapped-element'}]);
});

test('stable splat identities and split/merge shares survive a chained change',()=>{
  const B=makeBuilder(3,[0x102430,0xe8a675]);
  B.disc(-.4,0,0,[0,0,1],.1,.02,B.P[1],1);
  B.disc(.4,0,0,[0,0,1],.1,.02,B.P[1],1);
  const world=B.finish({});
  world.splatIds=['left','right'];
  const rows=A.entities('splat',world), source=A.asset('splat',rows,{
    temperature:{type:'number',values:[0,1]}, pigment:{values:['brass','teal']}
  });
  const moves=A.splatLineage({operations:[
    {op:'split',id:'left',children:[{id:'high'},{id:'low'}]},
    {op:'merge',id:'mix',from:['low','right'],weights:[.2,.8]}
  ]});
  const result=A.remap(source,'splat',[{id:'high',point:[0,0,0]},{id:'mix',point:[1,0,0]}],moves);
  assert.deepEqual(lookup(result.asset,'high'),{temperature:0,pigment:'brass'});
  assert.deepEqual(lookup(result.asset,'mix'),{temperature:.8,pigment:'teal'});
  assert.deepEqual(result.report.unusedLineage,['low']);
  const sample=A.splats(world,A.nearest(A.open(source)),{identity:'stable'});
  assert.deepEqual(sample.map(r=>r.id),['left','right']);
});
