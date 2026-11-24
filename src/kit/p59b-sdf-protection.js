// Shared rest-space feature volumes for sculpting and local remeshing.
(function(K) {
  const P=K.procedural, {V}=K, axes=[0,1,2];
  const kinds=['corner','seam','wall','opening'];
  const record=(value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
  const point=p=>Array.isArray(p) && p.length===3 && Array.from(p).every(n=>Number.isFinite(n) && Math.abs(n)<=1e8);
  const overlap=(a,b)=>axes.every(i=>a.min[i]<=b.max[i] && b.min[i]<=a.max[i]);
  const solid=kind=>kind==='wall';

  function check(value) {
    if (value===undefined) return [];
    if (!Array.isArray(value) || value.length>32) throw new TypeError('SDF protection takes up to 32 named feature volumes');
    const ids=new Set();
    for (const row of value) {
      if (!record(row,['id','kind','bounds']) || !TargetSelectors.name(row.id) || ids.has(row.id) || !kinds.includes(row.kind) ||
          !record(row.bounds,['min','max']) || !point(row.bounds.min) || !point(row.bounds.max) ||
          row.bounds.min.some((n,i)=>n>=row.bounds.max[i]))
        throw new RangeError('An SDF protection needs a unique ID, a corner, seam, wall or opening kind, and positive XYZ bounds');
      ids.add(row.id);
    }
    return value;
  }

  function blocked(guards,corners,change) {
    if (!guards.length) return;
    const hull=P.spatial.boxOf(corners);
    const hit=guards.find(({kind,bounds})=>!(kind==='wall' && change==='add' || kind==='opening' && change==='cut') &&
      overlap(hull,bounds));
    return hit && {code:'protected-sdf-feature',feature:hit.id,kind:hit.kind};
  }

  function samples(bounds) {
    const [x,y,z]=axes.map(i=>[bounds.min[i],(bounds.min[i]+bounds.max[i])*.5,bounds.max[i]]);
    return x.flatMap(a=>y.flatMap(b=>z.map(c=>[a,b,c])));
  }

  // Separate the triangle and the box on the face normal and the nine edge axes.
  function intersects(points,box) {
    if (!overlap(P.spatial.boxOf(points),box)) return false;
    const center=V.lerp(box.min,box.max,.5), half=V.mul(V.sub(box.max,box.min),.5);
    const local=points.map(p=>V.sub(p,center)), edges=local.map((p,i)=>V.sub(local[(i+1)%3],p));
    const tests=[V.cross(edges[0],edges[1])];
    for (const [x,y,z] of edges) tests.push([0,z,-y],[-z,0,x],[y,-x,0]);
    return tests.every(n=>{
      const projected=local.map(p=>V.dot(n,p)), radius=V.dot(n.map(Math.abs),half);
      return Math.min(...projected)<=radius && Math.max(...projected)>=-radius;
    });
  }

  function triangle(chunk,index) {
    return chunk.indices.slice(3*index,3*index+3).map(vertex=>chunk.positions.slice(3*vertex,3*vertex+3));
  }

  function faceKey(chunk,index,material=true,points=triangle(chunk,index)) {
    const key=points.map(p=>p.join(',')).sort().join('/');
    return material ? key+':'+chunk.faceMaterials[index] : key;
  }

  function faces(chunks,guard,cell,firstOnly=false) {
    const faces=[];
    for (const chunk of chunks) {
      if (!chunk.triangles || !overlap(P.spatial.expand(chunk.bounds,cell*2),guard.bounds)) continue;
      for (let index=0;index<chunk.triangles;index++) {
        const points=triangle(chunk,index);
        if (!intersects(points,guard.bounds)) continue;
        if (firstOnly) return true;
        faces.push(faceKey(chunk,index,guard.kind==='seam',points));
      }
    }
    return firstOnly ? false : faces.sort();
  }

  function inside(chunks,origin) {
    // Use a non-axis-aligned ray. Mesh picking supplies the nearest two-sided hit.
    const direction=V.norm([1,.491,.261]);
    let nearest, chosen, maxDistance=Infinity;
    for (const chunk of chunks) {
      if (!chunk.mesh) continue;
      const hit=K.sceneMeshes.intersect(chunk.mesh,{origin,direction,maxDistance},{V,rayBox:P.spatial.rayBox});
      if (hit && hit.distance<maxDistance) {
        maxDistance=hit.distance;
        nearest=hit;
        chosen=chunk;
      }
    }
    if (!nearest) return false;
    const [a,b,c]=triangle(chosen,nearest.triangle);
    return V.dot(V.cross(V.sub(b,a),V.sub(c,a)),direction)>0;
  }

  function failure(guard,reason) {
    const {id,kind}=guard;
    throw Object.assign(new RangeError('Protected '+kind+' '+id+': '+reason),{code:'protected-sdf-feature',feature:id,kind,reason});
  }

  function retainFaces(guard,before,after) {
    if (before.length!==after.length || after.some((face,i)=>face!==before[i]))
      failure(guard,'protected geometry or seam material changed');
  }

  function verify(guards,chunks,bricks,previous,dirty) {
    const checked=[];
    for (const guard of guards) {
      if (dirty && !dirty.some(box=>overlap(P.spatial.expand(box,bricks.cell*2),guard.bounds))) continue;
      const probes=samples(guard.bounds);
      if (guard.kind==='wall' || guard.kind==='opening') {
        const sign=solid(guard.kind) ? -1 : 1;
        if (probes.some(p=>sign*bricks.distance(...p)<=0))
          failure(guard,'signed field crossed the reserved volume');
        if (faces(chunks,guard,bricks.cell,true) || inside(chunks,probes[13])!==solid(guard.kind))
          failure(guard,'mesh lost the reserved volume at this lattice resolution');
      } else {
        const next=faces(chunks,guard,bricks.cell);
        if (!next.length) failure(guard,'no protected mesh faces at this lattice resolution');
        if (previous) {
          const old=faces(previous.chunks,guard,bricks.cell);
          retainFaces(guard,old,next);
          if (probes.some(p=>Math.sign(bricks.distance(...p))!==Math.sign(previous.bricks.distance(...p))))
            failure(guard,'protected geometry or seam material changed');
        }
      }
      checked.push(guard.id);
    }
    return checked;
  }

  P.sdfProtection=Object.freeze({check,blocked,verify,faceKey,retainFaces});
})(KIT);
