const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { fixture } = require('../examples/socket-cables.cjs');
const { KIT:K } = ink.load(), A=K.procedural.cableRoutes;
const near=(left,right,eps=1e-6)=>assert(Math.abs(left-right)<=eps,`${left} vs ${right}`);

test('3D bypass clears a relay and ordered pins keep exact positions through slack and socket motion',()=>{
  const {graph,signal,lifted}=fixture(A);
  const scene=K.sceneGraph.create(graph);
  const automatic=A.plan(signal,{graph:scene}), pinned=A.plan(lifted,{graph:scene});
  assert.equal(automatic.report.status,'ok');
  assert(automatic.report.guideCount>0);
  assert(automatic.report.clearance.find(row=>row.obstacle==='relay-box').gap>=signal.clearance);
  assert.equal(pinned.report.status,'ok');
  assert(pinned.report.minBendRadius>=signal.bendRadius);
  near(pinned.report.slackUsed,lifted.slack);
  for(const row of lifted.waypoints){
    const proof=pinned.report.pins.find(pin=>pin.id===row.id);
    assert(pinned.route.points.some(p=>K.V.dist(p,row.point)===0));
    assert.deepEqual(proof.point,row.point);
  }
  near(pinned.route.sample(0).tangent[0],1);
  near(pinned.route.sample(1).tangent[0],1);
  assert.deepEqual(pinned.route.points[0],[-3,1.17,.64]);
  assert.deepEqual(pinned.route.points.at(-1),[3,1.17,.64]);
  scene.setLocal('drain',{position:[3.18,.07,.72]});
  const moved=A.plan(lifted,{graph:scene});
  assert.equal(moved.report.status,'ok');
  assert.deepEqual(moved.route.points.at(-1),[3.18,1.24,.72]);
  assert.deepEqual(moved.report.pins.find(row=>row.id==='service-loop').point,[0,2.21,.64]);
  assert.deepEqual(A.plan(lifted,{graph:scene}).report,moved.report);
});

test('a vertical socket pair takes a three-dimensional detour when a slab blocks it',()=>{
  const graph={nodes:{low:{sockets:{pin:{position:[0,-2,0]}}},high:{sockets:{pin:{position:[0,2,0]}}}}};
  const cable={format:A.format,version:1,id:'vertical',from:{node:'low',socket:'pin',axis:[0,1,0],lead:.1},
    to:{node:'high',socket:'pin',axis:[0,-1,0],lead:.1},bendRadius:.17,clearance:.06,
    obstacles:[{id:'slab',min:[-.52,-.3,-.52],max:[.52,.3,.52]}]};
  const {report,route}=A.plan(cable,{graph});
  assert.equal(report.status,'ok');
  assert(report.guideCount>0);
  assert(route.points.some(([x,y,z])=>Math.abs(y)<.3&&Math.hypot(x,z)>.6));
  assert(report.clearance.every(row=>row.gap>=cable.clearance));
});

test('face contacts permit touch without penetration and infeasible routes keep their diagnostics',()=>{
  const {graph,copper,signal}=fixture(A), route=A.plan(copper,{graph});
  assert.equal(route.report.status,'ok');
  assert.equal(route.report.contacts[0].obstacle,'saddle');
  assert.equal(route.report.clearance.find(row=>row.obstacle==='saddle').gap,0);
  near(route.report.slackUsed,copper.slack);
  const up=A.plan({...copper,waypoints:[{...copper.waypoints[0],direction:[0,1,0]}]},{graph});
  assert.equal(up.report.failure,'pin-tangent');
  const cut=A.plan({...signal,waypoints:[{id:'through-box',point:[0,1,.55]}]},{graph});
  assert.equal(cut.report.status,'blocked');
  assert.equal(cut.report.failure,'search-blocked-pin');
  const strictLength={...signal,obstacles:[],length:5};
  delete strictLength.slack;
  const short=A.plan(strictLength,{graph});
  assert.equal(short.report.failure,'too-short');
  const impossible=A.plan({...signal,obstacles:[],bendRadius:4,slack:.6},{graph});
  assert.equal(impossible.report.failure,'bend-radius');
  assert(impossible.report.tightestBend.radius<4);
  assert.equal(A.plan({...signal,maxTests:2},{graph}).report.status,'budget');
  assert.equal(A.plan({...signal,from:{...signal.from,socket:'missing'}},{graph}).report.status,'unresolved');

  const collision=A.plan({...copper,obstacles:[...copper.obstacles,
    {id:'hidden-pin',min:[-.025,-.825,.73],max:[.025,-.819,.76]}]},{graph});
  assert.equal(collision.report.status,'blocked');
  assert(!collision.route);
});

test('native gap review reports visible distances, tight pairs and missing footprints',()=>{
  const frame={w:10,h:6,passes:{w:10,h:6,objects:[null,'cable','box','behind'],objectId:new Uint32Array(60),
    coverage:new Float32Array(60).fill(1)}};
  frame.passes.objectId[21]=1;
  frame.passes.objectId[25]=2;
  frame.passes.objectId[51]=1;
  frame.passes.objectId[52]=2;
  const rows=A.measureView(frame,[
    {id:'space',between:['cable','box'],rect:[0,0,9,4],minPixels:3},
    {id:'touch',between:['cable','box'],rect:[0,4,9,2],minPixels:1},
    {id:'hidden',between:['cable','behind']}
  ]).checks;
  assert.equal(rows[0].gap,3);
  assert.deepEqual(rows[0].pixels,[[1,2],[5,2]]);
  assert.equal(rows[1].status,'tight');
  assert.equal(rows[1].gap,0);
  assert.deepEqual(rows[2].missing,['behind']);
  assert.throws(()=>A.measureView({w:10,h:6},[{id:'a',between:['cable','box']}]),/native-grid/);
});

test('CLI plans a cable and measures approved views through real strand and object passes',t=>{
  const {graph,signal,lifted,copper,views}=fixture(A);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-cable-route-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=name=>path.join(root,name), save=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value));
  function run(...args) {
    return JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
      'cable-route',...args],{encoding:'utf8'}));
  }
  save('graph.json',graph);
  save('cable.json',signal);
  assert.equal(run('plan',at('cable.json'),'--graph',at('graph.json')).status,'ok');
  save('views.json',views);
  const render=require('../examples/socket-cables.cjs').nativeWorld;
  for(const [name,source,status] of [['automatic',signal,'review'],['pinned',lifted,'ok']]){
    fs.writeFileSync(at(name+'.js'),'module.exports = kit => ({ id:'+JSON.stringify(name)+', seed:32, build(){ return ('+
      render.toString()+')(kit,'+JSON.stringify({signal:source,copper,graph})+');} });');
    const folder=at(name);
    assert.equal(run('review',at(name+'.js'),at('views.json'),'--out',folder).status,status);
    const report=JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8'));
    const gaps=report.views.map(view=>view.checks[0].gap);
    if(status==='ok')assert(gaps.every(n=>n>=2));
    else assert(gaps.some(n=>n===0));
    assert(fs.existsSync(path.join(folder,'quarter.png')));
  }
});
