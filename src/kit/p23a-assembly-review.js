/* Inspection settings are session data, kept outside the authored scene. */
(function (K) {
  const A = K.authoring, DIO = K.diorama, { clone, freeze } = K.procedural.data;
  const format = 'ink-studio/assembly-review', scopes = ['isolate', 'hide', 'freeze', 'revealThrough'];
  const shotRoles = ['key', 'fill', 'rim', 'negativeFill'];
  const studioSun = [-.42, .75, .51], studioAmbient = .62;
  const kinds = ['sculpt', 'mesh', 'paint', 'light', 'part', 'group', 'prefab'];
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const geometry = row => row.kind === 'sculpt' || row.kind === 'mesh';
  const paintFields = ['sdfPaint', 'sdfSpray', 'surfaceState'];
  const addr = (kind, id) => kind + ':' + id;
  const paintKey = (kind, id) => addr('paint', kind + '/' + id);
  const areaKey = id => addr('light', 'area/' + id);
  const lampKey = i => addr('light', 'lamp/' + i);
  const shotKey = role => addr('light', 'shot/' + role);
  const volumeKey = (kind, i) => addr('light', 'volume/' + kind + (i === undefined ? '' : '/' + i));
  const hasMeshPaint = value => value?.texture !== undefined;
  const named = value => typeof value === 'string' && value.length <= 320 &&
    kinds.some(kind => value.startsWith(kind + ':') && value.slice(kind.length + 1).trim().length);
  const inRange = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;

  function prepare(input) {
    const raw = clone(input ?? {});
    if (!fields(raw, ['format', 'version', ...scopes, 'lighting', 'time', 'revealOpacity']) ||
        (raw.format !== undefined || raw.version !== undefined) && (raw.format !== format || raw.version !== 1))
      throw new TypeError('Expected a version 1 assembly review preset');
    const { lighting = 'shot', time, revealOpacity = .58 } = raw;
    if (!['shot', 'neutral'].includes(lighting) || time !== undefined && !inRange(time, 0, 120) ||
        !inRange(revealOpacity, 0, 1))
      throw new RangeError('Choose shot or neutral lighting, an optional time from 0 to 120 and reveal opacity from 0 to 1');
    const result = { format, version: 1, lighting, ...(time !== undefined && { time }), revealOpacity };
    for (const key of scopes) {
      const values = raw[key] ?? [];
      if (!Array.isArray(values) || values.length > 256 || !Array.from(values).every(named) || new Set(values).size !== values.length)
        throw new TypeError(key + ' needs distinct assembly addresses');
      result[key] = values;
    }
    return freeze(result);
  }

  function sculptPaint(solid) {
    return Object.fromEntries([
      ...paintFields.filter(key => solid[key] !== undefined).map(key => [key, solid[key]]),
      ...(solid.modifiers ?? []).flatMap(row => row.kind === 'grid-brush' && row.brush?.settings?.surface !== undefined ?
        [[row.id, row.brush.settings.surface]] : [])
    ]);
  }

  function meshPaint(row, source) {
    const materials = (row.materials ?? []).filter(hasMeshPaint);
    const bakes = (row.bakes ?? []).filter(bake => hasMeshPaint(bake.maps));
    const tiles = [...new Set(materials.map(item => item.texture?.tileset).filter(Boolean))];
    return { materials, bakes, ...(tiles.length && { tilesets: tiles.map(id => [id, source.tilesets?.[id], source.tilesetSources?.[id]]) }) };
  }

  function stripSculptPaint(solid) {
    const next = { ...solid };
    for (const key of paintFields) delete next[key];
    if (next.modifiers) next.modifiers = next.modifiers.map(row => {
      if (row.kind !== 'grid-brush' || row.brush?.settings?.surface === undefined) return row;
      const { surface, ...settings } = row.brush.settings;
      return { ...row, brush: { ...row.brush, settings } };
    });
    return next;
  }

  function anonymousTags(source) {
    const used = new Set([...DIO.solids(source)].flatMap(solid => [solid?.id, ...(solid?.tags ?? [])]));
    return new Map((source.solids ?? []).flatMap((solid, i) => {
      if (solid.id !== undefined) return [];
      let tag = '@editor/' + i;
      while (used.has(tag)) tag += '_';
      used.add(tag);
      return [[i, tag]];
    }));
  }

  function timelineTargets(timeline) {
    const cache = new Map(), visiting = new Set();
    function targets(node) {
      if (!node || visiting.has(node)) return new Map();
      if (cache.has(node)) return cache.get(node);
      const result = new Map();
      const append = (key, value) => {
        if (!result.has(key)) result.set(key, []);
        result.get(key).push(value);
      };
      visiting.add(node);
      for (const row of node.tracks ?? []) {
        const [root, id] = K.world.data.selector(row.target);
        append(addr(root, id), [row, node.tempoMap]);
      }
      for (const clip of node.clips ?? []) {
        for (const [key, rows] of targets(timeline.sequences?.[clip.sequence]))
          append(key, [clip, node.tempoMap, timeline.tempoMap, rows]);
      }
      visiting.delete(node);
      cache.set(node, result);
      return result;
    }
    return targets(timeline);
  }

  function bindingTargets(source) {
    const program = source.parameterBindings, records = new Map();
    function references(value, output) {
      if (!value || typeof value !== 'object' || Object.hasOwn(value, 'literal')) return;
      if (value.source === 'control' || value.source === 'parameter') capture(value.name, output);
      else for (const child of value.args ?? []) references(child, output);
    }
    function capture(name, output) {
      if (Object.hasOwn(output, name)) return;
      const value = program.values?.[name] ?? program.controls?.[name];
      output[name] = value;
      references(value, output);
    }
    for (const row of program?.bindings ?? []) {
      const [root, id] = K.world.data.selector(row.path), key = addr(root, id);
      const dependencies = Object.create(null);
      capture(row.parameter, dependencies);
      if (!records.has(key)) records.set(key, []);
      records.get(key).push([row, dependencies]);
    }
    return records;
  }

  function inventory(source, env) {
    const { spec: expanded, instances, meshPlacements } = A.scenePrefabs.expand(source, env);
    const { scene: spec } = A.sculptGuides.expand(expanded);
    const settings = DIO.assemblyLighting(spec);
    const { effects = [], motion = [], parts = {} } = spec, result = new Map();
    const tracks = timelineTargets(spec.timeline), bindings = bindingTargets(source);
    const ownerPrefab = new Map();
    for (const [id, row] of instances)
      for (const name of [...row.solids, ...Array.from(row.meshes.values(), mesh => mesh.object)])
        ownerPrefab.set(name, id);
    const add = (kind, id, data, ancestors = [], details = {}) => {
      const key = addr(kind, id);
      if (result.has(key)) throw new RangeError('Duplicate assembly review address ' + key);
      result.set(key, { key, id, kind, data, ancestors: [...new Set(ancestors)], ...details });
    };
    const chain = part => {
      const names = new Set();
      while (part !== undefined && !names.has(part)) {
        names.add(part);
        part = parts[part]?.parent;
      }
      return [...names];
    };
    const partParents = part => chain(part).flatMap(name => [
      addr('part', name), ...[...instances.keys()].filter(id => name.startsWith(id + '.')).map(id => addr('prefab', id))
    ]);
    const partData = part => chain(part).map(id => [id, parts[id], motion.flatMap((row, i) =>
      row.part === id ? [[row, bindings.get(addr('motion', i))]] : []), tracks.get(addr('poses', id))]);
    for (const [id, row] of instances)
      add('prefab', id, [row.instance, row.revision]);
    for (const [id, row] of Object.entries(spec.groups ?? {}))
      add('group', id, row, [...instances.keys()].filter(key => id.startsWith(key + '.')).map(key => addr('prefab', key)));
    const partNames = new Set([...Object.keys(parts), ...(spec.solids ?? []).map(row => row.part),
      ...Object.values(spec.topologyMeshes ?? {}).map(row => row.part),
      ...Object.values(spec.assetParts ?? {}).map(row => row.part), ...effects.map(row => row.follow)]);
    for (const id of partNames) if (id !== undefined) {
      const parents = partParents(id).filter(key => key !== addr('part', id));
      add('part', id, partData(id), parents);
    }

    const surfaces = new Map(), tags = anonymousTags(source);
    for (const [i, solid] of (spec.solids ?? []).entries()) {
      if (solid.hold || solid.carve) continue;
      const kind = solid.kind === 'mesh' ? 'mesh' : 'sculpt', prefab = ownerPrefab.get(solid.id);
      const tag = tags.get(i), id = solid.id ?? '@slot/' + i;
      const parents = [...partParents(solid.part), ...(solid.group ? [addr('group', solid.group)] : []),
        ...(prefab ? [addr('prefab', prefab)] : [])];
      const paint = sculptPaint(solid), carrier = addr(kind, id);
      add(kind, id, [solid, partData(solid.part), spec.groups?.[solid.group], bindings.get(addr('solids', i))], parents,
        { object: solid.id ?? tag, ...(tag && { tag }), ...(solid.part !== undefined && { part: solid.part }) });
      if (solid.id) surfaces.set(solid.id, result.get(carrier));
      if (Object.keys(paint).length)
        add('paint', 'sculpt/' + solid.id, paint, [...parents, carrier], { object: solid.id, carrier });
    }
    for (const [id, row] of [...Object.entries(spec.topologyMeshes ?? {}), ...Object.entries(spec.assetParts ?? {})]) {
      const prefab = ownerPrefab.get(id), carrier = addr('mesh', id);
      const parents = [...partParents(row.part), ...(prefab ? [addr('prefab', prefab)] : [])];
      const paint = meshPaint(row, spec);
      add('mesh', id, [row, meshPlacements.get(id), partData(row.part), paint.tilesets], parents,
        { object: id, ...(row.part !== undefined && { part: row.part }) });
      surfaces.set(id, result.get(carrier));
      if (paint.materials.length || paint.bakes.length)
        add('paint', 'mesh/' + id, paint, [...parents, carrier], { object: id, carrier });
    }
    for (const row of spec.surfaceDecals?.decals ?? []) {
      const receiver = surfaces.get(row.anchor.object);
      add('paint', 'decal/' + row.id, row, receiver ? [...receiver.ancestors, receiver.key] : [],
        { object: row.anchor.object, carrier: receiver?.key });
    }
    for (const row of spec.brushRegion?.strokes ?? []) if (row.mode === 'paint')
      add('paint', 'region/' + row.id, row);
    for (const row of settings.finish.paint?.layers ?? []) add('paint', 'finish/' + row.id, row);

    add('light', 'sun', [settings.sun, settings.amb, settings.sky, spec.light, spec.environmentPreset, settings.finish.liveSun,
      ...['sun', 'amb', 'sky', 'surfaceDirection'].map(key => bindings.get(addr('light', key)))]);
    for (const [i, row] of effects.entries()) if (row.do === 'lamp')
      add('light', 'lamp/' + i, [row, partData(row.follow), tracks.get(addr('effects', i)), bindings.get(addr('effects', i))],
        partParents(row.follow), { point: row.at, ...(row.follow !== undefined && { part: row.follow }) });
    for (const row of Array.isArray(settings.finish.areaLights) ? settings.finish.areaLights : [])
      add('light', 'area/' + row.id, row, [], { point: row.at });
    for (const role of shotRoles) if (settings.finish.shotLighting?.[role])
      add('light', 'shot/' + role, settings.finish.shotLighting[role], [], { point: settings.finish.shotLighting[role].at });
    const volumes = settings.finish.volumeLighting;
    for (const key of ['sun', 'point']) if (volumes?.[key])
      add('light', 'volume/' + key, volumes[key], [], { point: volumes[key].at });
    for (const key of ['points', 'spots']) for (const [i, row] of (volumes?.[key] ?? []).entries())
      add('light', 'volume/' + key + '/' + i, row, [], { point: row.at });
    return result;
  }

  function select(catalog, keys, strict = true) {
    for (const key of keys) if (strict && !catalog.has(key)) throw new RangeError('Unknown assembly review address ' + key);
    const roots = new Set(keys);
    return new Set([...catalog.values()].filter(row => roots.has(row.key) || row.ancestors.some(parent => roots.has(parent)))
      .map(row => row.key));
  }

  function check(before, after, input, env, nextEnv = env) {
    const preset = prepare(input);
    if (!preset.freeze.length || before === after && env === nextEnv) return { canEdit: true, conflicts: [] };
    const previous = inventory(before, env), next = inventory(after, nextEnv);
    const locked = select(previous, preset.freeze), nextLocked = select(next, preset.freeze, false);
    const conflicts = [...new Set([...locked, ...nextLocked])].sort().flatMap(key => {
      const old = previous.get(key), updated = next.get(key);
      if (!locked.has(key) || !nextLocked.has(key) || !K.world.data.equal(old?.data, updated?.data))
        return [{ key, reason: !old ? 'added-to-frozen-scope' : !updated ? 'removed-from-frozen-scope' : 'changed-frozen-item' }];
      return [];
    });
    return freeze({ canEdit: !conflicts.length, conflicts });
  }

  function plan(source, input, env) {
    const preset = prepare(input), catalog = inventory(source, env);
    const resolved = Object.fromEntries(scopes.map(scope => [scope, select(catalog, preset[scope])]));
    const objects = selected => new Set([...catalog.values()].filter(row => row.object && selected.has(row.key) &&
      (geometry(row) || row.kind === 'paint')).map(row => row.object));
    const isolated = objects(resolved.isolate);
    const isolatedLights = [...resolved.isolate].some(key => key.startsWith('light:'));
    const isolatedPaint = isolated.size > 0 || [...resolved.isolate].some(key => key.startsWith('paint:'));
    const allow = (key, isolated = false) => !resolved.hide.has(key) && (!isolated || resolved.isolate.has(key));
    const hidden = new Set([...catalog.values()].filter(row => geometry(row) && !allow(row.key)).map(row => row.object));
    const light = key => preset.lighting === 'shot' && allow(key, isolatedLights);
    const paint = key => allow(key, isolatedPaint);
    const tagged = new Set([...catalog.values()].map(row => row.tag).filter(Boolean));
    const owner = subject => subject.tags?.find(tag => tagged.has(tag)) ?? subject.entity ?? subject.object;
    const visible = subject => {
      const id = owner(subject);
      return !hidden.has(id) && (!isolated.size || isolated.has(id));
    };
    const rows = [...catalog.values()];
    const active = row => geometry(row) ? visible({ entity: row.object }) : row.kind === 'light' ? light(row.key) :
      row.kind === 'paint' ? paint(row.key) && (!row.object || visible({ entity: row.object })) : undefined;
    const activeGroups = new Set(rows.filter(active).flatMap(row => row.ancestors));
    const states = rows.map(({ data, ancestors, key, ...row }) => {
      const visible = active({ ...row, key }) ?? (allow(key) && activeGroups.has(key));
      return { key, ...row, ...(ancestors.length && { parents: ancestors }), visible,
        hidden: resolved.hide.has(key), isolated: resolved.isolate.has(key), frozen: resolved.freeze.has(key),
        revealThrough: resolved.revealThrough.has(key) && (row.kind === 'light' ? !resolved.hide.has(key) : visible) };
    });
    const revealed = new Set(states.filter(row => row.revealThrough && row.object).map(row => row.object));
    const reveal = subject => revealed.has(owner(subject)) && visible(subject);
    const report = freeze(clone({ format, version: 1, scene: source.id, preset, items: states }));
    const scoped = Boolean(isolated.size || hidden.size);
    return {
      report, scoped, visible, reveal, hasReveal: revealed.size > 0,
      studio: preset.lighting === 'neutral',
      scene(spec) {
        const solids = (spec.solids ?? []).map(solid =>
          paint(paintKey('sculpt', solid.id)) ? solid : stripSculptPaint(solid));
        const brushRegion = spec.brushRegion && { ...spec.brushRegion, strokes: (spec.brushRegion.strokes ?? [])
          .filter(row => row.mode !== 'paint' || paint(paintKey('region', row.id))) };
        return { ...spec, ...(spec.solids && { solids }), ...(brushRegion && { brushRegion }) };
      },
      decals(document) {
        return { ...document, decals: document.decals.filter(row => paint(paintKey('decal', row.id))) };
      },
      meshMaterial(object, material) {
        if (!material.texture || paint(paintKey('mesh', object))) return material;
        const texture = SemanticTextureMipmaps.texture(material.texture), pixels = texture.pixels.slice();
        for (let i = 0; i < pixels.length; i += 4) pixels.fill(255, i, i + 3);
        return { ...material, texture: { width: texture.width, height: texture.height, pixels } };
      },
      lighting(style) {
        const finish = { ...style.finish };
        if (Array.isArray(finish.areaLights)) finish.areaLights = finish.areaLights.filter(row => light(areaKey(row.id)));
        if (finish.shotLighting) finish.shotLighting = Object.fromEntries(Object.entries(finish.shotLighting)
          .filter(([key]) => !shotRoles.includes(key) || light(shotKey(key))));
        if (finish.volumeLighting) {
          const { sun, point, points, spots, ...volume } = finish.volumeLighting;
          finish.volumeLighting = { ...volume,
            ...(sun && light(volumeKey('sun')) && { sun }), ...(point && light(volumeKey('point')) && { point }),
            ...(points && { points: points.filter((_, i) => light(volumeKey('points', i))) }),
            ...(spots && { spots: spots.filter((_, i) => light(volumeKey('spots', i))) }) };
        }
        if (finish.paint?.layers) finish.paint = { ...finish.paint,
          layers: finish.paint.layers.filter(row => paint(paintKey('finish', row.id))) };
        if (preset.lighting === 'neutral') {
          for (const key of ['liveSun', 'areaLights', 'shotLighting', 'skyEnvironment', 'celestialTracks', 'relighting', 'bounceProbes',
            'reflectionProbes', 'reflections', 'volumeLighting', 'clouds', 'volumeAtmosphere']) finish[key] = false;
          return { ...style, sun: studioSun, amb: studioAmbient, sky: .2, finish };
        }
        if (!light(addr('light', 'sun'))) {
          finish.liveSun = false;
          finish.relighting = false;
          return { ...style, disableSun: true, sky: 0, finish };
        }
        return { ...style, finish };
      },
      lamp: i => light(lampKey(i))
    };
  }

  A.assemblyReview = Object.freeze({ format, prepare, plan, check, anonymousTags });
})(KIT);
