// Surface addresses shared by mesh, field and registered scan patch proposals.
const retopologySurface = (function(K) {
  const {V,procedural:P}=K, S=meshBooleanSurfaces;
  const {record,xyz,id,finite}=retopologyGuides;
  const vector=(raw,label)=>{
    if (!xyz(raw) || V.len(raw)<1e-8) throw new TypeError(label+' needs a nonzero XYZ direction');
    return V.norm(raw);
  };

  function settings(raw) {
    if (!record(raw,['maxDistance','direction','normal','minFacing','tolerance','pinTolerance','guideTolerance','maxDeviation']))
      throw new TypeError('Use retopology projection settings');
    const {maxDistance,direction,normal,minFacing=.12,tolerance=Math.min(1e-5,maxDistance*.001),
      pinTolerance=maxDistance,guideTolerance=maxDistance*.5,maxDeviation}=raw;
    if (!finite(maxDistance,1e-6,1e4) || !finite(tolerance,1e-9,maxDistance*.25) ||
        !finite(pinTolerance,tolerance,maxDistance) || !finite(guideTolerance,tolerance,maxDistance*2) ||
        !finite(minFacing,0,1) || maxDeviation!==undefined && !finite(maxDeviation,tolerance,maxDistance))
      throw new RangeError('Use bounded retopology snap, pin and guide distances and a facing cosine in [0, 1]');
    const along=direction===undefined ? null : vector(direction,'Projection direction');
    const facing=normal!==undefined ? vector(normal,'Surface normal') : along && V.mul(along,-1);
    return {maxDistance,along,facing,minFacing,tolerance,pinTolerance,guideTolerance,maxDeviation};
  }

  function prepare(api,doc,raw,options,context) {
    const {kind,object,part}=raw ?? {};
    if (!['mesh','sdf','scan-proxy'].includes(kind) || object!==undefined && !id(object) ||
        part!==undefined && (!id(part) || object===undefined))
      throw new TypeError('Choose a mesh, signed field, or registered scan proxy for retopology');
    const {along,facing,minFacing,tolerance}=options;
    const accepts=normal=>!facing || V.dot(normal,facing)>=minFacing;
    const label={kind,...(object!==undefined && {object}),...(part!==undefined && {part})};
    if (kind==='sdf') {
      if (!record(raw,['kind','object','volume']) || (object===undefined)===(raw.volume===undefined))
        throw new TypeError('A retopology field needs a named SDF or a box or sphere volume');
      const sample=raw.volume ? P.sculptMasks.field(raw.volume) : context.sdf?.(object);
      if (typeof sample!=='function') throw new RangeError('No signed form for retopology: '+object);
      const normalAt=point=>SdfDetailChart.normalAt(sample,point,Math.max(tolerance,1e-6));
      return {label,project(seed,maxDistance) {
        if (along) {
          const step=tolerance+maxDistance/48;
          const refinements=Math.max(12,Math.ceil(Math.log2(step/tolerance))+3);
          const roots=SdfDetailChart.roots(sample,seed,along,-maxDistance-tolerance,maxDistance,step,tolerance*.05,refinements);
          for (const {height} of roots) {
            if (Math.abs(height)>maxDistance) continue;
            const point=V.mad(seed,along,height), normal=normalAt(point);
            if (V.len(normal)>.99 && accepts(normal))
              return {point,normal,distance:Math.abs(height),residual:sample(...point)};
          }
          return null;
        }
        let hit;
        try { hit=meshComponentSnap.snapField({maxDistance,tolerance},seed,sample); }
        catch (error) { if (error instanceof RangeError) return null; throw error; }
        const normal=normalAt(hit.point);
        return V.len(normal)>.99 && accepts(normal) ? {...hit,normal,distance:V.dist(hit.point,seed)} : null;
      }};
    }
    if (!record(raw,['kind','document','object','part','revision']) ||
        raw.document!==undefined && object!==undefined || kind==='scan-proxy' && raw.document===undefined && object===undefined)
      throw new TypeError('Use a topology document or named editable reference mesh');
    const resolved=object!==undefined ? context.mesh?.(object,part) : raw.document ?? doc;
    if (!resolved) throw new RangeError('No retained retopology mesh '+object);
    const surface=api.create(resolved), revision=api.revision(surface);
    if (raw.revision!==undefined && raw.revision!==revision) throw new RangeError('Stale retopology reference revision');
    const mesh=S.input(api,surface,undefined,kind);
    if (mesh.triangles.length>40000) throw new RangeError('The retopology reference exceeds 40000 triangles');
    const closest=!along && S.nearest(mesh.triangles);
    const trace=along && meshBooleanDiagnostics.raycast(mesh.triangles,tolerance);
    return {label:{...label,mesh:surface.id,revision},project(seed,maxDistance) {
      let hit;
      if (trace) {
        const envelope=maxDistance+tolerance;
        const origin=V.mad(seed,along,-envelope);
        const ray=trace(origin,along,envelope+maxDistance,row=>accepts(row.normal))
          .find(row=>Math.abs(row.t-envelope)<=maxDistance+tolerance*.1);
        if (ray) {
          const at=V.mad(origin,along,ray.t), {row}=ray;
          hit={at,row,weights:P.geometry.closestTrianglePoint(at,row).weights,distance:Math.abs(ray.t-envelope)};
        }
      } else hit=closest(seed,maxDistance,row=>accepts(row.normal));
      if (!hit || hit.distance>maxDistance+tolerance*.1) return null;
      return {point:hit.at,normal:hit.row.normal,distance:hit.distance,face:hit.row.source.id,
        triangle:hit.row.attributes.map(row=>row.id),barycentric:hit.weights};
    }};
  }

  return {settings,prepare};
})(KIT);
