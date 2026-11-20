const test = require('node:test'), assert = require('node:assert/strict');
const { KIT: K, makeBuilder } = require('..').load(), { V, M } = K;
const near = (a,b,e=1e-6) => assert(Math.abs(a-b)<e, `${a} != ${b}`);
function fixture(n=12, options={}) {
  const B=makeBuilder(12,[0,0x80c0ee]);
  for(let i=0;i<n;i++) B.disc((i%4)*.14,Math.floor(i/4)*.15+.8,0,[0,0,1],.04,.007,B.P[1],2.6);
  const W=B.finish(),stage=K.stage(W),ids=Array.from({length:n},(_,i)=>i);
  return {W,stage,ids,fx:stage.add(K.materialisation.bind(stage,{ids,...options}))};
}
function referenceCurl(n,x,y,z,t,scale,speed) {
  x*=scale;y*=scale;z=z*scale+t*.13;const e=.1,k=speed/(2*e);
  return [
    (n(x,y+e,z+31)-n(x,y-e,z+31)-(n(x,y+17,z+e)-n(x,y+17,z-e)))*k,
    (n(x+5,y,z+e)-n(x+5,y,z-e)-(n(x+e,y,z+31)-n(x-e,y,z+31)))*k,
    (n(x+e,y+17,z)-n(x-e,y+17,z)-(n(x+5,y+e,z)-n(x+5,y-e,z)))*k
  ];
}
test('cached curl preserves exact finite differences across cells, collisions, negative coordinates and time',()=>{
  const curl=K.flow.curl(.38,.22),out=[0,0,0];
  for(let i=0;i<2000;i++) {
    const x=Math.sin(i)*100,y=Math.cos(i*.8)*100,z=Math.sin(i*.3)*100,t=i*.01;
    curl(x,y,z,t,out);assert.deepEqual(out,referenceCurl(K.noise3,x,y,z,t,.38,.22));
  }
  for(const p of [[0,0,0],[-1,-2,-3],[.1,.9,-.1],[2**33,-(2**34),2**35]]) {
    curl(...p,2,out);assert.deepEqual(out,referenceCurl(K.noise3,...p,2,.38,.22));
  }
});
test('warm curl samples reuse lattice corners and custom noise remains supported',()=>{
  const original=Math.sin, noise=K.noise3, curl=K.flow.curl(1,1),out=[0,0,0];let calls=0;
  try {
    Math.sin=x=>{calls++;return original(x);};
    curl(.33,.42,.55,0,out);const cold=calls;calls=0;
    curl(.33,.42,.55,0,out);assert(cold>0);assert.equal(calls,0);
    K.noise3=(x,y,z)=>x*x+y*z;
    const custom=K.flow.curl(.3,.6);custom(1,2,3,4,out);
    assert.deepEqual(out,referenceCurl(K.noise3,1,2,3,4,.3,.6));
  } finally {Math.sin=original;K.noise3=noise;}
});
test('single-anchor goal views follow replaced arrays, materials and explicit same-time updates',()=>{
  let offset=0;
  const target=K.materialisation.anchors.custom({count:1,sample(i,t,out){
    out.position=[t+offset,2,0];out.normal=[0,0,2];out.covariance=[.04,0,0,.04,0,.04];out.alpha=1+t;out.color=0x123456;
  }}),{fx,W}=fixture(3,{targets:{moving:target}});
  fx.gather('moving',{duration:.2,mapping:'index'});fx.advance(.2);
  for(let i=0;i<3;i++){near(W.data[i*16],.2);near(W.data[i*16+3],1.2);assert.equal(W.data[i*16+7],0x123456);}
  offset=3;fx.update(0);
  for(let i=0;i<3;i++)near(W.data[i*16],3.2);
  fx.advance(.1);for(let i=0;i<3;i++)near(W.data[i*16],3.3);
});
test('custom flow, force and path operators retain full contexts and flow receivers',()=>{
  let flows=0,forces=0,paths=0;
  function flow(x,y,z,t,out,ctx){assert.equal(this,flow);assert.equal(ctx.id,0);assert(ctx.source);near(ctx.time,t);assert(Number.isFinite(ctx.seed));flows++;out[0]=.2;}
  const {fx}=fixture(1,{flow,forces:[(ctx,out)=>{assert(ctx.position);assert(ctx.velocity);forces++;}],paths:[(ctx,out)=>{assert(ctx.goal);assert(ctx.progress>0);paths++;out[1]=.1;}]});
  fx.release();fx.advance(.1);fx.rejoin({duration:.2});fx.advance(.1);
  assert(flows>0&&forces>0&&paths>0);assert(K.flow.contextFree(K.flow.curl(1,1)));assert(!K.flow.contextFree(flow));
});
test('native anchor fast path carries full affine covariance and inverse-transpose normals',()=>{
  const {W,stage,fx}=fixture(2);fx.dispose();
  const A=[1.5,.4,.1,0,.8,.2,.1,0,1.2], matrix=new Float32Array(24);
  matrix.set(A,12);matrix.set([2,3,4],21);stage.rig={M:matrix,bid:new Uint16Array([1,1]),free:new Uint8Array(2)};
  const provider=K.materialisation.anchors.splats(stage,[0,1]);provider.begin(0);
  const actual=Array.from(matrix.subarray(12,21));
  for(let i=0;i<2;i++) {
    const row=provider.sample(i,0),q=i*16,base=stage.base,
      point=V.add(M.app(actual,Array.from(base.subarray(q,q+3))),[2,3,4]),
      C=[base[q+4],base[q+5],base[q+6],base[q+5],base[q+8],base[q+9],base[q+6],base[q+9],base[q+10]],
      covariance=M.mul(M.mul(actual,C),M.tr(actual)),normal=V.norm(M.app(M.tr(M.inv(actual)),[0,0,1]));
    row.position.forEach((v,j)=>near(v,point[j]));
    [0,1,2,4,5,8].forEach((k,j)=>near(row.covariance[j],covariance[k]));row.normal.forEach((v,j)=>near(v,normal[j]));
  }
});
test('scalar ownership activation retains reservation and bounds checks',()=>{
  const {stage,fx}=fixture(3);fx.dispose();const ownership=K.geometryOwnership(stage),a={},b={};ownership.reserve(a,[0,1]);
  ownership.activate(a,0);assert.equal(stage.geometryOwned[0],1);ownership.deactivate(a,0);assert.equal(stage.geometryOwned[0],0);
  assert.throws(()=>ownership.activate(b,0),/reservation/);assert.throws(()=>ownership.activate(a,2),/reservation/);
  assert.throws(()=>ownership.activate(a,3),/range/);assert.throws(()=>ownership.activate(a,.5),/range/);
  assert.equal(stage.geometryOwned[0],0);ownership.release(a);
});
test('cached curl and goals remain frame-partition independent through a full release and return',()=>{
  const settings=()=>({flow:K.flow.sum(K.flow.wind([.8,.28,0]),K.flow.curl(.38,.22)),paths:[K.materialisation.paths.arc({height:.7})]});
  const a=fixture(80,settings()),b=fixture(80,settings());a.fx.release();b.fx.release();
  a.fx.advance(.5);for(let i=0;i<30;i++)b.fx.advance(1/60);assert.deepEqual(a.W.data,b.W.data);
  a.fx.rejoin({duration:.5});b.fx.rejoin({duration:.5});a.fx.advance(.5);for(let i=0;i<30;i++)b.fx.advance(1/60);
  assert.deepEqual(a.W.data,b.W.data);assert.equal(a.fx.stats.home,80);
});
