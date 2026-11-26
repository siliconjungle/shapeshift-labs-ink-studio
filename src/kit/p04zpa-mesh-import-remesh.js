/* Pair compatible triangles without moving the source surface or crossing features. */
(function (K) {
  const topology = K.meshTopology, { V } = K;
  const { spatial, data: { freeze } } = K.procedural;
  const { incidence } = retainedMeshHealth;
  const { record, pair: edgeKey } = meshCutGeometry;
  const { prepareTriangleJoin } = retainedMeshRepair;

  function mirrorPairs(vertices, { axis, plane = 0, tolerance = .000001 }, maxChecks) {
    const k = ['x', 'y', 'z'].indexOf(axis);
    if (k < 0 || !Number.isFinite(plane) || !Number.isFinite(tolerance) || tolerance <= 0)
      throw new TypeError('Symmetry needs an XYZ axis, finite plane and positive tolerance');
    const tree = spatial.pointIndex(vertices.map(row => ({ row, bounds: spatial.boxOf([row.position]) })));
    const nearest = new Map();
    let checks = 0, complete = true;
    for (const row of vertices) {
      const point = row.position.map((n, i) => i === k ? 2 * plane - n : n);
      let best = tolerance, name = null, tied = false;
      complete = tree.box(spatial.expand(spatial.boxOf([point]), tolerance), ({ row: candidate }) => {
        if (checks >= maxChecks) return false;
        checks++;
        const distance = V.dist(point, candidate.position);
        if (distance > tolerance) return;
        if (name === null || distance < best - 1e-12) { best = distance; name = candidate.id; tied = false; }
        else if (Math.abs(best - distance) <= 1e-12 && candidate.id !== name) tied = true;
      });
      if (!complete) break;
      if (name && !tied) nearest.set(row.id, name);
    }
    return { matches: new Map([...nearest].filter(([a, b]) => nearest.get(b) === a)), checks, complete };
  }

  function planPairs(doc, features, symmetry, featureAngle, maxEdgeRatio, maxChecks) {
    const g = incidence(doc), accepted = new Map(), retainedFeatures = [], unavailable = {};
    const retain = (edge, reason) => retainedFeatures.push({ id: edge.id, vertices: edge.vertices, reason });
    const skip = reason => { unavailable[reason] = (unavailable[reason] ?? 0) + 1; };
    const normal = points => V.norm(V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0])));
    const direction = new Map(doc.faces.map(row => [row.id, row.corners.map(corner => g.vertices.get(corner.vertex).position)]));
    const cutoff = Math.cos(featureAngle * Math.PI / 180);
    for (const edge of g.edges) {
      const key = edgeKey(...edge.vertices);
      if (features.edges.has(key)) { retain(edge, 'protected-edge'); continue; }
      if (edge.uses.length !== 2) { retain(edge, 'boundary'); continue; }
      const faces = edge.uses.map(use => g.faces.get(use.face));
      if (faces.some(row => features.faces.has(row.id))) { retain(edge, 'protected-face'); continue; }
      if (faces[0].material !== faces[1].material) { retain(edge, 'material-boundary'); continue; }
      if (edge.smooth === false || edge.crease > 0 || faces[0].smoothingGroup !== faces[1].smoothingGroup) {
        retain(edge, 'authored-crease'); continue;
      }
      if (faces.some(row => row.corners.length !== 3)) continue;
      const [first, second] = faces.map(row => normal(direction.get(row.id)));
      const alignment = V.dot(first, second);
      if (alignment + 1e-10 < cutoff) { retain(edge, 'feature-angle'); continue; }
      let joined;
      try { joined = prepareTriangleJoin(doc, g, edge, {}, 'match'); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        retain(edge, 'corner-channel-or-topology'); continue;
      }
      if (joined.blockers) { retain(edge, 'uv-seam'); continue; }
      const points = joined.quad.corners.map(corner => g.vertices.get(corner.vertex).position);
      const sides = points.map((point, i) => V.sub(points[(i + 1) % 4], point));
      const lengths = sides.map(side => V.len(side));
      const ratio = Math.max(...lengths) / Math.min(...lengths);
      const average = V.norm(V.add(first, second));
      const turn = Math.min(...sides.map((side, i) =>
        V.dot(V.cross(V.norm(side), V.norm(sides[(i + 1) % 4])), average)));
      if (!(turn > .04) || ratio > maxEdgeRatio) { skip('quad-shape'); continue; }
      accepted.set(key, { ...joined, key, score: turn * alignment / ratio, alignment, ratio,
        faceIds: faces.map(row => row.id), vertices: edge.vertices });
    }
    const mirrored = symmetry && mirrorPairs(doc.vertices, symmetry, maxChecks), matching = mirrored?.matches;
    const triangleKey = corners => JSON.stringify(corners.slice().sort());
    function reflected(candidate) {
      const endpoints = candidate.vertices.map(id => matching.get(id));
      if (endpoints.some(id => !id)) return;
      const partner = accepted.get(edgeKey(...endpoints));
      if (!partner) return;
      const named = (row, reflect) => row.faceIds.map(id => triangleKey(g.faces.get(id).corners.map(corner =>
        reflect ? matching.get(corner.vertex) : corner.vertex))).sort();
      if (JSON.stringify(named(candidate, true)) === JSON.stringify(named(partner, false))) return partner;
    }
    const busy = new Set(), used = new Set(), selected = [];
    const order = [...accepted.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    for (const candidate of order) {
      if (used.has(candidate.key)) continue;
      const partner = symmetry && reflected(candidate);
      if (symmetry && !partner) { skip('no-mirrored-quad'); continue; }
      const group = partner && partner !== candidate ? [candidate, partner] : [candidate];
      const ids = group.flatMap(row => row.faceIds);
      if (new Set(ids).size !== ids.length || ids.some(id => busy.has(id))) { skip('overlapping-pair'); continue; }
      for (const [i, row] of group.entries()) {
        used.add(row.key);
        selected.push({ ...row, ...(partner && { mirror: group[1 - i]?.effect.keep ?? row.effect.keep }) });
      }
      ids.forEach(id => busy.add(id));
    }
    return { selected, retainedFeatures, unavailable, candidates: accepted.size,
      ...(matching && { symmetry: { ...symmetry, maxChecks, checks: mirrored.checks, complete: mirrored.complete,
        matchedVertices: matching.size,
        unmatchedVertices: doc.vertices.filter(row => !matching.has(row.id)).map(row => row.id) } }) };
  }

  function remeshImported(source, options = {}) {
    if (!record(options, ['weld', 'protected', 'quads', 'symmetry', 'featureAngle', 'maxEdgeRatio',
      'materials', 'transfer', 'maxChecks'])) throw new TypeError('Use imported mesh retopology settings');
    const { quads = true, symmetry, featureAngle = 22, maxEdgeRatio = 5, materials = [], transfer, maxChecks = 250000 } = options;
    if (typeof quads !== 'boolean' || symmetry !== undefined && !record(symmetry, ['axis', 'plane', 'tolerance']) ||
        !Number.isFinite(featureAngle) || featureAngle < 0 || featureAngle > 85 ||
        !Number.isFinite(maxEdgeRatio) || maxEdgeRatio < 1 || maxEdgeRatio > 100 ||
        !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 2000000)
      throw new RangeError('Use valid mesh feature, symmetry and checking limits');
    const imported = source?.format !== 'ink-studio/mesh-topology';
    const cleaned = imported ? topology.repairImported(source, { weld: options.weld, protected: options.protected }) : null;
    const before = imported ? cleaned.document : topology.create(source);
    const issues = [...(cleaned?.report.issues ?? [])];
    const report = { format: 'ink-studio/imported-mesh-retopology', version: 1,
      repair: cleaned?.report ?? null, issues, canCommit: false };
    if (!before || issues.length) return freeze({ repaired: before, document: null, report });
    const features = meshImportRepair.featureIds(options.protected, new Set(before.vertices.map(row => row.id)),
      new Set(before.faces.map(row => row.id)));
    const available = new Set(before.edges.map(row => edgeKey(...row.vertices)));
    for (const key of features.edges) if (!available.has(key)) throw new RangeError('Protected edge is not a mesh boundary');
    const pairs = quads ? planPairs(before, features, symmetry, featureAngle, maxEdgeRatio, maxChecks) :
      { selected: [], retainedFeatures: [], unavailable: {}, candidates: 0 };
    if (pairs.symmetry?.complete === false) issues.push({ kind: 'symmetry-check-budget' });
    const { selected, ...checks } = pairs;
    const lineage = { faces: selected.flatMap(row => row.links.faces), corners: selected.flatMap(row => row.links.corners) };
    const candidate = selected.length ? topology.edit(before, { faces: selected.map(row => row.quad),
      removeFaces: selected.map(row => row.effect.removedFace) }) : before;
    const health = topology.health(candidate, { maxPairs: maxChecks, duplicateDistance: 0, sliverQuality: 0, limit: 64 });
    for (const kind of ['nonManifold', 'winding', 'selfIntersections'])
      if (health.counts[kind]) issues.push({ kind, count: health.counts[kind] });
    if (!health.work.intersectionsComplete) issues.push({ kind: 'intersection-check-budget' });
    const correspondence = topology.correspond(before, candidate, { lineage });
    let materialTransfer, attachmentTransfer;
    if (!issues.length) {
      materialTransfer = topology.transferMaterials(before, candidate, correspondence, { materials });
      if (!materialTransfer.report.complete) issues.push({ kind: 'material-transfer', count: materialTransfer.report.issues.length });
      if (transfer !== undefined) {
        attachmentTransfer = topology.transferAttachments(before, candidate, correspondence, transfer);
        if (!attachmentTransfer.report.canCommit)
          issues.push({ kind: 'attachment-transfer', count: attachmentTransfer.report.issues.length });
      }
    }
    const weights = before.vertices.filter(row => row.weights).length;
    if (attachmentTransfer && candidate.skin) {
      const effective = new Map(topology.skin.inspect(candidate).vertices.map(row => [row.id, row.effective]));
      for (const { id, after } of attachmentTransfer.report.weights) {
        const retained = effective.get(id);
        if (!retained || [...new Set([...Object.keys(retained), ...Object.keys(after)])]
          .some(joint => Math.abs((retained[joint] ?? 0) - (after[joint] ?? 0)) > 1e-8))
          issues.push({ kind: 'retained-weights-differ-from-tested-weights', vertex: id });
      }
    }
    Object.assign(report, { beforeRevision: topology.revision(before), afterRevision: topology.revision(candidate),
      quads: candidate.faces.filter(row => row.corners.length === 4).length,
      triangles: candidate.faces.filter(row => row.corners.length === 3).length,
      facesBefore: before.faces.length, facesAfter: candidate.faces.length, ...checks,
      pairs: selected.map(row => ({ edge: row.effect.edge, from: row.faceIds, to: row.effect.keep, diagonal: row.effect.diagonal,
        normalDot: row.alignment, edgeRatio: row.ratio, ...(row.mirror && { mirror: row.mirror }) })),
      health, preservation: { retainedVertexIds: candidate.vertices.length, authoredWeightRows: weights,
        pigmentCorners: candidate.faces.reduce((count, row) => count + row.corners.filter(corner => corner.attributes?.pigmentRgb).length, 0),
        material: materialTransfer?.report ?? null, attachments: attachmentTransfer?.report ?? null },
      canCommit: !issues.length });
    return freeze({ repaired: before, document: report.canCommit ? candidate : null, correspondence, report,
      ...(report.canCommit && { materials: materialTransfer?.materials ?? [], attachments: attachmentTransfer ?
        topology.attachments.create(candidate, attachmentTransfer.attachments.attachments) : null }) });
  }

  K.meshTopology = Object.freeze({ ...topology, remeshImported });
})(KIT);
