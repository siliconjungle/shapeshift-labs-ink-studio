/* Quad-strip insertion and rail-constrained edge slides. */
const meshEdgeLoops = (function (K) {
  const { V } = K, { record } = meshCutGeometry;
  const { pair, edgeOf, front, position, around, cyclic, selection, requireWinding, point, edgeCorner } = meshEdgeFlowData;

  function insert(g, op) {
    if (!record(op, ['kind', 'selection', 'start', 'fraction']) ||
        !Number.isFinite(op.fraction) || op.fraction <= 0 || op.fraction >= 1)
      throw new TypeError('Loop insertion needs an edge seed and a fraction between 0 and 1');
    const seeds = selection(g, op.selection), seed = seeds[0];
    if (seeds.length !== 1) throw new RangeError('Loop insertion needs exactly one seed edge');
    if (g.protectedEdges.has(seed.id)) throw new RangeError('Cannot split the pinned seed edge');
    const start = op.start ?? seed.vertices[0];
    if (!seed.vertices.includes(start)) throw new RangeError('Loop start must be an endpoint of the seed edge');

    const cuts = new Map(), queue = [], faceCuts = new Map(), stopped = new Set();
    function enqueue(edge, a) {
      if (cuts.has(edge.id)) {
        if (cuts.get(edge.id).a !== a && op.fraction !== .5)
          throw new RangeError('The quad strip reverses direction at ' + edge.id + ' (use a midpoint or a different strip)');
        return;
      }
      requireWinding(g, edge);
      const b = edge.vertices.find(id => id !== a);
      const row = { edge, a, b, ...point(g, [[a, 1 - op.fraction], [b, op.fraction]]) };
      cuts.set(edge.id, row);
      queue.push(row);
    }
    enqueue(seed, start);
    for (const { edge, a, b } of queue) for (const use of edge.uses) {
      const face = g.faces.get(use.face), ring = face.corners, length = ring.length;
      if (length !== 4) continue;
      const i = around(face, a), forward = cyclic(ring, i + 1).vertex === b;
      const p = cyclic(ring, i + (forward ? -1 : 1)).vertex, q = cyclic(ring, i + 2).vertex;
      const opposite = edgeOf(g, p, q);
      if (g.protectedEdges.has(opposite.id)) { stopped.add(opposite.id); continue; }
      const side = pair(edge.id, opposite.id);
      if (faceCuts.has(face.id) && faceCuts.get(face.id) !== side)
        throw new RangeError('Quad strip crosses itself in face ' + face.id);
      faceCuts.set(face.id, side);
      enqueue(opposite, p);
    }
    if (!faceCuts.size) throw new RangeError('No quad strip can be split from this seed');

    const conflicts = new Set(), splitFaces = [], transitionFaces = [], faces = [];
    const touched = new Set(queue.flatMap(row => row.edge.uses.map(use => use.face)));
    function knot(a, b, cut) {
      const f = a.vertex === cut.a ? op.fraction : 1 - op.fraction;
      return edgeCorner(g,cut.vertex.id,a,b,f,conflicts);
    }
    for (const id of touched) {
      const face = g.faces.get(id), ring = [];
      const polygon = {id,material:face.material,...(face.smoothingGroup !== undefined && {smoothingGroup:face.smoothingGroup})};
      for (const [i, a] of face.corners.entries()) {
        const b = cyclic(face.corners, i + 1), edge = edgeOf(g, a.vertex, b.vertex), cut = cuts.get(edge.id);
        ring.push(a);
        if (cut) ring.push(knot(a, b, cut));
      }
      if (!faceCuts.has(id)) {
        faces.push({ ...polygon, corners: ring });
        transitionFaces.push(id);
        continue;
      }
      const newIds = new Set(JSON.parse(faceCuts.get(id)).map(edge => cuts.get(edge).vertex.id));
      const [a, b] = ring.flatMap((corner, i) => newIds.has(corner.vertex) ? [i] : []);
      const outside = ring.slice(b).concat(ring.slice(0, a + 1));
      const inside = ring.slice(a, b + 1).map(corner => newIds.has(corner.vertex) ?
        { ...corner, id: g.fresh('corner') } : corner);
      const next = g.fresh('face');
      faces.push({ ...polygon, corners: outside }, { ...polygon, id: next, corners: inside });
      splitFaces.push({ from: id, to: next });
    }
    return { patch: { vertices: queue.map(row => row.vertex), faces },
      affected: faces.map(face => face.id), lineage: { faces: splitFaces },
      cuts: queue.map(({ edge, vertex }) => ({ edge: edge.id, at: vertex.id, ends: edge.vertices })),
      detail: { transitionFaces, stoppedAt: [...stopped], vertices: queue.map(row => row.sources) } };
  }

  function ordered(g, saved, start) {
    const edges = selection(g, saved), adjacency = new Map();
    for (const edge of edges) {
      requireWinding(g, edge);
      for (const id of edge.vertices) {
        if (!adjacency.has(id)) adjacency.set(id, []);
        adjacency.get(id).push(edge);
      }
    }
    const endpoints = [...adjacency].filter(([, rows]) => rows.length === 1).map(([id]) => id).sort();
    const candidates = endpoints.length ? endpoints : [...adjacency.keys()].sort();
    if (endpoints.length !== 0 && endpoints.length !== 2 || [...adjacency.values()].some(rows => rows.length > 2))
      throw new RangeError('Select one non-branching edge loop or chain');
    if (start !== undefined && !candidates.includes(start))
      throw new RangeError('Choose a selected start vertex (an endpoint for open chains)');
    const path = [], used = new Set();
    let from = start ?? candidates[0];
    for (;;) {
      const edge = adjacency.get(from).find(row => !used.has(row.id));
      if (!edge) break;
      used.add(edge.id);
      const to = edge.vertices.find(id => id !== from);
      path.push({ edge, from, to });
      from = to;
    }
    if (used.size !== edges.length) throw new RangeError('Select one connected edge loop or chain');
    return { path, selected: new Set(adjacency.keys()) };
  }

  function slide(g, op) {
    if (!record(op, ['kind', 'selection', 'start', 'amount']) || !Number.isFinite(op.amount) || Math.abs(op.amount) >= 1)
      throw new TypeError('Edge slide needs a saved edge chain and a signed amount between -1 and 1');
    const { path, selected } = ordered(g, op.selection, op.start);
    const railAt = new Map([...selected].map(id => [id, new Set()]));
    for (const { edge, from } of path) for (const use of edge.uses) {
      if ((front(g, use) === from) !== (op.amount >= 0)) continue;
      const face = g.faces.get(use.face), a = front(g, use), b = g.corners.get(use.to).vertex;
      const i = around(face, a);
      railAt.get(a).add(cyclic(face.corners, i - 1).vertex);
      railAt.get(b).add(cyclic(face.corners, i + 2).vertex);
    }
    const vertices = [], rails = [], pinned = [];
    for (const id of selected) {
      if (g.pins.has(id)) { pinned.push(id); continue; }
      if (op.amount === 0) continue;
      const choices = railAt.get(id);
      const target = choices.values().next().value;
      if (choices.size !== 1 || selected.has(target))
        throw new RangeError('Choose an unambiguous slide rail or pin vertex ' + id);
      const source = g.vertices.get(id);
      const position = V.lerp(source.position, g.vertices.get(target).position, Math.abs(op.amount));
      vertices.push({ ...source, position });
      rails.push({ vertex: id, toward: target });
    }
    const moved = new Set(vertices.map(row => row.id));
    const affected = g.doc.faces.filter(face => face.corners.some(corner => moved.has(corner.vertex))).map(face => face.id);
    return { patch: vertices.length ? { vertices } : {}, affected, detail: { rails, pinned } };
  }

  return { insert, slide };
})(KIT);
