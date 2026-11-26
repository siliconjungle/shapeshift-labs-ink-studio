/* Place linked visual prefab instances on the retained construction plane. */
(function (K) {
  const A = K.authoring, {M,V} = K;
  const {freeze} = K.procedural.data;
  const fields = ['prefab','id','at','point','target','anchor','count','step','orientation','angle','normalOffset','snapGrid','rounding'];
  const coordinates = (value,length) =>
    Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);

  function plan(scene, request, env) {
    const {id:validId,own} = K.world.data;
    const {prefab,id,at,point,target,anchor,count=1,step,orientation='plane',angle=0,normalOffset=0,
      snapGrid=target === undefined,rounding} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !fields.includes(key)) || ![prefab,id].every(validId) ||
        (target !== undefined ? at !== undefined || point !== undefined || count!==1 || step !== undefined ||
          normalOffset!==0 || snapGrid : point === undefined ? !coordinates(at,2) : at !== undefined || !coordinates(point,3)) ||
        anchor !== undefined && !validId(anchor) && (!K.world.data.record(anchor) ||
          Object.keys(anchor).some(key => !['member','id'].includes(key)) || ![anchor.member,anchor.id].every(validId)) ||
        !Number.isSafeInteger(count) || count < 1 || count > 512 ||
        (step === undefined ? count > 1 : !coordinates(step,2) || count > 1 && !step.some(Boolean)) ||
        !['plane','world'].includes(orientation) || ![angle,normalOffset].every(Number.isFinite) ||
        typeof snapGrid !== 'boolean' || rounding !== undefined && (!snapGrid || !['nearest','floor','ceiling'].includes(rounding)))
      throw new TypeError('Stamp a named prefab at a plane address or world point with valid spacing, orientation and rounding');

    const plane = A.constructionPlane, frame = plane.forScene(scene);
    const roundFrame = rounding === undefined ? frame : {...frame,plane:{...frame.plane,rounding}};
    const resolved = target === undefined ? undefined : A.objectPoints.resolve(scene,env,target);
    const first = resolved ? plane.project(frame,resolved.target).gridAt : point === undefined ? at : plane.project(frame,point).gridAt;
    const spacing = step ?? [0,0], worldMagnitude = Math.max(...frame.plane.origin.map(Math.abs),...(point ?? []).map(Math.abs));
    const basis = M.mul(orientation === 'plane' ? M.tr(frame.axes.flat()) : M.id(),
      M.rot([0,0,1],(angle % 360)*Math.PI/180));
    const definitions = scene.prefabs ?? {}, library = env.prefabs ?? {};
    const definition = own(definitions,prefab) ? definitions[prefab] : own(library,prefab) ? library[prefab] : null;
    const existing = scene.instances ?? {}, conflicts = [], placements = [], instances = {};
    if (!definition) conflicts.push({kind:'unknown-prefab',prefab});
    const member = typeof anchor === 'object' && anchor !== null ? anchor.member : undefined;
    const pointId = member === undefined ? anchor : anchor.id;
    const catalog = A.objectPoints.read(member === undefined ? definition?.points : definition?.topologyMeshes?.[member]?.points);
    const local = own(catalog,pointId) ? A.objectPoints.transform(catalog[pointId],definition?.meshFrames?.[member]).position : undefined;
    if (anchor !== undefined && definition && !local) conflicts.push({kind:'unknown-prefab-point',anchor});
    const visited = new Map();
    for (let index=0; index<count; index++) {
      const instance = count === 1 ? id : id+'.'+index;
      const address = first.map((value,axis) => value+index*spacing[axis]);
      const gridAt = snapGrid ? plane.quantize(roundFrame,address,worldMagnitude) : address;
      const stage = resolved?.target ?? V.mad(plane.point(frame,gridAt),frame.axes[2],normalOffset);
      const position = local ? V.sub(stage,M.app(basis,local)) : stage;
      if (!coordinates(position,3)) throw new RangeError('Prefab placement exceeds world coordinate bounds');
      const key = JSON.stringify(position), previous = visited.get(key);
      if (!validId(instance)) conflicts.push({kind:'invalid-instance-id',instance});
      if (own(existing,instance)) conflicts.push({kind:'instance-in-use',instance});
      if (previous !== undefined) conflicts.push({kind:'repeated-position',instance,previous,gridAt});
      else visited.set(key,instance);
      const transform = K.diorama.solidFrames.transform({basis,scale:1,mesh:{position}});
      instances[instance] = {prefab,transform};
      placements.push({instance,at:address,gridAt,transform,...(local && {anchorAt:stage})});
    }
    const report = freeze({format:'ink-studio/prefab-stamp',version:1,id,prefab,
      ...(definition && {prefabRevision:definition.revision}),constructionPlane:frame.plane,
      ...(point !== undefined && {point:point.slice()}),...(resolved && {target:resolved}),
      ...(local && {anchor:{id:pointId,...(member && {member}),local}}),at:first.slice(),count,step:spacing.slice(),
      orientation,angle,normalOffset,snapGrid,
      ...(snapGrid && {rounding:roundFrame.plane.rounding ?? 'nearest'}),
      placements,conflicts,canCommit:!conflicts.length});
    return conflicts.length ? {report} : {instances,report};
  }

  A.prefabStamp = Object.freeze({plan});
})(KIT);
