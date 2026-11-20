const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, makeBuilder } = require('..').load();
const F = K.fieldViews;
const near = (a,b,tol = 1e-12) => assert(Math.abs(a-b) <= tol, `${a} differs from ${b}`);
const source = (sample) => F.source({
  type: 'vec2', components: 'xz', units: 'm/s', bounds: { min: [0,0,0], max: [8,0,4] }, sample
});

test('LIC numerically integrates authored grain along an anisotropic chart', () => {
  let reads = 0;
  const options = { counts:[16,16], length:1, kernel:'box', texture:(u,v) => .4 + .33*Math.cos(Math.PI*u) + .05*v };
  const a = F.lic(source(() => { reads++; return [2,0]; }),options);
  const b = F.lic(source(() => [-5,0]),options);
  assert.equal(reads,256);
  assert(Object.isFrozen(a.values));
  for (const i of [4,5,7,9,10]) {
    const u = (i+.5)/2, v = 1.625;
    near(a.sample(u,v),.4+.05*v);
    near(a.sample(u,v),b.sample(u,v));
    near(a.sample(u,v,'speed'),2);
    near(b.sample(u,v,'speed'),5);
  }
  assert.equal(a.source('speed').units,'m/s');
  near(a.source().sample(3.25,0,1.625),a.sample(3.25,1.625));
});

test('masked walls and sealed diagonal corners prevent pigment transfer', () => {
  const wall = F.lic(source((x) => x >= 3.5 && x < 4 ? null : [1,0]),{
    counts:[16,8],length:2,kernel:'box',texture:u => u < 4 ? 0 : 1
  });
  assert.equal(wall.sample(3.15,1),0);
  assert.equal(wall.sample(3.85,1),null);
  assert.equal(wall.sample(4.01,1),1);
  const corner = F.lic(source((x,_y,z) => (x < 1) === (z < 1) ? [1,1] : null),{
    counts:[8,4],length:2,kernel:'box',texture:u => u < 1 ? 0 : 1
  });
  assert.equal(corner.sample(.99,.99),0);
  assert.equal(corner.sample(1.01,1.01),1);
  assert.equal(corner.sample(.9,1.1),null);
});

test('oblique plates project the field and retain custom world-facing material sources', () => {
  const c = Math.SQRT1_2;
  const plane = { origin:[0,0,0],u:[c,c,0],v:[0,0,1],size:[2,1] };
  const field = F.source({ type:'vec3', bounds:{min:[0,0,0],max:[3,3,3]}, sample:() => [10*c,-10*c,2] });
  const view = F.lic(field,{ plane, counts:[12,12], length:.17, texture:(u,v) => u/4+v/4 });
  near(view.sample(.5,.5,'speed'),2);
  near(view.source().sample(.5*c,.5*c,.5),view.sample(.5,.5));
  assert.equal(view.source().sample(.5,.3,.5),null);
  const projected = view.source('grain',{bounds:{min:[-1,2,1],max:[1,3,3]},project:([x,,z]) => [x+1,z-1]});
  near(projected.sample(-.5,2.4,1.5),view.sample(.5,.5));
  const builder = makeBuilder(8);
  assert.equal(F.stamp(builder,view,{maxSplats:144}).count,144);
});

test('motion phase loops deterministically and changes sign with flow reversal', () => {
  const options = { counts:[24,12], length:.9, seed:126, grain:.26 };
  const fwd = source(() => [1,0]), rev = source(() => [-1,0]);
  const a = F.lic(fwd,{...options,motion:{wavelength:.7,phase:.25}});
  const b = F.lic(fwd,{...options,motion:{wavelength:.7,phase:1.25}});
  const c = F.lic(rev,{...options,motion:{wavelength:.7,phase:-.25}});
  assert.deepEqual(a.values,b.values);
  assert.notDeepEqual(a.values,F.lic(fwd,{...options,motion:{wavelength:.7,phase:.55}}).values);
  a.values.forEach((value,i) => near(value,c.values[i]));
  const ramp = F.lic(fwd,{counts:[32,16],length:.5,kernel:'box',texture:u => u/8,
    motion:{wavelength:1.2,phase:.25}});
  assert(ramp.sample(4,2) < .5);
  const still = F.lic(source(() => [0,0]),{...options,texture:() => .34,motion:{wavelength:.7,phase:.5}});
  assert(still.values.every(value => value === .34));
  assert.throws(() => F.lic(fwd,{...options,maxWork:16}),/work budget/);
});
