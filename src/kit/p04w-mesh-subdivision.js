/* Derive a Catmull–Clark surface from a retained cage and semi-sharp edges. */
const meshTopologySubdivision = (function (K) {
  const { meshTopology: topology, V } = K;
  const { record } = meshCutGeometry;
  const { context, cyclic, point, cornerData, corners, edgeOf, requireWinding } = meshEdgeFlowData;
  const { direction } = meshTopologyShading;
  const { area } = meshFaceRegionGeometry;
  const one = id => new Map([[id, 1]]);
  const mean = rows => mix(rows.map(row => [row, 1 / rows.length]));
  const between = (a, b, t) => mix([[a, 1 - t], [b, t]]);

  function mix(rows) {
    const result = new Map();
    for (const [row, factor] of rows) if (factor) for (const [id, weight] of row) {
      result.set(id, (result.get(id) ?? 0) + weight * factor);
    }
    return result;
  }

  function refine(doc, level, trace, stage) {
    const g = context(doc, { id: (stage ? stage + '.' : '') + 'subdivision-' + level, revision: topology.revision(doc) });
    const atVertex = new Map(doc.vertices.map(row => [row.id, { faces: [], edges: [] }]));
    const lineage = trace && { faces: [], edges: [], corners: [] };
    const vertices = [], faces = [], edges = [], centers = new Map(), middle = new Map();
    function add(stencil, keep) {
      const { vertex } = point(g, [...stencil]);
      const row = keep === undefined ? vertex : { ...vertex, id: keep };
      vertices.push(row);
      return row.id;
    }
    for (const face of doc.faces) {
      const at = mean(face.corners.map(({ vertex }) => one(vertex)));
      centers.set(face.id, { at, id: add(at) });
      for (const { vertex } of face.corners) atVertex.get(vertex).faces.push(face.id);
    }
    for (const edge of g.edges) {
      requireWinding(g, edge);
      const [a, b] = edge.vertices;
      const midpoint = mean([one(a), one(b)]), sharp = edge.uses.length === 1 ? 1 : edge.crease ?? 0;
      const smooth = edge.uses.length === 2 ? mean([one(a), one(b), ...edge.uses.map(row => centers.get(row.face).at)]) : midpoint;
      const id = add(between(smooth, midpoint, sharp));
      middle.set(edge.id, id);
      for (const [vertex, other] of [[a, b], [b, a]]) {
        atVertex.get(vertex).edges.push({ midpoint, sharp, other });
        const child = g.fresh('edge');
        lineage?.edges.push({ from: edge.id, to: child });
        edges.push({ id: child, vertices: [vertex, id],
          ...(edge.smooth !== undefined && { smooth: edge.smooth }), ...(edge.crease !== undefined && { crease: edge.crease }) });
      }
    }
    for (const [id, row] of atVertex) {
      const n = row.edges.length;
      if (!n) {
        vertices.push(g.vertices.get(id));
        continue;
      }
      const boundary = row.edges.filter(edge => edge.sharp > 0).sort((a, b) => b.sharp - a.sharp);
      const point = one(id), neighbors = mean(row.edges.map(edge => edge.midpoint));
      const face = mean(row.faces.map(id => centers.get(id).at));
      const smooth = n < 3 ? point : mix([[face, 1 / n], [neighbors, 2 / n], [point, (n - 3) / n]]);
      let mask = smooth;
      if (boundary.length >= 2) {
        const crease = mix([[point, .75], [one(boundary[0].other), .125], [one(boundary[1].other), .125]]);
        const split = boundary[1].sharp, corner = boundary[2]?.sharp ?? 0;
        mask = mix([[smooth, 1 - split], [crease, split - corner], [point, corner]]);
      }
      add(mask, id);
    }
    const conflicts = new Set();
    for (const face of doc.faces) {
      const { id } = centers.get(face.id), ring = face.corners, n = ring.length;
      const authored = ring.some(row => row.normal);
      const fallback = authored && direction(area(ring.map(c => g.vertices.get(c.vertex).position)));
      for (const [i, corner] of ring.entries()) {
        const next = cyclic(ring, i + 1), prior = cyclic(ring, i - 1);
        const a = middle.get(edgeOf(g, corner.vertex, next.vertex).id);
        const b = middle.get(edgeOf(g, prior.vertex, corner.vertex).id);
        const samples = [[[corner, 1]], [[corner, .5], [next, .5]], ring.map(row => [row, 1 / n]), [[prior, .5], [corner, .5]]];
        const rows = corners(g, [corner.vertex, a, id, b], samples.map(rows => cornerData(rows)), conflicts);
        if (authored) for (const [j, weights] of samples.entries()) {
          if (!weights.some(([c]) => c.normal)) continue;
          const normal = direction(weights.reduce((sum, [c, w]) => V.mad(sum, c.normal ?? fallback, w), [0, 0, 0]));
          if (V.len(normal)) rows[j].normal = normal;
        }
        edges.push({ id: g.fresh('edge'), vertices: [a, id], smooth: true });
        const child = g.fresh('face');
        lineage?.faces.push({ from: face.id, to: child });
        lineage?.corners.push({ from: corner.id, to: rows[0].id });
        faces.push({ id: child, material: face.material, corners: rows });
      }
    }
    const next = topology.create({ ...doc, id: doc.id + '/subdivision-' + level, vertices, edges, faces });
    trace?.(next, lineage);
    return next;
  }

  function subdivide(source, options = {}) {
    if (!record(options, ['levels'])) throw new TypeError('Use mesh subdivision levels');
    return run(source, options.levels ?? 1);
  }

  function run(source, levels, trace, stage) {
    if (!Number.isSafeInteger(levels) || levels < 0 || levels > 3)
      throw new RangeError('Use zero to three subdivision levels');
    let doc = topology.create(source);
    for (let level = 1; level <= levels; level++) {
      if (doc.faces.reduce((count, face) => count + face.corners.length * 2, 0) > 250000)
        throw new RangeError('Subdivision exceeds the render triangle budget');
      doc = refine(doc, level, trace, stage);
    }
    return doc;
  }

  K.meshTopology = Object.freeze({ ...topology, subdivide });
  return { run };
})(KIT);
