/* Complementary hard masks retain editable sculpt recipes and rest attachments. */
(function (K) {
  const DIO = K.diorama, { V } = K;
  const { clone, freeze } = K.procedural.data;
  const id = value => K.world.data.id(value), record = value => K.world.data.record(value);
  const fields = (value, names) => record(value) && Object.keys(value).every(name => names.includes(name));
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const limit = 15, eps = 1e-6;

  function finiteBounds(solid) {
    if (!Number.isFinite(solid?.br) || solid.br >= 1e8)
      throw new RangeError('A sculpt split needs a finite source and a bounded cutter');
    return solid.geometryBounds ?? {
      min: solid.bc.map(n => n - solid.br),
      max: solid.bc.map(n => n + solid.br)
    };
  }

  function boxForPlane(plane, source) {
    if (!fields(plane, ['kind', 'at', 'normal']) || !xyz(plane.at) || !xyz(plane.normal) || V.len(plane.normal) < eps)
      throw new TypeError('A split plane needs an XYZ point and a nonzero normal');
    const normal = V.norm(plane.normal);
    const radius = V.dist(source.bc, plane.at) + source.br + Math.max(.01, source.res * 2);
    return { kind: 'box', at: V.mad(plane.at, normal, radius), half: [radius, radius, radius],
      turn: [Math.atan2(normal[0], normal[2]), -Math.asin(normal[1]), 0] };
  }

  function cutterShape(cutter, source) {
    if (cutter?.kind === 'plane') return boxForPlane(cutter, source);
    const restricted = ['id', 'part', 'group', 'carve', 'ghost', 'hold', 'separate', 'bump', 'sockets'];
    function check(shape) {
      if (!record(shape) || !Object.hasOwn(DIO.kinds, shape.kind) || shape.kind === 'ground' ||
          restricted.some(key => Object.hasOwn(shape, key)))
        throw new TypeError('A split cutter needs a bounded native shape without ownership or stochastic bump');
      for (const key of DIO.operandFields(shape)) check(shape[key]);
      for (const modifier of Array.isArray(shape.modifiers) ? shape.modifiers : [])
        if (modifier?.shape !== undefined) check(modifier.shape);
    }
    check(cutter);
    return cutter;
  }

  function copyBindings(program, sourceIndex, extractionIndex) {
    const copies = [];
    for (const row of program?.bindings ?? []) {
      const path = K.world.data.selector(row.path);
      if (path[0] !== 'solids' || String(path[1]) !== String(sourceIndex)) continue;
      const [, , field, ...tail] = path;
      if (field === undefined || field === 'id' || field === 'sockets' || field === 'modifiers' && !tail.length)
        throw new RangeError('A split cannot copy a parameter that replaces the solid, its ID, socket map, or entire modifier stack');
      copies.push({ ...row, path: ['solids', extractionIndex, field, ...tail] });
    }
    return copies.length ? { ...program, bindings: [...program.bindings, ...copies] } : undefined;
  }

  function proof(trace, stage, plane) {
    const { before, operand, after } = stage;
    const sourceBounds = finiteBounds(before), cutterBounds = finiteBounds(operand);
    const overlap = { min: sourceBounds.min.map((n, i) => Math.max(n, cutterBounds.min[i])),
      max: sourceBounds.max.map((n, i) => Math.min(n, cutterBounds.max[i])) };
    const regions = [sourceBounds];
    if (overlap.min.every((n, i) => n < overlap.max[i])) regions.push(overlap);
    const where = point => trace.distance(operand, point);
    const original = point => trace.distance(before, point);
    const normal = plane && V.norm(plane.normal);
    let outside, inside, seam;
    function nearPlane(point) {
      const contact = V.mad(point, normal, V.dot(V.sub(plane.at, point), normal));
      const depth = -original(contact);
      if (depth <= eps * 4) return;
      const step = Math.min(depth / 2, before.res / 2);
      const a = V.mad(contact, normal, step), b = V.mad(contact, normal, -step);
      if (where(a) < -eps && original(a) < -eps) inside ??= a;
      if (where(b) > eps && original(b) < -eps) outside ??= b;
      seam ??= contact;
    }
    function boundary(a, b) {
      const sign = a.distance < 0;
      let lo = a.point, hi = b.point;
      for (let i = 0; i < 24; i++) {
        const mid = V.lerp(lo, hi, .5);
        if ((where(mid) < 0) === sign) lo = mid;
        else hi = mid;
      }
      const point = V.lerp(lo, hi, .5);
      if (original(point) < -eps) seam = point;
    }

    for (const { min, max } of regions) {
      const grid = [];
      for (let x = 0; x < limit; x++) for (let y = 0; y < limit; y++) for (let z = 0; z < limit; z++) {
        const point = [x, y, z].map((n, i) => min[i] + (max[i] - min[i]) * (n + .5) / limit);
        const distance = where(point), inSource = original(point) < -eps;
        if (inSource && plane && (!inside || !outside)) nearPlane(point);
        if (inSource && distance < -eps) inside ??= point;
        if (inSource && distance > eps && trace.distance(after, point) < -eps) outside ??= point;
        const cell = { point, distance, inSource };
        if (inSource && !seam) {
          const previous = [x && grid.at(-(limit ** 2)), y && grid.at(-limit), z && grid.at(-1)];
          for (const neighbor of previous) {
            if (neighbor?.inSource && (neighbor.distance < 0) !== (distance < 0)) boundary(neighbor, cell);
            if (seam) break;
          }
        }
        grid.push(cell);
      }
    }
    if (!inside || !outside) throw new RangeError('The cutter needs to leave measurable volume on both sides of the split');
    if (!seam) boundary({ point: inside, distance: where(inside) }, { point: outside, distance: where(outside) });
    return { inside, outside, seam, where };
  }

  function socketSplit(sockets, where, original, extracted) {
    const outside = {}, inside = {}, rows = [];
    for (const [name, socket] of Object.entries(sockets)) {
      const distance = where(socket.p), side = distance < -eps ? 'extracted' : 'remainder';
      const piece = side === 'extracted' ? extracted : original;
      (side === 'extracted' ? inside : outside)[name] = socket;
      rows.push({ name, owner: piece, address: piece + '/' + name, from: original + '/' + name,
        side, onBoundary: Math.abs(distance) <= eps, position: socket.p });
    }
    return { outside, inside, rows };
  }

  function paintReport(scene, source, where) {
    const strokes = (source.sdfPaint?.strokes ?? []).map(row => {
      const anchors = { remainder: 0, extracted: 0, boundary: 0 };
      for (const [, , point] of row.cells) {
        const distance = where(point);
        anchors[Math.abs(distance) <= eps ? 'boundary' : distance < 0 ? 'extracted' : 'remainder']++;
      }
      return { id: row.id, anchors, retained: 'both' };
    });
    const charts = [];
    for (const solid of DIO.solids({ solids: [source] }))
      for (const name of Object.keys(solid.surfaceState?.charts ?? {}))
        charts.push({ id: name, ...(solid.id && { solid: solid.id }), retained: 'both' });
    const decals = (scene.surfaceDecals?.decals ?? []).filter(row => row.anchor.object === source.id)
      .map(row => ({ id: row.id, owner: source.id, retained: 'original-receiver', reviewExtraction: true }));
    return { strokes, charts, decals, ...(source.sdfProtection && { protection: 'both' }), newFaces: 'no-sculpt-paint' };
  }

  function materialIds(source) {
    const ids = new Set();
    function add(mat) {
      const key = typeof mat === 'string' ? mat : mat?.materialId ?? mat?.role;
      if (key) ids.add(key);
    }
    const usesRightMaterial = how => !/^(cut|engrave|groove)/.test(how);
    function visit(solid) {
      const operands = DIO.operandFields(solid);
      add(solid.mat ?? (!operands.length ? 'stone' : undefined));
      for (const key of operands)
        if (solid.kind !== 'join' || key !== 'b' || usesRightMaterial(solid.how)) visit(solid[key]);
      for (const stroke of solid.sdfPaint?.strokes ?? []) add(stroke.material);
      for (const row of solid.modifiers ?? []) {
        if (row.kind === 'join' && usesRightMaterial(row.how)) visit(row.shape);
        add(row.cutSurface?.material);
        for (const surface of Object.values(row.brush?.settings?.surface ?? {})) {
          add(surface.material);
          add(surface.edge?.material);
        }
      }
    }
    visit(source);
    return [...ids].sort();
  }

  function plan(scene, input, env) {
    if (!fields(input, ['solid', 'extract', 'id', 'cutter', 'capMaterial']) ||
        !TargetSelectors.name(input.solid) || !id(input.extract) || !id(input.id))
      throw new TypeError('A split needs a source solid, a new extract ID, a cut ID and a cutter');
    const request = clone(input);
    const sourceIndex = scene.solids?.findIndex(solid => solid.id === request.solid) ?? -1;
    const source = scene.solids?.[sourceIndex];
    if (!source || source.kind === 'ground' || source.carve || source.hold || source.ghost || scene.brushRegion != null)
      throw new RangeError('Choose a named top-level exterior solid with a native sculpt field');
    if ([...DIO.solids(scene)].some(solid => solid.id === request.extract) ||
        Object.hasOwn(scene.topologyMeshes ?? {}, request.extract) || Object.hasOwn(scene.assetParts ?? {}, request.extract))
      throw new RangeError('Extract ID is already in use: ' + request.extract);
    const stack = source.modifiers ?? [];
    if (stack.some(modifier => modifier.id === request.id)) throw new RangeError('Cut ID is already in use: ' + request.id);
    const parameterBindings = copyBindings(scene.parameterBindings, sourceIndex, scene.solids.length);
    const trace = (value, solid) => DIO.sculptRestTrace(value, solid, env, { measureBounds: true });
    const original = trace(scene, request.solid);
    finiteBounds(original.output);
    const shape = cutterShape(request.cutter, original.output);
    const retained = clone(source);
    // Native bump noise defaults to an allocation phase. Pin the source phase in each copy.
    for (const [index, solid] of [...DIO.solids({ solids: [retained] })].entries()) {
      const phase = original.memberBumpPhases[index];
      if (phase !== undefined) solid.bumpPhase = phase;
    }
    const mask = mode => ({ id: request.id, kind: 'mask', mode, shape,
      cutSurface: request.capMaterial === undefined ? {} : { material: request.capMaterial } });
    const remainder = { ...retained, modifiers: [...(retained.modifiers ?? []), mask('cut')] };
    const candidate = scene.solids.slice();
    candidate[sourceIndex] = remainder;
    const trial = trace({ ...scene, solids: candidate }, source.id);
    const stage = trial.stages.get(request.id);
    if (!stage?.operand) throw new RangeError('The split cutter could not be evaluated');
    const { inside, outside, seam, where } = proof(trial, stage, request.cutter.kind === 'plane' ? request.cutter : undefined);
    const sockets = socketSplit(original.sockets, where, source.id, request.extract);
    const extracted = clone(retained);
    for (const solid of DIO.solids({ solids: [extracted] }))
      if (solid.id !== undefined) solid.id = solid === extracted ? request.extract : request.extract + '/' + solid.id;
    extracted.modifiers = [...(extracted.modifiers ?? []), mask('keep')];
    if (source.sockets !== undefined || sockets.rows.length) {
      remainder.sockets = sockets.outside;
      extracted.sockets = sockets.inside;
    }
    candidate.push(extracted);
    const patch = { solids: candidate, ...(parameterBindings && { parameterBindings }) };
    const extractedTrace = trace({ ...scene, ...patch }, request.extract);
    if (extractedTrace.distance(extractedTrace.output, inside) >= -eps)
      throw new RangeError('The extracted piece could not retain the interior witness');
    const cap = stage.after.mat.cutSurface?.locate(seam ?? inside, [0, 1, 0]);
    const capId = cap?.materialId ?? (typeof request.capMaterial === 'string' ? request.capMaterial :
      request.capMaterial?.materialId ?? request.capMaterial?.role ?? stage.before.mat.materialId);
    return { patch, report: freeze(clone({
      solid: source.id, extracted: request.extract, space: 'solid-rest', ...(source.part && { part: source.part }),
      boundary: { id: request.id, cutter: shape, ...(seam && { witness: seam }), intersectsInterior: Boolean(seam) },
      pieces: { remainder: { id: source.id, witness: outside }, extracted: { id: request.extract, witness: inside } },
      paint: paintReport(scene, source, where), sockets: sockets.rows,
      materials: { retainedIds: materialIds(source), cutId: capId ?? null }
    })) };
  }

  K.authoring.sculptSplit = Object.freeze({ plan });
})(KIT);
