/* Triangle-local cut constraints, shared by the plane and projected knife. */
const meshCutGeometry = (function (K) {
  const { V } = K, epsilon = 1e-8;
  const pair = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  const canonical = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const sub = (a, b) => a.map((n, i) => n - b[i]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const point = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const blend = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
  function normalized(value) {
    const parts = value.map(n => Math.abs(n) <= epsilon ? 0 : Math.max(0, Math.min(1, n)));
    const sum = parts.reduce((a, b) => a + b, 0);
    return parts.map(n => n / sum);
  }
  function unit(value, label) {
    if (!point(value, 3) || !Number.isFinite(V.len(value)) || V.len(value) === 0)
      throw new TypeError(label + ' needs a finite nonzero direction');
    return V.mul(value, 1 / V.len(value));
  }
  function basis(origin, normal, right = V.perp(normal)) {
    const up = V.cross(normal, right);
    return { origin, normal, project: value => {
      const offset = V.sub(value, origin);
      return [V.dot(offset, right), V.dot(offset, up)];
    } };
  }
  function knifeBasis(raw) {
    if (!record(raw, ['origin', 'right', 'up']) || !point(raw.origin, 3)) throw new TypeError('Knife needs an orthographic projection frame');
    const right = unit(raw.right, 'Knife right'), up = unit(raw.up, 'Knife up');
    if (Math.abs(V.dot(right, up)) > epsilon) throw new RangeError('Knife projection axes must be orthogonal');
    return basis(raw.origin, V.cross(right, up), right);
  }
  function segmentsMeet(a, b, c, d) {
    const u = sub(b, a), v = sub(d, c), q = sub(c, a), det = cross(u, v);
    const length = Math.hypot(...u), other = Math.hypot(...v);
    if (Math.abs(det) <= epsilon * length * other) {
      if (Math.abs(cross(q, u)) > epsilon * length * Math.max(length, other)) return false;
      const axis = Math.abs(u[0]) >= Math.abs(u[1]) ? 0 : 1;
      const [lo, hi] = [a[axis], b[axis]].sort((x, y) => x - y);
      const [left, right] = [c[axis], d[axis]].sort((x, y) => x - y);
      return left <= hi && right >= lo;
    }
    const t = cross(q, v) / det, s = cross(q, u) / det;
    return t >= -epsilon && t <= 1 + epsilon && s >= -epsilon && s <= 1 + epsilon;
  }
  function knifePath(raw) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 65 || !Array.from(raw).every(p => point(p, 2)))
      throw new RangeError('Knife paths need 2 to 65 finite XY points');
    const path = raw.map(p => p.slice());
    const closed = path[0].every((value, i) => value === path.at(-1)[i]);
    const segments = path.slice(0, -1).map((a, i) => [a, path[i + 1]]);
    for (const [[a, b], i] of segments.map((row, i) => [row, i])) {
      if (Math.hypot(...sub(b, a)) <= epsilon) throw new RangeError('Knife path repeats a point');
      if (i) {
        const u = sub(a, segments[i - 1][0]), v = sub(b, a);
        if (Math.abs(cross(u, v)) <= epsilon * Math.hypot(...u) * Math.hypot(...v) && u[0] * v[0] + u[1] * v[1] < 0)
          throw new RangeError('Knife path retraces itself');
      }
      for (let j = 0; j < i - 1; j++) if (!(closed && j === 0 && i === segments.length - 1) &&
          segmentsMeet(...segments[j], a, b)) throw new RangeError('Knife path crosses itself');
    }
    if (closed && segments.length < 3) throw new RangeError('A closed knife path needs at least three segments');
    return segments;
  }
  function plane(positions, frame, tolerance) {
    const distances = positions.map(p => V.dot(V.sub(p, frame.origin), frame.normal));
    const d = distances.map(n => Math.abs(n) <= tolerance ? 0 : n);
    if (!d.some(n => n < 0) || !d.some(n => n > 0)) return [];
    const hits = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (d[i] === 0) hits.push(canonical[i]);
      if (d[i] * d[j] < 0) hits.push(normalized(blend(canonical[i], canonical[j], d[i] / (d[i] - d[j]))));
    }
    return [hits];
  }
  function knife(positions, frame, segments) {
    const [a, b, c] = positions.map(frame.project), u = sub(b, a), v = sub(c, a), det = cross(u, v);
    if (Math.abs(det) <= epsilon * Math.hypot(...u) * Math.hypot(...v)) return [];
    const barycentric = p => {
      const q = sub(p, a), x = cross(q, v) / det, y = cross(u, q) / det;
      return [1 - x - y, x, y];
    };
    const result = [];
    for (const [start, end] of segments) {
      const from = barycentric(start), to = barycentric(end);
      let lo = 0, hi = 1;
      for (let i = 0; i < 3; i++) {
        if (from[i] < -epsilon && to[i] < -epsilon) { lo = 1; hi = 0; break; }
        if (from[i] >= -epsilon && to[i] >= -epsilon) continue;
        const t = from[i] / (from[i] - to[i]);
        if (from[i] < 0) lo = Math.max(lo, t);
        else hi = Math.min(hi, t);
      }
      if (hi > lo + epsilon) result.push([normalized(blend(from, to, lo)), normalized(blend(from, to, hi))]);
    }
    return result;
  }
  function triangleRows(doc, geometry) {
    const corners = new Map(doc.faces.flatMap(face => face.corners.map(corner => [corner.id, corner])));
    const vertices = new Map(doc.vertices.map(vertex => [vertex.id, vertex]));
    return geometry.triangleSources.map(({ face, corners: ids }, i) => {
      const loop = ids.map(id => corners.get(id)), rows = loop.map(corner => vertices.get(corner.vertex));
      return { i, face, loop, vertices: rows, positions: rows.map(row => row.position), cuts: [], interior: [] };
    });
  }

  return { epsilon, pair, canonical, point, record, blend, unit, basis, knifeBasis, knifePath, plane, knife, triangleRows };
})(KIT);
