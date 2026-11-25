/* Model pivot placement samples an anchor without editing the mesh. */
const meshPivot = (function (K) {
  const topology = K.meshTopology, { V } = K, { freeze } = K.procedural.data;
  const { meshTarget, average } = meshComponentSnap;
  const format = 'ink-studio/mesh-pivot';
  const record = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => fields.includes(key));
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const name = TargetSelectors.name;

  function position(local, frame) {
    if (!xyz(local)) throw new TypeError('A mesh pivot needs a finite local XYZ point');
    const world = K.sceneGraph.point(frame, local);
    if (!xyz(world)) throw new RangeError('Mesh pivot exceeds world coordinate bounds');
    return { local: local.slice(), world };
  }

  function anchor(doc, frame, raw, context) {
    const { kind } = raw ?? {};
    switch (kind) {
      case 'point': {
        if (!record(raw, ['kind', 'point', 'space']) || !xyz(raw.point) ||
            raw.space !== undefined && !['local', 'world'].includes(raw.space))
          throw new TypeError('A pivot point needs finite XYZ and optional local or world space');
        const space = raw.space ?? 'local';
        return { point: raw.point.slice(), space, evidence: { kind, space } };
      }
      case 'instance': {
        if (!record(raw, ['kind', 'instance', 'instanceKind', 'anchor']) || !name(raw.instance) ||
            raw.instanceKind !== undefined && !['prefab', 'asset-part'].includes(raw.instanceKind) ||
            raw.anchor !== undefined && !name(raw.anchor))
          throw new TypeError('Choose a prefab or asset-part instance and optional anchor ID');
        const found = context.instance?.(raw);
        if (!xyz(found?.target)) throw new RangeError('No instance pivot target ' + raw.instance);
        return { point: found.target, space: 'world', evidence: { kind, instance: raw.instance,
          ...(found.instanceKind && { instanceKind: found.instanceKind }), ...(raw.anchor && { anchor: raw.anchor }) } };
      }
      case 'vertex':
      case 'edge':
      case 'center':
        return meshAnchor(doc, frame, raw, context);
      default:
        throw new TypeError('Place a mesh pivot at a point, vertex, edge, instance anchor, or selection center');
    }
  }

  function meshAnchor(doc, frame, raw, context) {
    const { kind, object, id, at = .5, from, selection, mode = 'average' } = raw;
    const extra = kind === 'vertex' ? ['id'] : kind === 'edge' ? ['id', 'at', 'from'] : ['selection', 'mode'];
    if (!record(raw, ['kind', 'object', ...extra]) || object !== undefined && !name(object) ||
        (kind === 'center' ? !selection || !['average', 'bounds'].includes(mode) : !name(id)) ||
        kind === 'edge' && (!Number.isFinite(at) || at < 0 || at > 1 || from !== undefined && !name(from)))
      throw new TypeError('Choose a vertex ID, edge ID and fraction, or saved selection and center mode');
    const target = meshTarget(doc, frame, object, context, 'pivot');
    const vertices = new Map(target.source.vertices.map(row => [row.id, row.position]));
    const evidence = { kind, ...(object !== undefined && { object }), mesh: target.source.id, revision: topology.revision(target.source) };
    let point;
    if (kind === 'vertex') {
      point = vertices.get(id);
      if (!point) throw new RangeError('Unknown pivot vertex ' + id);
      evidence.id = id;
    } else if (kind === 'edge') {
      const edge = target.source.edges.find(row => row.id === id);
      if (!edge) throw new RangeError('Unknown pivot edge ' + id);
      const ends = from === undefined || from === edge.vertices[0] ? edge.vertices :
        from === edge.vertices[1] ? edge.vertices.slice().reverse() : null;
      if (!ends) throw new RangeError('Pivot edge must start at one of its endpoints');
      point = V.lerp(...ends.map(vertex => vertices.get(vertex)), at);
      Object.assign(evidence, { id, vertices: ends.slice(), at });
    } else {
      const picked = topology.select(target.source, { from: selection });
      const { ids } = topology.select(target.source, { from: picked, convert: 'vertices' });
      if (!ids.length) throw new RangeError('Select at least one component to place the pivot');
      const points = ids.map(vertex => vertices.get(vertex));
      Object.assign(evidence, { mode, selection: picked, count: ids.length });
      if (mode === 'bounds') {
        evidence.bounds = K.procedural.spatial.boxOf(points);
        point = V.lerp(evidence.bounds.min, evidence.bounds.max, .5);
      } else point = average(points);
    }
    return object === undefined ? { point, space: 'local', evidence } :
      { point: K.sceneGraph.point(target.frame, point), space: 'world', evidence };
  }

  function planPivot(source, request = {}, context = {}) {
    if (!record(request, ['frame', 'target', 'revision']) ||
        request.revision !== undefined && !name(request.revision))
      throw new TypeError('Use a mesh pivot placement request');
    const doc = topology.create(source), revision = topology.revision(doc);
    if (request.revision !== undefined && request.revision !== revision)
      throw new RangeError('Mesh pivot needs the current topology revision');
    const frame = K.sceneGraph.transform(request.frame);
    const before = context.pivot === undefined ? null : position(context.pivot, frame);
    let after = before, target;
    if (request.target === null) after = null;
    else if (request.target !== undefined) {
      const found = anchor(doc, frame, request.target, context);
      const local = found.space === 'local' ? found.point : K.sceneGraph.point(K.sceneGraph.inverse(frame), found.point);
      after = position(local, frame);
      target = found.evidence;
    }
    const changed = before && after ? before.local.some((value, i) => value !== after.local[i]) : before !== after;
    return freeze({ format, version: 1, mesh: doc.id, revision, before, after, changed, ...(target && { target }) });
  }

  K.meshTopology = Object.freeze({ ...topology, planPivot });
  return Object.freeze({ xyz });
})(KIT);
