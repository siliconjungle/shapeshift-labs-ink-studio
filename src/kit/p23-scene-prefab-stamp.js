/* Place linked visual prefab instances on the retained construction plane. */
(function (K) {
  const A = K.authoring, {M,V} = K;
  const {freeze} = K.procedural.data;
  const fields = ['prefab','id','at','point','count','step','orientation','angle','normalOffset','snapGrid','rounding'];
  const coordinates = (value,length) =>
    Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);

  function plan(scene, request, env) {
    const {id:validId,own} = K.world.data;
    const {prefab,id,at,point,count=1,step,orientation='plane',angle=0,normalOffset=0,
      snapGrid=true,rounding} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !fields.includes(key)) || ![prefab,id].every(validId) ||
        (point === undefined ? !coordinates(at,2) : at !== undefined || !coordinates(point,3)) ||
        !Number.isSafeInteger(count) || count < 1 || count > 512 ||
        (step === undefined ? count > 1 : !coordinates(step,2) || count > 1 && !step.some(Boolean)) ||
        !['plane','world'].includes(orientation) || ![angle,normalOffset].every(Number.isFinite) ||
        typeof snapGrid !== 'boolean' || rounding !== undefined && (!snapGrid || !['nearest','floor','ceiling'].includes(rounding)))
      throw new TypeError('Stamp a named prefab at a plane address or world point with valid spacing, orientation and rounding');

    const plane = A.constructionPlane, frame = plane.forScene(scene);
    const roundFrame = rounding === undefined ? frame : {...frame,plane:{...frame.plane,rounding}};
    const first = point === undefined ? at : plane.project(frame,point).gridAt;
    const spacing = step ?? [0,0], worldMagnitude = Math.max(...frame.plane.origin.map(Math.abs),...(point ?? []).map(Math.abs));
    const basis = M.mul(orientation === 'plane' ? M.tr(frame.axes.flat()) : M.id(),
      M.rot([0,0,1],(angle % 360)*Math.PI/180));
    const definitions = scene.prefabs ?? {}, library = env.prefabs ?? {};
    const definition = own(definitions,prefab) ? definitions[prefab] : own(library,prefab) ? library[prefab] : null;
    const existing = scene.instances ?? {}, conflicts = [], placements = [], instances = {};
    if (!definition) conflicts.push({kind:'unknown-prefab',prefab});
    const visited = new Map();
    for (let index=0; index<count; index++) {
      const instance = count === 1 ? id : id+'.'+index;
      const address = first.map((value,axis) => value+index*spacing[axis]);
      const gridAt = snapGrid ? plane.quantize(roundFrame,address,worldMagnitude) : address;
      const position = V.mad(plane.point(frame,gridAt),frame.axes[2],normalOffset);
      if (!coordinates(position,3)) throw new RangeError('Prefab placement exceeds world coordinate bounds');
      const key = JSON.stringify(position), previous = visited.get(key);
      if (!validId(instance)) conflicts.push({kind:'invalid-instance-id',instance});
      if (own(existing,instance)) conflicts.push({kind:'instance-in-use',instance});
      if (previous !== undefined) conflicts.push({kind:'repeated-position',instance,previous,gridAt});
      else visited.set(key,instance);
      const transform = K.diorama.solidFrames.transform({basis,scale:1,mesh:{position}});
      instances[instance] = {prefab,transform};
      placements.push({instance,at:address,gridAt,transform});
    }
    const report = freeze({format:'ink-studio/prefab-stamp',version:1,id,prefab,
      ...(definition && {prefabRevision:definition.revision}),constructionPlane:frame.plane,
      ...(point !== undefined && {point:point.slice()}),at:first.slice(),count,step:spacing.slice(),
      orientation,angle,normalOffset,snapGrid,
      ...(snapGrid && {rounding:roundFrame.plane.rounding ?? 'nearest'}),
      placements,conflicts,canCommit:!conflicts.length});
    return conflicts.length ? {report} : {instances,report};
  }

  A.prefabStamp = Object.freeze({plan});
})(KIT);
