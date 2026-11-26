/* Time-sampled circular bends for retained cubic spline controls. */
(function (K) {
  const { V } = K, retained = K.curve.retained;
  const format = 'ink-studio/curve-bend';
  const vector = p => Array.isArray(p) && p.length === 3 &&
    Array.from(p).every(n => Number.isFinite(n) && Math.abs(n) <= 1e5);
  const fields = (value, names) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).every(name => names.includes(name));

  function create(source, request) {
    const rest = retained.create(source), revision = retained.revision(rest);
    if (!fields(request, ['format', 'version', 'revision', 'spline', 'origin', 'axis', 'toward', 'length', 'keys']) ||
        request.format !== format || request.version !== 1)
      throw new TypeError('Expected a version 1 curve bend');
    const { spline, origin, axis, toward, length, keys } = request;
    if (request.revision !== undefined && request.revision !== revision)
      throw new RangeError('Curve bend was authored against a different revision');
    const target = rest.splines.find(row => row.id === spline);
    if (!target || ![origin, axis, toward].every(vector) || V.len(axis) < 1e-8 || V.len(toward) < 1e-8 ||
        !Number.isFinite(length) || length < 1e-4 || length > 1e5 || !Array.isArray(keys) || !keys.length || keys.length > 256)
      throw new RangeError('Curve bend needs a spline, frame, reference length and 1 to 256 keys');

    const along = V.norm(axis), side = V.cross(along, V.norm(toward));
    if (V.len(side) < 1e-8) throw new RangeError('Curve bend direction must differ from its longitudinal axis');
    const binormal = V.norm(side), normal = V.cross(binormal, along), pivot = origin.slice();
    const track = K.anim.keyframeTrack.create({ angle: 'number' }, Array.from(keys, key => {
      if (!fields(key, ['time', 'angle', 'ease']) || !Number.isFinite(key.angle) || Math.abs(key.angle) > 2 * Math.PI)
        throw new RangeError('Curve bend keys need an angle within one turn');
      return { time: key.time, ease: key.ease, value: { angle: key.angle } };
    }));
    const attachments = rest.attachments.filter(row => row.spline === spline);

    function sample(time) {
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Curve bend sample time must be nonnegative');
      const { angle } = track.sample(time);
      const curvature = angle / length;
      function frame(p) {
        const displacement = V.sub(p, pivot), s = V.dot(displacement, along), offset = V.dot(displacement, normal);
        const theta = s * curvature, sine = Math.sin(theta), cosine = Math.cos(theta);
        const tangent = V.add(V.mul(along, cosine), V.mul(normal, sine));
        const radial = V.sub(V.mul(normal, cosine), V.mul(along, sine));
        // Half-angle form stays accurate close to the rest pose.
        const forward = theta === 0 ? s : s * sine / theta;
        const inward = theta === 0 ? 0 : 2 * s * Math.sin(theta / 2)**2 / theta;
        const position = V.add(pivot, V.add(V.mul(along, forward),
          V.add(V.mul(normal, inward), V.add(V.mul(radial, offset),
            V.mul(binormal, V.dot(displacement, binormal))))));
        function direction(v, stretch) {
          return V.add(V.mul(tangent, V.dot(v, along) * stretch), V.add(
            V.mul(radial, V.dot(v, normal)), V.mul(binormal, V.dot(v, binormal))));
        }
        return { position, handle: v => direction(v, 1 - curvature * offset), up: v => direction(v, 1) };
      }
      const points = angle === 0 ? target.points : target.points.map(row => {
        const { position, handle } = frame(row.position);
        return { ...row, position, inHandle: handle(row.inHandle), outHandle: handle(row.outHandle) };
      });
      const document = angle === 0 ? rest : retained.create({ ...rest, splines: rest.splines.map(row => row === target
        ? { ...row, points, up: frame(target.points[0].position).up(row.up) } : row) });
      const initial = retained.compile(rest, spline), posed = retained.compile(document, spline);
      return { document, report: { revision, outputRevision: retained.revision(document), spline, time, angle,
        restLength: initial.length, posedLength: posed.length,
        attachments: attachments.map(({ id, segment, t }) => {
          const before = initial.anchor(segment, t), after = posed.anchor(segment, t);
          return { id, segment, t, before: before.p, after: after.p, distance: V.dist(before.p, after.p) };
        }) } };
    }

    return Object.freeze({ duration: track.duration, sample });
  }

  K.curve.bend = Object.freeze({ format, create });
})(KIT);
