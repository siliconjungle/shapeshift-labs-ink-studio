/* Selection operates on authored polygons and their incidence, including UV-discontinuous edges. */
(function (K) {
  const topology = K.meshTopology, { V } = K;
  const format = 'ink-studio/mesh-selection';
  const visibilityFormat = 'ink-studio/mesh-component-visibility';
  const domains = ['vertices', 'edges', 'faces'];
  const modes = ['loop', 'ring', 'boundary', 'island'];
  const graphs = new WeakMap();
  const record = (value, keys) => !!value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const ids = (values, map) => {
    if (!Array.isArray(values)) throw new TypeError('Component IDs need an array');
    for (const id of values) {
      if (!map.has(id)) throw new RangeError('Unknown mesh component ' + id);
    }
    return new Set(values);
  };
  const unique = values => [...new Set(values)];
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const edgeKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  const connector = domain => domain === 'edges' ? 'vertices' : 'edges';

  function graph(doc) {
    if (graphs.has(doc)) return graphs.get(doc);
    const vertices = index(doc.vertices), edges = index(topology.inspect(doc).edges), faces = index(doc.faces);
    const atVertex = new Map(doc.vertices.map(({ id }) => [id, { edges: [], faces: [] }]));
    const atFace = new Map(), corners = new Map(), atEdge = new Map(), edgeByPair = new Map();
    for (const { id, vertices } of edges.values()) for (const vertex of vertices) atVertex.get(vertex).edges.push(id);
    for (const face of faces.values()) {
      atFace.set(face.id, { vertices: face.corners.map(corner => corner.vertex), edges: [] });
      for (const corner of face.corners) {
        corners.set(corner.id, corner);
        atVertex.get(corner.vertex).faces.push(face.id);
      }
    }
    for (const { id, uses, vertices } of edges.values()) {
      atEdge.set(id, { faces: uses.map(use => use.face), vertices });
      edgeByPair.set(edgeKey(...vertices), id);
      for (const use of uses) atFace.get(use.face).edges.push(id);
    }
    function related(domain, id, into) {
      const element = domain === 'vertices' ? atVertex.get(id) : domain === 'faces' ? atFace.get(id) : atEdge.get(id);
      return element[into];
    }
    const result = { components: { vertices, edges, faces }, related, corners, atFace, edgeByPair };
    graphs.set(doc, result);
    return result;
  }

  function flood(seeds, next, steps = Infinity) {
    const visited = new Set(seeds), queue = [...seeds];
    let first = 0, end = queue.length;
    for (let step = 0; first < end && step < steps; step++, end = queue.length) {
      for (; first < end; first++) for (const id of next(queue[first])) if (!visited.has(id)) {
        visited.add(id);
        queue.push(id);
      }
    }
    return visited;
  }

  function layers(g, domain, seeds, steps, include = () => true) {
    const via = connector(domain), visited = new Set();
    return flood(seeds, id => {
      const next = [];
      for (const mid of g.related(domain, id, via)) if (!visited.has(mid)) {
        visited.add(mid);
        for (const candidate of g.related(via, mid, domain)) if (include(candidate)) next.push(candidate);
      }
      return next;
    }, steps);
  }

  function openRim(g) {
    const result = new Map();
    return vertex => {
      if (!result.has(vertex)) {
        const edges = g.related('vertices', vertex, 'edges').map(id => g.components.edges.get(id));
        const open = edges.filter(edge => edge.uses.length === 1);
        result.set(vertex, open.length === 2 && edges.every(edge => edge.uses.length <= 2) ?
          open.map(edge => edge.id) : []);
      }
      return result.get(vertex);
    };
  }

  function acrossVertex(g, edge, rim, boundaryOnly) {
    const { vertices, uses } = g.components.edges.get(edge);
    if (uses.length > 2 || boundaryOnly && uses.length !== 1) return [];
    return vertices.flatMap(vertex => {
      const around = g.related('vertices', vertex, 'edges');
      if (uses.length === 1) return rim(vertex).filter(id => id !== edge);
      if (around.length !== 4 || around.some(id => g.components.edges.get(id).uses.length !== 2) ||
          g.related('vertices', vertex, 'faces').some(id => g.atFace.get(id).vertices.length !== 4)) return [];
      const adjacent = new Set(uses.flatMap(({ face }) => g.atFace.get(face).edges));
      const opposite = around.filter(id => !adjacent.has(id));
      return opposite.length === 1 ? opposite : [];
    });
  }

  function acrossFace(g, edge) {
    const { uses, vertices } = g.components.edges.get(edge);
    if (uses.length > 2) return [];
    return uses.flatMap(({ face }) => {
      const ring = g.atFace.get(face);
      if (ring.vertices.length !== 4) return [];
      return ring.edges.filter(id => {
        const candidate = g.components.edges.get(id);
        return candidate.uses.length <= 2 && candidate.vertices.every(vertex => !vertices.includes(vertex));
      });
    });
  }

  function boundary(g, faces) {
    const candidates = unique([...faces].flatMap(id => g.related('faces', id, 'edges')));
    return new Set(candidates.filter(id => {
      const { uses } = g.components.edges.get(id);
      return uses.length === 1 || uses.some(use => !faces.has(use.face));
    }));
  }

  function onBoundary(g, domain, id) {
    const edges = domain === 'edges' ? [id] : g.related(domain, id, 'edges');
    return !edges.length || edges.some(edge => g.components.edges.get(edge).uses.length === 1);
  }

  function convert(g, selection, from, to, match) {
    if (from === to) return selection;
    const targets = unique([...selection].flatMap(id => g.related(from, id, to)));
    return new Set(match === 'any' ? targets : targets.filter(id => g.related(to, id, from).every(other => selection.has(other))));
  }

  function seam(g, edge) {
    if (edge.uvSeam) return true;
    if (edge.uses.length < 2) return false;
    const pairs = edge.uses.map(use => {
      const a = g.corners.get(use.from), b = g.corners.get(use.to);
      return a.vertex === edge.vertices[0] ? [...a.uv, ...b.uv] : [...b.uv, ...a.uv];
    });
    return pairs.some(pair => pair.some((n, i) => Math.abs(n - pairs[0][i]) > 1e-6));
  }

  function normal(g, id) {
    const points = g.atFace.get(id).vertices.map(vertex => g.components.vertices.get(vertex).position);
    const relative = points.map(point => V.sub(point, points[0]));
    const scale = Math.max(...relative.flat().map(Math.abs));
    const local = relative.map(point => point.map(n => n / scale));
    const direction = local.reduce((sum, point, i) => V.add(sum, V.cross(point, local[(i + 1) % points.length])), [0, 0, 0]);
    const length = V.len(direction);
    return direction.map(n => n / length);
  }

  function filtered(doc, g, domain, selection, filter, { visibility, object, part }) {
    if (filter === undefined) return selection;
    if (!record(filter, ['materials', 'seam', 'crease', 'visibility', 'backfaces'])) throw new TypeError('Invalid mesh selection filter');
    const { materials, seam: uv, crease, visibility: view, backfaces } = filter;
    if (materials !== undefined && (!Array.isArray(materials) || !materials.length ||
        !Array.from(materials).every(id => typeof id === 'string' && id.trim())))
      throw new TypeError('Material filters need one or more material IDs');
    if (uv !== undefined && typeof uv !== 'boolean') throw new TypeError('Use a boolean seam filter');
    if (crease !== undefined && !record(crease, ['min', 'max'])) throw new TypeError('Creases need a degree range');
    const { min = 0, max = 180 } = crease ?? {};
    if (crease && (![min, max].every(Number.isFinite) || min < 0 || max > 180 || min > max))
      throw new RangeError('Crease angles must range from 0 to 180 degrees');
    if (backfaces !== undefined && (!['include', 'exclude'].includes(backfaces) || !['visible', 'through'].includes(view)))
      throw new TypeError('Choose backfaces include or exclude with visible or through selection');
    let eligible;
    if (view !== undefined) {
      if (!['visible', 'hidden', 'through'].includes(view)) throw new RangeError('Choose visible, hidden, or through components');
      if (visibility?.format !== visibilityFormat || visibility.version !== 1 ||
          visibility.mesh !== doc.id || visibility.revision !== topology.revision(doc))
        throw new RangeError('Capture mesh visibility for this topology revision before filtering');
      if (object !== undefined && visibility.object !== undefined &&
          (visibility.object !== object || visibility.part !== part))
        throw new RangeError('Capture mesh visibility for the selected scene object and part');
      const participation = visibility.participation;
      const lane = view === 'through' ? backfaces === 'exclude' ? 'throughFront' : 'through' : 'visibleFront';
      const needsParticipation = view === 'through' || backfaces === 'exclude';
      if (needsParticipation && !Array.isArray(participation?.[lane]?.[domain]))
        throw new RangeError('Capture mesh visibility with through and backface participation before filtering');
      eligible = ids((needsParticipation ? participation[lane] : visibility.visible)?.[domain], g.components[domain]);
    }

    const materialIds = materials && new Set(materials), normals = new Map(), matches = new Map();
    function edgeMatches(id) {
      if (matches.has(id)) return matches.get(id);
      const edge = g.components.edges.get(id);
      let accepted = uv === undefined || uv === seam(g, edge);
      if (accepted && crease) {
        const directions = edge.uses.length === 2 && edge.uses.map(({ face }) => {
          if (!normals.has(face)) normals.set(face, normal(g, face));
          return normals.get(face);
        });
        const angle = directions && Math.acos(Math.min(1, Math.max(-1, V.dot(...directions)))) * 180 / Math.PI;
        accepted = angle !== false && angle + 1e-8 >= min && angle - 1e-8 <= max;
      }
      matches.set(id, accepted);
      return accepted;
    }
    return new Set([...selection].filter(id => {
      if (eligible && eligible.has(id) !== (view !== 'hidden')) return false;
      if (materialIds) {
        const faces = domain === 'faces' ? [id] : g.related(domain, id, 'faces');
        if (!faces.some(face => materialIds.has(g.components.faces.get(face).material))) return false;
      }
      if (uv === undefined && !crease) return true;
      const edges = domain === 'edges' ? [id] : g.related(domain, id, 'edges');
      return edges.some(edgeMatches);
    }));
  }

  function select(source, request, { visibility, object, part } = {}) {
    if (!record(request, ['domain', 'ids', 'from', 'traverse', 'grow', 'shrink', 'convert', 'match', 'filter']))
      throw new TypeError('Use a mesh component selection query');
    const doc = topology.create(source), revision = topology.revision(doc), g = graph(doc);
    const { from, traverse, grow = 0, shrink = 0, convert: into, match = 'any', filter } = request;
    let domain = request.domain === undefined ? from?.domain : request.domain;
    if (!domains.includes(domain) || into !== undefined && !domains.includes(into) ||
        !['any', 'all'].includes(match) || request.match !== undefined && into === undefined)
      throw new TypeError('Choose vertices, edges or faces and an optional conversion match');
    if (traverse !== undefined && !modes.includes(traverse)) throw new TypeError('Unknown mesh selection traversal');
    if (![grow, shrink].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 128))
      throw new RangeError('Grow and shrink need 0 to 128 steps');
    if (from !== undefined && (request.ids !== undefined || from?.format !== format || from.version !== 1 ||
        from.mesh !== doc.id || from.revision !== revision || from.domain !== domain || !Array.isArray(from.ids)))
      throw new RangeError('Use a saved selection for the same topology revision and domain');
    const seeds = from === undefined ? request.ids : from.ids;
    let selection = seeds === undefined ? new Set(g.components[domain].keys()) : ids(seeds, g.components[domain]);
    if (traverse === 'island') selection = layers(g, domain, selection, Infinity);
    if (traverse === 'boundary' && domain === 'faces') {
      selection = boundary(g, selection);
      domain = 'edges';
    } else if (traverse !== undefined && traverse !== 'island') {
      if (domain !== 'edges' || traverse !== 'boundary' && seeds === undefined)
        throw new TypeError('Loop and ring traversal need edge seeds, and boundaries need an edge or face domain');
      if (traverse === 'ring') selection = flood(selection, id => acrossFace(g, id));
      else {
        const open = traverse === 'boundary', rim = openRim(g);
        if (open) selection = new Set([...selection].filter(id => g.components.edges.get(id).uses.length === 1));
        selection = flood(selection, id => acrossVertex(g, id, rim, open));
      }
    }
    if (grow) selection = layers(g, domain, selection, grow);
    if (shrink && selection.size) {
      const outside = new Set(), via = connector(domain);
      for (const id of g.components[domain].keys()) if (!selection.has(id))
        for (const mid of g.related(domain, id, via)) outside.add(mid);
      const border = new Set([...selection].filter(id => onBoundary(g, domain, id) ||
        g.related(domain, id, via).some(mid => outside.has(mid))));
      for (const id of layers(g, domain, border, shrink - 1, other => selection.has(other))) selection.delete(id);
    }
    if (into !== undefined) {
      selection = convert(g, selection, domain, into, match);
      domain = into;
    }
    selection = filtered(doc, g, domain, selection, filter, { visibility, object, part });
    return Object.freeze({ format, version: 1, mesh: doc.id, revision, domain, ids: Object.freeze([...selection].sort()) });
  }

  // The raster uses viewport coordinates measured from pixel edges and camera-space axial depth.
  function projector(camera, w, h) {
    const { view, focal, ortho, clipNear, clipFar } = camera ?? {};
    if (view?.length !== 16 || !Array.from(view).every(Number.isFinite) ||
        ![focal, clipNear, clipFar].every(Number.isFinite) || focal <= 0 || clipNear <= 0 || clipFar <= clipNear)
      throw new TypeError('Mesh visibility needs the native raster camera and focal length');
    const viewPoint = ([x, y, z]) => [
      view[0] * x + view[4] * y + view[8] * z + view[12],
      view[1] * x + view[5] * y + view[9] * z + view[13],
      -(view[2] * x + view[6] * y + view[10] * z + view[14])
    ];
    function project([x, y, z]) {
      const scale = focal / (ortho ? 1 : z);
      return [w * .5 + x * scale, h * .5 - y * scale];
    }
    function point(value) {
      return value[2] >= clipNear && value[2] <= clipFar ? project(value) : null;
    }
    function segment(a, b) {
      if (a[2] > b[2]) [a, b] = [b, a];
      if (b[2] < clipNear || a[2] > clipFar) return null;
      const at = z => a.map((n, i) => n + (b[i] - n) * (z - a[2]) / (b[2] - a[2]));
      return [project(a[2] < clipNear ? at(clipNear) : a), project(b[2] > clipFar ? at(clipFar) : b)];
    }
    return { viewPoint, project, point, segment };
  }

  function nearSegment([x, y], [[ax, ay], [bx, by]]) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2 <= 1;
  }

  function viewParticipation(raster, camera, w, h) {
    const { focal, ortho, clipNear, clipFar } = camera;
    const x = w / (2 * focal), y = h / (2 * focal);
    const side = (a, b, limit) => ({ normal: [a, b, ortho ? 0 : -limit], offset: ortho ? limit : 0 });
    const planes = [side(1, 0, x), side(-1, 0, x), side(0, 1, y), side(0, -1, y),
      { normal: [0, 0, -1], offset: -clipNear }, { normal: [0, 0, 1], offset: clipFar }];
    const distance = ({ normal, offset }, point) => V.dot(normal, point) - offset;
    const point = p => planes.every(plane => distance(plane, p) <= 0);

    function segment(a, b) {
      let start = 0, end = 1;
      for (const plane of planes) {
        const da = distance(plane, a), db = distance(plane, b);
        if (da > 0 && db > 0) return false;
        if (da > 0) start = Math.max(start, da / (da - db));
        else if (db > 0) end = Math.min(end, da / (da - db));
        if (start > end) return false;
      }
      return true;
    }

    function triangle(points) {
      const inside = points.every(point);
      if (!inside && planes.some(plane => points.every(p => distance(plane, p) > 0))) return false;
      const polygon = inside ? points : K.procedural.geometry.clipPlanarFaces([{ points }], planes)[0]?.points;
      if (!polygon) return false;
      return projectedArea(polygon.map(raster.project)) > 1e-10;
    }

    function projectedArea([origin, ...ring]) {
      const [x, y] = origin;
      return Math.abs(ring.slice(1).reduce((area, [u, v], i) => {
        const [a, b] = ring[i];
        return area + (a - x) * (v - y) - (b - y) * (u - x);
      }, 0));
    }

    function front([a, b, c]) {
      const normal = V.cross(V.sub(b, a), V.sub(c, a));
      return (ortho ? normal[2] : V.dot(normal, a)) > 0;
    }
    return { point, segment, triangle, front };
  }

  const componentSets = () => Object.fromEntries(domains.map(domain => [domain, new Set()]));
  const savedSets = sets => Object.freeze(Object.fromEntries(domains.map(domain =>
    [domain, Object.freeze([...sets[domain]].sort())])));

  function captureVisibility(mesh, frame, camera, { participation = false } = {}) {
    const doc = topology.sourceDocument(mesh);
    const { w, h, passes } = frame ?? {};
    if (!doc || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 ||
        passes?.sourceSurface?.length !== w * h || passes.sourceTriangle?.length !== w * h ||
        !Array.isArray(passes.surfaceSources))
      throw new TypeError('Mesh visibility needs retained topology and native source surface passes');
    const g = graph(doc), raster = projector(camera, w, h), triangles = new Map();
    const drawPoints = K.sceneMeshes.layer(mesh).vertices;
    const visible = componentSets();
    const viewport = participation && viewParticipation(raster, camera, w, h);
    const visibleFront = viewport && componentSets();
    const slots = passes.surfaceSources.map(row => row?.kind === 'mesh' && row.asset === mesh.id &&
      row.object === mesh.objectId && (row.part ?? undefined) === mesh.partId ? row.primitive : null);

    function sampleTriangle(drawIndex, cache = true) {
      if (triangles.has(drawIndex)) return triangles.get(drawIndex);
      const source = topology.triangleSource(mesh, K.sceneMeshes.sourceTriangle(mesh, drawIndex));
      if (!source) throw new RangeError('Native triangle is outside the retained mesh');
      const vertices = source.corners.map(id => g.corners.get(id).vertex);
      const points = vertices.map((_, i) => raster.viewPoint(drawPoints.subarray(drawIndex * 15 + i * 5, drawIndex * 15 + i * 5 + 3)));
      const edges = [];
      for (const [i, vertex] of vertices.entries()) {
        const next = (i + 1) % 3, id = g.edgeByPair.get(edgeKey(vertex, vertices[next]));
        if (!g.components.edges.get(id)?.uses.some(use => use.face === source.face)) continue;
        const line = raster.segment(points[i], points[next]);
        if (line) edges.push({ id, line, from: i, to: next });
      }
      const sample = { face: source.face, points, edges, vertices: vertices.map((id, i) => ({ id, point: raster.point(points[i]) })),
        front: viewport && viewport.front(points) };
      if (cache) triangles.set(drawIndex, sample);
      return sample;
    }

    function markVisible(triangle, pixel) {
      const front = triangle.front ? visibleFront : null;
      visible.faces.add(triangle.face);
      front?.faces.add(triangle.face);
      for (const { id, point } of triangle.vertices)
        if (point && Math.max(Math.abs(pixel[0] - point[0]), Math.abs(pixel[1] - point[1])) <= 1) {
          visible.vertices.add(id);
          front?.vertices.add(id);
        }
      for (const { id, line } of triangle.edges) if (nearSegment(pixel, line)) {
        visible.edges.add(id);
        front?.edges.add(id);
      }
    }

    for (let i = 0; i < w * h; i++) {
      const first = slots[passes.sourceSurface[i]];
      if (!Number.isSafeInteger(first)) continue;
      const triangle = sampleTriangle(first / 3 + passes.sourceTriangle[i]);
      const pixel = [i % w + .5, Math.floor(i / w) + .5];
      markVisible(triangle, pixel);
    }
    let projected;
    if (viewport) {
      const through = componentSets(), throughFront = componentSets();
      for (let i = 0; i < mesh.triangles; i++) {
        const { face, points, vertices, edges, front } = sampleTriangle(i, false);
        if (viewport.triangle(points)) {
          through.faces.add(face);
          if (front) throughFront.faces.add(face);
        }
        for (const [index, { id }] of vertices.entries()) if (viewport.point(points[index])) {
          through.vertices.add(id);
          if (front) throughFront.vertices.add(id);
        }
        for (const { id, from, to } of edges) if (viewport.segment(points[from], points[to])) {
          through.edges.add(id);
          if (front) throughFront.edges.add(id);
        }
      }
      projected = Object.freeze({ visibleFront: savedSets(visibleFront), through: savedSets(through), throughFront: savedSets(throughFront) });
    }
    return Object.freeze({ format: visibilityFormat, version: 1, mesh: doc.id, revision: topology.revision(doc),
      grid: Object.freeze([w, h]), visible: savedSets(visible), ...(projected && { participation: projected,
        ...(mesh.objectId !== undefined && { object: mesh.objectId }), ...(mesh.partId !== undefined && { part: mesh.partId }) }) });
  }

  K.meshTopology = Object.freeze({ ...topology, select, captureVisibility });
})(KIT);
