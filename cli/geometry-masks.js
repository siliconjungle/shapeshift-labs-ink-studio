'use strict';

const fs = require('node:fs');
const Ray = require('./mesh-ray-index.js');

const names = Object.freeze(['slope','cavity','exposure','thickness','thickness-valid']);
const distances = ['cavityRadius','exposureDistance','thicknessScale','rayBias'];
const byte = value => Math.round(Math.max(0,Math.min(1,value))*255);

function settings(input) {
  if (input === undefined || input === false) return null;
  const value = input === true ? {} : typeof input === 'string' ? JSON.parse(fs.readFileSync(input,'utf8')) : input;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !['up','samples',...distances].includes(key)))
    throw new TypeError('Geometry mask settings need an up axis, sample count or positive scene distances');
  const { up = [0,1,0], samples = 16 } = value;
  const length = Array.isArray(up) && up.length === 3 && Array.from(up).every(Number.isFinite) && Math.hypot(...up);
  if (!(length > 0 && Number.isFinite(length)) || !Number.isInteger(samples) || samples < 4 || samples > 64 ||
      distances.some(key => value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] <= 0)))
    throw new RangeError('Geometry mask settings need a nonzero up axis, 4–64 samples and positive finite distances');
  return { up:up.slice(),samples,...Object.fromEntries(distances.filter(key => value[key] !== undefined)
    .map(key => [key,value[key]])) };
}

// UV splits often repeat positions. Weld exact positions when checking whether a shell has an interior.
function shells(points, faces, V) {
  const positions = new Map(), aliases = points.map((point,i) => {
    const key = point.join('/');
    if (!positions.has(key)) positions.set(key,i);
    return positions.get(key);
  });
  const parents = Int32Array.from(faces,(_face,i) => i), edges = new Map();
  function root(i) {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  }
  for (const [i,face] of faces.entries()) for (let k=0; k<3; k++) {
    const a = aliases[face[k]], b = aliases[face[(k+1)%3]], forward = a < b;
    const key = forward ? a+'/'+b : b+'/'+a, row = edges.get(key);
    const sign = forward ? 1 : -1;
    if (!row) edges.set(key,{ face:i,count:1,winding:sign });
    else {
      parents[root(i)] = root(row.face);
      row.count++;
      row.winding += sign;
    }
  }
  const groups = new Map(), owners = Int32Array.from(faces,(_face,i) => root(i));
  for (const [i,[a,b,c]] of faces.entries()) {
    const id = owners[i], p = points[a], q = points[b], r = points[c];
    if (!groups.has(id)) groups.set(id,{ origin:p,volume:0,span:0,closed:true });
    const group = groups.get(id), offset = point => V.sub(point,group.origin);
    const x = offset(p), y = offset(q), z = offset(r);
    group.span = Math.max(group.span,V.len(x),V.len(y),V.len(z));
    group.volume += V.dot(x,V.cross(y,z));
  }
  for (const edge of edges.values())
    if (edge.count !== 2 || edge.winding) groups.get(owners[edge.face]).closed = false;
  for (const group of groups.values())
    group.closed &&= Math.abs(group.volume) > group.span ** 3 * 1e-12;
  return { groups,owners };
}

function prepare(points, faces, normals, options, { V,procedural:{spatial} }, selected=names) {
  const box = spatial.boxOf(points), diagonal = V.dist(box.min,box.max);
  const up = options.up.map(n => n/Math.hypot(...options.up));
  const { samples,cavityRadius = diagonal*.14,exposureDistance = diagonal,thicknessScale = diagonal,
    rayBias = Math.max(diagonal*1e-7,Math.max(...box.min.map(Math.abs),...box.max.map(Math.abs))*Number.EPSILON*64) } = options;
  if (!(diagonal > rayBias && rayBias > 0))
    throw new RangeError('Geometry mask ray bias must be smaller than the mesh bounds');
  const rays=selected.includes('cavity')||selected.includes('exposure');
  const interiors=selected.includes('thickness')||selected.includes('thickness-valid');
  const { owners,groups } = shells(points,faces,V);
  const rows = faces.map(([i,j,k],face) => {
    const [a,b,c] = [points[i],points[j],points[k]], shell = owners[face], group = groups.get(shell);
    const ab = V.sub(b,a), ac = V.sub(c,a);
    const normal = group.closed && group.volume < 0 ? V.mul(normals[face],-1) : normals[face];
    return { face,a,ab,ac,normal,shell,closed:group.closed,epsilon:1e-12*V.len(ab)*V.len(ac),
      bounds:spatial.expand(spatial.boxOf([a,b,c]),rayBias*.1) };
  });
  const nearest = Ray.build(rows,{V,procedural:{spatial}}), range = Math.max(cavityRadius,exposureDistance);
  let rayCount = 0, triangleTests = 0, texels = 0, valid = 0, clipped = 0, min = Infinity, max = 0;
  let hit;
  function trace(origin, direction, distance, face) {
    if (++rayCount > 26e6) throw new RangeError('Geometry masks exceed the ray budget. Use fewer samples or a smaller texture.');
    const result=nearest(origin,direction,distance,rayBias*.1,row=>row.face!==face,()=>{
      if (++triangleTests > 120e6)
        throw new RangeError('Geometry masks exceed the triangle budget. Use fewer samples or simplify the geometry.');
    });
    hit=result?.row;
    return result?.distance??Infinity;
  }

  function forFace(face, layers) {
    const { normal,shell,closed } = rows[face], tangent = V.perp(normal), bitangent = V.cross(normal,tangent);
    const slope = byte(Math.acos(Math.min(1,Math.abs(V.dot(normal,up))))*2/Math.PI);
    const directions = Array.from({length:rays?samples:0},(_sample,i) => {
      const t = (i+.5)/samples, a = i*Math.PI*(3-Math.sqrt(5)), radius = Math.sqrt(t);
      return V.mad(V.mad(V.mul(normal,Math.sqrt(1-t)),tangent,radius*Math.cos(a)),bitangent,radius*Math.sin(a));
    });
    const inward = V.mul(normal,-1);
    const [slopes,cavities,exposures,thickness,validity] = layers;
    return (point,i) => {
      const outside = V.mad(point,normal,rayBias);
      let nearOcclusion = 0, visible = 0;
      for (const direction of directions) {
        const distance = trace(outside,direction,range,face);
        nearOcclusion += Math.max(0,1-distance/cavityRadius);
        if (distance > exposureDistance) visible++;
      }
      slopes[i] = slope;
      cavities[i] = byte(nearOcclusion/samples);
      exposures[i] = byte(visible/samples);
      thickness[i] = validity[i] = 0;
      texels++;
      if (!interiors || !closed) return;
      const distance = trace(V.mad(point,inward,rayBias),inward,diagonal+rayBias,face)+rayBias;
      if (!hit || hit.shell !== shell || V.dot(hit.normal,inward) <= 1e-8) return;
      thickness[i] = byte(distance/thicknessScale);
      validity[i] = 255;
      valid++;
      if (distance > thicknessScale) clipped++;
      min = Math.min(min,distance);
      max = Math.max(max,distance);
    };
  }
  function report() {
    const closedShells = [...groups.values()].filter(group => group.closed).length;
    return { version:1,up,samples,cavityRadius,exposureDistance,thicknessScale,rayBias,texels,rayCount,triangleTests,
      shells:{ closed:closedShells,open:groups.size-closedShells },
      thickness:{ valid,unknown:texels-valid,clipped,min:valid ? min : null,max:valid ? max : null } };
  }
  return { forFace,report };
}

module.exports = { names,settings,prepare };
