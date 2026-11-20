const assert = require('node:assert/strict');
const test = require('node:test');
const {KIT:K} = require('..').load();
const G=K.procedural.growth.differential,V=K.V;
const near=(a,b,eps=1e-7)=>assert(Math.abs(a-b)<=eps,`${a} differs from ${b}`);

test('differential rates increase specific rest lengths and keep pins exact',()=>{
  const g=G.curve({points:[[0,0,0],[1,0,0],[2,0,0],[3,0,0]],pins:[0,3],plane:'xz',clearance:0,
    rate:({edge})=>edge[0]===1?.2:0});
  const start=g.frame();
  g.step(4);
  const frame=g.frame();
  near(frame.restLengths[0],1);near(frame.restLengths[1],1.2**4);near(frame.restLengths[2],1);
  assert.deepEqual(frame.points[0],[0,0,0]);
  assert.deepEqual(frame.points[3],[3,0,0]);
  assert(frame.points.every(p=>p[1]===0));
  assert.deepEqual(start.restLengths,[1,1,1]);
});

test('splitting a closed curve retains IDs and conserves its grown rest length',()=>{
  const g=G.curve({points:[[0,0,0],[2,0,0],[2,0,2],[0,0,2]],closed:true,plane:'xz',pins:[0],
    rate:.03,stiffness:0,smooth:0,clearance:0,splitLength:1.1,maxVertices:8});
  g.step();
  const f=g.frame();
  assert.deepEqual(f.ids,[0,4,1,5,2,6,3,7]);
  assert.deepEqual(f.edges.at(-1),[7,0]);
  assert.deepEqual(f.points[0],[0,0,0]);
  near(f.restLengths.reduce((a,b)=>a+b,0),8*1.03);
  assert(Object.isFrozen(f.points[1]));
  assert.throws(()=>f.mesh(),/shell/);
});

test('separation relaxes parallel curve segments beyond their endpoint neighborhoods',()=>{
  const g=G.curve({points:[[-1,0,0],[1,0,0],[1.6,0,0],[1.6,0,.06],[1,0,.06],[-1,0,.06]],
    rate:0,stiffness:0,smooth:0,plane:'xz',clearance:.19,iterations:7});
  g.step(4);
  const {points}=g.frame();
  assert(points[4][2]-points[1][2]>.165);
  assert(points[5][2]-points[0][2]>.165);
  assert(points.every(p=>p[1]===0));
});

test('shell contact includes the interior of a face, and exposes native triangle geometry',()=>{
  const points=[[-1,0,-1],[1,0,-1],[0,0,1],[-.085,.028,-.13],[.087,.028,-.13],[.07,.028,.07]];
  const g=G.shell({points,triangles:[[0,2,1],[3,5,4]],pins:[0,1,2],rate:0,stiffness:0,smooth:0,clearance:.18,iterations:7});
  g.step(5);
  const f=g.frame();
  assert(f.points.slice(3).every(p=>p[1]>.175));
  assert.deepEqual(f.points.slice(0,3),points.slice(0,3));
  assert.deepEqual(Array.from(f.mesh().tri),[0,2,1,3,5,4]);
  assert.throws(()=>G.shell({points,triangles:[[0,1,2],[0,1,5]]}),/consistently wound/);
});

test('checkpoints replay seeded geometry and late validation leaves prior state intact',()=>{
  const options={points:[[0,0,0],[1,0,.1],[2,0,.23],[3,0,.16]],pins:[0,3],plane:'xz',splitLength:.72,
    perturbation:.02,clearance:.14,seed:19,rate:.04};
  const a=G.curve(options),b=G.curve(options);
  a.step(7);b.restore(JSON.parse(JSON.stringify(a.checkpoint())));
  const prior=a.frame(), cp=a.checkpoint();
  const rule=({tick,rest})=>.015+rest[0]*.023+(tick%2)*.004;
  a.step(5,{rate:rule});b.step(5,{rate:rule});
  assert.deepEqual(a.checkpoint(),b.checkpoint());
  assert.notDeepEqual(a.frame().points,prior.points);
  assert.throws(()=>a.step(2,{rate:({tick})=>tick===a.tick?0:NaN}),/growth rate/);
  assert.throws(()=>a.step(1,{rate:()=>a.step()}),/reentrant/);
  assert.deepEqual(a.checkpoint(),b.checkpoint());
  a.restore(cp);
  assert.deepEqual(a.frame().points,prior.points);
  const capped=G.curve({...options,maxWork:5});
  const previous=capped.frame();
  assert.throws(()=>capped.step(),/work budget/);
  assert.equal(capped.frame(),previous);
});
