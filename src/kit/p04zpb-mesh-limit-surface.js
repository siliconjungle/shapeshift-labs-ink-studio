/* Query the retained subdivision surface in an authored quad's coordinates. */
(function (K) {
  const topology = K.meshTopology, { V } = K;
  const { freeze } = K.procedural.data;
  const { incidence, crossesWinding } = retainedMeshHealth;
  const { record, pair: edgeKey } = meshCutGeometry;
  const ring = face => face.corners.map(corner => corner.vertex);
  const around = (i, n) => (i + n) % n;
  const inner = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const outside = [[[0, -1], [1, -1]], [[2, 0], [2, 1]], [[1, 2], [0, 2]], [[-1, 1], [-1, 0]]];
  const diagonals = [[-1, -1], [2, -1], [2, 2], [-1, 2]];
  const sharp = edge => edge.uses.length === 1 ? 1 : edge.crease ?? 0;

  function layout(document) {
    const g = incidence(document), byEdge = new Map(), byVertex = new Map(document.vertices.map(row =>
      [row.id, { edges: [], faces: [] }]));
    for (const face of document.faces) for (const id of ring(face)) byVertex.get(id).faces.push(face);
    for (const edge of g.edges) {
      if (edge.uses.length > 2 || edge.uses.length === 2 && crossesWinding(...edge.uses, g.corners))
        throw new RangeError('Limit surface queries need manifold edges and consistent winding');
      byEdge.set(edgeKey(...edge.vertices), edge);
      for (const id of edge.vertices) byVertex.get(id).edges.push(edge);
    }
    return { g, byEdge, byVertex, point: id => g.vertices.get(id).position };
  }

  function regular(face, { byVertex, byEdge, g, point }) {
    const ids = ring(face);
    if (!ids.every(id => {
      const at = byVertex.get(id);
      return at.faces.length === 4 && at.edges.length === 4 &&
        at.faces.every(row => row.corners.length === 4) && at.edges.every(edge => sharp(edge) === 0);
    })) return;
    const grid = Array(16), set = ([x, y], id) => { grid[(y + 1) * 4 + x + 1] = point(id); };
    const adjacent = [], neighboring = [];
    for (const [i, a] of ids.entries()) {
      const b = ids[(i + 1) % 4], across = byEdge.get(edgeKey(a, b));
      const other = g.faces.get(across.uses.find(row => row.face !== face.id).face);
      const vertices = ring(other), at = vertices.indexOf(b);
      if (vertices[(at + 1) % 4] !== a) return;
      adjacent.push(other);
      neighboring.push([vertices[(at + 2) % 4], vertices[(at + 3) % 4]]);
      set(inner[i], a);
      outside[i].forEach((address, j) => set(address, neighboring[i][j]));
    }
    for (const [i, id] of ids.entries()) {
      const prev = around(i - 1, 4);
      const opposite = byVertex.get(id).faces.find(row => row !== face && row !== adjacent[i] && row !== adjacent[prev]);
      if (!opposite) return;
      const aroundCorner = ring(opposite), index = aroundCorner.indexOf(id);
      const connected = [aroundCorner[(index + 1) % 4], aroundCorner[(index + 3) % 4]];
      if (!connected.includes(neighboring[i][0]) || !connected.includes(neighboring[prev][1])) return;
      set(diagonals[i], aroundCorner[(index + 2) % 4]);
    }
    return grid;
  }

  function basis(t) {
    return [
      [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
        (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6],
      [-((1 - t) ** 2) / 2, (9 * t ** 2 - 12 * t) / 6, (-9 * t ** 2 + 6 * t + 3) / 6, t ** 2 / 2]
    ];
  }

  function cubic(grid, [u, v]) {
    const [x, dx] = basis(u), [y, dy] = basis(v);
    let position = [0, 0, 0], tangent = [0, 0, 0], bitangent = [0, 0, 0];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const point = grid[j * 4 + i];
      position = V.mad(position, point, x[i] * y[j]);
      tangent = V.mad(tangent, point, dx[i] * y[j]);
      bitangent = V.mad(bitangent, point, x[i] * dy[j]);
    }
    return { position, normal: direction(tangent, bitangent) };
  }

  function direction(tangent, bitangent) {
    const cross = V.cross(tangent, bitangent), size = V.len(cross);
    return size > 0 ? V.mul(cross, 1 / size) : null;
  }

  function vertexLimit(id, { byVertex, point }) {
    const at = byVertex.get(id), edges = at.edges, n = edges.length, p = point(id);
    const neighbors = edge => point(edge.vertices.find(vertex => vertex !== id));
    const creased = edges.filter(edge => sharp(edge) === 1);
    if (creased.length >= 3) return p;
    if (edges.some(edge => sharp(edge) > 0 && sharp(edge) < 1)) return p;
    if (creased.length === 2) return creased.reduce((sum, edge) => V.mad(sum, neighbors(edge), 1 / 6), V.mul(p, 2 / 3));
    if (creased.length || n < 3 || at.faces.length !== n || at.faces.some(face => face.corners.length !== 4)) return p;
    const center = V.mul(p, n * n), incident = edges.reduce((sum, edge) => V.mad(sum, neighbors(edge), 4), center);
    const total = at.faces.reduce((sum, face) => {
      const ids = ring(face), opposite = ids[(ids.indexOf(id) + 2) % 4];
      return V.add(sum, point(opposite));
    }, incident);
    return V.mul(total, 1 / (n * (n + 5)));
  }

  function estimate(face, uv, scene) {
    const [u, v] = uv, [a, b, c, d] = ring(face).map(id => vertexLimit(id, scene));
    return { position: V.lerp(V.lerp(a, b, u), V.lerp(d, c, u), v),
      normal: direction(V.lerp(V.sub(b, a), V.sub(c, d), v), V.lerp(V.sub(d, a), V.sub(c, b), u)) };
  }

  function childAt([u, v]) {
    if (v <= .5) return u <= .5 ? [0, [2 * u, 2 * v]] : [1, [2 * v, 2 * (1 - u)]];
    return u > .5 ? [2, [2 * (1 - u), 2 * (1 - v)]] : [3, [2 * (1 - v), 2 * u]];
  }

  function queryLimitSurface(source, request) {
    if (!record(request, ['samples', 'levels', 'positionTolerance', 'normalTolerance']))
      throw new TypeError('Use a quad limit surface query with UV samples');
    const { samples, levels = 3, positionTolerance = .001, normalTolerance = 2 } = request;
    let document = topology.create(source), scene = layout(document);
    if (!Array.isArray(samples) || !samples.length || samples.length > 256 ||
        !Number.isSafeInteger(levels) || levels < 0 || levels > 3 ||
        ![positionTolerance, normalTolerance].every(n => Number.isFinite(n) && n >= 0) || normalTolerance > 180)
      throw new RangeError('Use 1–256 sample points, zero to three refinement levels, and finite tolerances');
    const active = new Map(Array.from(samples, (row, index) => {
      if (!record(row, ['face', 'uv']) || typeof row.face !== 'string' || scene.g.faces.get(row.face)?.corners.length !== 4 ||
          !Array.isArray(row.uv) || row.uv.length !== 2 || !Array.from(row.uv).every(n => Number.isFinite(n) && n >= 0 && n <= 1))
        throw new RangeError('Limit surface samples need an existing quad and a UV pair in [0,1]');
      return [index, { query: row, face: row.face, uv: row.uv }];
    }));
    const output = [], revision = topology.revision(document);
    let stopped;
    for (let level = 0; active.size; level++) {
      for (const [index, item] of active) {
        const face = scene.g.faces.get(item.face), grid = regular(face, scene);
        const value = grid ? cubic(grid, item.uv) : estimate(face, item.uv, scene);
        const prior = item.result;
        const positionDelta = prior ? V.dist(value.position, prior.position) : null;
        const normalDelta = prior?.normal && value.normal ? Math.acos(Math.max(-1, Math.min(1,
          V.dot(value.normal, prior.normal)))) * 180 / Math.PI : null;
        const converged = Boolean(grid && value.normal) || positionDelta !== null && positionDelta <= positionTolerance &&
          normalDelta !== null && normalDelta <= normalTolerance;
        item.result = { ...item.query, position: value.position, normal: value.normal,
          method: grid ? 'regular-bicubic' : 'refined-limit-estimate', refinement: level,
          converged, positionDelta: grid ? null : positionDelta, normalDelta: grid ? null : normalDelta };
        output[index] = item.result;
        if (converged) active.delete(index);
      }
      if (!active.size || level >= levels) break;
      if (document.faces.reduce((sum, face) => sum + face.corners.length * 2, 0) > 250000) {
        stopped = 'subdivision-budget'; break;
      }
      const children = new Map([...active.values()].map(row => [row.face, []]));
      document = meshTopologySubdivision.run(document, 1, (_, lineage) => {
        for (const { from, to } of lineage.faces) children.get(from)?.push(to);
      });
      for (const item of active.values()) {
        const [index, uv] = childAt(item.uv);
        item.face = children.get(item.face)[index];
        item.uv = uv;
      }
      scene = layout(document);
    }
    return freeze({ format: 'ink-studio/mesh-limit-surface', version: 1, revision, levels, positionTolerance, normalTolerance,
      converged: !active.size, ...(stopped && { stopped }), samples: output });
  }

  K.meshTopology = Object.freeze({ ...topology, queryLimitSurface });
})(KIT);
