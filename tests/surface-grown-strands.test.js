const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const {KIT:K,makeBuilder}=ink.load();
const C=K.curveSplats;
const identity=[1,0,0,0,1,0,0,0,1,0,0,0];
const palette=[0x141f29,0x577f8c,0xf2c28e];
const style={object:'threads',material:'cotton',width:.035,edge:'hard',color:'#f2c28e'};
const cam={target:[0,0,0],yaw:0,pitch:0,dist:5};
const worldOf=(B,assets={})=>B.finish({cam,radius:5,dither:0,fog:{c:0,start:1,max:0},...assets});
const close=(actual,expected,epsilon=1e-5)=>assert(K.V.dist(actual,expected)<epsilon,
  JSON.stringify({actual,expected,epsilon}));

function mesh() {
  return K.sceneMeshes.create({id:'fabric',positions:[-1,-1,0,1,-1,0,-1,1,0,1,1,0],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id:'fabric',color:palette[1]}]});
}
function endpoint(world, i, sign) {
  const q=i*16, station=i*C.renderKernel.stationStride;
  return K.V.mad(Array.from(world.data.subarray(q,q+3)),world.curveStations.subarray(station+4,station+7),
    sign*world.data[q+13]);
}

test('UV roots and both stitch holes follow the same skinned triangles as the native mesh',()=>{
  const B=makeBuilder(5,palette), cloth=mesh(), skin=K.sceneMeshes.skin(cloth,[0,[[0,.25],[1,.75]],0,1]);
  const growth=C.grow(B,{kind:'uv',mesh:cloth},{
    segments:5,roots:[{id:'pile',uv:[.25,.25]}],
    stitches:[{id:'seam',from:[.13,.18],to:[.83,.68],lift:.11}]
  },style);
  const world=worldOf(B,{meshes:[cloth]});
  const matrices=Float32Array.from([...identity,...identity]);
  const bones=K.bones.bind(world,{ids:[],bid:[],M:matrices,
    meshBindings:[skin],curveBindings:[growth],pose(t){
      matrices[21]=.4*t;
      matrices[22]=-.2*t;
      matrices[23]=.8*t;
    }});
  bones.update(1/60,1);
  const [pile,seam]=growth.snapshot().strands;
  assert.equal(pile.roots[0].triangle,0);
  assert.deepEqual(pile.roots[0].weights,[.5,.25,.25]);
  close(pile.roots[0].point,[-.425,-.5375,.15]);
  close(endpoint(world,growth.threads[0].first,-1),pile.roots[0].point);
  close(endpoint(world,growth.threads[1].first,-1),seam.roots[0].point);
  close(endpoint(world,growth.threads[1].end-1,1),seam.roots[1].point);
  assert.equal(seam.roots[1].triangle,1);
  assert(world.renderMetadata.targets.some(target=>target?.surface==='seam' && target.entity==='threads'));
  const chart=growth.snapshot();
  growth.pose(world);
  assert.deepEqual(growth.snapshot().strands,chart.strands);
  assert.equal(growth.snapshot().updates.reused,3);
  K.sceneMeshes.pose(cloth,new Float32Array(12));
  growth.pose(world);
  assert.equal(growth.snapshot().updates.detached,3);
  assert.equal(world.data[growth.first*16+3],0);
  bones.update(1/60,1);
  assert.equal(growth.snapshot().updates.reattached,3);
  assert.deepEqual(growth.snapshot().strands,chart.strands);
});

