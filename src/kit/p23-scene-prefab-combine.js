/* Build a reusable definition from effective visual placements in a common origin. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;

  function compose(scene,env,links,origin,report) {
    const {spec,meshPlacements} = A.scenePrefabs.expand({prefabs:scene.prefabs,tilesets:scene.tilesets,
      prefabLibrary:scene.prefabLibrary,instances:scene.instances},env,{only:new Set(links.map(([id]) => id)),origin});
    const topologyMeshes = spec.topologyMeshes ?? {}, sheets = new Set();
    for (const [,link] of links)
      for (const sheet of A.scenePrefabs.tilesetRequirements(link.definition,
        Object.fromEntries([...link.meshes].map(([name,{row}]) => [name,row]))) ?? []) sheets.add(sheet);
    for (const [object,row] of Object.entries(topologyMeshes)) for (const op of row.modifiers ?? []) {
      if (op.enabled !== false && op.kind === 'projection' && !Object.hasOwn(topologyMeshes,op.target))
        report.conflicts.push({reason:'external-projection-target',object,modifier:op.id,target:op.target});
    }
    const named = (table,rows) => Object.fromEntries(links.flatMap(([id,link]) =>
      Object.keys(link.resolved[table]).map(name => id+'.'+name)).map((name,i) => [name,rows[i]]));
    return {revision:1,solids:Object.fromEntries(spec.solids.map(row => [row.id,row])),topologyMeshes,
      ...(meshPlacements.size && {meshFrames:Object.fromEntries(meshPlacements)}),
      ...(Object.keys(spec.parts).length && {parts:spec.parts}),
      ...(Object.keys(spec.groups).length && {groups:spec.groups}),
      ...(spec.motion.length && {motion:named('motion',spec.motion)}),
      ...(spec.effects.length && {effects:named('effects',spec.effects)}),
      ...(sheets.size && {usesTilesets:[...sheets].sort()}),provenance:report.provenance};
  }

  function replace(scene, ids, instance, prefab, origin) {
    const rows = [];
    let inserted = false;
    for (const [id,entry] of Object.entries(scene.instances)) {
      if (!ids.has(id)) rows.push([id,entry]);
      else if (!inserted) {
        rows.push([instance,{prefab,transform:{translation:origin}}]);
        inserted = true;
      }
    }
    return Object.fromEntries(rows);
  }

  function remapDecals(scene,objects,parts,report) {
    if (!scene.surfaceDecals) return;
    const decals = scene.surfaceDecals.decals.map(row => {
      const {anchor} = row;
      if (!objects.has(anchor.object)) return row;
      const object = objects.get(anchor.object);
      const next = {...anchor,object,...(parts.has(anchor.part) && {part:parts.get(anchor.part)})};
      report.anchors.push({kind:'decal',id:row.id,before:anchor,after:next});
      return {...row,anchor:next};
    });
    if (report.anchors.length) return {...scene.surfaceDecals,decals};
  }

  function plan(scene,env,request) {
    const {id,own} = K.world.data;
    const {prefab,mode,instance,origin:point} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !['prefab','mode','instance','origin','instances','selection'].includes(key)) ||
        !id(prefab) || !['keep','replace'].includes(mode) || (mode === 'replace' ? !id(instance) : instance !== undefined) ||
        point !== undefined && (!Array.isArray(point) || point.length!==3 || !Array.from(point).every(Number.isFinite)))
      throw new TypeError('Choose a new prefab and explicitly keep or replace the selected placements');
    const selection = A.sceneInstances.prefabSelection(scene,request);
    if (selection.length<2) throw new RangeError('Choose at least two linked prefab placements');
    const before = A.scenePrefabs.expand(scene,env), ids = new Set(selection.map(row => row.instance));
    const links = [...before.instances].filter(([id]) => ids.has(id));
    const origin = point?.slice() ?? links[0][1].frame?.position ?? [0,0,0];
    const provenance = links.map(([instance,link]) => ({instance,prefab:link.instance.prefab,revision:link.revision,
      ...(!own(scene.prefabs,link.instance.prefab) && scene.prefabLibrary && {library:scene.prefabLibrary})}));
    const report = {format:'ink-studio/prefab-combination',version:1,scene:scene.id,prefab,mode,origin,
      ...(instance !== undefined && {instance}),provenance,placements:[],anchors:[],instances:[],conflicts:[]};
    if (own(scene.prefabs,prefab) || own(env.prefabs,prefab))
      report.conflicts.push({reason:'prefab-in-use',prefab});
    if (mode === 'replace') {
      if (own(scene.instances,instance) && !ids.has(instance))
        report.conflicts.push({reason:'instance-in-use',instance});
      for (const [child,row] of Object.entries(scene.instances)) {
        if (ids.has(row.parent) && !ids.has(child))
          report.conflicts.push({reason:'child-needs-reparent',instance:child,parent:row.parent});
        if (ids.has(row.mirror?.source) && !ids.has(child))
          report.conflicts.push({reason:'dependent-live-mirror',instance:child,source:row.mirror.source});
      }
      for (const [name,array] of Object.entries(scene.prefabArrays ?? {}))
        if (ids.has(array.instance) && array.instance !== instance) report.conflicts.push({reason:'array-source-would-be-removed',array:name,instance:array.instance});
    }
    if (report.conflicts.length) return {report:freeze({...report,canCommit:false})};
    const definition = compose(scene,env,links,origin,report);
    const objects = new Map(), parts = new Map(), place = mode === 'replace';
    for (const [id,link] of links) {
      const old = [...new Set([...link.solids,...[...link.meshes.values()].map(row => row.object)])];
      const records = old.map(member => ({from:member,member,...(place && {to:instance+'.'+member})}));
      if (place) {
        for (const row of records) objects.set(row.from,row.to);
        const localParts = [...Object.keys(link.resolved.parts),
          ...Object.values(link.resolved.solids).map(row => row.part),...[...link.meshes.values()].map(({row}) => row.part)];
        for (const part of localParts.filter(Boolean)) parts.set(id+'.'+part,instance+'.'+id+'.'+part);
      }
      report.placements.push({instance:id,prefab:link.instance.prefab,revision:link.revision,members:records});
      report.instances.push({instance:id,objects:[...old,...records.flatMap(row => row.to ? [row.to] : [])]});
    }
    const patch = {prefabs:{...scene.prefabs,[prefab]:definition}};
    if (place) {
      patch.instances = replace(scene,ids,instance,prefab,origin);
      const decals = remapDecals(scene,objects,parts,report);
      if (decals) patch.surfaceDecals = decals;
      if (!report.conflicts.length) {
        try {
          const after = A.scenePrefabs.expand({...scene,...patch},env);
          report.conflicts.push(...A.scenePrefabs.indexedTargets(scene,before,after,(id,table,name) =>
            ids.has(id) ? [instance,id+'.'+name] : [id,name]));
        } catch (error) {
          return {report:freeze({...report,canCommit:false,problems:error.problems ?? [{level:'error',problem:error.message}]})};
        }
      }
    }
    return {...(!report.conflicts.length && {patch}),report:freeze({...report,
      memberCounts:Object.fromEntries(['solids','topologyMeshes','parts','groups','motion','effects']
        .map(table => [table,Object.keys(definition[table] ?? {}).length])),
      ...(definition.usesTilesets && {usesTilesets:definition.usesTilesets}),canCommit:!report.conflicts.length})};
  }

  A.prefabCombination = Object.freeze({plan});
})(KIT);
