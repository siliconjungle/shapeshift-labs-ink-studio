/* View-dependent subdivision of authored finite spans. */
const CurveSubdivision = (() => {
  const kernel = typeof CurveSplat === 'undefined' ? require('./curve-splat.js') : CurveSplat;
  const coordinates = [0, 1, 2], covariance = [4, 5, 6, 8, 9, 10];
  const defaults = Object.freeze({ pixels: .25, depthPixels: .25 });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const mix = (a, b, t) => a.map((value, k) => value + (b[k] - value) * t);

  function prepare(value) {
    if (value === undefined || value === false) return;
    if (value === true) return defaults;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !(key === 'pixels' || key === 'depthPixels')))
      throw new TypeError('Curve subdivision needs a pixel budget, true, or false');
    const { pixels = defaults.pixels, depthPixels = pixels } = value;
    if (![pixels, depthPixels].every(n => Number.isFinite(n) && n > 0 && n <= 4))
      throw new RangeError('Curve subdivision pixel budgets must be above zero and at most four');
    return { pixels, depthPixels };
  }

  function projector({ view, focal, near, ortho, artScale = 1 }, planes) {
    const artFocal = focal / artScale;
    const point = p => coordinates.map(i => view[i] * p[0] + view[i + 4] * p[1] + view[i + 8] * p[2] + view[i + 12]);
    const scale = z => artFocal / (ortho ? 1 : -z);
    function nearPlane(a, b, reach) {
      if (Math.min(-a[2], -b[2]) <= near + reach) return true;
      return planes.some(plane => {
        const width = reach * Math.hypot(plane[0], plane[1], plane[2]);
        const first = dot(a, plane) + plane[3], last = dot(b, plane) + plane[3];
        return Math.min(first, last) <= width && Math.max(first, last) >= -width;
      });
    }
    function compare(a, b) {
      return [Math.hypot(a[0] * scale(a[2]) - b[0] * scale(b[2]), a[1] * scale(a[2]) - b[1] * scale(b[2])),
        Math.abs(a[2] - b[2]) * Math.max(scale(a[2]), scale(b[2]))];
    }
    function sectionScale(a, b, reach) {
      if (ortho) return artFocal;
      const depth = Math.min(-a[2], -b[2]) - reach;
      const offset = Math.max(Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1])) + reach;
      return artFocal / depth * Math.hypot(1, offset / depth);
    }
    return { point, compare, nearPlane, sectionScale };
  }

  function viewPlane(view, { at, normal, bias = 0 }) {
    const plane = coordinates.map(i => view[i] * normal[0] + view[i+4] * normal[1] + view[i+8] * normal[2]);
    return [...plane, -dot(at, normal) - bias - dot(plane, view.slice(12, 15))];
  }

  function sameValues(rows, stride, first, second) {
    if (!rows) return true;
    for (let k = 0; k < stride; k++)
      if ((rows[first * stride + k] ?? 0) !== (rows[second * stride + k] ?? 0)) return false;
    return true;
  }

  function compatible(world, a, b) {
    return a.strand === b.strand && a.tag === b.tag && a.color === b.color && a.flags === b.flags &&
      a.alpha === b.alpha && a.aspect === b.aspect && a.part === b.part &&
      Math.abs(a.end - b.begin) <= 1e-6 && distance(a.to, b.from) <= 1e-5 &&
      sameValues(world.curveMaterials, kernel.materialStride, a.index, b.index) &&
      sameValues(world.curveLighting, kernel.lightingStride, a.index, b.index) &&
      (world.curveShadows?.[a.index] ?? 0) === (world.curveShadows?.[b.index] ?? 0) &&
      (world.renderMetadata?.muteEmission?.[a.index] ?? 0) === (world.renderMetadata?.muteEmission?.[b.index] ?? 0);
  }

  function across(major, axis) {
    const along = dot(major, axis), perpendicular = major.map((value, i) => value - along * axis[i]);
    const length = Math.hypot(...perpendicular);
    return length > 1e-8 && perpendicular.map(value => value / length);
  }

  function apparentTilt(a, b) {
    return Math.sqrt(Math.max(0, 1 - Math.min(1, dot(a, b) ** 2)));
  }

  function frame(world, camera, settings, {
    data = world.data, positionAt, alphaAt, scaleAt, keep, planes = []
  } = {}) {
    const stations = world.curveStations;
    if (!settings || !stations?.length) return;
    const patternStride = (typeof CurvePattern === 'undefined' ? require('./curve-pattern.js') : CurvePattern).stride;
    const projection = projector(camera, planes.filter(plane => plane?.some(Boolean)));
    const hidden = new Set(), geometry = new Map();
    const stats = { sourceSpans: 0, retainedSpans: 0, removedSpans: 0,
      splits: { position: 0, depth: 0, profile: 0, length: 0, fold: 0, clip: 0 },
      maxAcceptedPosition: 0, maxAcceptedDepth: 0, maxAcceptedProfile: 0 };
    let run = [];
    const rig = world.anim?.rig;

    function visit(first, last) {
      if (first === last) return;
      const a = run[first], b = run[last], sample = run[(first + last) >> 1];
      const axis = b.to.map((v, i) => v - a.from[i]);
      const length = Math.hypot(...axis);
      const major = sample.major && length > 1e-7 && across(sample.major, axis.map(v => v / length));
      let reason = length <= 1e-7 || sample.major && !major ? 'fold' : undefined;
      let xy = 0, depth = 0, profile = 0, arc = 0, scale = 0, previous = 0;
      const from = a.cameraFrom, to = b.cameraTo, total = b.end - a.begin;
      if (!reason && projection.nearPlane(from, to, sample.reach)) reason = 'clip';
      for (let i = first; !reason && i <= last; i++) {
        const row = run[i];
        arc += 2 * row.half;
        const offset = row.to.map((v, k) => v - a.from[k]);
        const progress = dot(axis, offset) / (length * length);
        if (progress < previous - 1e-6 || progress > 1 + 1e-6) { reason = 'fold'; break; }
        previous = progress;
        const expected = mix(from, to, (row.end - a.begin) / total);
        if (-expected[2] <= camera.near) { reason = 'clip'; break; }
        const [screen, axial] = projection.compare(row.cameraTo, expected);
        xy = Math.max(xy, screen);
        depth = Math.max(depth, axial);
        const magnification = Math.max(projection.sectionScale(row.cameraFrom, row.cameraTo, row.reach),
          projection.sectionScale(expected, expected, sample.reach));
        scale = Math.max(scale, magnification);
        const twist = major ? apparentTilt(major, row.major) * (row.section === 2 ? 1 : 1 - row.aspect) : 0;
        profile = Math.max(profile, magnification * row.support *
          (Math.abs(row.radius - sample.radius) + Math.min(row.radius, sample.radius) * twist));
        if (depth > settings.depthPixels) reason = 'depth';
        else if (profile > settings.pixels) reason = 'profile';
        else if (xy + profile > settings.pixels) reason = 'position';
      }
      // A tight coil could fit inside the tolerance and still contribute much
      // more optical mass than its chord. Keep its authored travel in that case.
      if (!reason && !sample.group && (arc - length) * scale > settings.pixels) reason = 'length';
      if (reason) {
        stats.splits[reason]++;
        const middle = (first + last) >> 1;
        visit(first, middle);
        visit(middle + 1, last);
        return;
      }
      const section = major && { major, aspect:sample.aspect, flattened:sample.section === 2 };
      const carrier = kernel.carrier(a.from, b.to, sample.radius, section);
      const row = data.slice(a.index * 16, a.index * 16 + 16);
      row.set(carrier.center);
      for (const [i, slot] of covariance.entries()) row[slot] = carrier.covariance[i];
      row[12] = sample.radius;
      row[13] = carrier.half;
      geometry.set(a.index, { data:row, center:carrier.center, endIndex:b.index });
      for (let i = first + 1; i <= last; i++) hidden.add(run[i].index);
      stats.maxAcceptedPosition = Math.max(stats.maxAcceptedPosition, xy + profile);
      stats.maxAcceptedDepth = Math.max(stats.maxAcceptedDepth, depth);
      stats.maxAcceptedProfile = Math.max(stats.maxAcceptedProfile, profile);
    }

    function close() {
      if (run.length > 1) visit(0, run.length - 1);
      run = [];
    }
    function read(index) {
      const q = index * 16, at = index * kernel.stationStride, clips = index * kernel.clipStride;
      const strand = stations[at], begin = stations[at + 1], end = stations[at + 2];
      if (!strand || !(end > begin) || world.curveTiming?.[index * kernel.timingStride] ||
          world.curvePattern?.[index * patternStride] || [3,4,5,9,10,11].some(k => world.curveClips?.[clips + k])) return;
      const shape = kernel.spanShape(data, q, scaleAt?.(index) ?? 1);
      if (!shape) return;
      const center = positionAt?.(index) ?? data.subarray(q, q + 3);
      const axis = dot(shape.axis, stations.subarray(at + 4, at + 7)) < 0 ? shape.axis.map(v => -v) : shape.axis;
      const from = axis.map((v, i) => center[i] - shape.half * v), to = axis.map((v, i) => center[i] + shape.half * v);
      const cameraFrom = projection.point(from), cameraTo = projection.point(to);
      const reach = shape.radius * shape.support;
      if (projection.nearPlane(cameraFrom, cameraTo, reach)) return;
      return { ...shape, index, strand, begin, end, from, to, cameraFrom, cameraTo, reach,
        alpha:alphaAt?.(index) ?? data[q + 3], tag:data[q + 15], color:data[q + 7], flags:data[q + 11],
        aspect:shape.major ? data[q + 14] : 1, part:rig?.free?.[index] ? 0 : rig?.bid?.[index] ?? 0 };
    }

    for (let index = 0; index < world.count; index++) {
      const q = index * 16;
      if (keep && !keep(index) || !kernel.isRow(data, q) || (alphaAt?.(index) ?? data[q + 3]) <= 0) {
        close();
        continue;
      }
      stats.sourceSpans++;
      const row = read(index);
      if (!row || run.length && !compatible(world, run.at(-1), row)) close();
      if (row) run.push(row);
    }
    close();
    stats.removedSpans = hidden.size;
    stats.retainedSpans = stats.sourceSpans - stats.removedSpans;
    return { hidden, geometry, stats };
  }

  return Object.freeze({ prepare, frame, viewPlane });
})();
if (typeof module !== 'undefined') module.exports = CurveSubdivision;
