/* Edit a visual definition using a scene placement as the authoring context. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const {tables} = prefabSourceRebase;
  const format = 'ink-studio/prefab-source-edit';

  function definitionEdits(definition, edits) {
    const W = K.world, {id,selector} = W.data;
    const sourceTables = tables.filter(table => table !== 'topologyMeshes');
    for (const edit of edits) {
      const path = selector(edit?.path);
      if (!sourceTables.includes(path[0]) || path.length < 2 || !id(path[1]) ||
          path[0] === 'solids' && path[2] === 'id' || !['set','merge','remove','test'].includes(edit.op))
        throw new TypeError('Edit a named solid, part, group, motion track, or effect by its local path');
    }
    const source = Object.fromEntries(sourceTables.map(table => [table,definition[table] ?? {}]));
    return W.apply(source,edits,{validate:null});
  }

  function plan(scene, env, request, requireShapeOwner, authoredCamera) {
    const {id,own,equal} = K.world.data;
    const {instance,revision,faces,edits=[],sourceEdits=[],properties:propertyChanges} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !['instance','revision','faces','edits','sourceEdits','properties'].includes(key)) ||
        !id(instance) || ![edits,sourceEdits].every(list => Array.isArray(list) && list.length <= 256) ||
        revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new TypeError('Choose a prefab instance, ordered edits, and an optional source revision');
    if (!own(scene.instances,instance)) throw new RangeError('Unknown visual prefab instance '+instance);
    const entry = scene.instances[instance], context = entry.mirror ? scene.instances[entry.mirror.source] : entry;
    const {prefab} = context;
    const inline = own(scene.prefabs,prefab), definition = (inline ? scene.prefabs : env.prefabs)[prefab];
    if (revision !== undefined && revision !== definition.revision) throw new RangeError('Stale prefab source revision');

    const report = {format,version:1,scene:scene.id,instance,prefab,source:inline ? 'inline' : 'library',
      beforeRevision:definition.revision,afterRevision:definition.revision,sourcePaths:[],meshEdits:[],
      instances:[],conflicts:[],canCommit:true,changed:false};
    if (entry.mirror) return {report:freeze({...report,canCommit:false,
      conflicts:[{reason:'edit-live-mirror-source',source:entry.mirror.source}]})};
    const properties = definitionEdits(definition,sourceEdits);
    report.sourcePaths = properties.paths;
    let updated = {...definition};
    if (propertyChanges!==undefined) {
      const next = A.customProperties.patchMap(definition.properties,propertyChanges);
      const project = A.customProperties.project(scene,env);
      A.customProperties.validate(next,project.definitions,'Prefab '+prefab);
      if (!equal(next,definition.properties ?? {})) {
        updated = A.customProperties.stored(updated,next);
        report.propertyChange = {before:definition.properties ?? {},after:next};
      }
    }
    for (const [table] of properties.paths) {
      if (updated[table] === properties.world[table]) continue;
      if (table === 'solids' || Object.keys(properties.world[table]).length) updated[table] = properties.world[table];
      else delete updated[table];
    }
    if (edits.length) {
      const {overrides,meshOverrides,...base} = entry;
      const draft = {...scene,instances:{...scene.instances,[instance]:base}};
      const planned = prefabEditIsolation.plan(draft,env,{instance,faces,edits},requireShapeOwner,authoredCamera,{source:true});
      report.meshEdits = planned.report.edits;
      if (!planned.report.canCommit)
        return {report:freeze({...report,canCommit:false,conflicts:planned.report.conflicts})};
      if (planned.report.changed) {
        updated.topologyMeshes = {...updated.topologyMeshes};
        for (const [member,override] of Object.entries(planned.instance.meshOverrides))
          updated.topologyMeshes[member] = override.mesh;
        const uses = A.scenePrefabs.tilesetRequirements(updated,updated.topologyMeshes);
        if (uses !== undefined) updated.usesTilesets = uses;
      }
    }
    if (!Number.isSafeInteger(definition.revision+1) && !equal(definition,updated))
      throw new RangeError('Prefab revision exceeds the supported integer range');
    if (!equal(definition,updated)) updated.revision++;
    const changed = updated.revision !== definition.revision;
    report.changed = changed;
    report.afterRevision = updated.revision;

    const instances = {...scene.instances};
    let invalid = false;
    for (const [id,entry] of Object.entries(scene.instances).sort(([a],[b]) => a.localeCompare(b))) {
      if (entry.prefab !== prefab) continue;
      const result = prefabSourceRebase.instance(id,entry,definition,updated);
      report.instances.push(result.report);
      for (const conflict of result.report.conflicts) report.conflicts.push({instance:id,...conflict});
      if (result.invalid) invalid = true;
      else instances[id] = result.entry;
    }
    for (const [id,{mirror}] of Object.entries(instances))
      if (mirror && instances[mirror.source]?.prefab === prefab) {
        const seed = report.instances.find(row => row.instance === mirror.source);
        if (seed) {
          const member = object => id+object.slice(mirror.source.length);
          report.instances.push({...seed,instance:id,mirrorOf:mirror.source,
            objects:(seed.objects ?? []).map(member),
            members:seed.members.map(row=>({...row,object:member(row.object)}))});
        }
      }
    const library = inline ? undefined : {...env.prefabs,[prefab]:updated};
    const candidate = inline ? {...scene,prefabs:{...scene.prefabs,[prefab]:updated},instances} : {...scene,instances};
    const bindings = inline ? env : {...env,prefabs:library};
    report.canCommit = !report.conflicts.length;
    return {report:freeze(report),...(!invalid && {candidate,bindings,library})};
  }

  A.prefabSourceEdit = Object.freeze({plan});
})(KIT);
