/* Build supporting planes from a bevel profile in the source edge's cross section. */
const meshBevelPlanes = (function (K) {
  const { V } = K, { record, unit, basis } = meshCutGeometry;
  const { area } = meshFaceRegionGeometry;
  const { name, position, requireWinding } = meshEdgeFlowData;
  const dotAt = (row, point) => V.dot(row.normal, V.sub(point, row.origin));

  function settings(raw, selection, tolerance) {
    if (!record(raw, ['selection', 'width', 'segments', 'profile', 'join', 'weights', 'material']) ||
        !Number.isFinite(raw.width) || raw.width <= tolerance ||
        raw.material !== undefined && !name(raw.material) ||
        !['miter', 'patch'].includes(raw.join ?? 'miter'))
      throw new TypeError('Use bevel width above tolerance, with optional material and miter or patch corners');
    const { profile = 'round', join = 'miter', material, width, weights = [] } = raw;
    const custom = record(profile, ['points']);
    const count = raw.segments ?? (custom && Array.isArray(profile.points) ? profile.points.length - 1 : profile === 'chamfer' ? 1 : 3);
    if (!Number.isSafeInteger(count) || count < 1 || count > 16 || profile === 'chamfer' && count !== 1 ||
        !custom && !['chamfer', 'round'].includes(profile))
      throw new RangeError('Choose 1 chamfer segment, 1–16 round segments, or matching custom profile points');
    if (custom) {
      const points = profile.points;
      if (!Array.isArray(points) || points.length !== count + 1 ||
          !Array.from(points).every(p => Array.isArray(p) && p.length === 2 && Array.from(p).every(n => Number.isFinite(n) && n >= 0 && n <= 1)) ||
          points[0][0] !== 1 || points[0][1] !== 0 || points[count][0] !== 0 || points[count][1] !== 1 ||
          points.slice(1).some(([x, y], i) => x >= points[i][0] || y <= points[i][1]))
        throw new RangeError('Custom profile offsets must decrease in X and increase in Y from [1,0] to [0,1]');
    }
    const chosen = new Set(selection.map(edge => edge.id)), weightByEdge = new Map();
    if (!Array.isArray(weights)) throw new TypeError('Use a list of edge weights');
    for (const row of weights) {
      if (!record(row, ['edge', 'weight']) || !chosen.has(row.edge) || weightByEdge.has(row.edge) ||
          !Number.isFinite(row.weight) || row.weight < 0 || row.weight > 1)
        throw new RangeError('Specify at most one weight from 0 to 1 for each selected edge');
      weightByEdge.set(row.edge, row.weight);
    }
    return { profile, custom, count, weightByEdge, join, material, width, tolerance };
  }

  function planar(face, vertices, tolerance) {
    const points = face.corners.map(corner => vertices.get(corner.vertex).position);
    const normal = unit(area(points), 'Face normal ' + face.id);
    if (points.some(point => Math.abs(V.dot(normal, V.sub(point, points[0]))) > tolerance * 4))
      throw new RangeError('Bevel needs planar incident polygons at face ' + face.id);
    return normal;
  }

  function crossSection(ia, ib, config, width) {
    const { profile, custom, count } = config;
    const a = V.mul(ia, width), b = V.mul(ib, width);
    if (count === 1) return [a, b];
    if (custom) return profile.points.map(([u, v]) => V.add(V.mul(a, u), V.mul(b, v)));
    const cosine = V.dot(ia, ib), center = V.mul(V.add(a, b), 1 / (1 + cosine));
    const angle = Math.acos(Math.max(-1, Math.min(1, -cosine))), sine = Math.sin(angle);
    const ra = V.sub(a, center), rb = V.sub(b, center);
    return [a, ...Array.from({ length: count - 1 }, (_, i) => {
      const t = (i + 1) / count;
      return V.add(center, V.add(V.mul(ra, Math.sin(angle * (1 - t)) / sine), V.mul(rb, Math.sin(angle * t) / sine)));
    }), b];
  }

  function edgePlan(g, edge, config) {
    const weight = config.weightByEdge.get(edge.id) ?? 1, width = config.width * weight;
    if (width <= config.tolerance) return { edge: edge.id, weight, width, planes: [] };
    requireWinding(g, edge);
    if (edge.uses.length !== 2) throw new RangeError('Bevel requires two adjacent faces at edge ' + edge.id);
    const sorted = edge.uses.slice().sort((a, b) => a.face < b.face ? -1 : 1);
    const ids = sorted.map(use => use.face);
    const head = g.corners.get(sorted[0].from).vertex, tail = g.corners.get(sorted[0].to).vertex;
    const origin = position(g, head), axis = unit(V.sub(position(g, tail), origin), 'Bevel edge');
    const length = V.dist(origin, position(g, tail));
    const [na, nb] = ids.map(id => planar(g.faces.get(id), g.vertices, config.tolerance));
    const ia = V.cross(na, axis), ib = V.cross(axis, nb);
    if (V.dot(na, ib) >= -1e-6 || V.dot(nb, ia) >= -1e-6)
      throw new RangeError('Bevel requires a convex, non-flat hinge at edge ' + edge.id);
    const points = crossSection(ia, ib, config, width);
    const run = [0];
    for (let i = 1; i < points.length; i++) run.push(run[i - 1] + V.dist(points[i], points[i - 1]));
    const planes = points.slice(0, -1).map((a, index) => {
      const step = V.sub(points[index + 1], a);
      const direction = unit(step, 'Profile segment'), size = V.len(step);
      let normal = unit(V.cross(direction, axis), 'Profile normal');
      if (V.dot(normal, a) > 0) normal = V.mul(normal, -1);
      if (points.some(p => V.dot(normal, V.sub(p, a)) > config.tolerance))
        throw new RangeError('Custom bevel profiles must have a convex cross section');
      const material = config.material ?? g.faces.get(ids[index < config.count / 2 ? 0 : 1]).material;
      return {
        id: edge.id, anchors: edge.vertices, seeds: ids, normal, origin: V.add(origin, a), material, index,
        uv(point) {
          const local = V.sub(point, origin);
          return [clamp(V.dot(local, axis) / length),
            clamp((run[index] + size * clamp(V.dot(V.sub(local, a), direction) / size)) / run[config.count])];
        }
      };
    });
    return { edge: edge.id, weight, width, planes, axis, faces: ids, ends: edge.vertices };
  }

  const clamp = n => Math.min(1, Math.max(0, n));

  function cornerPlan(g, state, vertex, edges, config, atVertex) {
    const at = position(g, vertex);
    const incident = atVertex.get(vertex);
    const normals = incident.map(id => planar(g.faces.get(id), g.vertices, config.tolerance));
    const normal = unit(normals.reduce(V.add, [0, 0, 0]), 'Corner normal at ' + vertex);
    const radius = 3 * Math.max(...edges.map(row => row.width));
    const sources = [...state.faces.values()].filter(face => face.feature?.anchors.includes(vertex));
    const nearby = sources.flatMap(face => face.corners.map(row => state.vertices.get(row.vertex).position))
      .filter(point => V.dist(point, at) <= radius);
    if (!nearby.length) return null;
    const depth = Math.min(...nearby.map(point => V.dot(normal, V.sub(at, point))));
    const trim = Math.min(...edges.map(row => row.width)) * .22;
    const origin = V.mad(at, normal, -(depth + trim)), chart = basis(origin, normal);
    const material = config.material ?? sources[0].material;
    return { id: vertex, anchors: [vertex], seeds: incident, corner: true, origin, normal, material,
      uv: point => chart.project(point).map(n => clamp(.5 + .5 * n / radius)) };
  }

  return { settings, planar, edgePlan, cornerPlan, dotAt };
})(KIT);
