/* Fork or detach one placement using its effective retained members. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, {freeze} = K.procedural.data;
  const format = 'ink-studio/prefab-variant';

  function fork(scene, link, report) {
    const {instance,variant,provenance} = report;
    const {solids,...resolved} = link.resolved;
    const topologyMeshes = Object.fromEntries([...link.meshes].map(([member,{row}]) => [member,row]));
    const taggedSolids = Object.fromEntries(Object.entries(solids).map(([id,solid]) =>
      [id,{...solid,prefabs:[provenance.prefab,...new Set((solid.prefabs ?? []).filter(tag => tag !== provenance.prefab))]}]));
    const definition = {revision:1,solids:taggedSolids,topologyMeshes,provenance};
    for (const table of ['parts','groups','motion','effects'])
      if (Object.keys(resolved[table]).length) definition[table] = resolved[table];
    if (link.definition.meshFrames) definition.meshFrames = Object.fromEntries(
      Object.entries(link.definition.meshFrames).filter(([member]) => Object.hasOwn(topologyMeshes,member)));
    const sheets = A.scenePrefabs.tilesetRequirements(link.definition,topologyMeshes);
    if (sheets !== undefined) definition.usesTilesets = sheets;
    const {transform} = link.instance;
    return {prefabs:{...scene.prefabs,[variant]:definition},
      instances:{...scene.instances,[instance]:{prefab:variant,...(transform !== undefined && {transform})}}};
  }

  function hasPlacement(frame) {
    return frame && (frame.position.some(Boolean) || frame.matrix.some((n,i) => n !== (i%4 === 0 ? 1 : 0)));
  }

  function placedMesh(row, placement) {
    const doc = T.create(row.document);
    const vertices = doc.vertices.map(vertex => ({...vertex,position:placement.point(vertex.position)}));
    const faces = doc.faces.map(face => ({...face,corners:face.corners.map(corner => corner.normal ?
      {...corner,normal:placement.direction(corner.normal)} : corner)}));
    const bindings = row.bindings?.map(binding => meshUVFlatten.isBinding(binding) && placement.scale !== 1 ?
      {...binding,data:{...binding.data,texelsPerUnit:binding.data.texelsPerUnit/placement.scale}} : binding);
    return {...row,document:T.create({...doc,vertices,faces}),
      ...(bindings && {bindings}),...(row.pivot && {pivot:placement.point(row.pivot)})};
  }

  function detach(scene, spec, meshPlacements, link, report) {
    const {instance,provenance,conflicts} = report;
    const instances = {...scene.instances};
    delete instances[instance];
    const topologyMeshes = {...scene.topologyMeshes};
    function placedFrame(member,object) {
      const frame = meshPlacements.get(object);
      if (!hasPlacement(frame)) return;
      if (!Object.hasOwn(link.definition.meshFrames ?? {},member))
        return K.diorama.solidFrames.authored(link.instance.transform);
      const scale = K.V.len([frame.matrix[0],frame.matrix[3],frame.matrix[6]]);
      return {scale,point:value => K.sceneGraph.point(frame,value),
        direction:value => K.V.mul(K.M.app(frame.matrix,value),1/scale)};
    }
    const expanded = spec.topologyMeshes ?? {};
    for (const [member, {object}] of link.meshes) {
      const row = expanded[object], doc = T.create(row.document), placement = placedFrame(member,object);
      const dependent = [...(doc.skin ? ['skin'] : []),...(row.shapeKeys ? ['shapeKeys'] : []),
        ...(row.attachments ? ['attachments'] : []),
        ...(row.modifiers?.some(op => op.enabled !== false) ? ['modifiers'] : [])];
      if (placement && dependent.length) {
        conflicts.push({reason:'mesh-placement-needs-review',member,object,dependent});
        continue;
      }
      topologyMeshes[object] = {...(placement ? placedMesh(row,placement) : row),
        provenance:{...provenance,member,meshRevision:T.revision(doc)}};
    }
    if (conflicts.length) return;
    return {instances,topologyMeshes,solids:[...(scene.solids ?? []),...spec.solids],
      parts:{...scene.parts,...spec.parts},groups:{...scene.groups,...spec.groups},
      motion:[...(scene.motion ?? []),...spec.motion],effects:[...(scene.effects ?? []),...spec.effects]};
  }

  function checkIndexedTargets(scene, patch, env, conflicts) {
    if (scene.parameterBindings === undefined) return;
    const tables = ['solids','motion','effects'];
    const paths = K.parameters.prepare(scene.parameterBindings).targets.map(({path}) => path)
      .filter(([table,index]) => tables.includes(table) && /^(0|[1-9][0-9]*)$/.test(index));
    if (!paths.length) return;
    const before = A.scenePrefabs.expand(scene,env).spec;
    const after = A.scenePrefabs.expand({...scene,...patch},env).spec;
    for (const path of paths) {
      const [table,index] = path;
      if (!K.world.data.equal(before[table]?.[index],after[table]?.[index]))
        conflicts.push({reason:'indexed-parameter-target-moved',path:[...path]});
    }
  }

  function plan(scene, env, request) {
    const {id,own,selector} = K.world.data;
    const {instance,mode,revision,prefab:variant} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !['instance','mode','revision','prefab'].includes(key)) ||
        !id(instance) || !['fork','detach'].includes(mode) || (mode === 'fork' ? !id(variant) : variant !== undefined) ||
        revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new TypeError('Choose a prefab instance and fork to a new prefab ID or detach into editable scene members');
    if (!own(scene.instances,instance)) throw new RangeError('Unknown visual prefab instance '+instance);
    const entry = scene.instances[instance];
    const {spec,instances,meshPlacements} = A.scenePrefabs.expand({prefabs:scene.prefabs,tilesets:scene.tilesets,
      prefabLibrary:scene.prefabLibrary,instances:{[instance]:entry}},env);
    const link = instances.get(instance), {prefab} = entry;
    if (revision !== undefined && revision !== link.revision) throw new RangeError('Stale prefab variant revision');
    const provenance = {instance,prefab,revision:link.revision,
      ...(!own(scene.prefabs,prefab) && scene.prefabLibrary && {library:scene.prefabLibrary}),
      ...(link.definition.generation && {model:link.definition.generation.model})};
    const meshes = Array.from(link.meshes,([member,{object,row,base}]) => {
      const doc = T.create(row.document);
      return {member,object,baseRevision:base,meshRevision:T.revision(doc),faces:doc.faces.map(face => face.id)};
    });
    const report = {format,version:1,scene:scene.id,instance,mode,...(variant !== undefined && {variant}),
      provenance,placement:entry.transform ?? null,meshes,solids:link.solids.slice(),
      overrides:{paths:(entry.overrides ?? []).map(edit => selector(edit.path).slice()),
        meshes:Object.keys(entry.meshOverrides ?? {}).sort()},conflicts:[]};
    report.instances = [{instance,objects:[...report.solids,...meshes.map(row => row.object)]}];
    let patch;
    if (mode === 'fork') {
      if (own(scene.prefabs,variant) || own(env.prefabs,variant)) report.conflicts.push({reason:'prefab-in-use',prefab:variant});
      else patch = fork(scene,link,report);
    } else {
      patch = detach(scene,spec,meshPlacements,link,report);
      if (patch) checkIndexedTargets(scene,patch,env,report.conflicts);
    }
    if (report.conflicts.length) patch = undefined;
    return {patch,report:freeze({...report,canCommit:!report.conflicts.length})};
  }

  A.prefabVariant = Object.freeze({plan});
})(KIT);
