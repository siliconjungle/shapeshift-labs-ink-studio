'use strict';

const ViewSource = require('../src/pixel-view-source.js');
const Targets = require('../src/target-selectors.js');
const Provenance = require('../src/splat-provenance.js');
const SplatFit = require('./splat-fit-asset.js');
const { previewLimit } = require('./pixel-edit-preview.js');

const scope = Symbol('splat edit diagnostics');
const pairLimit = 500000;
const focusLimit = 128;

function setup(w, h, options = {}) {
  ViewSource.grid(w, h);
  const { rect = [0,0,w,h], at, coverageThreshold = .5, buildupThreshold = .15 } = options;
  const limit = previewLimit(options.limit);
  const integerVector = (value, length) => Array.isArray(value) && value.length === length &&
    Array.from(value).every(Number.isSafeInteger);
  if (!integerVector(rect, 4)) throw new TypeError('Splat diagnostics needs a rectangle [x,y,width,height]');
  const [x,y,width,height] = rect;
  if (x < 0 || y < 0 || width < 1 || height < 1 || x+width > w || y+height > h)
    throw new RangeError('Splat diagnostic rectangle lies outside the art grid');
  if (at !== undefined && (!integerVector(at, 2) || at[0] < x || at[0] >= x+width || at[1] < y || at[1] >= y+height))
    throw new RangeError('Splat inspection coordinate lies outside the diagnostic rectangle');
  if (![coverageThreshold,buildupThreshold].every(n => Number.isFinite(n) && n > 0 && n <= 1))
    throw new RangeError('Splat diagnostic thresholds must be greater than 0 and at most 1');

  const sources = [], identities = new Map(), frames = [];
  const size = width*height;
  function capture(world, renderWidth, renderHeight) {
    if (renderWidth !== w || renderHeight !== h)
      throw new RangeError('Splat diagnostics needs the requested native art grid');
    const count = new Uint32Array(size), opacity = new Float64Array(size), strongest = new Float32Array(size);
    const opaque = new Uint32Array(size), proxy = new Uint32Array(size);
    const projected = new Set(), slots = new Map(), focus = [];
    const pairs = new Set();
    const backing = SplatFit.sourceWorld(world);
    let catalog, targets, truncated = false, pixelTests = 0, focusDraws = 0;
    const bottom = h-y-height;
    const focusPixel = at ? (h-1-at[1])*w+at[0] : -1;

    function index(pixel) {
      const px = pixel%w-x, py = h-1-Math.floor(pixel/w)-y;
      return px >= 0 && px < width && py >= 0 && py < height ? py*width+px : -1;
    }

    function source(row) {
      if (!slots.has(row)) {
        catalog ??= Provenance.identities(backing);
        const id = catalog.idAt(row) ?? null;
        const key = id ?? row;
        if (!identities.has(key)) {
          identities.set(key, sources.length);
          sources.push({ id, row });
        }
        slots.set(row, identities.get(key));
      }
      return slots.get(row);
    }

    function describe(row) {
      targets ??= Targets.index(world).row;
      const {object,part,material} = targets(row);
      return { ...sources[source(row)], object:object ?? null, part:part ?? null, material:material ?? null };
    }

    const data = { count,opacity,strongest,opaque,proxy,pairs,
      cost: () => ({ projectedRows:projected.size,pixelTests }),
      truncated: () => truncated,
      focus() {
        let transmission = 1;
        const layers = [];
        for (let offset=0; offset<Math.min(focusDraws,focusLimit); offset++) {
          const hit = focus[(focusDraws-offset-1)%focusLimit];
          if (hit.splat) layers.push({ ...hit.splat, alpha:hit.alpha, depth:hit.depth, visibleCoverage:transmission*hit.alpha });
          transmission *= 1-hit.alpha;
        }
        return { layers, truncated:focusDraws>focusLimit };
      }
    };
    frames.push(data);
    return {
      project(row, left, low, right, high) {
        const nx = Math.min(right,x+width-1)-Math.max(left,x)+1;
        const ny = Math.min(high,bottom+height-1)-Math.max(low,bottom)+1;
        if (nx <= 0 || ny <= 0 || !SplatFit.paintable(backing,row)) return;
        projected.add(row);
        pixelTests += nx*ny;
      },
      cull(pixel, row, byProxy = false) {
        if (!projected.has(row)) return;
        const p = index(pixel);
        if (p >= 0) (byProxy ? proxy : opaque)[p]++;
      },
      fragment(pixel, row, depth, alpha, surface) {
        const splat = !surface && projected.has(row);
        if (pixel === focusPixel) focus[focusDraws++%focusLimit] = { alpha,depth,...(splat && {splat:describe(row)}) };
        if (!splat) return;
        const p = index(pixel);
        if (p < 0) return;
        count[p]++;
        opacity[p] += (1-opacity[p])*alpha;
        strongest[p] = Math.max(strongest[p],alpha);
        if (truncated) return;
        pairs.add(source(row)*size+p);
        if (pairs.size > pairLimit) {
          truncated = true;
          pairs.clear();
        }
      }
    };
  }

  function compare(before, after) {
    if (frames.length !== 2 || [before,after].some(frame => frame.w !== w || frame.h !== h ||
        frame.passes?.coverage?.length !== w*h))
      throw new RangeError('Splat diagnostics needs two matching native raster captures with scene coverage');
    const [a,b] = frames, pairTracking = [a,b].some(frame => frame.truncated()) ? 'truncated' : 'complete';
    const removed = new Uint32Array(size), added = new Uint32Array(size);
    const removedAt = [], addedAt = [], focusIndex = at ? (at[1]-y)*width+at[0]-x : -1;
    if (pairTracking === 'complete') {
      difference(a.pairs,b.pairs,removed,removedAt);
      difference(b.pairs,a.pairs,added,addedAt);
    }
    function difference(left,right,counts,focused) {
      for (const key of left) if (!right.has(key)) {
        const p = key%size;
        counts[p]++;
        if (p === focusIndex && focused.length < focusLimit) focused.push(sources[Math.floor(key/size)]);
      }
    }

    const exterior = exposed(after.passes.coverage,w,h,coverageThreshold);
    const summary = { overlapPixels:0, buildupPixels:0, uncoveredPixels:0, holePixels:0,
      removedFragments:pairTracking === 'complete' ? 0 : null, addedFragments:pairTracking === 'complete' ? 0 : null };
    const findings = [], examplePixels = {}, costs = frames.map(frame => ({ ...frame.cost(), fragments:0, peakFragments:0, opaqueRejected:0, proxyRejected:0 }));
    const lanes = frames.map((frame,index)=>[frame,costs[index]]);
    let findingCount = 0, inspected;
    for (let p=0; p<size; p++) {
      const px = x+p%width, py = y+Math.floor(p/width), full = py*w+px;
      for (const [frame,cost] of lanes) {
        cost.fragments += frame.count[p];
        cost.peakFragments = Math.max(cost.peakFragments,frame.count[p]);
        cost.opaqueRejected += frame.opaque[p];
        cost.proxyRejected += frame.proxy[p];
      }
      const overlap = b.count[p]>1;
      const buildup = overlap && b.opacity[p]-b.strongest[p]>=buildupThreshold;
      const uncovered = a.count[p]>0 && before.passes.coverage[full]>=coverageThreshold && after.passes.coverage[full]<coverageThreshold;
      const hole = uncovered && !exterior[full];
      if (overlap) summary.overlapPixels++;
      if (buildup) summary.buildupPixels++;
      if (uncovered) summary.uncoveredPixels++;
      if (hole) summary.holePixels++;
      if (pairTracking === 'complete') {
        summary.removedFragments += removed[p];
        summary.addedFragments += added[p];
      }
      const kinds = [overlap && 'overlap', buildup && 'opacity-buildup', removed[p]>0 && 'removed',
        uncovered && (hole ? 'hole' : 'uncovered'), b.opaque[p]>0 && 'depth-rejected',
        b.proxy[p]>0 && 'proxy-rejected'].filter(Boolean);
      if (kinds.length) findingCount++;
      for (const kind of kinds) examplePixels[kind] ??= [px,py];
      if (!(kinds.length && findings.length<limit) && p!==focusIndex) continue;
      const sample = (frame, image) => ({ fragments:frame.count[p], opacity:frame.opacity[p],
        strongestOpacity:frame.strongest[p], coverage:image.passes.coverage[full],
        opaqueRejected:frame.opaque[p], proxyRejected:frame.proxy[p] });
      const entry = { at:[px,py], kinds, before:sample(a,before), after:sample(b,after),
        ...(pairTracking === 'complete' && { removedFragments:removed[p], addedFragments:added[p] }) };
      if (kinds.length && findings.length<limit) findings.push(entry);
      if (p===focusIndex) inspected = { ...entry, before:{ ...entry.before,...a.focus() }, after:{ ...entry.after,...b.focus() },
        ...(pairTracking === 'complete' && { removed:removedAt, added:addedAt,
          fragmentListTruncated:removed[p]>removedAt.length || added[p]>addedAt.length }) };
    }
    return { format:'ink-studio/splat-edit-diagnostics', version:1, grid:[w,h], rect:[...rect], coverageThreshold,buildupThreshold,
      pairTracking, summary, cost:{ before:costs[0],after:costs[1] }, findingCount, examplePixels,
      findings, truncated:findingCount>findings.length, ...(inspected && { inspected }) };
  }
  return { capture, compare };
}

