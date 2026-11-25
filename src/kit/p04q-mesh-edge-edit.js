/* Checked edge edits use the ordinary retained-topology patch and receipt. */
(function (K) {
  const { meshTopology: topology, V, procedural: { data: { clone, freeze } } } = K;
  const { pair, context, index } = meshEdgeFlowData;
  const { area } = meshFaceRegionGeometry;
  const operations = { 'insert-loop': meshEdgeLoops.insert, 'split-face': meshPickedSplit.split,
    'subdivide-face': meshFaceGrid.subdivide, 'subdivide-texels': meshTexelGrid.subdivide, slide: meshEdgeLoops.slide,
    bridge: meshEdgeSurfaces.bridge, 'grid-fill': meshEdgeSurfaces.grid };

  function flipped(doc, document, affected) {
    const before = index(doc.vertices), after = index(document.vertices), faces = index(doc.faces);
    return affected.filter(id => {
      const corners = faces.get(id).corners;
      const normal = pool => area(corners.map(({ vertex }) => pool.get(vertex).position.map(Math.fround)));
      return V.dot(normal(before), normal(after)) <= 0;
    });
  }

  function planEdgeEdit(source, request, settings) {
    const doc = topology.create(source), g = context(doc, request), kind = request.operation?.kind;
    if (!Object.hasOwn(operations, kind)) throw new TypeError('Choose insert-loop, split-face, subdivide-face, subdivide-texels, slide, bridge, or grid-fill');
    const { patch, affected, detail, cuts, lineage, issues = [] } = operations[kind](g, request.operation, settings);
    let document = doc;
    if (Object.keys(patch).length) {
      try { document = topology.edit(doc, patch); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        document = null;
        issues.push({ kind: 'invalid-polygon', message: error.message });
      }
    }
    if (document && cuts) {
      const edges = new Map(document.edges.map(edge => [pair(...edge.vertices), edge.id]));
      lineage.edges = cuts.flatMap(({edge,at,ends,chain})=>{
        if (!chain) return ends.map(id=>({from:edge,to:edges.get(pair(id,at))}));
        return chain.slice(1).map((id,i)=>({from:edge,to:edges.get(pair(chain[i],id))}));
      });
      patch.lineage = lineage;
    }
    let health = null;
    if (document && affected.length) {
      const selection = topology.select(document, { domain: 'faces', ids: affected });
      health = topology.health(document, { selection, duplicateDistance: 0, sliverQuality: 0, limit: 32 });
      if (health.counts.selfIntersections || health.counts.nonManifold || health.counts.winding)
        issues.push({ kind: 'surface-contact', counts: health.counts });
      if (!health.work.intersectionsComplete) issues.push({ kind: 'check-budget' });
      if (kind === 'slide') {
        const faces = flipped(doc, document, affected);
        if (faces.length) issues.push({ kind: 'flipped-faces', faces });
      }
    }
    const report = { format: 'ink-studio/mesh-edge-edit', version: 1, mesh: doc.id, kind, request: clone(request),
      beforeRevision: topology.revision(doc), afterRevision: document && topology.revision(document),
      canCommit: !issues.length, issues, health, affected, detail, lineage: patch.lineage ?? null };
    return freeze({ document, patch, report });
  }

  K.meshTopology = Object.freeze({ ...topology, planEdgeEdit });
})(KIT);
