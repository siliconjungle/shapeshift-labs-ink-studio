/* glTF node and material locators for Ink's format-neutral revision manifest. */
(function (K) {
  const extras = row => row?.extras?.inkStudio;
  const tags = { materials: 'materialId', sockets: 'socketId', bones: 'boneId' };

  function aligned(matrix) {
    const { transform } = K.sceneGraph;
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
      throw new RangeError('Asset part and marker transforms must be affine');
    return transform({ position: matrix.slice(12, 15),
      matrix: [matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10]] });
  }

  function describe(document, sample) {
    const raw = extras(document)?.assetRevision;
    if (raw === undefined) return null;
    const manifest = K.authoring.assetRevisions.manifest(raw);
    const pose = sample(), nodes = new Map(pose.map(row => [row.id, row]));
    const located = new Map(), owners = new Map(), markers = new Map();
    for (const node of pose) {
      const { partId, socketId, boneId } = extras(document.nodes[node.id]) ?? {};
      if (partId !== undefined) {
        if (typeof partId !== 'string' || !Object.hasOwn(manifest.parts, partId) || located.has(partId) || node.mesh === undefined)
          throw new RangeError('Invalid or duplicate part ID on glTF node ' + node.id);
        located.set(partId, node);
        markers.set(partId, []);
      }
      const owner = partId ?? owners.get(node.parent);
      owners.set(node.id, owner);
      if (owner !== undefined && (socketId !== undefined || boneId !== undefined)) markers.get(owner).push(node.id);
    }
    const parts = new Map();
    for (const [id, spec] of Object.entries(manifest.parts)) {
      const node = located.get(id);
      if (!node) throw new RangeError('Part ' + id + ' needs a mesh node in the default glTF scene');
      const materialById = new Map(), mesh = document.meshes[node.mesh];
      const slots = mesh.primitives.map(primitive => {
        if (primitive.material === undefined) return null;
        const material = extras(document.materials[primitive.material])?.[tags.materials];
        if (typeof material !== 'string' || !spec.materials.includes(material) ||
            materialById.has(material) && materialById.get(material) !== primitive.material)
          throw new RangeError('Part ' + id + ' has an unknown or ambiguous glTF material ID');
        materialById.set(material, primitive.material);
        return material;
      });
      const inverse = K.sceneGraph.inverse(aligned(node.world));
      const rest = marker => K.sceneGraph.compose(inverse, aligned(nodes.get(marker).world));
      const markerIds = new Set(markers.get(id));
      const joints = node.skin !== undefined ? document.skins[node.skin]?.joints : [];
      if (!Array.isArray(joints) || joints.some(marker => !nodes.has(marker)) ||
          node.skin !== undefined && (!joints.length || new Set(joints).size !== joints.length))
        throw new RangeError('Part ' + id + ' has invalid joints for its default glTF scene');
      const frames = {};
      for (const kind of ['socket', 'bone']) {
        const group = kind + 's', allowed = spec[group], tag = tags[group], identified = new Map();
        for (const marker of kind === 'bone' ? new Set([...markerIds, ...joints]) : markerIds) {
          const key = extras(document.nodes[marker])?.[tag];
          if (key === undefined) continue;
          if (typeof key !== 'string' || !allowed.includes(key) || identified.has(key))
            throw new RangeError('Part ' + id + ' has an unknown or duplicate ' + kind + ' ID');
          identified.set(key, rest(marker));
        }
        frames[kind] = Object.freeze(Object.fromEntries(identified));
        if (identified.size !== allowed.length) throw new RangeError('Missing glTF ' + kind + ' ID for part ' + id);
      }
      if (materialById.size !== spec.materials.length) throw new RangeError('Missing glTF material ID for part ' + id);
      parts.set(id, Object.freeze({ ...spec, node: node.id, slots: Object.freeze(slots), frames: Object.freeze(frames),
        joints: Object.freeze(joints.map(rest)) }));
    }
    return Object.freeze({ manifest, part: id => parts.get(id) ?? null });
  }

  K.authoring.gltfAssetRevisions = Object.freeze({ describe, affineFrame: aligned });
})(KIT);
