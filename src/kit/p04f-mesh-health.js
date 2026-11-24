/* Checked incidence and triangle contacts on an authored polygon mesh. */
const retainedMeshHealth = (function (K) {
  const topology = K.meshTopology, { V } = K, { spatial, data: { freeze } } = K.procedural;
  const format = 'ink-studio/mesh-health';
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const record = (value, keys) => !!value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const edgeKey = (a, b) => JSON.stringify([a, b].sort());
  const rasterPosition = (g, id) => g.vertices.get(id).position.map(Math.fround);
  const sameUV = (a, b, epsilon = 1e-6) => a.every((value, i) => Math.abs(value - b[i]) <= epsilon);

  function incidence(doc) {
    const edges = topology.inspect(doc).edges, vertices = index(doc.vertices);
    const faces = index(doc.faces), corners = new Map(), rings = new Map();
    for (const face of doc.faces) {
      rings.set(face.id, new Set());
      for (const corner of face.corners) corners.set(corner.id, corner);
    }
    for (const edge of edges) for (const use of edge.uses) rings.get(use.face).add(edgeKey(...edge.vertices));
    return { vertices, faces, corners, edges, rings };
  }

  function edgeSeam(edge, corners) {
    const uses = edge.uses.map(({ face, from, to }) => {
      const pair = [corners.get(from), corners.get(to)];
      return { face, corners: pair[0].vertex === edge.vertices[0] ? pair : pair.reverse() };
    });
    const seam = uses.some(use => use.corners.some((corner, i) => !sameUV(corner.uv, uses[0].corners[i].uv)));
    return { id: edge.id, vertices: edge.vertices, seam, uses };
  }

  const crossesWinding = (first, second, corners) => corners.get(first.from).vertex === corners.get(second.from).vertex;

  function plane(points) {
    const raw = V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0]));
    const twiceArea = V.len(raw);
    if (!twiceArea) return { twiceArea };
    const normal = V.mul(raw, 1 / twiceArea);
    const sides = points.map((p, i) => {
      const direction = V.sub(points[(i + 1) % 3], p);
      return { p, inward: V.cross(normal, V.mul(direction, 1 / V.len(direction))) };
    });
    return { normal, twiceArea, sides };
  }

  function clipSegment(a, b, sides, epsilon) {
    let min = 0, max = 1;
    for (const { p, inward } of sides) {
      const u = V.dot(V.sub(a, p), inward), v = V.dot(V.sub(b, p), inward);
      if (u < -epsilon && v < -epsilon) return [];
      if (u >= -epsilon && v >= -epsilon) continue;
      const t = (-epsilon - u) / (v - u);
      if (u < -epsilon) min = Math.max(min, t);
      else max = Math.min(max, t);
      if (min > max) return [];
    }
    return [V.lerp(a, b, min), V.lerp(a, b, max)];
  }

  function contacts(a, b, epsilon, clipTolerance) {
    const distances = a.points.map(point => V.dot(V.sub(point, b.points[0]), b.normal));
    if (distances.every(d => d > epsilon) || distances.every(d => d < -epsilon)) return [];
    const hits = [];
    for (const [i, point] of a.points.entries()) {
      const j = (i + 1) % 3, next = a.points[j], u = distances[i], v = distances[j];
      if (Math.abs(u) <= epsilon && Math.abs(v) <= epsilon) {
        hits.push(...clipSegment(point, next, b.sides, clipTolerance));
      } else if (u * v <= 0 || Math.abs(u) <= epsilon || Math.abs(v) <= epsilon) {
        const t = Math.max(0, Math.min(1, u / (u - v)));
        const hit = V.lerp(point, next, t);
        if (b.sides.every(({ p, inward }) => V.dot(V.sub(hit, p), inward) >= -clipTolerance)) hits.push(hit);
      }
    }
    return hits;
  }

  function nearEdge(p, a, b, epsilon) {
    const d = V.sub(b, a), dot = V.dot(d, d);
    const t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / dot));
    return V.dist(p, V.mad(a, d, t)) <= epsilon;
  }

  function crossing(a, b, incidence, epsilon) {
    const shared = a.vertices.filter(id => b.vertices.includes(id));
    const expected = shared.map(id => rasterPosition(incidence, id));
    const sharedEdges = shared.flatMap((id, i) => shared.slice(i + 1).filter(next => {
      const key = edgeKey(id, next);
      return incidence.rings.get(a.face).has(key) && incidence.rings.get(b.face).has(key);
    }).map(next => [rasterPosition(incidence, id), rasterPosition(incidence, next)]));
    if (!a.twiceArea || !b.twiceArea) return null;
    // Expanding the contact polygon at a shared seam turns a valid acute
    // corner into an apparent overlap. Keep numerical slack much smaller
    // than the boundary match tolerance for triangles that share vertices.
    const pad = shared.length ? epsilon * .001 : epsilon;
    const hits = [...contacts(a, b, epsilon, pad), ...contacts(b, a, epsilon, pad)];
    if (!hits.length) return null;
    const coplanar = Math.abs(V.dot(a.normal, b.normal)) >= 1 - 1e-10 &&
      b.points.every(p => Math.abs(V.dot(V.sub(p, a.points[0]), a.normal)) <= epsilon);
    // Coincident polygons can have all sampled contacts on common edges. Their
    // interior centroid still crosses beyond the supported shared boundary.
    if (coplanar && hits.length > 2) hits.push(V.mul(hits.reduce(V.add, [0, 0, 0]), 1 / hits.length));
    const contact = hits.find(point => !expected.some(at => V.dist(point, at) <= 4 * epsilon) &&
      !sharedEdges.some(([u, v]) => nearEdge(point, u, v, 4 * epsilon)));
    if (!contact) return null;
    return { kind: coplanar ? 'coplanar' : 'crossing', faces: [a.face, b.face], triangles: [a.corners, b.corners], point: contact };
  }

  function health(source, options = {}) {
    if (!record(options, ['selection', 'duplicateDistance', 'sliverQuality', 'intersectionTolerance', 'maxPairs', 'limit']))
      throw new TypeError('Use mesh health settings');
    const { selection, duplicateDistance = .000001, sliverQuality = .02, intersectionTolerance = .00000001,
      maxPairs = 250000, limit = 512 } = options;
    if (!Number.isFinite(duplicateDistance) || duplicateDistance < 0 || !Number.isFinite(intersectionTolerance) ||
        intersectionTolerance <= 0 || !Number.isFinite(sliverQuality) || sliverQuality < 0 || sliverQuality > 1 ||
        !Number.isSafeInteger(maxPairs) || maxPairs < 1 || maxPairs > 2000000 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 20000)
      throw new RangeError('Use bounded mesh health distances, sliver quality, and work limits');

    const doc = topology.create(source), g = incidence(doc);
    const scoped = domain => selection === undefined ? null : new Set(topology.select(doc, { from: selection, convert: domain }).ids);
    const vertexScope = scoped('vertices'), faceScope = scoped('faces');
    const edgeScope = selection?.domain === 'edges' ? new Set(scoped('edges')) : null;
    const included = (scope, id) => scope === null || scope.has(id);
    const findings = { nonManifold: [], duplicates: [], winding: [], slivers: [], selfIntersections: [] };
    const counts = Object.fromEntries(Object.keys(findings).map(key => [key, 0]));
    function add(kind, issue) {
      counts[kind]++;
      if (findings[kind].length < limit) findings[kind].push(issue);
    }
    for (const edge of g.edges) {
      if (edgeScope ? !edgeScope.has(edge.id) : selection?.domain === 'vertices' ?
        !edge.vertices.some(id => vertexScope.has(id)) : !edge.uses.some(use => included(faceScope, use.face))) continue;
      const row = { edge: edge.id, vertices: edge.vertices, faces: edge.uses.map(use => use.face).sort() };
      if (edge.uses.length > 2) add('nonManifold', row);
      else if (edge.uses.length === 2 && crossesWinding(...edge.uses, g.corners)) add('winding', row);
    }
    const vertices = [...doc.vertices].sort((a, b) => order(a.id, b.id));
    const lookup = spatial.pointIndex(vertices.map(row => ({ row, bounds: spatial.boxOf([row.position]) })));
    const work = { duplicatePairs: 0, trianglePairs: 0, duplicatesComplete: true, intersectionsComplete: true };
    // Give each pair check its own cap so duplicate clusters cannot starve the triangle scan.
    for (const a of vertices) {
      if (!included(vertexScope, a.id)) continue;
      if (!lookup.box(spatial.expand(spatial.boxOf([a.position]), duplicateDistance), ({ row: b }) => {
        if (a === b || a.id >= b.id && included(vertexScope, b.id)) return;
        if (work.duplicatePairs >= maxPairs) return false;
        work.duplicatePairs++;
        const distance = V.dist(a.position, b.position);
        if (distance <= duplicateDistance) add('duplicates', { vertices: [a.id, b.id].sort(), distance });
      })) { work.duplicatesComplete = false; break; }
    }

    const triangles = topology.triangulate(doc).triangleSources.map((row, index) => {
      const vertices = row.corners.map(id => g.corners.get(id).vertex);
      const points = vertices.map(id => rasterPosition(g, id));
      return { ...row, index, vertices, points, ...plane(points), bounds: spatial.boxOf(points) };
    });
    for (const row of triangles) if (included(faceScope, row.face)) {
      const sum = row.points.reduce((total, point, i) => total + V.dist(point, row.points[(i + 1) % 3]) ** 2, 0);
      const quality = Math.min(1, 2 * Math.sqrt(3) * row.twiceArea / sum);
      if (quality < sliverQuality) add('slivers', { face: row.face, triangle: row.corners, quality });
    }
    const tree = spatial.pointIndex(triangles);
    for (const a of triangles) {
      if (!included(faceScope, a.face)) continue;
      if (!tree.box(spatial.expand(a.bounds, intersectionTolerance), b => {
        if (a === b || a.face === b.face || a.index >= b.index && included(faceScope, b.face)) return;
        if (work.trianglePairs >= maxPairs) return false;
        work.trianglePairs++;
        const issue = crossing(a, b, g, intersectionTolerance);
        if (issue) add('selfIntersections', issue);
      })) { work.intersectionsComplete = false; break; }
    }
    return freeze({ format, version: 1, mesh: doc.id, revision: topology.revision(doc),
      scope: selection === undefined ? null : topology.select(doc, { from: selection }),
      findings, counts, work, complete: work.duplicatesComplete && work.intersectionsComplete,
      truncated: Object.keys(counts).filter(key => counts[key] > findings[key].length) });
  }

  K.meshTopology = Object.freeze({ ...topology, health });
  return Object.freeze({ incidence, edgeSeam, crossesWinding, sameUV });
})(KIT);
