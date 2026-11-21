/* Layered cut paper: real holes and thickness, native faces, baked drop shadows. */
(function (K) {
  const P = K.procedural,
    G = P.geometry,
    { V, M } = K,
    EPS = 1e-9,
    cache = new WeakMap(),
    trusted = new WeakSet();
  const fail = s => {
    throw new RangeError('Paper relief: ' + s);
  };
  const num = (x, a, b, k) => {
    if (!Number.isFinite(x) || x < a || x > b) fail('invalid ' + k);
    return x;
  };
  const integer = (x, a, b, k) => {
    num(x, a, b, k);
    if (!Number.isSafeInteger(x)) fail('invalid ' + k);
    return x;
  };
  const point = (p, n = 3, limit = 1e5) =>
    Array.isArray(p) && p.length === n && p.every(x => Number.isFinite(x) && Math.abs(x) <= limit);
  const rgb = c => {
    if (typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)) c = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    if (!point(c) || c.some(x => x < 0 || x > 255)) fail('expected RGB bytes or #RRGGBB');
    return c.slice();
  };
  const area = r =>
    r.reduce((s, a, i) => {
      const b = r[(i + 1) % r.length];
      return s + a[0] * b[1] - a[1] * b[0];
    }, 0) / 2;
  function inside(r, x, y, tick) {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (tick) tick();
      const a = r[i],
        b = r[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }
  const contains = (rings, x, y, tick) => rings.reduce((hit, r) => (inside(r, x, y, tick) ? !hit : hit), false);
  function limits(raw = {}) {
    return {
      maxLayers: integer(raw.maxLayers ?? 128, 1, 512, 'layer budget'),
      maxVertices: integer(raw.maxVertices ?? 12000, 3, 60000, 'vertex budget'),
      maxTriangles: integer(raw.maxTriangles ?? 60000, 1, 500000, 'triangle budget'),
      maxChecks: integer(raw.maxChecks ?? 16000000, 1, 60000000, 'predicate budget'),
      maxFlips: integer(raw.maxFlips ?? 30000, 1, 200000, 'flip budget')
    };
  }
  function stack(input, raw = {}) {
    const budget = limits(raw),
      gap = num(raw.gap ?? 0.15, 0, 1000, 'layer gap'),
      thickness = num(raw.thickness ?? 0.035, 0, 10, 'thickness');
    if (!Array.isArray(input) || !input.length || input.length > budget.maxLayers)
      fail('expected layers within their budget');
    let vertices = 0,
      triangles = 0,
      checks = 0,
      flips = 0;
    const ids = new Set(),
      layers = [];
    for (const [index, row] of input.entries()) {
      if (!row || typeof row !== 'object') fail('invalid layer');
      const id = row.id ?? 'sheet-' + index;
      if (typeof id !== 'string' || !id.length || id.length > 128 || ids.has(id)) fail('layer IDs must be unique');
      ids.add(id);
      const rings = row.rings ?? (row.profile ? [row.profile] : null);
      if (!Array.isArray(rings) || !rings.length || rings.length > 64) fail('expected boundary rings');
      const copied = rings.map(r => {
        if (!Array.isArray(r) || r.length < 3 || r.length > 2049 || !r.every(p => point(p, 2)))
          fail('invalid planar ring');
        const q = r.map(p => p.slice());
        if (V2dist(q[0], q.at(-1)) < EPS) q.pop();
        if (q.length < 3 || Math.abs(area(q)) < EPS || q.some((p, i) => V2dist(p, q[(i + 1) % q.length]) < EPS))
          fail('degenerate ring');
        return q;
      });
      const count = copied.reduce((n, r) => n + r.length, 0);
      vertices += count;
      if (count > 2048 || vertices > budget.maxVertices) fail('vertex budget exceeded');
      const canonical = copied.map((r, i) => {
        const depth = copied.reduce((n, q, j) => n + (j !== i && inside(q, ...r[0]) ? 1 : 0), 0),
          ccw = depth % 2 === 0;
        return area(r) > 0 === ccw ? r : r.slice().reverse();
      });
      const cap = G.triangulatePolygon(canonical, {
        maxChecks: Math.max(1, budget.maxChecks - checks),
        maxFlips: Math.max(1, budget.maxFlips - flips)
      });
      checks += cap.work.checks;
      flips += cap.work.flips;
      if (checks > budget.maxChecks || flips > budget.maxFlips) fail('triangulation budget exceeded');
      const t = num(row.thickness ?? thickness, 0, 10, 'thickness'),
        depth = num(row.depth ?? index * gap, -1e5, 1e5, 'depth'),
        position = row.position ?? [0, 0, 0],
        rotation = row.rotation ?? [0, 0, 0];
      if (!point(position) || !point(rotation)) fail('invalid layer pose');
      const pose = P.transforms.local({ position: [position[0], position[1], position[2] + depth], rotation }),
        color = rgb(row.color ?? '#d1bca0'),
        back = rgb(row.backColor ?? color.map(x => x * 0.86)),
        edge = rgb(row.edgeColor ?? color.map(x => x * 0.64));
      triangles += cap.triangles.length * (t ? 2 : 1) + (t ? count * 2 : 0);
      if (triangles > budget.maxTriangles) fail('triangle budget exceeded');
      layers.push({
        id,
        rings: canonical,
        points: cap.points,
        triangles: cap.triangles,
        position: position.slice(),
        rotation: rotation.slice(),
        depth,
        thickness: t,
        color,
        backColor: back,
        edgeColor: edge,
        pose
      });
    }
    const plan = P.data.freeze({
      format: 'ink-studio/paper-relief',
      version: 1,
      layers,
      limits: budget,
      stats: { layers: layers.length, vertices, triangles, checks, flips }
    });
    trusted.add(plan);
    return plan;
  }
  const V2dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function runtime(plan) {
    if (cache.has(plan)) return cache.get(plan);
    if (plan?.format !== 'ink-studio/paper-relief' || plan.version !== 1 || !Array.isArray(plan.layers))
      fail('expected a paper plan');
    // Recompile untrusted/serialized data so caps, winding and poses cannot disagree.
    const safe = trusted.has(plan) ? plan : stack(plan.layers, plan.limits),
      layers = safe.layers.map((row, index) => {
        const inverse = M.tr(row.pose.R),
          bounds = {
            min: [0, 1].map(k => Math.min(...row.points.map(p => p[k]))),
            max: [0, 1].map(k => Math.max(...row.points.map(p => p[k])))
          },
          distances = row.rings.map(G.profileDistance);
        const local = p => M.app(inverse, V.sub(p, row.pose.t)),
          world = p => V.add(M.app(row.pose.R, p), row.pose.t),
          normal = n => M.app(row.pose.R, n);
        return { row, index, inverse, bounds, local, world, normal, distances };
      });
    const result = { safe, layers };
    cache.set(plan, result);
    cache.set(safe, result);
    return result;
  }
  function raycastInner(rt, origin, direction, { exclude, minDistance = 1e-5, maxDistance = 1e5 } = {}, work) {
    let nearest = maxDistance,
      hit = null;
    const tick = () => {
      if (++work.tests > work.max) fail('shadow/ray work budget exceeded');
    };
    for (const layer of rt.layers) {
      if (layer.row.id === exclude || layer.index === exclude) continue;
      tick();
      const p = layer.local(origin),
        d = M.app(layer.inverse, direction),
        t = layer.row.thickness / 2,
        low = [...layer.bounds.min, -t],
        high = [...layer.bounds.max, t];
      let lo = minDistance,
        hi = nearest;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < EPS) {
          if (p[k] < low[k] || p[k] > high[k]) {
            hi = -1;
            break;
          }
        } else {
          let a = (low[k] - p[k]) / d[k],
            b = (high[k] - p[k]) / d[k];
          if (a > b) [a, b] = [b, a];
          lo = Math.max(lo, a);
          hi = Math.min(hi, b);
        }
      }
      if (hi < lo) continue;
      const accept = (distance, n, part) => {
        if (distance < minDistance || distance > nearest) return;
        nearest = distance;
        hit = {
          layer: layer.row.id,
          index: layer.index,
          distance,
          point: V.mad(origin, direction, distance),
          normal: layer.normal(n),
          part
        };
      };
      if (Math.abs(d[2]) > EPS)
        for (const [z, n, part] of [
          [t, [0, 0, 1], 'front'],
          [-t, [0, 0, -1], 'back']
        ]) {
          const at = (z - p[2]) / d[2];
          if (at < lo - EPS || at > hi + EPS) continue;
          tick();
          if (contains(layer.row.rings, p[0] + d[0] * at, p[1] + d[1] * at, tick)) accept(at, n, part);
        }
      if (t)
        for (const ring of layer.row.rings)
          for (let i = 0; i < ring.length; i++) {
            tick();
            const a = ring[i],
              b = ring[(i + 1) % ring.length],
              ex = b[0] - a[0],
              ey = b[1] - a[1],
              den = d[0] * ey - d[1] * ex;
            if (Math.abs(den) < EPS) continue;
            const ax = a[0] - p[0],
              ay = a[1] - p[1],
              at = (ax * ey - ay * ex) / den,
              s = (ax * d[1] - ay * d[0]) / den,
              z = p[2] + d[2] * at;
            if (at >= lo - EPS && at <= hi + EPS && s >= 0 && s <= 1 && Math.abs(z) <= t + EPS)
              accept(at, V.norm([ey, -ex, 0]), 'edge');
          }
    }
    return hit;
  }
  function raycast(plan, origin, direction, options = {}) {
    if (!point(origin, 3, 1e6) || !point(direction) || V.len(direction) < EPS) fail('expected a finite ray');
    num(options.minDistance ?? 1e-5, 0, 1e5, 'minimum ray distance');
    num(options.maxDistance ?? 1e5, 0, 1e6, 'maximum ray distance');
    if ((options.maxDistance ?? 1e5) < (options.minDistance ?? 1e-5)) fail('ray distances must be ordered');
    return raycastInner(runtime(plan), origin, V.norm(direction), options, {
      tests: 0,
      max: integer(options.maxTests ?? 1000000, 1, 40000000, 'ray budget')
    });
  }
  function sdf(plan) {
    const rt = runtime(plan);
    return (x, y, z) => {
      if (!point([x, y, z], 3, 1e6)) fail('invalid distance query');
      let best = Infinity;
      for (const l of rt.layers) {
        const p = l.local([x, y, z]);
        let dist = Infinity,
          odd = false;
        for (const fn of l.distances) {
          const v = fn(p[0], p[1]);
          dist = Math.min(dist, Math.abs(v));
          if (v < 0) odd = !odd;
        }
        const a = odd ? -dist : dist,
          b = Math.abs(p[2]) - l.row.thickness / 2;
        best = Math.min(best, Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)));
      }
      return best;
    };
  }
  function cut(field, { bounds, cell = 0.06, maxCells = 120000, maxVertices = 2048 } = {}) {
    if (typeof field !== 'function') fail('cut needs a signed planar field');
    integer(maxVertices, 3, 12000, 'cut vertex budget');
    const raw = P.surfaceCells.fieldMask(field, { bounds, cell, maxCells });
    if (!raw) return [];
    if (raw.rings.reduce((n, r) => n + r.length, 0) > maxVertices) fail('cut vertex budget exceeded');
    return raw.rings;
  }
  function relief(
    field,
    { bounds, levels, colors = ['#294c65', '#467c87', '#84aba2', '#e8c383'], gap = 0.14, cell = 0.06, ...options } = {}
  ) {
    if (typeof field !== 'function') fail('relief needs a scalar field');
    if (
      !Array.isArray(levels) ||
      !levels.length ||
      levels.length > 64 ||
      !levels.every(Number.isFinite) ||
      levels.some((v, i) => i && v <= levels[i - 1])
    )
      fail('expected increasing relief levels');
    if (!Array.isArray(colors) || !colors.length || colors.length > 256) fail('invalid relief palette');
    num(cell, 0.00001, 1000, 'relief cell');
    const maxCells = integer(options.maxCells ?? 240000, 1, 1000000, 'relief cell budget');
    if (!point(bounds?.min, 2) || !point(bounds?.max, 2) || bounds.min.some((v, i) => v >= bounds.max[i]))
      fail('invalid relief bounds');
    const cells = bounds.max.reduce((n, v, i) => n * Math.ceil((v - bounds.min[i] + 2 * cell) / cell), 1);
    if (cells * levels.length > maxCells) fail('relief cell budget exceeded');
    const palette = colors.map(rgb),
      layers = [];
    for (const [i, level] of levels.entries()) {
      const rings = cut((x, y) => level - field(x, y), { bounds, cell, maxCells: Math.min(500000, maxCells) });
      if (rings.length) layers.push({ id: 'level-' + i, rings, depth: i * gap, color: palette[i % palette.length] });
    }
    if (!layers.length) fail('relief contains no paper');
    return stack(layers, { ...options, gap });
  }
  function finish({ grain = 0.12, fibers = 0.035, scale = 0.035, seed = 1 } = {}) {
    num(grain, 0, 0.5, 'paper grain');
    num(fibers, 0, 0.3, 'paper fibers');
    num(scale, 0.001, 10, 'grain scale');
    integer(seed, 0, 4294967295, 'seed');
    return {
      id: 'cut-paper',
      seed,
      layers: {
        grain: {
          type: 'tint',
          color: '#c1b8a7',
          strength: grain,
          blend: 'multiply',
          mask: { type: 'noise', scale, low: 0.22, high: 0.8 }
        },
        fibers: {
          type: 'tint',
          color: '#fff7df',
          strength: fibers,
          mask: { type: 'stripes', axis: [0.1, 1, 0], scale: scale * 0.23, width: 0.16, feather: 0.06 }
        }
      }
    };
  }
  function shadows(
    plan,
    {
      light = [-0.5, 0.7, 1],
      softness = 0.035,
      samples = 5,
      texel = 0.04,
      maxPixels = 1000000,
      maxWork = 40000000,
      enabled = true
    } = {}
  ) {
    if (!point(light) || V.len(light) < EPS) fail('invalid shadow light');
    num(softness, 0, 0.5, 'softness');
    integer(samples, 1, 16, 'shadow samples');
    num(texel, 0.002, 100, 'shadow texel');
    integer(maxPixels, 1, 8000000, 'shadow pixel budget');
    integer(maxWork, 1, 256000000, 'shadow work budget');
    if (typeof enabled !== 'boolean') fail('invalid shadow enabled state');
    const rt = runtime(plan),
      L = V.norm(light),
      U = V.perp(L),
      W = V.cross(L, U),
      maps = [];
    let pixels = 0,
      work = 0;
    const spend = n => {
      if ((work += n) > maxWork) fail('shadow raster work budget exceeded');
    };
    // Geometry is retained once; rasterization uses the actual caps and edge walls.
    const geometry = enabled
      ? rt.layers.map(c => {
          const t = c.row.thickness / 2,
            tris = c.row.triangles.map(tri => tri.map(i => [...c.row.points[i], t]));
          if (t) {
            for (const tri of c.row.triangles) tris.push(tri.map(i => [...c.row.points[i], -t]));
            for (const ring of c.row.rings)
              for (let i = 0; i < ring.length; i++) {
                const a = ring[i],
                  b = ring[(i + 1) % ring.length];
                tris.push(
                  [
                    [...a, -t],
                    [...b, -t],
                    [...b, t]
                  ],
                  [
                    [...a, -t],
                    [...b, t],
                    [...a, t]
                  ]
                );
              }
          }
          return tris.map(tri => tri.map(c.world));
        })
      : [];
    for (const l of rt.layers) {
      const [sx, sy] = l.bounds.max.map((v, i) => v - l.bounds.min[i]),
        width = Math.max(1, Math.ceil(sx / texel)),
        height = Math.max(1, Math.ceil(sy / texel));
      if (width > 2048 || height > 2048 || (pixels += width * height) > maxPixels) fail('shadow pixel budget exceeded');
      const counts = new Uint8Array(width * height),
        mask = new Uint8Array(counts.length),
        front = l.row.thickness / 2;
      function triangle(a, b, c) {
        spend(1);
        const poly = [a, b, c],
          lo = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]) - 0.5)),
          hi = Math.min(height - 1, Math.floor(Math.max(a[1], b[1], c[1]) - 0.5));
        for (let y = lo; y <= hi; y++) {
          const crossings = [],
            at = y + 0.5;
          for (let j = 0; j < 3; j++) {
            const p = poly[j],
              q = poly[(j + 1) % 3];
            if (p[1] > at !== q[1] > at) crossings.push(p[0] + ((at - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
          }
          if (crossings.length < 2) continue;
          const x0 = Math.max(0, Math.ceil(Math.min(...crossings) - 0.5)),
            x1 = Math.min(width - 1, Math.floor(Math.max(...crossings) - 0.5));
          if (x0 <= x1) {
            spend(x1 - x0 + 1);
            mask.fill(1, y * width + x0, y * width + x1 + 1);
          }
        }
      }
      for (let s = 0; enabled && s < samples; s++) {
        mask.fill(0);
        const angle = s * 2.399963229728653,
          r = softness * Math.sqrt((s + 0.5) / samples),
          dir = V.norm(V.add(L, V.add(V.mul(U, Math.cos(angle) * r), V.mul(W, Math.sin(angle) * r)))),
          d = M.app(l.inverse, dir);
        if (d[2] <= EPS) continue;
        for (const caster of rt.layers) {
          if (caster === l) continue;
          for (const world of geometry[caster.index]) {
            const source = world.map(l.local),
              poly = [];
            spend(1);
            // A hidden layer behind the receiver cannot cast into its foreground.
            for (let i = 0; i < source.length; i++) {
              const p = source[i],
                q = source[(i + 1) % source.length],
                a = p[2] - front - 0.00002,
                b = q[2] - front - 0.00002;
              if (a >= 0) poly.push(p);
              if (a * b < 0) poly.push(V.mad(p, V.sub(q, p), a / (a - b)));
            }
            if (poly.length < 3) continue;
            const projected = poly.map(p => [
              ((p[0] + ((front - p[2]) * d[0]) / d[2] - l.bounds.min[0]) / sx) * width,
              ((l.bounds.max[1] - p[1] - ((front - p[2]) * d[1]) / d[2]) / sy) * height
            ]);
            for (let i = 1; i < projected.length - 1; i++) triangle(projected[0], projected[i], projected[i + 1]);
          }
        }
        spend(mask.length);
        for (let i = 0; i < mask.length; i++) counts[i] += mask[i];
      }
      maps.push({
        id: l.row.id,
        width,
        height,
        bounds: l.bounds,
        coverage: Uint8Array.from(counts, x => Math.round((x / samples) * 255))
      });
    }
    return { layers: maps, stats: { pixels, work, samples } };
  }
  function paintedAtlas(rt, maps, { light, ambient, shadowStrength, texture }) {
    const width = Math.max(1024, ...maps.layers.map(m => m.width)),
      atlas = SpriteSurface.make(width, 8192),
      L = V.norm(light),
      grain = texture === false ? 0 : texture === true ? 0.12 : (texture.grain ?? 0.12),
      fibers = texture === false ? 0 : texture === true ? 0.035 : (texture.fibers ?? 0.035),
      seed = texture === true || texture === false ? 1 : (texture.seed ?? 1);
    for (const l of rt.layers) {
      const map = maps.layers[l.index],
        sx = map.bounds.max[0] - map.bounds.min[0],
        sy = map.bounds.max[1] - map.bounds.min[1],
        normal = l.normal([0, 0, 1]),
        lit = ambient + (1 - ambient) * Math.max(0, V.dot(normal, L)),
        t = l.row.thickness / 2;
      const points = l.row.points.flatMap(([x, y]) => l.world([x, y, t])),
        uvs = l.row.points.flatMap(([x, y]) => [(x - map.bounds.min[0]) / sx, (map.bounds.max[1] - y) / sy]);
      atlas.mesh(
        { points, uvs, triangles: l.row.triangles.flat() },
        map.width,
        map.height,
        (x, y) => {
          let h = Math.imul(x + seed, 374761393) ^ Math.imul(y, 668265263);
          h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
          const fiber = h % 113 === 0 ? fibers * 2.5 : 0,
            noise = ((h >>> 8) / 16777215 - 0.5) * grain * 0.45,
            shade = lit * (1 - (shadowStrength * map.coverage[y * map.width + x]) / 255) * (1 + noise - fiber),
            c = l.row.color.map(v => Math.max(0, Math.min(255, Math.round(v * shade))));
          return (c[0] << 16) + (c[1] << 8) + c[2];
        },
        { id: l.row.id }
      );
    }
    return atlas.finish();
  }
  function draw(
    B,
    plan,
    {
      light = [-0.5, 0.7, 1],
      ambient = 0.58,
      shadowStrength = 0.38,
      softness = 0.035,
      shadowSamples = 5,
      shadowStep = 0.18,
      maxMarks = 80000,
      maxShadowTests = 16000000,
      texture = true,
      paint = 'atlas',
      texel = 0.04,
      maxPixels = 1000000,
      object = 'paper',
      material = 'paper-stock'
    } = {}
  ) {
    if (!B?.dab || !point(light) || V.len(light) < EPS) fail('invalid builder/light');
    num(ambient, 0, 1, 'ambient');
    num(shadowStrength, 0, 1, 'shadow strength');
    num(softness, 0, 0.5, 'shadow softness');
    integer(shadowSamples, 1, 16, 'shadow samples');
    num(shadowStep, 0.01, 100, 'shadow step');
    integer(maxMarks, 1, 500000, 'mark budget');
    integer(maxShadowTests, 1, 40000000, 'shadow budget');
    if (!['atlas', 'native'].includes(paint)) fail('invalid paper paint mode');
    const rt = runtime(plan),
      L = V.norm(light),
      U = V.perp(L),
      W = V.cross(L, U),
      rows = [],
      work = { tests: 0, max: maxShadowTests },
      paperFinish = texture === false ? null : finish(texture === true ? {} : texture);
    if (paperFinish) SurfaceLook.prepare(paperFinish, [], L, {}, { validateOnly: true });
    const maps =
      paint === 'atlas'
        ? shadows(plan, {
            light: L,
            softness,
            samples: shadowSamples,
            texel,
            maxPixels,
            maxWork: maxShadowTests,
            enabled: shadowStrength > 0
          })
        : null;
    const spriteSurfaces = maps ? paintedAtlas(rt, maps, { light: L, ambient, shadowStrength, texture }) : null;
    const add = (l, points, color, part, shade) => {
      if (paint === 'atlas' && part === 'front') return;
      if (rows.length >= maxMarks) fail('mark budget exceeded');
      const world = points.map(l.world),
        cross = V.cross(V.sub(world[1], world[0]), V.sub(world[2], world[0])),
        length = V.len(cross);
      if (length < 1e-14) return;
      const n = V.mul(cross, 1 / length),
        center = V.mul(V.add(world[0], V.add(world[1], world[2])), 1 / 3);
      let visibility = 1;
      if (paint === 'native' && shade && shadowStrength && Math.max(0, V.dot(n, L)) > 0) {
        let covered = 0;
        for (let i = 0; i < shadowSamples; i++) {
          const a = i * 2.399963229728653,
            r = softness * Math.sqrt((i + 0.5) / shadowSamples),
            dir = V.norm(V.add(L, V.add(V.mul(U, Math.cos(a) * r), V.mul(W, Math.sin(a) * r))));
          if (raycastInner(rt, V.mad(center, n, 0.00002), dir, { exclude: l.index }, work)) covered++;
        }
        visibility = 1 - (shadowStrength * covered) / shadowSamples;
      }
      const value = (ambient + (1 - ambient) * Math.max(0, V.dot(n, L))) * visibility;
      rows.push({
        points: world,
        normal: n,
        color: color.map(x => Math.round(x * value)),
        albedo: color.map(x => x / 255),
        layer: l.row.id,
        part
      });
    };
    const projected = new Map();
    function shadowBounds(l) {
      if (projected.has(l)) return projected.get(l);
      const d = M.app(l.inverse, L),
        boxes = [],
        height = l.row.thickness / 2;
      if (d[2] > EPS)
        for (const caster of rt.layers) {
          if (caster === l) continue;
          const corners = Array.from({ length: 8 }, (_, i) =>
            l.local(
              caster.world([
                caster.bounds[i & 1 ? 'max' : 'min'][0],
                caster.bounds[i & 2 ? 'max' : 'min'][1],
                ((i & 4 ? 1 : -1) * caster.row.thickness) / 2
              ])
            )
          );
          if (corners.every(p => p[2] <= height + EPS)) continue;
          const q = corners.map(p => [p[0] + ((height - p[2]) * d[0]) / d[2], p[1] + ((height - p[2]) * d[1]) / d[2]]);
          const reach = Math.max(...corners.map(p => Math.abs(height - p[2]))),
            margin = [0, 1].map(k =>
              d[2] <= softness + EPS ? 1e15 : (reach * softness * (d[2] + Math.abs(d[k]))) / (d[2] * (d[2] - softness))
            );
          boxes.push({
            min: [0, 1].map(k => Math.min(...q.map(p => p[k])) - margin[k]),
            max: [0, 1].map(k => Math.max(...q.map(p => p[k])) + margin[k])
          });
        }
      projected.set(l, boxes);
      return boxes;
    }
    function possible(l, points) {
      const min = [0, 1].map(k => Math.min(...points.map(p => p[k]))),
        max = [0, 1].map(k => Math.max(...points.map(p => p[k]))),
        margin = EPS;
      return shadowBounds(l).some(b => min.every((v, k) => v <= b.max[k] + margin && max[k] >= b.min[k] - margin));
    }
    function cap(l, a, b, c, color, part, shade) {
      const queue = [[a, b, c]];
      while (queue.length) {
        const p = queue.pop(),
          lengths = [V.dist(p[0], p[1]), V.dist(p[1], p[2]), V.dist(p[2], p[0])],
          max = Math.max(...lengths),
          i = lengths.indexOf(max);
        if (paint === 'native' && shade && shadowStrength && possible(l, p) && max > shadowStep) {
          if (rows.length + queue.length + 2 > maxMarks) fail('mark budget exceeded');
          const j = (i + 1) % 3,
            k = (i + 2) % 3,
            mid = V.mul(V.add(p[i], p[j]), 0.5);
          queue.push([p[i], mid, p[k]], [mid, p[j], p[k]]);
        } else add(l, p, color, part, shade && possible(l, p));
      }
    }
    for (const l of rt.layers) {
      const t = l.row.thickness / 2;
      for (const tri of l.row.triangles) {
        const p = tri.map(i => [...l.row.points[i], t]);
        cap(l, ...p, l.row.color, 'front', true);
        if (t)
          add(
            l,
            p
              .slice()
              .reverse()
              .map(q => [q[0], q[1], -t]),
            l.row.backColor,
            'back',
            false
          );
      }
      if (t)
        for (const ring of l.row.rings)
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i],
              b = ring[(i + 1) % ring.length];
            add(
              l,
              [
                [...a, -t],
                [...b, -t],
                [...b, t]
              ],
              l.row.edgeColor,
              'edge',
              false
            );
            add(
              l,
              [
                [...a, -t],
                [...b, t],
                [...a, t]
              ],
              l.row.edgeColor,
              'edge',
              false
            );
          }
    }
    const first = B.count(),
      layers = new Map();
    for (const row of rows) {
      const a = B.count();
      K.surfacePatches.triangle(B, row.points, {
        normal: row.normal,
        color: row.color,
        albedo: row.albedo,
        object,
        material,
        target: { entity: object, surface: row.layer },
        finish: paperFinish,
        light: L
      });
      const range = layers.get(row.layer) ?? { id: row.layer, first: a, end: a };
      range.end = B.count();
      layers.set(row.layer, range);
    }
    return {
      first,
      end: B.count(),
      ids: Array.from({ length: B.count() - first }, (_, i) => first + i),
      layers: [...layers.values()],
      spriteSurfaces,
      stats: {
        marks: rows.length,
        shadowTests: work.tests,
        ...(maps && { shadowPixels: maps.stats.pixels, shadowWork: maps.stats.work })
      }
    };
  }
  function world(plan, { background = '#0b1724', camera, draw: settings = {}, ...options } = {}) {
    const bg = rgb(background),
      B = makeBuilder(1, [(bg[0] << 16) + (bg[1] << 8) + bg[2], 0xe9d6aa]);
    const batch = draw(B, plan, settings);
    return B.finish({
      radius: 100,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' },
      cam: { target: [0, 0, 0.3], dist: 8, yaw: 0.12, pitch: 0.08, ...camera },
      ...(batch.spriteSurfaces && { spriteSurfaces: batch.spriteSurfaces }),
      ...options
    });
  }
  K.paper = Object.freeze({ stack, cut, relief, raycast, sdf, finish, shadows, draw, world });
})(KIT);
