const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT:K } = require('..').load();
const { surface:S, motion, surfaceMasks, transforms } = K.procedural;
const V = K.V;
const near = (a,b,eps=1e-8) => assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const close = (a,b,eps=1e-8) => assert.ok(V.dist(a,b)<eps,`${a} != ${b}`);

test('lifted Möbius frames cross either seam direction and flip once per circuit', () => {
  const chart=S.mobius({radius:2,halfWidth:.47,halfTwists:-3});
  for (const v of [0,.23,.5,.71,1]) {
    const at=chart.sample([0,v]), reversed=chart.sample([1,1-v]), twice=chart.sample([2,v]);
    close(at.p,reversed.p);
    close(at.du,reversed.du);
    close(at.dv,V.mul(reversed.dv,-1));
    close(at.n,V.mul(reversed.n,-1));
    close(at.n,twice.n);
    close(chart.sample([1-1e-7,v]).n,chart.sample([1+1e-7,v]).n,1e-5);
    close(chart.sample([-1e-7,v]).n,chart.sample([1e-7,v]).n,1e-5);
  }
  assert.equal(chart.sample([-1.02,.3]).orientation,1);
  assert.throws(()=>chart.sample([.5,1.04]),/open chart/);
  assert.throws(()=>S.mobius({halfTwists:2}),/odd/);
});

test('Klein immersion joins in both axes and keeps crossing frames distinct', () => {
  const chart=S.kleinBottle();
  close(chart.sample([1,.27]).p,chart.sample([0,.73]).p);
  close(chart.sample([.25,1.27]).p,chart.sample([.25,.27]).p);
  close(chart.sample([1.001,.227]).n,chart.sample([.999,.227]).n,.04);
  close(chart.sample([.18,0]).p,chart.sample([.18,.5]).p);
  assert.ok(Math.abs(V.dot(chart.sample([.18,0]).n,chart.sample([.18,.5]).n))<.95);
  const mesh=chart.mesh({segments:[24,12]});
  for(let row=0;row<=12;row++){
    const start=((12-row)*25)*3,end=(row*25+24)*3;
    close(Array.from(mesh.points.slice(start,start+3)),Array.from(mesh.points.slice(end,end+3)),1e-7);
  }
});

test('both minimal carriers have regular frames and numerically zero mean curvature', () => {
  const catenoid=S.catenoid({radius:.89,height:2.1}),helicoid=S.helicoid({pitch:-1.7,turns:2.1});
  const eps=1e-5;
  for (const chart of [catenoid,helicoid]) for(const [u,v] of [[.23,.41],[.61,.56],[.77,.83],[.34,.5]]) {
    const {du,dv,n}=chart.sample([u,v]);
    const e=V.dot(n,V.mul(V.sub(chart.sample([u+eps,v]).du,chart.sample([u-eps,v]).du),.5/eps));
    const f=V.dot(n,V.mul(V.sub(chart.sample([u,v+eps]).du,chart.sample([u,v-eps]).du),.5/eps));
    const g=V.dot(n,V.mul(V.sub(chart.sample([u,v+eps]).dv,chart.sample([u,v-eps]).dv),.5/eps));
    const E=V.dot(du,du),F=V.dot(du,dv),G=V.dot(dv,dv);
    near(V.len(n),1);
    near((e*G-2*f*F+g*E)/(2*(E*G-F*F)),0,1e-7);
  }
  close(catenoid.sample([0,.78]).p,catenoid.sample([1,.78]).p);
  assert.ok(V.dist(helicoid.sample([0,.5]).p,helicoid.sample([1,.5]).p)>3);
  assert.throws(()=>S.catenoid({radius:.01,height:5}),/extent/);
});

test('affine chart wrappers preserve both joins, analytic derivatives and mesh samples', () => {
  const chart=S.transform(S.kleinBottle(),transforms.local({position:[2,1,-2],rotation:[.25,-.35,.5],scale:[-1,1.3,.55]}));
  const a=chart.sample([1,.29]),b=chart.sample([0,.71]);
  close(a.p,b.p);
  close(a.dv,V.mul(b.dv,-1));
  close(a.n,V.mul(b.n,-1));
  close(chart.samplePointNormal([1,.29]).n,a.n);
  near(V.dot(a.n,a.tangent),0);
  assert.equal(chart.topology.periodicV,true);
  assert.equal(chart.mesh({segments:[3,5]}).triangles.length,90);
});

test('midpoint advection uses the lifted derivatives and preserves the traveling normal', () => {
  const chart=S.mobius();
  const sim=motion.surfaceAdvection(chart,[[.94,.23]],{step:.3,
    velocity:(_x,_y,_z,_t,{du,dv})=>V.mad(V.mul(du,.4),dv,.08)});
  const p=sim.advance(.3).particles[0],expected=chart.sample([1.06,.254]);
  near(p.uv[0],.06);
  near(p.uv[1],.746);
  near(p.lift[0],1.06);
  assert.equal(p.orientation,-1);
  close(p.position,expected.p);
  close(p.normal,expected.n);
  assert.equal(sim.reset().particles[0].orientation,1);
  const open=motion.surfaceAdvection(S.helicoid(),[[.95,.5]],{step:.05,boundary:'stop',
    velocity:(_x,_y,_z,_t,{du})=>du});
  assert.equal(open.advance(.2).particles[0].active,false);
});

test('Klein intrinsic motion crosses both joins without switching across a self-intersection', () => {
  const chart=S.kleinBottle();
  const sim=motion.surfaceAdvection(chart,[[.94,.96],[.94,.46]],{step:.18,
    velocity:(_x,_y,_z,_t,{du,dv})=>V.mad(V.mul(du,.57),dv,.44)});
  const out=sim.advance(.18).particles;
  for(let i=0;i<2;i++){
    close(out[i].position,chart.sample([.94+.18*.57,.96-.5*i+.18*.44]).p);
    assert.equal(out[i].orientation,-1);
  }
});

test('topological paint and dirty regions reflect at twisted joins and wrap around the tube', () => {
  const topology=S.mobius().topology, options={size:[2,1],topology};
  const brush={points:[[.94,.23],[.06,.77]],width:.125,softness:.014};
  const single=surfaceMasks.compile([brush],options);
  assert.equal(single.weight(.99,.23),1);
  assert.equal(single.weight(.01,.77),1);
  assert.equal(single.weight(1.01,.23),1);
  assert.equal(single.weight(.01,.23),0);
  const erase=surfaceMasks.compile([brush,{points:[[.997,.23]],width:.075,operation:'erase'}],options);
  assert.equal(erase.weight(.003,.77),0);
  assert.ok(surfaceMasks.dirtyBounds([], [brush],options).some(({min,max})=>min[0]===0 && min[1]<.77 && max[1]>.77));
  const tube=S.kleinBottle().topology;
  const loop=surfaceMasks.compile([{points:[[.23,.95],[.23,.04]],width:.12}],{size:[2,1],topology:tube});
  assert.equal(loop.weight(.23,.99),1);
  assert.equal(loop.weight(.23,.01),1);
  assert.equal(loop.weight(.23,.50),0);
});
