const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const { fourD: D } = K.procedural.geometry;
const near = (a,b,e=1e-8) => assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);
const point = (a,b) => a.forEach((x,i) => near(x,b[i]));
const distance = (a,b) => Math.hypot(...a.map((x,i) => x-b[i]));

test('planar rotations compose in authored order and invert in four-space', () => {
  const turn = D.rotation([['xw',Math.PI/2],['zw',Math.PI/2]]);
  point(turn.apply([1,0,0,0]),[0,0,-1,0]);
  const p = [1,-2,.3,4], q = turn.apply(p);
  point(turn.inverse(q),p);
  near(Math.hypot(...q),Math.hypot(...p));
  assert.throws(()=>D.rotation([['wx',.4]]),/coordinate plane/);
  const plane = D.frame({normal:[2,-3,1,4],offset:.7});
  const xyz = [-.5,2,1], xyzw = plane.to4(xyz,.28);
  point(plane.to3(xyzw),xyz);
  near(plane.depth(xyzw),.28);
  assert.throws(()=>D.frame({normal:[0,0,0,0]}),/nonzero normal/);
});

function manifold(section) {
  const edgeUses = new Map(), key = (a,b) => [a,b].sort((x,y)=>x-y).join('/');
  for (const {vertices,normal} of section.faces) {
    const [a,b,c] = vertices.map(i=>section.points[i]);
    assert.ok(K.V.dot(K.V.cross(K.V.sub(b,a),K.V.sub(c,a)),normal)>0);
    vertices.forEach((v,i)=>{
      const id=key(v,vertices[(i+1)%vertices.length]);
      edgeUses.set(id,(edgeUses.get(id)??0)+1);
    });
  }
  assert.equal(section.edges.length,edgeUses.size);
  for (const [a,b] of section.edges) assert.equal(edgeUses.get(key(a,b)),2);
  assert.equal(section.points.length-section.edges.length+section.faces.length,2);
}

test('regular polytopes have their expected manifold sections and endpoint geometry', () => {
  const cube=D.tesseract({radius:2}), cell=D.cell24({radius:Math.SQRT2});
  assert.deepEqual([cube.vertices.length,cube.edges.length,cube.cells.length],[16,32,8]);
  assert.deepEqual([cell.vertices.length,cell.edges.length,cell.cells.length],[24,96,24]);
  near(cube.field(0,0,0,0),-1);
  near(cell.field(1,1,0,0),0);
  assert.ok(cell.field(1,1,1,0)>0);
  for (const w of [0,.25,1,-1]) {
    const section=D.slice(cube,{frame:D.frame({offset:w})});
    assert.deepEqual([section.dimension,section.points.length,section.edges.length,section.faces.length],[3,8,12,6]);
    manifold(section);
    assert.equal(section.mesh().positions.length,108);
  }
  const mid=D.slice(cell);
  assert.deepEqual([mid.dimension,mid.points.length,mid.edges.length,mid.faces.length],[3,12,24,14]);
  assert.equal(mid.faces.filter(f=>f.vertices.length===4).length,6);
  manifold(mid);
  const cap=D.slice(cell,{frame:D.frame({offset:1})});
  assert.deepEqual([cap.dimension,cap.points.length,cap.edges.length,cap.faces.length],[3,6,12,8]);
  manifold(cap);
});

test('tangent planes produce a face, edge, point or empty result without repeated vertices', () => {
  const cube=D.tesseract({radius:2});
  for (const [normal,offset,expected] of [
    [[1,1,0,0],Math.SQRT2,[2,4,4,1]],
    [[1,1,1,0],Math.sqrt(3),[1,2,1,0]],
    [[1,1,1,1],2,[0,1,0,0]],
    [[1,1,1,1],2.001,[-1,0,0,0]]
  ]) {
    const s=D.slice(cube,{frame:D.frame({normal,offset})});
    assert.deepEqual([s.dimension,s.points.length,s.edges.length,s.faces.length],expected);
    assert.equal(new Set(s.vertexIds).size,s.points.length);
  }
});

test('rotated oblique slices retain stable IDs and agree with the signed field', () => {
  const source=D.cell24();
  const rotate=D.rotation([['xw',.8],['yw',-.37],['xz',.56]]);
  const frame=D.frame({normal:[.3,.1,.2,1],offset:.24});
  const section=D.slice(source,{rotation:rotate,frame});
  const field=D.sliceField(source.field,{rotation:rotate,frame});
  assert.equal(section.dimension,3);
  manifold(section);
  for (const p of section.points) near(field(...p),0,1e-7);
  assert.deepEqual(D.slice(source,{rotation:rotate,frame}).vertexIds,section.vertexIds);
  assert.equal(section.edges.every(([a,b])=>distance(section.points[a],section.points[b])>1e-8),true);
});

test('perspective clips intersecting edges before division and retains edge IDs', () => {
  const cube=D.tesseract({radius:2});
  const flat=D.project(cube), view=D.project(cube,{perspective:.5,near:.1});
  assert.equal(flat.edges.length,32);
  assert.equal(view.edges.length,20);
  assert.equal(view.vertexIds.filter(id=>id.endsWith(':clip')).length,8);
  for (const [i,id] of view.vertexIds.entries()) if (id.endsWith(':clip')) {
    near(view.depths[i],.4);
    assert.ok(flat.edgeIds.includes(id.replace(':clip','')));
    assert.ok(view.points[i].every(Number.isFinite));
  }
  assert.throws(()=>D.project(cube,{perspective:.05,near:.1}),/near clip/);
});

test('authored convex geometry and scalar reducers share the frame conversion', () => {
  const vertices=Array.from({length:5},(_,i)=>Array.from({length:4},(_,j)=>+(i===j+1)));
  const cells=vertices.map((_p,i)=>vertices.flatMap((_q,j)=>i===j?[]:[j]));
  const edges=vertices.flatMap((_p,i)=>vertices.flatMap((_q,j)=>i<j?[[i,j]]:[]));
  const simplex=D.polytope({vertices,edges,cells});
  const section=D.slice(simplex,{frame:D.frame({offset:.25})});
  assert.equal(section.points.length,4);
  assert.equal(section.faces.length,4);
  manifold(section);
  const sphere=(x,y,z,w)=>x*x+y*y+z*z+w*w-1;
  near(D.sliceField(sphere,{frame:D.frame({offset:.5})})(.5,0,0),-.5);
  near(D.projectField(sphere,{samples:5})(.5,0,0),-.75);
  near(D.projectField(sphere,{samples:5,reduce:'max'})(.5,0,0),.25);
  near(D.projectField(sphere,{samples:3,reduce:'mean'})(.5,0,0),-.75+2/3);
  const turned=D.sliceField((x,_y,_z,w)=>x-2*w,{rotation:D.rotation([['xw',Math.PI/2]])});
  near(turned(1,0,0),2);
  assert.throws(()=>D.projectField(sphere,{samples:1}),/sample count/);
});
