/* Shared boundary and displacement calculations for face-region edits. */
const meshFaceRegionGeometry = (function (K) {
  const { V } = K, { pair, basis, unit } = meshCutGeometry;
  const { boundaryPaths } = meshCutCaps;

  function area(points) {
    const origin = points[0];
    return points.reduce((sum, point, i) => V.add(sum,
      V.cross(V.sub(point, origin), V.sub(points[(i + 1) % points.length], origin))), [0, 0, 0]);
  }

  function regions(doc, selection, kind) {
    const g = retainedMeshHealth.incidence(doc), selected = new Set(selection.ids);
    const neighbors = new Map(selection.ids.map(id => [id, []])), boundaries = new Map();
    for (const edge of g.edges) {
      const uses = edge.uses.filter(use => selected.has(use.face));
      if (!uses.length) continue;
      if (edge.uses.length > 2 || edge.uses.length === 2 &&
          retainedMeshHealth.crossesWinding(...edge.uses, g.corners))
        throw new RangeError('Face region meets an inconsistently wound or non-manifold edge ' + edge.id);
      if (uses.length === 2) {
        neighbors.get(uses[0].face).push(uses[1].face);
        neighbors.get(uses[1].face).push(uses[0].face);
        continue;
      }
      const { face, from, to } = uses[0], a = g.corners.get(from), b = g.corners.get(to);
      if (!boundaries.has(face)) boundaries.set(face, []);
      boundaries.get(face).push({ face, edge: edge.id, a, b, attached: edge.uses.length === 2 });
    }
    const result = [], visited = new Set(), usedVertices = new Set();
    for (const id of selection.ids) {
      if (visited.has(id)) continue;
      const queue = [id];
      visited.add(id);
      for (const face of queue) for (const next of neighbors.get(face)) if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
      const faces = queue.map(id => g.faces.get(id));
      const rim = queue.flatMap(id => boundaries.get(id) ?? []);
      const { paths, branched } = boundaryPaths(rim.map(({ a, b }) => [a.vertex, b.vertex]));
      if (branched || paths.some(path => !path.closed))
        throw new RangeError('Face-region boundary needs closed loops without pinched corners');
      if (kind === 'thicken' ? rim.some(edge => edge.attached) : !rim.length)
        throw new RangeError(kind === 'thicken' ?
          'Thicken needs complete surface islands. For an attached patch, extrude into the mesh' :
          'Extrude and inset need a region with a boundary');
      const vertices = new Map();
      for (const face of faces) for (const { vertex } of face.corners) {
        if (!vertices.has(vertex)) vertices.set(vertex, []);
        vertices.get(vertex).push(face.id);
      }
      for (const vertex of vertices.keys()) {
        if (usedVertices.has(vertex)) throw new RangeError('Face regions meet at a pinched vertex ' + vertex);
        usedVertices.add(vertex);
      }
      const byEnds = new Map(rim.map(edge => [pair(edge.a.vertex, edge.b.vertex), edge]));
      const loops = paths.map(({ vertices }) =>
        vertices.map((a, i) => byEnds.get(pair(a, vertices[(i + 1) % vertices.length]))));
      result.push({ faces, vertices, loops });
    }
    // A vertex shared only by point contact must stay where the other region uses it.
    const outside = new Set(doc.faces.flatMap(face => selected.has(face.id) ? [] : face.corners.map(c => c.vertex)));
    for (const { vertices, loops } of result) {
      const rim = new Set(loops.flatMap(loop => loop.map(edge => edge.a.vertex)));
      if ([...vertices.keys()].some(id => outside.has(id) && !rim.has(id)))
        throw new RangeError('Face region touches unselected geometry at an interior vertex');
    }
    return { regions: result, vertices: g.vertices };
  }

  function loopOffset(loop, at, normal, distance, tolerance) {
    const ids = loop.map(edge => edge.a.vertex), result = new Map();
    const directions = ids.map((id, i) => unit(V.sub(at(ids[(i + 1) % ids.length]), at(id)), 'Rim edge'));
    for (const [i, id] of ids.entries()) {
      const before = V.cross(normal, directions[(i + ids.length - 1) % ids.length]);
      const after = V.cross(normal, directions[i]), divisor = 1 + V.dot(before, after);
      if (divisor <= 1e-6) throw new RangeError('Inset miter collapses at vertex ' + id);
      result.set(id, V.mul(V.add(before, after), distance / divisor));
    }
    for (const [i, id] of ids.entries()) {
      const b = ids[(i + 1) % ids.length], edge = V.sub(V.add(at(b), result.get(b)), V.add(at(id), result.get(id)));
      if (V.dot(edge, directions[i]) <= tolerance)
        throw new RangeError('Inset crosses or collapses rim edge ' + loop[i].edge);
    }
    return result;
  }

  function inset(region, at, normal, distance, tolerance) {
    const origin = at(region.faces[0].corners[0].vertex);
    if ([...region.vertices.keys()].some(id => Math.abs(V.dot(V.sub(at(id), origin), normal)) > tolerance))
      throw new RangeError('Inset needs coplanar faces within each selected region');
    const offsets = new Map(region.loops.flatMap(loop => [...loopOffset(loop, at, normal, distance, tolerance)]));
    const adjacency = new Map([...region.vertices.keys()].filter(id => !offsets.has(id)).map(id => [id, new Set()]));
    for (const face of region.faces) for (const [i, { vertex: a }] of face.corners.entries()) {
      const b = face.corners[(i + 1) % face.corners.length].vertex;
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    }
    // Relax the displacement field with the fixed miter positions as boundary conditions.
    for (const id of adjacency.keys()) offsets.set(id, [0, 0, 0]);
    for (let pass = 0; pass < 128 && adjacency.size; pass++) {
      const next = new Map();
      let residual = 0;
      for (const [id, neighbors] of adjacency) {
        const sum = [...neighbors].reduce((sum, other) => V.add(sum, offsets.get(other)), [0, 0, 0]);
        const value = V.mul(sum, 1 / neighbors.size);
        next.set(id, value);
        residual = Math.max(residual, V.dist(value, offsets.get(id)));
      }
      for (const [id, offset] of next) offsets.set(id, offset);
      if (residual <= tolerance * .1) break;
    }
    return offsets;
  }

  function thicken(region, normals, distance) {
    return new Map([...region.vertices].map(([id, faces]) => {
      const axes = faces.map(face => normals.get(face));
      const average = unit(axes.reduce(V.add, [0, 0, 0]), 'Shell normal at ' + id);
      const facing = axes.reduce((min, axis) => Math.min(min, V.dot(axis, average)), 1);
      if (facing < .1) throw new RangeError('Shell offset turns too sharply at vertex ' + id);
      return [id, V.mul(average, -distance / facing)];
    }));
  }

  function displacement(region, at, config) {
    const { kind, distance, direction, tolerance } = config;
    const areas = new Map(region.faces.map(face => [face.id, area(face.corners.map(c => at(c.vertex)))]));
    const normals = new Map([...areas].map(([id, vector]) => [id, unit(vector, 'Face normal ' + id)]));
    if (kind === 'thicken') return { offsets: thicken(region, normals, distance), normals };
    const normal = direction ?? unit([...areas.values()].reduce(V.add, [0, 0, 0]), 'Region normal');
    if (kind === 'inset') return { offsets: inset(region, at, normal, distance, tolerance), normals };
    return { offsets: new Map([...region.vertices.keys()].map(id => [id, V.mul(normal, distance)])), normals };
  }

  function planarUV(points, normal) {
    const frame = basis(points[0], normal);
    const chart = points.map(frame.project);
    const min = [0, 1].map(i => Math.min(...chart.map(p => p[i])));
    const max = [0, 1].map(i => Math.max(...chart.map(p => p[i])));
    return chart.map(point => point.map((n, i) => (n - min[i]) / (max[i] - min[i] || 1)));
  }

  return { area, regions, displacement, planarUV };
})(KIT);
