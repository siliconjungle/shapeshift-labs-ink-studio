const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:K}=require('..').load();
const {data,geometry,lod}=K.procedural;
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<=e,a+' differs from '+b);

test('quadric simplification reduces a closed sphere and keeps its topology and pins',()=>{
  const field=(x,y,z)=>Math.hypot(x,y,z)-1,
    source=geometry.dualContour(field,{min:[-1.4,-1.4,-1.4],max:[1.4,1.4,1.4]},{cell:0.17}),
    result=geometry.simplifyQEM(source,{ratio:0.28,maxError:0.06,locked:[4,50]});
  assert.equal(result.status,'ok');
  assert(result.triangles.length<=source.triangles.length*0.28);
  assert(result.work.maxError<0.03);
  for(const i of [4,50])for(let axis=0;axis<3;axis++)
    near(result.points[result.pointMap[i]][axis],source.points[i][axis]);
  const edges=new Map();
  for(const face of result.triangles)for(let i=0;i<3;i++){
    const key=[face[i],face[(i+1)%3]].sort((a,b)=>a-b).join('/');
    edges.set(key,(edges.get(key)??0)+1);
  }
  assert([...edges.values()].every(n=>n===2));
  assert.equal(result.points.length-edges.size+result.triangles.length,2);
});

test('material seams and open borders retain their vertex positions during preview reduction',()=>{
  const size=7, points=Array.from({length:size*size},(_,i)=>[i%size,0,Math.floor(i/size)]), triangles=[],groups=[];
  for(let z=0;z<size-1;z++)for(let x=0;x<size-1;x++){
    const i=z*size+x;
    triangles.push([i,i+size,i+size+1],[i,i+size+1,i+1]);
    const material=x<3?'tile':'inlay';
    groups.push({owner:'floor',material},{owner:'floor',material});
  }
  const reduced=geometry.simplifyQEM({points,triangles},{ratio:0.68,groups});
  assert(reduced.work.collapsed>1);
  for(const [i,[x,_,z]] of points.entries()){
    if(x===3||x===0||z===0||x===6||z===6)assert.deepEqual(reduced.points[reduced.pointMap[i]],points[i]);
  }
  assert.deepEqual(new Set(reduced.mesh().groups.map(g=>g.material)),new Set(['tile','inlay']));
});

test('two Gaussian splats merge by moments and preserve their static representation',()=>{
  const field=(id,x)=>({id,position:[x,0,0],normal:[0,0,1],radius:0.045,opacity:0.43,color:[0.5,0.25,0.1]}),
    result=lod.mergeSplats([field('a',-0.05),field('b',0.05)],{target:1,maxDistance:0.21});
  assert.equal(result.status,'ok');
  assert.equal(result.splats.length,1);
  assert.deepEqual(result.splats[0].members,['a','b']);
  near(result.splats[0].position[0],0);
  near(result.splats[0].covariance[0],0.045**2+0.05**2);
  near(result.splats[0].covariance[3],0.045**2);
  const packed=lod.packSplats(result);
  assert(packed.data instanceof Float32Array);
  assert.equal(packed.data.length,16);
  near(packed.data[4],result.splats[0].covariance[0]);
});

test('Gaussian LOD locks silhouettes, owner edges, material seams and authored marks',()=>{
  const record=(id,x,extra={})=>({id,position:[x,0,0],normal:[0,0,1],radius:0.043,opacity:0.81,color:[0.46,0.5,0.55],
    owner:'a',material:'paint',...extra});
  const originals=[
    record('edge-a',0),record('edge-b',0.07,{owner:'b'}),
    record('paint-a',0.35),record('paint-b',0.42,{material:'brass'}),
    record('special',0.69,{protect:true}),record('rim',0.89,{normal:[0,1,0]}),
    record('interior-a',1.24),record('interior-b',1.32)
  ],options={ratio:0.1,maxDistance:0.12,viewDirections:[[0,0,1]]},
  result=lod.mergeSplats(originals,options),byId=new Map(result.splats.map(s=>[s.id,s]));
  assert.equal(result.work.protected,6);
  assert.equal(result.work.merged,1);
  for(const p of originals.slice(0,6)){
    assert.deepEqual(byId.get(p.id).position,p.position);
    assert.deepEqual(byId.get(p.id).members,[p.id]);
  }
  assert.equal(result.status,'constrained');
  assert.deepEqual(result,lod.mergeSplats(originals,options));
  assert.equal(lod.mergeSplats(originals,{...options,maxSeamPairs:1}).status,'budget');
  assert.equal(lod.mergeSplats(originals,{...options,maxPairs:1}).work.merged,1);
});

test('dense single-material surfaces stay inside the pair budget', () => {
  const samples = Array.from({ length: 2000 }, (_, i) => ({
    id: String(i), position: [(i % 50) * 0.001, 0, Math.floor(i / 50) * 0.001],
    normal: [0, 1, 0], color: [0.5, 0.5, 0.5], radius: 0.005
  }));
  const reduced = lod.mergeSplats(samples, { ratio: 0.25, maxPairs: 20000 });
  assert.equal(reduced.status, 'ok');
  assert.equal(reduced.splats.length, 500);
  assert.equal(new Set(reduced.splats.flatMap(splat => splat.members)).size, samples.length);
  assert.equal(reduced.work.seamPairs, 0);
});

const sample = (id, owner, x, y, z = 0) => ({
  id, owner, position: [x, y, z], normal: [0, 0, 1], radius: 0.01, color: [0.5, 0.5, 0.5]
});

