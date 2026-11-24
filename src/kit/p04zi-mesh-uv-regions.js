/* Solve local UV regions in texels while preserving retained corner constraints. */
const meshUVRegions = (function (K) {
  const { V } = K;
  const fields = (row, keys) => row && Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).every(key => keys.includes(key));
  const tuple = (v, n, valid = Number.isFinite) =>
    Array.isArray(v) && v.length === n && Array.from(v).every(valid);
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const name = v => typeof v === 'string' && Boolean(v.trim());
  const sorted = ids => [...new Set(ids)].sort();
  const pixels = (uv, atlas) => [uv[0] * atlas[0], uv[1] * atlas[1]];

  function grid(atlas) {
    if (!tuple(atlas, 2, n => integer(n, 8, 4096))) throw new RangeError('Use an atlas with two dimensions from 8 to 4096 texels');
    return atlas;
  }

  function ids(list, map, label) {
    if (!Array.isArray(list) || Array.from(list).some(id => !map.has(id)))
      throw new RangeError('Choose existing ' + label + ' by stable ID');
    return sorted(list);
  }

  function protection(g, protect = {}) {
    if (!fields(protect, ['seams', 'painted'])) throw new TypeError('UV protection accepts approved seams and painted spans');
    const fixed = new Set(), pinned = [];
    for (const { id, uvPinned } of g.corners.values()) if (uvPinned) {
      fixed.add(g.atWeld.get(id));
      pinned.push(id);
    }
    const addEdge = id => {
      for (const side of g.edges.get(id).sides) for (const corner of side.corners) fixed.add(g.atWeld.get(corner));
    };
    const seams = ids(protect.seams ?? [], g.edges, 'UV seam edges');
    seams.forEach(addEdge);
    const used = new Set(), spans = protect.painted ?? [];
    if (!Array.isArray(spans) || spans.length > 256) throw new RangeError('Use up to 256 named painted spans');
    const painted = Array.from(spans, row => {
      if (!fields(row, ['id', 'faces', 'edges']) || !name(row.id) || used.has(row.id))
        throw new TypeError('Painted spans need distinct IDs, with faces or edges');
      used.add(row.id);
      const faces = ids(row.faces ?? [], g.faces, 'painted faces'), edges = ids(row.edges ?? [], g.edges, 'painted edges');
      if (!faces.length && !edges.length) throw new RangeError('A painted span needs at least one face or edge');
      for (const face of faces) for (const corner of g.faces.get(face).corners) fixed.add(g.atWeld.get(corner.id));
      edges.forEach(addEdge);
      return { id: row.id, faces, edges };
    });
    return { fixed, report: { seams, painted, pins: pinned.sort() } };
  }

  function triangles(g, selected) {
    return g.triangles().filter(row => selected.has(row.face)).map(({ face, corners }) => {
      const values = corners.map(id => g.corners.get(id));
      return { face, corners, keys: corners.map(id => g.atWeld.get(id)), positions: values.map(row => row.position),
        uv: values.map(row => row.uv) };
    });
  }

  function stats(rows, atlas, get = row => row.uv) {
    let surface = 0, texels = 0, stretchSum = 0, stretchArea = 0, maxStretch = 0;
    for (const row of rows) {
      const m = MeshUV.metrics(row.positions, get(row).map(uv => pixels(uv, atlas)));
      surface += m.worldArea;
      texels += m.uvArea;
      if (m.stretch !== null) {
        stretchSum += m.worldArea * m.stretch;
        stretchArea += m.worldArea;
        maxStretch = Math.max(maxStretch, m.stretch);
      }
    }
    return { worldArea: surface, texels, density: surface ? Math.sqrt(texels / surface) : 0,
      meanStretch: stretchArea ? stretchSum / stretchArea : null, maxStretch: maxStretch || null };
  }

  function assertConnected(g, faces) {
    if (!faces.length) throw new RangeError('Choose a nonempty UV region');
    const selected = new Set(faces), first = faces[0], material = g.faces.get(first).material;
    const queue = [first], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const id of g.faceEdges.get(queue[i])) {
      const edge = g.edges.get(id);
      if (edge.kind !== 'continuous') continue;
      for (const { face } of edge.sides) if (selected.has(face) && !seen.has(face)) { seen.add(face); queue.push(face); }
    }
    if (seen.size !== selected.size) throw new RangeError('Unwrap and relax each need one connected region on one material sheet');
    return { selected, material };
  }

  function region(g, faceIds, keepRim, protect, atlas) {
    const { selected, material } = assertConnected(g, faceIds), held = protection(g, protect);
    const rows = triangles(g, selected), keys = sorted(rows.flatMap(row => row.keys));
    const fixed = new Set(keys.filter(id => held.fixed.has(id) || g.welds.get(id).some(c => !selected.has(g.corners.get(c).face))));
    if (keepRim) for (const face of faceIds) for (const id of g.faceEdges.get(face)) {
      const { kind, sides } = g.edges.get(id);
      if (kind === 'continuous' && sides.every(row => selected.has(row.face))) continue;
      for (const side of sides) if (side.face === face) for (const corner of side.corners) fixed.add(g.atWeld.get(corner));
    }
    const original = new Map(keys.map(id => [id, pixels(g.corners.get(id).uv, atlas)]));
    return { rows, keys, fixed, original, material, protection: held.report };
  }

  function neighbors(rows, keys) {
    const result = new Map(keys.map(id => [id, new Map()]));
    for (const tri of rows) for (let i = 0; i < 3; i++) {
      const a = (i + 1) % 3, b = (i + 2) % 3;
      const u = V.sub(tri.positions[a], tri.positions[i]), v = V.sub(tri.positions[b], tri.positions[i]);
      const lu = V.len(u), lv = V.len(v), product = lu * lv;
      if (!product) continue;
      const half = V.len(V.cross(u, v)) / Math.max(product * 1e-8, product + V.dot(u, v));
      const links = result.get(tri.keys[i]);
      for (const [j, length] of [[a, lu], [b, lv]]) {
        const id = tri.keys[j];
        links.set(id, (links.get(id) ?? 0) + half / length);
      }
    }
    return result;
  }

  function solve(region, values, iterations, strength) {
    const links = neighbors(region.rows, region.keys);
    const free = region.keys.filter(id => !region.fixed.has(id) && links.get(id).size);
    const visits = free.reduce((sum, id) => sum + links.get(id).size, 0) * iterations;
    if (visits > 8e6) throw new RangeError('Local UV solve exceeds its work budget; select a smaller region or fewer iterations');
    let maxDelta = 0, steps = 0;
    for (; steps < iterations && free.length; steps++) {
      maxDelta = 0;
      for (const id of free) {
        const old = values.get(id), total = [0, 0];
        let weight = 0;
        for (const [neighbor, w] of links.get(id)) {
          const uv = values.get(neighbor);
          total[0] += uv[0] * w; total[1] += uv[1] * w; weight += w;
        }
        if (!weight) continue;
        const next = total.map((n, a) => old[a] + strength * (n / weight - old[a]));
        values.set(id, next);
        maxDelta = Math.max(maxDelta, Math.hypot(next[0] - old[0], next[1] - old[1]));
      }
      if (maxDelta <= 1e-5) { steps++; break; }
    }
    return { iterations: steps, maxDelta };
  }

  function bounds(points) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [u, v] of points) {
      box[0] = Math.min(box[0], u); box[1] = Math.min(box[1], v);
      box[2] = Math.max(box[2], u); box[3] = Math.max(box[3], v);
    }
    return box;
  }

  function project(g, region, atlas, rect, axis) {
    let largest = -1, reference, direction = [0, 0, 0];
    const normals = region.rows.map(({ positions: [a, b, c] }) => V.cross(V.sub(b, a), V.sub(c, a)));
    for (const [i, normal] of normals.entries()) {
      const length = V.len(normal);
      if (length > largest) { largest = length; reference = i; }
    }
    for (const n of normals) direction = V.add(direction, V.dot(n, normals[reference]) < 0 ? V.mul(n, -1) : n);
    const normal = V.norm(axis ?? direction), u = V.perp(normal), v = V.cross(normal, u);
    const anchor = g.corners.get(region.keys[0]).position;
    const plane = new Map(region.keys.map(id => {
      const offset = V.sub(g.corners.get(id).position, anchor);
      return [id, [V.dot(offset, u), V.dot(offset, v)]];
    }));
    // Keep the authored winding and rotate the projection towards its existing atlas direction.
    let orientation = 0;
    for (const row of region.rows)
      orientation += MeshUV.area2(...row.keys.map(id => plane.get(id))) * MeshUV.area2(...row.uv);
    if (orientation < 0) for (const point of plane.values()) point[1] *= -1;
    const mean = values => {
      const total = [0, 0];
      for (const [x, y] of values.values()) { total[0] += x; total[1] += y; }
      return total.map(n => n / values.size);
    };
    const [u0, v0] = mean(plane), [ox, oy] = mean(region.original);
    let cos = 0, sin = 0;
    for (const [id, [x, y]] of plane) {
      const [a, b] = region.original.get(id), dx = x - u0, dy = y - v0;
      cos += dx * (a - ox) + dy * (b - oy);
      sin += dx * (b - oy) - dy * (a - ox);
    }
    const angle = Math.atan2(sin, cos), c = Math.cos(angle), s = Math.sin(angle);
    for (const [id, [x, y]] of plane) plane.set(id, [x * c - y * s, x * s + y * c]);
    const [l, t, r, b] = bounds(plane.values());
    const [x0, y0, x1, y1] = rect ? [rect[0] * atlas[0], rect[1] * atlas[1],
      (rect[0] + rect[2]) * atlas[0], (rect[1] + rect[3]) * atlas[1]] : bounds(region.original.values());
    const scale = Math.min((x1 - x0) / (r - l), (y1 - y0) / (b - t));
    if (!Number.isFinite(scale) || scale <= 1e-10) return null;
    for (const [id, [x, y]] of plane)
      plane.set(id, [(x0 + x1) * .5 + (x - (l + r) * .5) * scale, (y0 + y1) * .5 + (y - (t + b) * .5) * scale]);
    return plane;
  }

  function local(g, faceIds, operation, points, conflict) {
    if (!fields(operation, ['op', 'ids', 'selection', 'atlas', 'protect', 'rect', 'normal', 'iterations', 'strength']))
      throw new TypeError('Unknown local UV solve setting');
    const { op, atlas = [1024, 1024], protect, rect, normal, iterations = 64, strength = .85 } = operation;
    grid(atlas);
    if (op === 'relax' && (rect !== undefined || normal !== undefined) ||
        rect !== undefined && (!tuple(rect, 4, n => Number.isFinite(n) && n >= 0 && n <= 1) ||
          rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1 || rect[1] + rect[3] > 1) ||
        normal !== undefined && (!tuple(normal, 3) || !Number.isFinite(V.len(normal)) || V.len(normal) < 1e-8) ||
        !integer(iterations, 1, 256) || !Number.isFinite(strength) || strength <= 0 || strength > 1)
      throw new RangeError('Use a positive UV solve strength, 1–256 iterations, and optional unwrap rectangle and normal');
    const part = region(g, faceIds, op === 'relax', protect, atlas);
    let values = new Map(part.original), solveReport = { iterations: 0, maxDelta: 0 };
    if (op === 'relax') solveReport = solve(part, values, iterations, strength);
    else {
      values = project(g, part, atlas, rect, normal);
      if (!values) {
        conflict('degenerate-projection', { faces: faceIds });
        return { atlas, fixed: part.fixed.size, protection: part.protection };
      }
      if (part.fixed.size) {
        const delta = new Map(part.keys.map(id => [id, part.fixed.has(id) ?
          part.original.get(id).map((n, a) => n - values.get(id)[a]) : [0, 0]]));
        solveReport = solve(part, delta, iterations, strength);
        for (const id of part.keys) values.set(id, values.get(id).map((n, a) => n + delta.get(id)[a]));
      }
    }
    for (const id of part.keys) if (!part.fixed.has(id)) {
      const uv = values.get(id).map((n, a) => n / atlas[a]);
      for (const corner of g.welds.get(id)) points.set(corner, uv);
    }
    return { atlas, fixed: part.fixed.size, free: part.keys.length - part.fixed.size, protection: part.protection, ...solveReport,
      before: stats(part.rows, atlas), after: stats(part.rows, atlas, row => row.corners.map((id, j) => points.get(id) ?? row.uv[j])) };
  }

  function checkOverlaps(g, points, conflict) {
    const affected = new Set([...points.keys()].map(id => g.faces.get(g.corners.get(id).face).material));
    const rows = g.triangles().flatMap(({ face, corners }) => {
      const material = g.faces.get(face).material;
      if (!affected.has(material)) return [];
      const before = corners.map(id => g.corners.get(id).uv);
      return [{ face, material, before, after: corners.map((id, i) => points.get(id) ?? before[i]),
        changed: corners.some(id => points.has(id)) }];
    });
    if (!MeshUV.changedOverlaps(rows, 3e6, (left, right) => conflict('new-uv-overlap', { faces: [left, right] })))
      conflict('uv-overlap-check-budget', {});
  }

  return Object.freeze({ fields, tuple, integer, name, sorted, grid, ids, protection, triangles, stats, bounds, local, checkOverlaps });
})(KIT);
