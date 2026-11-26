/* Retained stroke and stamp operations expanded into ordinary sculpt recipes. */
(function (K) {
  const A = K.authoring, DIO = K.diorama, { V, M } = K;
  const { clone, freeze } = K.procedural.data;
  const names = ['x', 'y', 'z'], axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const rad = Math.PI / 180;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const properName = value => K.world.data.id(value) && !value.includes('.') && value.length <= 72;
  const degrees = value => Number.isFinite(value) && value > 0 && value <= 360;
  const axis = (basis, name) => basis[names.indexOf(name)];
  const G = () => K.sceneGraph;

  function guideSettings(raw) {
    if (!fields(raw, ['space', 'origin', 'mirror', 'radial', 'angleIncrement', 'upright', 'grid']))
      throw new TypeError('Expected sculpt operation guides');
    const { space = 'local', origin = [0, 0, 0], mirror, radial, angleIncrement, upright = false, grid } = raw;
    if (!['world', 'local', 'construction-plane'].includes(space) || !xyz(origin) ||
        angleIncrement !== undefined && !degrees(angleIncrement) || typeof upright !== 'boolean' ||
        grid !== undefined && grid !== true && (!Number.isFinite(grid) || grid <= 0) ||
        grid === true && space !== 'construction-plane')
      throw new RangeError('Choose a guide frame, finite origin, valid angle increment, and optional grid spacing');
    if (mirror !== undefined && (!fields(mirror, ['axis', 'side', 'clip']) || !names.includes(mirror.axis) ||
        !['positive', 'negative'].includes(mirror.side ?? 'positive') ||
        mirror.clip !== undefined && typeof mirror.clip !== 'boolean'))
      throw new TypeError('A mirror needs an XYZ axis, source side, and optional clipping');
    if (radial !== undefined && (!fields(radial, ['axis', 'count', 'stepDegrees']) || !names.includes(radial.axis ?? 'y') ||
        !Number.isSafeInteger(radial.count) || radial.count < 1 || radial.count > 32 ||
        radial.stepDegrees !== undefined && !degrees(radial.stepDegrees)))
      throw new RangeError('A radial guide needs 1–32 copies, an XYZ axis and an optional angle step');
    return { space, origin, mirror, radial, angleIncrement, upright, grid };
  }

  function around(matrix, at, to = at) {
    return G().transform({ matrix, position: V.sub(to, M.app(matrix, at)) });
  }

  function upFrame(matrix) {
    const y = V.norm(M.app(matrix, axes[1]));
    const z = M.app(matrix, axes[2]);
    const forward = V.norm(V.mad(z, y, -V.dot(z, y)), V.perp(y));
    return [V.cross(y, forward), y, forward];
  }

  function family(scene, host, transform, raw) {
    const settings = guideSettings(raw);
    const { space, origin, mirror, radial, angleIncrement, upright, grid } = settings;
    const graph = G(), parent = graph.transform(host && DIO.solidFrames.rest(host)), inverse = graph.inverse(parent);
    const base = DIO.solidFrames.authored(transform).mesh, world = graph.compose(parent, base);
    const root = graph.point(world, transform?.pivot ?? [0, 0, 0]);
    const construction = space === 'construction-plane' ? A.constructionPlane.forScene(scene) : null;
    const basis = construction?.axes ?? (space === 'local' ? upFrame(parent.matrix) : axes);
    const localAnchor = host?.transform?.pivot ?? host?.at ?? [0, 0, 0];
    const anchor = construction?.plane.origin ?? (space === 'local' ? graph.point(parent, localAnchor) : [0, 0, 0]);
    const center = V.add(anchor, M.app(M.tr(basis.flat()), origin));
    const step = angleIncrement && angleIncrement * rad;
    const quantize = value => step ? Math.round(value / step) * step : value;
    let placedRoot = root;
    if (grid === true) {
      const shifted = { ...construction, plane: { ...construction.plane, origin: center } };
      const depth = V.dot(V.sub(root, center), basis[2]);
      placedRoot = V.mad(A.constructionPlane.project(shifted, root, 'grid').point, basis[2], depth);
    } else if (grid !== undefined) {
      const local = basis.map(vector => Math.round(V.dot(V.sub(root, center), vector) / grid) * grid);
      placedRoot = V.add(center, M.app(M.tr(basis.flat()), local));
    }
    const used = new Set(), rows = [];
    for (let i = 0; i < (radial?.count ?? 1); i++) {
      const angle = quantize(i * (radial?.stepDegrees ?? 360 / (radial?.count ?? 1)) * rad);
      const phase = ((angle / (2 * Math.PI) % 1) + 1) % 1;
      const key = Math.round(phase * 1e8) % 1e8;
      if (used.has(key)) throw new RangeError('Angular increments place two radial copies at the same angle');
      used.add(key);
      const rotation = M.rot(axis(basis, radial?.axis ?? 'y'), angle);
      const spin = around(rotation, center), rotatedRoot = graph.point(spin, placedRoot);
      const oriented = M.mul(rotation, world.matrix);
      const current = upFrame(oriented);
      const flat = V.mad(current[2], basis[1], -V.dot(current[2], basis[1]));
      const heading = V.len(flat) > 1e-8 ? Math.atan2(V.dot(flat, basis[0]), V.dot(flat, basis[2])) : 0;
      const snapped = quantize(heading);
      let correction = M.rot(basis[1], snapped - heading);
      if (upright) {
        const forward = M.app(M.rot(basis[1], snapped), basis[2]);
        const desired = M.cols(V.cross(basis[1], forward), basis[1], forward);
        correction = M.mul(desired, current.flat());
      }
      const mapped = around(M.mul(correction, rotation), root, rotatedRoot);
      const mirrorAxis = mirror && M.app(rotation, axis(basis, mirror.axis));
      for (const mirrored of mirror ? [false, true] : [false]) {
        const worldCopy = mirrored ? graph.compose(around(M.stretch(mirrorAxis, -1), center), mapped) : mapped;
        const copy = graph.compose(inverse, graph.compose(worldCopy, parent));
        const normal = mirrorAxis && V.mul(mirrorAxis, (mirror.side === 'negative' ? -1 : 1) * (mirrored ? -1 : 1));
        rows.push({ key: 'r' + i + (mirrored ? '-mirror' : ''), angleDegrees: angle / rad, mirrored,
          frame: copy, world: worldCopy, point: graph.point(worldCopy, root),
          up: V.norm(M.app(worldCopy.matrix, M.app(world.matrix, axes[1]))),
          ...(mirror?.clip !== false && normal && { clip: { at: center, normal } }) });
      }
    }
    return rows;
  }

  function clip(shape, worldPlane, carrier) {
    if (!worldPlane) return shape;
    const graph = G(), frame = graph.compose(carrier, DIO.solidFrames.rest(shape));
    const list = shape.modifiers ?? [];
    let id = 'guide-clip', suffix = 2;
    while (list.some(row => row.id === id)) id = 'guide-clip-' + suffix++;
    return { ...shape, modifiers: [...list, { id, kind: 'clip-plane',
      // A microscopic shared overlap removes the internal zero at the mirror seam.
      at: graph.point(graph.inverse(frame), V.mad(worldPlane.at, worldPlane.normal, -.00001)),
      normal: V.norm(M.app(M.tr(frame.matrix), worldPlane.normal)) }] };
  }

  function stroke(scene, op, host, copies) {
    if (!host || !fields(op.stroke, ['op', 'brush', 'poses', 'step', 'blendRadius', 'mat', 'snap', 'transform']) ||
        !['add', 'cut'].includes(op.stroke.op) || op.stroke.op === 'cut' && op.stroke.mat !== undefined)
      throw new TypeError('A guided stroke needs a named target and an additive or subtractive sweep');
    const { op: effect, snap, ...shape } = op.stroke, existing = host.modifiers ?? [];
    const carrier = DIO.solidFrames.rest(host);
    const modifiers = copies.map(copy => {
      const id = op.id + '-' + copy.key;
      if (existing.some(row => row.id === id)) throw new RangeError('Guided stroke ID is already in use: ' + id);
      const operand = clip({ kind: 'sweep', ...shape, restAffine: copy.frame }, copy.clip, carrier);
      const snapped = snap && { ...snap, ...(snap.direction && { direction: V.norm(M.app(copy.frame.matrix, snap.direction)) }) };
      return { id, ...(effect === 'cut' ? { kind: 'mask', mode: 'cut' } : { kind: 'join', how: 'union', preserveRamps: true }),
        shape: operand, ...(snapped && { snap: snapped, snapGroup: op.id }) };
    });
    return { solids: scene.solids.map(row => row === host ? { ...host, modifiers: [...existing, ...modifiers] } : row),
      ids: modifiers.map(row => row.id) };
  }

  function stamp(scene, op, host, copies) {
    if (!fields(op.placement ?? {}, ['transform']) || !op.stamp)
      throw new TypeError('A guided stamp needs a compound stamp recipe and optional placement transform');
    const graph = G(), carrier = host ? DIO.solidFrames.rest(host) : graph.transform();
    const recipe = clone(op.stamp);
    const definitions = [...Object.values(recipe.add ?? {}), ...Object.values(recipe.cut ?? {}).map(row => row?.shape)];
    for (const [i, shape] of [...DIO.solids({ solids: definitions })].entries())
      if (shape.bump && shape.bumpPhase === undefined)
        shape.bumpPhase = K.procedural.data.hash(op.id + '/' + i, 0) % 4096;
    let solids = scene.solids;
    const ids = [];
    for (const copy of copies) {
      const target = op.target === undefined ? undefined : solids.find(row => row.id === op.target);
      const start = target?.modifiers?.length ?? 0;
      const placed = A.sculptStamps.place({ ...scene, solids }, recipe, { id: op.id + '-' + copy.key,
        ...(op.target !== undefined && { target: op.target }), ...op.placement });
      solids = placed.map((solid, i) => {
        if (i >= solids.length) {
          ids.push(solid.id);
          return clip({ ...solid, restAffine: graph.compose(copy.world, graph.transform(solid.restAffine)) }, copy.clip, graph.transform());
        }
        if (op.target === undefined || solid.id !== op.target || (solid.modifiers?.length ?? 0) === start) return solid;
        return { ...solid, modifiers: solid.modifiers.map((modifier, j) => j < start ? modifier : {
          ...modifier, shape: clip({ ...modifier.shape, restAffine: copy.frame }, copy.clip, carrier)
        }) };
      });
    }
    return { solids, ids };
  }

  function expand(source) {
    if (source?.guidedOperations === undefined) return { scene: source, reports: [] };
    const { guidedOperations, ...rest } = source;
    if (!Array.isArray(guidedOperations) || !Array.isArray(rest.solids) || rest.brushRegion != null)
      throw new TypeError('Guided operations need a diorama with native sculpt solids');
    let scene = rest;
    const ids = new Set(), reports = [];
    for (const op of guidedOperations) {
      if (!fields(op, ['id', 'type', 'target', 'guides', 'stroke', 'stamp', 'placement']) ||
          !properName(op.id) || ids.has(op.id) || !['stroke', 'stamp'].includes(op.type) ||
          (op.type === 'stroke' ? op.stamp !== undefined || op.placement !== undefined : op.stroke !== undefined))
        throw new TypeError('Guided operations need unique IDs and a stroke or stamp recipe');
      ids.add(op.id);
      const host = op.target === undefined ? undefined : scene.solids.find(row => row.id === op.target);
      if (op.target !== undefined && (!TargetSelectors.name(op.target) || !host ||
          host.kind === 'ground' || host.carve || host.ghost || host.hold))
        throw new RangeError('Choose a named exterior sculpt for the guided operation: ' + op.id);
      const copies = family(scene, host, op.stroke?.transform ?? op.placement?.transform, op.guides);
      const result = op.type === 'stroke' ? stroke(scene, op, host, copies) : stamp(scene, op, host, copies);
      scene = { ...scene, solids: result.solids };
      reports.push({ id: op.id, type: op.type, ...(host && { target: host.id }), copies: copies.map(row => ({
        key: row.key, mirrored: row.mirrored, angleDegrees: row.angleDegrees, origin: row.point, up: row.up,
        ...(row.clip && { clip: row.clip })
      })), generatedIds: result.ids });
    }
    return { scene, reports };
  }

  function revise(scene, input, update) {
    const value = clone(input), operations = scene.guidedOperations ?? [];
    const index = operations.findIndex(row => row.id === value?.id);
    if (!properName(value?.id) || (update ? index === -1 : index !== -1))
      throw new RangeError(update ? 'Unknown guided operation' : 'Choose a new guided operation ID');
    if (update && !fields(value, ['id', 'guides', 'stroke', 'stamp', 'placement']))
      throw new TypeError('A guide edit needs an operation ID and updated settings');
    let guidedOperations;
    if (update) {
      const { guides: patch = {}, stroke, stamp, placement } = value, old = operations[index];
      if (!record(patch) || stroke !== undefined && (old.type !== 'stroke' || !record(stroke)) ||
          (stamp !== undefined || placement !== undefined) && old.type !== 'stamp' ||
          placement !== undefined && !record(placement))
        throw new TypeError('Revisions must address the existing guided recipe type');
      const guides = { ...old.guides, ...patch };
      for (const key of ['mirror', 'radial']) {
        if (patch[key] === null) delete guides[key];
        else if (record(patch[key])) guides[key] = { ...old.guides[key], ...patch[key] };
      }
      const revised = { ...old, guides, ...(stroke && { stroke: { ...old.stroke, ...stroke } }),
        ...(stamp !== undefined && { stamp }), ...(placement && { placement: { ...old.placement, ...placement } }) };
      guidedOperations = operations.map((row, i) => i === index ? revised : row);
    } else guidedOperations = [...operations, value];
    return guidedOperations;
  }

  function inspect(scene, env) {
    return freeze(expand(A.scenePrefabs.expand(scene, env).spec).reports);
  }

  A.sculptGuides = Object.freeze({ expand, revise, inspect });
})(KIT);
