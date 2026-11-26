/* Review scene projectors and retained mesh attachments during prefab replacement. */
const prefabReplacementAnchors = (function (K) {
  const A = K.authoring, T = K.meshTopology, {V} = K;

  function attachments(before,after) {
    const {equal} = K.world.data;
    const rows = before.attachments?.attachments ?? [];
    if (!rows.length) return {evidence:[]};
    const source = T.create(before.document), target = T.create(after.document);
    const sourceRevision = T.revision(source), targetRevision = T.revision(target);
    const destination = after.attachments?.attachments ?? [];
    if (before.attachments.revision !== sourceRevision || after.attachments && after.attachments.revision !== targetRevision)
      return {evidence:[],issues:[{reason:'stale-attachment-manifest'}]};
    const existing = new Map(destination.map(row => [row.id,row]));
    const consumer = ({id,kind,node,socket,group,members}) => [id,kind,node,socket,group,members];
    const evidence = [], issues = [], missing = [];
    for (const row of rows) {
      const current = existing.get(row.id);
      if (!current) missing.push(row);
      else if (!equal(consumer(row),consumer(current))) issues.push({attachment:row.id,reason:'attachment-consumer-changed'});
      else evidence.push({id:row.id,status:'retained',before:row.anchor,after:current.anchor});
    }
    if (issues.length || !missing.length) return {evidence,issues};
    if (sourceRevision === targetRevision) {
      for (const row of missing) evidence.push({id:row.id,status:'transferred',before:row.anchor,after:row.anchor});
      return {evidence,manifest:T.attachments.create(target,[...destination,...missing])};
    }
    try {
      const map = T.correspond(source,target);
      const result = T.transferAttachments(source,target,map,{attachments:T.attachments.create(source,missing)});
      for (const row of result.report.attachments) evidence.push({id:row.id,status:'transferred',
        method:row.method,before:row.before,after:row.after,rest:row.rest});
      if (!result.report.canCommit || T.revision(result.document) !== targetRevision)
        return {evidence,issues:result.report.issues.length ? result.report.issues : [{reason:'transfer-needs-weight-review'}]};
      return {evidence,manifest:T.attachments.create(target,[...destination,...result.attachments.attachments])};
    } catch (error) {
      return {evidence,issues:[{reason:'attachment-transfer-needs-review',detail:error.message}]};
    }
  }

  function coverage(mesh,anchor) {
    if (anchor.uv) {
      const chart = anchor.chart;
      const clip = chart && {min:chart.min.map((n,k) => n+chart.padding[k]),max:chart.max.map((n,k) => n-chart.padding[k])};
      return K.sceneMeshes.clipUV(mesh,{...anchor.uv,face:anchor.face,material:anchor.material,clip,
        uvSet:anchor.uvSet ?? 'decal'}).triangles.length/3;
    }
    const project = K.sceneMeshes.projector(mesh,anchor,K), right = V.cross(anchor.up,anchor.normal);
    let hits = 0;
    for (const u of [-.33,0,.33]) for (const v of [-.33,0,.33])
      if (project(V.mad(V.mad(anchor.at,right,u*anchor.size[0]),anchor.up,v*anchor.size[1]))) hits++;
    return hits;
  }

  function decals(scene,before,after,addresses) {
    const rows = scene.surfaceDecals?.decals;
    if (!rows?.some(row => addresses.has(row.anchor.object))) return {evidence:[],conflicts:[]};
    const tilesets = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const prepared = expanded => new Map(A.meshTopologyScene.prepare(expanded.spec.topologyMeshes,tilesets,expanded.meshPlacements));
    let baseMeshes, nextMeshes;
    const solids = spec => new Map(spec.solids.map(row => [row.id,row]));
    const baseSolids = solids(before.spec), nextSolids = solids(after.spec);
    const evidence = [], conflicts = [];
    const normalized = new Map(K.surfaceDecals.create(scene.surfaceDecals).decals.map(row => [row.id,row.anchor]));
    let changed = false;
    const next = rows.map(decal => {
      const {anchor} = decal, address = addresses.get(anchor.object);
      if (!address) return decal;
      const {instance,object,part,face} = address;
      const mapped = {...anchor,object,...(anchor.part !== undefined && {part:part(anchor.part)}),
        ...(anchor.face !== undefined && {face:face(anchor.face)})};
      const result = {kind:'decal',id:decal.id,instance,before:anchor,after:mapped};
      try {
        if (Object.hasOwn(before.spec.topologyMeshes ?? {},anchor.object)) {
          baseMeshes ??= prepared(before);
          nextMeshes ??= prepared(after);
          const source = baseMeshes.get(anchor.object), target = nextMeshes.get(object);
          if (!target || mapped.part !== undefined && target.mesh.partId !== mapped.part)
            throw new RangeError('No compatible mesh receiver');
          if (mapped.face !== undefined && !target.document.faces.some(row => row.id === mapped.face))
            throw new RangeError('Named mesh face is missing');
          const projector = normalized.get(decal.id);
          const from = coverage(source.mesh,projector), to = coverage(target.mesh,{...projector,...mapped});
          result.coverage = {before:from,after:to,unit:anchor.uv ? 'clipped-triangles' : 'projector-hits'};
          if (from > 0 && to === 0) throw new RangeError('Decal footprint lost contact with the receiver');
        } else {
          const source = baseSolids.get(anchor.object), target = nextSolids.get(object);
          if (!source || !target || source.kind !== target.kind || mapped.part !== undefined && target.part !== mapped.part)
            throw new RangeError('No compatible solid receiver');
        }
        const moved = !K.world.data.equal(mapped,anchor);
        evidence.push({...result,status:moved ? 'remapped' : 'retained'});
        changed ||= moved;
        return moved ? {...decal,anchor:mapped} : decal;
      } catch (error) {
        evidence.push({...result,status:'conflict',reason:error.message});
        conflicts.push({instance,id:decal.id,reason:'decal-anchor-needs-review',detail:error.message});
        return decal;
      }
    });
    return {evidence,conflicts,document:changed ? {...scene.surfaceDecals,decals:next} : undefined};
  }

  return Object.freeze({attachments,decals});
})(KIT);
