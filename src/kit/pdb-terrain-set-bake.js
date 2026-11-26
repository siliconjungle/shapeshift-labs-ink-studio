/* Compile shared height samples, route fragments and stable populations into independent tiles. */
(function (K) {
  const P = K.procedural, API = P.terrainSet, V = K.V, { freeze, hash } = P.data;
  const tileFormat = 'ink-studio/terrain-tile';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi));
  const blend = (a, b, t) => a + (b - a) * t;
  const smooth = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const key = p => p.join('/');
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function lattice({ origin, cell, tileCells, size }) {
    const [width, rows] = size.map(n => n * tileCells + 1), count = width * rows;
    const maximum = [origin[0] + (width - 1) * cell, origin[1] + (rows - 1) * cell];
    const bounds = { min: [origin[0], -20000, origin[1]], max: [maximum[0], 20000, maximum[1]] };
    const at = (x, z) => x + width * z;
    const point = i => [origin[0] + i % width * cell, origin[1] + Math.floor(i / width) * cell];
    const contains = (x, z) => x >= origin[0] && z >= origin[1] && x <= maximum[0] && z <= maximum[1];
    const lookup = values => (x, z) => {
      const u = clamp((x - origin[0]) / cell, 0, width - 1), v = clamp((z - origin[1]) / cell, 0, rows - 1);
      const i = Math.min(width - 2, Math.floor(u)), j = Math.min(rows - 2, Math.floor(v));
      const a = at(i, j), b = a + width;
      return blend(blend(values[a], values[a + 1], u - i), blend(values[b], values[b + 1], u - i), v - j);
    };
    function tileSlots([tx, tz]) {
      const side = tileCells + 1;
      return Array.from({ length: side * side }, (_, i) => at(tx * tileCells + i % side, tz * tileCells + Math.floor(i / side)));
    }
    return { width, rows, count, bounds, at, point, contains, lookup, tileSlots };
  }

  function stitch(doc, L, slots) {
    const samples = new Uint8Array(L.count), sum = new Float64Array(L.count),
      lo = new Float64Array(L.count).fill(Infinity), hi = new Float64Array(L.count).fill(-Infinity);
    for (const tile of doc.tiles) for (const [i, slot] of slots.get(key(tile.at)).entries()) {
      const h = tile.heights[i];
      sum[slot] += h;
      samples[slot]++;
      lo[slot] = Math.min(lo[slot], h);
      hi[slot] = Math.max(hi[slot], h);
    }
    const { mode = 'average', tolerance = 1e-6 } = doc.stitch;
    let sharedVertices = 0, mismatchedVertices = 0, maxDelta = 0;
    for (const [i, n] of samples.entries()) {
      sum[i] /= n;
      if (n < 2) continue;
      sharedVertices++;
      const delta = hi[i] - lo[i];
      maxDelta = Math.max(maxDelta, delta);
      if (delta > tolerance) mismatchedVertices++;
    }
    if (mode === 'strict' && mismatchedVertices)
      throw new RangeError('Terrain stitch exceeds tolerance at ' + mismatchedVertices + ' shared vertices');
    return { heights: sum, report: { mode, tolerance, sharedVertices, mismatchedVertices, maxDelta } };
  }

  function prepareRoutes(doc, ground) {
    const rows = doc.routes.map(row => {
      const planar = P.routes.polyline(row.points.map(({ at: [x, z] }) => [x, 0, z]));
      const points = [];
      for (const [i, [x, , z]] of planar.points.entries()) {
        let y = ground(x, z);
        if (row.kind === 'river') {
          y -= (row.depth ?? .25) * .25;
          if (i === 0) y = row.waterHeight ?? y;
          else {
            const p = points[i - 1], horizontal = Math.hypot(x - p[0], z - p[2]);
            y = Math.min(y, p[1] - (row.grade ?? .006) * horizontal);
          }
        }
        if (Math.abs(y) > 19990) throw new RangeError('Route elevation exceeds the terrain bounds on ' + row.id);
        points.push([x, y, z]);
      }
      return { row, planar, points, index: P.contacts.field([{ id: row.id, points: planar.points }]) };
    });
    function field(kind) {
      const active = rows.filter(({ row }) => row.kind === kind), maxWidth = Math.max(0, ...active.map(({ row }) => row.width));
      const index = P.contacts.field(active.map(({ row, planar }) => ({ id: row.id, points: planar.points })));
      const lookup = new Map(active.map(item => [item.row.id, item]));
      return (x, z, padding = 0) => {
        const hit = index.nearest([x, 0, z], maxWidth + padding);
        if (!hit) return null;
        const { row, planar, points } = lookup.get(hit.id);
        const [a, b] = planar.points.slice(hit.segment, hit.segment + 2);
        const u = V.dist(a, hit.point) / V.dist(a, b), y = blend(points[hit.segment][1], points[hit.segment + 1][1], u);
        return { distance: hit.distance, y, width: row.width, depth: row.depth ?? .25 };
      };
    }
    return { rows, river: field('river'), road: field('road') };
  }

  function selectedMasks(doc, { L, height, moisture, depth, routes, paint }) {
    const byId = new Map(routes.rows.map(item => [item.row.id, item.index]));
    const slope = (x, z) => {
      const h = doc.grid.cell, [x0, , z0] = L.bounds.min, [x1, , z1] = L.bounds.max;
      const a = Math.max(x0, x - h), b = Math.min(x1, x + h), c = Math.max(z0, z - h), d = Math.min(z1, z + h);
      return Math.hypot((height(b, z) - height(a, z)) / (b - a), (height(x, d) - height(x, c)) / (d - c));
    };
    const sources = { height, slope, moisture, incision: L.lookup(depth) };
    const masks = Object.fromEntries(doc.masks.map(row => {
      if (row.source === 'paint') return [row.id, paint[row.id]];
      const [low, high] = row.range, feather = row.feather ?? 0;
      const f = row.source === 'route' ? (x, z) => byId.get(row.route).nearest([x, 0, z], Math.max(0, high + feather))?.distance ?? Infinity
        : sources[row.source];
      return [row.id, (x, z) => {
        const n = f(x, z);
        if (n >= low && n <= high) return 1;
        return feather ? smooth(1 - Math.max(low - n, n - high) / feather) : 0;
      }];
    }));
    return masks;
  }

  function scatter(doc, { L, height, biome, masks, routes, tileGrid }) {
    const overrides = new Map(doc.replacements.map(row => [row.id, row.prototypeId]));
    const prototypeById = new Map(doc.prototypes.map(row => [row.id, row]));
    const choices = new Map(doc.prototypes.map(row => [row.id, P.populations.mix(row.variants.map(variant => ({
      key: variant.id, weight: variant.weight ?? 1
    })), { seed: hash(row.id, doc.seed) })]));
    const records = new Map(doc.tiles.map(tile => [key(tile.at), []]));
    const used = new Set(), work = [];
    let removed = 0, total = 0;
    function place(id, group, defaultPrototype, point, yaw, scale, seed) {
      const tile = tileGrid.index([point[0], point[2]]).map((n, k) => clamp(n, 0, doc.grid.size[k] - 1));
      if (overrides.has(id)) used.add(id);
      const prototypeId = overrides.has(id) ? overrides.get(id) : defaultPrototype;
      if (prototypeId === null) { removed++; return; }
      if (++total > 24000) throw new RangeError('Terrain set exceeds its instance budget');
      const variant = choices.get(prototypeId)([point[0], point[2]], seed);
      const row = prototypeById.get(prototypeId).variants.find(row => row.id === variant);
      records.get(key(tile)).push({ id, group, point, yaw, scale, prototypeId, variant, lods: row.lods });
    }
    for (const layer of doc.scatter) {
      const clear = layer.clearance ?? 0;
      const plan = P.populations.layout([L.bounds], (x, z) => {
        if (!L.contains(x, z)) return null;
        if (layer.biomes && !layer.biomes.includes(biome(x, z))) return null;
        const local = layer.mask ? masks[layer.mask](x, z) : 1;
        if (!local) return null;
        for (const field of [routes.road, routes.river]) {
          const hit = field(x, z, clear);
          if (hit && hit.distance < hit.width / 2 + clear) return null;
        }
        return { density: layer.density * local };
      }, { seed: hash(layer.id, doc.seed), ...layer.options });
      work.push({ id: layer.id, ...plan.sampling, placed: plan.instances.length });
      for (const item of plan.instances) {
        const [x, z] = item.point;
        place('scatter/' + layer.id + '/' + item.key, layer.id, layer.prototypeId,
          [x, height(x, z), z], item.yaw, item.scale, item.seed);
      }
    }
    for (const { row, planar } of routes.rows) {
      if (row.kind !== 'buildings') continue;
      // Keep stations local to each control-point pair so other spans do not renumber.
      for (let i = 0; i < planar.points.length - 1; i++) {
        const a = planar.points[i], b = planar.points[i + 1], leg = P.routes.polyline([a, b]);
        const count = Math.floor(leg.length / row.spacing);
        if (count > 4096) throw new RangeError('Terrain frontage exceeds its station budget');
        const sides = row.side === 'both' ? [-1, 1] : [row.side === 'left' ? -1 : 1];
        const span = row.points[i].id + ':' + row.points[i + 1].id;
        for (let j = 0; j < count; j++) for (const side of sides) {
          const anchor = leg.sample((j + .5) * row.spacing / leg.length);
          const [x, , z] = V.mad(anchor.point, V.cross(anchor.tangent, [0, 1, 0]), side * (row.width / 2 + (row.setback ?? 0)));
          if (!L.contains(x, z)) continue;
          const id = 'frontage/' + row.id + '/' + span + '/' + j + '/' + (side > 0 ? 'right' : 'left'), seed = hash(id, doc.seed);
          place(id, row.id, row.prototypeId, [x, height(x, z), z], Math.atan2(anchor.tangent[0], anchor.tangent[2]), 1, seed);
        }
      }
    }
    for (const list of records.values()) list.sort((a, b) => cmp(a.id, b.id));
    return { records, report: { total, layers: work, replacements: used.size, removed,
      unmatched: [...overrides.keys()].filter(id => !used.has(id)).sort(cmp) } };
  }

  // Clip in XZ. Every tile entry retains the original span ID and parameter interval.
  function clip(a, b, min, max) {
    let lo = 0, hi = 1;
    for (const [k, axis] of [0, 2].entries()) {
      const d = b[axis] - a[axis];
      if (d === 0) {
        if (a[axis] < min[k] || a[axis] > max[k]) return null;
        continue;
      }
      const near = (min[k] - a[axis]) / d, far = (max[k] - a[axis]) / d;
      lo = Math.max(lo, Math.min(near, far));
      hi = Math.min(hi, Math.max(near, far));
      if (hi - lo <= 1e-10) return null;
    }
    return [lo, hi];
  }

  function bake(source) {
    const doc = API.create(source), L = lattice(doc.grid), { cell, origin, tileCells, size } = doc.grid;
    const tileGrid = P.chunks.grid({ dimensions: 2, size: cell * tileCells, origin });
    const slots = new Map(doc.tiles.map(row => [key(row.at), L.tileSlots(row.at)]));
    const input = stitch(doc, L, slots), base = L.lookup(input.heights);
    const brushes = doc.masks.filter(row => row.source === 'paint');
    const brushPoints = brushes.reduce((n, row) => n + row.strokes.reduce((m, s) => m + s.points.length, 0), 0);
    if (brushPoints * L.count > 16000000) throw new RangeError('Terrain set exceeds its painted mask sample budget');
    const paint = Object.fromEntries(brushes.map(row => {
      const mask = P.masks.compose(row.strokes);
      const sample = Float64Array.from({ length: L.count }, (_, i) => mask.weight(L.point(i)));
      return [row.id, L.lookup(sample)];
    }));
    let depth = new Float64Array(L.count), watershed;
    if (doc.erosion || doc.masks.some(row => row.source === 'moisture')) {
      watershed = P.hydrology.analyze(base, { bounds: L.bounds, cell, origin, maxCells: L.count });
      if (doc.erosion) {
        const { protect, ...options } = doc.erosion;
        const protectMask = protect === undefined ? null : paint[protect];
        depth = P.hydrology.incise(watershed, { ...options, ...(protectMask && { allow: (x, z) => protectMask(x, z) < .5 }) }).depth;
      }
    }
    const soil = input.heights.map((value, i) => value - depth[i]);
    const routes = prepareRoutes(doc, L.lookup(soil));
    const road = new Float64Array(L.count), river = new Float64Array(L.count), heights = soil.slice();
    for (let i = 0; i < L.count; i++) {
      const [x, z] = L.point(i), stream = routes.river(x, z), path = routes.road(x, z);
      if (stream) {
        const factor = smooth(2 - 2 * stream.distance / stream.width);
        heights[i] = blend(soil[i], Math.min(soil[i], stream.y - stream.depth), factor);
        river[i] = smooth(1 - Math.max(0, stream.distance - stream.width * .45) / (stream.width * .18));
      }
      if (path) road[i] = smooth(1 - Math.max(0, path.distance - path.width * .42) / (path.width * .16)) * (1 - river[i]);
    }
    const height = L.lookup(heights);
    const moisture = (x, z) => {
      const hit = routes.river(x, z, 3);
      return clamp(.65 * (watershed?.wetness(x, z) ?? 0) + (hit ? .78 * Math.exp(-hit.distance / Math.max(.2, hit.width * 1.8)) : 0), 0, 1);
    };
    const masks = selectedMasks(doc, { L, height, moisture, depth, routes, paint });
    const biomes = P.biomes.create({ fallback: doc.biomes.fallback, regions: doc.biomes.regions.map(row => ({
      id: row.id, bounds: L.bounds, weight: (x, y, z) => (row.weight ?? 1) * masks[row.mask](x, z)
    })) });
    const biome = (x, z) => biomes.sample(x, height(x, z), z).biome;
    const populations = scatter(doc, { L, height, biome, masks, routes, tileGrid });
    const sampled = Object.fromEntries(Object.entries(masks).map(([name, fn]) => [name,
      Float64Array.from({ length: L.count }, (_, i) => fn(...L.point(i)))]));
    const zones = Array.from({ length: L.count }, (_, i) => biome(...L.point(i)));
    const normals = Array.from({ length: L.count }, (_, i) => {
      const x = i % L.width, z = Math.floor(i / L.width);
      const x0 = Math.max(x - 1, 0), x1 = Math.min(x + 1, L.width - 1);
      const z0 = Math.max(z - 1, 0), z1 = Math.min(z + 1, L.rows - 1);
      return V.norm([(heights[L.at(x0, z)] - heights[L.at(x1, z)]) / ((x1 - x0) * cell), 1,
        (heights[L.at(x, z0)] - heights[L.at(x, z1)]) / ((z1 - z0) * cell)]);
    });
    const tiles = doc.tiles.map(row => {
      const { at } = row, ids = slots.get(key(at)), cuts = [];
      const min = L.point(ids[0]), max = L.point(ids.at(-1));
      for (const { row, points } of routes.rows) for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], t = clip(a, b, min, max);
        if (!t) continue;
        const ends = t.map(u => V.lerp(a, b, u));
        const middle = V.lerp(...ends, .5);
        const owner = tileGrid.index([middle[0], middle[2]]).map((n, k) => clamp(n, 0, size[k] - 1));
        if (owner.some((n, k) => n !== at[k])) continue;
        if (row.kind !== 'river') for (const p of ends) p[1] = height(p[0], p[2]);
        cuts.push({ id: row.id, span: row.points[i].id + ':' + row.points[i + 1].id, kind: row.kind,
          t, points: ends, width: row.width });
      }
      return { format: tileFormat, version: 1, at, origin: min, gridOrigin: origin, cell, tileCells, heights: ids.map(i => heights[i]),
        normals: ids.flatMap(i => normals[i]), biomes: ids.map(i => zones[i]), masks: Object.fromEntries(Object.entries(sampled)
          .map(([name, values]) => [name, ids.map(i => values[i])])),
        road: ids.map(i => road[i]), river: ids.map(i => river[i]), routes: cuts, instances: populations.records.get(key(at)) };
    });
    const erosion = depth.reduce((row, value) => {
      if (value > 0) row.erodedVertices++;
      row.maxDepth = Math.max(row.maxDepth, value);
      row.totalDepth += value;
      return row;
    }, { erodedVertices: 0, maxDepth: 0, totalDepth: 0 });
    return freeze({ id: doc.id, revision: API.revision(doc), grid: doc.grid, tiles,
      report: { shared: input.report, erosion, samples: L.count, populations: populations.report,
        routes: routes.rows.map(({ row, planar, points }) => ({ id: row.id, kind: row.kind, length: planar.length,
          points: row.points.map(({ id }, i) => ({ id, at: row.kind === 'river' ? points[i] :
            [points[i][0], height(points[i][0], points[i][2]), points[i][2]] })) })) } });
  }

  function mesh(tile) {
    const side = tile?.tileCells + 1, { at, gridOrigin, cell, heights, normals } = tile ?? {};
    if (tile?.format !== tileFormat || !Number.isSafeInteger(side) || side < 3 || side > 129 ||
        !Array.isArray(at) || at.length !== 2 || !at.every(Number.isSafeInteger) ||
        !Array.isArray(gridOrigin) || gridOrigin.length !== 2 || !gridOrigin.every(Number.isFinite) ||
        !Number.isFinite(cell) || cell <= 0 || !Array.isArray(heights) || heights.length !== side * side ||
        !heights.every(Number.isFinite) || !Array.isArray(normals) || normals.length !== 3 * heights.length ||
        !normals.every(Number.isFinite)) throw new RangeError('Expected a baked terrain tile');
    const points = heights.map((y, i) => [gridOrigin[0] + (at[0] * tile.tileCells + i % side) * cell, y,
      gridOrigin[1] + (at[1] * tile.tileCells + Math.floor(i / side)) * cell]);
    const faces = [];
    for (let z = 0; z < side - 1; z++) for (let x = 0; x < side - 1; x++) {
      const a = x + z * side, b = a + side;
      faces.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
    return { points, faces, normals: normals.slice(), uvs: Array.from({ length: heights.length }, (_, i) =>
      [i % side / (side - 1), Math.floor(i / side) / (side - 1)]).flat() };
  }

  function lod(instance, viewer) {
    const [x, , z] = instance.point, distance = Math.hypot(x - viewer[0], z - viewer[1]);
    let level = 0;
    for (const [i, row] of instance.lods.entries()) {
      if (distance < row.distance) break;
      level = i;
    }
    const { lods, ...record } = instance;
    return { ...record, distance, level, asset: lods[level].asset };
  }

  P.terrainSet = Object.freeze({ ...API, tileFormat, bake, mesh, lod });
})(KIT);
