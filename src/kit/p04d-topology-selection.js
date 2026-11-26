/* Selection operates on authored polygons and their incidence, including UV-discontinuous edges. */
(function (K) {
  const topology = K.meshTopology, { V } = K;
  const format = 'ink-studio/mesh-selection';
  const visibilityFormat = 'ink-studio/mesh-component-visibility';
  const domains = ['vertices', 'edges', 'faces'];
  const modes = ['loop', 'ring', 'boundary', 'island', 'open-edges', 'normal-patch'];
  const filterKeys = ['materials', 'smoothingGroups', 'seam', 'crease', 'visibility', 'backfaces', 'facing'];
  const degreeRange = n => Number.isFinite(n) && n >= 0 && n <= 180;
  const withinAngle = (a, b, cosine) => V.dot(a, b) >= cosine - 16 * Number.EPSILON;
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
    const result = { components: { vertices, edges, faces }, related, corners, atFace, edgeByPair, normals: new Map() };
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
    if (g.normals.has(id)) return g.normals.get(id);
    const points = g.atFace.get(id).vertices.map(vertex => g.components.vertices.get(vertex).position);
    const relative = points.map(point => V.sub(point, points[0]));
    const scale = Math.max(...relative.flat().map(Math.abs));
    const local = relative.map(point => point.map(n => n / scale));
    const direction = local.reduce((sum, point, i) => V.add(sum, V.cross(point, local[(i + 1) % points.length])), [0, 0, 0]);
    const length = V.len(direction);
    const result = direction.map(n => n / length);
    g.normals.set(id, result);
    return result;
  }

  function openEdges(g, seeds) {
    const open = id => g.components.edges.get(id).uses.length === 1;
    return layers(g, 'edges', [...seeds].filter(open), Infinity, open);
  }

  function normalPatch(g, seeds, degrees) {
    if (seeds.size === g.components.faces.size) return seeds;
    const result = new Set(seeds), groups = new Map(), cosine = Math.cos(degrees * Math.PI / 180);
    for (const seed of seeds) {
      const axis = normal(g, seed), key = axis.join(',');
      if (!groups.has(key)) groups.set(key, { axis, ids: [] });
      groups.get(key).ids.push(seed);
    }
    for (const { axis, ids } of groups.values()) {
      if (result.size === g.components.faces.size) break;
      const patch = layers(g, 'faces', ids, Infinity, id => withinAngle(axis, normal(g, id), cosine));
      for (const id of patch) result.add(id);
    }
    return result;
  }

  function facingTest(domain, facing) {
    if (facing === undefined) return;
    const { direction, tolerance = 0 } = facing ?? {};
    if (domain !== 'faces' || !record(facing, ['direction', 'tolerance']) ||
        typeof direction !== 'string' || !/^[+-][xyz]$/.test(direction) || !degreeRange(tolerance))
      throw new TypeError('A facing filter needs faces, a signed axis, and a tolerance from 0 to 180 degrees');
    const axis = [0, 0, 0];
    axis['xyz'.indexOf(direction[1])] = direction[0] === '+' ? 1 : -1;
    const cosine = Math.cos(tolerance * Math.PI / 180);
    return (g, id) => withinAngle(axis, normal(g, id), cosine);
  }

  function filtered(doc, g, domain, selection, filter, { visibility, object, part }) {
    if (filter === undefined) return selection;
    if (!record(filter, filterKeys)) throw new TypeError('Invalid mesh selection filter');
    const { materials, smoothingGroups, seam: uv, crease, visibility: view, backfaces, facing } = filter;
    const facesDirection = facingTest(domain, facing);
    if (materials !== undefined && (!Array.isArray(materials) || !materials.length ||
        !Array.from(materials).every(id => typeof id === 'string' && id.trim())))
      throw new TypeError('Material filters need one or more material IDs');
    if (smoothingGroups !== undefined && (domain !== 'faces' || !Array.isArray(smoothingGroups) || !smoothingGroups.length ||
        !Array.from(smoothingGroups).every(id => id === null || isMeshSmoothingGroup(id))))
      throw new TypeError('Filter faces by one or more smoothing group names or numbers, or null for unassigned faces');
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

    const materialIds = materials && new Set(materials), groups = smoothingGroups && new Set(smoothingGroups), matches = new Map();
    function edgeMatches(id) {
      if (matches.has(id)) return matches.get(id);
      const edge = g.components.edges.get(id);
      let accepted = uv === undefined || uv === seam(g, edge);
      if (accepted && crease) {
        const directions = edge.uses.length === 2 && edge.uses.map(({ face }) => normal(g, face));
        const angle = directions && Math.acos(Math.min(1, Math.max(-1, V.dot(...directions)))) * 180 / Math.PI;
        accepted = angle !== false && angle + 1e-8 >= min && angle - 1e-8 <= max;
      }
      matches.set(id, accepted);
      return accepted;
    }
    return new Set([...selection].filter(id => {
      if (eligible && eligible.has(id) !== (view !== 'hidden')) return false;
      if (facesDirection && !facesDirection(g, id)) return false;
      if (groups && !groups.has(g.components.faces.get(id).smoothingGroup ?? null)) return false;
      if (materialIds) {
        const faces = domain === 'faces' ? [id] : g.related(domain, id, 'faces');
        if (!faces.some(face => materialIds.has(g.components.faces.get(face).material))) return false;
      }
      if (uv === undefined && !crease) return true;
      const edges = domain === 'edges' ? [id] : g.related(domain, id, 'edges');
      return edges.some(edgeMatches);
    }));
  }

  function combine(doc, g, domain, { from, region, operation = 'replace', ids: operandIds, filter }, context) {
    if (!['replace', 'add', 'subtract', 'invert'].includes(operation) || operation !== 'replace' && !from ||
        operation === 'invert' && (region !== undefined || operandIds !== undefined) ||
        ['add', 'subtract'].includes(operation) && region === undefined && operandIds === undefined)
      throw new TypeError('Add and subtract need a saved selection and a region or IDs. Invert needs a saved selection');
    const components = g.components[domain];
    const base = from ? ids(from.ids, components) : new Set();
    const candidates = operandIds === undefined ? new Set(components.keys()) : ids(operandIds, components);
    if (region !== undefined) {
      const { visibility } = context;
      if (!Array.isArray(visibility?.grid) || visibility.grid.length !== 2)
        throw new RangeError('Capture mesh visibility for this selection region');
      const shape = MeshSelectionRegion.read(region, ...visibility.grid);
      const saved = visibility.regional?.query;
      if (!saved || JSON.stringify(shape) !== JSON.stringify(MeshSelectionRegion.read(saved, ...visibility.grid)))
        throw new RangeError('Capture mesh visibility for this selection region');
      if (filter !== undefined && !record(filter, filterKeys)) throw new TypeError('Invalid mesh selection filter');
      const mode = filter?.visibility === undefined ? 'visible' : filter.visibility;
      if (!['visible', 'through'].includes(mode)) throw new TypeError('A selection region needs visible or through mode');
      filter = { ...filter, visibility: mode };
      const { visible, participation } = visibility.regional;
      context = { ...context, visibility: { ...visibility, visible, participation } };
    }
    const operand = filtered(doc, g, domain, candidates, filter, context);
    if (operation === 'replace') return operand;
    if (operation === 'add') return new Set([...base, ...operand]);
    if (operation === 'subtract') return new Set([...base].filter(id => !operand.has(id)));
    return new Set([...operand].filter(id => !base.has(id)));
  }

  function select(source, request, { visibility, object, part } = {}) {
    if (!record(request, ['domain', 'ids', 'from', 'traverse', 'normalAngle', 'grow', 'shrink', 'convert', 'match', 'filter', 'region', 'operation']))
      throw new TypeError('Use a mesh component selection query');
    const doc = topology.create(source), revision = topology.revision(doc), g = graph(doc);
    const { from, traverse, normalAngle, grow = 0, shrink = 0, convert: into, match = 'any', filter } = request;
    const combining = request.region !== undefined || request.operation !== undefined;
    const context = { visibility, object, part };
    let domain = request.domain === undefined ? from?.domain : request.domain;
    if (!domains.includes(domain) || into !== undefined && !domains.includes(into) ||
        !['any', 'all'].includes(match) || request.match !== undefined && into === undefined)
      throw new TypeError('Choose vertices, edges or faces and an optional conversion match');
    if (traverse !== undefined && !modes.includes(traverse)) throw new TypeError('Unknown mesh selection traversal');
    if (traverse === 'open-edges' && domain !== 'edges') throw new TypeError('Connected open edges need the edge domain');
    if (traverse === 'normal-patch') {
      if (domain !== 'faces' || !degreeRange(normalAngle) ||
          (from === undefined && request.ids === undefined && request.region === undefined))
        throw new TypeError('A normal patch needs face seeds and normalAngle from 0 to 180 degrees');
    } else if (normalAngle !== undefined) throw new TypeError('normalAngle needs normal-patch traversal');
    if (![grow, shrink].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 128))
      throw new RangeError('Grow and shrink need 0 to 128 steps');
    if (from !== undefined && (!combining && request.ids !== undefined || from?.format !== format || from.version !== 1 ||
        from.mesh !== doc.id || from.revision !== revision || from.domain !== domain || !Array.isArray(from.ids)))
      throw new RangeError('Use a saved selection for the same topology revision and domain');
    const seeds = from === undefined ? request.ids : from.ids;
    let selection = combining ? combine(doc, g, domain, request, context) :
      seeds === undefined ? new Set(g.components[domain].keys()) : ids(seeds, g.components[domain]);
    if (traverse === 'open-edges') selection = openEdges(g, selection);
    else if (traverse === 'normal-patch') selection = normalPatch(g, selection, normalAngle);
    else if (traverse === 'island') selection = layers(g, domain, selection, Infinity);
    else if (traverse === 'boundary' && domain === 'faces') {
      selection = boundary(g, selection);
      domain = 'edges';
    } else if (traverse !== undefined) {
      if (domain !== 'edges' || traverse !== 'boundary' && seeds === undefined && request.region === undefined)
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
    const facingSource = filter?.facing !== undefined && domain === 'faces';
    if (!combining && facingSource) selection = filtered(doc, g, domain, selection, filter, context);
    if (into !== undefined) {
      selection = convert(g, selection, domain, into, match);
      domain = into;
    }
    if (!combining && !facingSource) selection = filtered(doc, g, domain, selection, filter, context);
    return Object.freeze({ format, version: 1, mesh: doc.id, revision, domain, ids: Object.freeze([...selection].sort()) });
  }

  // The raster uses viewport coordinates measured from pixel edges and camera-space axial depth.
  function projector(camera, w, h) {
    const { view, focal, ortho, clipNear, clipFar } = camera ?? {};
    if (view?.length !== 16 || !Array.from(view).every(Number.isFinite) ||
        ![focal, clipNear, clipFar].every(Number.isFinite) || focal <= 0 || clipNear <= 0 || clipFar <= clipNear)
      throw new TypeError('Mesh visibility needs the native raster camera and focal length');
    const { viewPoint, project } = CameraLens.rasterProjector({view, focal, ortho, width:w, height:h});
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

    function polygon(points) {
      const inside = points.every(point);
      if (!inside && planes.some(plane => points.every(p => distance(plane, p) > 0))) return null;
      const clipped = inside ? points : K.procedural.geometry.clipPlanarFaces([{ points }], planes)[0]?.points;
      const projected = clipped?.map(raster.project);
      return projected && projectedArea(projected) > 1e-10 ? projected : null;
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
    return { point, segment, polygon, front };
  }

  const componentSets = () => Object.fromEntries(domains.map(domain => [domain, new Set()]));
  const savedSets = sets => Object.freeze(Object.fromEntries(domains.map(domain =>
    [domain, Object.freeze([...sets[domain]].sort())])));

  function captureVisibility(mesh, frame, camera, { participation = false, region } = {}) {
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
    const footprint = region === undefined ? null : MeshSelectionRegion.prepare(region, w, h);
    const regional = footprint && { visible: componentSets(), visibleFront: viewport && componentSets(),
      through: viewport && componentSets(), throughFront: viewport && componentSets() };
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

    function markVisible(sets, frontSets, triangle, pixel) {
      const front = triangle.front ? frontSets : null;
      sets.faces.add(triangle.face);
      front?.faces.add(triangle.face);
      for (const { id, point } of triangle.vertices)
        if (point && Math.max(Math.abs(pixel[0] - point[0]), Math.abs(pixel[1] - point[1])) <= 1) {
          sets.vertices.add(id);
          front?.vertices.add(id);
        }
      for (const { id, line } of triangle.edges) if (nearSegment(pixel, line)) {
        sets.edges.add(id);
        front?.edges.add(id);
      }
    }

    for (let i = 0; i < w * h; i++) {
      const first = slots[passes.sourceSurface[i]];
      if (!Number.isSafeInteger(first)) continue;
      const triangle = sampleTriangle(first / 3 + passes.sourceTriangle[i]);
      const pixel = [i % w + .5, Math.floor(i / w) + .5];
      markVisible(visible, visibleFront, triangle, pixel);
      if (footprint?.mask[i]) markVisible(regional.visible, regional.visibleFront, triangle, pixel);
    }
    let projected;
    if (viewport) {
      const through = componentSets(), throughFront = componentSets();
      function mark(domain, id, front, inRegion) {
        through[domain].add(id);
        if (front) throughFront[domain].add(id);
        if (inRegion) {
          regional.through[domain].add(id);
          if (front) regional.throughFront[domain].add(id);
        }
      }
      for (let i = 0; i < mesh.triangles; i++) {
        const { face, points, vertices, edges, front } = sampleTriangle(i, false);
        const polygon = viewport.polygon(points);
        if (polygon) mark('faces', face, front, footprint?.face(polygon));
        for (const [index, { id }] of vertices.entries()) if (viewport.point(points[index])) {
          mark('vertices', id, front, footprint?.vertex(vertices[index].point));
        }
        for (const { id, from, to, line } of edges) if (viewport.segment(points[from], points[to])) {
          mark('edges', id, front, footprint?.edge(line));
        }
      }
      projected = Object.freeze({ visibleFront: savedSets(visibleFront), through: savedSets(through), throughFront: savedSets(throughFront) });
    }
    const regionData = regional && Object.freeze({ query: K.procedural.data.freeze(footprint.query), visible: savedSets(regional.visible),
      ...(viewport && { participation: Object.freeze({ visibleFront: savedSets(regional.visibleFront),
        through: savedSets(regional.through), throughFront: savedSets(regional.throughFront) }) }) });
    return Object.freeze({ format: visibilityFormat, version: 1, mesh: doc.id, revision: topology.revision(doc),
      grid: Object.freeze([w, h]), visible: savedSets(visible), ...(projected && { participation: projected }),
      ...(regionData && { regional: regionData }), ...((projected || regionData) && {
        ...(mesh.objectId !== undefined && { object: mesh.objectId }), ...(mesh.partId !== undefined && { part: mesh.partId }) }) });
  }

  K.meshTopology = Object.freeze({ ...topology, select, captureVisibility });
})(KIT);
