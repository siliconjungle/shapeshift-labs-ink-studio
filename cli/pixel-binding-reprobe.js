'use strict';

const { isDeepStrictEqual:equal } = require('node:util');
const Bindings = require('../src/pixel-source-bindings.js');
const ArtPasses = require('../src/art-passes.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const Targets = require('../src/target-selectors.js');
const { runs } = require('../src/pixel-paint-tools.js');
const { minimumCoverage } = require('./pixel-selection-scope.js');

const epsilon = 1e-4;
const close = (a,b)=>{
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((n,i)=>close(n,b[i]));
  return Math.abs(a-b) <= epsilon;
};

function viewKey({ sourceView }) {
  const { camera,frame } = sourceView;
  return JSON.stringify([camera.matrix,camera.focal,camera.orthographic,camera.near,camera.far,
    frame.time,frame.poseTime,frame.cameraTime,frame.skyTime]);
}

function meshKey(hit) {
  const storage = hit.asset && hit.chart ? [] : [hit.stageSlot,hit.primitive];
  return [hit.asset,hit.chart,hit.triangle,...storage];
}

function item(hit) {
  const common = { kind:hit.kind,material:hit.material ?? null,depth:hit.depth };
  if (hit.kind === 'splat') return { ...common,address:hit.id,revision:hit.revision,at:hit.rest,
    coverage:hit.visibleCoverage,alpha:hit.alpha };
  if (hit.kind === 'mesh') return { ...common,address:Number.isSafeInteger(hit.triangle) ? meshKey(hit) : null,
    revision:hit.revision,at:hit.rest,coordinates:hit.barycentric,uv:hit.uv,coverage:hit.coverage };
  if (hit.kind === 'sdf') return { ...common,address:hit.field,at:hit.rest,coordinates:hit.local,coverage:hit.coverage };
  return { ...common,address:[hit.frame,hit.yaw,hit.pitch],at:hit.local,coverage:hit.coverage };
}

function snapshot(frame,at,binding) {
  const p = at[1]*frame.w+at[0], surface = ArtPasses.pick(frame.passes,...at);
  const matches = value=>!!(value && Targets.objectScope(binding,value));
  const sample = Bindings.sample(frame,at,ArtPasses,surface);
  const geometry = matches(sample?.geometry) && sample.geometry;
  const splats = sample?.splats.filter(hit=>matches(hit) &&
    !(geometry?.kind === 'sdf' && close(hit.depth,geometry.depth))) ?? [];
  const hits = [geometry,...splats].filter(Boolean).map(item);
  hits.sort((a,b)=>{
    const left = JSON.stringify([a.kind,a.address]), right = JSON.stringify([b.kind,b.address]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const paired = frame.bindingEvidence;
  const scoped = paired?.object === binding.object && paired.part === binding.part;
  const projected = scoped && paired.projected[p] > minimumCoverage;
  const front = matches(surface) || !!geometry || splats.some(hit=>hit.opaqueOwner);
  const occluder = surface && !front ? { kind:surface.kind,object:surface.object,part:surface.part,depth:surface.depth } : null;
  const unresolved = front && !hits.length || !geometry && sample?.truncated && (!scoped || projected);
  const revisionMissing = hits.some(hit=>!hit.address || (hit.kind === 'mesh' || hit.kind === 'splat') && !hit.revision);
  return { hits,revisionMissing,unresolved,covered:!!(hits.length || projected || front),
    occluder,normals:front ? [surface?.geometricNormal,surface?.shadingNormal] : undefined,
    pigment:front ? frame.passes.pigment?.[p] : undefined };
}

function compare(before,after) {
  if (before.unresolved || after.unresolved) return { status:'review',reason:'unverified-hit' };
  if (!before.covered && !after.covered) return { status:'empty' };
  if (before.hits.length && !after.hits.length) {
    const nearer = after.occluder && before.hits.some(hit=>after.occluder.depth < hit.depth-epsilon);
    return { status:'review',reason:nearer ? 'nearer-occluder' : 'source-lost' };
  }
  if (!before.hits.length && after.hits.length) return { status:'review',reason:'source-gained' };
  if (!before.hits.length) return { status:'review',reason:'unverified-hit' };
  const left = before.hits, right = after.hits;
  if (!equal(left.map(hit=>[hit.kind,hit.address]),right.map(hit=>[hit.kind,hit.address])))
    return { status:'review',reason:'source-address-changed' };
  if (left.some((hit,i)=>hit.revision && right[i].revision && hit.revision !== right[i].revision))
    return { status:'review',reason:'source-revision-changed' };
  if (left.some((hit,i)=>['at','coordinates','uv','depth','coverage','alpha'].some(key=>!close(hit[key],right[i][key]))) ||
      !close(before.normals,after.normals))
    return { status:'review',reason:'surface-hit-changed' };
  if (left.some((hit,i)=>hit.material !== right[i].material) ||
      before.pigment !== undefined && after.pigment !== undefined && before.pigment !== after.pigment)
    return { status:'review',reason:'sampled-pigment-changed' };
  if (before.revisionMissing || after.revisionMissing || before.pigment === undefined && after.pigment !== undefined ||
      before.pigment !== undefined && after.pigment === undefined)
    return { status:'review',reason:'missing-source-proof' };
  return { status:'verified' };
}

function probe(design,binding,pixels,before,after,{ accept = false } = {}) {
  const { width,height } = design, grid = [width,height], native = binding.canvas?.size ?? grid;
  if ([before,after].some(frame=>!equal([frame.w,frame.h],native)))
    throw new RangeError('Reprobe captures must match the binding’s registered native grid');
  if (viewKey(before) !== viewKey(after))
    throw new RangeError('Reprobe needs matching native cameras and frame times before and after the source edit');
  const masks = { verified:[],review:[],empty:[] }, reasons = {}, examples = [];
  const persistent = new Set();
  for (const [y,x,length] of binding.stale ?? [])
    for (let i=0;i<length;i++) persistent.add(y*width+x+i);
  for (const at of pixels) {
    const mapped = Canvas.sourcePoint(grid,at,binding.canvas)?.map(Math.floor), index = at[1]*width+at[0];
    const left = mapped && snapshot(before,mapped,binding), right = mapped && snapshot(after,mapped,binding);
    const result = mapped ? compare(left,right) : { status:'review',reason:'outside-registration' };
    masks[result.status].push(index);
    if (result.status === 'review') {
      persistent.add(index);
      reasons[result.reason] = (reasons[result.reason] ?? 0)+1;
      if (examples.length < 32) examples.push({ at,sourceAt:mapped ?? null,reason:result.reason,
        before:left?.hits ?? [],after:right?.hits ?? [],...(right?.occluder && { occluder:right.occluder }) });
    } else if (accept && result.status === 'verified') persistent.delete(index);
  }
  const sortedRuns = values=>runs(width,[...values].sort((a,b)=>a-b));
  const stale = sortedRuns(persistent);
  return {
    report:{ format:'ink-studio/pixel-binding-reprobe',version:1,scene:binding.scene,binding:binding.id,
      object:binding.object,part:binding.part ?? null,grid,nativeGrid:native,before:before.sourceView.id,after:after.sourceView.id,
      counts:{ ...Object.fromEntries(Object.entries(masks).map(([name,list])=>[name,list.length])),stale:persistent.size },
      status:persistent.size ? 'needs-review' : 'verified',reasons,examples,runs:{ ...Object.fromEntries(Object.entries(masks).map(([name,list])=>[name,sortedRuns(list)])),
        stale } },
    stale
  };
}

module.exports = { probe };
