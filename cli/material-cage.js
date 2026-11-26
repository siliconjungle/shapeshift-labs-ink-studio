// Project a registered receiver's texels through a bounded rest-space cage.
const fs = require('node:fs');
const path = require('node:path');
const Source = require('./material-cage-source.js');
const { idOK } = require('./material-projection.js');

const format = 'ink-studio/material-cage-bake';
const masks = ['cage-hit','cage-miss','cage-cross-part','cage-backface','cage-distance','cage-relief'];
const channels = ['pigment','normal','roughness','metallic','emission','masks'];
const names = new Set(masks);
const finite = (n,lo,hi) => Number.isFinite(n) && n>=lo && n<=hi;
const record = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
  Object.keys(raw).every(key=>keys.includes(key));
const unit = n => Math.max(0,Math.min(1,n));

function faceParts(raw, label) {
  if (raw === undefined) return new Map();
  if (!raw || Object.getPrototypeOf(raw)!==Object.prototype ||
      Object.entries(raw).some(([id,part])=>!Source.name(id)||!Source.name(part)))
    throw new TypeError(label+' needs face IDs mapped to named parts');
  return new Map(Object.entries(raw));
}

function read(input) {
  if (input === undefined) return new Map();
  const file = typeof input==='string' && path.resolve(input);
  const plan = file ? JSON.parse(fs.readFileSync(file,'utf8')) : input;
  const directory = file ? path.dirname(file) : process.cwd();
  if (!record(plan,['format','version','receivers']) || plan.format!==format || plan.version!==1 ||
      !Array.isArray(plan.receivers) || !plan.receivers.length || plan.receivers.length>32)
    throw new TypeError('Use a version 1 material cage plan with 1–32 receivers');
  const entries = new Map();
  for (const row of plan.receivers) {
    if (!record(row,['mesh','source','front','back','part','parts','faces','protectPigment','direction','minFacing','partPolicy','steps','maxWork','channels']))
      throw new TypeError('Use cage receiver distances, part bindings, channel selection and a named source');
    const { mesh=0,source,front,back=0,part,parts,faces,protectPigment=[],direction='smooth', minFacing=.2,partPolicy='match',
      steps=40,maxWork=24000000,channels:selected=channels } = row;
    if (!Number.isSafeInteger(mesh) || mesh<0 || entries.has(mesh) || !finite(front,0,1e5) ||
        !finite(back,0,1e5) || front+back<1e-7 || !finite(minFacing,0,1) || !['match','allow'].includes(partPolicy) ||
        !['smooth','geometric'].includes(direction) || part!==undefined && !Source.name(part) ||
        !Number.isSafeInteger(steps) || !finite(steps,4,256) || !Number.isSafeInteger(maxWork) || !finite(maxWork,1,200000000) ||
        !Array.isArray(selected) || !selected.length || new Set(selected).size!==selected.length || !selected.every(key=>channels.includes(key)) ||
        !Array.isArray(protectPigment) || protectPigment.length>24000 ||
        !protectPigment.every(id=>Source.name(id) || Number.isSafeInteger(id) && id>=0) ||
        new Set(protectPigment.map(String)).size!==protectPigment.length ||
        faces!==undefined && (!Array.isArray(faces) || !faces.length ||
          !faces.every(id=>Source.name(id) || Number.isSafeInteger(id) && id>=0) || new Set(faces.map(String)).size!==faces.length))
      throw new RangeError('Use distinct cage receiver meshes, bounded front/back distances and valid projection controls');
    if (!record(source,['kind','file','model','materials','part','faceParts','volume','field','material']) ||
        !['mesh','sdf','scan-proxy'].includes(source.kind) || source.file!==undefined && !Source.name(source.file) ||
        source.part!==undefined && !Source.name(source.part) ||
        (source.kind==='sdf' ? ['model','materials','faceParts'] : ['volume','field','material']).some(key=>source[key]!==undefined))
      throw new TypeError('Choose a detailed mesh, signed field or registered scan proxy for the cage');
    entries.set(mesh,{mesh,source,front,back,part,parts:faceParts(parts,'Cage receiver'),faces:faces && new Set(faces.map(String)),direction,
      protectPigment:new Set(protectPigment.map(String)),minFacing,partPolicy,steps,maxWork,channels:selected.slice(),directory});
  }
  return entries;
}

