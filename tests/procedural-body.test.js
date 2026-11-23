const test = require('node:test');
const assert = require('node:assert/strict');
const toolkit = require('..').load();
const { KIT: K } = toolkit;

function body(drive=time=>[time,1,0]) {
  return K.proceduralBody.create({
    joints:{ head:{at:[0,1,0],radius:.12,drive}, neck:{at:[-.5,1,0],radius:.12},
      tail:{at:[-1,1,0],radius:.10}, fin:{at:[-.5,1.5,0],radius:.08}},
    links:[{from:'head',to:'neck'},{from:'neck',to:'tail'},{from:'neck',to:'fin'}],
    bends:[{through:['head','neck','tail'],compliance:.0001}],
    gravity:[0,-1.8,0], sdf:(_x,y)=>y
  });
}
test('one fixed clock carries a branched chain, curve driver, and rigid attachment', () => {
  const a=body(), b=body(), path=['head','neck','tail'];
  const rest={points:path.map(a.point),up:[0,1,0]};
  const fin=a.attachment('neck','fin',{at:1,offset:[.05,0,0]});
  const origin=fin.frame().point;
  for(let i=0;i<60;i++)a.step(1/60);
  for(let i=0;i<24;i++)b.step(1/24);
  assert.equal(a.time,1);
  assert.deepEqual(a.ids.map(a.point),b.ids.map(b.point));
  assert(a.point('head')[0]>.7);
  for(const [from,to] of [['head','neck'],['neck','tail'],['neck','fin']])
    assert(Math.abs(K.V.dist(a.point(from),a.point(to))-.5)<.035);
  assert.deepEqual(a.curve(path)(rest).points,path.map(a.point));
  const matrix=fin.matrix(), moved=K.V.add(K.M.app(matrix,origin),matrix.slice(9));
  assert(K.V.dist(moved,fin.frame().point)<1e-7);
  assert(Math.abs(K.M.det(matrix)-1)<1e-7);
  const copy=a.point('neck'); copy.fill(0);
  assert.notDeepEqual(a.point('neck'),copy);
  assert.throws(()=>a.curve(['head','fin']),/no link/);
  a.reset();
  assert.equal(a.time,0);
  assert.deepEqual(a.curve(path)(rest).points,rest.points);
});

test('live soft targets preserve clearance and a failing driver rolls back the step', () => {
  let fail=false;
  const a=body(t=>fail ? [NaN,t,0] : [t,1,0]);
  a.step(.2);
  const pose=a.ids.map(a.point);
  fail=true;
  assert.throws(()=>a.step(.2),/finite point/);
  assert.equal(a.time,.2);
  assert.deepEqual(a.ids.map(a.point),pose);
  fail=false;
  a.target('head',[.65,-.4,0]);
  for(let i=0;i<120;i++)a.step(1/120);
  assert(a.point('head')[1]>.10);
  assert(a.contacts().includes('head'));
  a.target('head',undefined);
  a.step(.25);
  assert(a.point('head')[1]>.7);
});

test('Sluice Diver passes the gate with flexing body and physical joint contacts', () => {
  const scene=require('../examples/procedural-body/scene.js')(toolkit), world=scene.build(scene.seed);
  const {rig}=world.diver, touched=new Set(), before=world.anim.bones.slice();
  for(let i=1;i<=126;i++){
    world.anim.update(1/24,i/24);
    rig.contacts().forEach(id=>touched.add(id));
  }
  assert(rig.point('head')[0]>2.85);
  assert(touched.has('rib') && [...touched].some(id=>id.startsWith('crest-')));
  assert.notDeepEqual(world.anim.bones,before);
  world.diver.reset();
  world.diver.target([-.03,.97,.14]);
  for(let i=1;i<=60;i++)world.anim.update(1/30,i/30);
  const center=[-.03,.97,.14];
  assert(K.V.dist(rig.point('head'),center)>.65);
  world.diver.setContacts(false);
  for(let i=61;i<=105;i++)world.anim.update(1/30,i/30);
  assert(K.V.dist(rig.point('head'),center)<.2);
});
