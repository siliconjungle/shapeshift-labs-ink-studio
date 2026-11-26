/* Expand linked visual recipes into the native diorama schema at build time. */
(function (K) {
  const A = K.authoring, DIO = K.diorama, { M,V } = K;
  const tables = ['solids', 'parts', 'groups', 'motion', 'effects', 'topologyMeshes', 'points'];
  const { authored, compose, inverse, reflection, transform } = DIO.solidFrames;

  function scopedSolid(solid, name, tasks, { primary, key, placement, prefab }) {
    const next = { ...solid };
    if (primary || solid.id !== undefined) next.id = name(primary ? key : solid.id);
    if (primary) {
      next.prefabs = [prefab, ...new Set((solid.prefabs ?? []).filter(value => value !== prefab))];
      if (placement && (solid.restAffine !== undefined || reflected(placement)))
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
      if (row.directionalUV) sheets.add(row.directionalUV.tileset);
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

  function memberFrames(definition) {
    const {check,record,own} = K.world.data;
    if (definition.meshFrames === undefined) return;
    check(record(definition.meshFrames),'Prefab mesh frames need a named map');
    return Object.fromEntries(Object.entries(definition.meshFrames).map(([member,raw]) => {
      check(own(definition.topologyMeshes,member),'Frame refers to missing prefab mesh '+member);
      const frame = K.sceneGraph.transform(raw), columns = M.tr(frame.matrix);
      const axes = [columns.slice(0,3),columns.slice(3,6),columns.slice(6,9)];
      const scale = V.len(axes[0]), epsilon = scale*scale*1e-8;
      check(axes.every((axis,i) => axes.every((other,j) =>
        Math.abs(V.dot(axis,other)-(i===j ? scale*scale : 0))<=epsilon)),
      'Prefab mesh frame needs a rigid orientation and uniform scale on '+member);
      return [member,frame];
    }));
  }

  function placementError(key, field, message) {
    const problem = {level:'error',path:'instances.'+key+(field ? '.'+field : ''),problem:message,hint:''};
    return Object.assign(new Error(DIO.report([problem])), {problems:[problem]});
  }

  const reflected = frame => M.det(frame.basis) < 0;
  const flipX = () => reflection([0,0,0],[1,0,0]);
  const dependency = entry => entry.mirror?.source ?? entry.parent;
  const objects = link => [...link.solids,...Array.from(link.meshes.values(),row => row.object)];

  function mirrorPlane(raw) {
    const {record} = K.world.data;
    const xyz = value => Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);
    const {origin,normal} = raw ?? {};
    if (!record(raw) || Object.keys(raw).some(key => !['origin','normal'].includes(key)) ||
        !xyz(origin) || !xyz(normal) || !normal.some(Boolean) || !Number.isFinite(Math.hypot(...normal)))
      throw new TypeError('A mirror plane needs a finite origin and a nonzero XYZ normal');
    const length = Math.hypot(...normal);
    return {origin:origin.slice(),normal:normal.map(value => value/length || 0)};
  }

  function savedPlacement(frame, pivot) {
    const flip = reflected(frame), proper = flip ? compose(frame,flipX()) : frame;
    const raw = transform(proper);
    if (pivot) {
      raw.pivot = pivot.slice();
      raw.translation = V.sub(proper.point(pivot),pivot);
    }
    return {transform:raw,...(flip && {flipX:true})};
  }

  function placedOrigin(instance, frame) {
    const local = instance?.origin ?? [0,0,0];
    return frame ? frame.point(local) : local.slice();
  }

  function placements(instances = {}, { camera } = {}) {
    const {check,id,own,record} = K.world.data;
    check(record(instances),'Expected an instance map');
    if (camera !== undefined) camera = CameraLens.pose(camera);
    const locals = new Map(), world = new Map(), billboards = new Map();
    for (const [key,entry] of Object.entries(instances)) {
      check(id(key) && record(entry),'Invalid visual prefab instance '+key);
      if (entry.parent !== undefined && (!id(entry.parent) || !own(instances,entry.parent)))
        throw placementError(key,'parent','Parent must name another visual prefab instance');
      if (entry.mirror !== undefined) {
        try {
          const rule = entry.mirror;
          check(Object.keys(entry).length===1 && record(rule) && Object.keys(rule).every(key => ['source','plane'].includes(key)),
            'A live mirror derives its placement and overrides from its source');
          check(id(rule.source) && own(instances,rule.source) && instances[rule.source]?.mirror === undefined,
            'A live mirror needs an authored prefab source');
          const {origin,normal} = mirrorPlane(rule.plane);
          locals.set(key,reflection(origin,normal));
        } catch (error) {
          throw placementError(key,'mirror',error.message);
        }
        continue;
      }
      if (entry.billboard !== undefined) {
        try { billboards.set(key, A.prefabBillboards.read(entry.billboard)); }
        catch (error) { throw placementError(key,'billboard',error.message); }
      }
      try {
        check(entry.flipX === undefined || entry.flipX === true,'An independent reflected placement uses flipX: true');
        check(entry.origin === undefined || meshPivot.xyz(entry.origin),'A prefab origin needs a finite local XYZ position');
        const local = entry.transform === undefined ? null : authored(entry.transform);
        locals.set(key,entry.flipX ? (local ? compose(local,flipX()) : flipX()) : local);
      } catch (error) {
        throw placementError(key,'transform',error.message);
      }
    }
    for (const key of locals.keys()) {
      const chain = new Set();
      let current = key;
      while (current !== undefined && !world.has(current)) {
        if (chain.has(current)) throw placementError(current,'parent','Prefab parent cycle (including mirror links): '+[...chain,current].join(' -> '));
        chain.add(current);
        current = dependency(instances[current]);
      }
      let frame = world.get(current);
      for (const name of [...chain].reverse()) {
        const local = locals.get(name);
        frame = frame && local ? (instances[name].mirror ? compose(local,frame) : compose(frame,local)) : local ?? frame;
        if (camera && billboards.has(name))
          frame = A.prefabBillboards.orient(frame ?? authored(), instances[name], billboards.get(name), camera);
        if (frame && (!Number.isFinite(frame.scale) || frame.scale <= 0 || !frame.mesh.position.every(Number.isFinite)))
          throw placementError(name,'transform','World transform exceeds numeric precision');
        world.set(name,frame ?? null);
      }
    }
    return world;
  }

  function sameFrame(a,b) {
    return ['position','matrix'].every(key => a.mesh[key].every((value,i) => {
      const next = b.mesh[key][i];
      return Math.abs(value-next) <= 1e-8*Math.max(1,Math.abs(value),Math.abs(next));
    }));
  }

  function planReparent(scene, env, request) {
    const {id,own,record} = K.world.data, {clone,freeze} = K.procedural.data;
    const {instance,parent} = request ?? {};
    if (!record(request) || Object.keys(request).some(key => !['instance','parent'].includes(key)) ||
        !id(instance) || parent !== null && !id(parent))
      throw new TypeError('Name a visual prefab instance and its new parent, or use null for the scene root');
    if (!own(scene.instances,instance)) throw new RangeError('Unknown visual prefab instance '+instance);
    const expanded = expand(scene,env), entry = scene.instances[instance];
    const world = expanded.instances.get(instance).placement ?? authored();
    const before = {parent:entry.parent ?? null,transform:clone(entry.transform ?? null),...(entry.flipX && {flipX:true}),world:world.mesh};
    const changed = parent !== before.parent;
    const report = {format:'ink-studio/prefab-reparent',version:1,scene:scene.id,instance,before,
      requestedParent:parent,changed,canCommit:false,instances:[],conflicts:[]};
    const finish = patch => ({patch,report:freeze(report)});
    const children = new Map();
    for (const [key,entry] of Object.entries(scene.instances)) {
      const parent = dependency(entry);
      if (!children.has(parent)) children.set(parent,[]);
      children.get(parent).push(key);
    }
    const subtree = [instance];
    for (let i=0; i<subtree.length; i++) subtree.push(...(children.get(subtree[i]) ?? []));
    for (const id of subtree) {
      const link = expanded.instances.get(id);
      const frame = (link.placement ?? authored()).mesh;
      report.instances.push({instance:id,objects:objects(link),
        beforeWorld:frame});
    }
    if (entry.mirror) {
      report.conflicts.push({reason:'commit-live-mirror-first',instance});
      return finish();
    }
    if (parent !== null && !own(scene.instances,parent)) {
      report.conflicts.push({reason:'unknown-parent',parent});
      return finish();
    }
    if (subtree.includes(parent)) {
      report.conflicts.push({reason:'parent-cycle',parent});
      return finish();
    }

    const instances = {...scene.instances};
    if (changed) {
      const carrier = expanded.instances.get(parent)?.placement;
      const relative = carrier ? compose(inverse(carrier),world) : world;
      const {flipX:previousFlip,...rest} = entry;
      const next = {...rest,...savedPlacement(relative,entry.transform?.pivot)};
      if (parent === null) delete next.parent;
      else next.parent = parent;
      instances[instance] = next;
    }
    let resolved;
    try {
      resolved = placements(instances);
    } catch (error) {
      report.problems = error.problems ?? [{level:'error',problem:error.message}];
      return finish();
    }
    for (const row of report.instances) {
      const actual = resolved.get(row.instance) ?? authored();
      row.afterWorld = actual.mesh;
      if (!sameFrame({mesh:row.beforeWorld},actual)) report.conflicts.push({reason:'world-placement-drift',instance:row.instance});
    }
    report.after = {parent,transform:clone(instances[instance].transform ?? null),...(instances[instance].flipX && {flipX:true}),world:report.instances[0].afterWorld};
    report.canCommit = !report.conflicts.length;
    return finish(report.canCommit ? {instances} : undefined);
  }

  function expand(source, env = {}, {only, origin} = {}) {
    const {prefabs:external} = env;
    let properties;
    try {
      properties = A.customProperties.project(source,env);
    } catch (error) {
      error.problems = [{level:'error',path:'customProperties',problem:error.message,hint:''}];
      throw error;
    }
    if (!source || source.prefabs === undefined && source.instances === undefined && source.prefabLibrary === undefined)
      return { spec: source, instances: new Map(), meshPlacements: new Map(), properties };
    const W = K.world, tasks = W.data, { check, own, record, id, selector } = tasks;
    const { prefabs = {}, instances = {}, prefabLibrary, ...rest } = source;
    check(record(prefabs) && record(instances) && (external === undefined || record(external)), 'Expected prefab and instance maps');
    if (prefabLibrary !== undefined)
      check(typeof prefabLibrary === 'string' && prefabLibrary.length && external, 'Load the named prefabLibrary before building');
    const available = new Map();
    for (const [key, def] of [...Object.entries(external ?? {}), ...Object.entries(prefabs)]) {
      check(id(key) && record(def) && !available.has(key) && Number.isSafeInteger(def.revision) && def.revision >= 1 &&
        Object.keys(def).every(field => field === 'revision' || field === 'generation' || field === 'provenance' || field === 'usesTilesets' || field === 'meshFrames' || field === 'properties' || tables.includes(field)) && record(def.solids),
      'Invalid or duplicate visual prefab ' + key);
      for (const field of tables)
        check(def[field] === undefined || record(def[field]) && Object.entries(def[field]).every(([key, row]) => id(key) && record(row)),
          'Expected named records in prefab ' + key + '/' + field);
      if (def.usesTilesets !== undefined) {
        const uses = def.usesTilesets;
        check(Array.isArray(uses) && Array.from(uses).every(A.tilesets.validId) && new Set(uses).size === uses.length,
          'Expected distinct tileset requirements in prefab ' + key);
      }
      if (Array.isArray(def.provenance)) {
        check(def.provenance.length>=2 && def.provenance.length<=512,'Combined prefab provenance needs two or more placements');
        const sources = Array.from(def.provenance);
        for (const source of sources) checkProvenance(source);
        check(new Set(sources.map(row => row.instance)).size===sources.length,'Combined prefab source IDs must be distinct');
      } else if (def.provenance !== undefined) checkProvenance(def.provenance);
      A.objectPoints.read(def.points);
      A.customProperties.validate(def.properties,properties.definitions,'Prefab '+key);
      K.procedural.model.validate(def, 'visual');
      available.set(key, {definition:def,frames:memberFrames(def)});
    }
    const spec = { ...rest, solids: [...(rest.solids ?? [])], parts: { ...rest.parts }, groups: { ...rest.groups },
      motion: [...(rest.motion ?? [])], effects: [...(rest.effects ?? [])] };
    const links = new Map(), meshPlacements = new Map(), framesByInstance = env.billboardFrames ?? placements(instances);
    const offset = origin?.some(Boolean) ? authored({translation:V.mul(origin,-1)}) : null;
    for (const [key, raw] of Object.entries(instances)) {
      if (only && !only.has(key)) continue;
      try {
        const seed = raw.mirror && instances[raw.mirror.source];
        const instance = seed ? {prefab:seed.prefab,overrides:seed.overrides,meshOverrides:seed.meshOverrides,
          ...(seed.origin && {origin:seed.origin}),...(seed.properties && {properties:seed.properties})} : raw;
        check(id(key) && record(instance) &&
          Object.keys(instance).every(field => ['prefab', 'parent', 'transform', 'overrides', 'meshOverrides','flipX','origin','properties','billboard'].includes(field)) &&
          available.has(instance.prefab), 'Unknown visual prefab or invalid instance');
        const {definition,frames} = available.get(instance.prefab);
        A.customProperties.validate(instance.properties,properties.definitions,'Instance '+key);
        const resolvedProperties = Object.keys(properties.definitions).length ?
          A.customProperties.resolve(properties,definition.properties,instance.properties) : undefined;
        for (const sheet of definition.usesTilesets ?? [])
          check(own(source.tilesets ?? {},sheet), 'Visual prefab ' + instance.prefab + ' requires tileset ' + sheet);
        const edits = instance.overrides ?? [];
        check(Array.isArray(edits), 'Prefab overrides must be an ordered edit list');
        for (const edit of edits) {
          const path = selector(edit?.path);
          check(tables.includes(path[0]) && path[0] !== 'points' && path.length >= 2 && id(path[1]) &&
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
        A.objectPoints.read(resolved.points);
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
        const frame = framesByInstance.get(key);
        const placement = offset && frame ? compose(offset,frame) : offset ?? frame;
        const objectOrigin = placedOrigin(instance,placement);
        check(meshPivot.xyz(objectOrigin),'Prefab origin exceeds world coordinate precision');
        const ids = [], meshes = new Map(), effectIndices = [];
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
          const frame = own(frames,local) ? frames[local] : undefined;
          if (frame && placement) meshPlacements.set(object,K.sceneGraph.compose(placement.mesh,frame));
          else if (frame || placement) meshPlacements.set(object,frame ?? placement.mesh);
        }
        for (const [local, row] of Object.entries(resolved.groups)) {
          check(!own(spec.groups, name(local)), 'Group ID is already in use: ' + name(local));
          spec.groups[name(local)] = { ...row, ...(placement && { blend: row.blend * placement.scale }) };
        }
        for (const row of Object.values(resolved.motion)) {
          const next = { ...row, part: name(row.part) };
          if (placement) {
            next.axis = placement.direction(row.axis ?? [0, 1, 0]);
            if (reflected(placement) && ['turn','spin'].includes(row.do)) next.axis = V.mul(next.axis,-1);
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
          effectIndices.push(spec.effects.length);
          spec.effects.push(next);
        }
        links.set(key, { instance, definition, resolved, revision: definition.revision, solids: ids, meshes, effectIndices, placement, frame: placement?.mesh, origin:objectOrigin,
          ...(resolvedProperties && {propertyValues:resolvedProperties.values,propertySources:resolvedProperties.sources}), ...(raw.mirror && {mirror:raw.mirror}) });
      } catch (error) {
        throw placementError(key,null,error.message);
      }
    }
    return { spec, instances: links, meshPlacements, properties };
  }

  function planMirror(scene, env, request) {
    const {id,own,record,equal} = K.world.data, {clone,freeze} = K.procedural.data;
    const {action='link',instance,source,plane} = request ?? {};
    if (!record(request) || Object.keys(request).some(key => !['action','instance','source','plane'].includes(key)) ||
        !id(instance) || !['link','commit'].includes(action) ||
        (action === 'link' ? !id(source) : source !== undefined || plane !== undefined))
      throw new TypeError('Link a mirror with source and instance IDs, or commit the named live mirror');
    const before = expand(scene,env), current = before.instances.get(instance), rows = {...scene.instances};
    const report = {format:'ink-studio/prefab-mirror',version:1,scene:scene.id,action,instance,
      source:source ?? current?.mirror?.source ?? null,instances:[],conflicts:[],changed:false,canCommit:false};
    const finish = patch => ({patch,report:freeze(report)});
    const block = (reason, details={}) => {
      report.conflicts.push({reason,...details});
      return finish();
    };
    if (action === 'link') {
      if (!own(rows,source) || rows[source].mirror) return block('choose-an-authored-source');
      if (instance===source || current && current.mirror?.source !== source) return block('instance-in-use');
      const working = plane === undefined && A.constructionPlane.forScene(scene);
      const guide = mirrorPlane(working ? {origin:working.plane.origin,normal:working.axes[2]} : plane);
      rows[instance] = {mirror:{source,plane:guide}};
      report.plane = guide;
    } else {
      if (!current?.mirror) return block('instance-is-not-a-live-mirror');
      const {prefab,overrides,meshOverrides,origin,properties} = current.instance;
      rows[instance] = {prefab,...savedPlacement(current.placement),...(origin && {origin}),
        ...(overrides && {overrides}),...(meshOverrides && {meshOverrides}),...(properties && {properties})};
      report.plane = clone(current.mirror.plane);
    }
    try {
      const after = expand({...scene,instances:rows},env);
      for (const name of [report.source,instance]) {
        const from = before.instances.get(name), to = after.instances.get(name);
        report.instances.push({instance:name,objects:[...new Set([...(from ? objects(from) : []),...objects(to)])],
          beforeWorld:from ? from.frame ?? authored().mesh : null,afterWorld:to.frame ?? authored().mesh});
      }
      if (action === 'commit' && !sameFrame(current.placement,after.instances.get(instance).placement))
        return block('world-placement-drift');
      report.changed = !equal(scene.instances,rows);
      report.canCommit = true;
      return finish({instances:rows});
    } catch (error) {
      report.problems = error.problems ?? [{level:'error',problem:error.message}];
      return finish();
    }
  }

  function review(source, before, after) {
    const {equal, own, selector} = K.world.data;
    return Object.entries(source.instances ?? {}).flatMap(([id, raw]) => {
      const instance = raw.mirror ? source.instances[raw.mirror.source] : raw;
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

  function indexedTargets(scene,before,after,mapAddress = (instance,table,name) => [instance,name]) {
    if (scene.parameterBindings === undefined) return [];
    const indexed = ['solids','motion','effects'], conflicts = [];
    const order = (links,table,remap) => [
      ...(scene[table] ?? []).map((_,index) => [null,index]),
      ...[...links].flatMap(([instance,link]) => Object.keys(link.resolved[table]).map(name =>
        remap ? mapAddress(instance,table,name) : [instance,name]))
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

  A.scenePrefabs = Object.freeze({ expand, placements, planReparent, planMirror, review, origin, placedOrigin, checkProvenance, tilesetRequirements, indexedTargets });
})(KIT);