function meshCaster(entry, studio, kit, work) {
  const {source,directory,tolerance,front,back,maskNames} = entry, { V,procedural:{spatial} } = kit;
  const model = Source.meshSource(source,directory,studio,kit), parts = faceParts(source.faceParts,'Cage source');
  if (model.faces.length>250000 || !model.faces.length || model.points.some(p=>!Source.list(p,3)))
    throw new RangeError('Cage source needs finite geometry and up to 250000 faces');
  const mapped = model.faces.map((_,i)=>String(model.faceIds?.[i] ?? i));
  const all = new Set(mapped);
  for (const id of parts.keys()) if (!all.has(id)) throw new RangeError('Unknown cage source face '+id);
  const materials = (model.materials?.length?model.materials:[{}]).map(material=>{
    for (const name of Object.keys(material.masks ?? {})) maskNames.add(name);
    return { ...material,images:material.images ?? { pigment:Source.image(material.texture) } };
  });
  for (const name of model.maskNames ?? []) maskNames.add(name);
  const triangles=[];
  for (const [face, indices] of model.faces.entries()) {
    if (!Array.isArray(indices) || ![3,4].includes(indices.length) || new Set(indices).size!==indices.length ||
        !indices.every(i=>Number.isSafeInteger(i) && model.points[i])) throw new TypeError('Cage needs valid indexed source triangles or quads');
    const material=materials[model.faceMaterials?.[face] ?? 0];
    if (!material) throw new RangeError('Unknown cage source material slot on face '+mapped[face]);
    const part=parts.get(mapped[face]) ?? model.faceParts?.[face] ?? source.part;
    const uv=model.uvs?.[face];
    if (Object.values(material.images).some(Boolean) &&
        (uv?.length!==indices.length || uv.some(row=>!Source.list(row,2))))
      throw new RangeError('Cage source textures need UVs on face '+mapped[face]);
    const splits=indices.length===3 ? [[0,1,2]] : V.dist(model.points[indices[0]],model.points[indices[2]]) <=
      V.dist(model.points[indices[1]],model.points[indices[3]]) ? [[0,1,2],[0,2,3]] : [[0,1,3],[1,2,3]];
    for (const split of splits) {
      const ids=split.map(i=>indices[i]), points=ids.map(i=>model.points[i]), [a,b,c]=points;
      const u=V.sub(b,a), v=V.sub(c,a), cross=V.cross(u,v), area=V.len(cross);
      if (!(area>1e-14*V.len(u)*V.len(v))) throw new RangeError('Degenerate cage source triangle on face '+mapped[face]);
      const normal=V.mul(cross,1/area);
      const cornerNormals=split.map((i,j)=>model.cornerNormals?.[face]?.[i] ?? model.normals?.[ids[j]] ?? normal);
      const uvs=uv && split.map(i=>uv[i]);
      const [du,dv]=uvs ? uvs.slice(1).map(row=>row.map((n,k)=>n-uvs[0][k])) : [[],[]];
      const det=du[0]*dv[1]-du[1]*dv[0];
      const tangent=Math.abs(det)>1e-14 ? V.mul(V.sub(V.mul(u,dv[1]),V.mul(v,du[1])),1/det) : undefined;
      const bitangent=tangent && V.mul(V.sub(V.mul(v,du[0]),V.mul(u,dv[0])),1/det);
      triangles.push({ i:triangles.length,face,id:mapped[face],part,material,ids,a,u,v,normal,cornerNormals,uvs,tangent,bitangent,
        bounds:spatial.expand(spatial.boxOf(points),tolerance) });
    }
  }
  if (triangles.length>250000) throw new RangeError('Cage source exceeds 250000 triangles');
  const tree=spatial.pointIndex(triangles);
  return { triangles:triangles.length, cast(point,axis,ray,probe) {
    const start=ray?.front ?? front, length=start+(ray?.back ?? back);
    const origin=V.mad(point,axis,start), direction=V.mul(axis,-1), candidates=[];
    tree.ray(origin,direction,length+tolerance,row=>{
      work();
      if (probe && ((probe.part != null && probe.part !== row.part) || V.dot(row.normal,probe.facing)<entry.minFacing)) return;
      const cross=V.cross(direction,row.v), det=V.dot(row.u,cross);
      if (Math.abs(det)<1e-12) return;
      const d=V.sub(origin,row.a), u=V.dot(d,cross)/det;
      const q=V.cross(d,row.u), v=V.dot(direction,q)/det, t=V.dot(row.v,q)/det;
      if (u>=-1e-9 && v>=-1e-9 && u+v<=1+1e-9 && t>=-tolerance && t<=length+tolerance)
        candidates.push({t:Math.max(0,Math.min(length,t)),row,weights:[1-u-v,u,v]});
    });
    candidates.sort((a,b)=>(probe ? Math.abs(a.t-start)-Math.abs(b.t-start) : a.t-b.t) || a.row.i-b.row.i);
    let result, skippedBackface=false;
    for (const {t,row,weights} of candidates) {
      if (result && t-result.t>tolerance) break;
      const at=V.mad(origin,direction,t), normal=V.norm([0,1,2].map(k=>
        weights.reduce((sum,w,i)=>sum+w*row.cornerNormals[i][k],0)),row.normal);
      const material=Source.meshMaterial(row,normal,weights,at,model,kit);
      if (!material) continue; // Transparent scan texels do not occlude the ray.
      if (probe) return { offset:start-t, point:at, part:row.part, sourceFace:row.id };
      if (ray?.ignoreBackfaces && V.dot(row.normal,axis)<entry.minFacing) {
        skippedBackface=true;
        continue;
      }
      if (result) {
        if (row.part!==result.part) result.competingPart=row.part ?? null;
        continue;
      }
      result={ t,point:at,offset:start-t,normal:row.normal,material,part:row.part,sourceFace:row.id };
    }
    return skippedBackface ? { ...result, skippedBackface:true } : result;
  }};
}

