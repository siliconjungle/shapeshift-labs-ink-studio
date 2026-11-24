/* Resolve coordinates only in the representation that produced each native raster hit. */
const PixelSourceBindings = (() => {
  const lanes = 4;
  const point = (plane,p,n) => plane && Array.from(plane.subarray(p*n,(p+1)*n));
  const sameGrid = (a,b) => a[0] === b[0] && a[1] === b[1];

  function sample(frame,at,ArtPasses,surface) {
    const { passes } = frame;
    if (!passes) return null;
    const p = at[1]*frame.w+at[0];
    const entry = passes.surfaceSources?.[passes.sourceSurface?.[p]];
    const { triangles,...source } = entry ?? {};
    const triangle = passes.sourceTriangle?.[p];
    const coordinates = point(passes.sourceCoordinates,p,3);
    if (surface === undefined && passes.depth && passes.surfaceKind && passes.position)
      surface = ArtPasses.pick(passes,...at);
    let geometry = null;
    if (surface && source.kind === 'sdf' && coordinates?.every(Number.isFinite)) {
      geometry = { ...source,local:coordinates,rest:surface.restPosition,material:surface.material,
        depth:surface.depth,coverage:surface.coverage };
    } else if (surface?.kind === 'mesh' && (source.kind === 'mesh' || surface.uv)) {
      geometry = { kind:'mesh',object:surface.object,part:surface.part,...source,
        material:surface.material,depth:surface.depth,coverage:surface.coverage,uv:surface.uv,rest:surface.restPosition,
        ...(entry && coordinates?.every(Number.isFinite) && {
          triangle,barycentric:coordinates,...(triangles?.[triangle] && { revision:triangles[triangle] })
        }) };
    } else if (surface?.kind === 'sprite' && source.kind === 'sprite' && vector(coordinates,3)) {
      geometry = { ...source,local:coordinates,material:surface.material,depth:surface.depth,coverage:surface.coverage };
    }

    const splats = [], omitted = passes.sourceSplatOmitted?.[p];
    const frontRank = passes.sourceSplatFrontRank?.[p];
    for (let i=p*lanes; i<(p+1)*lanes; i++) {
      const slot = passes.sourceSplat?.[i], handle = passes.splatSources?.[slot];
      if (!handle) continue;
      splats.push({ kind:'splat',...handle,slot,depth:passes.sourceSplatDepth[i],alpha:passes.sourceSplatAlpha[i],
        visibleCoverage:passes.sourceSplatWeight[i],...(frontRank === i-p*lanes+1 && { frontmost:true }) });
    }
    if (frontRank === lanes+1) {
      const slot = passes.sourceSplatFront?.[p], handle = passes.splatSources?.[slot];
      const metrics = point(passes.sourceSplatFrontMetrics,p,3);
      if (handle && metrics) {
        const [alpha,depth,visibleCoverage] = metrics;
        splats.push({ kind:'splat',...handle,slot,alpha,depth,visibleCoverage,frontmost:true });
      }
    }
    let truncated = omitted > 1e-6;
    const pinned = frame.pixelFragments?.x === at[0] && frame.pixelFragments?.y === at[1];
    if (omitted === undefined && pinned) {
      truncated = frame.pixelFragments.truncated;
      for (const hit of frame.pixelFragments.hits) {
        if (hit.kind !== 'splat' && hit.kind !== 'glass') continue;
        const { identity,object,part,material,depth,alpha,visibleCoverage } = hit;
        splats.push({ kind:'splat',id:identity ?? null,slot:hit.splatId,object,part,material,depth,alpha,visibleCoverage });
      }
    }
    if (!geometry && omitted === undefined && !pinned) return null;
    if (surface?.kind === 'splat' && passes.splatId?.[p]) {
      const owner = splats.find(hit=>hit.renderRow === passes.splatId[p]-1);
      if (owner && vector(surface.restPosition,3)) Object.assign(owner,{ opaqueOwner:true,rest:surface.restPosition });
    }
    const complete = omitted === undefined ? pinned && !truncated : omitted === 0;
    const frontSplat = splats.find(hit=>hit.frontmost) ?? (frontRank === undefined && complete ?
      splats.reduce((nearest,hit)=>!nearest || hit.depth < nearest.depth ? hit : nearest,null) : null);
    return { geometry,splats,frontSplat,omittedCoverage:omitted ?? null,truncated };
  }

  const minimum = 1e-6;
  const named = value => typeof value === 'string' && !!value.trim();
  const vector = (value,n)=>value?.length === n && value.every(Number.isFinite);
  function addressable(hit) {
    if (!hit) return false;
    if (hit.kind === 'splat') return named(hit.id);
    if (!named(hit.object) && !named(hit.entity)) return false;
    return ['sdf','sprite'].includes(hit.kind) ? vector(hit.local,3) :
      hit.kind === 'mesh' && (vector(hit.uv,2) || Number.isSafeInteger(hit.triangle) && vector(hit.barycentric,3));
  }
  const matches = (binding,hit) => hit && (hit.object === binding.object || hit.entity === binding.object) &&
    (binding.part === undefined || hit.part === binding.part);

  const mappedKinds = ['mesh','sdf','splat','sprite'];
  const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;

  function registeredMapping(mapping) {
    if (!record(mapping) || Object.keys(mapping).some(key=>!['version','id','tolerance','sources'].includes(key)) ||
        mapping.version !== 1 || typeof mapping.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(mapping.id) ||
        !Number.isFinite(mapping.tolerance) || mapping.tolerance <= 0 || !record(mapping.sources)) return false;
    const sources = Object.entries(mapping.sources);
    return sources.length >= 2 && sources.every(([kind,transform])=>{
      if (!mappedKinds.includes(kind)) return false;
      if (transform === true) return true;
      if (!Array.isArray(transform) || transform.length !== 12 || !Array.from(transform).every(Number.isFinite)) return false;
      const [a,b,c,,d,e,f,,g,h,i] = transform;
      const determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
      return Number.isFinite(determinant) && determinant !== 0;
    });
  }

  function partPoint(mapping,hit,rest) {
    const transform = mapping?.sources?.[hit.kind];
    const point = rest ?? (hit.kind === 'sprite' ? hit.local : hit.rest);
    if (!transform || !vector(point,3)) return null;
    if (transform === true) return point.slice();
    const mapped = [0,4,8].map(row=>point.reduce((sum,n,i)=>sum+n*transform[row+i],transform[row+3]));
    return vector(mapped,3) ? mapped : null;
  }

  function issues(frame,at,ArtPasses,{ surface,sources,binding } = {}) {
    const { passes } = frame;
    if (!passes) return [];
    const p = at[1]*frame.w+at[0], output = [];
    const evidence = frame.bindingEvidence;
    if (binding && (!evidence || evidence.object !== binding.object || evidence.part !== binding.part ||
        !(evidence.projected[p] > minimum))) return output;
    if (surface === undefined && passes.depth && passes.surfaceKind && passes.position)
      surface = ArtPasses.pick(passes,...at);
    if (sources === undefined) sources = sample(frame,at,ArtPasses,surface);
    const splats = sources?.splats ?? [], geometry = sources?.geometry;
    const frontSurface = surface && { ...surface,entity:geometry?.entity ?? passes.parts?.[passes.partId?.[p]]?.entity };
    if (!binding) {
      const unique = new Set(splats.map(hit=>hit.id ?? hit.slot ?? hit));
      const unnamed = splats.some(hit=>!addressable(hit));
      const hasSurface = frontSurface && frontSurface.kind !== 'splat';
      const count = unique.size+Number(!!hasSurface);
      if (count > 1) output.push({ kind:'overlap',code:'overlapping-sources',count });
      if (frontSurface?.kind === 'splat' && !splats.length)
        output.push({ kind:'unreliable',code:'splat-contributors-unavailable' });
      if (unnamed) output.push({ kind:'unreliable',code:'unstable-splat-id' });
      if (hasSurface && !addressable(geometry))
        output.push({ kind:'unreliable',code:'surface-address-unavailable',representation:frontSurface.kind ?? null });
      if (sources?.truncated) output.push({ kind:'unreliable',code:'contributors-omitted',coverage:sources.omittedCoverage });
      if (!frontSurface && !splats.length && !sources?.truncated && passes.coverage?.[p] > minimum)
        output.push({ kind:'unreliable',code:'covered-pixel-without-source' });
      return output;
    }
    const projected = evidence.projected[p], visible = evidence.visible[p], depth = evidence.depth[p];
    if (visible + minimum < projected) {
      if (frontSurface && !matches(binding,frontSurface) && Number.isFinite(depth) && frontSurface.depth < depth-1e-5) {
        output.push({ kind:'blocker',code:'foreground-blocker',partial:visible > minimum,
          blocker:{ kind:frontSurface.kind ?? null,object:frontSurface.object ?? null,part:frontSurface.part ?? null,
            depth:frontSurface.depth },visibleCoverage:visible,projectedCoverage:projected,targetDepth:depth });
      } else if (visible <= minimum) output.push({ kind:'unreliable',code:'hidden-source-without-confirmed-blocker' });
    }
    if (visible > minimum && !(matches(binding,geometry) && addressable(geometry)) &&
        !splats.some(hit=>addressable(hit) && matches(binding,hit)))
      output.push({ kind:'unreliable',code:'binding-address-unavailable' });
    return output;
  }

  function validStale(runs,width,height) {
    if (!Array.isArray(runs)) return false;
    let previousY = -1, end = -1;
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 3 || !Array.from(run).every(Number.isSafeInteger)) return false;
      const [y,x,length] = run;
      if (y < 0 || y >= height || x < 0 || length < 1 || x+length > width ||
          y < previousY || y === previousY && x <= end) return false;
      previousY = y;
      end = x+length;
    }
    return true;
  }

  function staleAt(binding,[x,y]) {
    const runs = binding.stale;
    if (!runs?.length) return false;
    let lo = 0, hi = runs.length;
    while (lo < hi) {
      const mid = Math.floor((lo+hi)/2), [row,left,length] = runs[mid];
      if (row < y || row === y && left+length <= x) lo = mid+1;
      else hi = mid;
    }
    const run = runs[lo];
    return !!run && run[0] === y && run[1] <= x;
  }

  function resolve(frame,binding,at,{ grid,frameId,layerId,sceneMatches,sourcePoint,ArtPasses }) {
    const { id,object,part,canvas } = binding;
    const result = { id,object,part:part ?? null };
    if (!sceneMatches) return { ...result,status:'wrong-scene' };
    if (binding.frame !== undefined && frameId !== binding.frame) return { ...result,status:'wrong-frame' };
    if (binding.layer !== undefined && layerId !== undefined && layerId !== binding.layer)
      return { ...result,status:'wrong-layer' };
    if (!sameGrid(canvas?.size ?? grid,[frame.w,frame.h])) return { ...result,status:'grid-mismatch' };
    const mapped = sourcePoint(grid,at,canvas);
    if (!mapped) return { ...result,status:'outside-bound-canvas' };
    const sourceAt = mapped.map(Math.floor);
    if (staleAt(binding,at)) return { ...result,sourceAt,status:'stale',hits:[] };
    const evidence = sample(frame,sourceAt,ArtPasses);
    if (!evidence) return { ...result,sourceAt,status:'source-unavailable' };
    const hits = [evidence.geometry,...evidence.splats].filter(hit=>matches(binding,hit));
    const diagnostics = issues(frame,sourceAt,ArtPasses,{ binding,sources:evidence });
    const blocked = diagnostics.some(issue=>issue.kind === 'blocker' && !issue.partial);
    const status = blocked ? 'occluded' : hits.some(addressable) ? 'resolved' :
      hits.some(hit=>hit.kind !== 'splat') || diagnostics.some(issue=>issue.kind === 'unreliable') ? 'unreliable-source' :
        hits.length ? 'unidentified-splat' : evidence.truncated ? 'truncated' : 'miss';
    const frontSplat = matches(binding,evidence.frontSplat) ? evidence.frontSplat : null;
    const points = binding.mapping && hits.flatMap(hit=>{
      const point = partPoint(binding.mapping,hit);
      return point ? [{ kind:hit.kind,point,...(hit.id && { source:hit.id }) }] : [];
    });
    return { ...result,sourceAt,status,hits,frontSplat,...(points?.length && { mapping:{ id:binding.mapping.id,points } }),omittedCoverage:evidence.omittedCoverage,truncated:evidence.truncated,...(diagnostics.length && { diagnostics }) };
  }

  return Object.freeze({ sample,resolve,issues,registeredMapping,partPoint,validStale,staleAt });
})();
if (typeof module !== 'undefined') module.exports = PixelSourceBindings;
