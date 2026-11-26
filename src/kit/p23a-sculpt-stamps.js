/* Compile one compound stamp into editable solids and local cut masks. */
(function (K) {
  const DIO = K.diorama;
  const format = 'ink-studio/sculpt-stamp', version = 1;
  const localId = value => K.world.data.id(value) && !value.includes('.');
  const fields = (value, allowed) => K.world.data.record(value) &&
    Object.keys(value).every(key => allowed.includes(key));
  const unowned = ['restAffine', 'id', 'part', 'group', 'carve', 'ghost', 'hold', 'separate'];

  function bounded(solid) {
    if (!K.world.data.record(solid) || !Object.hasOwn(DIO.kinds, solid.kind) ||
        solid.kind === 'ground' || unowned.some(key => Object.hasOwn(solid, key)))
      throw new TypeError('Stamp pieces need bounded native solids without scene ownership flags or IDs');
    if (solid.modifiers !== undefined && !Array.isArray(solid.modifiers))
      throw new TypeError('Stamp piece modifiers must be an ordered list');
    for (const field of DIO.operandFields(solid)) bounded(solid[field]);
    for (const modifier of solid.modifiers ?? [])
      if (modifier?.shape !== undefined) bounded(modifier.shape);
  }

  function namedPieces(value) {
    if (!K.world.data.record(value) || !Object.keys(value).length ||
        !Object.keys(value).every(localId))
      throw new TypeError('Stamp add and cut each need named pieces with local IDs');
    return Object.entries(value);
  }

  function place(scene, stamp, placement) {
    if (!fields(stamp, ['format', 'version', 'add', 'cut']) || stamp.format !== format || stamp.version !== version)
      throw new TypeError('Expected an ink-studio/sculpt-stamp version 1 recipe');
    if (!fields(placement, ['id', 'target', 'transform']) || !localId(placement.id) ||
        placement.target !== undefined && !TargetSelectors.name(placement.target))
      throw new TypeError('Stamp placement needs a local ID and an optional named target');
    const { id, target } = placement;
    const positives = namedPieces(stamp.add), negatives = namedPieces(stamp.cut);
    const solids = scene.solids ?? [];
    const host = target === undefined ? undefined : solids.find(solid => solid.id === target);
    if (target !== undefined && (!host || host.kind === 'ground' || host.carve || host.ghost || host.hold || host.separate))
      throw new RangeError('Choose a named editable exterior sculpt solid as the stamp target: ' + target);
    if (solids.some(solid => solid.id?.startsWith(id + '.')))
      throw new RangeError('Stamp placement ID is already in use: ' + id);

    const { authored, inverse, compose, transform } = DIO.solidFrames;
    const stampFrame = authored(placement.transform);
    const worldFrame = host?.transform === undefined ? stampFrame :
      compose(authored(host.transform, host.at), stampFrame);
    const hostMasks = [], masks = new Map(positives.map(([key]) => [key, []]));
    for (const [, solid] of positives) bounded(solid);
    for (const [key, cutter] of negatives) {
      if (!fields(cutter, ['shape', 'targets', 'host']) || cutter.host !== undefined && typeof cutter.host !== 'boolean')
        throw new TypeError('Invalid stamp cutter: ' + key);
      bounded(cutter.shape);
      const { shape, targets = [...masks.keys()] } = cutter;
      const cutHost = host && cutter.host !== false;
      if (!Array.isArray(targets) || new Set(targets).size !== targets.length ||
          !Array.from(targets).every(value => masks.has(value)) || !targets.length && !cutHost)
        throw new RangeError('Cutter needs distinct named add pieces or an active host: ' + key);
      const cutterFrame = authored(shape.transform, shape.at);
      const mask = frame => ({
        id: id + '.' + key, kind: 'mask', mode: 'cut',
        shape: { ...shape, transform: transform(compose(frame, cutterFrame)) }
      });
      if (cutHost) hostMasks.push(mask(stampFrame));
      for (const piece of targets) {
        const solid = stamp.add[piece];
        masks.get(piece).push(mask(inverse(authored(solid.transform, solid.at))));
      }
    }

    const additions = positives.map(([key, solid]) => ({
      ...solid, id: id + '.' + key,
      ...(host?.part && { part: host.part }),
      ...(host?.restAffine && { restAffine: host.restAffine }),
      transform: transform(compose(worldFrame, authored(solid.transform, solid.at))),
      modifiers: [...(solid.modifiers ?? []), ...masks.get(key)]
    }));
    const next = solids.map(solid => solid === host && hostMasks.length ?
      { ...solid, modifiers: [...(solid.modifiers ?? []), ...hostMasks] } : solid);
    return [...next, ...additions];
  }

  K.authoring.sculptStamps = Object.freeze({ format, version, place });
})(KIT);