function fieldCaster(entry, kit, work) {
  const {source,directory,front,back,steps,tolerance,maskNames} = entry, { V }=kit;
  const field=Source.fieldSource(source,directory,kit);
  for (const name of field.maskNames ?? []) maskNames.add(name);
  function distance(point) {
    work();
    const d=field.sdf(...point);
    if (!Number.isFinite(d)) throw new RangeError('Cage signed field returned a non-finite distance');
    return d;
  }
  return { cast(point,axis) {
    const sample=height=>distance(V.mad(point,axis,height));
    let hi=front, atHigh=sample(hi);
    for (let i=1;i<=steps;i++) {
      let lo=front-i*(front+back)/steps;
      const atLow=sample(lo);
      if (atHigh*atLow<0 || Math.abs(atHigh)<=tolerance || Math.abs(atLow)<=tolerance) {
        const end=Math.abs(atHigh)<=tolerance ? hi : Math.abs(atLow)<=tolerance ? lo : null;
        if (end===null) for (let j=0;j<24 && hi-lo>tolerance;j++) {
          const middle=(lo+hi)/2;
          if (sample(middle)*atHigh>0) hi=middle;
          else lo=middle;
        }
        const offset=end ?? (hi+lo)/2, at=V.mad(point,axis,offset);
        const epsilon=Math.max(2*tolerance,1e-6);
        const normal=V.norm([0,1,2].map(k=>{
          const a=at.slice(),b=at.slice();
          a[k]+=epsilon;
          b[k]-=epsilon;
          return distance(a)-distance(b);
        }),[0,0,0]);
        return { offset,point:at,normal,part:field.partAt?.(at) ?? source.part,
          material:{normal,...field.sampleSurface?.(at,normal)} };
      }
      hi=lo;
      atHigh=atLow;
    }
  }};
}

