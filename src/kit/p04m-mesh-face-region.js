/* Apply face operations with retained paint coordinates and element lineage. */
(function (K) {
  const { V, meshTopology: topology, procedural: { data: { freeze, clone } } } = K;
  const { pair, record, unit } = meshCutGeometry;
  const { area, regions, displacement, planarUV } = meshFaceRegionGeometry;
  const { swept, walls } = meshFaceRegionClearance;
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const validName = value => typeof value === 'string' && Boolean(value.trim());
  const positive = value => Number.isFinite(value) && value > 0;

  function settings(doc, request) {
    if (!record(request, ['id', 'revision', 'selection', 'operation', 'rim', 'interior', 'minWall', 'tolerance']) ||
        typeof request.id !== 'string' || !/^[\w.-]{1,96}$/.test(request.id))
      throw new TypeError('Face-region edit needs an operation ID, revision, and saved face selection');
    if (request.revision !== topology.revision(doc)) throw new RangeError('Stale mesh face-region revision');
    if (request.selection?.domain !== 'faces') throw new TypeError('Face-region edit needs a saved face selection');
    const selection = topology.select(doc, { from: request.selection });
    if (!selection.ids.length) throw new RangeError('Select at least one face');
    const { operation, rim = {}, interior = {}, minWall, tolerance = .000001 } = request;
    if (!record(operation, ['kind', 'distance', 'direction']) || !['extrude', 'inset', 'thicken'].includes(operation.kind) ||
        !Number.isFinite(operation.distance) || (operation.kind !== 'extrude' && operation.distance <= 0) ||
        operation.direction !== undefined && operation.kind !== 'extrude' ||
        !positive(tolerance) || Math.abs(operation.distance) <= tolerance ||
        minWall !== undefined && !positive(minWall))
      throw new TypeError('Use a signed extrusion distance or a positive inset or shell distance, above tolerance');
    if (!record(rim, ['uv', 'material']) || !record(interior, ['uv', 'material']) ||
        rim.uv !== undefined && !['strip', 'per-edge'].includes(rim.uv) ||
        interior.uv !== undefined && !['preserve', 'planar'].includes(interior.uv) ||
        [rim.material, interior.material].some(value => value !== undefined && !validName(value)))
      throw new TypeError('Use strip or per-edge rim UVs and preserve or planar interior UVs, with optional material IDs');
    return { selection, kind: operation.kind, distance: operation.distance, rim, interior, tolerance,
      minWall: minWall ?? Math.max(tolerance * 4, Math.abs(operation.distance) * .05),
      direction: operation.direction === undefined ? undefined : unit(operation.direction, 'Extrusion direction') };
  }

  function identifiers(doc, id) {
    const used = new Set([...doc.vertices, ...doc.edges, ...doc.faces, ...doc.faces.flatMap(face => face.corners)].map(row => row.id));
    let serial = 0;
    return kind => {
      let key;
      do { key = 'region/' + id + '/' + kind + '/' + ++serial; } while (used.has(key));
      used.add(key);
      return key;
    };
  }

  function assemble(doc, config, fresh) {
    const graph = regions(doc, config.selection, config.kind);
    const original = id => graph.vertices.get(id).position;
    const originalFaces = index(doc.faces);
    const vertexRows = [], faceRows = [], moves = [], sourceOf = new Map(), affected = [], inverted = [];
    const translations = new Map();
    const lineage = { faces: [], corners: [], edges: [] };
    const shell = config.kind === 'thicken';

    for (const region of graph.regions) {
      const { offsets, normals } = displacement(region, original, config);
      const boundary = new Set(region.loops.flatMap(loop => loop.map(edge => edge.a.vertex)));
      const raised = new Map(), lift = id => raised.get(id).position;
      for (const [from, offset] of offsets) {
        const id = shell || boundary.has(from) ? fresh('vertex') : from;
        const source = graph.vertices.get(from);
        const row = { ...source, id, position: V.add(source.position, offset) };
        raised.set(from, row);
        if (id !== from) sourceOf.set(id, from);
        if (id !== from || offset.some(Boolean)) vertexRows.push(row);
        if (V.len(offset) > config.tolerance) moves.push({ vertex: from, start: source.position, end: row.position });
      }
      const group = { sourceFaces: region.faces.map(face => face.id), rimFaces: [], interiorFaces: [],
        boundaries: region.loops.map(loop => loop.map(({ edge }) => edge)) };
      for (const face of region.faces) {
        const points = face.corners.map(corner => lift(corner.vertex)), normal = normals.get(face.id);
        const folded = face.corners.some(({ vertex }, i) => {
          const next = face.corners[(i + 1) % points.length].vertex;
          return V.dot(V.sub(original(next), original(vertex)), V.sub(points[(i + 1) % points.length], points[i])) <= 0;
        });
        if (folded || V.dot(normal, area(points)) <= config.tolerance ** 2) inverted.push(face.id);
        if (config.kind === 'extrude') translations.set(face.id, offsets.get(face.corners[0].vertex));
        const uvs = config.interior.uv === 'planar' ? planarUV(points, normal) : null;
        const id = shell ? fresh('interior') : face.id;
        const corners = face.corners.map((corner, i) => {
          const id = shell ? fresh('corner') : corner.id;
          if (shell) lineage.corners.push({ from: corner.id, to: id });
          return { ...corner, id, vertex: raised.get(corner.vertex).id, uv: uvs?.[i] ?? corner.uv };
        });
        if (shell) {
          corners.reverse();
          lineage.faces.push({ from: face.id, to: id });
        }
        faceRows.push({ id, material: config.interior.material ?? face.material, corners });
        group.interiorFaces.push(id);
      }
      for (const loop of region.loops) {
        const lengths = loop.map(({ a, b }) => V.dist(original(a.vertex), original(b.vertex)));
        const total = lengths.reduce((sum, length) => sum + length, 0);
        let length = 0;
        for (const [i, { a, b, face }] of loop.entries()) {
          const strip = config.rim.uv !== 'per-edge';
          const u = strip ? length / total : 0;
          length += lengths[i];
          const v = strip ? length / total : 1;
          const id = fresh('rim'), list = [
            [a, a.vertex, [u, 0]], [b, b.vertex, [v, 0]],
            [b, raised.get(b.vertex).id, [v, 1]], [a, raised.get(a.vertex).id, [u, 1]]
          ];
          if (shell) list.reverse();
          const corners = list.map(([corner, vertex, uv]) => ({
            id: fresh('corner'), vertex, uv, ...(corner.attributes && { attributes: corner.attributes })
          }));
          faceRows.push({ id, material: config.rim.material ?? originalFaces.get(face).material, corners });
          group.rimFaces.push(id);
        }
      }
      affected.push(group);
    }
    return { vertexRows, faceRows, moves, affected, lineage, inverted, sourceOf, translations };
  }

  function planFaceRegion(source, request) {
    const doc = topology.create(source), config = settings(doc, request), fresh = identifiers(doc, request.id);
    const { vertexRows, faceRows, moves, affected, lineage, inverted, sourceOf, translations } = assemble(doc, config, fresh);
    const patch = { vertices: vertexRows, faces: faceRows };
    let document = null, invalid = null;
    try {
      document = topology.edit(doc, patch);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      invalid = error.message;
    }
    const regionFaces = faceRows.map(face => face.id), scope = document &&
      topology.select(document, { domain: 'faces', ids: regionFaces });
    const health = document && topology.health(document, { selection: scope, duplicateDistance: 0, sliverQuality: 0,
      intersectionTolerance: config.tolerance, limit: 32 });
    const wall = document && walls(document, regionFaces, config.minWall, config.tolerance);
    const sweep = config.kind === 'inset' ? null : swept(doc, moves,
      new Set(config.kind === 'thicken' ? [] : config.selection.ids), translations, config.tolerance);
    const issues = [];
    if (invalid) issues.push({ kind: 'invalid-polygon', message: invalid });
    if (inverted.length) issues.push({ kind: 'flipped-region', faces: inverted });
    if (health && (health.counts.selfIntersections || health.counts.nonManifold || health.counts.winding))
      issues.push({ kind: 'surface-contact', counts: health.counts });
    if (wall?.counts || config.kind === 'thicken' && config.distance + config.tolerance < config.minWall)
      issues.push({ kind: 'thin-wall', requested: config.minWall, closest: wall?.closest ?? null });
    if (sweep?.count) issues.push({ kind: 'swept-contact', count: sweep.count });
    if (health && !health.work.intersectionsComplete || wall && !wall.complete || sweep && !sweep.complete)
      issues.push({ kind: 'check-budget' });

    if (document) {
      const edges = new Map(doc.edges.map(edge => [pair(...edge.vertices), edge.id]));
      for (const edge of document.edges) {
        const from = edges.get(pair(...edge.vertices.map(id => sourceOf.get(id) ?? id)));
        if (from && from !== edge.id) lineage.edges.push({ from, to: edge.id });
      }
    }
    if (Object.values(lineage).some(rows => rows.length)) patch.lineage = lineage;
    const report = {
      format: 'ink-studio/mesh-face-region', version: 1, mesh: doc.id, kind: config.kind, request: clone(request),
      beforeRevision: topology.revision(doc), afterRevision: document && topology.revision(document),
      canCommit: !issues.length, issues, regions: affected, health, wall, sweep,
      vertices: [...sourceOf].map(([id, from]) => ({ id, from })), lineage
    };
    return freeze({ document, patch, report });
  }

  K.meshTopology = Object.freeze({ ...topology, planFaceRegion });
})(KIT);
