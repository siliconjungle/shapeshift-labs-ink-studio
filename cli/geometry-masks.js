'use strict';

const fs = require('node:fs');
const Ray = require('./mesh-ray-index.js');
const Thickness = require('./thickness.js');

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

function root(parents,i) {
  while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
  return i;
}

// Welding UV splits preserves uninterrupted surfaces inside the same authored part.
function shells(points,faces,V,parts,validateFans) {
  const positions=new Map(), aliases=faces.map((face,i)=>face.map(vertex=>{
    const key=(parts?.[i]??'')+'\0'+points[vertex].join('/');
    if(!positions.has(key))positions.set(key,positions.size);
    return positions.get(key);
  }));
  const parents=Int32Array.from(faces,(_,i)=>i), edges=new Map();
  const corners=validateFans&&Int32Array.from({length:faces.length*3},(_,i)=>i);
  for(const [i,face] of aliases.entries())for(let k=0;k<3;k++) {
    const next=(k+1)%3, a=face[k], b=face[next], forward=a<b;
    const key=forward?a+'/'+b:b+'/'+a, edge=edges.get(key), sign=forward?1:-1;
    const low=i*3+(forward?k:next), high=i*3+(forward?next:k);
    if(!edge)edges.set(key,{face:i,count:1,winding:sign,low,high});
    else {
      parents[root(parents,i)]=root(parents,edge.face);
      if(corners&&edge.count===1) {
        corners[root(corners,low)]=root(corners,edge.low);
        corners[root(corners,high)]=root(corners,edge.high);
      }
      edge.count++;
      edge.winding+=sign;
    }
  }
  const groups=new Map(), owners=Int32Array.from(faces,(_,i)=>root(parents,i));
  for(const [i,[a,b,c]] of faces.entries()) {
    const id=owners[i], p=points[a], q=points[b], r=points[c];
    if(!groups.has(id))groups.set(id,{origin:p,volume:0,span:0});
    const group=groups.get(id), offset=point=>V.sub(point,group.origin);
    const x=offset(p), y=offset(q), z=offset(r);
    group.span=Math.max(group.span,V.len(x),V.len(y),V.len(z));
    group.volume+=V.dot(x,V.cross(y,z));
  }
  const severity={open:1,winding:2,nonManifold:3};
  for(const edge of edges.values()) {
    const reason=edge.count>2?'nonManifold':edge.count===1?'open':edge.winding?'winding':undefined;
    const group=groups.get(owners[edge.face]);
    if(reason&&severity[reason]>(severity[group.invalid]??0))group.invalid=reason;
  }
  if(corners) {
    const fans=new Map();
    for(const [face,row] of aliases.entries()) {
      const id=owners[face], group=groups.get(id);
      if(group.invalid)continue;
      for(let i=0;i<3;i++) {
        const key=id+'/'+row[i], vertex=root(corners,face*3+i);
        if(!fans.has(key))fans.set(key,vertex);
        else if(fans.get(key)!==vertex)group.invalid='nonManifold';
      }
    }
  }
  for(const group of groups.values()) {
    if(!group.invalid&&!(Math.abs(group.volume)>group.span**3*1e-12))group.invalid='degenerate';
    group.closed=!group.invalid;
  }
  return {groups,owners};
}

function prepare(points, faces, normals, options, { V,procedural:{spatial} }, selected=names, measures={}) {
  const box = spatial.boxOf(points), diagonal = V.dist(box.min,box.max);
  const up = options.up.map(n => n/Math.hypot(...options.up));
  const { samples,cavityRadius = diagonal*.14,exposureDistance = diagonal,thicknessScale = diagonal,
    rayBias = Math.max(diagonal*1e-7,Math.max(...box.min.map(Math.abs),...box.max.map(Math.abs))*Number.EPSILON*64) } = options;
  if (!(diagonal > rayBias && rayBias > 0))
    throw new RangeError('Geometry mask ray bias must be smaller than the mesh bounds');
  const rays=selected.includes('cavity')||selected.includes('exposure');
  const interiors=selected.includes('thickness')||selected.includes('thickness-valid');
  const { owners,groups } = shells(points,faces,V,measures.parts,interiors);
  const rows = faces.map(([i,j,k],face) => {
    const [a,b,c] = [points[i],points[j],points[k]], shell = owners[face], group = groups.get(shell);
    const ab = V.sub(b,a), ac = V.sub(c,a);
    const normal = group.closed && group.volume < 0 ? V.mul(normals[face],-1) : normals[face];
    return { face,a,ab,ac,normal,shell,part:measures.parts?.[face],invalid:group.invalid,epsilon:1e-12*V.len(ab)*V.len(ac),
      bounds:spatial.expand(spatial.boxOf([a,b,c]),rayBias*.1) };
  });
  const nearest = Ray.build(rows,{V,procedural:{spatial}}), range = Math.max(cavityRadius,exposureDistance);
  let rayCount = 0, triangleTests = 0, texels = 0;
  function trace(origin, direction, distance, face, tolerance=0) {
    if (++rayCount > 26e6) throw new RangeError('Geometry masks exceed the ray budget. Use fewer samples or a smaller texture.');
    return nearest(origin,direction,distance,tolerance>0?Math.min(tolerance*.125,rayBias*.01):rayBias*.1,row=>row.face!==face,()=>{
      if (++triangleTests > 120e6)
        throw new RangeError('Geometry masks exceed the triangle budget. Use fewer samples or simplify the geometry.');
    },tolerance);
  }
  const precision=Math.max(...box.min.map(Math.abs),...box.max.map(Math.abs))*Number.EPSILON*32;
  const thicknessPass=interiors&&Thickness.prepare(rows,trace,{diagonal,rayBias,precision},measures.thickness,measures.raw,V);

  function forFace(face, layers) {
    const { normal } = rows[face], tangent = V.perp(normal), bitangent = V.cross(normal,tangent);
    const slope = byte(Math.acos(Math.min(1,Math.abs(V.dot(normal,up))))*2/Math.PI);
    const directions = Array.from({length:rays?samples:0},(_sample,i) => {
      const t = (i+.5)/samples, a = i*Math.PI*(3-Math.sqrt(5)), radius = Math.sqrt(t);
      return V.mad(V.mad(V.mul(normal,Math.sqrt(1-t)),tangent,radius*Math.cos(a)),bitangent,radius*Math.sin(a));
    });
    const [slopes,cavities,exposures,thickness,validity] = layers;
    return (point,i,shading) => {
      const outside = V.mad(point,normal,rayBias);
      let nearOcclusion = 0, visible = 0;
      for (const direction of directions) {
        const distance = trace(outside,direction,range,face)?.distance??Infinity;
        nearOcclusion += Math.max(0,1-distance/cavityRadius);
        if (distance > exposureDistance) visible++;
      }
      slopes[i] = slope;
      cavities[i] = byte(nearOcclusion/samples);
      exposures[i] = byte(visible/samples);
      thickness[i] = validity[i] = 0;
      texels++;
      thicknessPass?.measure(face,point,shading,i,thicknessScale,distance=>{
        thickness[i]=byte(distance/thicknessScale);
        validity[i]=255;
      });
    };
  }
  function report() {
    const closedShells = [...groups.values()].filter(group => group.closed).length;
    return { version:1,up,samples,cavityRadius,exposureDistance,thicknessScale,rayBias,texels,rayCount,triangleTests,
      shells:{ closed:closedShells,open:groups.size-closedShells },
      thickness:thicknessPass?thicknessPass.report():{valid:0,unknown:texels,clipped:0,min:null,max:null} };
  }
  return { forFace,report };
}

module.exports = { names,settings,prepare };
