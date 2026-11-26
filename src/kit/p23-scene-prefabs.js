/* Expand linked visual recipes into the native diorama schema at build time. */
(function (K) {
  const A = K.authoring, DIO = K.diorama, { V } = K;
  const tables = ['solids', 'parts', 'groups', 'motion', 'effects', 'topologyMeshes'];
  const { authored, compose, transform } = DIO.solidFrames;

  function scopedSolid(solid, name, tasks, { primary, key, placement, prefab }) {
    const next = { ...solid };
    if (primary || solid.id !== undefined) next.id = name(primary ? key : solid.id);
    if (primary) {
      next.prefabs = [prefab, ...new Set((solid.prefabs ?? []).filter(value => value !== prefab))];
      if (placement && solid.restAffine !== undefined)
        next.restAffine = K.sceneGraph.compose(placement.mesh, K.sceneGraph.transform(solid.restAffine));
      else if (placement) next.transform = transform(compose(placement, authored(solid.transform, solid.at)));
    }
    if (solid.part !== undefined) next.part = name(solid.part);
    if (solid.group !== undefined) next.group = name(solid.group);
    for (const field of DIO.operandFields(solid)) if (tasks.record(solid[field]))
      next[field] = scopedSolid(solid[field], name, tasks, { primary: false });
    if (Array.isArray(solid.modifiers)) next.modifiers = solid.modifiers.map(row => tasks.record(row?.shape) ?
      { ...row, shape: scopedSolid(row.shape, name, tasks, { primary: false }) } : row);
    return next;
  }

  function tilesetRequirements(definition, meshes) {
    const sheets = new Set(definition.usesTilesets ?? []);
    for (const row of Object.values(meshes ?? {})) {
      for (const material of row.materials ?? []) if (material.texture?.tileset) sheets.add(material.texture.tileset);
      for (const binding of row.bindings ?? []) {
        const sheet = binding.data?.selection?.tileset;
        if (!binding.review && sheet && A.tilesetFaces.isSourceBinding(binding)) sheets.add(sheet);
      }
      for (const bake of row.bakes ?? []) if (bake.maps.texture?.tileset) sheets.add(bake.maps.texture.tileset);
    }
    return sheets.size ? [...sheets].sort() : definition.usesTilesets;
  }

  function checkProvenance(row, mesh = false) {
    const {id,record,check} = K.world.data;
    const keys = ['prefab','instance','revision','library','model',...(mesh ? ['member','meshRevision'] : [])];
    check(record(row) && Object.keys(row).every(key => keys.includes(key)) &&
      id(row.prefab) && id(row.instance) && Number.isSafeInteger(row.revision) && row.revision >= 1 &&
      (row.library === undefined || typeof row.library === 'string' && row.library.length > 0) &&
      (row.model === undefined || id(row.model)) &&
      (!mesh || id(row.member) && typeof row.meshRevision === 'string' && row.meshRevision.length > 0),
    'Invalid prefab source provenance');
  }

  function expand(source, { prefabs: external } = {}) {
    if (!source || source.prefabs === undefined && source.instances === undefined && source.prefabLibrary === undefined)
      return { spec: source, instances: new Map(), meshPlacements: new Map() };
    const W = K.world, tasks = W.data, { check, own, record, id, selector } = tasks;
    const { prefabs = {}, instances = {}, prefabLibrary, ...rest } = source;
    check(record(prefabs) && record(instances) && (external === undefined || record(external)), 'Expected prefab and instance maps');
    if (prefabLibrary !== undefined)
      check(typeof prefabLibrary === 'string' && prefabLibrary.length && external, 'Load the named prefabLibrary before building');
    const available = new Map();
    for (const [key, def] of [...Object.entries(external ?? {}), ...Object.entries(prefabs)]) {
      check(id(key) && record(def) && !available.has(key) && Number.isSafeInteger(def.revision) && def.revision >= 1 &&
        Object.keys(def).every(field => field === 'revision' || field === 'generation' || field === 'provenance' || field === 'usesTilesets' || tables.includes(field)) && record(def.solids),
      'Invalid or duplicate visual prefab ' + key);
      for (const field of tables)
        check(def[field] === undefined || record(def[field]) && Object.entries(def[field]).every(([key, row]) => id(key) && record(row)),
          'Expected named records in prefab ' + key + '/' + field);
      if (def.usesTilesets !== undefined) {
        const uses = def.usesTilesets;
        check(Array.isArray(uses) && Array.from(uses).every(A.tilesets.validId) && new Set(uses).size === uses.length,
          'Expected distinct tileset requirements in prefab ' + key);
      }
      if (def.provenance !== undefined) checkProvenance(def.provenance);
      K.procedural.model.validate(def, 'visual');
      available.set(key, def);
    }
    const spec = { ...rest, solids: [...(rest.solids ?? [])], parts: { ...rest.parts }, groups: { ...rest.groups },
      motion: [...(rest.motion ?? [])], effects: [...(rest.effects ?? [])] };
    const links = new Map(), meshPlacements = new Map();
    for (const [key, instance] of Object.entries(instances)) {
      try {
        check(id(key) && record(instance) &&
          Object.keys(instance).every(field => ['prefab', 'transform', 'overrides', 'meshOverrides'].includes(field)) &&
          available.has(instance.prefab), 'Unknown visual prefab or invalid instance');
        const definition = available.get(instance.prefab);
        for (const sheet of definition.usesTilesets ?? [])
          check(own(source.tilesets ?? {},sheet), 'Visual prefab ' + instance.prefab + ' requires tileset ' + sheet);
        const edits = instance.overrides ?? [];
        check(Array.isArray(edits), 'Prefab overrides must be an ordered edit list');
        for (const edit of edits) {
          const path = selector(edit?.path);
          check(tables.includes(path[0]) && path.length >= 2 && id(path[1]) &&
            !(path[0] === 'solids' && path[2] === 'id') && ['set', 'merge', 'remove', 'test'].includes(edit.op),
          'Prefab overrides must address local records without changing their IDs');
        }
        const baseline = Object.fromEntries(tables.map(table => [table, definition[table] ?? {}]));
        // A missing member usually means the library revision retired it.
        // Refuse to recreate or silently discard overridden members.
        for (const edit of edits) {
          const [table, member] = selector(edit.path);
          if (!own(baseline[table], member)) {
            const descendants = Object.entries(definition.generation?.sections[table] ?? {})
              .filter(([, parent]) => parent === member).map(([id]) => id).sort();
            check(false, 'Override refers to missing ' + table + '/' + member +
              (descendants.length ? '. Split descendants are ' + descendants.join(', ') : ''));
          }
        }
        const resolved = W.apply(baseline, edits, { validate: null }).world;
        const meshOverrides = instance.meshOverrides ?? {};
        check(record(meshOverrides), 'Expected a map of prefab mesh overrides');
        for (const [member, override] of Object.entries(meshOverrides)) {
          check(own(resolved.topologyMeshes, member), 'Mesh override refers to missing member ' + member);
          check(record(override) && Object.keys(override).every(key => ['revision', 'base', 'mesh'].includes(key)) &&
            override.revision === definition.revision &&
            override.base === K.meshTopology.revision(resolved.topologyMeshes[member].document) && record(override.mesh),
            'Mesh override for ' + member + ' needs review against prefab revision ' + definition.revision);
        }
        const name = local => key + '.' + local;
        const placement = instance.transform === undefined ? null : authored(instance.transform);
        const ids = [], meshes = new Map();
        for (const [local, solid] of Object.entries(resolved.solids)) {
          check(record(solid), 'Expected a solid at ' + local);
          const next = scopedSolid(solid, name, tasks, { primary: true, key: local, placement, prefab: instance.prefab });
          spec.solids.push(next);
          ids.push(next.id);
        }
        for (const [local, row] of Object.entries(resolved.parts)) {
          check(!own(spec.parts, name(local)), 'Part ID is already in use: ' + name(local));
          spec.parts[name(local)] = { ...row, ...(row.parent !== undefined && { parent: name(row.parent) }),
            ...(placement && row.joint && { joint: placement.point(row.joint) }) };
        }
        for (const [local, base] of Object.entries(resolved.topologyMeshes)) {
          const object = name(local), row = own(meshOverrides, local) ? meshOverrides[local].mesh : base;
          check(!own(spec.topologyMeshes, object), 'Mesh ID is already in use: ' + object);
          meshes.set(local, { object, base: K.meshTopology.revision(base.document), row });
          spec.topologyMeshes = { ...spec.topologyMeshes, [object]: { ...row,
            ...(row.part !== undefined && { part: name(row.part) }),
            ...(Array.isArray(row.modifiers) && { modifiers: row.modifiers.map(op =>
              op?.kind === 'projection' && own(resolved.topologyMeshes, op.target) ? { ...op, target: name(op.target) } : op) }) } };
          if (placement) meshPlacements.set(object, placement.mesh);
        }
        for (const [local, row] of Object.entries(resolved.groups)) {
          check(!own(spec.groups, name(local)), 'Group ID is already in use: ' + name(local));
          spec.groups[name(local)] = { ...row, ...(placement && { blend: row.blend * placement.scale }) };
        }
        for (const row of Object.values(resolved.motion)) {
          const next = { ...row, part: name(row.part) };
          if (placement) {
            next.axis = placement.direction(row.axis ?? [0, 1, 0]);
            if (row.do === 'bob') {
              next.amount = (row.amount ?? .3) * placement.scale;
              if (row.keys) next.keys = row.keys.map((value, i) => i % 2 ? value * placement.scale : value);
            }
          }
          spec.motion.push(next);
        }
        for (const row of Object.values(resolved.effects)) {
          const next = { ...row, ...(row.follow !== undefined && { follow: name(row.follow) }) };
          if (placement) {
            if (row.at) next.at = placement.point(row.at);
            if (row.v) next.v = V.mul(placement.direction(row.v), placement.scale);
            if (row.dir) next.dir = placement.direction(row.dir);
            for (const field of ['r', 'spread', 'speed']) if (row[field] !== undefined) next[field] *= placement.scale;
            if (row.box) {
              const [lo, hi] = row.box;
              const corners = [lo[0], hi[0]].flatMap(x => [lo[1], hi[1]].flatMap(y => [lo[2], hi[2]].map(z => placement.point([x, y, z]))));
              next.box = [Math.min, Math.max].map(fn => [0, 1, 2].map(i => fn(...corners.map(point => point[i]))));
            }
          }
          spec.effects.push(next);
        }
        links.set(key, { instance, definition, resolved, revision: definition.revision, solids: ids, meshes, frame: placement?.mesh });
      } catch (error) {
        const problem = { level: 'error', path: 'instances.' + key, problem: error.message, hint: '' };
        const failure = new Error(DIO.report([problem]));
        failure.problems = [problem];
        throw failure;
      }
    }
    return { spec, instances: links, meshPlacements };
  }

  function review(source, before, after) {
    const {equal, own, selector} = K.world.data;
    return Object.entries(source.instances ?? {}).flatMap(([id, instance]) => {
      const {prefab} = instance;
      const from = source.prefabs?.[prefab] ?? before?.[prefab], to = source.prefabs?.[prefab] ?? after?.[prefab];
      if (!from || !to || !(from.generation || to.generation) || equal(from, to)) return [];
      const generation = K.procedural.model.compare(from, to);
      const overrides = (instance.overrides ?? []).map(edit => {
        const path = selector(edit.path), [table, member] = path;
        const entry = generation.sections[table]?.[member];
        const status = entry?.status ?? (own(to[table], member) ? 'retained' : 'removed');
        return {path: [...path], status: status === 'retained' ? 'preserved' : status,
          ...(entry?.descendants && {descendants: entry.descendants})};
      });
      return [{instance: id, prefab, generation, overrides,
        ok: generation.ok && overrides.every(row => row.status === 'preserved')}];
    });
  }

  function indexedTargets(scene,before,after,mapMember = (instance,table,name) => name) {
    if (scene.parameterBindings === undefined) return [];
    const indexed = ['solids','motion','effects'], conflicts = [];
    const order = (links,table,remap) => [
      ...(scene[table] ?? []).map((_,index) => [null,index]),
      ...[...links].flatMap(([instance,link]) => Object.keys(link.resolved[table]).map(name =>
        [instance,remap ? mapMember(instance,table,name) : name]))
    ];
    const candidates = K.parameters.prepare(scene.parameterBindings).targets.filter(({path:[table,index]}) =>
      indexed.includes(table) && /^(0|[1-9][0-9]*)$/.test(index));
    for (const table of new Set(candidates.map(({path}) => path[0]))) {
      const left = order(before.instances,table,true), right = order(after.instances,table,false);
      for (const {path} of candidates.filter(({path}) => path[0] === table))
        if (!K.world.data.equal(left[path[1]],right[path[1]]))
          conflicts.push({reason:'indexed-parameter-target-moved',path:[...path]});
    }
    return conflicts;
  }

  function origin(transform) {
    return authored(transform).point([0, 0, 0]);
  }

  A.scenePrefabs = Object.freeze({ expand, review, origin, checkProvenance, tilesetRequirements, indexedTargets });
})(KIT);
