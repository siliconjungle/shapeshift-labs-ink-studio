/* Retained inputs for stitched, editable terrain sets. */
(function (K) {
  const P = K.procedural, { clone, freeze, hash } = P.data;
  const format = 'ink-studio/terrain-set';
  const key = at => at.join('/');
  const finite = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
  const pair = (value, valid) => Array.isArray(value) && value.length === 2 && Array.from(value).every(valid);
  const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) &&
    !['constructor', 'prototype'].includes(value);
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, names) => record(value) && Object.keys(value).every(n => names.includes(n));
  function need(ok, message) {
    if (!ok) throw new RangeError('Terrain set: ' + message);
  }
  function named(rows, limit, label, check) {
    need(Array.isArray(rows) && rows.length <= limit, 'expected up to ' + limit + ' ' + label);
    const names = new Set();
    return Array.from(rows, row => {
      need(record(row) && id(row.id) && !names.has(row.id), label + ' need distinct IDs');
      names.add(row.id);
      check(row);
      return row;
    });
  }

  function grid(raw) {
    need(fields(raw, ['origin', 'cell', 'tileCells', 'size']) && pair(raw.origin, n => finite(n, -1e5, 1e5)) &&
      finite(raw.cell, .025, 10) && integer(raw.tileCells, 2, 128) && pair(raw.size, n => integer(n, 1, 128)),
    'invalid world grid');
    const [x, z] = raw.size, { cell, tileCells, origin } = raw;
    need(x * z <= 256 && (x * tileCells + 1) * (z * tileCells + 1) <= 120000 &&
      origin.every((n, k) => finite(n + raw.size[k] * cell * tileCells, -1e5, 1e5)), 'world exceeds the tile or sample budget');
    return raw;
  }

  function create(source) {
    if (documents.has(source)) return source;
    need(fields(source, ['format', 'version', 'id', 'seed', 'grid', 'tiles', 'stitch', 'erosion',
      'masks', 'biomes', 'prototypes', 'scatter', 'routes', 'replacements']) && source.format === format &&
      source.version === 1 && id(source.id), 'expected a version 1 terrain recipe');
    const { seed = 1, stitch = {}, erosion = null, masks = [], biomes = { fallback: 'ground' },
      prototypes = [], scatter = [], routes = [], replacements = [] } = source;
    need(integer(seed, 0, 2147483647), 'invalid seed');
    const config = grid(source.grid), { origin, cell, tileCells, size } = config;
    const max = origin.map((n, i) => n + tileCells * size[i] * cell);
    const inWorld = p => pair(p, n => finite(n, -1e5, 1e5)) && p.every((n, i) => n >= origin[i] && n <= max[i]);
    const tileLength = (tileCells + 1)**2, addresses = new Set();
    need(Array.isArray(source.tiles) && source.tiles.length === size[0] * size[1], 'provide one height tile per address');
    const tiles = Array.from(source.tiles, row => {
      need(fields(row, ['at', 'heights']) && pair(row.at, n => integer(n, 0, 127)) &&
        row.at.every((n, i) => n < size[i]) && !addresses.has(key(row.at)) &&
        Array.isArray(row.heights) && row.heights.length === tileLength &&
        Array.from(row.heights).every(n => finite(n, -10000, 10000)), 'invalid tile address or height buffer');
      addresses.add(key(row.at));
      return row;
    }).sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);

    need(fields(stitch, ['mode', 'tolerance']) && ['average', 'strict'].includes(stitch.mode ?? 'average') &&
      finite(stitch.tolerance ?? 1e-6, 0, 10), 'invalid stitch mode or tolerance');
    const layers = named(prototypes, 128, 'prototypes', row => {
      need(fields(row, ['id', 'variants']), 'invalid prototype ' + row.id);
      const options = named(row.variants, 24, 'variants', variant => {
        need(fields(variant, ['id', 'weight', 'lods']) && finite(variant.weight ?? 1, 0, 1000) &&
          Array.isArray(variant.lods) && variant.lods.length >= 1 && variant.lods.length <= 8, 'invalid variant');
        let prior = -1;
        for (const lod of variant.lods) {
          need(fields(lod, ['distance', 'asset']) && finite(lod.distance, 0, 1e6) && lod.distance > prior &&
            id(lod.asset) && (prior >= 0 || lod.distance === 0), 'LOD distances must start at zero and increase');
          prior = lod.distance;
        }
      });
      need(options.some(row => (row.weight ?? 1) > 0), 'prototype needs a positive variant weight');
    });
    const prototypeIds = new Set(layers.map(row => row.id));
    const paths = named(routes, 64, 'routes', row => {
      const common = ['id', 'kind', 'width', 'points'];
      const more = { road: [], river: ['depth', 'grade', 'waterHeight'], buildings: ['prototypeId', 'spacing', 'setback', 'side'] };
      need(Object.hasOwn(more, row.kind) && fields(row, common.concat(more[row.kind])) &&
        finite(row.width, .03, 50), 'invalid route ' + row.id);
      const points = named(row.points, 129, 'route points', point => need(fields(point, ['id', 'at']) &&
        inWorld(point.at), 'route points must be inside the world'));
      need(points.length >= 2 && points.slice(1).every((p, i) =>
        Math.hypot(p.at[0] - points[i].at[0], p.at[1] - points[i].at[1]) > 1e-6), 'route needs distinct neighboring points');
      if (row.kind === 'river') need(finite(row.depth ?? .25, .01, 10) && finite(row.grade ?? .006, 0, 1) &&
        (row.waterHeight === undefined || finite(row.waterHeight, -1e4, 1e4)), 'invalid river depth, grade or head');
      if (row.kind === 'buildings') need(prototypeIds.has(row.prototypeId) && finite(row.spacing, .1, 100) &&
        finite(row.setback ?? 0, 0, 50) && ['left', 'right', 'both'].includes(row.side ?? 'right'), 'invalid building frontage');
    });
    const routeIds = new Set(paths.map(row => row.id));
    need(paths.reduce((n, row) => n + row.points.length - 1, 0) <= 384, 'route segment budget exceeded');

    const masksOut = named(masks, 16, 'masks', row => {
      if (row.source === 'paint') {
        need(fields(row, ['id', 'source', 'strokes']) && Array.isArray(row.strokes) && row.strokes.length <= 96 &&
          row.strokes.every(stroke => Array.isArray(stroke?.points) && stroke.points.length <= 128),
        'invalid painted mask or stroke budget');
        P.masks.compose(row.strokes);
      } else {
        need(['height', 'slope', 'moisture', 'incision', 'route'].includes(row.source) &&
          fields(row, ['id', 'source', 'range', 'feather', ...(row.source === 'route' ? ['route'] : [])]) &&
          pair(row.range, n => finite(n, -1e5, 1e5)) && row.range[0] <= row.range[1] &&
          finite(row.feather ?? 0, 0, 100) && (row.source !== 'route' || routeIds.has(row.route)), 'invalid derived mask');
      }
    });
    const maskIds = new Set(masksOut.map(row => row.id));
    const painted = new Set(masksOut.filter(row => row.source === 'paint').map(row => row.id));
    if (erosion !== null) {
      need(fields(erosion, ['strength', 'steps', 'maxDepth', 'minArea', 'protect']) &&
        finite(erosion.strength ?? .2, 0, 10) && integer(erosion.steps ?? 3, 1, 32) &&
        finite(erosion.maxDepth ?? 1, 1e-5, 10) && finite(erosion.minArea ?? 0, 0, 1e6) &&
        (erosion.protect === undefined || painted.has(erosion.protect)), 'invalid erosion settings or nonpainted protection mask');
    }
    need(fields(biomes, ['fallback', 'regions']) && id(biomes.fallback), 'biomes need a fallback ID');
    const zones = named(biomes.regions ?? [], 16, 'biome regions', row => {
      need(fields(row, ['id', 'mask', 'weight']) && maskIds.has(row.mask) && finite(row.weight ?? 1, 0, 1),
        'biome region needs a valid mask and weight');
    });
    const biomeIds = new Set([biomes.fallback, ...zones.map(row => row.id)]);
    const populations = named(scatter, 16, 'scatter layers', row => {
      need(fields(row, ['id', 'prototypeId', 'density', 'mask', 'biomes', 'clearance', 'options']) &&
        prototypeIds.has(row.prototypeId) && finite(row.density, 0, 1) &&
        (row.mask === undefined || maskIds.has(row.mask)) &&
        (row.biomes === undefined || Array.isArray(row.biomes) && row.biomes.length <= 17 &&
          row.biomes.every(name => biomeIds.has(name))) && finite(row.clearance ?? 0, 0, 20), 'invalid scatter layer');
      need(fields(row.options ?? {}, ['spacing', 'jitter', 'slots', 'seed', 'maxCandidates', 'maxInstances', 'exclusion']),
        'invalid population options');
      P.populations.parameters(row.options ?? {});
    });
    need(Array.isArray(replacements) && replacements.length <= 4096, 'replacement budget exceeded');
    const replaced = new Set();
    for (const row of replacements) {
      need(fields(row, ['id', 'prototypeId']) && typeof row.id === 'string' && row.id.length <= 250 &&
        /^(scatter|frontage)\/[A-Za-z0-9_:/-]+$/.test(row.id) && !replaced.has(row.id) &&
        (row.prototypeId === null || prototypeIds.has(row.prototypeId)), 'invalid replacement');
      replaced.add(row.id);
    }
    const document = freeze(clone({ format, version: 1, id: source.id, seed, grid: config, tiles, stitch, erosion,
      masks: masksOut, biomes: { fallback: biomes.fallback, regions: zones }, prototypes: layers,
      scatter: populations, routes: paths, replacements }));
    const text = JSON.stringify(document);
    documents.set(document, [text.length, hash(text), hash(text, 0x9e3779b9)].map(n => n.toString(36)).join('-'));
    return document;
  }

  const documents = new WeakMap();
  const revision = source => documents.get(create(source));
  function inspect(source) {
    const doc = create(source);
    return { id: doc.id, revision: revision(doc), grid: doc.grid, tiles: doc.tiles.length, masks: doc.masks.map(m => m.id),
      biomes: doc.biomes, prototypes: doc.prototypes, erosion: doc.erosion,
      routes: doc.routes, scatter: doc.scatter, replacements: doc.replacements };
  }

  function edit(source, request) {
    const document = create(source), before = revision(document);
    need(fields(request, ['revision', 'operations']) && Array.isArray(request.operations) &&
      integer(request.operations.length, 1, 128) && (request.revision === undefined || request.revision === before),
    'expected 1 to 128 operations against this revision');
    // Share full tile samples while validating edits to the retained authoring data.
    const draft = { ...document, routes: clone(document.routes), replacements: clone(document.replacements),
      masks: clone(document.masks) };
    for (const change of request.operations) {
      need(record(change), 'invalid edit operation');
      if (change.op === 'set-replacement' || change.op === 'clear-replacement') {
        const index = draft.replacements.findIndex(row => row.id === change.id);
        if (change.op === 'clear-replacement') {
          need(fields(change, ['op', 'id']) && index >= 0, 'unknown replacement');
          draft.replacements.splice(index, 1);
        } else {
          need(fields(change, ['op', 'id', 'prototypeId']), 'invalid replacement edit');
          const { id, prototypeId } = change;
          draft.replacements.splice(index < 0 ? draft.replacements.length : index, index < 0 ? 0 : 1, { id, prototypeId });
        }
        continue;
      }
      if (change.op === 'set-mask' || change.op === 'set-route') {
        const kind = change.op === 'set-mask' ? 'mask' : 'route', list = draft[kind + 's'], row = change[kind];
        need(fields(change, ['op', kind]) && record(row), 'expected a complete ' + kind);
        const index = list.findIndex(item => item.id === row.id);
        if (index < 0) list.push(row);
        else list[index] = row;
        continue;
      }
      const route = draft.routes.find(row => row.id === change.route);
      const index = route?.points.findIndex(row => row.id === change.point);
      if (change.op === 'move-point') {
        need(fields(change, ['op', 'route', 'point', 'at']) && index >= 0, 'unknown control point');
        route.points[index].at = change.at;
      } else if (change.op === 'insert-point') {
        need(fields(change, ['op', 'route', 'point', 'after', 'at']) && route && index < 0, 'invalid insertion');
        const after = route.points.findIndex(row => row.id === change.after);
        need(after >= 0, 'unknown preceding point');
        route.points.splice(after + 1, 0, { id: change.point, at: change.at });
      } else if (change.op === 'remove-point') {
        need(fields(change, ['op', 'route', 'point']) && index >= 0, 'unknown point to remove');
        route.points.splice(index, 1);
      } else need(false, 'unknown operation ' + change.op);
    }
    const updated = create(draft);
    return { document: updated, report: { revision: before, outputRevision: revision(updated), operations: clone(request.operations) } };
  }

  P.terrainSet = { format, create, inspect, edit, revision };
})(KIT);
