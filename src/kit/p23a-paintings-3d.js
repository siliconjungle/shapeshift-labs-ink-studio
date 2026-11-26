/* Retained 3D paintings and their scene placements. */
(function (K) {
  const format = 'ink-studio/painting-3d', { clone, freeze } = K.procedural.data;
  const DIO = K.diorama;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const name = value => K.world.data.id(value) && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const editable = ['brush', 'poses', 'step', 'blendRadius', 'path', 'pressureResponse', 'mat', 'res', 'transform', 'attachment', 'enabled'];

  function expand(source) {
    const anchors = new Map(), layers = new Set(), reports = [];
    if (source?.paintings3d === undefined) return { spec: source, anchors, layers, reports };
    const { paintings3d, ...scene } = source;
    if (!Array.isArray(paintings3d) || paintings3d.length > 64 ||
        scene.solids !== undefined && !Array.isArray(scene.solids) || scene.brushRegion != null)
      throw new TypeError('A native sculpt scene can contain up to 64 3D painting placements');
    const solids = scene.solids ?? [], graph = K.sceneGraph, placements = new Set();
    const hosts = new Map(solids.filter(s => s?.id).map(s => [s.id, s]));
    const parts = new Set(solids.filter(s => s?.part && !s.hold && !s.carve && !s.ghost).map(s => s.part));
    const occupied = new Set([...DIO.solids(scene)].map(s => s.id));
    const marks = [];
    for (const placement of paintings3d) {
      if (!fields(placement, ['id', 'painting', 'bindings', 'transform']) || !name(placement.id) || placements.has(placement.id))
        throw new TypeError('3D painting placements need unique IDs and a portable painting');
      const { id, painting, bindings = {}, transform } = placement;
      placements.add(id);
      if (!fields(painting, ['format', 'version', 'id', 'marks']) || painting.format !== format ||
          painting.version !== 1 || !name(painting.id) || !Array.isArray(painting.marks) || painting.marks.length > 256)
        throw new TypeError(id + ' needs a version 1 ' + format + ' document with up to 256 ordered marks');
      if (!record(bindings) || Object.entries(bindings).some(([slot, target]) => !name(slot) || !TargetSelectors.name(target)))
        throw new TypeError(id + ' bindings must map slot names to solid or part IDs');
      const frame = graph.transform(transform), ids = new Set(), slots = new Set();
      const report = { id, painting: painting.id, transform: frame, marks: [] };
      reports.push(report);
      for (const [order, mark] of painting.marks.entries()) {
        if (!fields(mark, ['id', ...editable]) || !name(mark.id) || ids.has(mark.id) || mark.mat === undefined ||
            mark.enabled !== undefined && typeof mark.enabled !== 'boolean' ||
            mark.res !== undefined && (!Number.isFinite(mark.res) || mark.res <= 0))
          throw new TypeError(id + ' mark ' + order + ' needs a unique ID, brush, poses and material');
        const { id: key, attachment = { kind: 'free' }, transform, enabled = true, ...stroke } = mark;
        ids.add(key);
        const solid = 'paint.' + id + '.' + key;
        const guideFrame = graph.compose(frame, graph.transform(transform));
        let restAffine = guideFrame, part, target;
        if (!fields(attachment, ['kind', 'slot', 'snap']) || !['free', 'surface', 'part'].includes(attachment.kind) ||
            (attachment.kind === 'free' ? attachment.slot !== undefined : !name(attachment.slot)) ||
            (attachment.kind === 'surface') !== (attachment.snap !== undefined))
          throw new TypeError(solid + ' needs a free, surface or part attachment');
        const shape = { kind: 'sweep', id: solid, ...stroke };
        try {
          K.procedural.shapeSweeps.prepare(shape);
          if (attachment.kind === 'surface') K.procedural.sweepSnap.check(attachment.snap, shape);
        } catch (error) {
          throw new RangeError(solid + ' ' + error.message, { cause: error });
        }
        if (attachment.slot !== undefined) {
          slots.add(attachment.slot);
          if (Object.hasOwn(bindings, attachment.slot)) target = bindings[attachment.slot];
          if (enabled && target === undefined) throw new RangeError(solid + ' needs a binding for slot ' + attachment.slot);
        }
        if (enabled) {
          if (occupied.has(solid)) throw new RangeError('3D painting solid ID is already in use: ' + solid);
          occupied.add(solid);
          if (attachment.kind === 'surface') {
            const host = hosts.get(target);
            if (!host || host.kind === 'ground' || host.carve || host.ghost || host.hold)
              throw new RangeError(solid + ' needs a named exterior sculpt for slot ' + attachment.slot);
            part = host.part;
            restAffine = graph.compose(DIO.solidFrames.rest(host), guideFrame);
            anchors.set(solid, { host, guideFrame, snap: attachment.snap });
          } else if (attachment.kind === 'part') {
            if (!parts.has(target)) throw new RangeError(solid + ' needs an existing sculpt rig part for slot ' + attachment.slot);
            part = target;
          }
          layers.add(solid);
          marks.push({ ...shape, restAffine, ...(part && { part }) });
          if (marks.length > 4096) throw new RangeError('A scene can render up to 4096 painting marks');
        }
        report.marks.push({ id: key, order, enabled, attachment: attachment.kind, ...(attachment.slot && { slot: attachment.slot }),
          ...(target && { target }), ...(part && { part }), ...(enabled && { solid, transform: restAffine }),
          brush: stroke.brush.kind, material: stroke.mat, poses: stroke.poses.length,
          ...(stroke.path !== undefined && { path: stroke.path }), ...(stroke.pressureResponse && { pressureResponse: stroke.pressureResponse }) });
      }
      for (const slot of Object.keys(bindings)) if (!slots.has(slot))
        throw new RangeError(id + ' has no attachment slot ' + slot);
    }
    // Field ownership breaks a tie in insertion order, so later marks are built first.
    return { spec: { ...scene, solids: [...solids, ...marks.reverse()] }, anchors, layers, reports };
  }

  function editMarks(painting, edits) {
    if (!Array.isArray(edits) || !edits.length) throw new TypeError('Mark edits must be a nonempty ordered array');
    const marks = painting.marks.slice();
    for (const change of edits) {
      if (!record(change) || !name(change.id)) throw new TypeError('A mark edit needs an operation and mark ID');
      const index = marks.findIndex(mark => mark.id === change.id);
      if (change.op === 'add') {
        if (!fields(change, ['op', 'id', 'mark']) || index !== -1 || !fields(change.mark, editable))
          throw new TypeError('An add edit needs a new ID and mark settings');
        marks.push({ ...change.mark, id: change.id });
        continue;
      }
      if (index === -1) throw new RangeError('Unknown mark ' + change.id);
      if (change.op === 'remove' && fields(change, ['op', 'id'])) marks.splice(index, 1);
      else if (change.op === 'set' && fields(change, ['op', 'id', 'patch']) && fields(change.patch, editable)) {
        const updated = { ...marks[index], ...change.patch };
        for (const [key, value] of Object.entries(change.patch)) if (value === null) delete updated[key];
        marks[index] = updated;
      } else if (change.op === 'move' && fields(change, ['op', 'id', 'before'])) {
        const [mark] = marks.splice(index, 1);
        const before = change.before === undefined ? marks.length : marks.findIndex(row => row.id === change.before);
        if (before < 0) throw new RangeError('Unknown destination mark ' + change.before);
        marks.splice(before, 0, mark);
      } else throw new TypeError('Use add, remove, set or move to edit a mark');
    }
    return { ...painting, marks };
  }

  function revise(scene, input, update = false) {
    const value = clone(input), list = scene.paintings3d ?? [];
    if (!record(value) || !name(value.id)) throw new TypeError('A 3D painting request needs a placement ID');
    const index = list.findIndex(row => row.id === value.id);
    if (!update) {
      if (index !== -1) throw new RangeError('3D painting placement is already in use: ' + value.id);
      return [...list, value];
    }
    if (index === -1) throw new RangeError('Unknown 3D painting placement ' + value.id);
    if (!fields(value, ['id', 'transform', 'bindings', 'painting', 'edits']) ||
        value.painting !== undefined && value.edits !== undefined)
      throw new TypeError('A painting update can replace the document or edit marks, bindings and transform');
    const { edits, ...patch } = value, current = list[index];
    const revised = { ...current, ...patch, ...(edits !== undefined && { painting: editMarks(current.painting, edits) }) };
    for (const key of ['transform', 'bindings']) if (revised[key] === null) delete revised[key];
    return list.map((row, i) => i === index ? revised : row);
  }

  function extract(scene, id) {
    const placement = scene.paintings3d?.find(row => row.id === id);
    if (!placement) throw new RangeError('Unknown 3D painting placement ' + id);
    return freeze(clone(placement.painting));
  }

  K.authoring.paintings3d = Object.freeze({ format, expand, revise, extract });
})(KIT);
