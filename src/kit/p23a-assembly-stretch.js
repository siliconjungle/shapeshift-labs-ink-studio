/* Affine rest-space edits from two picks, with explicit mating and joint checks. */
(function (K) {
  const { V, M } = K, DIO = K.diorama;
  const { clone, freeze } = K.procedural.data;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const name = TargetSelectors.name;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const angle = value => nonnegative(value) && value <= 180;
  const eps = 1e-7, defaultGap = .015;
  const modes = ['stretch', 'rigid', 'fixed'];
  const withRecipeSockets = ['pillar', 'arch', 'stairs', 'fence', 'pipe'];

  function namedRows(value, keys, valid, label) {
    if (!Array.isArray(value) || !Array.from(value).every(row => fields(row, keys) && valid(row)))
      throw new TypeError('Invalid assembly ' + label);
    return value;
  }

  function pick(resolve, input) {
    if (!fields(input, ['solid', 'socket', 'point', 'pivot']) || !name(input.solid) ||
        [input.socket, input.point, input.pivot].filter(value => value !== undefined).length !== 1 ||
        input.socket !== undefined && !name(input.socket) || input.point !== undefined && !xyz(input.point) ||
        input.pivot !== undefined && input.pivot !== true)
      throw new TypeError('A pick needs a solid and one socket, local XYZ point, or pivot: true');
    const row = resolve(input.solid), frame = DIO.solidFrames.rest(row);
    const authored = input.socket === undefined ? undefined : row.sockets?.[input.socket];
    if (input.socket !== undefined && !authored)
      throw new RangeError('Unknown authored socket ' + input.solid + '/' + input.socket);
    const local = input.point ?? authored?.p ?? row.transform?.pivot ?? row.at ?? [0, 0, 0];
    const point = K.sceneGraph.point(frame, local);
    const direction = authored && V.norm(M.app(frame.matrix, authored.dir ?? [0, 1, 0]));
    return { solid: input.solid, local, point, ...(direction && { direction }) };
  }

  function deformation(anchor, handle, length, width, up) {
    const line = V.sub(handle, anchor), originalLength = V.len(line);
    if (!(originalLength > eps) || !Number.isFinite(originalLength) || !Number.isFinite(length) || length <= eps)
      throw new RangeError('Choose distinct picks and a positive finite assembly length');
    const ratio = length / originalLength;
    if ([ratio, ...width].some(value => !Number.isFinite(value) || value < .02 || value > 20))
      throw new RangeError('Assembly scale factors need to be between 0.02 and 20');
    const along = V.mul(line, 1 / originalLength), projected = V.mad(up, along, -V.dot(up, along));
    if (V.len(projected) <= eps && width[0] !== width[1])
      throw new RangeError('Choose a cross-section up vector away from the handle axis');
    const vertical = V.norm(projected, V.perp(along)), across = V.cross(vertical, along);
    const basis = M.tr([...along, ...across, ...vertical]), factors = [ratio, ...width];
    const matrix = M.mul(basis.map((value, i) => value * factors[i % 3]), M.tr(basis));
    const frame = K.sceneGraph.transform({ matrix, position: V.sub(anchor, M.app(matrix, anchor)) });
    return { frame, factors, along, originalLength };
  }

  function distanceAngle(a, b) {
    if (V.len(a) <= eps || V.len(b) <= eps) return null;
    return Math.acos(K.clamp(V.dot(V.norm(a), V.norm(b)), -1, 1)) * 180 / Math.PI;
  }

  function connected(members, resolve, connections, parts, start) {
    const edges = new Map([...members.keys()].map(id => [id, new Set()]));
    function link(a, b) {
      if (!edges.has(a) || !edges.has(b)) return;
      edges.get(a).add(b);
      edges.get(b).add(a);
    }
    for (const { a, b } of connections) link(a.solid, b.solid);
    const byPart = new Map();
    for (const id of edges.keys()) {
      const { part } = resolve(id);
      if (!part) continue;
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push(id);
    }
    for (const [part, ids] of byPart) {
      const parent = byPart.get(parts[part]?.parent)?.[0];
      if (parent !== undefined) link(ids[0], parent);
      for (const id of ids.slice(1)) link(ids[0], id);
    }
    const seen = new Set([start]), pending = [start];
    while (pending.length) for (const next of edges.get(pending.pop()))
      if (!seen.has(next)) { seen.add(next); pending.push(next); }
    return [...edges.keys()].filter(id => !seen.has(id));
  }

  function analyzeJoints(scene, parts, selected, mapPoint, limits, addIssue, env) {
    const carriers = new Map(), touched = new Set(), changes = {};
    function addCarrier(part, solid) {
      if (!part) return;
      if (!carriers.has(part)) carriers.set(part, []);
      carriers.get(part).push(solid);
      if (selected.has(solid)) touched.add(part);
    }
    for (const solid of scene.solids) if (!solid.hold && !solid.ghost && !solid.carve) addCarrier(solid.part, solid.id);
    for (const [id, mesh] of Object.entries(scene.topologyMeshes ?? {})) addCarrier(mesh.part, id);
    for (const part of limits.keys())
      if (!touched.has(part) || !parts[part]?.parent) throw new RangeError('Joint limit needs a selected child part with an authored parent: ' + part);
    const relevant = new Set(touched);
    for (const [part, row] of Object.entries(parts)) if (row.parent && (touched.has(part) || touched.has(row.parent))) {
      relevant.add(part);
      relevant.add(row.parent);
    }
    let rig;
    const rest = new Map();
    for (const part of relevant) {
      let point = parts[part]?.joint;
      if (point === undefined) {
        rig ??= DIO.build(scene, env).lab?.rig;
        const box = rig?.box(part);
        if (box) point = [(box.lo[0] + box.hi[0]) / 2, box.lo[1], (box.lo[2] + box.hi[2]) / 2];
      }
      if (!point) { addIssue('joint-unresolved', { part }); continue; }
      rest.set(part, point);
    }
    const positions = new Map();
    function sample(part, point) {
      const nodes = carriers.get(part) ?? [];
      return nodes.length ? nodes.map(id => ({ solid: id ?? null, point: mapPoint(id, point) })) : [{ solid: null, point }];
    }
    for (const [part, point] of rest) {
      const mapped = sample(part, point), after = (mapped.find(row => selected.has(row.solid)) ?? mapped[0]).point;
      positions.set(part, after);
      const gap = Math.max(...mapped.map(row => V.dist(row.point, after)));
      if (touched.has(part) && gap > eps)
        addIssue('shared-joint-slip', { part, gap, carriers: mapped });
      if (touched.has(part)) changes[part] = { ...parts[part], joint: after };
    }
    const rows = [];
    for (const part of relevant) {
      const before = rest.get(part), after = positions.get(part), parent = parts[part]?.parent;
      if (!before) continue;
      const row = { part, before, after, inferred: parts[part]?.joint === undefined };
      if (parent && rest.has(parent)) {
        row.parent = parent;
        const parentSites = sample(parent, before), gap = Math.max(...parentSites.map(site => V.dist(site.point, after)));
        row.gap = gap;
        const a = V.sub(before, rest.get(parent)), b = V.sub(after, positions.get(parent));
        row.length = { before: V.len(a), after: V.len(b) };
        row.swingDegrees = distanceAngle(a, b);
        const limit = limits.get(part);
        if (gap > (limit?.maxGap ?? defaultGap) + eps)
          addIssue('joint-slip', { part, parent, gap, limit: limit?.maxGap ?? defaultGap });
        if (limit) {
          row.limits = limit;
          if (row.length.after < (limit.minLength ?? 0) - eps || row.length.after > (limit.maxLength ?? Infinity) + eps)
            addIssue('joint-length-limit', { part, length: row.length, min: limit.minLength ?? null, max: limit.maxLength ?? null });
          if (limit.maxSwing !== undefined && (row.swingDegrees === null || row.swingDegrees > limit.maxSwing + eps))
            addIssue('joint-swing-limit', { part, degrees: row.swingDegrees, max: limit.maxSwing });
        }
      }
      rows.push(row);
    }
    return { rows, changes, animated: [...new Set((scene.motion ?? []).filter(row => touched.has(row.part)).map(row => row.part))] };
  }

  function carryDecals(scene, transforms, addIssue) {
    if (!scene.surfaceDecals) return { rows: [] };
    const document = K.surfaceDecals.create(scene.surfaceDecals), rows = [];
    const decals = document.decals.map(row => {
      const a = row.anchor, frame = transforms.get(a.object);
      if (!frame) return row;
      const push = value => M.app(frame.matrix, value);
      const right = push(V.cross(a.up, a.normal)), up = push(a.up), forward = push(a.normal);
      const unitRight = V.norm(right), unitUp = V.norm(up), normal = V.norm(forward);
      const skew = Math.max(Math.abs(V.dot(unitRight, unitUp)), Math.abs(V.dot(unitRight, normal)), Math.abs(V.dot(unitUp, normal)));
      if (a.node || skew > eps) {
        rows.push({ id: row.id, solid: a.object, status: 'needs-review' });
        addIssue('decal-projector-slip', { decal: row.id, solid: a.object, reason: a.node ? 'attached-node' : 'skew' });
        return row;
      }
      const extent = [V.len(right), V.len(up)], depth = V.len(forward);
      rows.push({ id: row.id, solid: a.object, status: 'carried' });
      return { ...row, anchor: { ...a, at: K.sceneGraph.point(frame, a.at), up: unitUp, normal,
        size: a.size.map((n, i) => n * extent[i]), depth: a.depth * depth, bias: a.bias * depth,
        maxStep: a.maxStep * depth }, ...(row.relief && { relief: { ...row.relief, height: row.relief.height * depth } }) };
    });
    return { rows, ...(rows.length && { document: { ...document, decals } }) };
  }

  function plan(scene, input, env) {
    if (!fields(input, ['members', 'anchor', 'handle', 'length', 'cross', 'up', 'connections', 'jointLimits']) ||
        scene.brushRegion != null)
      throw new TypeError('An assembly stretch needs an editable sculpt scene and a handle request');
    const request = clone(input), solids = scene.solids ?? [], parts = scene.parts ?? {};
    const rows = new Map(solids.filter(solid => solid.id && !solid.carve && !solid.ghost && !solid.hold && solid.kind !== 'ground')
      .map(solid => [solid.id, solid]));
    function resolve(id) {
      const solid = rows.get(id);
      if (!solid) throw new RangeError('Choose a named top-level exterior sculpt solid: ' + id);
      if (solid.sockets === undefined && withRecipeSockets.includes(solid.kind)) {
        const resolved = { ...solid, sockets: DIO.sculptRestTrace(scene, id, env).sockets };
        rows.set(id, resolved);
        return resolved;
      }
      return solid;
    }

    const { cross = [1, 1], up = [0, 1, 0], length } = request;
    if (!Array.isArray(cross) || cross.length !== 2 || !Array.from(cross).every(Number.isFinite) || !xyz(up) || V.len(up) <= eps)
      throw new TypeError('Supply two cross-section scale factors and a nonzero up vector');
    const definitions = namedRows(request.members, ['solid', 'mode', 'grip'], row =>
      name(row.solid) && modes.includes(row.mode ?? 'stretch') && (row.grip === undefined || row.mode === 'rigid'), 'members');
    const members = new Map(definitions.map(row => [resolve(row.solid).id, row]));
    if (members.size !== definitions.length || !members.size) throw new RangeError('Choose distinct assembly members');
    const anchor = pick(resolve, request.anchor), handle = pick(resolve, request.handle);
    if (!members.has(anchor.solid) || !members.has(handle.solid))
      throw new RangeError('The anchor and handle must pick assembly members');
    const { frame, along, factors, originalLength } = deformation(anchor.point, handle.point, length, cross, up);
    const connections = namedRows(request.connections ?? [], ['id', 'a', 'b', 'maxGap', 'maxAngle'], row =>
      name(row.id) && (row.maxGap === undefined || nonnegative(row.maxGap)) &&
      (row.maxAngle === undefined || angle(row.maxAngle)), 'connections').map(row =>
        ({ ...row, a: pick(resolve, row.a), b: pick(resolve, row.b) }));
    if (new Set(connections.map(row => row.id)).size !== connections.length ||
        connections.some(row => !members.has(row.a.solid) && !members.has(row.b.solid)))
      throw new RangeError('Connections need distinct IDs and at least one assembly member');
    const limits = namedRows(request.jointLimits ?? [], ['part', 'minLength', 'maxLength', 'maxSwing', 'maxGap'], row =>
      name(row.part) && [row.minLength, row.maxLength, row.maxGap].every(value => value === undefined || nonnegative(value)) &&
      (row.minLength ?? 0) <= (row.maxLength ?? Infinity) && (row.maxSwing === undefined || angle(row.maxSwing)), 'joint limits');
    if (new Set(limits.map(row => row.part)).size !== limits.length)
      throw new RangeError('Use only one limit record per joint');

    const issues = [], addIssue = (code, data) => issues.push({ code, ...data });
    const selectedIndices = new Set(solids.flatMap((solid, index) => members.has(solid.id) ? [String(index)] : []));
    for (const binding of scene.parameterBindings?.bindings ?? []) {
      const [root, index, field] = K.world.data.selector(binding.path);
      if (root === 'solids' && selectedIndices.has(String(index)) &&
          (field === undefined || ['id', 'part', 'transform', 'restAffine', 'at', 'sockets'].includes(field)))
        addIssue('parameter-bound-frame', { path: binding.path });
    }
    const disconnected = connected(members, resolve, connections, parts, anchor.solid);
    if (disconnected.length) addIssue('disconnected-members', { members: disconnected });

    const transforms = new Map();
    for (const [id, { mode = 'stretch', grip }] of members) {
      if (mode === 'fixed') continue;
      if (mode === 'stretch') transforms.set(id, frame);
      else {
        const hold = grip !== undefined ? pick(resolve, { ...grip, solid: id }).point :
          id === anchor.solid ? anchor.point : id === handle.solid ? handle.point : pick(resolve, { solid: id, pivot: true }).point;
        transforms.set(id, K.sceneGraph.transform({ position: V.sub(K.sceneGraph.point(frame, hold), hold) }));
      }
    }
    const mapPoint = (id, point) => transforms.has(id) ? K.sceneGraph.point(transforms.get(id), point) : point;
    const mapDirection = (id, direction) => direction &&
      (transforms.has(id) ? V.norm(M.app(transforms.get(id).matrix, direction)) : direction);
    function verifyPick(id, picked, expected) {
      const after = mapPoint(picked.solid, picked.point), gap = V.dist(after, expected);
      if (gap > eps) addIssue(id + '-slip', { solid: picked.solid, expected, after, gap });
      return { solid: picked.solid, before: picked.point, after, expected };
    }
    const anchorReport = verifyPick('anchor', anchor, anchor.point);
    const handleReport = verifyPick('handle', handle, V.mad(anchor.point, along, length));

    const mating = connections.map(({ id, a, b, maxGap = defaultGap, maxAngle }) => {
      const before = V.dist(a.point, b.point), points = [mapPoint(a.solid, a.point), mapPoint(b.solid, b.point)];
      const after = V.dist(...points), u = mapDirection(a.solid, a.direction), v = mapDirection(b.solid, b.direction);
      const facing = u && v ? distanceAngle(u, V.mul(v, -1)) : null;
      if (after > maxGap + eps) addIssue('socket-gap', { id, before, after, maxGap, points });
      if (maxAngle !== undefined && (facing === null || facing > maxAngle + eps))
        addIssue('socket-angle', { id, degrees: facing, maxAngle });
      return { id, solids: [a.solid, b.solid], gap: { before, after }, points, maxGap,
        ...(facing !== null && { facingDegrees: facing }), ...(maxAngle !== undefined && { maxAngle }) };
    });
    const joints = analyzeJoints(scene, parts, members, mapPoint, new Map(limits.map(row => [row.part, row])), addIssue, env);
    const decals = carryDecals(scene, transforms, addIssue);

    const geometry = solids.map(solid => {
      if (!members.has(solid.id)) return solid;
      const changed = resolve(solid.id), affine = transforms.get(solid.id);
      return affine ? { ...changed, restAffine: K.sceneGraph.compose(affine, K.sceneGraph.transform(solid.restAffine)) } : changed;
    });
    const carried = [...members].map(([id, options]) => {
      const solid = resolve(id), pose = DIO.solidFrames.rest(solid);
      const pivot = K.sceneGraph.point(pose, solid.transform?.pivot ?? solid.at ?? [0, 0, 0]);
      const sockets = Object.entries(solid.sockets ?? {}).map(([name, { p, dir = [0, 1, 0] }]) => {
        const before = K.sceneGraph.point(pose, p);
        return { name, before, after: mapPoint(id, before), direction: mapDirection(id, V.norm(M.app(pose.matrix, dir))) };
      });
      return { solid: id, mode: options.mode ?? 'stretch', pivot: { before: pivot, after: mapPoint(id, pivot) },
        sockets, paint: { strokes: (solid.sdfPaint?.strokes ?? []).map(row => row.id),
          ...(solid.sdfSpray && { sprays: solid.sdfSpray.map(row => row.id) }),
          charts: Object.keys(solid.surfaceState?.charts ?? {}) } };
    });
    return { patch: { solids: geometry, ...(Object.keys(joints.changes).length && { parts: { ...parts, ...joints.changes } }),
      ...(decals.document && { surfaceDecals: decals.document }) },
    report: freeze(clone({ canCommit: !issues.length, space: 'scene-rest', length: { before: originalLength, requested: length,
      after: V.dist(anchorReport.after, handleReport.after) }, factors, anchor: anchorReport, handle: handleReport,
      members: carried, connections: mating, joints: joints.rows, animatedParts: joints.animated, decals: decals.rows, issues })) };
  }

  K.authoring.assemblyStretch = Object.freeze({ plan });
})(KIT);
