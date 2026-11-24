const { slab } = require('../src/scene-optics.js');
const { surfacePoint } = require('./scene-optics.js');
const TargetSelectors = require('../src/target-selectors.js');
const SdfPose = require('./sdf-pose.js');
const OpticalMaterials = require('../src/optical-materials.js');

const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const opaqueFlags = 15 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 32768;

function normalAt(field, [x,y,z], step) {
  const n = [field(x+step,y,z)-field(x-step,y,z),field(x,y+step,z)-field(x,y-step,z),field(x,y,z+step)-field(x,y,z-step)];
  const length = Math.hypot(...n);
  return length > 1e-10 && Number.isFinite(length) ? n.map(v=>v/length) : null;
}

function bind(world, data, settings) {
  const labels = TargetSelectors.index(world), rows = [];
  const normals = world.renderMetadata?.normals;
  const boned = new Set(world.anim?.boned ?? []), owned = world.anim?.geometryOwned;
  const { nearest } = require('../index.js').load().KIT.procedural.attributes;
  const sources = [];
  function opaque(i, rest, posed) {
    const q=i*16, flags=Math.round(rest[q+11]);
    return rest[q+3]>=1 && !(flags & (posed && (flags&15)===12 ? opaqueFlags&~15 : opaqueFlags)) &&
      !world.opticalSplats?.[i*OpticalMaterials.STRIDE+3];
  }
  function addSource(source, geometry, ownerSet, motion, key, sourceIndex) {
    const parts = new Map();
    let selected = false, partIndex=0;
    for (const [owner,ranges] of source.rows) {
      if (ownerSet && !ownerSet.has(owner)) continue;
      const part = { records:[], points:[], key:JSON.stringify(['sdf',sourceIndex,key,partIndex++]) };
      for (const [start,end,points] of ranges) for (let i=start;i<Math.min(end,world.count);i++) {
        const q = i*16, offset = (i-start)*3;
        if (owned?.[i] || !opaque(i,data,false) || world.anim?.rig?.bid?.[i]) continue;
        if (!motion && (boned.has(i) || data[q]!==points[offset] || data[q+1]!==points[offset+1] ||
            data[q+2]!==points[offset+2])) continue;
        if (motion && (!boned.has(i) || motion.point(points[offset],points[offset+1],points[offset+2])
            .some((value,axis)=>Math.abs(data[q+axis]-value)>1e-4))) continue;
        const target = {object:owner.renderOwner,entity:owner.renderOwner,material:owner.mat.materialId,
          surface:owner.mat.surfaceId ?? owner.mat.surface?.id,
          ...(owner.tag && {tags:[owner.tag]}),...owner.renderTarget,...labels.row(i)};
        const reach = 3*Math.sqrt(Math.max(0,data[q+4]+data[q+8]+data[q+10]));
        const row = {i,part,target,reach,point:Array.from(data.subarray(q,q+3)),
          normal:normals && (motion ? motion.normal(...normals.subarray(i*3,i*3+3)) : normals.subarray(i*3,i*3+3))};
        part.records.push(row);
        part.points.push(row.point);
        if (settings.candidates(target)) {
          rows[i]=row;
          selected=true;
        }
      }
      if (part.records.length) parts.set(owner,part);
    }
    if (selected) sources.push({...geometry,parts,motion});
  }
  for (const [sourceIndex,source] of (world.renderSdfs ?? []).entries()) {
    if (!(source.rows instanceof Map) || typeof source.distance !== 'function' || typeof source.locate !== 'function') continue;
    if (settings.posed && world.anim?.bones && source.bind) {
      for (const [key,group] of SdfPose.groups(world,source,(i,rest)=>opaque(i,rest,true),
        (body,cut)=>[source.bind(body,cut)].filter(Boolean))) {
        const motion=SdfPose.transform(key,world.anim.bones);
        if (motion!==false) for (const geometry of group.fields)
          addSource(source,SdfPose.field(geometry,motion),group.owners,motion,key,sourceIndex);
      }
    } else addSource(source,source,null,null,'',sourceIndex);
  }
  for (const source of sources) for (const part of source.parts.values())
    part.nearest = nearest({points:part.points,entities:part.records,read:i=>part.records[i]});
  return {sources,rows};
}

