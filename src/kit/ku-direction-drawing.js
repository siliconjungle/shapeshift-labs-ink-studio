/* Camera-dependent linework with mesh-edge identity and continuous visibility spans. */
(function (K) {
  const kinds = ['crease', 'silhouette', 'occlusion'];
  const defaults = {
    crease: { width: 1, color: '#947b67' },
    silhouette: { width: 2, color: '#211d26' },
    occlusion: { width: 1.5, color: '#463541' }
  };
  const epsilon = 1e-8, tile = 32;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const at = (a, b, u) => a.map((n, i) => lerp(n, b[i], u));
  const orient = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const within = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const record = v => v && [Object.prototype, null].includes(Object.getPrototypeOf(v));

  function styleMap(value, group) {
    if (!record(value)) throw new TypeError('Direction drawing styles and edits must be records');
    return new Map(Object.entries(value).map(([key, style]) => {
      if (group && !kinds.includes(key) || !record(style) ||
          Object.keys(style).some(key => !['width', 'taper', 'color', 'visible'].includes(key)))
        throw new TypeError('Invalid direction drawing style');
      const { width, taper, color, visible } = style;
      if (width !== undefined && !within(width, .01, 128) ||
          taper !== undefined && (!Array.isArray(taper) || taper.length !== 2 || !within(taper[0], 0, 16) || !within(taper[1], 0, 16)) ||
          visible !== undefined && typeof visible !== 'boolean')
        throw new RangeError('Line styles need a positive width, two taper weights in [0,16], and a boolean visibility');
      if (color !== undefined) DrawingPrimitives.color(color);
      return [key, Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined))];
    }));
  }

  function prepare(sources) {
    if (!Array.isArray(sources) || !sources.length || sources.length > 64)
      throw new RangeError('Direction drawing needs 1 to 64 mesh sources');
    let vertices = 0, sides = 0;
    const ids = new Set();
    const meshes = Array.from(sources, ({ id, mesh, emit = true, weld = false } = {}) => {
      if (typeof id !== 'string' || !id.trim() || id.length > 128 || ids.has(id) ||
          typeof emit !== 'boolean' || typeof weld !== 'boolean')
        throw new TypeError('Direction drawing sources need distinct IDs and boolean emit and weld flags');
      ids.add(id);
      const geometry = K.procedural.geometry.topology(mesh);
      vertices += geometry.points.length;
      if (vertices > 100000) throw new RangeError('Direction drawing exceeds its vertex budget');
      if (!geometry.points.every(point => point.every(n => within(n, -1e9, 1e9))))
        throw new RangeError('Direction drawing mesh exceeds its coordinate budget');
      const points = geometry.points.map(p => p.slice());
      const coincident = new Map();
      const canonical = weld ? points.map((point, i) => {
        const key = point.join(',');
        if (!coincident.has(key)) coincident.set(key, i);
        return coincident.get(key);
      }) : null;
      const faces = [], edges = new Map();
      for (const face of geometry.faces) {
        sides += face.length;
        if (sides > 400000) throw new RangeError('Direction drawing exceeds its face edge budget');
        const indices = Array.from(face, i => canonical ? canonical[i] : i);
        if (new Set(indices).size !== face.length) continue;
        const faceIndex = faces.push(indices) - 1;
        if (!emit) continue;
        for (let i = 0; i < indices.length; i++) {
          const a = Math.min(indices[i], indices[(i + 1) % indices.length]);
          const b = Math.max(indices[i], indices[(i + 1) % indices.length]);
          const key = a * points.length + b;
          let edge = edges.get(key);
          if (!edge) edges.set(key, edge = { a, b, id: id + '/' + a + '-' + b, neighbors: [] });
          edge.neighbors.push(faceIndex);
        }
      }
      return { id, points, faces, edges };
    });
    return { extract: options => project(meshes, options) };
  }

  // Intersect the parameter range with a half-plane whose values at the two endpoints are a and b.
  function restrict(range, a, b) {
    if (a < 0 && b < 0) return false;
    if (a < 0) range[0] = Math.max(range[0], a / (a - b));
    if (b < 0) range[1] = Math.min(range[1], a / (a - b));
    return range[1] - range[0] > epsilon;
  }

  function union(spans) {
    const result = [];
    for (const span of spans.sort((a, b) => a[0] - b[0])) {
      const last = result.at(-1);
      if (last && span[0] <= last[1] + epsilon) last[1] = Math.max(last[1], span[1]);
      else result.push(span);
    }
    return result;
  }

  function triangleRange(triangle, a, b, threshold) {
    const range = [0, 1], { points: [p, q, r], area, depth } = triangle;
    const sign = Math.sign(area);
    const pa = orient(q, r, a), qa = orient(r, p, a), ra = orient(p, q, a);
    const pb = orient(q, r, b), qb = orient(r, p, b), rb = orient(p, q, b);
    if (!restrict(range, sign * pa, sign * pb) || !restrict(range, sign * qa, sign * qb) ||
        !restrict(range, sign * ra, sign * rb)) return null;
    if (!threshold) return range;
    const depthAt = (x, y, z) => (depth[0] * x + depth[1] * y + depth[2] * z) / area;
    return restrict(range, depthAt(pa, qa, ra) - threshold[0], depthAt(pb, qb, rb) - threshold[1]) ? range : null;
  }

  function project(meshes, { camera, width, height, creaseAngle = 35, probe = .75, depthBias = 1e-4,
    styles = {}, edits = {} } = {}) {
    if (![width, height].every(n => Number.isSafeInteger(n) && within(n, 1, 16384)) ||
        !within(creaseAngle, .001, 180) || !within(probe, .01, 8) || !within(depthBias, 1e-9, 1e3))
      throw new RangeError('Invalid direction drawing dimensions, crease angle, probe, or depth bias');
    const groups = styleMap(styles, true), overrides = styleMap(edits, false);
    const baseStyles = Object.fromEntries(kinds.map(kind => [kind, { taper: [1, 1], visible: true, ...defaults[kind], ...groups.get(kind) }]));
    const { toView, ring, point } = DrawingPrimitives.projector(camera, width, height);
    const near = camera.clipNear ?? .4, far = camera.clipFar ?? 400, ortho = camera.ortho;
    const depth = z => ortho ? -z : 1 / z;
    const angleLimit = Math.cos(creaseAngle * Math.PI / 180);
    const cols = Math.ceil(width / tile), rows = Math.ceil(height / tile), grid = new Map();
    let triangleCount = 0, visits = 0;
    function spend(n) {
      visits += n;
      if (visits > 8e6) throw new RangeError('Direction drawing exceeds its projected visibility work budget');
    }
    function tiles(points, visit) {
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const x0 = clamp(Math.floor(Math.min(...xs) / tile), 0, cols - 1);
      const x1 = clamp(Math.floor(Math.max(...xs) / tile), 0, cols - 1);
      const y0 = clamp(Math.floor(Math.min(...ys) / tile), 0, rows - 1);
      const y1 = clamp(Math.floor(Math.max(...ys) / tile), 0, rows - 1);
      spend((x1 - x0 + 1) * (y1 - y0 + 1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(y * cols + x);
    }

    const views = meshes.map(mesh => {
      const points = mesh.points.map(toView);
      const faces = mesh.faces.map(indices => {
        const vertices = indices.map(i => points[i]), origin = vertices[0];
        let normal = [0, 0, 0];
        for (let i = 2; i < vertices.length; i++)
          normal = K.V.add(normal, K.V.cross(K.V.sub(vertices[i - 1], origin), K.V.sub(vertices[i], origin)));
        const length = Math.hypot(...normal);
        if (!length) return null;
        normal = K.V.mul(normal, 1 / length);
        // View coordinates use positive forward depth, so the cross product points into a front face.
        const front = (ortho ? normal[2] : K.V.dot(normal, origin)) > 0;
        const clipped = ring(vertices), screen = clipped.map(point);
        const face = { normal, front, screen };
        for (let i = 2; i < screen.length; i++) {
          const xy = [screen[0], screen[i - 1], screen[i]], area = orient(...xy);
          if (Math.abs(area) <= epsilon || xy.every(p => p[0] < -8) || xy.every(p => p[0] > width + 8) ||
              xy.every(p => p[1] < -8) || xy.every(p => p[1] > height + 8)) continue;
          const triangle = { face, points: xy, area, id: triangleCount++,
            depth: [clipped[0], clipped[i - 1], clipped[i]].map(p => depth(p[2])) };
          tiles(xy, key => {
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(triangle);
          });
        }
        return face;
      });
      return { ...mesh, viewPoints: points, viewFaces: faces };
    });

    const checked = new Uint32Array(triangleCount);
    let query = 0, spanCount = 0;
    function spans(a, b, ignore, threshold) {
      const result = [];
      query++;
      tiles([a, b], key => {
        const triangles = grid.get(key);
        if (!triangles) return;
        spend(triangles.length);
        for (const triangle of triangles) {
          if (checked[triangle.id] === query) continue;
          checked[triangle.id] = query;
          if (ignore.has(triangle.face)) continue;
          const range = triangleRange(triangle, a, b, threshold);
          if (range) result.push(range);
        }
      });
      return union(result);
    }

    const paths = [], draw = { crease: [], silhouette: [], occlusion: [] };
    for (const mesh of views) for (const edge of mesh.edges.values()) {
      const faces = edge.neighbors.map(i => mesh.viewFaces[i]).filter(Boolean);
      if (!faces.length) continue;
      const front = faces.filter(face => face.front);
      const contour = faces.length === 1 || (front.length > 0 && front.length < faces.length);
      if (!contour) {
        let crease = false;
        for (let i = 0; i < faces.length && !crease; i++) for (let j = i + 1; j < faces.length; j++) {
          spend(1);
          if (K.V.dot(faces[i].normal, faces[j].normal) <= angleLimit) {
            crease = true;
            break;
          }
        }
        if (!crease) continue;
      }
      const start = mesh.viewPoints[edge.a], end = mesh.viewPoints[edge.b], clip = [0, 1];
      if (!restrict(clip, start[2] - near, end[2] - near) || !restrict(clip, far - start[2], far - end[2])) continue;
      const [first, last] = clip.map(t => at(start, end, t));
      const projected = [point(first), point(last)], [p, q] = projected, screen = [0, 1];
      if (!restrict(screen, p[0], q[0]) || !restrict(screen, width - p[0], width - q[0]) ||
          !restrict(screen, p[1], q[1]) || !restrict(screen, height - p[1], height - q[1])) continue;
      const [a, b] = screen.map(t => at(p, q, t));
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length <= epsilon) continue;

      // Perspective-correct conversion from projected distance to the parent edge's world parameter.
      const edgeT = t => {
        const u = lerp(screen[0], screen[1], t);
        return lerp(clip[0], clip[1], ortho ? u : u * first[2] / lerp(last[2], first[2], u));
      };
      const ignore = new Set(faces);
      const threshold = [0, 1].map(t => depth(Math.max(near / 2, lerp(start[2], end[2], edgeT(t)) - depthBias)));
      const hidden = spans(a, b, ignore, threshold);
      const visible = [];
      let cursor = 0;
      for (const [lo, hi] of hidden) {
        if (lo - cursor > epsilon) visible.push([cursor, lo]);
        cursor = hi;
      }
      if (1 - cursor > epsilon) visible.push([cursor, 1]);

      const support = (front[0] ?? faces[0]).screen;
      const sides = support.map(v => orient(a, b, v));
      const side = Math.sign(sides.reduce((max, v) => Math.abs(v) > Math.abs(max) ? v : max, 0));
      const offset = side * probe / length;
      const outside = ([x, y]) => [x + dy * offset, y - dx * offset];
      const backdrop = contour && side && visible.length ? spans(outside(a), outside(b), ignore) : [];
      const path = { id: edge.id, objectId: mesh.id, vertices: [edge.a, edge.b],
        points: [mesh.points[edge.a].slice(), mesh.points[edge.b].slice()], spans: [] };
      const edit = overrides.get(edge.id);
      function append(kind, from, to) {
        if (to - from <= epsilon) return;
        if (++spanCount > 32768) throw new RangeError('Direction drawing exceeds its visible span budget');
        const style = { ...baseStyles[kind], ...edit };
        style.taper = style.taper.slice();
        const points = [at(a, b, from), at(a, b, to)], range = [edgeT(from), edgeT(to)];
        const span = { kind, range, points, ...style };
        path.spans.push(span);
        if (style.visible) {
          // Split drawn strokes at regular distance when world-linear taper needs perspective correction.
          const steps = ortho || style.taper[0] === style.taper[1] ? 1 : Math.min(16, Math.ceil((to - from) * length / 24));
          const samples = Array.from({ length: steps + 1 }, (_, i) => lerp(from, to, i / steps));
          span.stroke = { type: 'path', points: samples.map(u => at(a, b, u)), width: style.width, color: style.color,
            weights: samples.map(u => lerp(style.taper[0], style.taper[1], clamp(edgeT(u), 0, 1))) };
          draw[kind].push(span.stroke);
        }
      }
      let begin = 0;
      for (const [lo, hi] of visible) {
        if (!contour) {
          append('crease', lo, hi);
          continue;
        }
        let cursor = lo;
        while (begin < backdrop.length && backdrop[begin][1] <= lo) begin++;
        for (let i = begin; i < backdrop.length && backdrop[i][0] < hi; i++) {
          const [from, to] = backdrop[i];
          append('silhouette', cursor, Math.max(lo, from));
          cursor = Math.min(hi, to);
          append('occlusion', Math.max(lo, from), cursor);
        }
        append('silhouette', cursor, hi);
      }
      paths.push(path);
    }
    return { paths, draw: kinds.flatMap(kind => draw[kind]) };
  }

  function extract({ sources, ...options } = {}) {
    return prepare(sources).extract(options);
  }

  K.directionDrawing = Object.freeze({ prepare, extract });
})(KIT);
