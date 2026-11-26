/* Author, inspect and retain surface snaps on a sculpt's existing modifier stack. */
(function (K) {
  const DIO = K.diorama, { V } = K;
  const { clone, freeze } = K.procedural.data;
  const name = TargetSelectors.name;
  const fields = (value, keys) => K.world.data.record(value) && Object.keys(value).every(key => keys.includes(key));

  function host(scene, target) {
    const solid = name(target) && scene.solids?.find(row => row.id === target);
    if (!solid || solid.kind === 'ground' || solid.carve || solid.ghost || solid.hold || scene.brushRegion != null)
      throw new RangeError('Choose a named top-level exterior sculpt solid as the snap target');
    return solid;
  }

  function inspect(scene, target, id, env) {
    const solid = host(scene, target);
    const modifier = name(id) && solid.modifiers?.find(row => row.id === id);
    if (!modifier?.snap) throw new RangeError('Unknown snapped stroke ' + id + ' on ' + target);
    const { snap: { mode }, shape, enabled } = modifier;
    const summary = { target, id, mode, space: 'target-rest', poseSpace: 'operand-local', enabled: enabled !== false, authoredPoseCount: shape.poses.length };
    if (enabled === false) return freeze(summary);
    const { snapped } = DIO.sculptRestTrace(scene, target, env).stages.get(id) ?? {};
    if (!snapped) throw new RangeError('The resolved build is missing the snapped stroke ' + id);
    const contacts = snapped.contacts.map(({ guide, point, snapped, normal }, index) =>
      ({ index, guide, point, snapped, normal, distance: V.dist(guide, point) }));
    return freeze(clone({ ...summary, resolvedPoseCount: snapped.poses.length,
      resolvedPoses: snapped.poses, contacts }));
  }

  function plan(scene, input, env) {
    if (!fields(input, ['target', 'id', 'op', 'brush', 'poses', 'blendRadius', 'step', 'mat', 'snap']) ||
        !name(input.id) || !['add', 'cut'].includes(input.op))
      throw new TypeError('A snapped stroke needs a target, a unique ID, a sweep and an add or cut operation');
    const { target, id, op, snap, ...sweep } = clone(input), solid = host(scene, target);
    const existing = solid.modifiers ?? [];
    if (existing.some(row => row.id === id)) throw new RangeError('Modifier ID is already in use: ' + id);
    if (op === 'cut' && sweep.mat !== undefined) throw new TypeError('A snapped cut uses the receiving solid material');
    const shape = { kind: 'sweep', ...sweep };
    K.procedural.sweepSnap.check(snap, shape);
    const modifier = op === 'cut' ? { id, kind: 'mask', mode: 'cut', shape, snap } :
      { id, kind: 'join', how: 'union', shape, snap };
    const modifiers = [...existing, modifier];
    const next = { ...scene, solids: scene.solids.map(row => row === solid ? { ...row, modifiers } : row) };
    return { modifiers, report: inspect(next, target, id, env) };
  }

  K.authoring.sculptSnap = Object.freeze({ plan, inspect });
})(KIT);
