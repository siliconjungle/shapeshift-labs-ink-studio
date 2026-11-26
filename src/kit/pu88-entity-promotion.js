/* Promote an explicit selection from one committed scene frame into a visual recipe. */
(function (K) {
  const W = K.world, DIO = K.diorama, { V } = K;
  const { clone, freeze } = K.procedural.data;
  const { record, id, own, equal, vector } = W.data;
  const format = 'ink-studio/entity-promotion', maxSelection = 256, maxPalette = 48;
  const keys = (row, list) => record(row) && Object.keys(row).every(key => list.includes(key));
  const parentOf = entity => entity.anchor?.entity ?? entity.parent;
  const snapshotHandle = candidate => candidate?.view && typeof candidate.query === 'function' && typeof candidate.view === 'function';

  function open(source, { place, runtime = {} } = {}) {
    const R = W.runtime;
    if (typeof source?.current === 'function') {
      const active = source.current();
      if (!active || place !== undefined && place !== active.id || !snapshotHandle(active.asset))
        throw new RangeError('Choose the active native simulation place for promotion');
      return { view: active.asset.view(), query: active.asset.query(), place: active.id, lifecycle: source.lifecycle };
    }
    if (snapshotHandle(source)) return { view: source.view(), query: source.query(), place };
    if (record(source?.view?.world) && typeof source.query?.frame === 'function')
      return { view: source.view, query: source.query, place };
    let lifecycle, checkpoint, input = source;
    if (record(source?.saved) && Object.hasOwn(source, 'place')) {
      place ??= source.place;
      if (!id(place) || !own(source.saved, place)) throw new RangeError('Choose a saved native simulation place');
      input = source.saved[place];
      if (source.lifecycle) {
        const store = W.entityLifecycle.create();
        store.planRestore(source.lifecycle).commit();
        lifecycle = store.api;
      }
    }
    if (input?.format === 'ink-studio/simulation-place') {
      if (input.version !== 1 || place !== undefined && place !== input.place)
        throw new RangeError('Simulation place checkpoint does not match the requested place');
      place = input.place;
      input = input.checkpoint;
    }
    if (input?.format === R.runFormat) {
      if (input.version !== 1 || input.end?.format !== R.checkpointFormat)
        throw new TypeError('Invalid native run for entity promotion');
      input = input.end;
    }
    if (input?.format === R.checkpointFormat) checkpoint = input;
    const manifest = checkpoint?.world ?? input;
    if (!record(manifest) || manifest.format !== W.format)
      throw new TypeError('Promote from an Ink world runtime, checkpoint, recording or native place save');
    const run = R.create(manifest, { ...runtime, checkpoint });
    const overlay = lifecycle?.scene(place);
    return { ...run.projectEntities(overlay), place, lifecycle };
  }

  function settings(input) {
    const value = clone(input);
    if (!keys(value, ['format', 'version', 'id', 'select']) ||
        (value.format !== undefined || value.version !== undefined) && (value.format !== format || value.version !== 1) ||
        typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(value.id) ||
        !Array.isArray(value.select) || value.select.length < 1 || value.select.length > maxSelection)
      throw new TypeError('A promotion needs a lowercase scene ID and 1–' + maxSelection + ' selectors');
    for (const row of value.select) {
      if (keys(row, ['entity', 'descendants']) && id(row.entity) &&
          (row.descendants === undefined || typeof row.descendants === 'boolean')) continue;
      if (keys(row, ['body', 'field']) && id(row.body) && typeof row.field === 'string' &&
          /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(row.field)) continue;
      if (keys(row, ['spawn']) && keys(row.spawn, ['id', 'generation']) && id(row.spawn.id) &&
          Number.isSafeInteger(row.spawn.generation) && row.spawn.generation > 0) continue;
      if (keys(row, ['within']) && keys(row.within, ['point', 'radius']) && vector(row.within.point) &&
          Number.isFinite(row.within.radius) && row.within.radius > 0) continue;
      throw new TypeError('Select an entity, a qualified physics body, a generation-qualified spawn or a radius');
    }
    return value;
  }

  function capture(source, options) {
    const opened = open(source, options), snapshot = W.promotionSnapshot(opened.view, opened.query);
    const rows = [...snapshot.bodies, ...snapshot.objects];
    const lifetimes = new Map();
    for (const group of opened.lifecycle?.checkpoint().groups ?? []) {
      for (const entity of Object.keys(group.entities))
        lifetimes.set(entity, { id: group.id, generation: group.generation, place: group.place, loaded: group.loaded });
    }
    return { ...opened, snapshot, rows, lifetimes };
  }

  function describe(row, lifetimes) {
    const lifetime = lifetimes.get(row.entity);
    return { type: row.type, id: row.id, ...(row.field && { field: row.field }), entity: row.entity,
      position: row.position, rotation: row.rotation, material: row.material.materialId,
      ...(row.surface && { painted: true }), ...(lifetime && { lifetime }) };
  }

  function inspect(source, options) {
    const data = capture(source, options);
    return freeze(clone({ world: data.snapshot.world.id, tick: data.snapshot.tick, time: data.snapshot.time,
      ...(data.place !== undefined && { place: data.place }), objects: data.rows.map(row => describe(row, data.lifetimes)) }));
  }

  function select(data, selectors) {
    const { snapshot: { world: { entities } }, rows, lifecycle, place } = data;
    const selected = new Set();
    function descendant(row, root) {
      for (let cursor = row.entity; cursor !== undefined && cursor !== null; ) {
        if (cursor === root) return true;
        cursor = own(entities, cursor) ? parentOf(entities[cursor]) : undefined;
      }
      return false;
    }
    for (const request of selectors) {
      let hits;
      if (request.entity) hits = rows.filter(row => request.descendants ? descendant(row, request.entity) : row.entity === request.entity);
      if (request.body) hits = rows.filter(row => row.type === 'body' && row.field === request.field && row.id === request.body);
      if (request.spawn) {
        const group = lifecycle?.get(request.spawn.id, request.spawn.generation);
        if (!group) throw new RangeError('Unknown or stale spawn ' + request.spawn.id);
        if (!group.loaded || group.place !== place) throw new RangeError('Spawn is not loaded in the captured place: ' + group.id);
        hits = rows.filter(row => own(group.entities, row.entity));
      }
      if (request.within)
        hits = rows.filter(row => V.dist(request.within.point, row.position) <= request.within.radius);
      if (!hits.length) throw new RangeError('Selection found no promotable visual objects: ' + JSON.stringify(request));
      for (const row of hits) selected.add(row);
      if (selected.size > maxSelection) throw new RangeError('Promotion is limited to ' + maxSelection + ' objects');
    }
    return rows.filter(row => selected.has(row));
  }

  function paletteMapper(colors, base) {
    const palette = base ? DIO.sceneMaterials(base).palette.slice() : colors.slice(0, maxPalette);
    const mapped = new Map();
    function swatch(index) {
      if (!Number.isInteger(index) || index < 0 || index >= colors.length)
        throw new RangeError('Source material uses a swatch outside the captured palette: ' + index);
      if (!mapped.has(index)) {
        const color = colors[index];
        let found = !base && index < palette.length && palette[index] === color ? index : palette.indexOf(color);
        if (found === -1) {
          if (palette.length === maxPalette)
            throw new RangeError('Promotion exceeds the 48-color scene palette. Choose a destination with space for the exact swatches');
          found = palette.push(color) - 1;
        }
        mapped.set(index, found);
      }
      return mapped.get(index);
    }
    return { palette, swatch };
  }

  function material(row, swatch) {
    const { r, albedo, surface, ...rest } = row.material;
    if (!Array.isArray(r) || !r.length) throw new TypeError('A promoted material needs a palette ramp');
    return { ...rest, ramp: r.map(swatch), ...(surface && { surface }),
      ...(albedo !== undefined && { albedo: typeof albedo === 'number' ? swatch(albedo) : albedo }) };
  }

  function surfaceCapture({ mapping, atlas }, swatch) {
    if (!atlas) throw new RangeError('The selected body is missing its saved paint atlas');
    const names = new Set(Object.values(mapping.faces).map(row => row.stateChart ?? row.chart));
    const { fresh, faces } = mapping, defaults = K.procedural.surfaceState.channels();
    return { faces, fresh: { ...fresh, ...(fresh.ramp && { ramp: fresh.ramp.map(swatch) }) },
      channels: Object.fromEntries(Object.entries(atlas.channels).filter(([name, value]) => !equal(defaults[name], value))),
      charts: Object.fromEntries([...names].map(name => [name, atlas.charts[name]])) };
  }

  function idFor(prefix, row) {
    const suffix = row.type === 'body' ? 'body.' + row.field + '/' + row.id : 'entity.' + row.id;
    return prefix + '.' + (suffix.length <= 190 ? suffix : suffix.slice(0, 160) + '.' +
      K.procedural.data.hash(suffix, 0).toString(36));
  }

  function makeSolid(row, request, resolution, swatch) {
    if (!vector(row.position) || !K.anim.keyframeTrack.orientation(row.rotation) ||
        !vector(row.half) || row.half.some(n => row.shape?.collider ? n < 0 : n <= 0))
      throw new RangeError('Invalid captured transform or shape for ' + row.id);
    return { id: idFor(request.id, row), kind: row.shape ? 'body-shape' : 'box',
      at: [0, 0, 0], half: row.half, ...(row.shape ?? (row.round ? { round: row.round } : {})),
      restAffine: { position: row.position, matrix: row.rotation },
      mat: material(row, swatch), res: Math.max(.02, resolution), group: request.id,
      ...(row.surfaceId && { surfaceId: row.surfaceId }),
      ...(row.sockets && { sockets: Object.fromEntries(Object.entries(row.sockets).map(([id, p]) => [id, { p }])) }),
      ...(row.tags && { tags: row.tags }), ...(row.surface && { bodySurface: surfaceCapture(row.surface, swatch) }) };
  }

  function plan(source, input, { base, env, ...options } = {}) {
    const request = settings(input), data = capture(source, options), { snapshot } = data;
    const chosen = select(data, request.select);
    let seed = base ?? { id: request.id, seed: snapshot.world.seed, camera: snapshot.camera,
      style: { palette: snapshot.colors.slice(0, maxPalette), roles: { stone: [0] } }, solids: [] };
    if (!Array.isArray(seed.solids) || seed.brushRegion != null)
      throw new TypeError('The destination needs a native editable diorama');
    const { palette, swatch } = paletteMapper(snapshot.colors, base);
    const solids = chosen.map(row => makeSolid(row, request, snapshot.resolution, swatch)), additions = [], receipts = [];
    const expanded = K.authoring.scenePrefabs.expand(seed, env).spec;
    const occupied = new Map([...DIO.solids(K.authoring.sculptGuides.expand(expanded).scene)].filter(row => row.id)
      .map(row => [row.id, row]));
    const meshes = new Set([...Object.keys(expanded.topologyMeshes ?? {}), ...Object.keys(seed.assetParts ?? {})]);
    const group = seed.groups?.[request.id];
    if (group && group.blend !== 0) throw new RangeError('Promotion group overlaps an existing blended group: ' + request.id);
    for (const [i, solid] of solids.entries()) {
      const previous = occupied.get(solid.id);
      if (meshes.has(solid.id) || previous && !equal(previous, solid))
        throw new RangeError('Destination already contains a different object named ' + solid.id);
      if (!previous) additions.push(solid);
      occupied.set(solid.id, solid);
      receipts.push({ ...describe(chosen[i], data.lifetimes), solid: solid.id, status: previous ? 'retained' : 'added' });
    }
    const looks = chosen.some(row => row.material.surface || row.material.lookAsset !== undefined);
    const roles = { ...seed.roles };
    if (looks || !base) for (const [role, ramp] of Object.entries(snapshot.roles))
      if (Array.isArray(ramp) && ramp.length && ramp.every(Number.isInteger)) {
        const next = ramp.map(swatch), prior = base && DIO.sceneMaterials(base).roles[role];
        if (prior && !equal(prior, next)) throw new RangeError('Destination uses a different palette role named ' + role);
        roles[role] = next;
      }
    const assetPacks = [...(seed.assetPacks ?? [])];
    if (chosen.some(row => row.material.lookAsset !== undefined)) for (const pack of snapshot.world.assetPacks ?? []) {
      const prior = assetPacks.find(row => row.id === pack.id);
      if (prior && !equal(prior, pack)) throw new RangeError('Destination has a different asset pack named ' + pack.id);
      if (!prior) assetPacks.push(pack);
    }
    seed = { ...seed, palette, ...(Object.keys(roles).length && { roles }),
      ...(assetPacks.length && { assetPacks }), groups: { ...seed.groups, [request.id]: { blend: 0 } },
      solids: [...seed.solids, ...additions] };
    const problems = DIO.check(seed, env).filter(row => row.level === 'error');
    if (problems.length) throw Object.assign(new RangeError(DIO.report(problems)), { problems });
    return freeze(clone({ scene: seed, report: { format, version: 1, world: snapshot.world.id, tick: snapshot.tick,
      time: snapshot.time, ...(data.place !== undefined && { place: data.place }), scene: seed.id,
      group: request.id, added: additions.length, objects: receipts } }));
  }

  W.entityPromotion = Object.freeze({ format, inspect, plan });
})(KIT);
