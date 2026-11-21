/* Optional SDF reconstruction into connected, flat-shaded native patches. */
(function (K) {
  const P = K.procedural,
    G = P.geometry,
    { V, M } = K,
    EPS = 1e-12;
  const fail = s => {
    throw new RangeError('Facets: ' + s);
  };
  const vec = p => Array.isArray(p) && p.length === 3 && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6);
  const num = (x, a, b, label) => {
    if (!Number.isFinite(x) || x < a || x > b) fail('invalid ' + label);
    return x;
  };
  const budget = (x, max, label) => {
    num(x, 1, max, label);
    if (!Number.isSafeInteger(x)) fail('invalid ' + label);
    return x;
  };
  const rgb = c => {
    if (typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)) c = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    if (!vec(c) || c.some(x => x < 0 || x > 255)) fail('expected RGB bytes or #RRGGBB');
    return c.slice();
  };
  function frame(orientation) {
    if (!vec(orientation)) fail('expected XYZ orientation in radians');
    return M.mul(
      M.rot([0, 0, 1], orientation[2]),
      M.mul(M.rot([0, 1, 0], orientation[1]), M.rot([1, 0, 0], orientation[0]))
    );
  }
  function compile(points, faces, { maxFacets = 50000, maxVertices = 100000, stats = {}, ids } = {}) {
    budget(maxFacets, 500000, 'facet budget');
    budget(maxVertices, 1000000, 'vertex budget');
    if (
      !Array.isArray(points) ||
      points.length > maxVertices ||
      !points.every(vec) ||
      !Array.isArray(faces) ||
      faces.length > maxFacets
    )
      fail('invalid geometry or facet/vertex budget exceeded');
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.length !== faces.length ||
        ids.some(id => typeof id !== 'string' || !id.length || id.length > 256) ||
        new Set(ids).size !== ids.length)
    )
      fail('invalid facet IDs');
    const vertices = points.map(p => p.slice()),
      facets = [];
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const p of vertices)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    for (const [id, indices] of faces.entries()) {
      if (
        !Array.isArray(indices) ||
        indices.length !== 3 ||
        !indices.every(i => Number.isSafeInteger(i) && i >= 0 && i < vertices.length)
      )
        fail('invalid triangle index');
      const [a, b, c] = indices.map(i => vertices[i]),
        cross = V.cross(V.sub(b, a), V.sub(c, a)),
        length = V.len(cross);
      if (length <= EPS) continue;
      facets.push({
        id: ids ? ids[id] : String(id),
        indices: indices.slice(),
        normal: V.mul(cross, 1 / length),
        center: V.mul(V.add(a, V.add(b, c)), 1 / 3),
        area: length / 2
      });
    }
    return P.data.freeze({
      format: 'ink-studio/faceted-surface',
      version: 1,
      vertices,
      facets,
      bounds: vertices.length ? { min, max } : null,
      stats: { ...stats, vertices: vertices.length, facets: facets.length }
    });
  }
  function fromSdf(
    source,
    {
      bounds,
      size = 0.3,
      orientation = [0, 0, 0],
      origin,
      method = 'dualContour',
      iso = 0,
      refine = 2,
      maxCells = 150000,
      maxSamples = 2000000,
      maxFacets = 50000,
      maxVertices = 100000,
      normal
    } = {}
  ) {
    const fn = typeof source === 'function' ? source : source?.sd?.bind(source);
    if (!fn || !vec(bounds?.min) || !vec(bounds?.max) || bounds.min.some((v, i) => v >= bounds.max[i]))
      fail('expected a signed field and ordered bounds');
    const cell = typeof size === 'number' ? [size, size, size] : size;
    if (!vec(cell) || cell.some(v => v < 0.0001 || v > 1e4) || Math.max(...cell) / Math.min(...cell) > 32)
      fail('expected positive facet sizes with aspect ratio at most 32');
    if (!['dualContour', 'surfaceNets'].includes(method) || (normal !== undefined && typeof normal !== 'function'))
      fail('invalid extraction method/normal');
    budget(maxCells, 1000000, 'cell budget');
    budget(maxSamples, 14000000, 'sample budget');
    budget(maxFacets, 500000, 'facet budget');
    budget(maxVertices, 1000000, 'vertex budget');
    num(iso, -1e6, 1e6, 'iso value');
    num(refine, 0, 8, 'refinement');
    if (!Number.isInteger(refine)) fail('invalid refinement');
    const R = frame(orientation),
      inverse = M.tr(R),
      at = origin ?? V.mul(V.add(bounds.min, bounds.max), 0.5);
    if (!vec(at)) fail('invalid grid origin');
    const local = p => M.app(inverse, V.sub(p, at)).map((x, i) => x / cell[i]),
      world = p =>
        V.add(
          at,
          M.app(
            R,
            p.map((x, i) => x * cell[i])
          )
        ),
      corners = Array.from({ length: 8 }, (_, j) =>
        local([0, 1, 2].map(i => (j & (1 << i) ? bounds.max[i] : bounds.min[i])))
      ),
      domain = {
        min: [0, 1, 2].map(i => Math.min(...corners.map(p => p[i]))),
        max: [0, 1, 2].map(i => Math.max(...corners.map(p => p[i])))
      };
    const extracted = G[method]((x, y, z) => fn(...world([x, y, z])), domain, {
      cell: 1,
      iso,
      refine,
      maxCells,
      maxSamples,
      latticeBounds: { min: domain.min.map(Math.floor), max: domain.max.map(Math.ceil) },
      ...(normal && {
        normal: (x, y, z) => {
          const n = normal(...world([x, y, z]));
          if (!vec(n) || V.len(n) < EPS) fail('invalid normal');
          return M.app(inverse, n).map((v, i) => v * cell[i]);
        }
      })
    });
    return compile(extracted.points.map(world), extracted.triangles, {
      maxFacets,
      maxVertices,
      stats: {
        method,
        cells: extracted.work.cells,
        samples: extracted.work.samples,
        activeCells: extracted.work.active,
        size: cell.slice(),
        orientation: orientation.slice()
      }
    });
  }
  function fromMesh(source, options = {}) {
    let points = source?.points ?? source?.vertices,
      faces = source?.faces ?? source?.triangles;
    const packed = source?.pos ?? source?.positions,
      indices = source?.tri;
    const maxV = budget(options.maxVertices ?? 100000, 1000000, 'vertex budget'),
      maxF = budget(options.maxFacets ?? 50000, 500000, 'facet budget');
    if (
      (packed && packed.length > maxV * 3) ||
      (indices && indices.length > maxF * 3) ||
      (faces && faces.length > maxF * (typeof faces[0] === 'number' ? 3 : 1))
    )
      fail('mesh budget exceeded');
    if (packed) {
      if ((!ArrayBuffer.isView(packed) && !Array.isArray(packed)) || packed.length % 3)
        fail('invalid packed positions');
      points = Array.from({ length: packed.length / 3 }, (_, i) => Array.from(packed.slice(i * 3, i * 3 + 3)));
    }
    const flat = indices ?? (ArrayBuffer.isView(faces) || typeof faces?.[0] === 'number' ? faces : null);
    if (flat) {
      if (flat.length % 3) fail('invalid packed triangles');
      faces = Array.from({ length: flat.length / 3 }, (_, i) => Array.from(flat.slice(i * 3, i * 3 + 3)));
    }
    if (!faces && packed && points.length % 3) fail('triangle streams need complete vertex triples');
    if (!faces && packed) faces = Array.from({ length: points.length / 3 }, (_, i) => [i * 3, i * 3 + 1, i * 3 + 2]);
    return compile(points, faces, options);
  }
  function validated(plan) {
    if (
      plan?.format !== 'ink-studio/faceted-surface' ||
      plan.version !== 1 ||
      !Array.isArray(plan.facets) ||
      plan.facets.length > 500000
    )
      fail('expected a faceted surface');
    return compile(
      plan.vertices,
      plan.facets.map(f => f.indices),
      { maxFacets: 500000, maxVertices: 1000000, ids: plan.facets.map(f => f.id) }
    );
  }
  function hash(key, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function appearance(
    plan,
    {
      palette = ['#496975', '#779386', '#d5b37a'],
      color,
      grouping = 'normal',
      normalAngle = 0.35,
      groupSize = 0.6,
      seed = 1,
      variation = 0.06,
      light = [-0.5, 0.8, 0.45],
      ambient = 0.3,
      shadeSteps = 6,
      emissive = false
    } = {}
  ) {
    if (!Array.isArray(palette) || !palette.length || palette.length > 256) fail('invalid palette');
    const colors = palette.map(rgb);
    if (color !== undefined && typeof color !== 'function') color = rgb(color);
    if (typeof grouping !== 'function' && !['normal', 'spatial', 'facet'].includes(grouping))
      fail('unknown color grouping');
    num(normalAngle, 0.02, Math.PI / 2, 'normal angle');
    num(groupSize, 0.0001, 1e5, 'group size');
    num(seed, 0, 4294967295, 'seed');
    if (!Number.isInteger(seed)) fail('invalid seed');
    num(variation, 0, 0.5, 'variation');
    num(ambient, 0, 1, 'ambient');
    budget(shadeSteps, 64, 'shade steps');
    if (!vec(light) || V.len(light) < EPS || typeof emissive !== 'boolean') fail('invalid lighting');
    const L = V.norm(light),
      quant = Math.sin(normalAngle),
      groups = new Map();
    const rows = plan.facets.map(f => {
      const group =
        typeof grouping === 'function'
          ? grouping(f)
          : grouping === 'facet'
            ? f.id
            : grouping === 'spatial'
              ? f.center.map(x => Math.floor(x / groupSize)).join('/')
              : f.normal.map(x => Math.round(x / quant)).join('/');
      if (
        !['string', 'number'].includes(typeof group) ||
        !String(group).length ||
        String(group).length > 256 ||
        (typeof group === 'number' && !Number.isFinite(group))
      )
        fail('invalid group key');
      const key = String(group),
        h = hash(key, seed);
      if (!groups.has(key)) groups.set(key, { key, index: groups.size });
      const base =
          typeof color === 'function'
            ? rgb(color(Object.freeze({ ...f, group: key })))
            : (color ?? colors[h % colors.length]),
        dot = Math.max(0, V.dot(f.normal, L)),
        tone = shadeSteps === 1 ? 0.5 : Math.round(dot * (shadeSteps - 1)) / (shadeSteps - 1),
        value =
          (emissive ? 1 : ambient + (1 - ambient) * tone) * (1 - variation + 2 * variation * ((h >>> 8) / 16777215)),
        tint = base.map(v => Math.max(0, Math.min(255, Math.round(v * value))));
      return { facet: f, group: key, color: tint, albedo: base.slice() };
    });
    return { rows, groups: [...groups.values()] };
  }
  function draw(B, input, options = {}) {
    if (!B?.dab) fail('draw needs a native builder');
    const plan = validated(input),
      paint = appearance(plan, options),
      opacity = num(options.opacity ?? 1, 0.001, 4, 'opacity'),
      first = B.count(),
      ranges = [];
    for (const row of paint.rows) {
      const f = row.facet,
        index = B.count();
      K.surfacePatches.triangle(
        B,
        f.indices.map(i => plan.vertices[i]),
        {
          normal: f.normal,
          color: row.color,
          albedo: row.albedo.map(x => x / 255),
          opacity,
          target: { entity: options.object ?? 'facets', surface: f.id },
          animation: { ...options.animation, em: options.emissive === true },
          object: options.object ?? 'facets',
          material: options.material ?? 'faceted-surface',
          finish: options.finish,
          light: options.light
        }
      );
      ranges.push({ id: f.id, group: row.group, first: index, end: B.count() });
    }
    return {
      first,
      end: B.count(),
      ids: Array.from({ length: B.count() - first }, (_, i) => first + i),
      facets: ranges,
      groups: paint.groups
    };
  }
  function toMesh(input, options = {}) {
    const plan = validated(input),
      paint = appearance(plan, { ...options, emissive: true, variation: options.variation ?? 0 }),
      positions = [],
      tri = [],
      mats = [],
      tmat = [],
      byColor = new Map();
    for (const p of plan.vertices) positions.push(...p);
    for (const row of paint.rows) {
      const key = row.color.join('/');
      if (!byColor.has(key)) {
        if (mats.length >= 65535) fail('material budget exceeded');
        byColor.set(key, mats.length);
        mats.push({ name: row.group, rgb: row.color.map(x => x / 255) });
      }
      tri.push(...row.facet.indices);
      tmat.push(byColor.get(key));
    }
    return K.mesh.make(positions, tri, null, tmat, mats.length ? mats : [{ name: 'empty', rgb: [0, 0, 0] }]);
  }
  K.facets = Object.freeze({
    fromSdf,
    fromMesh,
    appearance: (input, options) => appearance(validated(input), options),
    draw,
    toMesh
  });
})(KIT);
