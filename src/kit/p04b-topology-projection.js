/* Bounded projection for topology revisions. A match needs support in both directions. */
const projectMeshTopology = (() => {
  const cutoff = {};
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function settings(raw = {}) {
    const { maxDistance, minNormalDot = .8, maxUVDistance = .05, minConfidence = .5, ambiguity = .05, maxChecks = 250000 } = raw ?? {};
    const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
    if (!Number.isFinite(maxDistance) || maxDistance <= 0 || !unit(minNormalDot) || !unit(maxUVDistance) ||
        !unit(minConfidence) || !unit(ambiguity) || !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 2000000)
      throw new RangeError('Projection needs a positive maxDistance and valid confidence, alignment, UV and work limits');
    return { maxDistance, minNormalDot, maxUVDistance, minConfidence, ambiguity, maxChecks };
  }

  function ranked(rows, key) {
    const byId = new Map();
    for (const row of rows) {
      const id = row[key];
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(row);
    }
    const other = key === 'from' ? 'to' : 'from';
    for (const list of byId.values()) list.sort((a, b) => b.confidence - a.confidence || order(a[other], b[other]));
    return byId;
  }

  function create(K, raw) {
    const options = settings(raw), { maxDistance, minNormalDot, maxUVDistance, minConfidence, ambiguity, maxChecks } = options;
    const { V, procedural: { spatial, geometry } } = K;
    const work = { checks: 0, complete: true };
    const check = () => {
      if (work.checks >= maxChecks) throw cutoff;
      work.checks++;
    };
    const score = (distance, alignment = 1, uv = 0) => .99 * Math.max(0, 1 - distance / maxDistance) *
      alignment * (maxUVDistance ? 1 - .5 * uv / maxUVDistance : 1);

    function sample(row, target) {
      let max = 0, minDot = 1, count = 0, nearest;
      for (const probe of row.probes) {
        let best;
        for (const triangle of target.triangles) {
          check();
          const alignment = V.dot(probe.normal, triangle.normal);
          if (alignment < minNormalDot) continue;
          const { at, weights } = geometry.closestTrianglePoint(probe.point, triangle);
          const distance = V.dist(probe.point, at);
          if (distance <= maxDistance && (!best || distance < best.distance)) {
            best = { point: probe.point, projectedPoint: at, distance, alignment: Math.min(1, alignment),
              triangle: triangle.corners, barycentric: weights };
          }
        }
        if (!best) return null;
        if (!nearest || best.distance > max) nearest = best;
        max = Math.max(max, best.distance);
        minDot = Math.min(minDot, best.alignment);
        count++;
      }
      return { samples: count, maxDistance: max, minNormalDot: minDot, farthest: nearest };
    }

    function face(from, to) {
      if (from.material !== to.material) return null;
      const forward = sample(from, to);
      const reverse = forward && sample(to, from);
      if (!reverse) return null;
      const distance = Math.max(forward.maxDistance, reverse.maxDistance);
      const normalDot = Math.min(forward.minNormalDot, reverse.minNormalDot);
      return { confidence: score(distance, normalDot),
        evidence: { method: 'projected-surface', forward, reverse } };
    }

    function edge(from, to) {
      if (from.context !== to.context) return null;
      const [a, b] = from.points, [c, d] = to.points;
      const u = V.sub(b, a), v = V.sub(d, c);
      const alignment = Math.min(1, Math.abs(V.dot(u, v) / (V.len(u) * V.len(v))));
      if (!(alignment >= minNormalDot)) return null;
      const measure = (point, start, delta) => {
        const parameter = Math.max(0, Math.min(1, V.dot(V.sub(point, start), delta) / V.dot(delta, delta)));
        return { parameter, distance: V.dist(point, V.mad(start, delta, parameter)) };
      };
      const forward = [measure(a, c, v), measure(b, c, v)], reverse = [measure(c, a, u), measure(d, a, u)];
      const distance = Math.max(...forward.map(row => row.distance), ...reverse.map(row => row.distance));
      return distance <= maxDistance && { confidence: score(distance, alignment),
        evidence: { method: 'projected-segment', forward, reverse, alignment, maxDistance: distance } };
    }

    function corner(from, to, relatedFaces) {
      if (!relatedFaces.has(from.face, to.face)) return null;
      const distance = V.dist(from.points[0], to.points[0]), uvDistance = Math.hypot(...from.uv.map((v, i) => v - to.uv[i]));
      return distance <= maxDistance && uvDistance <= maxUVDistance && { confidence: score(distance, 1, uvDistance),
        evidence: { method: 'projected-corner', distance, uvDistance, fromFace: from.face, toFace: to.face,
          fromPoint: from.points[0], toPoint: to.points[0] } };
    }

    function match(domain, sources, targets, mapped, faces) {
      if (!work.complete) return null;
      const left = [...sources.values()].filter(row => !mapped.from.has(row.id));
      const right = [...targets.values()].filter(row => !mapped.to.has(row.id));
      if (!left.length || !right.length) return [];
      const lookup = spatial.pointIndex(right.map(row => ({ row, bounds: spatial.expand(spatial.boxOf(row.points), maxDistance) })));
      const compare = domain === 'faces' ? face : domain === 'edges' ? edge : corner;
      const candidates = [];
      try {
        for (const from of left) lookup(from.points[0], ({ row: to }) => {
          check();
          const result = compare(from, to, faces);
          if (result) candidates.push({ from: from.id, to: to.id, ...result });
        });
      } catch (error) {
        if (error !== cutoff) throw error;
        work.complete = false;
        return null;
      }
      const forward = ranked(candidates, 'from'), reverse = ranked(candidates, 'to');
      const unresolved = [];
      const unique = rows => rows.length < 2 || rows[0].confidence - rows[1].confidence > ambiguity;
      for (const [id, rows] of forward) {
        const best = rows[0], back = reverse.get(best.to);
        if (best.confidence >= minConfidence && unique(rows) && unique(back) && back[0].from === id) {
          mapped.add(best.from, best.to, best.evidence, best.confidence);
        }
      }
      for (const [side, ranking, key] of [['from', forward, 'to'], ['to', reverse, 'from']]) {
        for (const [id, rows] of ranking) {
          if (mapped[side].has(id)) continue;
          unresolved.push({ side, id, reason: rows[0].confidence < minConfidence ? 'low-confidence' : unique(rows) ? 'non-reciprocal' : 'ambiguous',
            candidates: rows.slice(0, 4).map(row => ({ id: row[key], confidence: row.confidence, evidence: row.evidence })) });
        }
      }
      return unresolved;
    }

    return { match, report: () => ({ ...options, ...work }) };
  }

  return create;
})();
