const identifier = /^[a-zA-Z][\w.-]{0,99}$/;

function captures(value) {
  if (!Array.isArray(value) || value.length > 64) throw new RangeError('Choose up to 64 graph geometry captures');
  const seen = new Set();
  return value.map(target => {
    const [node, port = 'value', extra] = typeof target === 'string' ? target.split(':') : [];
    if (!node?.split('/').every(part => identifier.test(part)) || !identifier.test(port) || extra !== undefined)
      throw new TypeError('Use a graph node path with an optional :port for a geometry capture');
    const address = (node + ':' + port).toLowerCase();
    if (seen.has(address)) throw new RangeError('Duplicate graph geometry capture ' + target);
    seen.add(address);
    return { node, port };
  });
}

function inspector(K, { preview, summaryArtifact }) {
  const P = K.procedural, { validator } = P.graphTypes, known = new WeakMap();
  const cacheable = value => value && ['object', 'function'].includes(typeof value);
  const box = (points, count) => count ? P.spatial.boxOf(points) : null;
  function retained(value) {
    const { vertices, edges, faces } = K.meshTopology.create(value);
    const corners = faces.flatMap(face => face.corners);
    const attributes = [];
    for (const [domain, rows, native] of [
      ['vertex', vertices, ['weights']], ['edge', edges, ['smooth', 'crease', 'uvSeams']],
      ['face', faces, ['material']], ['corner', corners, ['uv', 'normal']]
    ]) {
      const counts = new Map();
      for (const row of rows) {
        const names = [...native.filter(name => Object.hasOwn(row, name)),
          ...Object.keys(row.attributes ?? {}).map(name => 'attributes/' + name)];
        for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      for (const [name, samples] of counts) attributes.push({ name, domain, samples });
    }
    return { kind: 'topology', bounds: box(vertices.map(row => row.position), vertices.length),
      vertices: vertices.length, retainedEdges: edges.length, faces: faces.length, corners: corners.length, attributes };
  }
  function measure(value, type) {
    if (value?.format === 'ink-studio/mesh-topology') return retained(value);
    if (value?.format === P.attributes.format) {
      const { domain, points, channels } = P.attributes.open(value);
      return { kind: 'attributeTable', domain, elements: points.length, bounds: box(points, points.length),
        attributes: [...channels].map(([name, channel]) => ({ name, domain, type: channel.type,
          components: channel.size, interpolation: channel.interpolation, missing: channel.missing.size })) };
    }
    if (value?.bounds && validator('field')(value)) {
      const bounds = P.sceneGraph.sdfExtent(value);
      const { objects, materials } = P.sceneGraph.sdfTagCatalog([value]);
      return { kind: 'boundedField', bounds, attributes: { tagged: Boolean(P.sceneGraph.sdfTags(value)),
        objectIds: objects.slice(1), materialIds: materials.slice(1) } };
    }
    if (validator('mesh')(value)) return { kind: 'mesh', ...P.sceneGraph.measure(value) };
    if (typeof value?.id === 'string' && validator('mesh')(value.mesh))
      return { kind: 'sceneObject', id: value.id, material: value.material, ...P.sceneGraph.measure(value.mesh) };
    if (type === 'pointBuffer' && validator('pointBuffer')(value)) {
      const { count, positions, frame, unit, ids, velocities } = value;
      function* points() {
        for (let i = 0; i < positions.length; i += 3) yield [positions[i], positions[i + 1], positions[i + 2]];
      }
      return { kind: 'pointBuffer', count, frame, unit, bounds: box(points(), count),
        attributes: ['position', ...(ids ? ['id'] : []), ...(velocities ? ['velocity'] : [])] };
    }
    if (type === 'points' && Array.isArray(value)) {
      const points = value.map(row => Array.isArray(row) ? row : row?.point ?? row?.position ?? row?.at);
      if (points.every(point => validator('vec3')(point) || validator('vec2')(point))) {
        const xyz = points.map(point => point.length === 3 ? point : [...point, 0]);
        const names = [...new Set(value.flatMap(row => Object.keys(row?.attributes ?? {})))].sort();
        return { kind: 'points', count: points.length, bounds: box(xyz, xyz.length), attributes: names };
      }
    }
  }
  function geometry(value, type) {
    if (!cacheable(value)) return;
    const existing = known.get(value);
    if (existing?.has(type)) return existing.get(type);
    let summary;
    try { summary = measure(value, type); }
    catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      summary = { kind: 'unavailable', error: error.message };
    }
    if (existing) existing.set(type, summary);
    else known.set(value, new Map([[type, summary]]));
    return summary;
  }
  return (frame, report, targets) => {
    const nodes = Object.entries(report.cache.nodes).map(([node, status]) => {
      const stage = frame.stage(node), prefix = node.slice(0, node.lastIndexOf('/') + 1);
      const absolute = row => row.node ? { ...row, node: prefix + row.node } : row;
      const { computeMs, invalidated } = stage.receipt;
      return { node, op: stage.op, status, computeMs, invalidated: invalidated.map(absolute),
        inputs: Object.fromEntries(Object.entries(stage.inputs).map(([port, { value, ...entry }]) =>
          [port, { ...absolute(entry), geometry: geometry(value, entry.type) }])),
        outputs: Object.fromEntries(Object.entries(stage.outputTypes).map(([port, type]) =>
          [port, { type, geometry: geometry(stage.outputs[port], type) }])),
        work: stage.work, ...(stage.workOmitted && { workOmitted: stage.workOmitted }) };
    });
    const artifacts = [], captured = targets.map(({ node, port }) => {
      const stage = frame.stage(node), value = frame.preview(node, port), type = stage.outputTypes[port];
      const shape = geometry(value, type);
      const encoded = preview(value), artifact = encoded ?? summaryArtifact(value, shape);
      const { format, sha256, bytes } = artifact, file = 'artifacts/' + node + '/' + port + '.' + format;
      artifacts.push({ ...artifact, file });
      return { node, port, type, file, format, sha256, bytes: bytes.length, ...(encoded ? {} : { summaryOnly: true }) };
    });
    return { artifacts, nodes, captured };
  };
}

module.exports = { captures, inspector };