test('seam checks leave the full merge pair budget available', () => {
  const samples = [
    sample('a', 'first', 0.2, 0.06), sample('b', 'first', 0.202, 0.06),
    sample('c', 'second', 0.32, 0), sample('d', 'second', 0.32, 0.12)
  ];
  const reduced = lod.mergeSplats(samples, {
    target: 3, maxDistance: 0.04, seamDistance: 0.125, maxSeamPairs: 4, maxPairs: 1
  });
  assert.equal(reduced.status, 'ok');
  assert.equal(reduced.work.seamPairs, 4);
  assert.equal(reduced.work.seamUnverified, 0);
  assert.equal(reduced.work.pairs, 1);
  assert.deepEqual(reduced.splats[0].members, ['a', 'b']);
});

test('a truncated seam scan merges checked interiors and keeps unchecked samples retryable', () => {
  const samples = [
    sample('interior-a', 'first', 0, 0), sample('interior-b', 'first', 0.02, 0),
    sample('edge-a', 'first', 1.2, 0.06), sample('clear', 'second', 1.32, 0),
    sample('edge-b', 'second', 1.32, 0.06), sample('edge-c', 'first', 1.201, 0.06)
  ];
  const options = { target: 4, maxDistance: 0.04, seamDistance: 0.125 };
  const reduced = lod.mergeSplats(samples, { ...options, maxSeamPairs: 1 });
  assert.equal(reduced.status, 'budget');
  assert.equal(reduced.work.seamPairs, 1);
  assert.equal(reduced.work.seamUnverified, 4);
  assert.equal(reduced.work.merged, 1);
  assert.deepEqual(reduced.splats[0].members, ['interior-a', 'interior-b']);
  for (const [i, row] of reduced.splats.slice(1).entries()) {
    const original = samples[i + 2];
    assert.deepEqual(row.members, [original.id]);
    assert.deepEqual(row.position, original.position);
    assert.equal(row.protect, false);
  }

  const retry = lod.mergeSplats(reduced.splats, options);
  assert.equal(retry.status, 'constrained');
  assert.equal(retry.work.seamUnverified, 0);
  assert.deepEqual(retry.splats.filter(row => row.protect).map(row => row.id), ['edge-a', 'edge-b', 'edge-c']);
  assert.throws(() => lod.mergeSplats(samples, { ...options, maxSeamPairs: 0 }), /bounded samples/);
});

test('seam bounds skip dense neighbouring groups that cannot touch', () => {
  const samples = Array.from({ length: 4800 }, (_, i) => sample(
    String(i), i < 2400 ? 'first' : 'second', i < 2400 ? 0.035 : 0.21,
    (i % 60) * 0.0001, (Math.floor(i / 60) % 40) * 0.0001
  ));
  const reduced = lod.mergeSplats(samples);
  assert.equal(reduced.status, 'ok');
  assert.equal(reduced.splats.length, 2400);
  assert.equal(reduced.work.seamPairs, 0);
  assert.equal(reduced.work.seamUnverified, 0);
  assert(reduced.splats.every(row => row.members.every(id => samples[Number(id)].owner === row.owner)));
});

test('screen coverage can reject a reduction while keeping the full authored splats', () => {
  const samples = [0, 0.04].map(x => ({
    position: [x, 0, 0], normal: [0, 0, 1], color: [0.3, 0.5, 0.7], radius: 0.065,
    target: { entity: 'coat', tags: ['worn'] }
  }));
  const checkRows = rows => {
    assert(data.isImmutable(rows));
    for (const row of rows) {
      assert(Object.isFrozen(row));
      for (const value of [row.position, row.normal, row.covariance, row.color, row.members, row.target, row.target.tags])
        assert(Object.isFrozen(value));
      assert.equal(data.isImmutable(row), false);
      assert.equal(data.isImmutable(row.position), false);
    }
  };
  const reference = Float32Array.of(0, 0.9, 0.9, 0.1);
  const preview = Float32Array.of(0, 0.9, 0.49, 0.8);
  const comparison = lod.compareCoverage(reference, preview);
  assert.equal(comparison.missingFraction, 0.5);
  assert.equal(comparison.extraFraction, 0.5);
  const rejected = lod.mergeSplats(samples, { target: 1, guard: rows => {
    assert.equal(rows.length, 1);
    checkRows(rows);
    return comparison.accepted;
  } });
  assert(data.isImmutable(rejected));
  assert(data.isImmutable(rejected.work));
  checkRows(rejected.splats);
  assert.equal(rejected.status, 'coverage');
  assert.equal(rejected.splats.length, 2);
  assert.equal(rejected.work.merged, 0);
  assert.equal(rejected.work.attemptedMerges, 1);
  assert.deepEqual(rejected.splats, lod.mergeSplats(samples, { target: 2 }).splats);
  assert.equal(Object.isFrozen(samples[0].target.tags), false);

  let candidates;
  const accepted = lod.mergeSplats(samples, { target: 1, guard: rows => {
    candidates = rows;
    checkRows(rows);
    return true;
  } });
  assert.equal(accepted.splats, candidates);
  assert(data.isImmutable(accepted));
  assert(data.isImmutable(accepted.work));
  assert.deepEqual(accepted, lod.mergeSplats(samples, { target: 1 }));
  assert.equal(lod.mergeSplats(accepted.splats, { target: 1 }).status, 'ok');

  const wrapper = data.freeze({ entries: [accepted] });
  assert(data.isImmutable(wrapper.entries));
  checkRows(wrapper.entries[0].splats);
});
