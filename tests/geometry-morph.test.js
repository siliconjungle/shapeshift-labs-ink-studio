const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, makeBuilder } = require('..').load();
const { V, Q } = K, { geometryMorph } = K.procedural.motion;
const near = (a,b,e=1e-6) => assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);
const point = (a,b,e) => a.forEach((v,i) => near(v,b[i],e));
const record = (id,position) => ({id,position});
const rotate = (axis,angle) => Q.fromAxisAngle(axis,angle);

test('explicit correspondences and key poses keep a rigid feature intact at arbitrary progress', () => {
  const source = [record('bolt',[0,0,0]),record('rim',[2,0,0]),record('pin',[1,1,0]),record('lamp',[-1,0,0])];
  const target = [record('newLamp',[4,0,0]),record('newPin',[4,3,0]),record('newRim',[5,4,0]),record('newBolt',[5,2,0])];
  const geometry = {
    points:[{id:'light',from:'lamp',to:'newLamp',keys:[{at:.5,position:[-1,3,1]}]}],
    features:[{id:'bracket',pairs:[['bolt','newBolt'],['rim','newRim'],['pin','newPin']],
      from:{position:[0,0,0]},to:{position:[5,2,0],rotation:rotate([0,0,1],Math.PI/2)},
      keys:[{at:.5,position:[2,3,4],rotation:rotate([0,1,0],Math.PI/2)}]}]
  };
  const p = geometryMorph(source,target,geometry);
  const byId = t => new Map(p.sample(t).map(row => [row.from,row.position]));
  const middle = byId(.5);
  point(middle.get('bolt'),[2,3,4]);
  point(middle.get('rim'),[2,3,2]);
  point(middle.get('pin'),[2,4,3]);
  point(middle.get('lamp'),[-1,3,1]);
  for (const t of [.03,.1,.29,.66,.82,.96]) {
    const pose = byId(t);
    near(V.dist(pose.get('bolt'),pose.get('rim')),2);
    near(V.dist(pose.get('rim'),pose.get('pin')),Math.SQRT2);
  }
  const end = byId(1);
  for (const row of p.matches) assert.deepEqual(end.get(row.from),target.find(b=>b.id===row.to).position);
  assert.deepEqual(byId(0).get('rim'),[2,0,0]);
  assert.ok(Object.isFrozen(p.sample(.5)[0].position));
  geometry.features[0].keys[0].position[2]=99;
  assert.deepEqual(byId(.5),middle);
});

function build() {
  const B=makeBuilder(31,[0x142a4a,0x76cbb9]);
  const white=[241,217,140], blue=[62,91,158];
  const dab=(p,n,e,color) => B.dab(...p,n,e,.18,.08,.028,color,2.6);
  dab([0,0,0],[0,0,1],[1,0,0],white); // source feature
  dab([7,0,0],[0,0,1],[1,0,0],white); // unrelated
  dab([1,0,0],[0,0,1],[1,0,0],white); // source feature
  dab([3,1,0],[0,0,1],[0,1,0],blue);  // target feature
  dab([3,2,0],[0,0,1],[0,1,0],blue);  // target feature
  dab([-1,.5,0],[0,0,1],[1,0,0],white); // source point
  dab([2,.5,.9],[0,0,1],[0,1,0],blue); // target point
  const world=B.finish({});
  world.renderMetadata={normals:Float32Array.from({length:21},(_,i)=>i%3===2?1:0)};
  const stage=K.stage(world);
  const from=[5,0,2], to=Int32Array.of(4,6,3);
  const geometry={
    points:[{id:'bead',from:5,to:6,keys:[{at:.5,position:[-2,5,3]}]}],
    features:[{id:'bracket',pairs:[[0,3],[2,4]],from:{position:[0,0,0]},
      to:{position:[3,1,0],rotation:rotate([0,0,1],Math.PI/2)},
      keys:[{at:.5,position:[1,1,1],rotation:rotate([0,1,0],Math.PI/2)}]}]
  };
  return {B,world,stage,from,to,geometry};
}

test('stage mode keeps live IDs, rotates covariance and normals, and seeks exactly through a loop', () => {
  const {B,world,stage,from,to,geometry}=build();
  const system=K.morph(B,stage,from,to,{correspondence:'geometry',geometry,dur:1,loop:[.25,.25]});
  stage.add(system);
  const { data, renderMetadata }=world;
  stage.update(0,0);
  const start=data.slice();
  for (const id of to) assert.equal(data[id*16+3],0);
  stage.update(.01,.75);
  point(data.subarray(0,3),[1,1,1]);
  point(data.subarray(32,35),[1,1,0]);
  point(data.subarray(80,83),[-2,5,3]);
  near(data[4],.028**2);
  near(data[8],.08**2);
  near(data[10],.18**2);
  point(renderMetadata.normals.subarray(0,3),[1,0,0]);
  assert.equal(data[7],start[7]);
  assert.equal(data[3],start[3]);
  const mid=data.slice();

  stage.update(.01,1.25);
  point(data.subarray(32,35),[3,2,0]);
  near(data[4],.08**2);
  near(data[8],.18**2);
  assert.equal(data[3],start[3]);
  stage.update(.01,1.25+0.25+.50);
  assert.deepEqual(data,mid);
  stage.update(.01,2.5);
  assert.deepEqual(data,start);
  stage.update(0,.75);
  assert.deepEqual(data,mid);
  assert.equal(stage.rows[0],1);
  assert.equal(system.geometry.matches.length,3);
  assert.deepEqual(data.slice(16,32),start.slice(16,32));
});

test('manual morphs start at source, can reverse, and keep geometry borrowed by other systems', () => {
  const {B,world,stage,from,to,geometry}=build();
  const effect=stage.add(K.morph(B,stage,from,to,{correspondence:'geometry',geometry,dur:1}));
  stage.update(0,0);
  point(world.data.subarray(0,3),[0,0,0]);
  effect.go();
  stage.update(0,.5);
  point(world.data.subarray(0,3),[1,1,1]);
  effect.go(false);
  stage.update(0,.5);
  point(world.data.subarray(0,3),[1,1,1]);
  stage.physicsOwned=new Uint8Array(stage.N);
  stage.physicsOwned[2]=1;
  world.data[32]=99;
  stage.repaint(3);
  stage.update(0,1.5);
  assert.equal(world.data[32],99);
  assert.equal(world.data[3*16+3],0);
  point(world.data.subarray(0,3),[0,0,0]);
});

test('invalid pairs and impossible feature poses fail before hiding a target', () => {
  const {B,world,stage,from,to,geometry}=build();
  const original=world.data.slice();
  const options={correspondence:'geometry',geometry};
  assert.throws(()=>K.morph(B,stage,from,[4,6,0],options),/disjoint/);
  assert.throws(()=>K.morph(B,stage,from,to,{...options,dur:-1}),/timing/);
  assert.throws(()=>K.morph(B,stage,from,to,{...options,geometry:{points:geometry.points}}),/exactly once/);
  geometry.features[0].pairs.push([2,4]);
  assert.throws(()=>K.morph(B,stage,from,to,options),/unused points/);
  geometry.features[0].pairs.pop();
  geometry.features[0].pairs.length++;
  assert.throws(()=>K.morph(B,stage,from,to,options),/source and target ID/);
  geometry.features[0].pairs.pop();
  geometry.features[0].to.position[0]+=1;
  assert.throws(()=>K.morph(B,stage,from,to,options),/rigid pose tolerance/);
  assert.deepEqual(world.data,original);
  assert.equal(stage.rows[0],0);
});
