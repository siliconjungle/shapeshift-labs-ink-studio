/* Stable-ID and boundary evidence for ordinary authored mesh edits. */
(function (K) {
  const topology = K.meshTopology, V = K.V;
  const domains = ['faces', 'edges', 'corners'];
  const format = 'ink-studio/topology-correspondence';
  const key = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  const ringEdges = ring => ring.map((id, i) => [id, ring[(i + 1) % ring.length]]);
  const ordered = values => [...values].sort();

  function append(map, id, row) {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }

  function catalog(doc) {
    const vertices = new Map(doc.vertices.map(row => [row.id, row.position.map(Math.fround)]));
    const faces = new Map(), corners = new Map(), edges = new Map();
    const facesAt = new Map(), edgesAt = new Map(), edgeMaterials = new Map();
    for (const { id, material, corners: loop } of doc.faces) {
      const ring = loop.map(corner => corner.vertex), points = ring.map(vertex => vertices.get(vertex));
      const face = { id, material, ring, points, corners: loop };
      faces.set(id, face);
      for (const corner of loop) {
        append(facesAt, corner.vertex, face);
        corners.set(corner.id, { ...corner, face: id, points: [vertices.get(corner.vertex)] });
      }
      for (const [a, b] of ringEdges(ring)) append(edgeMaterials, key(a, b), material);
    }
    for (const { id, vertices: endpoints } of doc.edges) {
      const points = endpoints.map(vertex => vertices.get(vertex));
      const context = JSON.stringify(ordered(edgeMaterials.get(key(...endpoints))));
      const edge = { id, endpoints, points, context };
      edges.set(id, edge);
      for (const endpoint of endpoints) append(edgesAt, endpoint, edge);
    }
    return { vertices, faces, corners, edges, facesAt, edgesAt };
  }

  function links() {
    const from = new Map(), to = new Map();
    const has = (a, b) => from.get(a)?.has(b) ?? false;
    function add(a, b, evidence, confidence = 1) {
      if (has(a, b)) return;
      if (!from.has(a)) from.set(a, new Map());
      if (!to.has(b)) to.set(b, new Map());
      const link = { from: a, to: b, confidence, evidence };
      from.get(a).set(b, link);
      to.get(b).set(a, link);
    }
    return { from, to, add, has };
  }

  function seed(domain, left, right, hints, sameMesh) {
    if (!Array.isArray(hints)) throw new TypeError('Lineage for ' + domain + ' must be an array of from/to links');
    const map = links();
    if (sameMesh) for (const id of left.keys()) if (right.has(id)) map.add(id, id, { method: 'stable-id' });
    for (const row of hints) {
      if (!left.has(row?.from) || !right.has(row?.to)) throw new RangeError('Unknown ' + domain + ' ID in authored lineage');
      map.add(row.from, row.to, { method: 'authored' });
    }
    return map;
  }

  function partition(face, target) {
    const outside = ringEdges(face.ring), original = new Map(outside.map(([a, b]) => [key(a, b), a]));
    const same = target.faces.get(face.id);
    if (same && same.ring.length === face.ring.length && ringEdges(same.ring).every(([a, b]) => original.get(key(a, b)) === a))
      return null;

    const boundary = new Map(), vertices = new Set(face.ring), candidates = new Map(), visited = new Set();
    for (const side of outside) {
      const chain = boundaryChain(side, target);
      if (!chain) return null;
      for (const { vertices: [a, b] } of chain) {
        const edge = key(a, b);
        if (boundary.has(edge)) return null;
        boundary.set(edge, a);
        vertices.add(a);
        vertices.add(b);
      }
    }
    for (const id of vertices) for (const row of target.facesAt.get(id) ?? []) {
      if (visited.has(row.id)) continue;
      if (visited.size >= 1024) return null;
      visited.add(row.id);
      if (face.material === row.material && row.ring.every(vertex => vertices.has(vertex))) candidates.set(row.id, row);
    }
    if (!candidates.size || candidates.size > vertices.size - 2) return null;
    const sides = new Map(), adjacent = new Map();
    for (const row of candidates.values()) for (const [a, b] of ringEdges(row.ring)) {
      append(sides, key(a, b), { start: a, face: row.id });
    }
    for (const edge of boundary.keys()) if (!sides.has(edge)) return null;
    for (const [edge, uses] of sides) {
      if (boundary.has(edge)) {
        if (uses.length !== 1 || uses[0].start !== boundary.get(edge)) return null;
      } else {
        if (uses.length !== 2 || uses[0].start === uses[1].start) return null;
        append(adjacent, uses[0].face, uses[1].face);
        append(adjacent, uses[1].face, uses[0].face);
      }
    }
    const connected = new Set([candidates.keys().next().value]);
    for (const id of connected) for (const other of adjacent.get(id) ?? []) connected.add(other);
    if (connected.size !== candidates.size) return null;
    return { ids: connected, boundaryEdges: boundary.size, interiorEdges: sides.size - boundary.size };
  }

  function boundaryChain([from, to], target) {
    const start = target.vertices.get(from), end = target.vertices.get(to);
    if (!start || !end) return null;
    const delta = V.sub(end, start), length = V.len(delta);
    if (!length) return null;
    const axis = V.mul(delta, 1 / length), epsilon = 1e-6;
    function parameter(vertex) {
      const position = V.sub(target.vertices.get(vertex), start), along = V.dot(position, axis);
      return V.len(V.mad(position, axis, -along)) <= length * epsilon ? along / length : NaN;
    }
    const segments = [];
    let id = from, t = 0;
    while (id !== to && segments.length < 256) {
      let next;
      for (const candidate of target.edgesAt.get(id) ?? []) {
        const other = candidate.endpoints.find(vertex => vertex !== id), at = parameter(other);
        if (!(at > t + epsilon && at <= 1 + epsilon)) continue;
        if (next) return null;
        next = { id: candidate.id, vertex: other, at };
      }
      if (!next) return null;
      segments.push({ id: next.id, vertices: [id, next.vertex], span: [t, Math.min(1, next.at)] });
      id = next.vertex;
      t = next.at;
    }
    return id === to ? segments : null;
  }

  function anchored(source, target, mapping, reverse = false) {
    const direction = reverse ? 'reverse' : 'forward';
    const connect = (map, a, b, evidence) => reverse ? map.add(b, a, evidence) : map.add(a, b, evidence);
    for (const face of source.faces.values()) {
      const result = partition(face, target);
      if (!result) continue;
      const { ids, boundaryEdges, interiorEdges } = result;
      for (const id of ids) connect(mapping.faces, face.id, id, { method: 'boundary-partition', direction, boundaryEdges, interiorEdges });
    }
    for (const edge of source.edges.values()) {
      if (target.edges.has(edge.id)) continue;
      const segments = boundaryChain(edge.endpoints, target);
      if (!segments) continue;
      for (const { id, vertices, span } of segments)
        connect(mapping.edges, edge.id, id, { method: 'boundary-chain', direction, vertices, span });
    }
  }

  function relatedCorners(before, after, mapping) {
    for (const [from, list] of mapping.faces.from) for (const to of list.keys()) {
      const left = before.faces.get(from).corners, right = after.faces.get(to).corners;
      const byVertex = new Map(right.map(corner => [corner.vertex, corner]));
      for (const corner of left) {
        const other = byVertex.get(corner.vertex);
        if (!other) continue;
        const alreadyAssigned = (side, id, data, face) =>
          [...mapping.corners[side].get(id)?.keys() ?? []].some(match => data.corners.get(match).face === face);
        if (!alreadyAssigned('from', corner.id, after, to) && !alreadyAssigned('to', other.id, before, from))
          mapping.corners.add(corner.id, other.id, { method: 'face-vertex', fromFace: from, toFace: to, vertex: corner.vertex });
      }
    }
  }

  function projectionFaces(doc, data, claimed) {
    const triangles = topology.triangulate(doc).triangleSources;
    const rows = [...data.faces.values()].filter(face => !claimed.has(face.id));
    for (const face of rows) {
      face.triangles = [];
      face.probes = [];
    }
    for (const { face, corners } of triangles) {
      const row = data.faces.get(face);
      if (!row.triangles) continue;
      const [a, b, c] = corners.map(id => data.corners.get(id).points[0]);
      const u = V.sub(b, a), v = V.sub(c, a), cross = V.cross(u, v);
      const normal = V.mul(cross, 1 / V.len(cross));
      row.triangles.push({ a, b, c, u, v, normal, corners });
      const point = V.mul(V.add(V.add(a, b), c), 1 / 3);
      row.probes.push({ point, normal });
    }
    for (const row of rows) for (const corner of row.corners) {
      const triangle = row.triangles.find(tri => tri.corners.includes(corner.id));
      row.probes.push({ point: data.corners.get(corner.id).points[0], normal: triangle.normal });
    }
  }

  function status({ from, to, links }, unresolved) {
    if (!from.length || !to.length) return unresolved ? 'unresolved' : from.length ? 'deleted' : 'created';
    if (from.length > 1) return to.length > 1 ? 'reworked' : 'merged';
    if (to.length > 1) return 'split';
    return links[0].evidence.method === 'stable-id' ? 'retained' : 'replaced';
  }

  function groups(left, right, mapping, unresolved) {
    const seen = { from: new Set(), to: new Set() }, output = [];
    const uncertain = { from: new Set(), to: new Set() };
    for (const row of unresolved ?? []) uncertain[row.side].add(row.id);
    function build(side, root) {
      const queue = [[side, root]], group = { from: [], to: [], links: [] };
      seen[side].add(root);
      for (const [key, id] of queue) {
        const other = key === 'from' ? 'to' : 'from';
        group[key].push(id);
        for (const [matched, link] of mapping[key].get(id) ?? []) {
          if (key === 'from') group.links.push(link);
          if (seen[other].has(matched)) continue;
          seen[other].add(matched);
          queue.push([other, matched]);
        }
      }
      group.from.sort();
      group.to.sort();
      group.links.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 :
        a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
      return { status: status(group, unresolved === null || uncertain[side].has(root)), ...group };
    }
    for (const [side, entries] of [['from', left], ['to', right]]) {
      for (const id of ordered(entries.keys())) if (!seen[side].has(id)) output.push(build(side, id));
    }
    return output;
  }

  function correspond(before, after, { lineage = {}, projection, matchIds = true } = {}) {
    const source = topology.create(before), target = topology.create(after);
    if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage) ||
        Object.keys(lineage).some(domain => !domains.includes(domain))) throw new TypeError('Use faces, edges or corners in topology lineage');
    if (typeof matchIds !== 'boolean') throw new TypeError('matchIds must be true or false');
    const left = catalog(source), right = catalog(target), sameMesh = matchIds && source.id === target.id;
    const mapping = Object.fromEntries(domains.map(domain =>
      [domain, seed(domain, left[domain], right[domain], lineage[domain] ?? [], sameMesh)]));
    if (sameMesh) {
      anchored(left, right, mapping);
      anchored(right, left, mapping, true);
      relatedCorners(left, right, mapping);
    }
    const project = projection === undefined ? null : projectMeshTopology(K, projection);
    if (project && mapping.faces.from.size < left.faces.size && mapping.faces.to.size < right.faces.size) {
      projectionFaces(source, left, mapping.faces.from);
      projectionFaces(target, right, mapping.faces.to);
    }
    const data = Object.fromEntries(domains.map(domain => {
      const unresolved = project ? project.match(domain, left[domain], right[domain], mapping[domain], mapping.faces) : [];
      return [domain, {
        groups: groups(left[domain], right[domain], mapping[domain], unresolved),
        ...(unresolved?.length && { unresolved }),
        ...(unresolved === null && { projectionIncomplete: true })
      }];
    }));
    return K.procedural.data.freeze({ format, version: 1, before: source.id, after: target.id,
      beforeRevision: topology.revision(source), afterRevision: topology.revision(target), matchedIds: sameMesh, domains: data,
      ...(project && { projection: project.report() }) });
  }

  function editWithCorrespondence(source, patch, { lineage = patch?.lineage, projection } = {}) {
    const document = topology.edit(source, patch);
    return Object.freeze({ document, correspondence: correspond(source, document, { lineage, projection }) });
  }

  K.meshTopology = Object.freeze({ ...topology, correspond, editWithCorrespondence });
})(KIT);
