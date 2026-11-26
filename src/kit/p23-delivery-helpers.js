/* Keep the authored frame and references when a scene helper has no delivered mesh. */
(function (K) {
  const A = K.authoring;
  const roles = ['socketId', 'markerId', 'collisionRef'];

  function read(row, points = {}) {
    const { id, record } = K.world.data;
    if (!record(row) || Object.keys(row).some(key => key !== 'point' && !roles.includes(key)) ||
        ['socketId', 'markerId'].some(key => row[key] !== undefined && !id(row[key])) ||
        row.collisionRef !== undefined && (typeof row.collisionRef !== 'string' ||
          !row.collisionRef.trim() || row.collisionRef.length > 512))
      throw new TypeError('Invalid delivery helper socket ID, marker ID, or collision reference');
    if (row.point !== undefined && (!Array.isArray(row.point) || row.point.length !== 3 ||
        !Array.from(row.point).every(n => Number.isFinite(n) && Math.abs(n) <= 1e8)))
      throw new TypeError('A delivery helper point needs a finite local XYZ position');
    const metadata = Object.fromEntries(roles.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
    if (!Object.keys(metadata).length && !Object.keys(points ?? {}).length)
      throw new TypeError('A delivery helper needs a socket, marker, collision reference, or named object point');
    return metadata;
  }

  function collect(spec, { instances, meshPlacements }, hidden) {
    const owners = new Map(), helpers = [], graph = K.sceneGraph;
    const base = graph.transform();
    for (const [instanceId, link] of instances) {
      const owner = { instanceId, prefabId: link.instance.prefab };
      for (const id of link.solids) owners.set(id, owner);
      for (const { object } of link.meshes.values()) owners.set(object, owner);
    }
    function add(id, row, frame, point, points) {
      const metadata = { helperId: id, ...owners.get(id), ...read(row.deliveryHelper, points) };
      const sockets = Object.entries(A.objectPoints.socketFrames(points)).map(([socketId, local]) => ({
        name: id + '/' + socketId, frame: graph.compose(frame, local), metadata: { socketId }
      }));
      helpers.push({ id, name: row.label ?? id, part: row.part, metadata, sockets,
        frame: graph.compose(frame, { ...base, position: row.deliveryHelper.point ?? point }) });
    }
    for (const solid of spec.solids) if (solid.deliveryHelper !== undefined) {
      const points = Object.fromEntries(Object.entries(solid.sockets ?? {}).map(([id, { p, dir = [0, 1, 0] }]) =>
        [id, { position: p, direction: dir }]));
      add(solid.id, solid, K.diorama.solidFrames.rest(solid), solid.at ?? base.position, points);
    }
    for (const [id, row] of Object.entries(spec.topologyMeshes ?? {}))
      if (row.deliveryHelper !== undefined && !hidden?.meshes.has(id))
        add(id, row, meshPlacements.get(id) ?? base, row.pivot ?? base.position, row.points);
    return helpers;
  }

  A.deliveryHelpers = Object.freeze({ read, collect });
})(KIT);
