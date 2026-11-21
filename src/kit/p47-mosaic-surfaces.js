/* Fitted polygon surfaces. Optional native triangle footprints share one cached
   silhouette; pieces retain keys across tilings, clipped fragments and carriers. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-9;
  const meshes = new WeakSet();
  const V2dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const finite = x => Number.isFinite(x) && Math.abs(x) <= 1e6;
  const point = (p, n) => Array.isArray(p) && p.length === n && p.every(finite);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = p => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - a[1] * p[(i + 1) % p.length][0], 0) / 2;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const fail = message => {
    throw new Error('Mosaic surface: ' + message);
  };
  function budget(n, max, label) {
    if (!Number.isSafeInteger(n) || n < 1 || n > max) fail('invalid ' + label + ' budget');
    return n;
  }
  function clip(poly, side) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        da = side(a),
        db = side(b);
      if (da >= 0) out.push(a);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) out.push(mix(a, b, da / (da - db)));
    }
    return out;
  }
  function voronoi({ sites, bounds = [0, 0, 1, 1], maxCells = 2048, maxWork = 4000000 } = {}) {
    budget(maxCells, 8192, 'cell');
    budget(maxWork, 64000000, 'work');
    if (
      !Array.isArray(sites) ||
      !sites.length ||
      sites.length > maxCells ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(finite) ||
      bounds[2] <= bounds[0] ||
      bounds[3] <= bounds[1]
    )
      fail('expected bounded sites and ordered chart bounds');
    const ids = new Set(),
      seeds = sites.map((s, i) => {
        const p = Array.isArray(s) ? s : s.point,
          key = String(s.key ?? s.id ?? i),
          weight = Array.isArray(s) ? 0 : (s.weight ?? 0);
        if (!point(p, 2) || !finite(weight) || !key || ids.has(key))
          fail('sites need unique keys and finite positions/weights');
        ids.add(key);
        return { key, point: p, weight };
      });
    let work = 0;
    const cells = [];
    for (const [i, a] of seeds.entries()) {
      let polygon = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]]
      ];
      for (const [j, b] of seeds.entries())
        if (i !== j) {
          const dx = b.point[0] - a.point[0],
            dy = b.point[1] - a.point[1];
          if (Math.hypot(dx, dy) < EPS) fail('site positions must be distinct');
          const offset =
            (b.point[0] ** 2 + b.point[1] ** 2 - a.point[0] ** 2 - a.point[1] ** 2 + a.weight - b.weight) / 2;
          work += polygon.length;
          if (work > maxWork) fail('Voronoi work budget exceeded');
          polygon = clip(polygon, p => offset - dx * p[0] - dy * p[1]);
          if (polygon.length < 3) break;
        }
      if (polygon.length >= 3 && area(polygon) > EPS) cells.push({ key: a.key, polygon });
    }
    return P.data.freeze({ cells, work });
  }
  function layout(input, { maxCells = 8192 } = {}) {
    budget(maxCells, 65536, 'cell');
    const raw = Array.isArray(input) ? input : (input?.cells ?? input?.tiles);
    if (!Array.isArray(raw) || !raw.length || raw.length > maxCells)
      fail('expected cells, clipped fragments or tiling tiles');
    let fragmentsUsed = 0,
      verticesUsed = 0;
    const keys = new Set(),
      cells = raw.map((cell, i) => {
        const key = String(cell.key ?? cell.id ?? i),
          fragments = cell.fragments ?? [cell.polygon];
        if (!key || keys.has(key) || !Array.isArray(fragments) || !fragments.length)
          fail('pieces need unique keys and polygon fragments');
        keys.add(key);
        fragmentsUsed += fragments.length;
        if (fragmentsUsed > 65536) fail('fragment budget exceeded');
        return {
          key,
          index: i,
          fragments: fragments.map(p => {
            if (!Array.isArray(p) || p.length < 3 || p.length > 128 || !p.every(q => point(q, 2)))
              fail('polygons need 3–128 finite chart vertices');
            verticesUsed += p.length;
            if (verticesUsed > 1000000) fail('vertex budget exceeded');
            // Reuse the shared profile validator for crossings, duplicate edges and winding.
            return P.construct.profile([p]).rings[0];
          })
        };
      });
    return P.data.freeze({ cells });
  }
  function inset(poly, d) {
    if (d === 0) return poly.map(p => p.slice());
    // Convex half-plane clipping safely removes short edges when an inset
    // changes topology. Voronoi slivers must not turn into inverted bevels.
    if (poly.every((a, i) => cross(a, poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]) >= -EPS)) {
      let result = poly.map(p => p.slice());
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        result = clip(result, p => cross(a, b, p) / length - d);
        if (result.length < 3) fail('seam or bevel consumes a polygon');
      }
      result = result.filter(
        (p, i) => Math.hypot(p[0] - result[(i + 1) % result.length][0], p[1] - result[(i + 1) % result.length][1]) > EPS
      );
      if (result.length < 3 || area(result) <= EPS) fail('seam or bevel consumes a polygon');
      return result;
    }
    const result = poly.map((p, i) => {
      const a = poly[(i + poly.length - 1) % poly.length],
        b = poly[(i + 1) % poly.length],
        u = [p[0] - a[0], p[1] - a[1]],
        v = [b[0] - p[0], b[1] - p[1]],
        lu = Math.hypot(...u),
        lv = Math.hypot(...v),
        n = [-u[1] / lu, u[0] / lu],
        m = [-v[1] / lv, v[0] / lv],
        den = 1 + n[0] * m[0] + n[1] * m[1];
      if (den < 1e-8) fail('inset cannot fit this corner');
      return [p[0] + (d * (n[0] + m[0])) / den, p[1] + (d * (n[1] + m[1])) / den];
    });
    if (
      result.some((p, i) => {
        const j = (i + 1) % poly.length;
        return (
          V2dot([result[j][0] - p[0], result[j][1] - p[1]], [poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]]) <= 0
        );
      })
    )
      fail('seam or bevel reverses an edge');
    if (area(result) <= EPS) fail('seam or bevel consumes a polygon');
    const field = P.construct.profile([poly]).sd;
    if (result.some(p => field(...p) > -d + Math.max(EPS, d * 1e-5)))
      fail('seam or bevel exceeds the polygon clearance');
    P.construct.profile([result]);
    return result;
  }
  function color(value) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) value = parseInt(value.slice(1), 16);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff)
      return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    if (point(value, 3) && value.every(v => v >= 0 && v <= 255)) return value.slice();
    fail('colors need RGB bytes or #rrggbb');
  }
  function mesh(input, options = {}) {
    const plan = layout(input, options),
      {
        sample = (uv, h) => [uv[0], uv[1], h],
        gap = 0.018,
        bevel = 0.012,
        bevelDepth = bevel,
        thickness = 0.04,
        subdivisions = 1,
        maxTriangles = 150000,
        grout = '#172332',
        palette = ['#168d9c', '#38c9cf', '#f1b45a'],
        paint,
        material,
        controls,
        back = false
      } = options;
    if (
      typeof sample !== 'function' ||
      ![gap, bevel, bevelDepth, thickness].every(n => finite(n) && n >= 0) ||
      bevelDepth > thickness ||
      !Array.isArray(palette) ||
      !palette.length ||
      palette.length > 256 ||
      (paint !== undefined && typeof paint !== 'function') ||
      (material !== undefined && typeof material !== 'function' && typeof material !== 'object') ||
      (controls !== undefined && typeof controls !== 'function' && typeof controls !== 'object') ||
      (material !== undefined && controls !== undefined)
    )
      fail('invalid carrier, dimensions or appearance');
    budget(subdivisions, 32, 'subdivision');
    budget(maxTriangles, 1000000, 'triangle');
    const colors = palette.map(color),
      groutColor = grout === false ? null : color(grout),
      triangles = [],
      pieces = [];
    function emit(a, b, c, cell, part, tint, optical, finish) {
      if (triangles.length + subdivisions ** 2 > maxTriangles) fail('triangle budget exceeded');
      // Same subdivision count on every shared edge, including bevel boundaries.
      const at = (i, j) => {
        const q = a.map((v, k) => v + ((b[k] - v) * i) / subdivisions + ((c[k] - v) * j) / subdivisions);
        const p = sample(q.slice(0, 2), q[2], cell.key);
        if (!point(p, 3)) fail('carrier returned a nonfinite 3D point');
        return { uv: q.slice(0, 2), point: p };
      };
      const add = (a, b, c) => {
        const n = V.cross(V.sub(b.point, a.point), V.sub(c.point, a.point));
        if (V.len(n) < 1e-12) fail('carrier produced a degenerate triangle');
        triangles.push({ vertices: [a, b, c], normal: V.norm(n), key: cell.key, part, color: tint, optical, finish });
      };
      for (let i = 0; i < subdivisions; i++)
        for (let j = 0; j < subdivisions - i; j++) {
          add(at(i, j), at(i + 1, j), at(i, j + 1));
          if (i + j + 1 < subdivisions) add(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
        }
    }
    const controlCache = new Map();
    function controlled(tint, cell) {
      if (controls === undefined) return null;
      const authored = typeof controls === 'function' ? controls(cell) : controls,
        key = JSON.stringify([tint, authored]);
      if (!controlCache.has(key))
        controlCache.set(key, MaterialControls.resolve({ albedo: tint.map(v => v / 255), controls: authored }));
      return controlCache.get(key);
    }
    for (const cell of plan.cells) {
      const tint = color(paint ? paint(cell) : colors[cell.index % colors.length]),
        mapped = controlled(tint, cell),
        optical =
          mapped?.optical ??
          (material === undefined
            ? null
            : OpticalMaterials.material(typeof material === 'function' ? material(cell) : material)),
        finish = mapped?.surface,
        first = triangles.length;
      for (const poly of cell.fragments) {
        const outer = inset(poly, gap / 2),
          inner = inset(poly, gap / 2 + bevel),
          top = thickness;
        const cap = (p, h, part, tint, optical, reverse = false) => {
          for (const t of P.geometry.triangulate2D(p)) {
            const q = t.map(i => [...p[i], h]);
            if (reverse) q.reverse();
            emit(...q, cell, part, tint, optical, part === 'grout' ? null : finish);
          }
        };
        const band = (a, b, ha, hb, part, tint, optical) => {
          if (a !== b) {
            const annulus = P.geometry.triangulatePolygon([a, b]);
            for (const tri of annulus.triangles) {
              const points = tri.map(i => [...annulus.points[i], i < a.length ? ha : hb]);
              emit(...points, cell, part, tint, optical, part === 'grout' ? null : finish);
            }
          } else
            for (let i = 0; i < a.length; i++) {
              const j = (i + 1) % a.length,
                A = [...a[i], ha],
                B = [...a[j], ha],
                C = [...b[j], hb],
                D = [...b[i], hb];
              emit(A, B, C, cell, part, tint, optical, finish);
              emit(A, C, D, cell, part, tint, optical, finish);
            }
        };
        cap(inner, top, 'face', tint, optical);
        if (bevel > 0) band(outer, inner, top - bevelDepth, top, 'bevel', tint, optical);
        if (thickness > bevelDepth) band(outer, outer, 0, top - bevelDepth, 'edge', tint, optical);
        if (back && thickness > 0) cap(outer, 0, 'back', tint, optical, true);
        if (groutColor && gap > 0)
          band(
            poly,
            outer,
            Math.max(0, thickness - bevelDepth * 1.8),
            Math.max(0, thickness - bevelDepth * 1.8),
            'grout',
            groutColor,
            null
          );
      }
      pieces.push({ key: cell.key, first, end: triangles.length });
    }
    // Build the chart acceleration only on first lookup. Render-only scenes pay
    // no query indexing cost, and repeated attachment queries stay local.
    let queryIndex;
    function index() {
      const min = [Infinity, Infinity],
        max = [-Infinity, -Infinity];
      for (const t of triangles)
        for (const { uv } of t.vertices)
          for (let k = 0; k < 2; k++) {
            min[k] = Math.min(min[k], uv[k]);
            max[k] = Math.max(max[k], uv[k]);
          }
      const n = Math.min(64, Math.max(2, Math.ceil(Math.sqrt(pieces.length)))),
        bins = new Map();
      let references = 0;
      const cell = (x, k) => Math.max(0, Math.min(n - 1, Math.floor(((x - min[k]) / (max[k] - min[k] || 1)) * n)));
      for (const t of triangles) {
        const u = t.vertices.map(v => v.uv[0]),
          v = t.vertices.map(v => v.uv[1]),
          lo = [cell(Math.min(...u), 0), cell(Math.min(...v), 1)],
          hi = [cell(Math.max(...u), 0), cell(Math.max(...v), 1)];
        references += (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1);
        if (references > 2000000) return () => triangles;
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let x = lo[0]; x <= hi[0]; x++) {
            const key = y * n + x;
            if (!bins.has(key)) bins.set(key, []);
            bins.get(key).push(t);
          }
      }
      return (u, v) =>
        u < min[0] || u > max[0] || v < min[1] || v > max[1] ? [] : (bins.get(cell(v, 1) * n + cell(u, 0)) ?? []);
    }
    // Query the actual subdivided triangles rather than the unsampled carrier.
    function locate(u, v, { includeSeams = false } = {}) {
      if (!finite(u) || !finite(v)) fail('lookup needs a finite chart point');
      queryIndex ??= index();
      for (const t of queryIndex(u, v)) {
        if (!includeSeams && t.part !== 'face' && t.part !== 'bevel') continue;
        const [a, b, c] = t.vertices.map(v => v.uv),
          d = cross(a, b, c);
        if (Math.abs(d) < EPS) continue;
        const x = cross([u, v], b, c) / d,
          y = cross(a, [u, v], c) / d,
          z = 1 - x - y;
        if (Math.min(x, y, z) < -EPS) continue;
        return {
          key: t.key,
          part: t.part,
          point: t.vertices[0].point.map((p, i) => p * x + t.vertices[1].point[i] * y + t.vertices[2].point[i] * z),
          normal: t.normal.slice(),
          color: t.color.slice()
        };
      }
      return null;
    }
    const result = P.data.freeze({ plan, triangles, pieces, locate });
    meshes.add(result);
    return result;
  }
  function emit(
    B,
    surface,
    { object = 'mosaic', opacity = 1, light = [-0.4, 0.8, 0.5], ambient = 0.48, animation } = {}
  ) {
    if (
      !B?.dab ||
      !meshes.has(surface) ||
      !finite(opacity) ||
      opacity <= 0 ||
      opacity > 4 ||
      !point(light, 3) ||
      V.len(light) < EPS ||
      !finite(ambient) ||
      ambient < 0 ||
      ambient > 1
    )
      fail('invalid builder or lighting');
    const L = V.norm(light),
      first = B.count(),
      ranges = [];
    for (const piece of surface.pieces) {
      const start = B.count(),
        target = { entity: object, surface: piece.key };
      for (let i = piece.first; i < piece.end; i++) {
        const t=surface.triangles[i], n=t.normal,
          brightness=ambient+(1-ambient)*Math.max(0,V.dot(n,L));
        K.surfacePatches.triangle(B,t.vertices.map(v=>v.point),{
          normal:n,color:t.color.map(v=>Math.round(v*brightness)),opacity,animation,
          finish:t.finish,light:L,optical:t.optical,object,material:t.part,target
        });
      }
      ranges.push({ key: piece.key, first: start, end: B.count() });
    }
    return { first, end: B.count(), pieces: ranges };
  }
  K.mosaic = P.mosaic = Object.freeze({ voronoi, layout, mesh, emit });
})(KIT);
