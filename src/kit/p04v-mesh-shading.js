/* Resolve smooth fans without welding corner UVs or changing the cage. */
const meshTopologyShading = (function (K) {
  const { meshTopology: topology, V, procedural: { data: { clone, freeze } } } = K;
  const { record } = meshCutGeometry;
  const { area } = meshFaceRegionGeometry;
  const { index, cyclic } = meshEdgeFlowData;
  const direction = value => {
    const length = V.len(value);
    return length ? V.mul(value, 1 / length) : [0, 0, 0];
  };
  const triangleNormal = ([a, b, c]) => direction(V.cross(V.sub(b, a), V.sub(c, a)));

  function resolve(doc, edges, vertices) {
    const hasCustom = doc.faces.some(face => face.corners.some(row => row.normal));
    const defaultSmooth = doc.shading?.smooth ?? false, mode = doc.shading?.weighting ?? 'angle';
    if (!hasCustom && !defaultSmooth && !edges.some(edge => edge.smooth)) return null;
    const cornerRows = new Map(), uses = new Map(), links = new Map(), result = new Map();
    const at = id => vertices.get(id).position.map(Math.fround);
    for (const face of doc.faces) {
      const points = face.corners.map(row => at(row.vertex)), vector = area(points), scale = V.len(vector);
      const normal = direction(vector);
      for (const [i, corner] of face.corners.entries()) {
        const p = points[i], a = direction(V.sub(cyclic(points, i - 1), p)), b = direction(V.sub(cyclic(points, i + 1), p));
        const angle = Math.acos(Math.max(-1, Math.min(1, V.dot(a, b))));
        const interior = V.dot(V.cross(b, a), normal) >= 0 ? angle : Math.PI * 2 - angle;
        const weight = (mode === 'area' || mode === 'area-angle' ? scale : 1) *
          (mode === 'angle' || mode === 'area-angle' ? interior : 1);
        cornerRows.set(corner.id, { corner, normal, weight });
        links.set(corner.id, []);
        if (corner.normal) result.set(corner.id, corner.normal);
        uses.set(corner.id, corner.vertex);
      }
    }
    for (const edge of edges) {
      if (!(edge.smooth ?? defaultSmooth) || edge.uses.length !== 2) continue;
      const [a, b] = edge.uses;
      if (uses.get(a.from) !== uses.get(b.to)) continue;
      for (const [one, two] of [[a.from, b.to], [a.to, b.from]]) {
        links.get(one).push(two);
        links.get(two).push(one);
      }
    }
    const visited = new Set();
    for (const [id, siblings] of links) {
      if (!siblings.length || visited.has(id)) continue;
      const fan = [id];
      visited.add(id);
      let sum = [0, 0, 0];
      for (const item of fan) {
        const row = cornerRows.get(item);
        sum = V.mad(sum, row.normal, row.weight);
        for (const next of links.get(item)) if (!visited.has(next)) {
          visited.add(next);
          fan.push(next);
        }
      }
      if (!V.len(sum)) continue;
      const normal = direction(sum);
      for (const item of fan) if (!result.has(item)) result.set(item, normal);
    }
    return result.size ? result : null;
  }

  function inspectShading(source) {
    const doc = topology.create(source), vertices = index(doc.vertices), edges = topology.inspect(doc).edges;
    const normal = resolve(doc, edges, vertices), defaultSmooth = doc.shading?.smooth ?? false;
    return freeze({ format: 'ink-studio/mesh-shading-inspection', version: 1, revision: topology.revision(doc),
      settings: { smooth: defaultSmooth, weighting: doc.shading?.weighting ?? 'angle' },
      edges: edges.map(({ id, smooth, crease, uses }) => ({ id, smooth: smooth ?? defaultSmooth, authoredSmooth: smooth ?? null,
        crease: crease ?? 0, boundary: uses.length === 1 })),
      faces: doc.faces.map(face => {
        const geometric = direction(area(face.corners.map(row => vertices.get(row.vertex).position.map(Math.fround))));
        return { id: face.id, geometric, corners: face.corners.map(({ id, normal: authored }) => ({
          id, shading: normal?.get(id) ?? geometric, authored: authored ?? null
        })) };
      }) });
  }

  function planShading(source, request) {
    const doc = topology.create(source), revision = topology.revision(doc);
    if (!record(request, ['id', 'revision', 'edges', 'corners', 'settings']) ||
        typeof request.id !== 'string' || !/^[\w.-]{1,96}$/.test(request.id) ||
        request.edges !== undefined && !Array.isArray(request.edges) ||
        request.corners !== undefined && !Array.isArray(request.corners))
      throw new TypeError('Use a shading request with a revision and edge, corner or settings edits');
    if (request.revision !== revision) throw new RangeError('Stale mesh shading revision');
    const authored = new Map(doc.faces.flatMap(face => face.corners.map(row => [row.id, row])));
    const desired = new Map();
    for (const row of request.corners ?? []) {
      if (!record(row, ['id', 'normal']) || !Object.hasOwn(row, 'normal') || !authored.has(row.id) || desired.has(row.id))
        throw new RangeError('Set or clear a normal once for each known face corner');
      desired.set(row.id, row.normal);
    }
    const faces = doc.faces.filter(face => face.corners.some(row => desired.has(row.id))).map(face => ({
      ...face, corners: face.corners.map(row => {
        if (!desired.has(row.id)) return row;
        const { normal: prior, ...corner } = row, next = desired.get(row.id);
        return next === null ? corner : { ...corner, normal: next };
      })
    }));
    const edges = request.edges ?? [];
    const patch = { ...(faces.length && { faces }), ...(edges.length && { edges }),
      ...(Object.hasOwn(request, 'settings') && { shading: request.settings }) };
    const document = Object.keys(patch).length ? topology.edit(doc, patch) : doc;
    const afterRevision = topology.revision(document);
    const report = { format: 'ink-studio/mesh-shading-edit', version: 1, request: clone(request),
      beforeRevision: revision, afterRevision, affected: { edges: edges.map(row => row.id), corners: [...desired.keys()] } };
    return freeze({ document, patch: afterRevision === revision ? {} : patch, report });
  }

  K.meshTopology = Object.freeze({ ...topology, planShading, inspectShading });
  return { resolve, triangleNormal, direction };
})(KIT);
