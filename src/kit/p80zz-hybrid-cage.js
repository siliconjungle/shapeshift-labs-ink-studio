/* A single coarse lattice for an indexed part and its retained surface detail. */
(function (K) {
  const { V, M, sceneMeshes: Meshes } = K;
  const format = 'ink-studio/hybrid-cage-pose';
  const axes = [0, 1, 2], edges = [[0, 1], [1, 2], [2, 0]];
  const vector = (v, test) => Array.isArray(v) && v.length === 3 && Array.from(v).every(test);
  const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 1e4;
  const name = n => typeof n === 'string' && n.trim().length > 0 && n.length <= 128;
  const validIDs = rows => Array.isArray(rows) && rows.every(row => name(row?.id)) &&
    new Set(rows.map(row => row.id)).size === rows.length;

  function anchor(input) {
    const { triangle, weights } = input ?? {};
    if (!Number.isSafeInteger(triangle) || triangle < 0 || !vector(weights, n => n >= 0 && n <= 1) ||
        Math.abs(weights.reduce((sum, n) => sum + n, 0) - 1) > 1e-6)
      throw new RangeError('Cage anchors need a triangle and three normalized barycentric weights');
    return { triangle, weights: weights.slice() };
  }

  const pointAt = (xyz, i) => Array.from(xyz.subarray(i * 3, i * 3 + 3));
  const area = ([a, b, c]) => V.len(V.cross(V.sub(b, a), V.sub(c, a)));
  function triangleAt({ indices }, xyz, triangle) {
    return Array.from(indices.subarray(triangle * 3, triangle * 3 + 3), i => pointAt(xyz, i));
  }

  function attachment(ref, geometry, xyz) {
    const points = triangleAt(geometry, xyz, ref.triangle);
    if (!points.length || area(points) <= 1e-12) return null;
    return axes.map(k => points.reduce((sum, p, i) => sum + p[k] * ref.weights[i], 0));
  }

  function stretch(geometry, xyz, limit) {
    const triangles = [];
    let maxExpansion = 1, minRatio = 1;
    for (let triangle = 0; triangle < geometry.indices.length / 3; triangle++) {
      const rest = triangleAt(geometry, geometry.positions, triangle), posed = triangleAt(geometry, xyz, triangle);
      let expansion = 1, compression = 1;
      for (const [a, b] of edges) {
        const distance = V.dist(rest[a], rest[b]);
        if (distance <= 1e-9) continue;
        const ratio = V.dist(posed[a], posed[b]) / distance;
        expansion = Math.max(expansion, ratio);
        compression = Math.min(compression, ratio);
      }
      maxExpansion = Math.max(expansion, maxExpansion);
      minRatio = Math.min(compression, minRatio);
      const collapsed = area(rest) > 1e-12 && area(posed) <= 1e-12;
      if (collapsed || expansion > limit || compression < 1 / limit)
        triangles.push({ triangle, expansion, compression, collapsed, points: posed });
    }
    return { limit, maxExpansion, minRatio, triangles };
  }

  function inspectCells(map, bounds, size) {
    const folds = [], samples = [[.5, .5, .5], ...Array.from({ length: 8 }, (_, mask) =>
      axes.map(axis => mask & (1 << axis) ? .9999 : .0001))];
    let minDeterminant = Infinity;
    for (let z = 0; z < size[2] - 1; z++)
      for (let y = 0; y < size[1] - 1; y++)
        for (let x = 0; x < size[0] - 1; x++) {
          const cell = [x, y, z];
          const points = samples.map(uvw => axes.map(a => bounds.min[a] +
            (bounds.max[a] - bounds.min[a]) * (cell[a] + uvw[a]) / (size[a] - 1)));
          const det = Math.min(...points.map(p => M.det(map.jacobian(p))));
          minDeterminant = Math.min(minDeterminant, det);
          if (det <= 1e-6) folds.push({ cell, determinant: det, point: map(points[0]) });
        }
    return { minDeterminant, folds };
  }

  function gapSample(probe, geometry, xyz, trace) {
    const from = attachment(probe.from, geometry, xyz), to = attachment(probe.to, geometry, xyz);
    if (!from || !to) return { from, to, width: null, obstruction: null };
    const width = V.dist(from, to), pad = Math.min(width * .01, 1e-5);
    const direction = V.norm(V.sub(to, from));
    const hit = width > 1e-8 && trace({ origin: V.mad(from, direction, pad), direction, maxDistance: width - 2 * pad });
    return { from, to, width, obstruction: hit ? { triangle: hit.triangle, point: hit.point } : null };
  }

  function forkWorld(source, mesh, replacement, hasCurves) {
    const data = source.data.slice();
    const world = { ...source, data, rest: source.data.slice(),
      meshes: source.meshes.map(row => row === mesh ? replacement : row) };
    if (source.pix) world.pix = source.pix.slice();
    if (source.surfaceData) world.surfaceData = source.surfaceData.slice();
    if (source.renderMetadata) {
      world.renderMetadata = { ...source.renderMetadata };
      for (const channel of ['normals', 'shadingNormals'])
        if (source.renderMetadata[channel]) world.renderMetadata[channel] = source.renderMetadata[channel].slice();
    }
    if (source.gaussianHarmonics?.normals)
      world.gaussianHarmonics = { ...source.gaussianHarmonics, normals: source.gaussianHarmonics.normals.slice() };
    if (!hasCurves) return world;
    for (const stream of ['curveRest', 'curveStations', 'curveTiming', 'curvePattern', 'curveClips'])
      if (source[stream]) world[stream] = source[stream].slice();
    if (source.curveLod) world.curveLod = source.curveLod.map(row => ({ ...row,
      ...(row.aggregate && { aggregate: { ...row.aggregate } }), ...(row.shadow && { shadow: { ...row.shadow } }) }));
    return world;
  }

  function transportNormal(stream, q, normalMatrix, quantized = false) {
    if (!stream || q + 3 > stream.length) return;
    const n = stream.subarray(q, q + 3), len = V.len(n);
    if (len <= 1e-9) return;
    let normal = V.mul(V.norm(M.app(normalMatrix, n)), len);
    if (quantized) normal = normal.map(n => Math.max(-127, Math.min(127, Math.round(n))));
    stream.set(normal, q);
  }

  function poseSplats(world, source, bindings, identities, geometry, xyz, map, inside) {
    const valid = [];
    const reports = bindings.map(({ id, surface }) => {
      const row = identities.rowOf(id), report = { id, row, triangle: surface.triangle };
      if (row < 0) return { ...report, reason: 'missing-or-ambiguous-source' };
      if ((Math.round(source.data[row * 16 + 11]) % 16) !== 0 || CurveSplat.isRow(source.data, row * 16))
        return { ...report, reason: 'requires-static-splat' };
      const point = Array.from(source.data.subarray(row * 16, row * 16 + 3));
      if (!inside(point)) return { ...report, rest: point, reason: 'outside-cage' };
      const restAnchor = attachment(surface, geometry, geometry.positions), posedAnchor = attachment(surface, geometry, xyz);
      if (!restAnchor || !posedAnchor) return { ...report, rest: point, reason: 'surface-unavailable' };
      const jacobian = map.jacobian(point);
      if (M.det(jacobian) <= 1e-6) return { ...report, rest: point, reason: 'folded-cage' };
      const delta = V.sub(posedAnchor, map(restAnchor));
      valid.push({ row, jacobian, delta });
      return { ...report, rest: point, restAnchor, posedAnchor };
    });
    if (!valid.length) return reports;
    const rows = valid.map(row => row.row);
    K.deform.apply(world, rows, K.deform.rest(source, rows), map);
    for (const { row, jacobian, delta } of valid) {
      const q = row * 16, normal = M.tr(M.inv(jacobian));
      world.data.set(V.add(world.data.subarray(q, q + 3), delta), q);
      transportNormal(world.renderMetadata?.normals, row * 3, normal);
      transportNormal(world.renderMetadata?.shadingNormals, row * 3, normal);
      transportNormal(world.gaussianHarmonics?.normals, row * 3, normal, true);
      if (world.pix?.[row * 8]) transportNormal(world.pix, row * 8 + 3, normal);
      if (world.surfaceData?.[row * SurfaceLook.STRIDE])
        transportNormal(world.surfaceData, row * SurfaceLook.STRIDE + 1, normal);
    }
    for (const report of reports)
      if (!report.reason) report.point = Array.from(world.data.subarray(report.row * 16, report.row * 16 + 3));
    return reports;
  }

  function create(source, { id, mesh: meshId, bounds, size = [2, 2, 2], growth = [], residuals = [], gaps = [],
    stretchLimit = 1.25 } = {}) {
    if (!(source?.data instanceof Float32Array) || !Number.isSafeInteger(source.count) || source.count < 0 ||
        source.data.length !== source.count * 16 || source.anim || source.rest && source.rest !== source.data)
      throw new TypeError('A hybrid cage needs a baked scene with static source rows');
    const mesh = Meshes.list(source).find(mesh => mesh.id === meshId);
    id ??= meshId;
    if (!mesh || !name(id) || !vector(bounds?.min, coordinate) || !vector(bounds?.max, coordinate) ||
        !bounds.max.every((n, i) => n - bounds.min[i] >= 1e-5) ||
        !vector(size, n => Number.isInteger(n) && n >= 2 && n <= 8) ||
        !Number.isFinite(stretchLimit) || stretchLimit <= 1)
      throw new RangeError('A hybrid cage needs a scene mesh, finite bounds, 2–8 handles per axis, and a stretch limit above 1');
    bounds = { min: bounds.min.slice(), max: bounds.max.slice() };
    size = size.slice();
    const lattice = K.deform.lattice(bounds, size);
    const inside = p => p.every((n, a) => n >= bounds.min[a] && n <= bounds.max[a]);
    const geometry = Meshes.geometry(mesh), revision = Meshes.revision(mesh), inputData = source.data;
    for (let i = 0; i < mesh.vertices; i++)
      if (!inside(pointAt(geometry.positions, i))) throw new RangeError('The rest cage must enclose the entire mesh');
    if (!validIDs(growth) || growth.some(({ binding }) => binding?.mesh !== mesh ||
        typeof binding.poseOnMesh !== 'function') || !validIDs(residuals) || !validIDs(gaps) || gaps.length > 128)
      throw new RangeError('A hybrid cage needs distinct growth, residual, and gap IDs on the selected mesh');
    const groups = growth.map(({ id, binding }) => ({ id, binding }));
    const bindings = residuals.map(({ id, surface }) => ({ id, surface: anchor(surface) }));
    const protectedGaps = gaps.map(({ id, minWidth, probes }) => {
      if (!Number.isFinite(minWidth) || minWidth <= 0 || !Array.isArray(probes) || !probes.length || probes.length > 32)
        throw new RangeError('A protected gap needs a positive minimum width and 1–32 probes');
      return { id, minWidth, probes: probes.map(({ from, to }) => ({ from: anchor(from), to: anchor(to) })) };
    });
    const handles = [];
    for (let z = 0; z < size[2]; z++)
      for (let y = 0; y < size[1]; y++)
        for (let x = 0; x < size[0]; x++)
          handles.push({ id: [x, y, z].join(':'), at: [x, y, z], rest: lattice.handle(x, y, z) });
    const byId = new Map(handles.map(row => [row.id, row]));
    const identities = bindings.length ? SplatProvenance.identities(source) : null;
    const restTrace = protectedGaps.length ? Meshes.rayQuery(mesh, K) : null;
    const restGaps = protectedGaps.map(gap => gap.probes.map(probe => gapSample(probe, geometry, geometry.positions, restTrace)));

    function preview(pose) {
      if (pose?.format !== format || pose.version !== 1 || pose.cage !== id ||
          !name(pose.id) || !Array.isArray(pose.moves) || pose.moves.length > handles.length)
        throw new RangeError('Expected a version 1 hybrid cage pose for ' + id);
      if (Meshes.revision(mesh) !== revision || source.data !== inputData || !source.meshes.includes(mesh))
        throw new RangeError('The hybrid cage source changed. Bind the cage again.');
      const map = K.deform.lattice(bounds, size), seen = new Set();
      for (const { handle, offset } of pose.moves) {
        const row = byId.get(handle);
        if (!row || seen.has(handle) || !vector(offset, coordinate) || !V.add(row.rest, offset).every(coordinate))
          throw new RangeError('Cage poses need unique handle IDs and bounded XYZ offsets');
        seen.add(handle);
        map.move(...row.at, offset);
      }
      const xyz = geometry.positions.slice();
      if (seen.size) {
        for (let i = 0; i < mesh.vertices; i++) xyz.set(map(pointAt(geometry.positions, i)), i * 3);
      }
      const replacement = Meshes.withPose(mesh, xyz);
      const world = forkWorld(source, mesh, replacement, groups.length);
      const cells = inspectCells(map, bounds, size), stretching = stretch(geometry, xyz, stretchLimit);
      const grown = groups.map(({ id, binding }) => ({ id, ...binding.poseOnMesh(world, replacement, map) }));
      const splats = poseSplats(world, source, bindings, identities, geometry, xyz, map, inside);
      const trace = protectedGaps.length ? Meshes.rayQuery(replacement, K) : null;
      const clearance = protectedGaps.map(({ id, probes, minWidth }, i) => {
        const samples = probes.map((probe, j) => {
          const rest = K.procedural.data.clone(restGaps[i][j]), posed = gapSample(probe, geometry, xyz, trace);
          const change = rest.width !== null && posed.width !== null ? posed.width - rest.width : null;
          return { rest, posed, change, violated: posed.width === null || posed.width + 1e-7 < minWidth || !!posed.obstruction };
        });
        return { id, minWidth, samples, violated: samples.some(row => row.violated) };
      });
      const failedAttachments = [
        ...grown.flatMap(group => group.strands.filter(row => !row.attached)
          .map(row => ({ kind: 'strand', group: group.id, id: row.id, reason: 'root-unavailable' }))),
        ...splats.filter(row => row.reason).map(({ id, reason }) => ({ kind: 'splat', id, reason }))
      ];
      const ready = !failedAttachments.length && !cells.folds.length &&
        !stretching.triangles.some(row => row.collapsed) && !clearance.some(row => row.violated);
      return { world, report: { cage: id, pose: pose.id, mesh: meshId, meshRevision: revision, ready,
        handles: handles.map(({ id, at, rest }) => ({ id, at: at.slice(), rest: rest.slice(), point: map.handle(...at) })),
        cells, stretching, grown, splats, failedAttachments, clearance } };
    }

    function apply(pose) {
      const result = preview(pose);
      if (!result.report.ready) throw Object.assign(new Error('Hybrid cage pose failed its preview checks'), { report: result.report });
      return result;
    }
    return Object.freeze({ preview, apply });
  }

  K.deform.hybridCage = create;
})(KIT);
