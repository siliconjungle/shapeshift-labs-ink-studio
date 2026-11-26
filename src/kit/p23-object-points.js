/* Stable local coordinates shared by retained geometry, prefab placements and sockets. */
(function (K) {
  const A = K.authoring, {M,V} = K;
  const {freeze} = K.procedural.data;
  const forward = [0,0,1];
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const fields = (value,keys) => K.world.data.record(value) && Object.keys(value).every(key => keys.includes(key));

  function normalize(direction) {
    const length = xyz(direction) && Math.hypot(...direction);
    if (!length || !Number.isFinite(length)) throw new TypeError('An object point direction needs a nonzero finite XYZ vector');
    return direction.map(value => value/length || 0);
  }

  function point(value) {
    if (!fields(value,['position','direction']) || !xyz(value.position) || value.position.some(n => Math.abs(n)>1e8))
      throw new TypeError('An object point needs a finite local XYZ position');
    return {position:value.position.slice(),...(value.direction !== undefined && {direction:normalize(value.direction)})};
  }

  function read(points = {}) {
    const {id,record} = K.world.data;
    if (!record(points) || Object.keys(points).length>128)
      throw new TypeError('Object points need a map of up to 128 named records');
    return Object.fromEntries(Object.entries(points).map(([name,value]) => {
      if (!id(name)) throw new TypeError('Invalid object point ID '+name);
      return [name,point(value)];
    }));
  }

  function transform(row, frame) {
    if (!frame) return {position:row.position.slice(),direction:row.direction ?? forward.slice()};
    return {position:K.sceneGraph.point(frame,row.position),direction:normalize(M.app(frame.matrix,row.direction ?? forward))};
  }

  function socketFrames(points) {
    return Object.fromEntries(Object.entries(read(points)).map(([id,row]) => {
      const back = row.direction ?? forward, guide = Math.abs(back[1])>.9 ? [1,0,0] : [0,1,0];
      const right = normalize(V.cross(guide,back)), up = V.cross(back,right);
      return [id,{position:row.position,matrix:M.tr([...right,...up,...back])}];
    }));
  }

  function owner(scene, env, raw) {
    const {own} = K.world.data;
    const expanded = A.scenePrefabs.expand(scene,env);
    if (raw.instance !== undefined) {
      const link = expanded.instances.get(raw.instance);
      if (!link) throw new RangeError('Unknown visual prefab instance '+raw.instance);
      return {points:link.resolved.points,frame:link.frame,mirror:link.mirror,prefab:link.instance.prefab};
    }
    const row = own(expanded.spec.topologyMeshes,raw.object) && expanded.spec.topologyMeshes[raw.object];
    if (!row) throw new RangeError('Unknown editable mesh '+raw.object);
    return {points:row.points,frame:expanded.meshPlacements.get(raw.object)};
  }

  function host(raw,keys) {
    return fields(raw,['object','instance',...keys]) &&
      (raw.object === undefined ? K.world.data.id(raw.instance) : TargetSelectors.name(raw.object) && raw.instance === undefined);
  }

  function resolve(scene, env, raw) {
    const {id,own} = K.world.data;
    if (!host(raw,['kind','id']) || raw.kind !== 'object-point' || !id(raw.id))
      throw new TypeError('Choose a named object point on a mesh or placed prefab');
    const {points,frame} = owner(scene,env,raw);
    if (!own(points,raw.id)) throw new RangeError('Unknown object point '+raw.id+' on '+(raw.object ?? raw.instance));
    const local = point(points[raw.id]), world = transform(local,frame);
    return freeze({...raw,local,world,target:world.position});
  }

  function plan(scene, env, request) {
    const {id,own,record,equal} = K.world.data;
    if (!host(request,['points']) || request.points !== undefined && !record(request.points))
      throw new TypeError('Choose an editable mesh or placed prefab, with optional named point changes');
    const {points,frame,mirror,prefab} = owner(scene,env,request);
    const before = read(points), after = {...before}, edits = [];
    for (const [name,value] of Object.entries(request.points ?? {})) {
      if (!id(name)) throw new TypeError('Invalid object point ID '+name);
      if (value === null) delete after[name];
      else after[name] = point(value);
      if (!equal(before[name],after[name]))
        edits.push(after[name] ? {op:'set',path:['points',name],value:after[name]} : {op:'remove',path:['points',name]});
    }
    read(after);
    const conflicts = [];
    if (request.points !== undefined) {
      if (mirror) conflicts.push({reason:'edit-live-mirror-source',source:mirror.source});
      else if (request.object !== undefined && !own(scene.topologyMeshes,request.object))
        conflicts.push({reason:'point-owner-is-a-prefab-member',object:request.object});
      else if (prefab && !own(scene.prefabs,prefab)) conflicts.push({reason:'publish-prefab-library-revision',prefab});
    }
    const describe = rows => Object.entries(rows).sort(([a],[b]) => a.localeCompare(b)).map(([id,local]) =>
      ({id,local,world:transform(local,frame)}));
    const report = {format:'ink-studio/object-points',version:1,scene:scene.id,
      ...(request.object !== undefined ? {object:request.object} : {instance:request.instance,prefab}),
      before:describe(before),after:describe(after),changed:edits.length>0,conflicts,canCommit:!conflicts.length};
    return {report:freeze(report),points:after,edits};
  }

  A.objectPoints = Object.freeze({read,transform,socketFrames,resolve,plan});
})(KIT);
