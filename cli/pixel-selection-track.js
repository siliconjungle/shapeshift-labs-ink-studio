'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ArtPasses = require('../src/art-passes.js');
const Bindings = require('../src/pixel-source-bindings.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const Targets = require('../src/target-selectors.js');
const { runs } = require('../src/pixel-paint-tools.js');
const { minimumCoverage } = require('./pixel-selection-scope.js');
const { meshKey } = require('./pixel-source-tracking.js');
const Review = require('./pixel-motion-review.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const sdfKey = source=>source.field ? JSON.stringify(['sdf',source.field]) : null;
const coordinate = (p,w)=>[p%w,Math.floor(p/w)];
const vector = (point,n)=>point?.length === n && point.every(Number.isFinite);

function address(geometry) {
  if (geometry.kind === 'mesh' && vector(geometry.barycentric,3))
    return { key:meshKey(geometry),local:geometry.barycentric };
  if (geometry.kind === 'sdf' && geometry.field && vector(geometry.rest,3))
    return { key:sdfKey(geometry),local:geometry.rest };
  return null;
}

function sourceAt(frame,at,binding) {
  const p = at[1]*frame.w+at[0];
  if (!(frame.pixelSelection.coverage[p] > minimumCoverage)) return { reason:'reference-not-visible' };
  const sample = Bindings.sample(frame,at,ArtPasses);
  if (!sample) return { reason:'reference-address-unavailable' };
  const matches = hit=>hit && Targets.objectScope(binding,hit);
  const geometry = matches(sample.geometry) && sample.geometry;
  // The SDF pass also shades with splat carriers at the exact traced depth.
  const hits = sample.splats.filter(hit=>matches(hit) &&
    !(geometry?.kind === 'sdf' && Math.abs(hit.depth-geometry.depth) <= 1e-5));
  const owner = binding.mapping?.sources.splat && hits.find(hit=>hit.opaqueOwner);
  if (!geometry && owner && !hits.some(hit=>hit.depth < owner.depth-1e-5)) return { source:owner };
  if ((!geometry && sample.truncated) || hits.length+Number(!!geometry) > 1)
    return { reason:'reference-ambiguous-source' };
  const source = geometry || hits[0];
  return source ? { source } : { reason:'reference-address-unavailable' };
}

function mappedPoint(mapping,source,at,tracking) {
  const point = Bindings.partPoint(mapping,source);
  if (point || !mapping.sources.splat || source.kind !== 'splat' || !source.id) return point;
  return Bindings.partPoint(mapping,source,tracking.restSplat(source,...at));
}

function sourceAnchor(full,isolated,at,binding) {
  const { source,reason } = sourceAt(full,at,binding);
  if (!source) return { reason };
  const tracking = isolated.pixelSourceTracking;
  const point = binding.mapping && mappedPoint(binding.mapping,source,at,tracking);
  const anchor = source.kind === 'splat' ? source.id &&
    { local:tracking.localSplat(source,...at) } : address(source);
  if (anchor && source.kind === 'mesh') anchor.signature = tracking.meshSignature(anchor.key);
  const exact = anchor && vector(anchor.local,3) && (source.kind !== 'mesh' || anchor.signature !== undefined);
  if (!exact && !point) return { reason:'reference-address-unavailable' };
  return { source,exact:exact ? anchor : null,point };
}

function project(anchor,tracking) {
  const { source,exact:{ key,local,signature } } = anchor;
  if (source.kind === 'mesh') return tracking.projectMesh(key,local,signature);
  if (source.kind === 'sdf') return tracking.projectSdf(source.field,local);
  return tracking.projectSplat(source.id,local);
}

function observe(frame,source,at,expected,tolerance,occlusionTolerance = tolerance) {
  const surface = ArtPasses.pick(frame.passes,...at);
  const sample = Bindings.sample(frame,at,ArtPasses,surface);
  const { geometry,splats = [] } = sample ?? {};
  let matching;
  if (source.kind === 'splat') matching = splats.find(hit=>source.id ? hit.id === source.id :
    source.opaqueOwner && hit.opaqueOwner && hit.renderRow === source.renderRow);
  else if (geometry?.kind === source.kind) {
    if (source.kind === 'sprite') {
      const same = source.object === geometry.object && source.part === geometry.part &&
        source.frame === geometry.frame && source.yaw === geometry.yaw && source.pitch === geometry.pitch &&
        source.local.every((value,i)=>value === geometry.local[i]);
      if (same) matching = geometry;
    } else {
      const key = address(source)?.key;
      if (key && address(geometry)?.key === key) matching = geometry;
    }
  }
  // Splat depth may refer to the center plane rather than the projected local anchor.
  const p = at[1]*frame.w+at[0];
  if (frame.pixelSelection.coverage[p] > minimumCoverage && matching &&
      (source.kind === 'splat' || Math.abs(matching.depth-expected) <= tolerance))
    return { visible:true,depth:matching.depth };
  if (surface && surface.depth < expected-occlusionTolerance)
    return { blocker:{ kind:surface.kind,object:surface.object,part:surface.part,depth:surface.depth }};
  return {};
}

function locate(anchor,full,isolated) {
  const position = anchor.exact && project(anchor,isolated.pixelSourceTracking);
  if (!vector(position,3)) return { status:'lost',reason:'source-unavailable-or-clipped' };
  const [x,y,z] = position, at = [Math.floor(x),Math.floor(y)];
  if (x < 0 || y < 0 || x >= full.w || y >= full.h)
    return { status:'lost',reason:'outside-view' };
  const { focal,orthographic } = full.sourceView.camera;
  // Ray-marched surfaces and raster centers can disagree by a fraction of a native pixel.
  const tolerance = Math.max(1e-4,(orthographic ? 1 : z)/focal*(anchor.source.kind === 'sdf' ? 1.5 : .75));
  const target = observe(isolated,anchor.source,at,z,tolerance);
  const current = observe(full,anchor.source,at,target.depth ?? z,tolerance,target.visible ? 1e-5 : tolerance);
  if (current.visible) return { status:'visible',at };
  if (current.blocker && (target.visible || target.blocker))
    return { status:'occluded',at,blocker:current.blocker };
  return { status:'lost',reason:'no-corresponding-pixel' };
}

function mappedView(frame,binding) {
  const { nearest } = require('../index.js').load().KIT.procedural.attributes;
  const groups = new Map();
  for (let p=0; p<frame.w*frame.h; p++) {
    if (!(frame.pixelSelection.coverage[p] > minimumCoverage)) continue;
    const at = coordinate(p,frame.w), { source } = sourceAt(frame,at,binding);
    if (!source) continue;
    const point = mappedPoint(binding.mapping,source,at,frame.pixelSourceTracking);
    if (!point) continue;
    if (!groups.has(source.kind)) groups.set(source.kind,[]);
    groups.get(source.kind).push({ at,source,point });
  }
  return [...groups].map(([kind,rows])=>({ kind,
    index:nearest({ points:rows.map(row=>row.point),entities:rows,read:i=>rows[i] }) }));
}

function mappedLocation(anchor,indices,full,mapping) {
  let best;
  for (const { kind,index } of indices) {
    // Same-representation native edits still require their original topology or source ID.
    if (kind === anchor.source.kind && kind !== 'sprite') continue;
    const hit = index.sample(anchor.point);
    if (hit && hit.distance <= mapping.tolerance && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) return null;
  const { at,source,point } = best.values;
  const current = observe(full,source,at,source.depth,1e-5);
  if (!current.visible && !current.blocker) return null;
  return { status:current.visible ? 'visible' : 'occluded',at,
    ...(!current.visible && { blocker:current.blocker }),
    mapping:{ id:mapping.id,from:anchor.source.kind,to:source.kind,point,distance:best.distance } };
}

function track({ binding,selection,documentGrid,revision,views,render,review }) {
  const grid = binding.canvas?.size ?? documentGrid, [w,h] = grid;
  const { samples } = Review.plan(views,'scene',w,h);
  if (samples.length < 2) throw new RangeError('Selection tracking needs a reference and at least one destination view');
  const images = [], results = [];
  let anchors;
  for (const [index,row] of samples.entries()) {
    const { full,isolated } = render(row,index,grid);
    if (!isolated.pixelSourceTracking || !full.pixelSelection || !isolated.pixelSelection ||
        JSON.stringify(full.sourceView.camera) !== JSON.stringify(isolated.sourceView.camera) ||
        full.sourceView.frame.poseTime !== isolated.sourceView.frame.poseTime)
      throw new RangeError('Selection tracking needs full and isolated views on the same native camera and pose');
    if (!anchors) anchors = selection.pixels.map(documentAt=>{
      const referenceAt = Canvas.sourcePoint(documentGrid,documentAt,binding.canvas)?.map(Math.floor);
      const anchor = Bindings.staleAt(binding,documentAt) ? { reason:'stale-source-binding' } :
        referenceAt ? sourceAnchor(full,isolated,referenceAt,binding) : { reason:'outside-registration' };
      return { documentAt,referenceAt,...anchor };
    });

    const masks = { visible:new Set(),moved:new Set(),occluded:new Set(),lost:new Set() };
    const counts = { visible:0,moved:0,occluded:0,lost:0 };
    const reasons = {}, examples = [], mappings = new Map();
    let mapped;
    for (const anchor of anchors) {
      const { documentAt,referenceAt,source } = anchor;
      let result = !source ? { status:'lost',reason:anchor.reason } :
        index === 0 ? { status:'visible',at:referenceAt } : locate(anchor,full,isolated);
      if (result.status === 'lost' && anchor.point) {
        mapped ??= mappedView(isolated,binding);
        const transfer = mappedLocation(anchor,mapped,full,binding.mapping);
        if (transfer) result = transfer;
        else if (!anchor.exact || result.reason === 'source-unavailable-or-clipped')
          result = { status:'lost',reason:'no-registered-correspondence' };
      }
      const { status,at,reason,mapping } = result;
      if (mapping) {
        const key = mapping.from+'-'+mapping.to;
        if (!mappings.has(key)) mappings.set(key,{ from:mapping.from,to:mapping.to,visible:0,occluded:0 });
        mappings.get(key)[status]++;
      }
      const mark = at ?? referenceAt;
      counts[status]++;
      if (mark) masks[status].add(mark[1]*w+mark[0]);
      if (status === 'visible' && (at[0] !== referenceAt[0] || at[1] !== referenceAt[1])) {
        counts.moved++;
        masks.moved.add(at[1]*w+at[0]);
      }
      if (reason) reasons[reason] = (reasons[reason] ?? 0)+1;
      if (examples.length < 24) examples.push({ documentAt,referenceAt:referenceAt ?? null,...result,
        ...(source && { source:{ kind:source.kind,object:source.object ?? source.entity ?? null,part:source.part ?? null,
          ...(source.kind === 'splat' && { id:source.id }),
          ...(source.kind === 'mesh' && { chart:source.chart,triangle:source.triangle }),
          ...(source.kind === 'sdf' && { field:source.field,local:source.local }),
          ...(source.kind === 'sprite' && { frame:source.frame,yaw:source.yaw,pitch:source.pitch,local:source.local })
        }}) });
    }

    results.push({ id:row.id,label:row.label ?? row.id,frame:full.sourceView.frame,camera:full.sourceView.camera,
      counts,reasons,examples,...(binding.mapping && { mappings:[...mappings.values()] }),runs:Object.fromEntries(Object.entries(masks)
        .map(([status,pixels])=>[status,runs(w,[...pixels].sort((a,b)=>a-b))])) });
    if (review) {
      const { width,height,rgba } = Review.fromRender({ ...full,sourceView:undefined },row);
      images.push(PNG.encode(width,height,rgba,4).toString('base64'));
    }
  }
  return { images,report:{ format:'ink-studio/pixel-selection-track',version:1,
    scene:binding.scene,binding:binding.id,object:binding.object,part:binding.part ?? null,
    selection:selection.id,documentFrame:selection.frame ?? binding.frame ?? null,revision,grid,documentGrid,
    scope:'visible',...(binding.mapping && { mapping:binding.mapping }),reference:samples[0].id,selectedPixels:anchors.length,samples:results } };
}

function writeReview(file,images,report) {
  const data = JSON.stringify({ images,report }).replaceAll('<','\\u003c');
  const template = fs.readFileSync(path.join(__dirname,'pixel-selection-track.html'),'utf8');
  const source = name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
  files.write(file,template.replace('/*CSS*/',()=>source('pixel-grid-canvas.css'))
    .replace('/*SCRIPTS*/',()=>source('pixel-grid-canvas.mjs')).replace('/*DATA*/',()=>data));
}

module.exports = { track,writeReview };
