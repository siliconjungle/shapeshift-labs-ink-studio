const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const V = K.V, { surface } = K.procedural, { chart, implicit } = surface.curvature;
const near = (a,b,e=1e-5) => assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);

test('implicit curvature projects seeds and distinguishes signed saddle and umbilic samples', () => {
  const saddle = implicit((x,y,z) => y-x*x+2*z*z);
  const hit = saddle.sample([0,.2,0]);
  near(hit.point[1],0);
  near(hit.min,-2);
  near(hit.max,4);
  near(hit.mean,1);
  near(hit.gaussian,-8);
  near(Math.abs(hit.directions.min[0]),1);
  near(Math.abs(hit.directions.max[2]),1);
  assert.ok(Object.isFrozen(hit.directions.min));

  const sphere = implicit((x,y,z) => 2e-12*(x*x+y*y+z*z-4));
  const pole = sphere.sample([0,2.26,0]);
  near(pole.max,.5);
  assert.equal(pole.directions,null);
  assert.equal(sphere.trace([0,2,0]).end,'umbilic');
  assert.equal(sphere.trace([0,2,0]).path,null);
  assert.equal(sphere.sample([0,4,0]),null);
  assert.equal(sphere.sample([0,0,0]),null);
});

test('chart eigenvalues use the world metric and one-sided derivatives at open edges', () => {
  const cylinder = {
    periodicU:true,
    sample([u,v]) {
      assert.ok(u>=0 && u<=1 && v>=0 && v<=1);
      const a=2*Math.PI*(u+.23*v), x=Math.cos(a), z=Math.sin(a);
      return { p:[2*x,2.3*v,2*z], n:[x,0,z] };
    }
  };
  const field=chart(cylinder);
  const hit=field.sample([.25,0]);
  near(hit.min,0);
  near(hit.max,.5);
  near(Math.abs(hit.directions.min[1]),1);
  near(Math.abs(hit.directions.max[0]),1);
  near(V.dot(hit.directions.min,hit.directions.max),0);
  const line=field.trace([.52,.55],{family:'min',heading:[0,1,0],step:.08,length:6});
  assert.equal(line.start,'surface');
  assert.equal(line.end,'surface');
  near(line.path.length,2.3,.002);
  near(line.samples.at(-1).uv[1],1,.001);
  near(V.dot(line.frame(1).tangent,[0,1,0]),1);
  assert.equal(field.sample([0,-.25]),null);
});

test('lifted coordinates and oriented frames stay continuous across periodic and twisted seams', () => {
  const catenoid=surface.catenoid(), solver=chart(catenoid);
  const start=catenoid.sample([.98,.5]), line=solver.trace(start.uv,{
    family:'min', heading:start.du, direction:'forward', step:.025, length:.8
  });
  assert.ok(line.samples.at(-1).lift[0]>1);
  assert.ok(line.samples.at(-1).uv[0]<.2);
  near(line.samples.at(-1).point[1],0);
  near(line.samples[0].gaussian,-1/(.9*.9));

  const strip=surface.mobius(), stripField=chart(strip);
  const a=stripField.sample([1-1e-6,.3]), b=stripField.sample([1+1e-6,.3]);
  assert.equal(a.orientation,1);
  assert.equal(b.orientation,-1);
  near(V.dot(a.normal,b.normal),1);
  near(Math.abs(V.dot(a.directions.max,b.directions.max)),1);
  near(a.max,b.max,1e-4);
});

test('implicit traces close without duplicating laps and provide surface-aligned arc frames', () => {
  const solver=implicit((x,_y,z)=>x*x+z*z-4);
  const settings={ step:.047,length:14,closeDistance:.025,heading:[0,0,1] };
  const trace=solver.trace([2,0,0],settings);
  assert.equal(trace.end,'closed');
  assert.equal(trace.closed,true);
  assert.equal(trace.path.closed,true);
  near(trace.path.length,4*Math.PI,.002);
  near(V.dist(trace.frame(0).point,trace.frame(trace.path.length).point),0);
  near(V.dot(trace.frame(-.0001).tangent,trace.frame(.0001).tangent),1);
  for (const hit of trace.samples) {
    near(Math.hypot(hit.point[0],hit.point[2]),2,1e-6);
    near(V.dot(hit.normal,hit.tangent),0);
    assert.ok(hit.distance>=0 && hit.distance<=trace.path.length);
  }
  const f=trace.frame(2.13);
  near(V.dist(f.point,trace.path.frame(2.13).p),0);
  near(V.dot(f.normal,f.tangent),0);
  near(V.dot(f.normal,f.side),0);
  assert.deepEqual(solver.trace([2,0,0],settings).samples,trace.samples);
});

test('masks, limits and failed projections terminate at bounded trace samples', () => {
  const solver=implicit((x,_y,z)=>x*x+z*z-4,{ bounds:{min:[-3,-.8,-3],max:[3,.8,3]} });
  const trace=solver.trace([2,0,0],{family:'min',heading:[0,1,0],step:.11,length:3,mask:p=>p[1]<.31});
  assert.equal(trace.start,'surface');
  assert.equal(trace.end,'mask');
  assert.ok(trace.samples.every(s=>s.point[1]>=-.8 && s.point[1]<.31));
  near(trace.samples.at(-1).point[1],.31,.001);
  assert.equal(solver.trace([2,0,0],{direction:'forward',maxSteps:2}).samples.length,3);
  const rejected=solver.trace([2,0,0],{mask:()=>false});
  assert.equal(rejected.frame(0),null);
  assert.equal(rejected.start,'mask');
  assert.throws(()=>solver.trace([2,0,0],{family:'median'}),/family/);
  const backwards=solver.trace([2,0,0],{family:'min',heading:[0,1,0],direction:'backward',length:.3});
  near(backwards.samples.at(-1).point[1],-.3);
  near(backwards.frame(.2).tangent[1],-1);
});
