/* Bounded clearance checks against the same triangles used for drawing. */
const meshFaceRegionClearance = (function (K) {
  const { V, meshTopology: topology, procedural: { spatial } } = K;
  const clamp = value => Math.max(0, Math.min(1, value));
  const edges = points => points.map((p, i) => [p, points[(i + 1) % 3]]);

  function closestSegments([a, b], [c, d]) {
    const u = V.sub(b, a), v = V.sub(d, c), w = V.sub(a, c);
    const uu = V.dot(u, u), vv = V.dot(v, v), uv = V.dot(u, v);
    const uw = V.dot(u, w), vw = V.dot(v, w), det = uu * vv - uv ** 2;
    let s = det > uu * vv * 1e-12 ? clamp((uv * vw - vv * uw) / det) : 0;
    const t = clamp((uv * s + vw) / vv);
    s = clamp((uv * t - uw) / uu);
    return [V.mad(a, u, s), V.mad(c, v, t)];
  }

  function triangles(doc) {
    const { positions, indices, triangleSources } = topology.triangulate(doc);
    const vertexOf = new Map(doc.faces.flatMap(face => face.corners.map(row => [row.id, row.vertex])));
    return triangleSources.map(({ face, corners }, i) => {
      const vertices = corners.map(id => vertexOf.get(id));
      const points = [0, 1, 2].map(j => positions.slice(indices[i * 3 + j] * 3, indices[i * 3 + j] * 3 + 3).map(Math.fround));
      const rim = edges(points), normal = V.norm(V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0])));
      const sides = rim.map(([a, b]) => V.cross(normal, V.norm(V.sub(b, a))));
      return { i, face, vertices, points, rim, normal, sides, bounds: spatial.boxOf(points) };
    });
  }

  function inTriangle(point, row, tolerance) {
    return row.sides.every((normal, i) => V.dot(V.sub(point, row.points[i]), normal) >= -tolerance);
  }

  function opposing(a, b, tolerance) {
    let nearest = null;
    function contact(p, q) {
      const delta = V.sub(q, p), distance = V.len(delta);
      if (distance <= tolerance || V.dot(delta, a.normal) > -distance * .35 ||
          V.dot(delta, b.normal) < distance * .35) return;
      if (!nearest || distance < nearest.distance) nearest = { distance, points: [p, q] };
    }
    for (const point of a.points) {
      const q = V.mad(point, b.normal, V.dot(V.sub(b.points[0], point), b.normal));
      if (inTriangle(q, b, tolerance)) contact(point, q);
    }
    for (const point of b.points) {
      const p = V.mad(point, a.normal, V.dot(V.sub(a.points[0], point), a.normal));
      if (inTriangle(p, a, tolerance)) contact(p, point);
    }
    for (const e of a.rim) for (const f of b.rim) contact(...closestSegments(e, f));
    return nearest;
  }

  function walls(doc, faceIds, minWall, tolerance) {
    const rows = triangles(doc), tree = spatial.pointIndex(rows);
    const maxPairs = 250000, hits = [], selected = new Set(faceIds);
    let tested = 0, complete = true, count = 0, closest = null;
    for (const a of rows) {
      if (!selected.has(a.face)) continue;
      if (!tree.box(spatial.expand(a.bounds, minWall), b => {
        if (a.face === b.face || a.i >= b.i && selected.has(b.face) ||
            a.vertices.some(id => b.vertices.includes(id)) || V.dot(a.normal, b.normal) > -.35) return;
        if (tested >= maxPairs) return false;
        tested++;
        const hit = opposing(a, b, tolerance);
        if (hit && hit.distance + tolerance < minWall) {
          const issue = { faces: [a.face, b.face], ...hit };
          count++;
          if (hits.length < 32) hits.push(issue);
          if (!closest || issue.distance < closest.distance) closest = issue;
        }
      })) { complete = false; break; }
    }
    return { minimum: minWall, counts: count, tested, complete, closest, hits };
  }

  function swept(doc, moves, excluded, translations, tolerance) {
    const rows = triangles(doc);
    const outside = rows.filter(row => !excluded.has(row.face)), tree = spatial.pointIndex(outside);
    const hits = [], maxPairs = 250000;
    let tested = 0, complete = true, count = 0;
    function hit(row, start, delta) {
      const span = V.dot(delta, row.normal);
      if (Math.abs(span) <= tolerance) return;
      const travel = V.dot(V.sub(row.points[0], start), row.normal) / span;
      if (travel <= tolerance / Math.abs(span) || travel > 1) return;
      const point = V.mad(start, delta, travel);
      if (inTriangle(point, row, tolerance)) return { travel, point };
    }
    function add(issue) {
      count++;
      if (hits.length < 32) hits.push(issue);
    }
    for (const { vertex, start, end } of moves) {
      const delta = V.sub(end, start);
      if (!tree.box(spatial.expand(spatial.boxOf([start, end]), tolerance), row => {
        if (tested >= maxPairs) return false;
        tested++;
        const contact = hit(row, start, delta);
        if (contact) add({ vertex, face: row.face, ...contact });
      })) { complete = false; break; }
    }
    // With a rigid extrusion, stationary vertices can get swept even when
    // the moving vertices pass on either side of an obstacle.
    for (const row of rows) {
      if (!complete) break;
      const delta = translations.get(row.face);
      if (!delta) continue;
      const bounds = spatial.boxOf([...row.points, ...row.points.map(p => V.add(p, delta))]);
      if (!tree.box(spatial.expand(bounds, tolerance), other => {
        if (tested >= maxPairs) return false;
        tested++;
        for (const [i, point] of other.points.entries()) {
          const contact = hit(row, point, V.mul(delta, -1));
          if (contact) add({ vertex: other.vertices[i], face: row.face, travel: contact.travel, point });
        }
      })) complete = false;
    }
    return { tested, complete, count, hits };
  }

  return { walls, swept };
})(KIT);
