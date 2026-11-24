/* Detach section loops and cap them in a planar chart. */
const meshCutCaps = (function (K) {
  const { V } = K, { pair, basis } = meshCutGeometry;
  const inner = (point, ring) => {
    let odd = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[j], [x, y] = point;
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) odd = !odd;
    }
    return odd;
  };

  function boundaryPaths(edges) {
    const outgoing = new Map(), incoming = new Map(), unused = new Set(edges);
    for (const edge of edges) {
      if (!outgoing.has(edge[0])) outgoing.set(edge[0], []);
      outgoing.get(edge[0]).push(edge);
      incoming.set(edge[1], (incoming.get(edge[1]) ?? 0) + 1);
    }
    const branched = [...outgoing.values()].some(rows => rows.length > 1) ||
      [...incoming.values()].some(n => n > 1);
    const paths = [];
    const walk = edge => {
      const vertices = [edge[0]];
      while (edge && unused.delete(edge)) {
        vertices.push(edge[1]);
        if (edge[1] === vertices[0]) break;
        edge = outgoing.get(edge[1])?.find(row => unused.has(row));
      }
      const closed = vertices.length >= 4 && vertices[0] === vertices.at(-1);
      if (closed) vertices.pop();
      paths.push({ closed, vertices });
    };
    for (const edge of edges) if (!incoming.has(edge[0])) walk(edge);
    for (const edge of edges) if (unused.has(edge)) walk(edge);
    return { paths, branched };
  }

  function fit(loops, at, tolerance) {
    const vertices = loops[0], origin = at(vertices[0]), normal = [0, 0, 0];
    for (let i = 1; i < vertices.length - 1; i++) {
      const area = V.cross(V.sub(at(vertices[i]), origin), V.sub(at(vertices[i + 1]), origin));
      for (let axis = 0; axis < 3; axis++) normal[axis] += area[axis];
    }
    const length = V.len(normal);
    if (length <= tolerance ** 2) throw new RangeError('The cut boundary has no cap area');
    return basis(origin, V.mul(normal, 1 / length));
  }

  function makeCaps(boundary, piece, at, frame, cap, tolerance, fresh) {
    if (cap.kind === 'none' || !boundary.paths.length) return [];
    if (boundary.branched || boundary.paths.some(path => !path.closed))
      throw new RangeError('Caps need closed, consistently wound cut boundaries');
    const loops = boundary.paths.map(path => path.vertices);
    const chart = frame ?? fit(loops, at, tolerance);
    const distance = id => V.dot(V.sub(at(id), chart.origin), chart.normal);
    const points = loops.map(loop => loop.map(id => chart.project(at(id))));
    if (loops.some(loop => loop.some(id => Math.abs(distance(id)) > tolerance * 4)))
      throw new RangeError('Caps need coplanar loops. Leave bent knife boundaries open');
    if (!piece.some(face => face.corners.some(({ vertex }) => Math.abs(distance(vertex)) > tolerance * 4)))
      throw new RangeError('A flat surface piece needs an open cut boundary');

    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (const ring of points) for (const p of ring) for (let i = 0; i < 2; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
    const scale = Math.max(max[0] - min[0], max[1] - min[1]);
    if (!(scale > 0)) throw new RangeError('The cut boundary has no cap area');
    const uv = p => p.map((n, i) => (n - min[i]) / (max[i] - min[i] || 1));
    let rings;
    if (cap.kind === 'ngon') {
      if (loops.some(loop => loop.length > 128) || points.some((ring, i) => points.some((outer, j) => i !== j && inner(ring[0], outer))))
        throw new RangeError('Use triangle caps for holes or rings with more than 128 corners');
      rings = loops;
    } else {
      const normalized = points.map(ring => ring.map(p => p.map((n, i) => (n - min[i]) / scale)));
      const mesh = K.procedural.geometry.triangulatePolygon(normalized);
      const ids = loops.flat();
      const boundaryEdges = new Map(loops.flatMap(loop => loop.map((a, i) => [pair(a, loop[(i + 1) % loop.length]), a])));
      rings = mesh.triangles.filter(triangle => {
        const [a, b, c] = triangle.map(i => mesh.points[i]);
        return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-13;
      }).map(triangle => triangle.map(i => ids[i]));
      const directions = new Map();
      for (const ring of rings) for (const [i, a] of ring.entries()) {
        const key = pair(a, ring[(i + 1) % 3]);
        if (boundaryEdges.has(key)) {
          if (directions.has(key)) throw new RangeError('Cap triangulation overlaps a cut boundary');
          directions.set(key, a === boundaryEdges.get(key));
        }
      }
      if (directions.size !== boundaryEdges.size || new Set(directions.values()).size !== 1)
        throw new RangeError('Cap triangulation could not keep the directed boundary');
      if (!directions.values().next().value) rings = rings.map(ring => ring.slice().reverse());
    }
    return rings.map(ring => ({ id: fresh('cap'), material: cap.material,
      corners: ring.map(vertex => ({ id: fresh('corner'), vertex, uv: uv(chart.project(at(vertex))) })) }));
  }
  return { boundaryPaths, makeCaps };
})(KIT);
