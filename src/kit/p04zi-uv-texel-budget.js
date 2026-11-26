/* Budget existing UV islands against fixed chart footprints on the same sheet. */
const meshUVTexelBudget = (() => {
  const { fields, tuple, integer, name, sorted, grid, ids, protection, triangles, stats } = meshUVRegions;
  const positive = n => Number.isFinite(n) && n > 0;
  const validRect = ([l, t, r, b]) => r > l && b > t;
  const contains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];

  function subtract(free, blocked, work) {
    const next = new Map();
    function add(row) {
      if (validRect(row)) next.set(row.join('/'), row);
    }
    for (const [l, t, r, b] of free) {
      const [x, y, u, v] = blocked;
      if (x >= r || y >= b || u <= l || v <= t) add([l, t, r, b]);
      else {
        if (x > l) add([l, t, x, b]);
        if (u < r) add([u, t, r, b]);
        if (y > t) add([l, t, r, y]);
        if (v < b) add([l, v, r, b]);
      }
    }
    const rows = [...next.values()];
    if (rows.length > 1536 || (work.remaining -= rows.length * rows.length) < 0)
      throw new RangeError('Texel packing exceeds its free-space budget; select a smaller pool');
    return rows.filter((row, i) => !rows.some((other, j) => i !== j && contains(other, row)));
  }

  function place(open, entries, work, keepGoing = false) {
    let free = open;
    const placed = new Map(), missed = [];
    const ordered = entries.slice().sort((a, b) =>
      b.dims[0] * b.dims[1] - a.dims[0] * a.dims[1] || (a.id < b.id ? -1 : 1));
    for (const { id, dims: [w, h] } of ordered) {
      let best, score = Infinity;
      for (const rect of free) {
        const [l, t, r, b] = rect;
        if (r - l < w || b - t < h) continue;
        const room = (r - l) * (b - t) - w * h;
        if (best === undefined || room < score || room === score && (t < best[1] || t === best[1] && l < best[0])) {
          score = room;
          best = rect;
        }
      }
      if (!best) {
        if (!keepGoing) return null;
        missed.push(id);
        continue;
      }
      const [x, y] = best;
      placed.set(id, [x, y]);
      free = subtract(free, [x, y, x + w, y + h], work);
    }
    return { placed, missed };
  }

  function pack(open, charts, density, gutter, work) {
    const entries = charts.map(chart => {
      const scale = density * chart.weight / chart.before.density;
      const dims = chart.span.map(n => Math.max(1, Math.ceil(n * scale)) + gutter * 2);
      return { id: chart.id, dims, scale };
    });
    const result = place(open, entries, work);
    if (!result) return null;
    return new Map(entries.map(({id,scale})=>{
      const [x,y] = result.placed.get(id);
      return [id,{x:x+gutter,y:y+gutter,scale}];
    }));
  }

  function freeSpace(pool, obstacles, work) {
    const [x,y,w,h] = pool;
    let free = [[x,y,x+w,y+h]];
    for (const box of obstacles) {
      if (validRect(box) && box[0] < x+w && box[1] < y+h && box[2] > x && box[3] > y)
        free = subtract(free,box,work);
    }
    return free;
  }

  function assign(g, operation, points, conflict) {
    if (!fields(operation, ['op', 'atlas', 'maxTexels', 'features', 'gutter', 'pool', 'protect']))
      throw new TypeError('Unknown texel budget setting');
    const { atlas = [1024, 1024], maxTexels, features, gutter = 2, pool = [0, 0, ...atlas], protect } = operation;
    const [width, height] = grid(atlas), atlasArea = width * height;
    if (maxTexels !== undefined && !integer(maxTexels, 1, atlasArea) || !integer(gutter, 0, 32) ||
        !tuple(pool, 4, n => integer(n, 0, 4096)) || pool[2] < 1 || pool[3] < 1 ||
        pool[0] + pool[2] > width || pool[1] + pool[3] > height ||
        !Array.isArray(features) || !integer(features.length, 1, 128))
      throw new RangeError('Texel budgets need a valid area cap, pool, gutter and 1–128 named features');
    const held = protection(g, protect), named = new Set(), selected = new Map();
    const groups = Array.from(features, row => {
      if (!fields(row, ['id', 'islands', 'weight', 'minDensity']) || !name(row.id) || named.has(row.id) ||
          row.weight !== undefined && (!positive(row.weight) || row.weight < 1e-4 || row.weight > 1e4) ||
          row.minDensity !== undefined && !positive(row.minDensity))
        throw new RangeError('Texel features need unique IDs, islands and optional positive density controls');
      named.add(row.id);
      const islands = ids(row.islands, g.islands, 'texel islands');
      if (!islands.length) throw new RangeError('A texel feature needs at least one island');
      const feature = { id: row.id, islands, weight: row.weight ?? 1, minDensity: row.minDensity };
      for (const id of islands) {
        if (selected.has(id)) throw new RangeError('An island can belong to one texel feature at a time');
        selected.set(id, feature);
      }
      return feature;
    });
    const materials = new Set([...selected.keys()].map(id => g.islands.get(id).material));
    if (materials.size !== 1 || selected.size > 256) throw new RangeError('Budget up to 256 islands on one material sheet at a time');
    const [material] = materials, faceIds = new Set([...selected.keys()].flatMap(id => g.islands.get(id).faces));
    const byIsland = new Map([...selected.keys()].map(id => [id, []]));
    for (const row of triangles(g, faceIds)) byIsland.get(g.atIsland.get(row.face)).push(row);
    const charts = [...selected].map(([id, feature]) => {
      const { faces, bounds } = g.islands.get(id);
      const corners = faces.flatMap(face => g.faces.get(face).corners);
      const locked = corners.some(row => held.fixed.has(g.atWeld.get(row.id)));
      const box = bounds.map((n, i) => n * atlas[i % 2]);
      return { id, feature: feature.id, weight: feature.weight, locked, box, corners,
        span: [box[2] - box[0], box[3] - box[1]], before: stats(byIsland.get(id), atlas) };
    });
    const movable = charts.filter(row => !row.locked), moving = new Set(movable.map(row => row.id));
    const reserved = charts.reduce((sum, row) => sum + (row.locked ? row.before.texels : 0), 0);
    const budget = maxTexels ?? Math.min(atlasArea, Math.ceil(charts.reduce((sum, row) => sum + row.before.texels, 0)));
    const evidence = { material, atlas, pool, maxTexels: budget, reserved, gutter, protection: held.report };
    if (reserved > budget + 1e-8 || movable.length && budget - reserved <= 1e-8) {
      conflict('texel-budget-reserved', { reserved, budget });
      return evidence;
    }
    if (movable.some(chart => !chart.before.density || chart.span.some(n => n <= 1e-8))) {
      conflict('degenerate-texel-island', { islands: movable.filter(chart => !chart.before.density ||
        chart.span.some(n => n <= 1e-8)).map(row => row.id) });
      return evidence;
    }
    const weighted = movable.reduce((sum, row) => sum + row.before.worldArea * row.weight ** 2, 0);
    const desired = weighted ? Math.sqrt((budget - reserved) / weighted) : 0;
    let places = new Map(), packingLimited = false;
    if (movable.length) {
      const work = { remaining: 16e6 };
      const obstacles = [...g.islands.values()].filter(row => row.material === material && !moving.has(row.id));
      const free = freeSpace(pool,obstacles.map(row=>row.bounds.map((n,a)=>
        a < 2 ? Math.floor(n * atlas[a % 2]) - gutter : Math.ceil(n * atlas[a % 2]) + gutter)),work);
      places = pack(free, movable, desired, gutter, work);
      if (!places) {
        let low = 0, high = desired;
        packingLimited = true;
        for (let i = 0; i < 18; i++) {
          const mid = (low + high) * .5, candidate = pack(free, movable, mid, gutter, work);
          if (candidate) { places = candidate; low = mid; }
          else high = mid;
        }
      }
      if (!places) {
        conflict('atlas-pool-too-small', { islands: [...moving] });
        return { ...evidence, packingLimited };
      }
    }
    const report = [], newAreas = new Map();
    for (const chart of charts) {
      const at = places.get(chart.id);
      if (at) {
        for (const corner of chart.corners) points.set(corner.id, [
          (at.x + (corner.uv[0] * width - chart.box[0]) * at.scale) / width,
          (at.y + (corner.uv[1] * height - chart.box[1]) * at.scale) / height
        ]);
      }
      const after = stats(byIsland.get(chart.id), atlas, row => row.corners.map((id, i) => points.get(id) ?? row.uv[i]));
      newAreas.set(chart.id, after);
      report.push({ id: chart.id, feature: chart.feature, locked: chart.locked, before: chart.before, after });
      const minDensity = selected.get(chart.id).minDensity;
      if (minDensity !== undefined && after.density + 1e-7 < minDensity)
        conflict('texel-density-shortfall', { feature: chart.feature, island: chart.id, minimum: minDensity, actual: after.density });
    }
    const used = [...newAreas.values()].reduce((sum, row) => sum + row.texels, 0);
    const featuresReport = groups.map(row => {
      const before = row.islands.reduce((sum, id) => sum + report.find(chart => chart.id === id).before.texels, 0);
      const rows = row.islands.map(id => newAreas.get(id)), after = rows.reduce((sum, row) => sum + row.texels, 0);
      const worldArea = rows.reduce((sum, row) => sum + row.worldArea, 0);
      return { ...row, faces: sorted(row.islands.flatMap(id => g.islands.get(id).faces)), before, after,
        densityBefore: Math.sqrt(before / worldArea), densityAfter: Math.sqrt(after / worldArea) };
    });
    return { ...evidence, used, unallocated: Math.max(0, budget - used), packingLimited, features: featuresReport, islands: report };
  }

  return Object.freeze({ assign, place, freeSpace });
})();
