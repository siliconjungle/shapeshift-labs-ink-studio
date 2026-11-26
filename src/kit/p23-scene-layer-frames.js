/* Rest-space layer measurements and placement-independent module origins. */
(function (K) {
  const A = K.authoring, {V} = K;

  function envelope() {
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    return {
      add(point) {
        for (let i=0; i<3; i++) {
          min[i] = Math.min(min[i],point[i]);
          max[i] = Math.max(max[i],point[i]);
        }
      },
      bounds() { return Number.isFinite(min[0]) ? {min,max} : null; }
    };
  }

  const center = box => box ? V.lerp(box.min,box.max,.5) : null;

  function measure(scene,env,expanded,ids) {
    const {spec,instances,meshPlacements} = expanded;
    const solidIds = ids.flatMap(id=>instances.get(id).solids);
    const solids = solidIds.length ? K.diorama.solidBounds(scene,solidIds,env) : new Map();
    const evaluate = A.meshTopologyScene.evaluator(spec.topologyMeshes ?? {},meshPlacements);
    const geometry = envelope(), origins = envelope(), unavailable = [], modules = [];
    for (const id of ids) {
      const link = instances.get(id), area = envelope(), members = [];
      for (const solid of link.solids) {
        const result = solids.get(solid);
        if (!result) continue;
        members.push({object:solid,kind:'solid',...result});
        if (result.bounds) {
          area.add(result.bounds.min);
          area.add(result.bounds.max);
        } else unavailable.push(solid);
      }
      for (const {object} of link.meshes.values()) {
        const {document} = evaluate(object), frame = meshPlacements.get(object);
        const used = new Set(document.faces.flatMap(face=>face.corners.map(row=>row.vertex)));
        const mesh = envelope();
        for (const vertex of document.vertices) if (used.has(vertex.id))
          mesh.add(frame ? K.sceneGraph.point(frame,vertex.position) : vertex.position);
        const bounds = mesh.bounds();
        if (!bounds) continue;
        area.add(bounds.min);
        area.add(bounds.max);
        members.push({object,kind:'mesh',bounds,method:'evaluated-vertices'});
      }
      const bounds = area.bounds();
      if (bounds) {
        geometry.add(bounds.min);
        geometry.add(bounds.max);
      }
      origins.add(link.origin);
      modules.push({instance:id,origin:link.origin,localOrigin:(link.instance.origin ?? [0,0,0]).slice(),
        bounds,center:center(bounds),complete:members.every(row=>row.bounds),members});
    }
    const bounds = geometry.bounds(), originBounds = origins.bounds();
    return {space:'world-rest',bounds,center:center(bounds),originBounds,originCenter:center(originBounds),
      complete:!unavailable.length,unavailable,modules};
  }

  function originTarget(scene,env,target,measurement) {
    const {record} = K.world.data;
    const {kind,position} = target ?? {};
    if (kind==='object-point') {
      const {target:point} = A.objectPoints.resolve(scene,env,target);
      return () => point;
    }
    if (!record(target) || Object.keys(target).some(key=>key!=='kind' && !(kind==='point' && key==='position')))
      throw new TypeError('Choose module-center, layer-center, plane, point, or a named object point');
    if (kind==='point' && meshPivot.xyz(position)) return () => position;
    if (kind==='plane') {
      const point = A.constructionPlane.forScene(scene).plane.origin;
      return () => point;
    }
    if (kind==='layer-center') return () => measurement.complete && measurement.center;
    if (kind==='module-center') return module => module.complete && module.center;
    throw new TypeError('Choose module-center, layer-center, plane, point, or a named object point');
  }

  function plan(scene,env,request,expanded,measurement) {
    const {action,layer,basis='bounds',detachEdge,target} = request;
    const {equal} = K.world.data;
    if (action==='center') {
      if (!['bounds','origins'].includes(basis) || detachEdge !== undefined && typeof detachEdge !== 'boolean')
        throw new TypeError('Center the construction frame on bounds or origins and optionally detach its edge');
      const point = basis==='origins' ? measurement.originCenter : measurement.complete && measurement.center;
      if (!point) return {conflicts:[{reason:'no-finite-layer-center',basis}]};
      const snap = A.constructionPlane.snapTo(scene,{kind:'scene-layer',layer,basis,target:point},{detachEdge});
      const changed = !equal(snap.plane,A.constructionPlane.resolve(scene.constructionPlane).plane);
      return {changed,patch:changed ? {constructionPlane:snap.plane} : {},
        frame:{before:A.constructionPlane.resolve(scene.constructionPlane).plane,after:snap.plane,basis,target:point}};
    }

    const locate = originTarget(scene,env,target,measurement), instances = {...scene.instances};
    const conflicts = [], origins = [], edited = new Set();
    if (!measurement.modules.length) conflicts.push({reason:'empty-layer-population'});
    for (const module of measurement.modules) {
      const {instance} = module, placement = expanded.instances.get(instance);
      if (placement.mirror) {
        conflicts.push({reason:'commit-live-mirror-first',instance,source:placement.mirror.source});
        continue;
      }
      const point = locate(module);
      if (!point) {
        conflicts.push({reason:'no-finite-origin-target',instance});
        continue;
      }
      const local = placement.placement ? K.diorama.solidFrames.inverse(placement.placement).point(point) : point.slice();
      const after = A.scenePrefabs.placedOrigin({origin:local},placement.placement);
      if (!meshPivot.xyz(local) || !meshPivot.xyz(after) || V.dist(after,point)>1e-8*Math.max(1,...point.map(Math.abs))) {
        conflicts.push({reason:'origin-target-out-of-range',instance});
        continue;
      }
      const changed = V.dist(module.localOrigin,local)>1e-10;
      if (changed) {
        instances[instance] = {...instances[instance],origin:local};
        edited.add(instance);
      }
      origins.push({instance,before:module.origin,after:changed ? after : module.origin,
        local:changed ? local : module.localOrigin,changed});
    }
    for (const [id,link] of expanded.instances) if (link.mirror && edited.has(link.mirror.source)) {
      origins.push({instance:id,source:link.mirror.source,before:link.origin,
        after:A.scenePrefabs.placedOrigin(instances[link.mirror.source],link.placement),changed:true});
    }
    const changed = edited.size>0;
    return {changed,origins,conflicts,...(!conflicts.length && {patch:changed ? {instances} : {}})};
  }

  A.sceneLayerFrames = Object.freeze({measure,plan});
})(KIT);