function prepare(spec, mesh, studio, kit) {
  const { source,front,back,part,parts,faces,protectPigment=new Set(),direction,minFacing,partPolicy,channels,maxWork,
    buildRay,backfaces='block' }=spec;
  const known=new Set(mesh.faces.map((_,i)=>String(mesh.faceIds?.[i] ?? i)));
  for (const id of [...parts.keys(),...(faces ?? []),...protectPigment]) if (!known.has(id)) throw new RangeError('Unknown cage receiver face '+id);
  const maskNames=new Set(), range=Math.max(front,back), tolerance=Math.max(1e-9,Math.min(1e-5,range*1e-6));
  let checks=0;
  function work() {
    if (++checks>maxWork) throw new RangeError('Material cage exceeds its work budget. Adjust atlas size, cage bounds or maxWork.');
  }
  const settings={...spec,tolerance,maskNames};
  const caster=spec.caster ?? (source.kind==='sdf' ? fieldCaster(settings,kit,work) : meshCaster(settings,studio,kit,work));
  const declared=new Set([...(mesh.maskNames ?? []),...mesh.materials.flatMap(material=>Object.keys(material.masks ?? {})),...maskNames]);
  if ([...declared].some(id=>names.has(id) || !idOK(id))) throw new TypeError('Cage diagnostic names are reserved material masks');
  const byPart=new Map(), examples={}, fields={pigment:'color',normal:'normal',roughness:'roughness',metallic:'metallic',emission:'emission',opacity:'opacity'};
  const counter=()=>({sampled:0,hits:0,misses:0,crossPart:0,rejectedCrossPart:0,backfaces:0});
  const stats=counter(), {V}=kit;
  let min=Infinity,max=-Infinity,retainedPigment=0;
  function sample(point, smooth, geometric, face, pixel) {
    const faceId=String(mesh.faceIds?.[face] ?? face);
    if (faces && !faces.has(faceId)) return;
    const expected=parts.get(faceId) ?? part ?? mesh.faceParts?.[face] ?? null;
    if (!byPart.has(expected)) byPart.set(expected,counter());
    const local=byPart.get(expected);
    stats.sampled++;
    local.sampled++;
    const ray=buildRay?.(point,smooth,geometric,face,pixel);
    const axis=ray?.axis ?? (direction==='geometric' ? geometric : smooth);
    const attempt=caster.cast(point,axis,ray&&{...ray,ignoreBackfaces:backfaces==='ignore'});
    const hit=attempt?.normal&&attempt;
    const cross=hit && (hit.competingPart!==undefined || expected!==null && hit.part!==expected);
    const hitBackface=hit && (V.len(hit.normal)===0 || V.dot(hit.normal,ray?axis:geometric)<minFacing);
    const backface=hitBackface || attempt?.skippedBackface;
    const accepted=Boolean(hit && (!hitBackface || backfaces==='accept') && (!cross || partPolicy==='allow') && hit.competingPart===undefined);
    for (const [key,on] of [['hits',accepted],['misses',!hit],['crossPart',cross],['rejectedCrossPart',cross&&!accepted],['backfaces',backface]]) {
      if (!on) continue;
      stats[key]++;
      local[key]++;
      const rows=examples[key] ??= [];
      if (rows.length<4) rows.push({face:faceId,pixel,expectedPart:expected,point,...(hit && {
        sourceFace:hit.sourceFace,sourcePart:hit.part??null,competingPart:hit.competingPart,position:hit.point,offset:hit.offset
      })});
    }
    let material;
    if (accepted) {
      min=Math.min(min,hit.offset);
      max=Math.max(max,hit.offset);
      if (protectPigment.has(faceId) && channels.includes('pigment') && hit.material.color!==undefined) retainedPigment++;
      material=Object.fromEntries(channels.filter(key=>fields[key] && (key!=='pigment' || !protectPigment.has(faceId)) &&
        hit.material[fields[key]]!==undefined)
        .map(key=>[fields[key],hit.material[fields[key]]]));
      if (channels.includes('masks') && hit.material.masks) material.masks=hit.material.masks;
    }
    return { material, ...(accepted&&{offset:hit.offset}), diagnostic:{
      'cage-hit':Number(accepted),'cage-miss':Number(!hit),'cage-cross-part':Number(Boolean(cross)),
      'cage-backface':Number(Boolean(backface)), 'cage-distance':hit ? unit(Math.abs(hit.offset)/range) : 0,
      'cage-relief':accepted ? unit(.5+hit.offset/(2*range)) : .5
    }};
  }
  const report=()=>({ version:1,source:{kind:source.kind,...(source.file && {file:source.file}),
    ...(caster.triangles && {triangles:caster.triangles})},front,back,distanceScale:range,direction,partPolicy,minFacing,channels,
    ...(source.kind==='sdf' && {steps:spec.steps}),...(buildRay&&{backfacesPolicy:backfaces}),maxWork,checks,...stats,
    ...(protectPigment.size && {protectedPigment:{faces:[...protectPigment],texels:retainedPigment}}),
    offsets:stats.hits ? {min,max} : null, parts:[...byPart].map(([part,row])=>({part,...row})),examples });
  return {maskNames:[...masks,...(channels.includes('masks') ? maskNames : [])],sample,report};
}

