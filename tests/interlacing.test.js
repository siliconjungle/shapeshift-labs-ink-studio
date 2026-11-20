const test = require('node:test');
const assert = require('node:assert/strict');
const {KIT:K}=require('..').load();
const {interlace}=K.procedural,V=K.V;
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('woven pattern repeats with stable IDs, independent thickness, and native arc stations',()=>{
  const out=interlace.weave({warp:[{id:'gold',radius:.063}, {id:'copper',radius:.044}, {id:'nickel',radius:.053}],
    weft:[{id:'blue',radius:.066},{id:'green',radius:.047}], spacing:[.47,.44], clearance:.028,
    pattern:['110','001'], origin:[2,4,-1],u:[0,1,0],v:[0,0,1]});
  assert.deepEqual(out.crossings.map(row=>row.over),['gold','copper','blue','green','green','nickel']);
  const map=new Map(out.strands.map(strand=>[strand.id,strand]));
  for(const row of out.crossings){
    near(row.gap,.028);
    assert.ok(row.overPoint[0]>row.underPoint[0]);
    near(V.dist(map.get(row.over).path.frame(row.overDistance).p,row.overPoint),0);
    near(V.dist(map.get(row.under).path.frame(row.underDistance).p,row.underPoint),0);
  }
  assert.equal(interlace.checkClearance(out.strands,{clearance:.028}).ok,true);
  assert.ok(Object.isFrozen(out.strands[0].path.points));
});

test('weaving rejects conflicting strand IDs and crossings without room for thickness',()=>{
  assert.throws(()=>interlace.weave({warp:[{id:'a'}],weft:[{id:'a'}]}),/unique/);
  assert.throws(()=>interlace.weave({warp:4,weft:4,spacing:[.22,.24],radius:.08}),/crossing allowances/);
  const singleton=interlace.weave({warp:1,weft:1,margin:[.05,.05],radius:.08});
  assert.ok(singleton.strands.every(s=>s.path.points.length>=2));
  assert.equal(interlace.checkClearance(singleton.strands,{clearance:.024}).ok,true);
});

test('signed braid swaps carry material IDs through the path, with interpolated frames',()=>{
  const out=interlace.braid({spine:[[0,0,0],[2,0,0],[4,.27,.22],[6,.19,.61]],
    strands:[{id:'a'},{id:'b'},{id:'c'}],word:[1,-2],spacing:.42,radius:.073,clearance:.04,samplesPerCrossing:11});
  assert.deepEqual(out.endOrder,['b','c','a']);
  assert.deepEqual(out.crossings.map(c=>[c.over,c.under,c.generator]),[['a','b',1],['c','a',-2]]);
  for(const cross of out.crossings)near(cross.separation,.42);
  assert.equal(interlace.checkClearance(out.strands,{clearance:.04}).ok,true);
  for(const strand of out.strands){
    const d=strand.path.length*.44,a=strand.path.frame(d-1e-6),b=strand.path.frame(d+1e-6);
    near(V.dot(a.N,b.N),1,1e-6);
    near(V.dot(a.T,a.N),0);
  }
});

test('closed spines return every strand and its frame at the join',()=>{
  const points=K.curve.circle([0,0,0],2.6,62,[0,1,0]);
  const spine=K.curve.path(points,{closed:true});
  assert.throws(()=>interlace.braid({spine,word:[1,-2]}),/returns every strand/);
  const out=interlace.braid({spine,word:[1,-2],repeats:3,spacing:.49});
  assert.equal(out.closed,true);
  assert.equal(out.crossings.length,6);
  assert.deepEqual(out.endOrder,['braid:0','braid:1','braid:2']);
  for(const {path} of out.strands){
    near(V.dist(path.points[0],path.points.at(-1)),0);
    near(V.dot(path.frame(1e-6).N,path.frame(path.length-1e-6).N),1,1e-7);
  }
});

test('capsule clearance catches cross-station collision on short braids and arbitrary paths',()=>{
  assert.throws(()=>interlace.braid({spine:[[0,0,0],[.13,0,0]],strands:2,
    word:[1],radius:.1,clearance:.03,spacing:.258}),/segments are too close/);
  const segments=[
    {id:'a',radius:.11,path:K.curve.path([[0,0,0],[1,0,0]])},
    {id:'b',radius:.1,path:K.curve.path([[.4,.16,-1],[.4,.16,1]])}
  ];
  const result=interlace.checkClearance(segments,{clearance:.05});
  assert.equal(result.ok,false);
  near(result.contact.distance,.16);
  near(result.contact.required,.26);
  assert.equal(interlace.checkClearance(segments.map(s=>({...s,radius:.04}))).ok,true);
});
