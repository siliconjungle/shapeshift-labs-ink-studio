/* Retained mesh topology cuts with stable ancestry and conforming section edges. */
(function (K) {
  const topology = K.meshTopology, { V } = K, { freeze, clone } = K.procedural.data;
  const { epsilon, pair, canonical, point, record, blend, unit, basis, knifeBasis, knifePath, plane, knife, triangleRows } = meshCutGeometry;
  const { boundaryPaths, makeCaps } = meshCutCaps;
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function settings(doc, request) {
    if (!record(request, ['id', 'revision', 'plane', 'knife', 'split', 'cap', 'tolerance']) ||
        typeof request.id !== 'string' || !/^[\w.-]{1,96}$/.test(request.id) ||
        (request.plane === undefined) === (request.knife === undefined))
      throw new TypeError('Use a cut ID, topology revision, and exactly one plane or knife');
    if (request.revision !== topology.revision(doc)) throw new RangeError('Stale mesh cut revision');
    const { split = true, cap = { kind: 'none' }, tolerance = .000001 } = request;
    if (typeof split !== 'boolean' || !record(cap, ['kind', 'material']) || !['none', 'ngon', 'triangles'].includes(cap.kind) ||
        cap.kind !== 'none' && (!split || typeof cap.material !== 'string' || !cap.material.trim()) ||
        cap.kind === 'none' && cap.material !== undefined || !Number.isFinite(tolerance) || tolerance <= 0)
      throw new TypeError('Use a positive cut tolerance and choose open boundaries or capped pieces with a material');
    if (request.plane !== undefined) {
      const raw = request.plane;
      if (!record(raw, ['origin', 'normal']) || !point(raw.origin, 3)) throw new TypeError('Plane cut needs a finite origin and normal');
      return { kind: 'plane', frame: basis(raw.origin, unit(raw.normal, 'Cut plane')), split, cap, tolerance };
    }
    const raw = request.knife;
    if (!record(raw, ['projection', 'path', 'selection'])) throw new TypeError('Knife needs a projected path and optional face selection');
    return { kind: 'knife', frame: knifeBasis(raw.projection), segments: knifePath(raw.path), split, cap, tolerance,
      selected: raw.selection === undefined ? null : new Set(topology.select(doc, { from: raw.selection, convert: 'faces' }).ids) };
  }

  function identifiers(doc, id) {
    const used = new Set([...doc.vertices, ...doc.edges, ...doc.faces, ...doc.faces.flatMap(face => face.corners)].map(row => row.id));
    let serial = 0;
    return kind => {
      let key;
      do { key = 'cut/' + id + '/' + kind + '/' + ++serial; } while (used.has(key));
      used.add(key);
      return key;
    };
  }

  function weighted(values, weights) {
    return values.reduce((total, n, i) => total + n * weights[i], 0);
  }

  function pool(doc, fresh) {
    const vertices = index(doc.vertices), origins = new Map(), samples = new Map();
    function insert(rows, weights) {
      const id = fresh('vertex');
      const position = [0, 1, 2].map(axis => weighted(rows.map(row => row.position[axis]), weights));
      const keys = [...new Set(rows.flatMap(row => Object.keys(row.weights ?? {})))].sort();
      const influences = Object.fromEntries(keys.map(key => [key,
        Math.max(0, Math.min(1, weighted(rows.map(row => Object.hasOwn(row.weights ?? {}, key) ? row.weights[key] : 0), weights)))]));
      vertices.set(id, { id, position, ...(keys.length && { weights: influences }) });
      origins.set(id, rows.map((row, i) => [row.id, weights[i]]).filter(([, weight]) => weight !== 0));
      return id;
    }
    function edgeSample(a, b, t) {
      const key = pair(a.id, b.id), rows = a.id < b.id ? [a, b] : [b, a];
      const u = a.id < b.id ? t : 1 - t;
      if (!samples.has(key)) samples.set(key, []);
      const list = samples.get(key), prior = list.find(row => Math.abs(row.u - u) <= epsilon);
      if (prior) return prior.id;
      const id = insert(rows, [1 - u, u]);
      list.push({ id, u });
      return id;
    }
    function add(triangle, weights) {
      const used = weights.flatMap((weight, i) => weight > 0 ? [i] : []);
      if (used.length === 1) return triangle.vertices[used[0]].id;
      if (used.length === 2) return edgeSample(...used.map(i => triangle.vertices[i]), weights[used[1]]);
      const existing = triangle.interior.find(row => row.weights.every((n, i) => Math.abs(n - weights[i]) <= epsilon));
      if (existing) return existing.id;
      const id = insert(triangle.vertices, weights);
      triangle.interior.push({ id, weights });
      return id;
    }
    function copy(id) {
      const key = fresh('vertex');
      vertices.set(key, { ...vertices.get(id), id: key });
      origins.set(key, origins.get(id) ?? [[id, 1]]);
      return key;
    }
    function edgePoints(a, b) {
      return (samples.get(pair(a, b)) ?? []).map(({ id, u }) => ({ id, t: a < b ? u : 1 - u }))
        .sort((a, b) => a.t - b.t);
    }
    return { vertices, origins, add, copy, edgePoints };
  }

  function edgeUses(faces) {
    const result = new Map();
    for (const [i, face] of faces.entries()) for (const [j, corner] of face.corners.entries()) {
      const next = face.corners[(j + 1) % face.corners.length], edge = pair(corner.vertex, next.vertex);
      if (!result.has(edge)) result.set(edge, []);
      result.get(edge).push({ i, a: corner.vertex, b: next.vertex });
    }
    return result;
  }

  function subdivide(triangle, pool, cut) {
    const rows = triangle.vertices.map((row, i) => ({ id: row.id, weights: canonical[i] })), perimeter = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const chain = [i];
      for (const { id, t } of pool.edgePoints(rows[i].id, rows[j].id)) {
        chain.push(rows.length);
        rows.push({ id, weights: blend(canonical[i], canonical[j], t) });
      }
      chain.push(j);
      for (let k = 1; k < chain.length; k++) perimeter.push(pair(chain[k - 1], chain[k]));
    }
    rows.push(...triangle.interior);
    const byId = new Map(rows.map((row, i) => [row.id, i]));
    const constraints = triangle.cuts.map(([a, b]) => [byId.get(a), byId.get(b)]);
    const triangles = rows.length === 3 ? [[0, 1, 2]] :
      K.procedural.geometry.delaunay(rows.map(({ weights }) => weights.slice(1)), { constraints }).triangles.filter(ring => {
        const [a, b, c] = ring.map(i => rows[i].weights);
        return Math.abs((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])) > 1e-13;
      });
    const edges = new Map(), rim = new Set(perimeter);
    for (const ring of triangles) for (const [i, a] of ring.entries()) {
      const key = pair(a, ring[(i + 1) % 3]);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    if (perimeter.some(edge => edges.get(edge) !== 1) ||
        [...edges].some(([edge, count]) => count !== (rim.has(edge) ? 1 : 2)))
      throw new RangeError('Cut triangulation could not preserve the authored triangle boundary');
    for (const [a, b] of constraints) {
      const from = rows[a].weights, d = V.sub(rows[b].weights, from), length = V.len(d);
      const on = row => {
        const p = V.sub(row.weights, from), t = V.dot(p, d) / (length * length);
        return t >= -epsilon && t <= 1 + epsilon && V.len(V.cross(p, d)) <= epsilon * length;
      };
      const along = rows.map((row, i) => ({ row, i })).filter(({ row }) => on(row))
        .sort((a, b) => V.dot(a.row.weights, d) - V.dot(b.row.weights, d));
      for (let i = 1; i < along.length; i++) {
        if (!edges.has(pair(along[i - 1].i, along[i].i)))
          throw new RangeError('Cut triangulation could not preserve a section edge');
        cut.add(pair(along[i - 1].row.id, along[i].row.id));
      }
    }
    return triangles.map(indices => indices.map(i => rows[i]));
  }

  function cornerAt(triangle, { id, weights }, fresh, retained, links) {
    const i = weights.findIndex(n => n === 1);
    if (i >= 0) {
      const corner = triangle.loop[i];
      if (!retained.has(corner.id)) {
        retained.add(corner.id);
        return corner;
      }
      const id = fresh('corner');
      links.push({ from: corner.id, to: id });
      return { ...corner, id };
    }
    const uv = [0, 1].map(axis => Math.max(0, Math.min(1, weighted(triangle.loop.map(row => row.uv[axis]), weights))));
    const layout = triangle.loop[0].attributes;
    const attributes = layout && Object.fromEntries(Object.entries(layout).map(([key, value]) => {
      const values = triangle.loop.map(row => row.attributes[key]);
      return [key, Array.isArray(value) ? value.map((_, i) => weighted(values.map(data => data[i]), weights)) : weighted(values, weights)];
    }));
    let normal;
    if (triangle.loop.some(row => row.normal)) {
      const fallback = meshTopologyShading.triangleNormal(triangle.positions);
      const sum = triangle.loop.reduce((sum, row, i) => V.mad(sum, row.normal ?? fallback, weights[i]), [0, 0, 0]);
      if (V.len(sum)) normal = meshTopologyShading.direction(sum);
    }
    return { id: fresh('corner'), vertex: id, uv, ...(attributes && { attributes }), ...(normal && { normal }) };
  }

  function cutFaces(doc, config, pool, fresh) {
    const triangles = triangleRows(doc, topology.triangulate(doc)), oldEdges = new Set(doc.edges.map(edge => pair(...edge.vertices)));
    if (config.kind === 'knife' && triangles.length * config.segments.length > 4000000)
      throw new RangeError('Knife path exceeds its triangle/segment budget');
    const cut = new Set(), byFace = new Map();
    for (const row of triangles) {
      if (!byFace.has(row.face)) byFace.set(row.face, []);
      byFace.get(row.face).push(row);
      if (config.selected && !config.selected.has(row.face)) continue;
      const cuts = config.kind === 'plane' ? plane(row.positions, config.frame, config.tolerance) :
        knife(row.positions, config.frame, config.segments);
      for (const [a, b] of cuts) {
        const start = pool.add(row, a), end = pool.add(row, b);
        if (start === end) continue;
        row.cuts.push([start, end]);
        cut.add(pair(start, end));
      }
    }
    // A constrained segment can pass through another retained node on the
    // same line. Match it against the corresponding material-independent edge.
    const retainedCorners = new Set(), faces = [], faceLinks = [], cornerLinks = [];
    for (const face of doc.faces) {
      const rows = byFace.get(face.id);
      const modified = rows.some(row => row.interior.length || row.cuts.some(ends => !oldEdges.has(pair(...ends))) ||
        row.vertices.some((vertex, i) => pool.edgePoints(vertex.id, row.vertices[(i + 1) % 3].id).length));
      if (!modified) { faces.push(face); continue; }
      const fragments = rows.flatMap(row => subdivide(row, pool, cut).map(corners => ({ row, corners })));
      for (const [i, { row, corners }] of fragments.entries()) {
        const id = i === 0 ? face.id : fresh('face');
        if (i) faceLinks.push({ from: face.id, to: id });
        faces.push({ id, material: face.material,
          corners: corners.map(corner => cornerAt(row, corner, fresh, retainedCorners, cornerLinks)) });
      }
    }
    const uses = edgeUses(faces);
    if (config.kind === 'plane') {
      const distance = id => V.dot(V.sub(pool.vertices.get(id).position, config.frame.origin), config.frame.normal);
      const sides = faces.map(face => {
        const d = face.corners.map(({ vertex }) => distance(vertex));
        return d.some(n => n > config.tolerance) ? 1 : d.some(n => n < -config.tolerance) ? -1 : 0;
      });
      for (const [edge, rows] of uses) if (rows.length > 1 &&
          rows.some(row => sides[row.i] > 0) && rows.some(row => sides[row.i] < 0) &&
          [rows[0].a, rows[0].b].every(id => Math.abs(distance(id)) <= config.tolerance * 4)) cut.add(edge);
    }
    return { faces, uses, cut: new Set([...cut].filter(edge => uses.has(edge))), faceLinks, cornerLinks };
  }

  function components(faces, uses, barriers) {
    const adjacent = faces.map(() => []), visited = new Set(), groups = [];
    for (const [edge, rows] of uses) if (!barriers.has(edge)) for (const row of rows.slice(1)) {
      adjacent[row.i].push(rows[0].i);
      adjacent[rows[0].i].push(row.i);
    }
    for (let i = 0; i < faces.length; i++) if (!visited.has(i)) {
      const queue = [i];
      visited.add(i);
      for (let j = 0; j < queue.length; j++) for (const k of adjacent[queue[j]]) if (!visited.has(k)) {
        visited.add(k);
        queue.push(k);
      }
      groups.push(queue.sort((a, b) => a - b));
    }
    return groups;
  }

  function finish(doc, cut, pool, config, fresh) {
    const { faces, uses, cut: barriers } = cut, groups = components(faces, uses, barriers);
    const claimed = new Set(), pieces = [], candidate = new Map(faces.map(face => [face.id, face]));
    const caps = [], sectionPoints = new Set(), sections = groups.map(() => []), groupOf = [];
    for (const [i, group] of groups.entries()) for (const face of group) groupOf[face] = i;
    for (const edge of barriers) {
      const rows = uses.get(edge), local = new Map();
      for (const row of rows) {
        const i = groupOf[row.i];
        if (!local.has(i)) local.set(i, []);
        local.get(i).push(row);
      }
      if (local.size > 1) for (const [i, uses] of local) {
        if (uses.length !== 1 && config.cap.kind !== 'none')
          throw new RangeError('Caps need manifold cut boundaries');
        if (uses.length === 1) sections[i].push(uses[0]);
        for (const { a, b } of uses) sectionPoints.add(a).add(b);
      }
    }
    for (const [i, group] of groups.entries()) {
      const subset = group.map(index => faces[index]), local = new Map();
      const claim = id => {
        if (!local.has(id)) {
          local.set(id, config.split && sectionPoints.has(id) && claimed.has(id) ? pool.copy(id) : id);
          claimed.add(id);
        }
        return local.get(id);
      };
      const body = subset.map(face => ({ ...face, corners: face.corners.map(row => ({ ...row, vertex: claim(row.vertex) })) }));
      const boundary = boundaryPaths(sections[i].map(({ a, b }) => [claim(b), claim(a)]));
      const newCaps = makeCaps(boundary, body, id => pool.vertices.get(id).position,
        config.kind === 'plane' ? config.frame : null, config.cap, config.tolerance, fresh);
      for (const face of body) candidate.set(face.id, face);
      caps.push(...newCaps);
      pieces.push({ id: doc.id + '/piece/' + (i + 1), faces: body.concat(newCaps), boundary,
        caps: newCaps.map(face => face.id) });
    }
    if (barriers.size && config.cap.kind !== 'none' && !caps.length)
      throw new RangeError('Caps need a cut that separates closed boundary loops');
    return { faces: [...candidate.values(), ...caps], pieces };
  }

  function planCut(source, request) {
    const doc = topology.create(source), config = settings(doc, request), fresh = identifiers(doc, request.id);
    const points = pool(doc, fresh), traces = cutFaces(doc, config, points, fresh);
    const { faces, pieces } = finish(doc, traces, points, config, fresh);
    const old = index(doc.faces), vertices = [...points.vertices.values()].slice(doc.vertices.length);
    const patch = {};
    if (vertices.length) patch.vertices = vertices;
    const changed = faces.filter(face => !same(face, old.get(face.id)));
    if (changed.length) patch.faces = changed;
    const candidate = changed.length || vertices.length ? topology.edit(doc, patch) : doc;
    const oldEdges = new Map(doc.edges.map(edge => [pair(...edge.vertices), edge.id]));
    const edgeLinks = candidate.edges.flatMap(edge => {
      const ancestors = [...new Set(edge.vertices.flatMap(id => points.origins.get(id)?.map(([from]) => from) ?? [id]))];
      const from = ancestors.length === 2 && oldEdges.get(pair(...ancestors));
      return from && from !== edge.id ? [{ from, to: edge.id }] : [];
    });
    const lineage = { faces: traces.faceLinks, corners: traces.cornerLinks, edges: edgeLinks };
    if (Object.values(lineage).some(rows => rows.length)) patch.lineage = lineage;
    const edgesByPair = new Map(candidate.edges.map(edge => [pair(...edge.vertices), edge]));
    const reports = pieces.map(piece => {
      const ids = new Set(piece.faces.flatMap(face => face.corners.map(corner => corner.vertex)));
      const edges = [...edgeUses(piece.faces).keys()].map(key => edgesByPair.get(key));
      const document = topology.create({ id: piece.id, faces: piece.faces,
        vertices: [...ids].map(id => points.vertices.get(id)), edges, skin:doc.skin });
      return { id: piece.id, document, boundary: piece.boundary, caps: piece.caps };
    });
    const report = {
      format: 'ink-studio/mesh-cut', version: 1, beforeRevision: topology.revision(doc), afterRevision: topology.revision(candidate),
      mesh: doc.id, request: clone(request), kind: config.kind, split: config.split,
      cutEdges: [...traces.cut].sort().map(key => JSON.parse(key)),
      vertices: vertices.map(({ id }) => ({ id, sources: points.origins.get(id) })),
      pieces: reports.map(({ id, document, boundary, caps }) => ({ id, faces: document.faces.length, boundary, caps })), lineage
    };
    return freeze({ document: candidate, patch, report, pieces: reports });
  }

  K.meshTopology = Object.freeze({ ...topology, planCut });
})(KIT);
