/* Retained mesh geometry and its source-dependent records share a scene snapshot. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology;
  const elementKinds = ['faces', 'edges', 'corners'];
  const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const name = value => typeof value === 'string' && !!value.trim();
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const sorted = ids => [...new Set(ids)].sort();

  function index(rows, label) {
    if (!Array.isArray(rows)) throw new TypeError(label + ' must be an array');
    const map = new Map();
    for (const row of rows) {
      if (!record(row) || !name(row.id) || map.has(row.id)) throw new RangeError(label + ' need distinct nonempty IDs');
      map.set(row.id, row);
    }
    return map;
  }

  function elements(document) {
    if (!document) return Object.fromEntries(['vertices', ...elementKinds].map(kind => [kind, new Map()]));
    const vertices = index(document.vertices, 'Vertices');
    const point = id => vertices.get(id).position;
    const corners = new Map(), faces = new Map(), edges = new Map();
    for (const face of document.faces) {
      for (const corner of face.corners)
        corners.set(corner.id, { ...corner, face: face.id, position: point(corner.vertex) });
      faces.set(face.id, { ...face, positions: face.corners.map(corner => point(corner.vertex)) });
    }
    for (const edge of topology.inspect(document).edges) edges.set(edge.id, { ...edge, positions: edge.vertices.map(point) });
    return { vertices, faces, edges, corners };
  }

  function byteMap(value, label) {
    if (!Array.isArray(value) || !Array.from(value).every(n => Number.isInteger(n) && n >= 0 && n <= 255))
      throw new RangeError(label + ' needs JSON bytes');
    return Uint8Array.from(value);
  }

  function material(input) {
    const value = { ...input };
    if (value.texture !== undefined) {
      if (!record(value.texture)) throw new TypeError('A mesh texture needs a JSON descriptor');
      value.texture = { ...value.texture };
      for (const channel of ['pixels', 'indices', 'coverage']) if (value.texture[channel] !== undefined)
        value.texture[channel] = byteMap(value.texture[channel], 'Mesh texture ' + channel);
    }
    for (const channel of ['normal', 'emission', 'roughness', 'metalness']) {
      if (value[channel] !== undefined && (['normal', 'emission'].includes(channel) || typeof value[channel] !== 'number'))
        value[channel] = byteMap(value[channel], 'Mesh material ' + channel);
    }
    return value;
  }

  function prepareRow(object, row) {
    if (!TargetSelectors.name(object) || !fields(row, ['document', 'part', 'label', 'materials', 'bindings', 'bakes']) ||
        (row.part !== undefined && !TargetSelectors.name(row.part)) || (row.label !== undefined && !name(row.label)))
      throw new TypeError('An editable scene mesh needs an object ID, document, and optional named part');
    const document = topology.create(row.document);
    if (!document.faces.length) throw new RangeError('An editable scene mesh needs at least one polygon');
    const records = elements(document), bindings = index(row.bindings ?? [], 'Mesh bindings');
    for (const binding of bindings.values()) {
      if (!fields(binding, ['id', 'domain', 'element', 'data', 'review']) || !elementKinds.includes(binding.domain) ||
          !name(binding.element) || binding.review === undefined && !records[binding.domain].has(binding.element) ||
          binding.review !== undefined && (!fields(binding.review, ['reason', 'candidates']) ||
            !name(binding.review.reason) || !Array.isArray(binding.review.candidates) ||
            !Array.from(binding.review.candidates).every(name)))
        throw new RangeError('Invalid element binding ' + binding.id + ' on ' + object);
    }
    const bakes = index(row.bakes ?? [], 'Mesh bakes');
    const declared = index(row.materials ?? [], 'Mesh materials');
    const active = new Map(document.faces.map(face => [face.material, declared.get(face.material) ?? { id: face.material }]));
    const used = new Set();
    for (const bake of bakes.values()) {
      if (!fields(bake, ['id', 'material', 'maps', 'artifact', 'invalidated']) || !name(bake.material) ||
          used.has(bake.material) || !fields(bake.maps, ['texture', 'normal', 'emission', 'emissionStrength', 'roughness', 'metalness', 'mipmaps']) ||
          !Object.keys(bake.maps).length ||
          bake.invalidated !== undefined && (!fields(bake.invalidated, ['faces']) || !Array.isArray(bake.invalidated.faces) ||
            !bake.invalidated.faces.length || !Array.from(bake.invalidated.faces).every(name)))
        throw new RangeError('Invalid material bake ' + bake.id + ' on ' + object);
      used.add(bake.material);
      if (!bake.invalidated && active.has(bake.material)) {
        const { sampling, ...base } = active.get(bake.material);
        active.set(bake.material, { ...base, ...bake.maps, sampling: bake.maps.mipmaps ? undefined : sampling });
      }
    }
    const mesh = topology.toSceneMesh(document, { objectId: object, partId: row.part, meshId: 'topology/' + object,
      materials: [...active.values()].map(material) });
    const resolvedBindings = Object.fromEntries([...bindings.values()].filter(binding => !binding.review)
      .map(binding => [binding.id, { ...binding, geometry: records[binding.domain].get(binding.element) }]));
    return { mesh, document, bindings: [...bindings.values()], resolvedBindings, bakes: [...bakes.values()] };
  }

  function prepare(rows) {
    if (rows === undefined) return [];
    if (!record(rows) || Object.keys(rows).length > 32) throw new TypeError('Scene topologyMeshes needs a map of up to 32 editable meshes');
    return Object.entries(rows).map(([object, row]) => [object, prepareRow(object, row)]);
  }

  function mount(world, prepared) {
    if (!prepared?.length) return;
    const meshes = [...(world.meshes ?? [])], ids = new Set(meshes.map(mesh => mesh.id));
    const objects = new Set([...(world.renderMetadata?.objects ?? []), ...meshes.map(mesh => mesh.objectId)]);
    for (const [object, row] of prepared) {
      if (ids.has(row.mesh.id) || objects.has(object))
        throw new RangeError('Editable mesh ' + object + ' collides with an existing scene mesh or object');
      ids.add(row.mesh.id);
      objects.add(object);
      meshes.push(row.mesh);
    }
    K.sceneMeshes.list({ meshes }, true);
    world.meshes = meshes;
    world.topologyMeshes = Object.fromEntries(prepared);
  }

  function recordsChanged(before, after) {
    const result = [];
    for (const id of sorted([...before.keys(), ...after.keys()])) {
      const left = before.get(id) ?? null, right = after.get(id) ?? null;
      if (!same(left, right)) result.push({ id, before: left, after: right });
    }
    return result;
  }

  function bakeState(bake) {
    if (!bake) return null;
    return { id: bake.id, material: bake.material, status: bake.invalidated ? 'invalidated' : 'ready',
      ...(bake.invalidated && { faces: bake.invalidated.faces }), ...(bake.artifact !== undefined && { artifact: bake.artifact }) };
  }

  function diff(before, after) {
    const left = elements(before && topology.create(before.document)), right = elements(after && topology.create(after.document));
    const changes = Object.fromEntries(['vertices', ...elementKinds].map(kind => [kind, recordsChanged(left[kind], right[kind])]));
    const oldBindings = index(before?.bindings ?? [], 'Mesh bindings'), newBindings = index(after?.bindings ?? [], 'Mesh bindings');
    changes.bindings = recordsChanged(oldBindings, newBindings).map(row => ({ ...row,
      change: row.after?.review ? 'needs-review' : row.before?.element !== row.after?.element ? 'rebound' : 'updated' }));
    for (const [id, binding] of oldBindings) {
      if (binding.review || !same(binding, newBindings.get(id))) continue;
      const prior = left[binding.domain].get(binding.element), next = right[binding.domain].get(binding.element);
      if (!same(prior, next)) changes.bindings.push({ id, change: 'displaced', before: binding, after: binding,
        geometry: { before: prior ?? null, after: next ?? null } });
    }
    const oldBakes = (before?.bakes ?? []).map(bakeState), newBakes = (after?.bakes ?? []).map(bakeState);
    changes.bakes = recordsChanged(index(oldBakes, 'Mesh bakes'), index(newBakes, 'Mesh bakes'));
    return changes;
  }

  function revise(row, patch, { projection } = {}) {
    const before = topology.create(row.document);
    const { document, correspondence } = topology.editWithCorrespondence(before, patch, { projection });
    const groups = Object.fromEntries(elementKinds.map(kind =>
      [kind, new Map(correspondence.domains[kind].groups.flatMap(group => group.from.map(id => [id, group])))]));
    const updated = { ...row, document };
    if (row.bindings) updated.bindings = row.bindings.map(binding => {
      if (binding.review) return binding;
      const group = groups[binding.domain].get(binding.element);
      const links = group.links.filter(link => link.from === binding.element);
      if (links.length === 1 && links[0].confidence === 1) return { ...binding, element: links[0].to };
      const unresolved = correspondence.domains[binding.domain].unresolved?.find(row => row.side === 'from' && row.id === binding.element);
      const candidates = links.length ? links.map(link => link.to) : unresolved?.candidates.map(row => row.id) ?? [];
      return { ...binding, review: { reason: links.length > 1 ? 'split' : links.length ? 'projected' : group.status,
        candidates: sorted(candidates) } };
    });
    if (row.bakes) {
      const dirty = new Map();
      for (const { id, before: old, after: next } of recordsChanged(elements(before).faces, elements(document).faces)) {
        for (const material of new Set([old?.material, next?.material])) {
          if (!dirty.has(material)) dirty.set(material, []);
          dirty.get(material).push(id);
        }
      }
      updated.bakes = row.bakes.map(bake => !dirty.has(bake.material) ? bake : { ...bake,
        invalidated: { faces: sorted([...(bake.invalidated?.faces ?? []), ...dirty.get(bake.material)]) } });
    }
    return { row: updated, correspondence, ...diff(row, updated) };
  }

  A.meshTopologyScene = Object.freeze({ prepare, mount, diff, revise });
})(KIT);