function estimate(spec, mesh, studio, kit, { search, margin = search * .05, maxProbes = 320 } = {}) {
  if (spec.source.kind==='sdf' || !finite(search,1e-5,1e5) || !finite(margin,0,search) ||
      !Number.isSafeInteger(maxProbes) || !finite(maxProbes,1,4096))
    throw new RangeError('Automatic cage needs a mesh source and bounded search, margin and probes');
  const {V}=kit, tolerance=Math.max(1e-9,Math.min(1e-5,search*1e-6));
  let checks=0;
  const caster=meshCaster({...spec,front:search,back:search,tolerance,maskNames:new Set()},studio,kit,()=>{
    if (++checks>spec.maxWork) throw new RangeError('Automatic cage exceeds its probe work budget');
  });
  const faces=mesh.faces.flatMap((ids,i)=>spec.faces && !spec.faces.has(String(mesh.faceIds?.[i] ?? i)) ? [] : [i]);
  const weights=[[1/3,1/3,1/3],[.7,.15,.15],[.15,.7,.15],[.15,.15,.7]];
  const total=faces.length*weights.length, probes=Math.min(total,maxProbes);
  let matches=0,min=Infinity,max=-Infinity;
  const parts=new Map();
  for (let k=0;k<probes;k++) {
    const i=Math.floor((k+.5)*total/probes), face=faces[Math.floor(i/weights.length)], w=weights[i%weights.length];
    const ids=mesh.faces[face], [a,b,c]=ids.map(id=>mesh.points[id]), cross=V.cross(V.sub(b,a),V.sub(c,a));
    if (ids.length!==3 || V.len(cross)<=1e-10) throw new RangeError('Automatic cage needs nondegenerate receiver triangles');
    const geometric=V.norm(cross), fallback=ids.map(id=>mesh.normals?.[id] ?? geometric);
    const weighted=rows=>[0,1,2].map(axis=>rows.reduce((v,row,j)=>v+w[j]*row[axis],0));
    const direction=spec.direction==='geometric' ? geometric : V.norm(weighted(mesh.cornerNormals?.[face] ?? fallback),geometric);
    const part=spec.parts.get(String(mesh.faceIds?.[face] ?? face)) ?? spec.part ?? mesh.faceParts?.[face] ?? null;
    if (!parts.has(part)) parts.set(part,{part,probes:0,matches:0});
    const row=parts.get(part);
    row.probes++;
    const hit=caster.cast(weighted([a,b,c]),direction,undefined,{part,facing:geometric});
    if (!hit) continue;
    row.matches++;
    matches++;
    min=Math.min(min,hit.offset);
    max=Math.max(max,hit.offset);
  }
  if (!matches) throw new RangeError('Automatic cage found no matching source surface in its search range');
  const floor=Math.max(1e-7,search*1e-5);
  return {mode:'automatic',front:Math.min(search,Math.max(floor,max+margin)),
    back:Math.min(search,Math.max(floor,-min+margin)),search,margin,probes,matches,checks,
    offsets:{min,max},parts:[...parts.values()]};
}

module.exports={read,prepare,estimate,masks};
