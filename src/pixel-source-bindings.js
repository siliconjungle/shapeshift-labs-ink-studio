/* Resolve coordinates only in the representation that produced each native raster hit. */
const PixelSourceBindings = (() => {
  const lanes = 4;
  const point = (plane,p,n) => plane && Array.from(plane.subarray(p*n,(p+1)*n));
  const sameGrid = (a,b) => a[0] === b[0] && a[1] === b[1];

  function sample(frame,at,ArtPasses,surface) {
    const { passes } = frame;
    if (!passes) return null;
    const p = at[1]*frame.w+at[0];
    const source = passes.surfaceSources?.[passes.sourceSurface?.[p]];
    const coordinates = point(passes.sourceCoordinates,p,3);
    if (surface === undefined && passes.depth && passes.surfaceKind && passes.position)
      surface = ArtPasses.pick(passes,...at);
    let geometry = null;
    if (surface && source?.kind === 'sdf' && coordinates?.every(Number.isFinite)) {
      geometry = { ...source,local:coordinates,rest:surface.restPosition,material:surface.material,
        depth:surface.depth,coverage:surface.coverage };
    } else if (surface?.kind === 'mesh' && (source?.kind === 'mesh' || surface.uv)) {
      geometry = { kind:'mesh',object:surface.object,part:surface.part,...source,
        material:surface.material,depth:surface.depth,coverage:surface.coverage,uv:surface.uv,
        ...(source && coordinates?.every(Number.isFinite) && {
          triangle:passes.sourceTriangle[p],barycentric:coordinates
        }) };
    }

    const splats = [], omitted = passes.sourceSplatOmitted?.[p];
    const frontRank = passes.sourceSplatFrontRank?.[p];
    for (let i=p*lanes; i<(p+1)*lanes; i++) {
      const handle = passes.splatSources?.[passes.sourceSplat?.[i]];
      if (!handle) continue;
      splats.push({ kind:'splat',...handle,depth:passes.sourceSplatDepth[i],alpha:passes.sourceSplatAlpha[i],
        visibleCoverage:passes.sourceSplatWeight[i],...(frontRank === i-p*lanes+1 && { frontmost:true }) });
    }
    if (frontRank === lanes+1) {
      const handle = passes.splatSources?.[passes.sourceSplatFront?.[p]];
      const metrics = point(passes.sourceSplatFrontMetrics,p,3);
      if (handle && metrics) {
        const [alpha,depth,visibleCoverage] = metrics;
        splats.push({ kind:'splat',...handle,alpha,depth,visibleCoverage,frontmost:true });
      }
    }
    let truncated = omitted > 1e-6;
    const pinned = frame.pixelFragments?.x === at[0] && frame.pixelFragments?.y === at[1];
    if (omitted === undefined && pinned) {
      truncated = frame.pixelFragments.truncated;
      for (const hit of frame.pixelFragments.hits) {
        if (hit.kind !== 'splat' && hit.kind !== 'glass') continue;
        const { identity,object,part,material,depth,alpha,visibleCoverage } = hit;
        splats.push({ kind:'splat',id:identity ?? null,object,part,material,depth,alpha,visibleCoverage });
      }
    }
    if (!geometry && omitted === undefined && !pinned) return null;
    const complete = omitted === undefined ? pinned && !truncated : omitted === 0;
    const frontSplat = splats.find(hit=>hit.frontmost) ?? (frontRank === undefined && complete ?
      splats.reduce((nearest,hit)=>!nearest || hit.depth < nearest.depth ? hit : nearest,null) : null);
    return { geometry,splats,frontSplat,omittedCoverage:omitted ?? null,truncated };
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
    const evidence = sample(frame,sourceAt,ArtPasses);
    if (!evidence) return { ...result,sourceAt,status:'source-unavailable' };
    const matches = hit => hit && (hit.object === object || hit.entity === object) &&
      (part === undefined || hit.part === part);
    const hits = [evidence.geometry,...evidence.splats].filter(matches);
    const resolved = hits.some(hit=>hit.kind !== 'splat' || hit.id !== null);
    const status = resolved ? 'resolved' : hits.length ? 'unidentified-splat' : evidence.truncated ? 'truncated' : 'miss';
    const frontSplat = matches(evidence.frontSplat) ? evidence.frontSplat : null;
    return { ...result,sourceAt,status,hits,frontSplat,omittedCoverage:evidence.omittedCoverage,truncated:evidence.truncated };
  }

  return Object.freeze({ sample,resolve });
})();
if (typeof module !== 'undefined') module.exports = PixelSourceBindings;
