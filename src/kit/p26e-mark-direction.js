/* Resolve brush headings on the rest surface before carrying them through deformation. */
(function (K) {
  const P = K.procedural, { V, M, Q } = K;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const range = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
  const axisX = [1, 0, 0], axisZ = [0, 0, 1];
  const rad = Math.PI / 180;
  const tangent = (axis, normal) => V.mad(axis, normal, -V.dot(axis, normal));

  function prepare(raw, flowMaps = {}) {
    if (raw === undefined) return undefined;
    if (!fields(raw, ['field', 'strength', 'ruffleDegrees', 'seed']))
      throw new TypeError('Mark direction needs a field and optional strength, ruffle angle and seed');
    const { field, strength = 1, ruffleDegrees = 0, seed = 0 } = raw;
    if (!range(strength, 0, 1) || !range(ruffleDegrees, 0, 180) || !Number.isInteger(seed) || !range(seed, 0, 4294967295))
      throw new RangeError('Mark direction strength must be 0–1, ruffle 0–180 degrees, and seed an unsigned integer');
    let brush, summary;
    if (field?.kind === 'flow-map') {
      if (!fields(field, ['kind', 'map', 'origin', 'u', 'v', 'bounds']))
        throw new TypeError('A mark flow field needs a flow map and an optional planar chart');
      const { map, origin, u = axisX, v = [0, 1, 0], bounds } = field, named = typeof map === 'string';
      if (named && !Object.hasOwn(flowMaps, map)) throw new RangeError('Unknown mark flow map ' + map);
      const asset = named ? flowMaps[map] : map;
      const opened = typeof asset?.world === 'function' ? asset : K.flowMap.open(asset);
      const sampler = opened.world({ origin, u, v, bounds, outside: 'none' });
      brush = SurfaceBrush.prepare({ direction: 'field', field: sampler, axis: u });
      summary = { kind: field.kind, ...(named && { map }), ...(origin !== undefined && { origin }), u, v,
        ...(bounds !== undefined && { bounds }) };
    } else {
      if (!fields(field, ['kind', 'axis', 'probe']) || !['axis', 'contour', 'curvature'].includes(field.kind))
        throw new TypeError('Choose an axis, contour, curvature or flow-map mark direction');
      brush = SurfaceBrush.prepare({ direction: field.kind, axis: field.axis, probe: field.probe });
      summary = { kind: field.kind, axis: brush.axis, ...(field.probe !== undefined && { probe: field.probe }) };
    }
    return { brush, field: summary, strength, ruffleDegrees, seed };
  }

  function preferred(brush, support, normal, context) {
    const read = SurfaceBrush.direction(brush, support, normal, context);
    return brush.direction === 'field' && !read.confidence ? undefined : read.tangent;
  }

  function align(style, { frame, distance, forward, root, spacing, mark, grid, observe }) {
    const { sceneGraph: graph, deform } = K;
    const inverse = graph.inverse(frame), pullNormal = M.tr(frame.matrix);
    const probe = Math.max(.00001, Math.min(.006, spacing * .16));
    function normalAt(x, y, z) {
      const n = [distance(x + probe, y, z) - distance(x - probe, y, z),
        distance(x, y + probe, z) - distance(x, y - probe, z), distance(x, y, z + probe) - distance(x, y, z - probe)];
      return V.len(n) > probe * 1e-6 ? V.norm(n) : null;
    }
    const context = { normalAt, spacing };
    return (pose, ordinal, family) => {
      const before = graph.point(frame, pose.point), basis = M.mul(frame.matrix, Q.toMatrix(pose.rotation));
      let rest = before, normal = root?.normal ?? normalAt(...rest) ?? V.norm(M.app(basis, axisZ));
      let support = root?.point ?? V.mad(rest, normal, -distance(...rest));
      let heading = V.norm(tangent(M.app(basis, axisX), normal), V.perp(normal));
      const result = grid?.(rest, support, normal, heading, context);
      if (result) ({ point: rest, support, normal, heading } = result);
      let restTangent = heading, ruffle = 0;
      if (style) {
        const wanted = preferred(style.brush, support, normal, context) ?? heading;
        const turn = Math.atan2(V.dot(V.cross(heading, wanted), normal), V.dot(heading, wanted));
        ruffle = (2 * P.data.hash01(mark + '/' + family + '/' + ordinal, style.seed) - 1) * style.ruffleDegrees;
        restTangent = M.app(M.rot(normal, turn * style.strength + ruffle * rad), heading);
      }
      let moved = rest, n = normal, axis = restTangent;
      if (forward) {
        moved = forward(rest);
        const jac = deform.jac(forward, rest), determinant = M.det(jac);
        if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-8)
          throw new RangeError('The receiver warp is singular at ' + mark);
        n = V.norm(M.app(M.tr(M.inv(jac)), normal));
        axis = V.norm(M.app(jac, restTangent));
      }
      const z = V.norm(M.app(pullNormal, n)), x = V.norm(tangent(M.app(inverse.matrix, axis), z), V.perp(z));
      observe?.({ rest, point: moved, restNormal: normal, normal: n, restTangent, tangent: axis, ruffleDegrees: ruffle,
        ...(result && { grid: { before, status: result.status, ...(result.coords && { coords: result.coords, target: result.target }),
          ...(result.angle !== undefined && { angle: result.angle, targetAngle: result.targetAngle }) } }) });
      return { ...pose, point: graph.point(inverse, moved), rotation: Q.fromMatrix(M.cols(x, V.cross(z, x), z)) };
    };
  }

  P.markDirection = Object.freeze({ prepare, align, preferred });
})(KIT);