// Flood the low-coverage pixels from the native image border, including outside the requested region.
function exposed(coverage,w,h,threshold) {
  const outside = new Uint8Array(w*h), queue = new Uint32Array(w*h);
  let count = 0;
  function visit(i) {
    if (outside[i] || coverage[i]>=threshold) return;
    outside[i] = 1;
    queue[count++] = i;
  }
  for (let x=0; x<w; x++) {
    visit(x);
    visit((h-1)*w+x);
  }
  for (let y=1; y<h-1; y++) {
    visit(y*w);
    visit((y+1)*w-1);
  }
  for (let n=0; n<count; n++) {
    const p = queue[n], x = p%w;
    if (x>0) visit(p-1);
    if (x+1<w) visit(p+1);
    if (p>=w) visit(p-w);
    if (p+w<w*h) visit(p+w);
  }
  return outside;
}

function viewOptions(w,h,time,view) {
  ViewSource.grid(w,h);
  if (!Number.isFinite(time) || time<0) throw new RangeError('Splat review time must be finite and nonnegative');
  return { ...(typeof view==='function' ? view() : view),w,h,px:1,t:time,renderGrid:false,renderGraph:false,
    cameraGuides:false,inspection:false,shutter:false,composite:false,transparent:true };
}

function reviewSplatEdit(world, {
  width = 160, height = 96, before = false, after = world.look?.splatFit,
  time = world.lookSnapshot?.time ?? 0, view, ...settings
} = {}) {
  const trace = setup(width,height,settings), { render } = require('./render.js');
  const options = { ...viewOptions(width,height,time,view), passes:['coverage'], [scope]:trace.capture };
  const a = render(world,{ ...options, splatFit:before ?? false });
  const b = render(world,{ ...options, splatFit:after ?? false });
  return { ...trace.compare(a,b), time };
}

module.exports = { scope, setup, viewOptions, reviewSplatEdit };
