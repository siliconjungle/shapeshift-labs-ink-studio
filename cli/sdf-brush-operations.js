'use strict';

const skin = .0005;
const seam = 1e-4;
const corners2 = [[-seam,-seam],[1+seam,-seam],[1+seam,1+seam],[-seam,1+seam]];
const depthSamples = 16;
const clamp = (n,low,high) => Math.min(high,Math.max(low,n));

function strengths(candidates,w,h,{ profile,falloff }) {
  const marks = new Map(candidates.map(row=>[row.sourceAt[1]*w+row.sourceAt[0],row]));
  const distance = new Map(), queue = [];
  const neighbors = (x,y) => [x>0 && y*w+x-1,x+1<w && y*w+x+1,y>0 && (y-1)*w+x,y+1<h && (y+1)*w+x];
  for (const [key,{ sourceAt:[x,y] }] of marks)
    if (neighbors(x,y).some(p=>!marks.has(p))) {
      queue.push(key);
      distance.set(key,1);
    }
  let deepest = 1;
  for (let i=0;i<queue.length;i++) {
    const p = queue[i], next = distance.get(p)+1;
    for (const peer of neighbors(p%w,Math.floor(p/w))) if (marks.has(peer) && !distance.has(peer)) {
      distance.set(peer,next);
      deepest = Math.max(deepest,next);
      queue.push(peer);
    }
  }
  for (const [key,row] of marks) {
    const edge = distance.get(key)-.5, t = edge/(deepest-.5);
    const fade = falloff.pixels ? Math.min(1,edge/falloff.pixels) : 1;
    const weight = falloff.curve==='linear' ? fade : fade*fade*(3-2*fade);
    row.strength = profileAt(profile,t)*weight;
  }
}

function profileAt(profile,t) {
  if (profile==='flat') return 1;
  if (profile==='round') return Math.sqrt(t*(2-t));
  if (profile==='taper') return t;
  const i = profile.findIndex(([x])=>x>=t);
  if (i===0) return profile[0][1];
  const [x,a] = profile[i-1], [y,b] = profile[i];
  return a+(b-a)*(t-x)/(y-x);
}

function smoothOffsets(hit,lookup,V) {
  const { sourceAt:[x,y],surface,owner } = hit, radius = 8;
  const totals = Array.from({length:radius},()=>[0,0,0]), weights = new Float64Array(radius);
  for (let dy=0;dy<=radius;dy++) {
    for (let dx=-radius;dx<=radius;dx++) {
      const distance = Math.hypot(dx,dy);
      if (!distance || distance>radius || dy===0 && dx<0) continue;
      const a = lookup(x+dx,y+dy), b = lookup(x-dx,y-dy);
      if (a?.owner!==owner || b?.owner!==owner) continue;
      const slot = Math.ceil(distance)-1;
      const mean = V.lerp(a.surface.position,b.surface.position,.5);
      totals[slot] = V.mad(totals[slot],V.sub(mean,surface.position),1/distance);
      weights[slot] += 1/distance;
    }
  }
  let total = [0,0,0], weight = 0;
  return totals.map((vector,i)=>{
    total = V.add(total,vector);
    weight += weights[i];
    return weight ? V.mul(total,1/weight) : null;
  });
}

// Trace from behind the conservative bound to the last exit along the tool axis.
function backExit(owner,origin,inward,V) {
  const scale = V.len(inward), axis = V.mul(inward,1/scale);
  const toCenter = V.sub(owner.bc,origin), axial = V.dot(toCenter,axis);
  const radicand = (owner.br+skin*4)**2-V.dot(toCenter,toCenter)+axial*axial;
  if (radicand<0) return { hit:false };
  let along = axial+Math.sqrt(radicand)+skin*4;
  for (let i=0;i<512 && along>=-skin*4;i++) {
    const d = owner.sd(...V.mad(origin,axis,along));
    if (!Number.isFinite(d)) return { unresolved:true };
    if (d<=skin && owner.sd(...V.mad(origin,axis,along-skin*4))<0)
      return { hit:true, distance:(along+skin*4)/scale };
    along -= Math.max(skin,Math.abs(d)*.65);
  }
  return along>=-skin*4 ? { unresolved:true } : { hit:false };
}

function throughDepth(hit,sweep,depth,V) {
  const [x,y] = hit.sourceAt;
  const samples = [[.5,.5],...corners2];
  let reach = 0;
  for (const [i,[u,v]] of samples.entries()) {
    const origin = sweep(x+u,y+v,0), inward = V.sub(sweep(x+u,y+v,-1),origin);
    const exit = backExit(hit.owner,origin,inward,V);
    if (exit.unresolved || i===0 && (!exit.hit || exit.distance<skin*6)) return { code:'through-cut-exit-unavailable' };
    if (exit.hit) reach = Math.max(reach,exit.distance);
  }
  return reach<=depth ? { offset:-reach } : { code:'through-cut-depth-limit',requiredDepth:reach };
}

function brushSweep(hit,projection,grid,api,V) {
  const { sourceAt:[x,y],outward,surface,direction } = hit;
  const axial = direction==='view' && projection.perspective ? -V.dot(outward,projection.forward) : 0;
  function onSurface(x,y) {
    const native = api.point(projection,grid,x,y,surface.depth);
    if (direction==='view') return native;
    const ray = projection.perspective ?
      V.mul(V.sub(native,projection.origin),1/surface.depth) : projection.forward;
    const angle = V.dot(surface.geometricNormal,ray);
    if (angle>=-.01) return null;
    const shift = V.dot(surface.geometricNormal,V.sub(surface.position,native))/angle;
    return surface.depth+shift>=1e-4 ? V.mad(native,ray,shift) : null;
  }
  const base = corners2.map(([u,v])=>onSurface(x+u,y+v));
  if (base.some(p=>!p)) return;
  function point(x,y,d) {
    return axial ? api.point(projection,grid,x,y,surface.depth-d*axial) : V.mad(onSurface(x,y),outward,d);
  }
  const [a,b,c,d] = base;
  const area = Math.abs(V.dot(V.add(V.cross(V.sub(b,a),V.sub(c,a)),V.cross(V.sub(c,a),V.sub(d,a))),outward))*.5;
  if (area<1e-10) return;
  return { point,valid:distance=>!axial || surface.depth-distance*axial>=1e-4,
    volumeAt:distance=>area*(axial ? (1-distance*axial/surface.depth)**2 : 1) };
}

