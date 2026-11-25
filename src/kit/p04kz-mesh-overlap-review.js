/* Review coincident retained faces before changing topology. */
(function (K) {
  const { V, meshTopology: topology } = K;
  const { spatial, data } = K.procedural;
  const { area } = meshFaceRegionGeometry;
  const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  function faceGeometry(face, vertices) {
    const points = face.corners.map(corner => vertices.get(corner.vertex));
    const extent = spatial.boxOf(points);
    const roundoff = V.dist(extent.min, extent.max) * Number.EPSILON * 32;
    const areaVector = area(points), length = V.len(areaVector);
    const normal = length ? V.mul(areaVector, 1 / length) : [0, 0, 0];
    const planar = points.every(point => Math.abs(V.dot(normal, V.sub(point, points[0]))) <= roundoff);
    const boundary = planar && points.filter((point, i) => {
      const previous = points[(i + points.length - 1) % points.length];
      const span = V.sub(points[(i + 1) % points.length], previous);
      const delta = V.sub(point, previous), along = V.dot(delta, span), spanSq = V.dot(span, span);
      return !spanSq || along <= 0 || along >= spanSq || V.len(V.cross(delta, span)) > roundoff * V.len(span);
    });
    return { id: face.id, material: face.material, points, normal, extent,
      boundary: boundary && boundary.length >= 3 ? boundary : null,
      bounds: spatial.boxOf([extent.min]) };
  }

  function matchingDistance(a, b, tolerance, triangles) {
    if (V.dot(a.normal, b.normal) <= 0 ||
        a.extent.max.some((value, axis) => Math.abs(value - b.extent.max[axis]) > tolerance)) return null;
    const flat = a.boundary && b.boundary;
    const left = flat ? a.boundary : a.points, right = flat ? b.boundary : b.points;
    if (left.length !== right.length) return null;
    for (let phase = 0; phase < right.length; phase++) {
      let distance = 0;
      for (let i = 0; i < left.length && distance <= tolerance; i++)
        distance = Math.max(distance, V.dist(left[i], right[(i + phase) % right.length]));
      if (distance > tolerance) continue;
      // Warped rings can describe different surfaces when their render diagonals differ.
      if (!flat) {
        const key = (triangle, shift) => triangle.map(i => (i + shift) % left.length).sort((x, y) => x - y).join('/');
        const target = new Set(triangles(b.id).map(triangle => key(triangle, 0)));
        if (!triangles(a.id).every(triangle => target.has(key(triangle, phase)))) continue;
      }
      return distance;
    }
    return null;
  }

  function reviewOverlaps(source, settings = {}) {
    if (!settings || Object.getPrototypeOf(settings) !== Object.prototype ||
        Object.keys(settings).some(key => !['selection', 'tolerance', 'maxPairs', 'limit'].includes(key)))
      throw new TypeError('Use overlap review settings with selection, tolerance, maxPairs or limit');
    const { selection, tolerance = 1e-8, maxPairs = 250000, limit = 512 } = settings;
    if (!Number.isFinite(tolerance) || tolerance < 0 ||
        ![maxPairs, limit].every(value => Number.isSafeInteger(value) && value >= 1))
      throw new RangeError('Overlap review needs nonnegative mesh tolerance and positive integer pair and report limits');
    const doc = topology.create(source);
    const scope = selection === undefined ? null : topology.select(doc, { from: selection, convert: 'faces' });
    const included = scope && new Set(scope.ids);
    const vertices = new Map(doc.vertices.map(vertex => [vertex.id, vertex.position]));
    const rows = doc.faces.filter(face => !included || included.has(face.id))
      .map(face => faceGeometry(face, vertices)).sort(order);
    const index = spatial.pointIndex(rows), assigned = new Set(), groups = [], ids = [];
    let comparisons = 0, complete = true, duplicates = 0, groupCount = 0, triangleRings;
    function triangles(id) {
      if (!triangleRings) {
        triangleRings = new Map(doc.faces.map(face => [face.id, []]));
        const cornerIndices = new Map(doc.faces.flatMap(face => face.corners.map((corner, i) => [corner.id, i])));
        for (const triangle of topology.triangulate(doc).triangleSources)
          triangleRings.get(triangle.face).push(triangle.corners.map(corner => cornerIndices.get(corner)));
      }
      return triangleRings.get(id);
    }

    for (const face of rows) {
      if (assigned.has(face.id)) continue;
      const matches = [];
      complete = index.box(spatial.expand(face.bounds, tolerance), candidate => {
        if (candidate.id <= face.id || assigned.has(candidate.id)) return;
        if (comparisons >= maxPairs) return false;
        comparisons++;
        const distance = matchingDistance(face, candidate, tolerance, triangles);
        if (distance === null) return;
        assigned.add(candidate.id);
        matches.push({ id: candidate.id, material: candidate.material, distance });
      });
      if (matches.length) {
        groupCount++;
        const retained = matches.sort(order).slice(0, Math.max(0, limit - duplicates));
        duplicates += matches.length;
        if (retained.length) {
          ids.push(...retained.map(row => row.id));
          groups.push({ survivor: { id: face.id, material: face.material }, duplicates: retained });
        }
      }
      if (!complete) break;
    }
    return data.freeze({ format: 'ink-studio/mesh-overlap-review', version: 1,
      mesh: doc.id, revision: topology.revision(doc), tolerance, scope, groups,
      selection: topology.select(doc, { domain: 'faces', ids }),
      counts: { faces: rows.length, groups: groupCount, duplicates }, comparisons,
      complete, truncated: ids.length < duplicates });
  }

  K.meshTopology = Object.freeze({ ...topology, reviewOverlaps });
})(KIT);
