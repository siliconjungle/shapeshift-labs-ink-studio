const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K, SurfaceLook } = require('..').load();
const potential = K.procedural.fields.potential;
const near = (a,b,eps = 2e-7) => assert(Math.abs(a-b) <= eps, `${a} differs from ${b}`);

test('fixed faces solve a manufactured affine potential on an anisotropic grid', () => {
  const origin = [-1,2], width = 39, height = 24, cell = [.07,.17];
  const field = (x,z) => .28+1.5*x-.6*z;
  const res = potential({origin,width,height,cell}).solve({
    boundary:{xMin:field,xMax:field,zMin:field,zMax:field},tolerance:1e-11
  });
  assert(res.stats.converged);
  for (let row=0;row<height;row++) for (let col=0;col<width;col++) {
    const x = origin[0]+(col+.5)*cell[0], z = origin[1]+(row+.5)*cell[1];
    near(res.sample('potential',x,z),field(x,z));
    const [gx,gz] = res.sample('gradient',x,z);
    near(gx,1.5); near(gz,-.6);
  }
  near(res.sample('magnitude',.6,3),Math.hypot(1.5,.6));
});

test('masks insulate closed rooms and bend flow through an off-axis opening', () => {
  const dims = {width:58,height:42,cell:.10};
  const boundary = {xMin:1,xMax:0};
  const closed = potential({...dims,mask:x => Math.abs(x-2.90)>.14}).solve({boundary});
  assert.equal(closed.stats.components,2);
  assert.equal(closed.stats.iterations,0);
  near(closed.sample('potential',1.50,2),1);
  near(closed.sample('potential',4.10,2),0);
  near(closed.sample('magnitude',1.50,2),0);
  assert.equal(closed.sample('potential',2.90,2),null);

  const open = potential({...dims,mask:(x,z) => Math.abs(x-2.90)>.14 || Math.abs(z-3.40)<.32}).solve({boundary});
  assert(open.stats.converged);
  assert(open.sample('flow',2.9,3.4)[0]>.21);
  assert(open.sample('flow',2.6,2.7)[1]>.04);
  assert(open.data().every(n => n>=-1e-7 && n<=1+1e-7));
});

test('pins and floating components stay independent even at diagonally touching cells', () => {
  const grid = potential({width:2,height:2,cell:1,mask:(x,z) => (x<1)===(z<1)});
  const res = grid.solve({pins:[{at:[.3,.8],value:9}],floating:-5});
  assert.deepEqual(res.stats,{converged:true,residual:0,iterations:0,components:2,unanchored:1});
  assert.equal(res.sample('potential',.999,.999),9);
  assert.equal(res.sample('potential',1.001,1.001),-5);
  assert.equal(res.sample('potential',1.001,.999),null);
  assert.throws(() => grid.solve({pins:[{at:[.5,1.1],value:1}]}),/open cell/);
  assert.throws(() => grid.solve({pin:() => 2,pins:[{at:[.4,.6],value:3}]}),/conflicting pins/);
});

test('bounded solves report their residual and retained warm starts preserve prior results', () => {
  const grid = potential({width:40,height:31,cell:.1});
  const pins = [{at:[.65,1.55],radius:.23,value:1},{at:[3.35,1.55],radius:.23,value:-.5}];
  const short = grid.solve({pins,maxWork:1300,tolerance:1e-11});
  assert.equal(short.stats.iterations,1);
  assert(!short.stats.converged && short.stats.residual>1e-11);
  const exact = grid.solve({pins,initial:short,tolerance:1e-11});
  assert(exact.stats.converged);
  near(exact.sample('potential',.65,1.55),1);
  near(exact.sample('potential',3.35,1.55),-.5);
  const repeated = grid.solve({pins,initial:exact,tolerance:1e-11});
  assert.equal(repeated.stats.iterations,0);
  assert.deepEqual(repeated.data(),exact.data());
  exact.data().fill(13);
  near(exact.sample('potential',.65,1.55),1);
  assert.throws(() => potential({width:40,height:31,cell:.1}).solve({initial:exact}),/constraints/);
});

test('world sources compose with contours and vector-field painting', () => {
  const field = potential({width:40,height:25,cell:.1}).solve({boundary:{xMin:1,xMax:0}});
  const contours = field.contours({cell:.08,levels:[.5]});
  assert.equal(contours.paths.length,1);
  assert(contours.paths[0].points.every(p => Math.abs(p[0]-2)<1e-5));
  const grain = K.fieldViews.lic(field.source('flow'),{counts:[32,20],length:.25});
  assert(grain.values.every(Number.isFinite));
  const wall = field.source('gradient',{bounds:{min:[0,0,3],max:[4,2.5,3]},project:([x,y])=>[x,y],
    vectorToWorld:([gx,gz])=>[gx,gz,0]});
  const [a,b,c] = wall.sample(1,.8,3);
  near(a,-.25); near(b,0); near(c,0);
  const context = K.splatEffects.context({fields:{voltage:field}});
  const material = SurfaceLook.prepare({layers:{ink:{type:'projected',field:'voltage',maskChannel:'potential',
    color:'#ffcc88',projection:([x,,z])=>[x,z]}}},[],[0,1,0],context);
  const color = x => SurfaceLook.shade(material,{position:[x,0,.8],normal:[0,1,0],view:[0,1,0]},[0,0,0]);
  assert(color(.15)[0] > color(3.85)[0]);
});
