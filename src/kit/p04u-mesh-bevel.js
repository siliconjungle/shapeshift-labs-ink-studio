/* Geometric bevels retain authored surfaces and publish an inspectable patch. */
(function (K) {
  const { meshTopology: topology, V, procedural: { data: { freeze, clone } } } = K;
  const { context, selection, pair } = meshEdgeFlowData;
  const { settings, edgePlan, cornerPlan } = meshBevelPlanes;
  const { pool, clip, patch: delta } = meshBevelClip;

  function lineage(g, state, document, detail, plans) {
    const features = new Map(detail.map(row => [row.face, row]));
    const plan = new Map(plans.map(row => [row.edge, row]));
    const edges = new Set(g.edges.map(row => row.id));
    const links = [];
    for (const edge of topology.inspect(document).edges) {
      if (edges.has(edge.id)) continue;
      const parents = new Set(edge.vertices.flatMap(id => state.ancestry.get(id)?.map(([id]) => id) ?? [id]));
      if (parents.size === 2) {
        const prior = g.byEnds.get(pair(...parents));
        if (prior) links.push({ from: prior.id, to: edge.id });
      }
      for (const use of edge.uses) {
        const feature = features.get(use.face), authored = feature && plan.get(feature.id);
        if (!authored || !edge.uses.some(other => authored.faces.includes(other.face))) continue;
        const [a, b] = edge.vertices.map(id => state.vertices.get(id).position), axis = V.sub(b, a);
        if (Math.abs(V.dot(axis, authored.axis)) >= .99999 * V.len(axis)) links.push({ from: authored.edge, to: edge.id });
      }
    }
    const ids = new Map(links.map(row => [JSON.stringify([row.from, row.to]), row]));
    return [...ids.values()];
  }

  function planBevel(source, request) {
    const doc = topology.create(source);
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key => !['id', 'revision', 'bevel', 'protect', 'tolerance'].includes(key)))
      throw new TypeError('Use a bevel ID, mesh revision, and bevel settings');
    const { id, revision, bevel, protect, tolerance = .0000001 } = request;
    if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('Use a positive bevel tolerance');
    const g = context(doc, { id, revision });
    const edges = selection(g, bevel?.selection), rules = meshBevelProtection.settings(doc, protect);
    const config = settings(bevel, edges, tolerance);
    const plans = edges.map(edge => edgePlan(g, edge, config));
    const state = pool(g), issues = [], used = new Map(), atVertex = new Map();
    const passes = plans.reduce((sum, row) => sum + row.planes.length, 0);
    if (passes > 512 || passes * doc.faces.length > 8000000) throw new RangeError('Bevel exceeds the plane and mesh work budget');

    for (const row of plans) if (row.planes.length) for (const id of row.ends) {
      if (!used.has(id)) used.set(id, []);
      used.get(id).push(row);
    }
    if (config.join === 'patch') for (const face of doc.faces) for (const { vertex } of face.corners) {
      if (!used.has(vertex)) continue;
      if (!atVertex.has(vertex)) atVertex.set(vertex, []);
      atVertex.get(vertex).push(face.id);
    }
    let document = doc, patch = {}, detail = [], health = null, protection = null;
    try {
      for (const row of plans) {
        let added = false;
        for (const plane of row.planes) if (clip(g, state, plane, tolerance)) added = true;
        if (row.planes.length && !added) throw new RangeError('Earlier bevels consumed selected edge ' + row.edge);
      }
      if (config.join === 'patch') for (const [id, edges] of used) if (edges.length >= 2) {
        const plane = cornerPlan(g, state, id, edges, config, atVertex);
        if (plane) clip(g, state, plane, tolerance);
      }
      ({ patch, detail } = delta(doc, state));
      if (patch.faces?.length) document = topology.edit(doc, patch);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      document = null;
      issues.push({ kind: 'invalid-bevel', message: error.message });
    }
    if (document) {
      if (patch.faces?.length) {
        const selected = topology.select(document, { domain: 'faces', ids: patch.faces.map(row => row.id) });
        health = topology.health(document, { selection: selected, duplicateDistance: 0, sliverQuality: 0, limit: 32 });
        if (health.counts.selfIntersections || health.counts.nonManifold || health.counts.winding)
          issues.push({ kind: 'surface-contact', counts: health.counts });
        if (!health.work.intersectionsComplete) issues.push({ kind: 'check-budget' });
        const links = lineage(g, state, document, detail, plans);
        if (links.length) patch.lineage = { edges: links };
      }
      protection = meshBevelProtection.evaluate(doc, document, patch, rules, tolerance);
      if (protection.faces.length) issues.push({ kind: 'protected-face', faces: protection.faces });
      if (protection.paint.some(row => !row.retained)) issues.push({ kind: 'protected-paint' });
      if (protection.gaps.some(row => !row.retained)) issues.push({ kind: 'protected-gap' });
    }
    const report = { format: 'ink-studio/mesh-bevel', version: 1, mesh: doc.id, request: clone(request),
      beforeRevision: topology.revision(doc), afterRevision: document && topology.revision(document),
      canCommit: !issues.length, issues, health, protection, faces: detail,
      edges: plans.map(({ edge, weight, width }) => ({ edge, weight, width })),
      vertices: (patch.vertices ?? []).map(({ id }) => ({ id, sources: state.ancestry.get(id) })),
      attributeConflicts: [...state.conflicts].sort(), lineage: patch.lineage ?? null };
    return freeze({ document, patch, report });
  }

  K.meshTopology = Object.freeze({ ...topology, planBevel });
})(KIT);
