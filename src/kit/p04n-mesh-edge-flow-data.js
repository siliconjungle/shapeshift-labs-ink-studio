/* Incidence, boundary ordering and interpolation for retained edge edits. */
const meshEdgeFlowData = (function (K) {
  const { meshTopology: topology, V } = K;
  const { pair, record } = meshCutGeometry;
  const { boundaryPaths } = meshCutCaps;
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const clamp = n => Math.max(0, Math.min(1, n));
  const edgeOf = (g, a, b) => g.byEnds.get(pair(a, b));
  const front = (g, use) => g.corners.get(use.from).vertex;
  const position = (g, id) => g.vertices.get(id).position;
  const around = (face, vertex) => face.corners.findIndex(corner => corner.vertex === vertex);
  const cyclic = (rows, i) => rows[(i % rows.length + rows.length) % rows.length];
  const rotate = (rows, i) => rows.slice(i).concat(rows.slice(0, i));

  function context(doc, request) {
    if (!record(request, ['id', 'revision', 'operation', 'pins']) ||
        typeof request.id !== 'string' || !/^[\w.-]{1,96}$/.test(request.id))
      throw new TypeError('Edge edit needs an operation ID and topology revision');
    if (request.revision !== topology.revision(doc)) throw new RangeError('Stale mesh edge-edit revision');
    const g = retainedMeshHealth.incidence(doc);
    g.doc = doc;
    g.byEnds = new Map(g.edges.map(edge => [pair(...edge.vertices), edge]));
    g.byId = index(g.edges);
    const ids = new Set([...doc.vertices, ...doc.edges, ...doc.faces, ...g.corners.values()].map(row => row.id));
    let serial = 0;
    g.fresh = kind => {
      let id;
      do { id = 'edge-edit/' + request.id + '/' + kind + '/' + ++serial; } while (ids.has(id));
      ids.add(id);
      return id;
    };
    const pins = request.pins ?? {};
    if (!record(pins, ['vertices', 'edges', 'boundary']) ||
        [pins.vertices, pins.edges].some(rows => rows !== undefined && !Array.isArray(rows)) ||
        pins.boundary !== undefined && typeof pins.boundary !== 'boolean')
      throw new TypeError('Pins need vertex IDs, edge IDs, or boundary mode');
    g.pins = new Set(pins.vertices ?? []);
    for (const id of g.pins) if (!g.vertices.has(id)) throw new RangeError('Unknown pinned vertex ' + id);
    g.protectedEdges = new Set(pins.edges ?? []);
    for (const id of g.protectedEdges) if (!g.byId.has(id)) throw new RangeError('Unknown pinned edge ' + id);
    for (const edge of g.edges) if (g.protectedEdges.has(edge.id) || pins.boundary && edge.uses.length === 1) {
      g.protectedEdges.add(edge.id);
      for (const id of edge.vertices) g.pins.add(id);
    }
    return g;
  }

  function selection(g, saved, minimum = 1) {
    if (saved?.domain !== 'edges') throw new TypeError('Use a saved edge selection');
    const { ids } = topology.select(g.doc, { from: saved });
    if (ids.length < minimum) throw new RangeError('Select at least ' + minimum + ' edges');
    return ids.map(id => g.byId.get(id));
  }

  function requireWinding(g, edge) {
    if (edge.uses.length > 2 || edge.uses.length === 2 &&
        retainedMeshHealth.crossesWinding(...edge.uses, g.corners))
      throw new RangeError('Edge edit requires manifold, consistently wound edges at ' + edge.id);
  }

  function boundary(g, saved, start) {
    const edges = selection(g, saved, 3);
    if (edges.some(edge => edge.uses.length !== 1)) throw new RangeError('Use edges on an open mesh boundary');
    const directed = edges.map(edge => {
      const { from, to } = edge.uses[0];
      // New faces run in the reverse direction along the old boundary.
      return [g.corners.get(to).vertex, g.corners.get(from).vertex];
    });
    const { paths, branched } = boundaryPaths(directed);
    if (branched || paths.length !== 1 || !paths[0].closed)
      throw new RangeError('Select one complete, consistently wound boundary loop');
    const vertices = paths[0].vertices;
    const first = start ?? vertices.reduce((min, id) => id < min ? id : min);
    if (!vertices.includes(first)) throw new RangeError('Boundary start must be a selected vertex');
    const loop = rotate(vertices, vertices.indexOf(first));
    return loop.map((id, i) => {
      const next = cyclic(loop, i + 1), edge = edgeOf(g, id, next), use = edge.uses[0];
      return { id, edge: edge.id, face: g.faces.get(use.face), a: g.corners.get(use.to), b: g.corners.get(use.from) };
    });
  }

  function weights(g, samples) {
    const keys = new Set(samples.flatMap(([id]) => Object.keys(g.vertices.get(id).weights ?? {})));
    return keys.size ? Object.fromEntries([...keys].sort().map(key => [key, clamp(samples.reduce((total, [id, weight]) =>
      total + (Object.hasOwn(g.vertices.get(id).weights ?? {}, key) ? g.vertices.get(id).weights[key] * weight : 0), 0))])) : undefined;
  }

  function point(g, samples, at) {
    const id = g.fresh('vertex'), values = weights(g, samples);
    return { vertex: { id, position: at ?? samples.reduce((sum, [id, weight]) =>
      V.mad(sum, position(g, id), weight), [0, 0, 0]), ...(values && { weights: values }) },
    sources: { id, samples } };
  }

  function cornerData(samples, uv) {
    return {
      uv: uv ?? [0, 1].map(axis => clamp(samples.reduce((total, [corner, weight]) => total + corner.uv[axis] * weight, 0))),
      samples
    };
  }

  function corners(g, vertices, data, conflicts) {
    const channels = new Map();
    for (const { samples } of data) for (const [corner, influence] of samples) {
      if (!influence) continue;
      for (const [key, value] of Object.entries(corner.attributes ?? {})) {
        if (!channels.has(key)) channels.set(key, new Set());
        channels.get(key).add(Array.isArray(value) ? value.length : 0);
      }
    }
    for (const [key, sizes] of channels) if (sizes.size > 1) {
      channels.delete(key);
      conflicts.add(key);
    }
    return data.map(({ uv, samples }, i) => {
      const attributes = Object.fromEntries([...channels].map(([key, sizes]) => {
        const weighted = samples.filter(([row, influence]) => influence && Object.hasOwn(row.attributes ?? {}, key));
        const sum = weighted.reduce((total, [, influence]) => total + influence, 0);
        const value = axis => sum ? weighted.reduce((total, [row, influence]) => total +
          (axis === undefined ? row.attributes[key] : row.attributes[key][axis]) * influence / sum, 0) : 0;
        const size = sizes.values().next().value;
        return [key, size ? Array.from({ length: size }, (_, axis) => value(axis)) : value()];
      }));
      return { id: g.fresh('corner'), vertex: vertices[i], uv, ...(channels.size && { attributes }) };
    });
  }

  function edgeCorner(g, vertex, a, b, fraction, conflicts) {
    const row = corners(g,[vertex],[cornerData([[a,1-fraction],[b,fraction]])],conflicts)[0];
    if (a.normal || b.normal) {
      const normal = meshTopologyShading.direction(V.lerp(a.normal ?? b.normal,b.normal ?? a.normal,fraction));
      if (V.len(normal)) row.normal = normal;
    }
    return row;
  }

  return { index, name, pair, edgeOf, front, position, around, cyclic, rotate, context, selection,
    requireWinding, boundary, point, cornerData, corners, edgeCorner };
})(KIT);
