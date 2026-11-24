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

const splatKey = source=>source.id ? JSON.stringify(['splat',source.id]) : null;
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

function sourceAnchor(full,isolated,p,binding) {
  if (!(full.pixelSelection.coverage[p] > minimumCoverage)) return { reason:'reference-not-visible' };
  const at = coordinate(p,full.w), sample = Bindings.sample(full,at,ArtPasses);
  if (!sample) return { reason:'reference-address-unavailable' };
  const matches = hit=>hit && Targets.objectScope(binding,hit);
  const geometry = matches(sample.geometry) && sample.geometry;
  // The SDF pass also shades with splat carriers at the exact traced depth.
  const hits = sample.splats.filter(hit=>matches(hit) &&
    !(geometry?.kind === 'sdf' && Math.abs(hit.depth-geometry.depth) <= 1e-5));
  if ((!geometry && sample.truncated) || hits.length+Number(!!geometry) > 1)
    return { reason:'reference-ambiguous-source' };
  const source = geometry || hits[0];
  if (!source) return { reason:'reference-address-unavailable' };
  const anchor = geometry ? address(geometry) :
    source.id && { key:splatKey(source),local:isolated.pixelSourceTracking.localSplat(source,...at) };
  if (!anchor || !vector(anchor.local,3)) return { reason:'reference-address-unavailable' };
  if (source.kind === 'mesh') {
    anchor.signature = isolated.pixelSourceTracking.meshSignature(anchor.key);
    if (anchor.signature === undefined) return { reason:'reference-address-unavailable' };
  }
  return { ...anchor,source };
}

function project(anchor,tracking) {
  const { source,key,local } = anchor;
  if (source.kind === 'mesh') return tracking.projectMesh(key,local,anchor.signature);
  if (source.kind === 'sdf') return tracking.projectSdf(source.field,local);
  return tracking.projectSplat(source.id,local);
}

function observe(frame,anchor,at,expected,tolerance,occlusionTolerance = tolerance) {
  const surface = ArtPasses.pick(frame.passes,...at);
  const sample = Bindings.sample(frame,at,ArtPasses,surface);
  const { geometry,splats = [] } = sample ?? {};
  const matching = anchor.source.kind === 'splat' ? splats.find(hit=>splatKey(hit) === anchor.key) :
    geometry && address(geometry)?.key === anchor.key && geometry;
  // Splat depth may refer to the center plane rather than the projected local anchor.
  const p = at[1]*frame.w+at[0];
  if (frame.pixelSelection.coverage[p] > minimumCoverage && matching &&
      (anchor.source.kind === 'splat' || Math.abs(matching.depth-expected) <= tolerance))
    return { visible:true,depth:matching.depth };
  if (surface && surface.depth < expected-occlusionTolerance)
    return { blocker:{ kind:surface.kind,object:surface.object,part:surface.part,depth:surface.depth }};
  return {};
}

function locate(anchor,full,isolated) {
  const position = project(anchor,isolated.pixelSourceTracking);
  if (!vector(position,3)) return { status:'lost',reason:'source-unavailable-or-clipped' };
  const [x,y,z] = position, at = [Math.floor(x),Math.floor(y)];
  if (x < 0 || y < 0 || x >= full.w || y >= full.h)
    return { status:'lost',reason:'outside-view' };
  const { focal,orthographic } = full.sourceView.camera;
  // Ray-marched surfaces and raster centers can disagree by a fraction of a native pixel.
  const tolerance = Math.max(1e-4,(orthographic ? 1 : z)/focal*(anchor.source.kind === 'sdf' ? 1.5 : .75));
  const target = observe(isolated,anchor,at,z,tolerance);
  const current = observe(full,anchor,at,target.depth ?? z,tolerance,target.visible ? 1e-5 : tolerance);
  if (current.visible) return { status:'visible',at };
  if (current.blocker && (target.visible || target.blocker))
    return { status:'occluded',at,blocker:current.blocker };
  return { status:'lost',reason:'no-corresponding-pixel' };
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
      return { documentAt,referenceAt,...(referenceAt ? sourceAnchor(full,isolated,referenceAt[1]*w+referenceAt[0],binding) :
        { reason:'outside-registration' }) };
    });

    const masks = { visible:new Set(),moved:new Set(),occluded:new Set(),lost:new Set() };
    const counts = { visible:0,moved:0,occluded:0,lost:0 };
    const reasons = {}, examples = [];
    for (const anchor of anchors) {
      const { documentAt,referenceAt,source } = anchor;
      const result = !source ? { status:'lost',reason:anchor.reason } :
        index === 0 ? { status:'visible',at:referenceAt } : locate(anchor,full,isolated);
      const { status,at,reason } = result;
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
          ...(source.kind === 'sdf' && { field:source.field,local:source.local })
        }}) });
    }

    results.push({ id:row.id,label:row.label ?? row.id,frame:full.sourceView.frame,camera:full.sourceView.camera,
      counts,reasons,examples,runs:Object.fromEntries(Object.entries(masks)
        .map(([status,pixels])=>[status,runs(w,[...pixels].sort((a,b)=>a-b))])) });
    if (review) {
      const { width,height,rgba } = Review.fromRender({ ...full,sourceView:undefined },row);
      images.push(PNG.encode(width,height,rgba,4).toString('base64'));
    }
  }
  return { images,report:{ format:'ink-studio/pixel-selection-track',version:1,
    scene:binding.scene,binding:binding.id,object:binding.object,part:binding.part ?? null,
    selection:selection.id,documentFrame:selection.frame ?? binding.frame ?? null,revision,grid,documentGrid,
    scope:'visible',reference:samples[0].id,selectedPixels:anchors.length,samples:results } };
}

function writeReview(file,images,report) {
  const data = JSON.stringify({ images,report }).replaceAll('<','\\u003c');
  const template = fs.readFileSync(path.join(__dirname,'pixel-selection-track.html'),'utf8');
  const source = name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
  files.write(file,template.replace('/*CSS*/',()=>source('pixel-grid-canvas.css'))
    .replace('/*SCRIPTS*/',()=>source('pixel-grid-canvas.mjs')).replace('/*DATA*/',()=>data));
}

module.exports = { track,writeReview };
