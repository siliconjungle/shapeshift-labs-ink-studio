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

  const cardinal = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  function cameraBasis(value) {
    if (!record(value, ['right', 'up', 'back', 'eye']))
      throw new TypeError('A camera-space transform needs right, up and back camera axes');
    const { right, up, back } = CameraLens.pose({ eye: [0, 0, 0], ...value });
    const x = unit(right, 'Camera right');
    const y = unit(V.mad(up, x, -V.dot(up, x)), 'Camera up');
    return { camera: { right, up, back }, axes: [x, y, V.cross(x, y)] };
  }

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

  function mirrorOperation(raw, request) {
    if (!record(raw,['kind','normal','winding','viewFrom']) || !vector(raw.normal) || !['preserve','reverse'].includes(raw.winding))
      throw new TypeError('Mirror needs a plane normal and an explicit winding of preserve or reverse');
    if (request.falloff !== undefined || request.snap !== undefined)
      throw new TypeError('Mirror uses the full reflection about its pivot plane');
    const viewFrom = meshWinding.direction(raw.viewFrom);
    return { normal:meshWinding.direction(raw.normal,'Mirror plane normal'), winding:raw.winding, ...(viewFrom && {viewFrom}) };
  }

  function mirrorFaces(doc, mirror, weights, selected, changed, onPlane, normal) {
    const moved = new Set(changed.map(({id})=>id)), faces=[], reversed=[], fullyReflected=[], partialFaces=[];
    for (const face of doc.faces) {
      if (!face.corners.some(({vertex})=>weights.has(vertex))) continue;
      if (!face.corners.every(({vertex})=>weights.has(vertex) || selected.has(vertex) && onPlane(vertex))) {
        if (face.corners.some(({vertex})=>moved.has(vertex))) partialFaces.push(face.id);
        continue;
      }
      fullyReflected.push(face.id);
      const reverse = mirror.winding === 'reverse';
      if (reverse) reversed.push(face.id);
      if (reverse || face.corners.some(corner=>corner.normal)) faces.push(meshWinding.edit(face,reverse,normal));
    }
    return {faces,fullyReflected,partialFaces,reversed};
  }

  const constraints = ['align', 'flatten', 'collapse'];
  function usesConstructionPlane(request) {
    const { operation, space, snap } = request ?? {};
    return space === 'plane' || snap?.kind === 'construction-plane' ||
      ['align', 'flatten'].includes(operation?.kind) && operation.plane === undefined;
  }

  function extent(points, distance) {
    let min = Infinity, max = -Infinity;
    for (const point of points) {
      const value = distance(point);
      if (!Number.isFinite(value)) throw new RangeError('Plane distances must be finite');
      min = Math.min(min,value);
      max = Math.max(max,value);
    }
    return { near: max, center: min*.5 + max*.5, far: min };
  }

  function constraint(raw, picked, construction, pivot, frame, inverse) {
    const { kind, side, plane, point, removeCollapsed = false } = raw;
    const fields = kind === 'align' ? ['side', 'plane'] :
      kind === 'flatten' ? ['plane', 'removeCollapsed'] : ['point', 'removeCollapsed'];
    if (!record(raw, ['kind', ...fields]) || typeof removeCollapsed !== 'boolean')
      throw new TypeError('Use align, flatten, or collapse with its target settings');
    if (!picked.length) throw new RangeError('Choose at least one unpinned selected vertex to ' + kind);
    if (kind === 'collapse') {
      if (point !== undefined && !vector(point)) throw new TypeError('Collapse needs a finite world XYZ point');
      const target = point === undefined ? K.sceneGraph.point(frame,pivot) : point.slice();
      const local = point === undefined ? pivot : K.sceneGraph.point(inverse,target);
      return { removeCollapsed, evidence: { kind, point: target, source: point === undefined ? 'pivot' : 'explicit' },
        apply: (p, _, weight) => weight === 1 ? local.slice() : V.lerp(p,local,weight),
        measure: points => ({ maxError: points.reduce((max,p) => Math.max(max,V.dist(p,target)),0) }) };
    }
    if (kind === 'align' && !['near','center','far'].includes(side))
      throw new TypeError('Plane alignment needs a side of near, center, or far');
    if (plane !== undefined && (!record(plane, ['origin', 'normal']) || !vector(plane.origin)))
      throw new TypeError('Use a plane with a world origin and normal');
    const origin = (plane === undefined ? construction.plane.origin : plane.origin).slice();
    const normal = plane === undefined ? construction.axes[2] : unit(plane.normal,'Align or flatten plane');
    const distance = p => V.dot(V.sub(p,origin),normal);
    const before = extent(picked,distance);
    const offset = kind === 'align' ? -before[side] : undefined;
    const localNormal = M.app(inverse.matrix,normal);
    return { removeCollapsed, evidence: { kind, plane: { origin, normal, source: plane === undefined ? 'construction' : 'explicit' },
      before, ...(side !== undefined && { side, delta: V.mul(normal,offset) }) },
      apply: (p, world, weight) => V.mad(p,localNormal,(offset ?? -distance(world))*weight),
      measure: points => ({ after: extent(points,distance) }) };
  }

  function collapsedFaces(doc, vertices, edits) {
    if (!edits.length) return [];
    const positions = new Map(edits.map(({ id, after }) => [id, after]));
    // Remove only faces reduced to a line or a point. Other invalid polygons
    // still fail the normal topology validation.
    return doc.faces.filter(face => {
      if (!face.corners.some(({ vertex }) => positions.has(vertex))) return false;
      const points = face.corners.map(({ vertex }) => positions.get(vertex) ?? vertices.get(vertex).position);
      const spans = points.map(point => V.sub(point,points[0]));
      const longest = spans.reduce((a,b) => V.len(a) >= V.len(b) ? a : b);
      const size = V.len(longest);
      return !size || spans.every(span => V.len(V.cross(longest,span)) <= size*size*1e-10);
    }).map(face => face.id).sort();
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

  function meshTarget(doc, frame, object, context, action = 'snap') {
    const target = object === undefined ? { document: doc, frame } : context.mesh?.(object);
    if (!target?.document) throw new RangeError('No retained mesh ' + action + ' target ' + object);
    return { source: topology.create(target.document), frame: K.sceneGraph.transform(target.frame) };
  }

  function edgeEnds(edge, from, action) {
    const ends = edge.vertices.slice();
    if (from === undefined || from === ends[0]) return ends;
    if (from === ends[1]) return ends.reverse();
    throw new RangeError(action + ' must start at one of its endpoints');
  }

  function sourceAnchor(doc, selected, raw) {
    if (raw === undefined) return { ids: [] };
    if (name(raw)) {
      if (!selected.has(raw)) throw new RangeError('Snap anchor must be an unpinned selected vertex');
      return { ids: [raw] };
    }
    if (!record(raw, ['edge', 'at', 'from']) || !name(raw.edge) ||
        raw.at !== undefined && (!Number.isFinite(raw.at) || raw.at < 0 || raw.at > 1) ||
        raw.from !== undefined && !name(raw.from))
      throw new TypeError('Snap anchor needs a selected vertex or an edge and optional fraction');
    const edge = doc.edges.find(row => row.id === raw.edge);
    if (!edge || !edge.vertices.every(id => selected.has(id)))
      throw new RangeError('Snap edge anchor needs two selected endpoints');
    return { ids: edgeEnds(edge, raw.from, 'Snap edge anchor'), at: raw.at, edge: raw.edge };
  }

  function endpointSnap(source, from, target, at, allowReverse) {
    const directions = allowReverse ? [target, target.slice().reverse()] : [target];
    let best;
    for (const ends of directions) {
      const points = ends.map(at), point = average(points), delta = V.sub(point, from);
      const pairs = ends.map((id,i) => ({ source: source.ids[i], target: id, from: source.points[i], point: points[i] }));
      const residual = Math.max(...pairs.map(pair => V.dist(V.add(pair.from,delta),pair.point)));
      const tolerance = 1e-8 + 16 * Number.EPSILON * Math.max(...[...source.points, ...points].flat().map(Math.abs));
      const distance = V.len(delta);
      if (residual <= tolerance && (!best || distance < best.distance)) best = { point, pairs, residual, distance };
    }
    if (!best) throw new RangeError('Edge endpoint snapping needs matching length and direction after the transform');
    return best;
  }

  function snapMesh(raw, point, doc, frame, context, anchor) {
    const { source, frame: targetFrame } = meshTarget(doc, frame, raw.object, context);
    const domain = { vertex: 'vertices', edge: 'edges', face: 'faces' }[raw.kind];
    const element = source[domain].find(row => row.id === raw.id);
    if (!element) throw new RangeError('Unknown snap ' + raw.kind + ' ' + raw.id);
    const positions = index(source.vertices), at = id => K.sceneGraph.point(targetFrame, positions.get(id).position);
    if (raw.kind === 'vertex') return { point: at(element.id) };
    if (raw.kind === 'edge') {
      const ends = edgeEnds(element, raw.from, 'Snap target edge');
      if (raw.match === 'endpoints') return endpointSnap(anchor, point, ends, at, raw.from === undefined);
      return raw.at === undefined ? closestEdge(point, ...ends.map(at)) : { point: V.lerp(...ends.map(at), raw.at), t: raw.at };
    }
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

  function snap(raw, point, doc, frame, context, construction, anchor) {
    const keys = {
      vertex: ['id', 'object'], edge: ['id', 'object', 'at', 'from', 'match'], face: ['id', 'object'],
      plane: ['origin', 'normal'], 'construction-plane': ['mode'], socket: ['instance', 'binding'], sdf: ['object', 'tolerance', 'iterations']
    };
    if (!raw || !Object.hasOwn(keys, raw.kind) || !record(raw, ['kind', 'anchor', 'maxDistance', ...keys[raw.kind]]) ||
        raw.object !== undefined && !name(raw.object) ||
        raw.maxDistance !== undefined && (!Number.isFinite(raw.maxDistance) || raw.maxDistance < 0))
      throw new TypeError('Use a snap target with a valid kind, anchor, and distance limit');
    if (raw.kind === 'edge' && (
        raw.at !== undefined && (!Number.isFinite(raw.at) || raw.at < 0 || raw.at > 1) ||
        raw.from !== undefined && !name(raw.from) || raw.match !== undefined && (
          raw.match !== 'endpoints' || !anchor.edge || anchor.at !== undefined || raw.at !== undefined)))
      throw new TypeError('Edge snapping needs a valid fraction or a two-endpoint source and target');
    let hit;
    if (raw.kind === 'plane') {
      if (!vector(raw.origin)) throw new TypeError('Construction planes need a world origin');
      const direction = unit(raw.normal, 'Construction plane');
      hit = { point: V.mad(point, direction, -V.dot(V.sub(point, raw.origin), direction)) };
    } else if (raw.kind === 'construction-plane') {
      hit = K.authoring.constructionPlane.project(construction,point,raw.mode);
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
      hit = snapMesh(raw, point, doc, frame, context, anchor);
    }
    const delta = V.sub(hit.point, point), distance = V.len(delta);
    if (!Number.isFinite(distance) || distance > (raw.maxDistance ?? Infinity))
      throw new RangeError('Snap target is beyond the maximum distance');
    const target = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.slice() :
        key === 'anchor' && typeof value === 'object' ? { ...value } : value]));
    return { ...hit, target, from: point, delta, distance };
  }

  function planTransform(source, request, context = {}) {
    if (!record(request, ['selection', 'operation', 'space', 'frame', 'pivot', 'planePivot', 'constructionPlane',
      'camera', 'normal', 'tangent', 'pins', 'falloff', 'snap', 'coincident']))
      throw new TypeError('Use a component transform request');
    const doc = topology.create(source), special = constraints.includes(request.operation?.kind);
    if (request.operation?.kind === 'replay-randomize') return meshRandomTransform.replay(doc,request);
    const pushing = request.operation?.kind === 'push';
    const random = request.operation?.kind === 'randomize' && meshRandomTransform.parse(request.operation);
    const mirror = request.operation?.kind === 'mirror' && mirrorOperation(request.operation,request);
    const reflectionDelta = mirror && (p=>V.mul(mirror.normal,-2*V.dot(p,mirror.normal)));
    const run = mirror ? reflectionDelta : special || pushing || random ? undefined : operation(request.operation);
    if (special && request.snap !== undefined)
      throw new TypeError('Align, flatten, and collapse already define their target');
    if (pushing && (request.snap !== undefined || request.falloff !== undefined || !vector(request.operation.direction)))
      throw new TypeError('Push needs a finite XYZ direction and uses rigid contact groups without snap or falloff');
    if (random && request.snap !== undefined) throw new TypeError('Randomize uses the authored bounds as its transform target');
    if (random?.mode === 'individual' && request.falloff !== undefined)
      throw new TypeError('Use assembly mode for randomized transforms with connected falloff');
    const { space = 'local', normal, tangent } = request;
    if (!['local', 'world', 'normal', 'plane', 'camera'].includes(space) ||
        space !== 'normal' && (normal !== undefined || tangent !== undefined) || space !== 'camera' && request.camera !== undefined)
      throw new TypeError('Use local, world, normal, plane, or camera space with guides for the chosen space');
    if (request.planePivot !== undefined && (space !== 'plane' || request.pivot !== undefined))
      throw new TypeError('Use planePivot in plane space, or supply a local XYZ pivot');
    const plane = K.authoring.constructionPlane;
    const needsPlane = usesConstructionPlane(request);
    if (!needsPlane && request.constructionPlane !== undefined)
      throw new TypeError('Supply constructionPlane when the transform uses the working plane');
    const construction = needsPlane ?
      plane.resolve(request.constructionPlane === undefined ? context.constructionPlane : request.constructionPlane) : undefined;
    const view = space === 'camera' ? cameraBasis(request.camera === undefined ? context.camera : request.camera) : undefined;
    const selection = topology.select(doc, { from: request.selection });
    const selected = new Set(topology.select(doc, { from: selection, convert: 'vertices' }).ids);
    if (!selected.size) throw new RangeError('Select at least one component to transform');
    const frame = K.sceneGraph.transform(request.frame), inverse = K.sceneGraph.inverse(frame);
    const vertices = index(doc.vertices), world = new Map(doc.vertices.map(({ id, position }) => [id, K.sceneGraph.point(frame, position)]));
    const retainedPivot = request.pivot === undefined && request.planePivot === undefined ? context.pivot : undefined;
    const gridPivot = space === 'plane' && request.pivot === undefined && retainedPivot === undefined ?
      (request.planePivot === undefined ? [0,0] : request.planePivot) : undefined;
    const pivot = gridPivot !== undefined ? K.sceneGraph.point(inverse,plane.point(construction,gridPivot)) :
      request.pivot !== undefined ? request.pivot : retainedPivot !== undefined ? retainedPivot :
        average([...selected].map(id => vertices.get(id).position));
    if (!vector(pivot)) throw new TypeError('The transform pivot needs a local XYZ point');
    const fixed = pins(doc, selection, selected, request.pins), weights = influence(doc, world, selected, fixed, request.falloff);
    const anchor = sourceAnchor(doc, selected, request.snap?.anchor);
    const coincident = meshCoincidentMotion.plan(doc, world, weights, fixed, anchor.ids, request.coincident);
    const measured = special ? [...selected].filter(id => weights.has(id)) : [];
    const placed = special && constraint(request.operation,measured.map(id => world.get(id)),construction,pivot,frame,inverse);
    const axes = view ? view.axes : space === 'plane' ? construction.axes :
      space === 'normal' ? normalFrame(doc, selection, world, normal, tangent) : cardinal;
    const worldAxes = space === 'local' ? axes.map(axis => M.app(frame.matrix, axis)) : axes;
    const basis = axes.flat(), fromBasis = M.tr(basis);
    const relativeSpace = p => space === 'local' ? p : M.app(basis,M.app(frame.matrix,p));
    const pushDirection = pushing && unit(M.app(M.tr(worldAxes.flat()),request.operation.direction),'Push');
    const push = pushing && meshPush.plan(request.operation,pushDirection,doc,world,frame,selection,selected,fixed,coincident,context);
    const localPush = push && M.app(inverse.matrix,pushDirection);
    const randomized = random && meshRandomTransform.plan(random,doc,selection,selected,vertices,weights,coincident,pivot,
      request.pivot !== undefined || request.planePivot !== undefined || retainedPivot !== undefined);
    function transformed(p, weight, id) {
      const row = randomized && randomized.byVertex.get(id);
      const delta = V.sub(p, row ? row.pivot : pivot), apply = row ? row.delta : run;
      if (space === 'local') return V.add(p, apply(delta, weight));
      const inSpace = relativeSpace(delta);
      const change = apply(inSpace, weight);
      return V.add(p, M.app(inverse.matrix, M.app(fromBasis, change)));
    }
    const target = request.snap;
    let snapped;
    if (target !== undefined) {
      if (anchor.ids.some(id => fixed.has(id)))
        throw new RangeError(anchor.edge ? 'Snap edge anchor needs two unpinned endpoints' : 'Snap anchor must be an unpinned selected vertex');
      if (!weights.size) throw new RangeError('Snap needs at least one movable vertex');
      const points = anchor.ids.map(id => K.sceneGraph.point(frame, transformed(vertices.get(id).position, 1)));
      const point = anchor.edge ? V.lerp(...points, anchor.at ?? .5) : points[0] ?? K.sceneGraph.point(frame, transformed(pivot,1));
      snapped = snap(target, point, doc, frame, context, construction, { ...anchor, points });
    }
    const localSnap = snapped && M.app(inverse.matrix, snapped.delta);
    const destination = (id, weight) => {
      if (placed) return placed.apply(vertices.get(id).position,world.get(id),weight);
      if (push) return V.mad(vertices.get(id).position,localPush,push.distances.get(id));
      const p = transformed(vertices.get(id).position, weight, id);
      return localSnap ? V.mad(p, localSnap, weight) : p;
    };
    const displaced = new Map();
    const changed = [];
    for (const id of [...weights.keys()].sort()) {
      const { position: before } = vertices.get(id), weight = weights.get(id);
      const leader = placed || push || mirror ? id : coincident?.leaders.get(id) ?? id;
      if (!displaced.has(leader)) displaced.set(leader, destination(leader,weight));
      const end = displaced.get(leader), start = vertices.get(leader).position;
      const after = id === leader || before.every((value,i) => value === start[i]) ? end : V.add(before,V.sub(end,start));
      if (!vector(after)) throw new RangeError('Transform produced a nonfinite position at ' + id);
      if (after.some((value, i) => value !== before[i])) changed.push({ id, before, after, weight, selected: selected.has(id) });
    }
    const removeFaces = placed && placed.evidence.kind !== 'align' ? collapsedFaces(doc,vertices,changed) : [];
    if (removeFaces.length && !placed.removeCollapsed)
      throw new RangeError('Face ' + removeFaces[0] + ' would lose nonzero area. Set removeCollapsed to remove it');
    let mirrored;
    if (mirror) {
      const onPlane = id => {
        const relative = relativeSpace(V.sub(vertices.get(id).position,pivot));
        return Math.abs(V.dot(relative,mirror.normal)) <= 32*Number.EPSILON*V.len(relative);
      };
      const toAxes = M.mul(basis,M.tr(inverse.matrix)), toLocal = M.mul(M.tr(frame.matrix),fromBasis);
      const reflectedNormal = local => {
        const normal = space === 'local' ? local : M.app(toAxes,local);
        const reflected = V.add(normal,reflectionDelta(normal));
        const oriented = mirror.winding === 'reverse' ? reflected : V.mul(reflected,-1);
        return space === 'local' ? oriented : M.app(toLocal,oriented);
      };
      mirrored = mirrorFaces(doc,mirror,weights,selected,changed,onPlane,reflectedNormal);
    }
    const patch = { vertices: changed.map(({ id, after }) => ({ id, position: after })),
      ...(removeFaces.length && { removeFaces }), ...(mirrored?.faces.length && {faces:mirrored.faces}) };
    const document = changed.length || patch.faces?.length ? topology.edit(doc, patch) : doc;
    const result = placed && placed.measure(measured.map(id =>
      K.sceneGraph.point(frame,displaced.get(id))));
    const beforeRevision = topology.revision(doc), afterRevision = topology.revision(document);
    let mirrorEvidence;
    if (mirrored) {
      const {fullyReflected,partialFaces,reversed} = mirrored;
      const affected = [...fullyReflected,...partialFaces];
      mirrorEvidence = {kind:'mirror',...mirror,fullyReflected,partialFaces,reversed,
        facing:meshWinding.changes(doc,document,affected.map(from=>({from})),mirror.viewFrom),
        windingConflicts:meshWinding.conflicts(document,new Set(reversed))};
    }
    return freeze({ document, patch, report: {
      format: 'ink-studio/mesh-component-transform', version: 1, mesh: doc.id,
      beforeRevision, afterRevision,
      selection, space, pivot: pivot.slice(), worldPivot: K.sceneGraph.point(frame, pivot), axes, worldAxes, pinned: [...fixed].sort(),
      ...(request.frame !== undefined && { frame }), ...(view && { camera: view.camera }),
      ...(retainedPivot !== undefined && { pivotSource: 'retained' }),
      ...(coincident && { coincident: coincident.report }),
      ...(placed && { operation: { ...placed.evidence, ...result, measured, removedFaces: removeFaces } }),
      ...(push && { operation: push.report }),
      ...(mirrorEvidence && { operation: mirrorEvidence }),
      ...(randomized && { operation: { ...randomized.evidence, replay: { selection,
        operation: { kind:'replay-randomize',version:1,beforeRevision,afterRevision,vertices:patch.vertices } } } }),
      ...(construction && {constructionPlane:construction.plane}),
      ...(gridPivot && {planePivot:gridPivot.slice()}), ...(snapped && { snap: snapped }), vertices: changed
    } });
  }

  K.meshTopology = Object.freeze({ ...topology, planTransform });
  return Object.freeze({ snapField, meshTarget, edgeEnds, average, usesConstructionPlane });
})(KIT);
