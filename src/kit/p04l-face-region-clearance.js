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

  function roots(coefficients) {
    const scale = Math.max(...coefficients.map(Math.abs));
    if (!scale) return [];
    const [a,b,c,d] = coefficients.map(n=>n/scale), epsilon = 1e-12;
    const value = t=>((d*t+c)*t+b)*t+a;
    // Split the cubic at its derivative roots so each interval is monotone.
    const discriminant = c*c-3*d*b;
    const turns = Math.abs(d)>epsilon ? (discriminant>=0 ?
      [(-c-Math.sqrt(discriminant))/(3*d),(-c+Math.sqrt(discriminant))/(3*d)] : []) :
      Math.abs(c)>epsilon ? [-b/(2*c)] : [];
    const times = [0,...[...new Set(turns.filter(t=>t>0 && t<1))].sort((x,y)=>x-y),1];
    const zeros = times.filter(t=>Math.abs(value(t))<=epsilon);
    for (let i=1;i<times.length;i++) {
      let lo = times[i-1], hi = times[i], before = value(lo);
      const after = value(hi);
      if (Math.abs(before)<=epsilon || Math.abs(after)<=epsilon || Math.sign(before)===Math.sign(after)) continue;
      for (let j=0;j<40;j++) {
        const mid = (lo+hi)*.5, sample = value(mid);
        if (Math.sign(sample)===Math.sign(before)) {lo=mid;before=sample;}
        else hi=mid;
      }
      zeros.push((lo+hi)*.5);
    }
    return zeros.sort((x,y)=>x-y);
  }

  function deformingPair(row, other, deltas, tolerance) {
    const [a,b,c] = row.points, [da,db,dc] = deltas;
    const u = V.sub(b,a), v = V.sub(c,a), du = V.sub(db,da), dv = V.sub(dc,da);
    const n0 = V.cross(u,v), n1 = V.add(V.cross(du,v),V.cross(u,dv)), n2 = V.cross(du,dv);
    const timeTolerance = tolerance/Math.max(...deltas.map(V.len));
    const after = times=>times.filter(time=>time>timeTolerance);
    const at = time=>row.points.map((p,i)=>V.mad(p,deltas[i],time));
    for (const [i,point] of other.points.entries()) {
      const q = V.sub(point,a);
      for (const travel of after(roots([V.dot(q,n0),V.dot(q,n1)-V.dot(da,n0),
        V.dot(q,n2)-V.dot(da,n1),-V.dot(da,n2)]))) {
        const points = at(travel), normal = V.norm(V.cross(V.sub(points[1],points[0]),V.sub(points[2],points[0])));
        if (V.len(normal) && inTriangle(point,{points,sides:edges(points).map(([x,y])=>V.cross(normal,V.norm(V.sub(y,x))))},tolerance))
          return {vertex:other.vertices[i],face:row.face,obstacle:other.face,travel,point,method:'deformed-face'};
      }
    }
    for (const [i,start] of row.points.entries()) {
      const j = (i+1)%3, edge = V.sub(row.points[j],start), delta = V.sub(deltas[j],deltas[i]);
      for (const fixed of other.rim) {
        const q = V.sub(fixed[0],start), axis = V.sub(fixed[1],fixed[0]);
        const cross = V.cross(edge,axis), slope = V.cross(delta,axis);
        // A moving edge can meet a fixed edge only when the four points are coplanar.
        for (const travel of after(roots([V.dot(q,cross),V.dot(q,slope)-V.dot(deltas[i],cross),-V.dot(deltas[i],slope),0]))) {
          const points = at(travel), [p,r] = closestSegments([points[i],points[j]],fixed);
          if (V.dist(p,r)<=tolerance) return {face:row.face,obstacle:other.face,travel,point:p,method:'deformed-edge'};
        }
      }
    }
  }

  function swept(doc, moves, excluded, translations, tolerance, deformations = new Map()) {
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
    for (const row of rows) {
      if (!complete) break;
      const motion = deformations.get(row.face);
      if (!motion) continue;
      const deltas = row.vertices.map(id=>motion.get(id));
      const bounds = spatial.boxOf([...row.points,...row.points.map((point,i)=>V.add(point,deltas[i]))]);
      if (!tree.box(spatial.expand(bounds,tolerance),other=>{
        if (tested>=maxPairs) return false;
        tested++;
        const contact = deformingPair(row,other,deltas,tolerance);
        if (contact) add(contact);
      })) complete=false;
    }
    return { tested, complete, count, hits };
  }

  return { walls, swept };
})(KIT);
