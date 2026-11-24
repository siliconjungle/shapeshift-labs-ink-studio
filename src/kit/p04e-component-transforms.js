/* Position-only topology edits preserve polygon, corner, edge and UV identity. */
const meshComponentSnap = (function (K) {
  const topology = K.meshTopology, { V, M } = K, { freeze } = K.procedural.data;
  const record = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => fields.includes(key));
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const name = value => typeof value === 'string' && !!value.trim();
  const unit = (value, label) => {
    if (!vector(value) || !Number.isFinite(V.len(value)) || V.len(value) === 0) throw new TypeError(label + ' needs a nonzero XYZ direction');
    return V.mul(value, 1 / V.len(value));
  };
  const average = values => V.mul(values.reduce(V.add, [0, 0, 0]), 1 / values.length);
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const other = (ends, id) => ends[ends[0] === id ? 1 : 0];

  function operation(raw) {
    if (record(raw, ['kind', 'offset']) && raw.kind === 'move' && vector(raw.offset))
      return (_, weight) => V.mul(raw.offset, weight);
    if (record(raw, ['kind', 'axis', 'degrees']) && raw.kind === 'rotate' && Number.isFinite(raw.degrees)) {
      const axis = unit(raw.axis, 'Rotation'), angle = raw.degrees * (Math.PI / 180);
      return (p, weight) => V.sub(M.app(M.rot(axis, angle * weight), p), p);
    }
    if (record(raw, ['kind', 'factors']) && raw.kind === 'scale') {
      const factors = typeof raw.factors === 'number' ? [raw.factors, raw.factors, raw.factors] : raw.factors;
      if (vector(factors) && factors.every(value => value > 0))
        return (p, weight) => p.map((value, i) => value * (factors[i] - 1) * weight);
    }
    throw new TypeError('Use a move offset, rotation axis and degrees, or positive scale factors');
  }

  function pins(doc, selection, selected, raw = {}) {
    if (!record(raw, ['vertices', 'boundary']) || raw.vertices !== undefined && !Array.isArray(raw.vertices) ||
        raw.boundary !== undefined && !['mesh', 'selection', 'both'].includes(raw.boundary))
      throw new TypeError('Pin vertex IDs or use a mesh, selection, or both boundary mode');
    const known = index(doc.vertices), fixed = new Set(raw.vertices ?? []);
    for (const id of fixed) if (!known.has(id)) throw new RangeError('Unknown pinned vertex ' + id);
    const pinEdges = ids => {
      const edges = index(doc.edges);
      for (const id of ids) for (const vertex of edges.get(id).vertices) fixed.add(vertex);
    };
    if (raw.boundary === 'mesh' || raw.boundary === 'both')
      pinEdges(topology.select(doc, { domain: 'edges', traverse: 'boundary' }).ids);
    if (raw.boundary === 'selection' || raw.boundary === 'both') {
      if (selection.domain === 'faces') pinEdges(topology.select(doc, { from: selection, traverse: 'boundary' }).ids);
      if (selection.domain === 'edges') {
        const degrees = new Map(), edges = index(doc.edges);
        for (const id of selection.ids) for (const vertex of edges.get(id).vertices)
          degrees.set(vertex, (degrees.get(vertex) ?? 0) + 1);
        for (const [id, degree] of degrees) if (degree !== 2) fixed.add(id);
      }
      if (selection.domain === 'vertices') for (const ends of doc.edges.map(row => row.vertices))
        for (const id of ends) if (selected.has(id) && !selected.has(other(ends, id))) fixed.add(id);
    }
    return fixed;
  }

  function influence(doc, points, selected, fixed, falloff) {
    const movable = [...selected].filter(id => !fixed.has(id));
    const weights = new Map(movable.map(id => [id, 1]));
    if (falloff === undefined) return weights;
    if (!record(falloff, ['radius', 'curve'])) throw new TypeError('Use a connected falloff radius and optional curve');
    const { radius, curve = 'smooth' } = falloff;
    if (!Number.isFinite(radius) || radius <= 0 || !['linear', 'smooth', 'sharp'].includes(curve))
      throw new RangeError('Falloff needs a positive world-distance radius and linear, smooth, or sharp curve');
    const links = new Map(doc.vertices.map(({ id }) => [id, []]));
    for (const { vertices: [a, b] } of doc.edges) {
      const length = V.dist(points.get(a), points.get(b));
      links.get(a).push([b, length]);
      links.get(b).push([a, length]);
    }
    const distances = new Map(movable.map(id => [id, 0]));
    const heap = new ProceduralHeap((a, b) => a.distance < b.distance || a.distance === b.distance && a.id < b.id);
    for (const id of movable) heap.push({ id, distance: 0 });
    while (heap.size) {
      const { id, distance } = heap.pop();
      if (distance !== distances.get(id)) continue;
      const u = 1 - distance / radius;
      weights.set(id, curve === 'linear' ? u : curve === 'sharp' ? u * u : u * u * (3 - 2 * u));
      for (const [next, length] of links.get(id)) {
        const candidate = distance + length;
        if (fixed.has(next) || candidate >= radius || candidate >= (distances.get(next) ?? Infinity)) continue;
        distances.set(next, candidate);
        heap.push({ id: next, distance: candidate });
      }
    }
    return weights;
  }

  function normalFrame(doc, selection, world, supplied, tangent) {
    const n = supplied === undefined ? (() => {
      const faces = new Set(topology.select(doc, { from: selection, convert: 'faces' }).ids);
      const sum = [0, 0, 0];
      for (const face of doc.faces) if (faces.has(face.id)) {
        const points = face.corners.map(corner => world.get(corner.vertex));
        const origin = points[0];
        for (let i = 1; i < points.length - 1; i++) {
          const area = V.cross(V.sub(points[i], origin), V.sub(points[i + 1], origin));
          for (let axis = 0; axis < 3; axis++) sum[axis] += area[axis];
        }
      }
      return unit(sum, 'Selection normal (supply normal if faces cancel or are missing)');
    })() : unit(supplied, 'Surface normal');
    const guide = tangent === undefined ? (Math.abs(n[0]) < .9 ? [1, 0, 0] : [0, 1, 0]) : unit(tangent, 'Surface tangent');
    const plane = V.mad(guide, n, -V.dot(guide, n));
    if (V.len(plane) < 1e-8) throw new RangeError('Surface tangent must not be parallel to the normal');
    const x = unit(plane, 'Surface tangent');
    return [x, V.cross(n, x), n];
  }

  function closestEdge(p, a, b) {
    const d = V.sub(b, a);
    const t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / (V.dot(d, d) || 1)));
    return { point: V.mad(a, d, t), t };
  }

  function snapMesh(raw, point, doc, frame, context) {
    const target = raw.object === undefined ? { document: doc, frame } : context.mesh?.(raw.object);
    if (!target?.document) throw new RangeError('No retained mesh snap target ' + raw.object);
    const source = topology.create(target.document), targetFrame = K.sceneGraph.transform(target.frame);
    const domain = { vertex: 'vertices', edge: 'edges', face: 'faces' }[raw.kind];
    const element = source[domain].find(row => row.id === raw.id);
    if (!element) throw new RangeError('Unknown snap ' + raw.kind + ' ' + raw.id);
    const positions = index(source.vertices), at = id => K.sceneGraph.point(targetFrame, positions.get(id).position);
    if (raw.kind === 'vertex') return { point: at(element.id) };
    if (raw.kind === 'edge') return closestEdge(point, ...element.vertices.map(at));
    const g = topology.triangulate(source), corners = index(element.corners);
    let best;
    for (const row of g.triangleSources) if (row.face === element.id) {
      const [a, b, c] = row.corners.map(id => at(corners.get(id).vertex));
      const hit = K.procedural.geometry.closestTrianglePoint(point, { a, b, c, u: V.sub(b, a), v: V.sub(c, a) });
      const distance = V.dist(point, hit.at);
      if (!best || distance < best.distance) best = { point: hit.at, distance, triangle: row.corners, barycentric: hit.weights };
    }
    return best;
  }

  function snapField(raw, start, sample) {
    const { maxDistance, tolerance = .00001, iterations = 24 } = raw;
    if (!Number.isFinite(maxDistance) || maxDistance <= 0 || !Number.isFinite(tolerance) || tolerance <= 0 ||
        tolerance >= maxDistance || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 64)
      throw new RangeError('SDF snap needs a positive maxDistance, a smaller tolerance, and 1 to 64 iterations');
    if (typeof sample !== 'function') throw new RangeError('No SDF snap target ' + raw.object);
    let p = start, distance = sample(...p);
    const h = Math.max(tolerance * .5, 1e-7);
    for (let step = 0; step <= iterations && Number.isFinite(distance); step++) {
      if (Math.abs(distance) <= tolerance) return { point: p, residual: distance, iterations: step };
      if (step === iterations) break;
      const gradient = p.map((_, axis) => {
        const a = p.slice(), b = p.slice();
        a[axis] -= h;
        b[axis] += h;
        return (sample(...b) - sample(...a)) / (2 * h);
      });
      const length = V.dot(gradient, gradient);
      if (!Number.isFinite(length) || length < 1e-14) break;
      let amount = -distance / length, advanced = false;
      for (let attempt = 0; attempt < 12; attempt++, amount *= .5) {
        const q = V.mad(p, gradient, amount);
        if (V.dist(start, q) > maxDistance) continue;
        const next = sample(...q);
        if (Math.abs(next) >= Math.abs(distance) || !Number.isFinite(next)) continue;
        p = q;
        distance = next;
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    throw new RangeError('SDF snap did not reach the surface within its tolerance and distance limit');
  }

  function snap(raw, point, doc, frame, context) {
    const keys = {
      vertex: ['id', 'object'], edge: ['id', 'object'], face: ['id', 'object'],
      plane: ['origin', 'normal'], socket: ['instance', 'binding'], sdf: ['object', 'tolerance', 'iterations']
    };
    if (!raw || !Object.hasOwn(keys, raw.kind) || !record(raw, ['kind', 'anchor', 'maxDistance', ...keys[raw.kind]]) ||
        raw.object !== undefined && !name(raw.object) || raw.anchor !== undefined && !name(raw.anchor) ||
        raw.maxDistance !== undefined && (!Number.isFinite(raw.maxDistance) || raw.maxDistance < 0))
      throw new TypeError('Use a snap target with a valid kind, anchor, and distance limit');
    let hit;
    if (raw.kind === 'plane') {
      if (!vector(raw.origin)) throw new TypeError('Construction planes need a world origin');
      const direction = unit(raw.normal, 'Construction plane');
      hit = { point: V.mad(point, direction, -V.dot(V.sub(point, raw.origin), direction)) };
    } else if (raw.kind === 'socket') {
      if (!name(raw.instance) || !name(raw.binding)) throw new TypeError('Socket snap needs an instance and binding ID');
      const socket = context.socket?.(raw.instance, raw.binding);
      if (!vector(socket)) throw new RangeError('No bound snap socket ' + raw.instance + '/' + raw.binding);
      hit = { point: socket.slice() };
    } else if (raw.kind === 'sdf') {
      if (!name(raw.object)) throw new TypeError('SDF snap needs a solid ID');
      hit = snapField(raw, point, context.sdf?.(raw.object));
    } else {
      if (!name(raw.id)) throw new TypeError('Mesh snap needs a component ID');
      hit = snapMesh(raw, point, doc, frame, context);
    }
    const delta = V.sub(hit.point, point), distance = V.len(delta);
    if (!Number.isFinite(distance) || distance > (raw.maxDistance ?? Infinity))
      throw new RangeError('Snap target is beyond the maximum distance');
    const target = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value]));
    return { ...hit, target, from: point, delta, distance };
  }

  function planTransform(source, request, context = {}) {
    if (!record(request, ['selection', 'operation', 'space', 'frame', 'pivot', 'normal', 'tangent', 'pins', 'falloff', 'snap']))
      throw new TypeError('Use a component transform request');
    const doc = topology.create(source), run = operation(request.operation);
    const { space = 'local', normal, tangent } = request;
    if (!['local', 'world', 'normal'].includes(space) || space !== 'normal' && (normal !== undefined || tangent !== undefined))
      throw new TypeError('Use local, world, or normal space, with normal guides only in normal space');
    const selection = topology.select(doc, { from: request.selection });
    const selected = new Set(topology.select(doc, { from: selection, convert: 'vertices' }).ids);
    if (!selected.size) throw new RangeError('Select at least one component to transform');
    const frame = K.sceneGraph.transform(request.frame), inverse = K.sceneGraph.inverse(frame);
    const vertices = index(doc.vertices), world = new Map(doc.vertices.map(({ id, position }) => [id, K.sceneGraph.point(frame, position)]));
    const pivot = request.pivot === undefined ? average([...selected].map(id => vertices.get(id).position)) : request.pivot;
    if (!vector(pivot)) throw new TypeError('The transform pivot needs a local XYZ point');
    const fixed = pins(doc, selection, selected, request.pins), weights = influence(doc, world, selected, fixed, request.falloff);
    const axes = space === 'normal' ? normalFrame(doc, selection, world, normal, tangent) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const basis = axes.flat(), fromBasis = M.tr(basis);
    function transformed(p, weight) {
      const delta = V.sub(p, pivot);
      if (space === 'local') return V.add(p, run(delta, weight));
      const inSpace = M.app(basis, M.app(frame.matrix, delta));
      const change = run(inSpace, weight);
      return V.add(p, M.app(inverse.matrix, M.app(fromBasis, change)));
    }
    const target = request.snap;
    let snapped;
    if (target !== undefined) {
      const anchor = target?.anchor;
      if (anchor !== undefined && (!selected.has(anchor) || fixed.has(anchor)))
        throw new RangeError('Snap anchor must be an unpinned selected vertex');
      if (!weights.size) throw new RangeError('Snap needs at least one movable vertex');
      const p = transformed(anchor === undefined ? pivot : vertices.get(anchor).position, 1);
      snapped = snap(target, K.sceneGraph.point(frame, p), doc, frame, context);
    }
    const localSnap = snapped && M.app(inverse.matrix, snapped.delta);
    const changed = [];
    for (const id of [...weights.keys()].sort()) {
      const { position: before } = vertices.get(id), weight = weights.get(id);
      const p = transformed(before, weight), after = localSnap ? V.mad(p, localSnap, weight) : p;
      if (!vector(after)) throw new RangeError('Transform produced a nonfinite position at ' + id);
      if (after.some((value, i) => value !== before[i])) changed.push({ id, before, after, weight, selected: selected.has(id) });
    }
    const patch = { vertices: changed.map(({ id, after }) => ({ id, position: after })) };
    const document = changed.length ? topology.edit(doc, patch) : doc;
    return freeze({ document, patch, report: {
      format: 'ink-studio/mesh-component-transform', version: 1, mesh: doc.id,
      beforeRevision: topology.revision(doc), afterRevision: topology.revision(document),
      selection, space, pivot: pivot.slice(), worldPivot: K.sceneGraph.point(frame, pivot), axes, pinned: [...fixed].sort(),
      ...(snapped && { snap: snapped }), vertices: changed
    } });
  }

  K.meshTopology = Object.freeze({ ...topology, planTransform });
  return Object.freeze({ snapField });
})(KIT);