function plan({ mode,settings,grid,projection,candidates,attachment,skipped,api,V }) {
  const [w,h] = grid;
  strengths(candidates,w,h,settings);
  const capAxis = settings.direction==='normal' ?
    V.norm(candidates.reduce((sum,hit)=>V.add(sum,hit.outward),[0,0,0])) :
    settings.direction==='view' ? V.mul(projection.forward,-1) : settings.direction;
  const level = mode==='fill' ? Math.max(...candidates.map(hit=>V.dot(capAxis,hit.surface.position))) : 0;
  const columns = [], plans = [];
  for (const hit of candidates) {
    const { at,sourceAt:[x,y],outward,surface,strength } = hit;
    const sweep = brushSweep(hit,projection,grid,api,V);
    const depth = settings.depth*strength;
    let offset, rejected;
    if (!sweep) rejected = { code:'invalid-swept-footprint' };
    else if (depth<skin) rejected = { code:'profile-zero-depth' };
    else if (mode==='through-cut') {
      const result = throughDepth(hit,sweep.point,depth,V);
      if (result.code) rejected = result;
      else offset = result.offset;
    } else if (mode==='fill') {
      const travel = V.dot(capAxis,outward);
      if (travel<=.05) rejected = { code:'fill-direction-misses-level' };
      else offset = Math.min(depth,(level-V.dot(capAxis,surface.position))/travel);
    } else if (mode==='smooth') {
      const average = hit.smoothOffsets?.[settings.radius-1];
      if (!average) rejected = { code:'smooth-neighbors-unavailable' };
      else offset = clamp(V.dot(average,outward)*strength,-depth,depth);
    } else offset = mode==='carve' ? -depth : depth;
    if (!rejected && Math.abs(offset)<skin) rejected = { code:mode==='fill' ? 'already-at-level' : 'no-smooth-change' };
    if (rejected) {
      skipped.push({ at,sourceAt:hit.sourceAt,...rejected });
      continue;
    }
    const change = offset<0 ? 'cut' : 'add';
    const overlap = Math.min(Math.abs(offset)*.5,Math.max(skin*4,Math.sqrt(sweep.volumeAt(0))*.15));
    const range = [Math.min(offset,-overlap),Math.max(offset,overlap)];
    if (!sweep.valid(range[1])) { skipped.push({ at,sourceAt:hit.sourceAt,code:'outside-brush-depth' }); continue; }
    const corners = range.flatMap(d=>corners2.map(([u,v])=>hit.toLocal(sweep.point(x+u,y+v,d))));
    columns.push({ at:hit.sourceAt,corners,change });
    plans.push({ hit,sweep,range,strength,change });
  }
  if (!columns.length) return;
  const brush = { version:2,grid,settings,columns,attachment };
  const cutting = api.prepare(brush,mode,'cut'), adding = api.prepare(brush,mode,'add');
  const fields = [cutting,adding].filter(Boolean);
  const bounds = {
    min: [0,1,2].map(i=>Math.min(...fields.map(field=>field.bounds.min[i]))),
    max: [0,1,2].map(i=>Math.max(...fields.map(field=>field.bounds.max[i])))
  };
  const volume = { space:'solid-rest',bounds,estimatedWorldVolume:0,addedWorldVolume:0,removedWorldVolume:0,
    depthSamplesPerPixel:depthSamples };
  const hits = plans.map(({hit,sweep,range,strength,change})=>{
    const { at,sourceAt:[x,y],surface,outward,owner,toLocal } = hit;
    const changedDepths = [], dz = (range[1]-range[0])/depthSamples;
    let previous;
    for (let i=0;i<depthSamples;i++) {
      const d = range[0]+(i+.5)*dz, atWorld = sweep.point(x+.5,y+.5,d), local = toLocal(atWorld);
      const before = owner.sd(...atWorld), cut = cutting ? Math.max(before,-cutting.sd(...local)) : before;
      const after = adding ? Math.min(cut,adding.sd(...local)) : cut;
      if ((before<0)===(after<0)) { previous = undefined; continue; }
      const kind = after<0 ? 'add' : 'cut', end = range[0]+(i+1)*dz;
      if (previous?.change===kind) previous.depth[1] = end;
      else changedDepths.push(previous={ change:kind,depth:[range[0]+i*dz,end] });
      volume[kind==='add' ? 'addedWorldVolume' : 'removedWorldVolume'] += sweep.volumeAt(d)*dz;
    }
    return { at,sourceAt:hit.sourceAt,rest:toLocal(surface.position),surfaceDepth:surface.depth,outward,
      depth:range,strength,change,changedDepths };
  });
  volume.estimatedWorldVolume = volume.addedWorldVolume+volume.removedWorldVolume;
  return { modifier:{ kind:'grid-brush',mode,brush },report:{ mode,grid,settings,depthUnit:'signed-world-from-hit',
    projectedPixels:hits.length,hits,skippedHits:skipped,volume,attachment:{ ...attachment.source,time:attachment.time } } };
}

module.exports = { plan,smoothOffsets };
