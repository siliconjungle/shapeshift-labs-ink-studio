/* Resolve retained sweep guides against the field immediately below the modifier. */
(function (K) {
  const { V, Q } = K, DIO = K.diorama;
  const limit = 1024, rotation = [0, 0, 0, 1];
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  function check(raw, shape) {
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype ||
        Object.keys(raw).some(key => !['mode', 'maxDistance', 'direction', 'offset', 'spacing', 'minFacing'].includes(key)) ||
        !['surface', 'root'].includes(raw.mode) || shape?.kind !== 'sweep')
      throw new TypeError('Sweep snapping needs a sweep operand and surface or root mode');
    const { maxDistance, direction, offset = 0, spacing, minFacing = .25 } = raw;
    if (!Number.isFinite(maxDistance) || maxDistance < .001 || maxDistance > 100 ||
        direction !== undefined && (!xyz(direction) || V.len(direction) < 1e-8 || !Number.isFinite(V.len(direction))) ||
        !Number.isFinite(offset) || Math.abs(offset) > 100 ||
        spacing !== undefined && (!Number.isFinite(spacing) || spacing < .0001 || spacing > 1 || raw.mode === 'root') ||
        !Number.isFinite(minFacing) || minFacing < 0 || minFacing > 1)
      throw new RangeError('Snap needs a reach of .001–100, an optional outward direction and signed offset, and valid surface spacing or facing');
    return { mode: raw.mode, maxDistance, direction: direction && V.norm(direction), offset, spacing, minFacing };
  }

  function normal(point, distance, h) {
    const gradient = point.map((_, i) => {
      const a = point.slice(), b = point.slice();
      a[i] -= h;
      b[i] += h;
      return distance(...b) - distance(...a);
    });
    if (!(V.len(gradient) > h * 1e-5)) throw new RangeError('The contact has no stable surface normal');
    return V.norm(gradient);
  }

  function resolve(shape, settings, distance) {
    const { mode, direction, maxDistance, offset, spacing, minFacing } = check(settings, shape);
    const frame = DIO.solidFrames.rest(shape), graph = K.sceneGraph, inverse = graph.inverse(frame);
    const toHost = point => graph.point(frame, point), toLocal = point => graph.point(inverse, point);
    const tolerance = Math.min(.00001, maxDistance * .01);
    const surface = direction && CurveGrowth.sdfSurface({ field: { distance }, reach: maxDistance, steps: 64, minFacing });
    const context = surface && surface.context({});
    const evaluated = (shape.path === 'ruled' || spacing === undefined) && K.procedural.shapeSweeps.prepare(shape);
    const poses = shape.path === 'ruled' ? evaluated.guide : shape.poses;

    function contact(pose, label) {
      const guide = toHost(pose.point);
      try {
        const hit = surface && surface.read(surface.anchor({ point: guide, normal: direction }), context);
        if (surface && !hit) throw new RangeError('No facing surface within reach');
        const point = hit?.p ?? meshComponentSnap.snapField({ maxDistance, tolerance }, guide, distance).point;
        const outward = hit?.n ?? normal(point, distance, tolerance * 2);
        const snapped = V.mad(point, outward, offset);
        return { pose: { ...pose, point: toLocal(snapped) }, guide, point, normal: outward, snapped };
      } catch (error) {
        throw new RangeError('Snap ' + label + ': ' + error.message, { cause: error });
      }
    }

    const root = contact(poses[0], 'root (pose 0)');
    if (mode === 'root') {
      const delta = V.sub(root.pose.point, poses[0].point);
      const shifted = poses.map(pose => ({ ...pose, point: V.add(pose.point, delta) }));
      return { poses: shifted, contacts: [root] };
    }

    const gap = spacing ?? evaluated.step;
    const contacts = [root];
    const between = (a, b, t) => ({ point: V.lerp(a.point, b.point, t),
      rotation: Q.slerp(Q.normalize(a.rotation ?? rotation), Q.normalize(b.rotation ?? rotation), t),
      pressure: (a.pressure ?? 1) + ((b.pressure ?? 1) - (a.pressure ?? 1)) * t });
    function append(a, b, from, to, label, depth = 0) {
      if (contacts.length >= limit) throw new RangeError('Snapped sweep exceeds 1024 guides; increase spacing or shorten it');
      const separate = V.dot(from.normal, to.normal) < minFacing - 1e-8 ||
        Math.abs(distance(...V.lerp(from.point, to.point, .5))) > Math.max(.0005, gap * .2);
      if (separate) {
        if (depth >= 6) throw new RangeError('Snap ' + label + ': the path would cross a gap or change surface branches');
        const guide = between(a, b, .5), middle = contact(guide, label);
        append(a, guide, from, middle, label, depth + 1);
        append(guide, b, middle, to, label, depth + 1);
      } else contacts.push(to);
    }
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1], b = poses[i], label = 'segment ' + (i - 1) + '→' + i;
      const divisions = Math.max(1, Math.ceil(V.dist(toHost(a.point), toHost(b.point)) / gap));
      if (contacts.length + divisions > limit) throw new RangeError('Snapped sweep exceeds 1024 guides; increase spacing or shorten it');
      let previous = a, previousHit = contacts.at(-1);
      for (let j = 1; j <= divisions; j++) {
        const guide = j === divisions ? b : between(a, b, j / divisions), hit = contact(guide, label);
        append(previous, guide, previousHit, hit, label);
        previous = guide;
        previousHit = hit;
      }
    }
    return { poses: contacts.map(contact => contact.pose), contacts };
  }

  K.procedural.sweepSnap = Object.freeze({ check, resolve });
})(KIT);
