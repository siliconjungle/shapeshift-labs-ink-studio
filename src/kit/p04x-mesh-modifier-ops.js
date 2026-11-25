/* Geometry stages for the retained connected-mesh modifier stack. */
const meshModifierOps = (function (K) {
  const { meshTopology: topology, V } = K;
  const { record, point, unit } = meshCutGeometry;
  const { context } = meshEdgeFlowData;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const positive = n => Number.isFinite(n) && n > 0;
  const bool = n => typeof n === 'boolean';
  const memberList = value => Array.isArray(value) && value.length && value.every(name) && new Set(value).size === value.length;
  const count = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max;
  const optional = (value, check) => value === undefined || check(value);
  const xyz = value => point(value, 3);
  const kinds = {
    mirror: { origin: n => optional(n, xyz), normal: xyz, weld: n => optional(n, bool),
      tolerance: n => optional(n, positive), flipU: n => optional(n, bool) },
    array: { count: n => count(n, 32), step: xyz },
    bevel: { edges: n => optional(n, memberList), width: positive, segments: n => optional(n, value => count(value, 16)),
      profile: n => optional(n, value => name(value) || record(value, ['points'])), join: n => optional(n, name),
      weights: n => optional(n, Array.isArray), material: n => optional(n, name), protect: n => optional(n, value => !!value) },
    shell: { faces: n => optional(n, memberList), thickness: positive,
      rim: n => optional(n, value => record(value, ['material', 'uv'])),
      interior: n => optional(n, value => record(value, ['material', 'uv'])), minWall: n => optional(n, positive) },
    subdivision: { levels: n => count(n, 3) },
    projection: { target: name, direction: xyz, distance: positive, vertices: n => optional(n, memberList),
      bidirectional: n => optional(n, bool), offset: n => optional(n, Number.isFinite),
      miss: n => optional(n, value => value === 'keep' || value === 'error') }
  };

  function validate(row) {
    if (typeof row?.kind !== 'string' || !Object.hasOwn(kinds, row.kind) || typeof row.id !== 'string' ||
        !/^[\w.-]{1,64}$/.test(row.id) || !optional(row.enabled, bool))
      throw new TypeError('Mesh modifiers need a stable ID, supported kind and optional boolean enabled');
    const fields = kinds[row.kind];
    if (!record(row, ['id', 'kind', 'enabled', ...Object.keys(fields)]) ||
        !Object.entries(fields).every(([field, accepts]) => accepts(row[field])))
      throw new TypeError('Invalid parameters on mesh modifier ' + row.id + ' (' + row.kind + ')');
  }

  const revision = doc => topology.revision(doc);
  function repeatBudget(doc, times) {
    const { triangles, vertices } = topology.inspect(doc);
    if (triangles * times > 250000 || vertices * times > 750000)
      throw new RangeError('Mesh copies exceed the topology budget');
  }
  function copies(doc, op, diagnostics) {
    const g = context(doc, { id: op.id, revision: revision(doc) });
    return { vertices: [...doc.vertices], edges: [...doc.edges], faces: [...doc.faces], fresh: g.fresh,
      ...(diagnostics&&{lineage:{vertices:[],edges:[],faces:[],corners:[]}}) };
  }
  function copy(doc, state, vertex, normal, flip, flipU) {
    const names = new Map(doc.vertices.map(row => [row.id, vertex(row)]));
    for (const [from,to] of names) if(from!==to) state.lineage?.vertices.push({from,to});
    function next(domain,kind,from) {
      const to=state.fresh(kind);
      state.lineage?.[domain].push({from,to});
      return to;
    }
    for (const edge of doc.edges) {
      const vertices = edge.vertices.map(id => names.get(id));
      if (vertices.some((id, i) => id !== edge.vertices[i])) state.edges.push({ ...edge, id:next('edges','edge',edge.id), vertices });
    }
    for (const face of doc.faces) {
      const corners = face.corners.map(row => ({ ...row, id:next('corners','corner',row.id), vertex: names.get(row.vertex),
        ...(row.normal && normal && { normal: normal(row.normal) }), ...(flipU && { uv: [1 - row.uv[0], row.uv[1]] }) }));
      state.faces.push({ ...face, id:next('faces','face',face.id), corners: flip ? corners.reverse() : corners });
    }
  }
  function result(doc, { vertices, edges, faces }) {
    return topology.create({ ...doc, vertices, edges, faces });
  }

  function array(doc, op, _target, diagnostics) {
    if (op.count === 1) return { document: doc };
    if (!(V.len(op.step) > 0)) throw new RangeError('Array step needs a nonzero offset');
    repeatBudget(doc, op.count);
    const state = copies(doc, op, diagnostics);
    for (let i = 1; i < op.count; i++) copy(doc, state, source => {
      const id = state.fresh('vertex');
      state.vertices.push({ ...source, id, position: V.mad(source.position, op.step, i) });
      return id;
    });
    return { document: result(doc, state), diagnosticLineage:state.lineage,evidence: { copies: op.count } };
  }

  function mirror(doc, op, _target, diagnostics) {
    repeatBudget(doc, 2);
    const { origin = [0, 0, 0], tolerance = .000001, weld = true } = op;
    const axis = unit(op.normal, 'Mirror normal'), state = copies(doc, op, diagnostics);
    const dist = new Map(doc.vertices.map(row => [row.id, V.dot(V.sub(row.position, origin), axis)]));
    const seam = new Set(weld ? [...dist].filter(([, d]) => Math.abs(d) <= tolerance).map(([id]) => id) : []);
    if (weld && [...dist.values()].some(d => d > tolerance) && [...dist.values()].some(d => d < -tolerance))
      throw new RangeError('A welded mirror needs a cage on one side of its mirror plane');
    const faces = doc.faces.filter(face => !face.corners.every(row => seam.has(row.vertex)));
    if (!faces.length) throw new RangeError('Mirror would leave no faces outside the weld plane');
    const used = new Set(faces.flatMap(face => face.corners.map((row, i) =>
      meshCutGeometry.pair(row.vertex, face.corners[(i + 1) % face.corners.length].vertex))));
    const edges = doc.edges.filter(row => used.has(meshCutGeometry.pair(...row.vertices)));
    state.faces = [...faces];
    state.edges = [...edges];
    state.vertices = state.vertices.map(row => seam.has(row.id) && dist.get(row.id) !== 0 ?
      { ...row, position: V.mad(row.position, axis, -dist.get(row.id)) } : row);
    copy({ ...doc, faces, edges }, state, source => {
      if (seam.has(source.id)) return source.id;
      const id = state.fresh('vertex');
      state.vertices.push({ ...source, id, position: V.mad(source.position, axis, -2 * dist.get(source.id)) });
      return id;
    }, n => V.mad(n, axis, -2 * V.dot(n, axis)), true, op.flipU);
    const document = result(doc, state);
    if (seam.size) for (const edge of topology.inspect(document).edges) {
      if (edge.vertices.every(id => seam.has(id)) && edge.uses.length > 2)
        throw new RangeError('Welded mirror would create a non-manifold seam at ' + edge.id);
    }
    return { document, diagnosticLineage:state.lineage,
      evidence: { weldedVertices: seam.size, removedPlaneFaces: doc.faces.length - faces.length } };
  }

  function convexEdges(doc) {
    const g = retainedMeshHealth.incidence(doc), normals = new Map();
    const at = id => g.vertices.get(id).position;
    function normal(id) {
      if (!normals.has(id)) normals.set(id, V.norm(meshFaceRegionGeometry.area(g.faces.get(id).corners.map(c => at(c.vertex)))));
      return normals.get(id);
    }
    return g.edges.flatMap(edge => {
      if (edge.uses.length !== 2 || retainedMeshHealth.crossesWinding(...edge.uses, g.corners)) return [];
      const [a, b] = edge.uses;
      const axis = V.norm(V.sub(at(g.corners.get(a.to).vertex), at(g.corners.get(a.from).vertex)));
      return V.dot(normal(a.face), V.cross(axis, normal(b.face))) < -1e-6 ? [edge.id] : [];
    });
  }

  function bevel(doc, { id, edges, enabled, kind, protect, ...settings }) {
    const ids = edges ?? convexEdges(doc);
    if (!ids.length) return { document: doc, evidence: { edges: [] } };
    const selection = topology.select(doc, { domain: 'edges', ids });
    const planned = topology.planBevel(doc, { id, revision: revision(doc), bevel: { ...settings, selection },
      ...(protect && { protect }) });
    return checked(planned);
  }

  function shell(doc, { id, faces, thickness, rim, interior, minWall }) {
    const selection = topology.select(doc, { domain: 'faces', ids: faces });
    const planned = topology.planFaceRegion(doc, { id, revision: revision(doc), selection,
      operation: { kind: 'thicken', distance: thickness },
      ...(rim && { rim }), ...(interior && { interior }), ...(minWall !== undefined && { minWall }) });
    return checked(planned);
  }

  function checked(plan) {
    if (!plan.report.canCommit) throw Object.assign(new RangeError(plan.report.issues.map(row =>
      row.message ?? row.kind).join(', ')), { report: plan.report });
    const evidence = Object.fromEntries(['kind', 'faces', 'issues', 'regions', 'protection', 'edges', 'wall']
      .filter(field => Object.hasOwn(plan.report, field)).map(field => [field, plan.report[field]]));
    return { document: plan.document, lineage: plan.patch.lineage, evidence };
  }

  function projection(doc, op, resolve) {
    const target = resolve?.(op.target);
    if (!target) throw new RangeError('Unknown projection target ' + op.target);
    const direction = unit(op.direction, 'Projection direction'), reverse = V.mul(direction, -1);
    const trace = K.sceneMeshes.rayQuery(topology.toSceneMesh(target), K);
    const vertices = new Map(doc.vertices.map(row => [row.id, row]));
    const ids = op.vertices ?? [...vertices.keys()], misses = [], changes = [];
    const epsilon = Math.min(.000001, op.distance * .0001);
    function cast(p, direction) {
      return trace({ origin: V.mad(p, direction, -epsilon), direction, maxDistance: op.distance + epsilon });
    }
    for (const id of ids) {
      const row = vertices.get(id);
      if (!row) throw new RangeError('Unknown projection vertex ' + id);
      const a = cast(row.position, direction), b = op.bidirectional && cast(row.position, reverse);
      const hit = b && (!a || b.distance < a.distance) ? b : a;
      if (!hit) { misses.push(id); continue; }
      const position = V.mad(hit.point, hit.normal, op.offset ?? 0);
      if (V.dist(position, row.position) > epsilon) changes.push({ ...row, position });
    }
    if (op.miss === 'error' && misses.length) throw new RangeError('Projection missed ' + misses.length + ' vertices on ' + op.target);
    return { document: changes.length ? topology.edit(doc, { vertices: changes }) : doc,
      evidence: { target: op.target, targetRevision: revision(topology.create(target)), checked: ids.length, moved: changes.length,
        missed: misses.length, samples: misses.slice(0, 64) } };
  }

  return { validate, array, mirror, bevel, shell, projection };
})(KIT);
