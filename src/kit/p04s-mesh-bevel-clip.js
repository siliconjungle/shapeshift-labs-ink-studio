/* Clip the connected neighborhood of each selected edge and stitch the section. */
const meshBevelClip = (function (K) {
  const { V } = K, { boundaryPaths } = meshCutCaps;
  const { pair, index, point, cornerData, corners, cyclic } = meshEdgeFlowData;
  const { planar, dotAt } = meshBevelPlanes;

  function pool(g) {
    return { vertices: new Map(g.vertices), faces: new Map(g.faces), ancestry: new Map(), conflicts: new Set() };
  }

  function isLocal(g, face, anchors) {
    return face.feature ? face.feature.anchors.some(id => anchors.has(id)) :
      g.faces.get(face.id).corners.some(corner => anchors.has(corner.vertex));
  }

  function outsideRegion(g, state, plane, distance) {
    const anchors = new Set(plane.anchors), seeds = new Set(plane.seeds), incident = new Map(), candidates = [];
    for (const face of state.faces.values()) {
      const outside = face.corners.filter(corner => distance(corner.vertex) > 0);
      if (!outside.length) continue;
      if (seeds.has(face.id) || face.feature?.id === plane.id && !face.feature.corner ||
          plane.corner && face.feature?.anchors.includes(plane.id)) candidates.push(face);
      for (const { vertex } of outside) {
        if (!incident.has(vertex)) incident.set(vertex, []);
        incident.get(vertex).push(face);
      }
    }
    const affected = new Map(candidates.map(face => [face.id, face])), seen = new Set();
    for (const face of affected.values()) {
      if (!isLocal(g, face, anchors)) throw new RangeError('Bevel would trim beyond the selected edge neighborhood at face ' + face.id);
      for (const { vertex } of face.corners) if (distance(vertex) > 0 && !seen.has(vertex)) {
        seen.add(vertex);
        for (const next of incident.get(vertex)) affected.set(next.id, next);
      }
    }
    return affected;
  }

  function samples(state, a, b, t) {
    const paths = new Map();
    for (const [id, factor] of [[a, 1 - t], [b, t]]) for (const [source, weight] of state.ancestry.get(id) ?? [[id, 1]]) {
      const influence = factor * weight;
      if (influence > 0) paths.set(source, (paths.get(source) ?? 0) + influence);
    }
    return [...paths].sort(([a], [b]) => a < b ? -1 : 1);
  }

  function clip(g, state, plane, tolerance) {
    const distances = new Map();
    function distance(id) {
      if (!distances.has(id)) {
        const n = dotAt(plane, state.vertices.get(id).position);
        distances.set(id, Math.abs(n) <= tolerance ? 0 : n);
      }
      return distances.get(id);
    }
    const affected = outsideRegion(g, state, plane, distance), section = new Map(), inserted = new Map();
    if (!affected.size) return null;

    function intersect(a, b) {
      const d = distance(a.vertex), e = distance(b.vertex);
      const f = d / (d - e), key = pair(a.vertex, b.vertex);
      if (!inserted.has(key)) {
        const at = V.lerp(state.vertices.get(a.vertex).position, state.vertices.get(b.vertex).position, f);
        const ancestry = samples(state, a.vertex, b.vertex, f);
        const { vertex } = point(g, ancestry, at);
        state.vertices.set(vertex.id, vertex);
        state.ancestry.set(vertex.id, ancestry);
        distances.set(vertex.id, 0);
        inserted.set(key, vertex.id);
      }
      const row = corners(g, [inserted.get(key)], [cornerData([[a, 1 - f], [b, f]])], state.conflicts)[0];
      if (a.normal || b.normal) {
        const normal = meshTopologyShading.direction(V.lerp(a.normal ?? b.normal, b.normal ?? a.normal, f));
        if (V.len(normal)) row.normal = normal;
      }
      return row;
    }

    for (const face of affected.values()) {
      if (!face.feature) planar(face, state.vertices, tolerance);
      let crossings = 0;
      const ring = [];
      for (const [i, a] of face.corners.entries()) {
        const b = cyclic(face.corners, i + 1), d = distance(a.vertex), e = distance(b.vertex);
        if (d <= 0) ring.push(a);
        if (d * e < 0) ring.push(intersect(a, b));
        if ((d > 0) !== (e > 0)) crossings++;
      }
      if (crossings > 2)
        throw new RangeError('Bevel would split the retained polygon into multiple regions at face ' + face.id);
      if (ring.length < 3) {
        if (!face.feature) throw new RangeError('Bevel consumes authored face ' + face.id);
        state.faces.delete(face.id);
        continue;
      }
      state.faces.set(face.id, { ...face, corners: ring });
      for (const [i, a] of ring.entries()) {
        const b = cyclic(ring, i + 1);
        if (!distance(a.vertex) && !distance(b.vertex)) section.set(pair(a.vertex, b.vertex), []);
      }
    }
    for (const face of state.faces.values()) for (const [i, a] of face.corners.entries()) {
      const b = cyclic(face.corners, i + 1), key = pair(a.vertex, b.vertex);
      if (section.has(key)) section.get(key).push([a, b]);
    }
    const open = [...section.values()].filter(uses => uses.length === 1).map(([edge]) => edge);
    const boundary = boundaryPaths(open.map(([a, b]) => [b.vertex, a.vertex]));
    if (boundary.branched || boundary.paths.length !== 1 || !boundary.paths[0].closed)
      throw new RangeError('Bevel needs a closed, single section around ' + plane.id);
    const ids = boundary.paths[0].vertices, samplesAt = new Map();
    if (ids.length > 128) throw new RangeError('Bevel section exceeds the supported polygon corner budget');
    for (const edge of open) for (const corner of edge) {
      if (!samplesAt.has(corner.vertex)) samplesAt.set(corner.vertex, []);
      samplesAt.get(corner.vertex).push(corner);
    }
    const data = ids.map(id => {
      const rows = samplesAt.get(id);
      return cornerData(rows.map(corner => [corner, 1 / rows.length]), plane.uv(state.vertices.get(id).position));
    });
    const face = { id: g.fresh(plane.corner ? 'corner-join' : 'bevel'), material: plane.material,
      feature: { id: plane.id, anchors: plane.anchors, ...(plane.corner && { corner: true }), ...(plane.index !== undefined && { index: plane.index }) },
      corners: corners(g, ids, data, state.conflicts) };
    state.faces.set(face.id, face);
    return face.id;
  }

  function patch(doc, state) {
    const faces = [], detail = [], used = new Set(), oldFaces = index(doc.faces);
    for (const { feature, ...face } of state.faces.values()) {
      for (const corner of face.corners) used.add(corner.vertex);
      if (feature) detail.push({ face: face.id, ...feature });
      const before = oldFaces.get(face.id);
      if (!before || before.corners !== face.corners) faces.push(face);
    }
    const vertices = [...state.ancestry.keys()].filter(id => used.has(id)).map(id => state.vertices.get(id));
    const unused = new Set(doc.faces.flatMap(face => face.corners.map(corner => corner.vertex)));
    const removeVertices = doc.vertices.flatMap(row => !used.has(row.id) && unused.has(row.id) ? [row.id] : []);
    return { detail, patch: {
      ...(vertices.length && { vertices }), ...(faces.length && { faces }), ...(removeVertices.length && { removeVertices })
    } };
  }

  return { pool, clip, patch };
})(KIT);
