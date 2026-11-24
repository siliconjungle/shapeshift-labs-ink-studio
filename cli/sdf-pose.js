/* Partition retained composites into fields which share one affine skin transform. */
const cache = new WeakMap();

function keyFor(world, rest, row, owner) {
  const rig = world.anim?.rig, part = rig?.bid?.[row];
  if (world.anim?.geometryOwned?.[row] || world.anim?.physicsOwned?.[row]) return null;
  if (part) return owner.whole && rig.names[part]===owner.tag && !rig.free?.[row] ? 'rig:'+part : null;
  if (owner.whole) return null;
  const q = row * 16, kind = Math.round(rest[q+11]) & 15;
  if (kind !== 12) return kind === 13 ? null : '';
  return rest[q+14] ? [rest[q+12],rest[q+13],rest[q+14]].join(',') : String(rest[q+12]);
}

function groups(world, source, acceptsRow, makeFields) {
  const rest = world.rest ?? world.data, result = new Map(), bodies = new Map(), tags = new Map();
  for (const [owner,ranges] of source.rows) {
    let key;
    if (owner.born !== undefined || owner.mat.motionAt) continue;
    for (const [start,end,saved] of ranges) for (let i=start;i<end;i++) {
      const q=i*16, k=(i-start)*3;
      const reference = owner.whole ? world.anim?.base ?? rest : rest;
      const next = i<world.count && acceptsRow(i,reference) &&
        [0,1,2].every(c=>reference[q+c]===saved[k+c]) ? keyFor(world,reference,i,owner) : null;
      key = key===undefined || key===next ? next : null;
    }
    if (owner.tag && key!==undefined) {
      if (!tags.has(owner.tag)) tags.set(owner.tag,key);
      else if (tags.get(owner.tag)!==key) tags.set(owner.tag,null);
    }
    if (key!==undefined) bodies.set(owner,key);
  }
  const cuts = new Set(source.negative);
  for (const owner of cuts) if (!bodies.has(owner)) {
    // Hidden subtractors can inherit a skin transform from their authored tag.
    bodies.set(owner,owner.tag && tags.has(owner.tag) ? tags.get(owner.tag) : '');
  }
  for (const [owner,key] of bodies) {
    if (key===null) continue;
    if (!result.has(key)) result.set(key,new Set());
    result.get(key).add(owner);
  }
  let previous=cache.get(source);
  if (!previous) cache.set(source,previous=new Map());
  // Capture has separate source objects for display and transport.
  for (const [key,owners] of result) {
    const saved=previous.get(key);
    if (saved?.owners.size===owners.size && [...owners].every(owner=>saved.owners.has(owner))) {
      result.set(key,saved);
      continue;
    }
    const fields=makeFields(owner=>owners.has(owner),owner=>cuts.has(owner)&&owners.has(owner));
    const group={owners,fields};
    result.set(key,group);
    previous.set(key,group);
  }
  return result;
}

const mul = (m,x,y,z) => [
  m[0]*x+m[1]*y+m[2]*z,
  m[3]*x+m[4]*y+m[5]*z,
  m[6]*x+m[7]*y+m[8]*z
];

function rigPart(key) {
  return key.startsWith('rig:') ? Number(key.slice(4)) : 0;
}

function transform(key, bones, rig) {
  if (key==='') return null;
  const part = rigPart(key);
  if (part) return rig?.M?.length>=(part+1)*12 ? affine(rig.M.subarray(part*12,(part+1)*12)) : false;
  const [first,second,weight]=key.split(',').map(Number);
  if (!bones || (first+1)*12>bones.length || weight && (second+1)*12>bones.length) return false;
  const m=Array.from(bones.subarray(first*12,first*12+12),
    (n,i)=>weight ? n+weight*(bones[second*12+i]-n) : n);
  return affine(m);
}

function affine(m) {
  const [a,b,c,d,e,f,g,h,i,tx,ty,tz]=m;
  const adj=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*adj[0]+b*adj[3]+c*adj[6];
  if (!Number.isFinite(det) || Math.abs(det)<1e-8) return false;
  const inverse=adj.map(n=>n/det);
  const transpose=[inverse[0],inverse[3],inverse[6],inverse[1],inverse[4],inverse[7],inverse[2],inverse[5],inverse[8]];
  // The maximum absolute row sum of the Gram matrix bounds the squared spectral norm.
  const normBound = matrix=>Math.sqrt(Math.max(...[0,3,6].map(j=>[0,3,6].reduce((sum,k)=>
    sum+Math.abs(matrix[j]*matrix[k]+matrix[j+1]*matrix[k+1]+matrix[j+2]*matrix[k+2]),0))));
  return {
    distanceScale:1/normBound(inverse),
    stretch:normBound(m),
    point(x,y,z) {
      const p=mul(m,x,y,z);
      return [p[0]+tx,p[1]+ty,p[2]+tz];
    },
    rest(x,y,z) { return mul(inverse,x-tx,y-ty,z-tz); },
    restNormal(x,y,z) { return mul([a,d,g,b,e,h,c,f,i],x,y,z); },
    normal(x,y,z) {
      const n=mul(transpose,x,y,z), length=Math.hypot(...n);
      return length ? n.map(v=>v/length) : n;
    }
  };
}

function field(source, motion) {
  if (!motion) return source;
  const {min,max}=source.bounds, lower=[Infinity,Infinity,Infinity], upper=[-Infinity,-Infinity,-Infinity];
  for (const x of [min[0],max[0]]) for (const y of [min[1],max[1]]) for (const z of [min[2],max[2]]) {
    const p=motion.point(x,y,z);
    for (let k=0;k<3;k++) {
      lower[k]=Math.min(lower[k],p[k]);
      upper[k]=Math.max(upper[k],p[k]);
    }
  }
  return {
    ...source,bounds:{min:lower,max:upper},
    distance(x,y,z) { return source.distance(...motion.rest(x,y,z))*motion.distanceScale; },
    accepts:source.accepts && ((x,y,z)=>source.accepts(...motion.rest(x,y,z))),
    locate:source.locate && ((x,y,z)=>source.locate(...motion.rest(x,y,z))),
    surface:source.surface && ((point,normal)=>{
      const n=motion.restNormal(...normal), length=Math.hypot(...n);
      return source.surface(motion.rest(...point),length ? n.map(v=>v/length) : n);
    })
  };
}

module.exports={groups,transform,field,affine,rigPart};
