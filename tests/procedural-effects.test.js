const assert = require('node:assert/strict');
const test = require('node:test');
const {KIT} = require('..').load();
const {generator:G, graph, raster:R, rasterSimulation:S} = KIT.procedural;

test('MPM preserves authored bodies and mass, collides with masks, and replays exactly', () => {
  const recipe = S.define('mpm', {
    width: 54, height: 45, gravity: [0, 130], maxSpeed: 100,
    walls: [[0, 40, 54, 5], [25, 22, 4, 18]],
    bodies: [{rect: [7, 4, 12, 10]}, {rect: [31, 6, 13, 9], material: 1, release: .35}]
  }, {seed: 42});
  const sim = S.session(recipe, {every: 8});
  const start = sim.seek(0), released = sim.seek(.3), hit = sim.seek(1);
  assert(start.report.mass > 200);
  assert.equal(start.report.mass, hit.report.mass);
  assert.deepEqual(start.points.filter(p=>p.body===1), released.points.filter(p=>p.body===1));
  assert(hit.points.every(({point:[x,y]}) => y < 40 && (x < 25 || x >= 29 || y < 22)));
  assert.notDeepEqual(start.value.data, hit.value.data);
  const later = sim.seek(1.32);
  const saved = JSON.parse(JSON.stringify(hit.checkpoint));
  assert.deepEqual(S.session(undefined, {checkpoint: saved}).seek(1.32).value, later.value);
  assert.deepEqual(sim.seek(.3).points, released.points);
  assert.throws(() => S.session(S.define('mpm', {substeps:1, maxSpeed:500})), /more substeps/);
});

test('Sphere projection exposes coverage, UVs, depth and normals through graph nodes', () => {
  const texture = R.canvas({width: 8, height: 4, color: [230,180,100,255]});
  const options = {width: 13,height: 13,radius: 5,yaw:.7};
  const result = G.projectSphere(texture, options);
  assert.deepEqual(Array.from(result.value.data.slice(0,4)), [0,0,0,0]);
  assert.equal(result.depth.data[84],1);
  assert.deepEqual(Array.from(result.normal.data.slice(252,255)), [0,0,1]);
  assert.notEqual(result.uv.data[252], G.sphereMap({...options,yaw:0}).value.data[252]);
  const composition = graph.create({
    inputs: {source:'raster'},
    nodes: {sphere: {op:'proc.projectSphere',inputs:{source:{input:'source'},options}}},
    outputs: {value:{node:'sphere'},normal:{node:'sphere',port:'normal'}}
  });
  assert.deepEqual(composition.evaluate({source:texture}).outputs.normal, result.normal);
});

test('Discharge is articulated, time-driven, and can return beauty and isolated pixel passes', () => {
  const settings = {points:[[8,14],[32,22],[55,45]],width:64,height:56,branchReach:9,period:2,seed:3};
  const start = G.discharge({...settings,time:.21});
  const later = G.discharge({...settings,time:.88});
  assert.deepEqual(start.paths[0].points[0],[8,14]);
  assert.deepEqual(start.paths[0].points.at(-1),[55,45]);
  assert.equal(start.paths.length,4);
  assert.notDeepEqual(start.filament.data,later.filament.data);
  assert.deepEqual(start.value.data,G.discharge({...settings,time:2.21}).value.data);
  assert(start.halo.data.some((n,i)=>i%4===3&&n>0));
  assert.notDeepEqual(start.value.data,start.filament.data);
});

test('Plume, vortex and seam outputs can be used apart from their final color', () => {
  const cell = { width: 31, height: 25, spacing: 7, seed: 9 };
  const a = G.cellEdges(cell), b = G.cellEdges({...cell,width:35});
  assert(a.value.data.some(d=>d<.2) && a.center.data.some(d=>d>2));
  assert(a.value.data.every(d=>d>=0));
  for(let y=0;y<25;y++)
    assert.deepEqual(a.index.data.slice(y*31,(y+1)*31),b.index.data.slice(y*35,y*35+31));

  const plume = {width:48,height:31,start:[6,15],end:[40,15],period:1,bands:4,widths:[2,9,5,0]};
  const before=G.flowPlume({...plume,time:.3}), after=G.flowPlume({...plume,time:.5});
  assert.notDeepEqual(before.heat.data,after.heat.data);
  assert.deepEqual(before.value.data,G.flowPlume({...plume,time:1.3}).value.data);
  assert(before.coverage.data.some(a=>a>.95));
  const form = {width:60,height:52,radii:[3,6,11],layers:9,segments:9,period:2,time:.23};
  const vortex=G.vortex(form);
  assert(vortex.paths.some(p=>p.depth>=0)&&vortex.paths.some(p=>p.depth<0));
  assert.notDeepEqual(vortex.front.data,vortex.back.data);
  assert.deepEqual(vortex.value.data,G.vortex({...form,time:2.23}).value.data);
});

test('A signed field sprite keeps the foreground depth and surface normal at the center', () => {
  const sphere=KIT.procedural.sceneGraph.shape('sphere',{radius:.7});
  const result=G.fieldSprite(sphere,{width:19,height:19,scale:9,orbit:[0,0],roll:.35});
  const center=9*19+9;
  assert.equal(result.value.data[3],0);
  assert.equal(result.value.data[center*4+3],255);
  assert(result.depth.data[center]>.78);
  assert(Math.abs(result.normal.data[center*3+2]-1)<1e-6);
});