const facing = (row,normal) => !row.normal || dot(row.normal,row.normal)<1e-8 || dot(row.normal,normal)>.25;
function trace(source, ray, near, far, settings, clip, visible, x, y, sourceBinding) {
  const {origin,direction,axial} = ray, {min,max} = source.bounds, {epsilon,steps} = settings;
  const range = [near/axial,far/axial];
  for (let k=0;k<3;k++) if (!slab(range,origin[k],direction[k],min[k],max[k])) return null;
  const point = origin.slice(), field = source.distance;
  let along=range[0];
  for (let j=0;j<steps && along<=range[1];j++) {
    for (let k=0;k<3;k++) point[k]=origin[k]+along*direction[k];
    const distance = field(...point);
    if (!Number.isFinite(distance)) return null;
    if (Math.abs(distance)>epsilon) {
      along+=Math.min(source.maxStep ?? Infinity,Math.abs(distance)*.7);
      continue;
    }
    let normal;
    if ((!clip || clip(point)) && (!source.accepts || source.accepts(...point))) {
      let row, fieldOwner;
      if (source.surfaceAt) {
        normal=normalAt(field,point,epsilon);
        if (normal) row=source.surfaceAt(point,normal);
      } else {
        const {body,owner} = source.locate(...point);
        fieldOwner = body ?? owner;
        const part = source.parts.get(owner) ?? source.parts.get(body);
        if (part && (normal=normalAt(field,point,epsilon)))
          row=part.nearest.sample(point,i=>facing(part.records[i],normal))?.values;
      }
      if (row && (row.i<0 || !visible || visible(row.i,x,y)) && settings.allows(row.target,point)) {
        const rest = source.motion?.rest(...point) ?? point;
        return {z:along*axial,position:point,normal,row,objectPosition:rest,
          ...(sourceBinding && { source:sdfSource(fieldOwner,row,rest) })};
      }
    }
    along+=6*epsilon/Math.max(.12,normal ? Math.abs(dot(normal,direction)) : 1);
  }
  return null;
}

function sdfSource(owner,row,rest) {
  const target = owner ? {object:owner.renderOwner,entity:owner.renderOwner,...owner.renderTarget} : row.target;
  return { key:owner ?? row.part,identity:{ kind:'sdf',object:target.object,entity:target.entity,part:target.part },
    coordinate:owner?.sourceLocal?.(rest) ?? rest };
}

function editableSource(field) {
  const part={key:JSON.stringify(['brick-sdf',field.objectId])}, byMaterial=new Map();
  return {...field,surfaceAt(point,normal) {
    const material=field.material(point,normal);
    if (!byMaterial.has(material.id)) {
      const target={object:field.objectId,entity:field.objectId,material:material.id};
      byMaterial.set(material.id,{i:-1,part,target,color:[material.color>>16,material.color>>8&255,material.color&255].map(n=>n/255)});
    }
    return byMaterial.get(material.id);
  }};
}

function rasterize(world, data, settings, {w,h,rayAt,near,clip,visible,sourceBinding,editable=[]}) {
  const {sources,rows} = bind(world,data,settings);
  for (const field of editable) {
    if (field.materials.some(material=>settings.candidates({object:field.objectId,entity:field.objectId,material})))
      sources.push(editableSource(field.trace));
  }
  if (!sources.length) return null;
  const hits = new Array(w*h), samples=[];
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const ray=rayAt(x+.5,y+.5);
    let closest;
    for (const source of sources) {
      const hit=trace(source,ray,near,closest?.z ?? 400,settings,clip,visible,x,y,sourceBinding);
      if (hit && (!closest || closest.z>hit.z)) closest=hit;
    }
    if (!closest) continue;
    const sample={...closest,p,alpha:1,sdf:true,
      ...(closest.row.i<0 && {surface:true,color:closest.row.color,objectId:closest.row.target.object,
        materialId:closest.row.target.material})};
    samples.push(sample);
    hits[p]=sample;
  }
  function fragment(row, pixel, ray, axial) {
    const hit = hits[pixel];
    if (hit?.row.part === row.part && facing(row,hit.normal) && settings.allows(row.target,hit.position)) {
      const distance=Math.hypot(hit.position[0]-row.point[0],hit.position[1]-row.point[1],hit.position[2]-row.point[2]);
      if (distance <= row.reach) return hit;
    }
    const point = row.normal && surfacePoint(ray,row.normal,...row.point,axial,row.reach) || row.point;
    return settings.allows(row.target,point) ? false : null;
  }
  return {rows,hits,samples,fragment};
}

module.exports = { rasterize };