test('seeded UV density keeps cell IDs, and a missing chart root can hide and recover',()=>{
  const make=seed=>{
    let damaged=false, lift=0;
    const B=makeBuilder(4,palette), chart={sample:([u,v])=>({p:[u,v,lift],n:[0,0,1]}),intact:([u])=>!damaged || u>.4};
    const binding=C.grow(B,{kind:'uv',chart},{seed,scatter:{cells:[5,3],jitter:.8},segments:4},style);
    const world=worldOf(B);
    return {binding,world,edit:(cut,z)=>{damaged=cut; lift=z; binding.pose(world);}};
  };
  const first=make(81), second=make(81), different=make(63);
  const roots=first.binding.snapshot().strands;
  assert.deepEqual(second.binding.snapshot().strands,roots);
  assert.notDeepEqual(different.binding.snapshot().strands,roots);
  first.edit(true,.3);
  const changed=first.binding.snapshot();
  assert.equal(changed.updates.detached,6);
  for (const [i,row] of changed.strands.entries()) {
    assert.equal(row.id,roots[i].id);
    const range=first.binding.threads[i];
    for(let r=range.first;r<range.end;r++) assert.equal(first.world.data[r*16+3],row.attached ? 1 : 0);
  }
  first.edit(false,.42);
  const restored=first.binding.snapshot();
  assert.equal(restored.updates.reattached,6);
  assert(restored.strands.every(row=>row.attached && row.roots[0].point[2]===.42));
  assert.throws(()=>C.grow(makeBuilder(2,palette),{kind:'uv',mesh:mesh()},{roots:[{uv:[.8,.8],triangle:0}]},style),
    /outside its authored surface/);
});

test('SDF strands follow bounded local edits, leave a deep cut empty, and reattach on undo',()=>{
  const P=K.procedural, B=makeBuilder(4,palette);
  const bricks=P.sparseBricks.create({cell:.06,brickSize:6,
    base:(x,y,z)=>Math.max(Math.abs(x)-2.4,Math.abs(y+.28)-.28,Math.abs(z)-1.05)});
  const field=P.brickMeshes.create({bricks,objectId:'slab',bounds:{min:[-2.7,-.72,-1.3],max:[2.7,.36,1.3]},
    materials:[{id:'clay',color:0x815e50}]});
  const binding=C.grow(B,{kind:'sdf',field,reach:.26},{
    roots:[{id:'edited',point:[-1.1,0,0],normal:[0,1,0]},{id:'untouched',point:[1.42,0,0],normal:[0,1,0]}],
    segments:6,length:.25
  },style);
  const world=worldOf(B,{brickMeshes:[field]});
  const bounds={min:[-1.47,-.61,-.35],max:[-.73,.33,.35]};
  const radius=(x,z)=>Math.hypot(x+1.1,z)-.31;
  field.edit({operation:'subtract',bounds,sdf:(x,y,z)=>Math.max(radius(x,z),Math.abs(y-.08)-.23)});
  binding.pose(world);
  const [edited,untouched]=binding.snapshot().strands;
  close(edited.roots[0].point,[-1.1,-.15,0],.025);
  close(untouched.roots[0].point,[1.42,0,0]);
  assert.equal(binding.snapshot().updates.reused,1);
  const actual=endpoint(world,binding.threads[0].first,-1);
  close(actual,edited.roots[0].point);
  field.edit({operation:'subtract',bounds,sdf:(x,y,z)=>radius(x,z)});
  binding.pose(world);
  assert.equal(binding.snapshot().updates.detached,1);
  assert.equal(binding.snapshot().strands[0].attached,false);
  assert.equal(world.data[binding.threads[0].first*16+3],0);
  field.update(bricks);
  binding.pose(world);
  assert.equal(binding.snapshot().updates.reattached,1);
  close(endpoint(world,binding.threads[0].first,-1),[-1.1,0,0]);
  const frame=ink.render(world,{w:120,h:80,px:1,raw:true,renderStats:true});
  assert(frame.renderStats.curveSegments>=12);
});

test('native cloth presents grown roots from its currently posed chart',()=>{
  const B=makeBuilder(8,palette), cloth=K.cloth(B,{nu:4,nv:3,at:[-1,0,0],u:[2,0,0],v:[0,1,0],
    pins:()=>false,gravity:[0,0,0],pattern:()=>[1,2]});
  const grown=cloth.bindGrowth({roots:[[.22,.52]],segments:5,length:.48},style);
  const world=worldOf(B), stage=K.stage(world);
  const lifted=cloth.restPose().map((value,i)=>i%3===2 ? value+.35 : value);
  cloth.drawPose(stage,lifted);
  close(grown.snapshot().strands[0].roots[0].point,[-.56,.52,.35]);
  close(endpoint(world,grown.first,-1),[-.56,.52,.35]);
  cloth.sim.resetPose(cloth.restPose());
  stage.add(cloth);
  stage.update(0,0);
  close(endpoint(world,grown.first,-1),[-.56,.52,0]);
});
