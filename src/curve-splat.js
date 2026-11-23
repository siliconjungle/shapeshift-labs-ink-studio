/* Finite strand kernels carried by ordinary native splat rows. */
const CurveSplat = (() => {
  // Kind zero leaves the motion payload free. Preserve the tag through native row copies.
  const marker = -161291.375, minimum = 1e-5, clipStride = 12, materialStride = 4, lightingStride = 7, timingStride = 8;
  const hardBase = 1 << 20, maxHardGroups = (1 << 20) - 1;
  const stationStride = 7;
  const castShadow = 1, receiveShadow = 2;
  const overlapsDepth = (a, b) => a[0] <= b[1] + 1e-6 && b[0] <= a[1] + 1e-6;
  const betaRadius = Math.sqrt(6), betaIntegral = 5 * Math.PI / 16;
  // Seven-point Gaussian quadrature across the flat section, with rounded Gaussian edges.
  const flatBlur = .25, flatNormalization = 1 / (Math.sqrt(2 * Math.PI) * flatBlur);
  const ribbonSamples = [
    [-.949107912342759, .129484966168870], [-.741531185599394, .279705391489277],
    [-.405845151377397, .381830050505119], [0, .417959183673469],
    [.405845151377397, .381830050505119], [.741531185599394, .279705391489277],
    [.949107912342759, .129484966168870]
  ];
  const alongX = [1, 0, 0], alongY = [0, 1, 0];
  // Keep the axial eigenvalue separate from the transverse values even for very short spans.
  const axialUnits = (radius, half) => Math.max(4, Math.min(64, 1 + (half / radius) ** 2 / 3));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => {
    const length = Math.hypot(...a);
    return length > 0 ? a.map(v => v / length) : null;
  };
  function tag(section, edge, group) {
    if (edge === 'hard') {
      if (!Number.isSafeInteger(group) || group < 1 || group > maxHardGroups)
        throw new RangeError('Hard curve splat group budget exceeded');
      return -(hardBase + group * 4 + section);
    }
    return marker - section - (edge === 'beta' ? 3 : 0);
  }
  function hardGroup(value) {
    const packed = -value - hardBase;
    return Number.isInteger(packed) && packed >= 4 && packed <= maxHardGroups * 4 + 2 &&
      (packed & 3) < 3 ? packed >> 2 : 0;
  }
  const sectionOf = value => {
    const code = marker - value;
    return Number.isInteger(code) && code >= 0 && code <= 5 ? code % 3 :
      hardGroup(value) ? (-value - hardBase) & 3 : -1;
  };
  const isRow = (data, at) => sectionOf(data[at + 15]) >= 0 &&
    (data[at + 11] & 15) === 0 && data[at + 12] > 0 && data[at + 13] > 0;

  const covarianceTerms = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  function carrier(from, to, radius, profile) {
    const delta = to.map((value, axis) => value - from[axis]);
    const half = Math.hypot(...delta) / 2;
    if (!(half > 0)) return null;
    const center = from.map((value, axis) => value + delta[axis] * .5);
    const axis = delta.map(value => value / (2 * half)), variance = radius * radius;
    if (!profile) {
      const along = half * half / 3;
      return { center, half, axis, covariance: covarianceTerms.map(([i, j]) => (i === j ? variance : 0) + along * axis[i] * axis[j]) };
    }
    const normal = cross(axis, profile.major), major = cross(normal, axis);
    const along = variance * axialUnits(radius, half), minor = variance * profile.aspect ** 2;
    return { center, half, axis, normal, covariance: covarianceTerms.map(([i, j]) =>
      along * axis[i] * axis[j] + variance * major[i] * major[j] + minor * normal[i] * normal[j]) };
  }

  function writeClips(rows, index, center, clips) {
    const start = index * clipStride;
    rows.fill(0, start, start + clipStride);
    for (let i = 0; i < clips.length; i++) if (clips[i]) {
      const { point, normal } = clips[i];
      rows.set(point.map((v, k) => v - center[k]).concat(normal), start + i * 6);
    }
  }

  function joinGroups(data, first, count, nextGroup) {
    const remap = new Map();
    for (let i = first; i < first + count; i++) {
      const at = i * 16 + 15, value = data[at], old = hardGroup(value);
      if (!old || !isRow(data, at - 15)) continue;
      if (!remap.has(old)) remap.set(old, nextGroup());
      data[at] = tag(sectionOf(value), 'hard', remap.get(old));
    }
  }

  function profiledDimensions(radius, half, aspect, scale, xx, xy, xz, yy, yz, zz) {
    const ratio = aspect * aspect, longitudinal = axialUnits(radius, half);
    const variance = (xx + yy + zz) / (longitudinal + 1 + ratio);
    const size = Math.sqrt(variance) * scale;
    if (!(size > 0) || !(aspect >= .1 && aspect < 1)) return null;
    const matrix = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]].map(row => row.map(v => v / variance));
    const pivot = matrix[0][0] >= matrix[1][1] && matrix[0][0] >= matrix[2][2] ? 0 :
      matrix[1][1] >= matrix[2][2] ? 1 : 2;
    let axis = unit(matrix[pivot]);
    if (!axis) return null;
    for (let i = 0; i < 16; i++) axis = unit(matrix.map(row => dot(row, axis)));
    const across = matrix.map((row, i) => row.map((v, j) =>
      v - (i === j ? ratio : 0) - (longitudinal - ratio) * axis[i] * axis[j]));
    const transverse = across[0][0] >= across[1][1] && across[0][0] >= across[2][2] ? across[0] :
      across[1][1] >= across[2][2] ? across[1] : across[2];
    const along = dot(transverse, axis);
    const major = unit(transverse.map((v, i) => v - along * axis[i]));
    if (!major) return null;
    return {
      axis, major, minor: cross(axis, major).map(v => v / aspect), radius: size, half: half * size / radius
    };
  }

  function dimensions(data, at, scale, section) {
    const radius = data[at + 12], half = data[at + 13];
    const xx = data[at + 4], xy = data[at + 5], xz = data[at + 6];
    const yy = data[at + 8], yz = data[at + 9], zz = data[at + 10];
    if (section !== 0)
      return profiledDimensions(radius, half, data[at + 14], scale, xx, xy, xz, yy, yz, zz);
    // The carrier stores the covariance of a uniform segment convolved with a round Gaussian.
    // Its principal axis also follows native rigid transforms. Recover the uniform scale from the trace.
    const ratio = (xx + yy + zz) / (3 * radius * radius + half * half / 3);
    const variance = ratio * radius * radius;
    const axis = xx >= yy && xx >= zz ? [xx - variance, xy, xz] :
      yy >= zz ? [xy, yy - variance, yz] : [xz, yz, zz - variance];
    const norm = Math.hypot(...axis), size = Math.sqrt(ratio) * scale;
    if (!(size > 0)) return null;
    return { axis: norm > variance * 1e-7 ? axis.map(v => v / norm) : [1, 0, 0],
      radius: radius * size, half: half * size };
  }

  function supportFactor(section, group, beta) {
    return group ? (section === 2 ? 2 : 1) : beta ? betaRadius + Number(section === 2) : 5;
  }

  function spanShape(data, at, scale) {
    if (!isRow(data, at)) return;
    const tag = data[at + 15], section = sectionOf(tag), group = hardGroup(tag);
    const shape = dimensions(data, at, scale, section), beta = !group && marker - tag >= 3;
    return shape && { ...shape, section, group, support:supportFactor(section, group, beta) };
  }

  function roundSpan(data, at, scale, center) {
    if (!isRow(data, at) || sectionOf(data[at + 15]) !== 0) return;
    const shape = dimensions(data, at, scale, 0);
    if (!shape) return;
    const { axis, half, radius } = shape;
    return { radius, from: center.map((v, i) => v - half * axis[i]), to: center.map((v, i) => v + half * axis[i]) };
  }

  function erf(x) {
    const t = 1 / (1 + .3275911 * Math.abs(x));
    return Math.sign(x) * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      .284496736) * t + .254829592) * t * Math.exp(-x * x));
  }

  function clipPlanes(rows, index, position, scale, frame) {
    const at = index * clipStride;
    if (!rows || at >= rows.length) return null;
    const matrix = frame?.basis().anchor;
    const planes = [];
    for (const offset of [at, at + 6]) {
      const normal = Array.from(rows.subarray(offset + 3, offset + 6));
      if (!normal.some(Boolean)) continue;
      let delta = Array.from(rows.subarray(offset, offset + 3));
      if (matrix) delta = [0, 3, 6].map(i => matrix[i] * delta[0] + matrix[i + 1] * delta[1] + matrix[i + 2] * delta[2]);
      const direction = unit(frame ? frame.worldCovector(normal) : normal);
      if (direction) planes.push({ point: position.map((v, i) => v + delta[i] * scale), normal: direction });
    }
    return planes.length ? planes : null;
  }

  function timeWindow(rows, at, state, trail, time) {
    const u = rows[at + 1], length = rows[at + 2] - u;
    let first = Math.max(0, (state.start - u) / length), last = Math.min(1, (state.end - u) / length);
    let width = state.width, fade = state.opacity;
    if (trail) {
      const birth = rows[at + 3], duration = rows[at + 4] - birth, sinceBirth = time - birth;
      if (duration > 0) {
        first = Math.max(first, (sinceBirth - trail.lifetime) / duration);
        last = Math.min(last, sinceBirth / duration);
      } else if (sinceBirth < 0 || sinceBirth >= trail.lifetime) return null;
      if (first >= last) return null;
      const age = Math.max(0, sinceBirth - duration * (first + last) / 2);
      const sample = { u: Math.min(1, age / trail.lifetime), age, time };
      width *= trail.width.sample(sample);
      fade *= trail.fade.sample(sample);
    }
    return first < last && width > 0 && fade > 0 ? { first, last, width, fade,
      direction: rows.subarray(at + 5, at + timingStride) } : null;
  }

  function timedOpacity(value, fade, tag) {
    if (fade === 1) return value;
    return hardGroup(tag) ? value * fade : -Math.expm1(Math.log1p(-Math.min(.999, value)) * fade);
  }

  function spanBounds(axis, window) {
    if (!window) return [0, 1];
    return dot(window.direction, axis) < 0 ? [1 - window.last, 1 - window.first] : [window.first, window.last];
  }

  function timedCarrier(data, at, scale, window) {
    const section = sectionOf(data[at + 15]);
    const shape = dimensions(data, at, 1, section);
    if (!shape) return null;
    const { axis, half, radius, major } = shape;
    const [begin, end] = spanBounds(axis, window);
    const endpoint = u => axis.map(value => (2 * u - 1) * half * value);
    const profile = major && { major, aspect: data[at + 14] };
    const trimmed = carrier(endpoint(begin), endpoint(end), radius * window.width, profile);
    if (!trimmed) return null;
    return { offset: trimmed.center.map(value => value * scale), covariance: trimmed.covariance };
  }

  function projectWidth(policy, shape, radius, aspect, flattened, camera, ends) {
    const { view, focal, width, height, ortho, artScale = 1 } = camera;
    const inverse = ends.map(point => ortho ? 1 : -1 / point[2]);
    const [start, end] = ends.map(([x, y], i) => [x * inverse[i], y * inverse[i]]);
    const dx = end[0] - start[0], dy = end[1] - start[1], span = Math.hypot(dx, dy);
    let normal = span * focal > 1e-7 ? [-dy / span, dx / span] : null;
    if (!normal) {
      // A nearly end-on curve has no useful screen tangent. Measure across
      // the projected major axis or across the view ray for a round section.
      const major = shape.major && [0, 1, 2].map(j =>
        shape.major[0] * view[j] + shape.major[1] * view[j + 4] + shape.major[2] * view[j + 8]);
      const tangent = major ? start.map((value, i) => major[i] + (ortho ? 0 : value * major[2])) : start;
      const length = Math.hypot(...tangent);
      normal = length > 1e-12 ? [-tangent[1] / length, tangent[0] / length] : [1, 0];
    }
    const [nx, ny] = normal, skew = ortho ? 0 : nx * start[0] + ny * start[1];
    const across = [0, 4, 8].map(i => nx * view[i] + ny * view[i + 1] + skew * view[i + 2]);
    const major = shape.major ? dot(across, shape.major) : 0;
    const minor = shape.minor ? dot(across, shape.minor) * aspect ** 2 : 0;
    const reach = flattened ? (1 - flatBlur) * Math.abs(major) + Math.hypot(major * flatBlur, minor) :
      shape.major ? Math.hypot(major, minor) : Math.hypot(...across);
    const rate = 2 * radius * reach * focal / artScale;
    const widths = inverse.map(value => rate * value);
    const fade = policy.mode === 'fade';
    const low = policy.weight(Math.min(...widths)), high = policy.weight(Math.max(...widths));
    if (fade && high === 0) return null;
    if (low === 1 && high === 1) return;
    if (low === high) return { fade, bound: fade ? 1 : low, constant: low };
    const sx = width / 2 + start[0] * focal, sy = height / 2 + start[1] * focal;
    const ux = span ? dx / (span * span * focal) : 0, uy = span ? dy / (span * span * focal) : 0;
    return { fade, bound: fade ? 1 : low, weight(x, y) {
      const u = Math.max(0, Math.min(1, (x - sx) * ux + (y - sy) * uy));
      return policy.weight(widths[0] + (widths[1] - widths[0]) * u);
    } };
  }

  function prepare(data, at, position, scale, opacity, camera, clips, window, widthPolicy, pattern, track) {
    const { view, near, focal, width, height, ortho } = camera;
    const packed = data[at + 15], section = sectionOf(packed);
    if (section < 0) return null;
    const shape = dimensions(data, at, scale, section);
    if (!shape) return null;
    const group = hardGroup(packed), beta = !group && marker - packed >= 3, flattened = section === 2;
    const { axis, half } = shape, radius = shape.radius * (window?.width ?? 1);
    const [begin, finish] = spanBounds(axis, window);
    const cameraPoint = p => [0, 1, 2].map(i => p[0] * view[i] + p[1] * view[i + 4] + p[2] * view[i + 8] + view[i + 12]);
    const start = position.map((v, i) => v + (2 * begin - 1) * half * axis[i]);
    const end = position.map((v, i) => v + (2 * finish - 1) * half * axis[i]);
    const a = cameraPoint(start), b = cameraPoint(end);
    if (a[2] > -near && b[2] > -near) return null;
    const clip = (p, q) => (-near - p[2]) / (q[2] - p[2]);
    const first = a[2] > -near ? clip(a, b) : 0;
    const last = b[2] > -near ? 1 - clip(b, a) : 1;
    const length = (last - first) * (finish - begin) * 2 * half;
    if (!(length > 0)) return null;
    const from = start.map((v, i) => v + first * (end[i] - v));
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const ends = [first, last].map(u => a.map((v, i) => v + u * (b[i] - v)));
    const projectedWidth = widthPolicy ? projectWidth(widthPolicy, shape, radius, data[at + 14], flattened, camera, ends) : undefined;
    if (projectedWidth === null) return null;
    const support = radius * (projectedWidth?.bound ?? 1) * supportFactor(section, group, beta);
    for (const [x, y, z] of ends) {
      const depth = Math.max(near, -z), magnification = ortho ? focal : focal / depth;
      const reach = ortho ? focal * support : focal * support / Math.max(near, depth - support);
      const ex = reach * (ortho ? 1 : 1 + Math.abs(x) / depth);
      const ey = reach * (ortho ? 1 : 1 + Math.abs(y) / depth);
      const sx = width / 2 + x * magnification, sy = height / 2 + y * magnification;
      bounds[0] = Math.min(bounds[0], sx - ex);
      bounds[1] = Math.min(bounds[1], sy - ey);
      bounds[2] = Math.max(bounds[2], sx + ex);
      bounds[3] = Math.max(bounds[3], sy + ey);
    }
    const middle = a.map((v, i) => v + (first + last) / 2 * (b[i] - v));
    const fixed = projectedWidth?.constant ?? 1, fixedFade = projectedWidth?.fade ? fixed : 1;
    return { from, axis, radius: projectedWidth?.fade ? radius : radius * fixed, length, bounds, middle,
      ...(track && { track: { start: position.map((v, i) => v - half * axis[i]),
        end: position.map((v, i) => v + half * axis[i]),
        first: begin + (finish - begin) * first, last: begin + (finish - begin) * last } }),
      major: shape.major, minor: shape.minor, flattened, group, beta, opacity: opacity * fixedFade, clips,
      projectedWidth, pattern: pattern?.(axis, position, half, scale),
      tau: -Math.log1p(-Math.min(.999, opacity)) * fixedFade };
  }

  // The integral is optical depth per unit strength, with the nearest point on the sampled axis.
  function kernel(length, radius, transverse, dx, dy, dz, px, py, pz) {
    const sigma = radius * Math.SQRT2;
    let at, nearest, integral;
    if (transverse * length < 1e-4 * radius) {
      at = nearest = length / 2;
      integral = length / (radius * Math.sqrt(2 * Math.PI));
    } else {
      nearest = -(px * dx + py * dy + pz * dz) / (transverse * transverse);
      at = Math.max(0, Math.min(length, nearest));
      const lo = -nearest * transverse / sigma, hi = (length - nearest) * transverse / sigma;
      if (lo >= 4 || hi <= -4) return null;
      integral = (erf(hi) - erf(lo)) / (2 * transverse);
    }
    const offset = Math.hypot(px + nearest * dx, py + nearest * dy, pz + nearest * dz) / sigma;
    if (offset > 3.6) return null;
    return { at, amount: integral * Math.exp(-offset * offset) };
  }

  function betaPrimitive(x) {
    const square = x * x;
    return (x * Math.sqrt(Math.max(0, 1 - square)) * (33 - 26 * square + 8 * square * square) +
      15 * Math.asin(x)) / 48;
  }

  // A quadratic Beta ball leaves exponent 5/2 after integrating along the camera ray.
  function compactKernel(length, radius, transverse, dx, dy, dz, px, py, pz) {
    const limit = radius * betaRadius;
    if (transverse * length < 1e-4 * limit) {
      const at = length / 2;
      const q = 1 - (Math.hypot(px + at * dx, py + at * dy, pz + at * dz) / limit) ** 2;
      return q > 0 ? { at, amount: q ** 2.5 * length / (limit * betaIntegral) } : null;
    }
    const center = -(px * dx + py * dy + pz * dz) / (transverse * transverse);
    const q = 1 - (Math.hypot(px + center * dx, py + center * dy, pz + center * dz) / limit) ** 2;
    if (q <= 0) return null;
    const scale = transverse / (limit * Math.sqrt(q));
    const first = Math.max(-1, -center * scale), last = Math.min(1, (length - center) * scale);
    if (last <= first) return null;
    return { at: Math.max(0, Math.min(length, center)),
      amount: q ** 3 * (betaPrimitive(last) - betaPrimitive(first)) / (transverse * betaIntegral) };
  }

  function sphereEntry(center, ray, radius, near) {
    const at = dot(center, ray), offset = center.map((v, i) => v - at * ray[i]);
    const disc = radius * radius - dot(offset, offset);
    if (disc < 0) return Infinity;
    const reach = Math.sqrt(disc);
    return at + reach < near ? Infinity : Math.max(near, at - reach);
  }

  function capsuleEntry(start, ray, axis, length, radius, near) {
    const shift = dot(start, axis), tilt = dot(ray, axis);
    const end = start.map((v, i) => v + length * axis[i]);
    let first = Math.min(sphereEntry(start, ray, radius, near), sphereEntry(end, ray, radius, near));
    if (first === near) return near;
    const origin = start.map((v, i) => v - shift * axis[i]);
    const direction = ray.map((v, i) => v - tilt * axis[i]);
    const a = dot(direction, direction), b = dot(origin, direction);
    const c = dot(origin, origin) - radius * radius;
    const atNear = near * tilt - shift;
    if (atNear >= 0 && atNear <= length && a * near * near - 2 * b * near + c <= 0) return near;
    const disc = b * b - a * c;
    if (a > 1e-20 && disc >= 0) {
      const t = (b - Math.sqrt(disc)) / a, along = t * tilt - shift;
      if (t >= near && along >= 0 && along <= length) first = Math.min(first, t);
    }
    return first;
  }

  function boxEntry(start, ray, min, max, near) {
    let from = near, to = Infinity;
    for (let i = 0; i < 3; i++) {
      const lo = start[i] + min[i], hi = start[i] + max[i];
      if (Math.abs(ray[i]) < 1e-12) {
        if (lo > 0 || hi < 0) return Infinity;
      } else {
        const a = lo / ray[i], b = hi / ray[i];
        from = Math.max(from, Math.min(a, b));
        to = Math.min(to, Math.max(a, b));
        if (from > to) return Infinity;
      }
    }
    return from;
  }

  function hardEntry(start, ray, along, radius, length, flattened, near) {
    if (!flattened) return capsuleEntry(start, ray, along, length, radius, near);
    // The band is a rounded rectangle swept along the path. Its box and four edge
    // capsules form one solid; report the earliest hit across the union.
    const half = radius * (1 - flatBlur) / flatBlur;
    const lower = [start[0], start[1] - half, start[2]], upper = [start[0], start[1] + half, start[2]];
    const end = [start[0] + length, lower[1], start[2]];
    return Math.min(boxEntry(start, ray, [0, -half, -radius], [length, half, radius], near),
      capsuleEntry(lower, ray, alongX, length, radius, near), capsuleEntry(upper, ray, alongX, length, radius, near),
      capsuleEntry(lower, ray, alongY, 2 * half, radius, near), capsuleEntry(end, ray, alongY, 2 * half, radius, near));
  }

  function clipInterval(planes, origin, direction, from) {
    let to = Infinity;
    for (const { point, normal } of planes) {
      const offset = dot(normal, origin) - dot(normal, point), slope = dot(normal, direction);
      if (Math.abs(slope) < 1e-10) {
        if (offset < -1e-8) return null;
      } else if (slope > 0) from = Math.max(from, -offset / slope);
      else to = Math.min(to, -offset / slope);
      if (from > to + 1e-9) return null;
    }
    return [from, to];
  }

  function insideProjectedCaps(planes, origin, direction) {
    // Soft kernels use the tangent-plane cut projected perpendicular to the ray.
    // Evaluate the same boundary for every segment, including after subdivision.
    for (const { point, normal } of planes) {
      const facing = dot(normal, direction);
      if (Math.abs(facing) >= 1 - 1e-10) continue;
      const offset = origin.map((v, i) => v - point[i]);
      if (dot(normal, offset) - facing * dot(direction, offset) < -1e-8) return false;
    }
    return true;
  }

  // Approximate isotropic highlights on the strand's nominal section. The
  // separate coverage kernel still determines opacity and fragment depth.
  const defaultLight = unit([-.52, .64, .57]);
  function specular(roughness, normal, viewRay, sun) {
    if (!normal) return 0;
    const light = sun?.direction ?? defaultLight, facing = dot(normal, light);
    if (facing <= 0 || dot(normal, viewRay) >= 0) return 0;
    const half = unit(light.map((value, i) => value - viewRay[i]));
    if (!half) return 0;
    const exponent = 3 + 141 * (1 - roughness) ** 3;
    return Math.max(0, dot(normal, half)) ** exponent * facing *
      (.62 - .36 * roughness) * (sun?.intensity ?? 1);
  }

  const unpackColor = color => [color >> 16, (color >> 8) & 255, color & 255].map(value => value / 255);

  function lightingAt(rows, index, roughness, sun) {
    const at = index * lightingStride;
    if (!rows?.[at]) return;
    const anisotropy = rows[at] - 1, intensity = sun?.intensity ?? 1;
    const power = 3 + 141 * (1 - (roughness ?? .5)) ** 3;
    const diffuse = rows[at + 1], sheen = rows[at + 2] * intensity, specular = rows[at + 3] * intensity;
    const transmission = rows[at + 4] * intensity;
    return {
      light: sun?.direction ?? defaultLight, intensity, ambient: sun?.ambient ?? .42,
      normalPower: power * (1 - .82 * anisotropy), tangentPower: .72 * power * anisotropy,
      sheenPower: 6 * anisotropy, diffuse, sheen, specular, transmission,
      highlightColor: unpackColor(rows[at + 5]), transmissionColor: unpackColor(rows[at + 6]),
      needsNormal: Boolean(diffuse || sheen || specular || transmission)
    };
  }

  function directional(profile, tangent, normal, viewRay, out, visibility = 1) {
    const { light, intensity, ambient, diffuse, sheen, specular, transmission } = profile;
    const ndl = normal ? dot(normal, light) : 0, lit = Math.max(0, ndl);
    const viewFacing = normal ? Math.max(0, Math.min(1, -dot(normal, viewRay))) : 0;
    out[0] = 1 + diffuse * (ambient + intensity * lit * visibility - 1);
    out[1] = out[2] = 0;
    if (lit && viewFacing && (sheen || specular)) {
      const hx = light[0] - viewRay[0], hy = light[1] - viewRay[1], hz = light[2] - viewRay[2];
      const length = Math.hypot(hx, hy, hz);
      if (length > 1e-8) {
        const nh = Math.max(0, Math.min(1, (normal[0] * hx + normal[1] * hy + normal[2] * hz) / length));
        const th = (tangent[0] * hx + tangent[1] * hy + tangent[2] * hz) / length;
        // The reflection peaks when the half-vector is perpendicular to the strand.
        const lateral = Math.max(0, 1 - th * th);
        const glint = specular * lit * nh ** profile.normalPower * lateral ** profile.tangentPower;
        const fibre = sheen * Math.sqrt(lit) * (.23 + .77 * (1 - viewFacing) ** 1.5) *
          Math.sqrt(nh) * lateral ** profile.sheenPower;
        out[1] = (glint + fibre) * visibility;
      }
    }
    if (transmission) {
      // Approximate forward scatter through thin fibres, including the soft kernel's halo.
      const backlit = Math.max(0, dot(light, viewRay)), tl = dot(tangent, light);
      const edge = .46 + .54 * (1 - viewFacing) ** 1.35;
      out[2] = visibility * transmission * backlit ** 3 * (1 - .65 * tl * tl) * edge * (.78 + .22 * Math.max(0, -ndl));
    }
  }

  function sectionNormal(strand, start, ray, along, entrance, finiteCaps) {
    const { axis, radius, length, major, minor, flattened } = strand;
    const offset = start.map((value, i) => entrance * ray[i] - value);
    const at = dot(offset, along);
    const position = finiteCaps ? Math.max(0, Math.min(length, at)) : at;
    const delta = offset.map((value, i) => value - along[i] * position);
    if (flattened) {
      const wing = radius * (1 - flatBlur) / flatBlur;
      delta[1] -= Math.max(-wing, Math.min(wing, delta[1]));
    }
    const blur = flattened ? flatBlur : 1;
    return unit(major ? axis.map((value, i) => value * delta[0] + major[i] * delta[1] / blur +
      minor[i] * delta[2]) : delta);
  }

  function radialEntry(start, ray, along, radius, near) {
    const shift = dot(start, along), tilt = dot(ray, along);
    const offset = start.map((value, i) => value - along[i] * shift);
    const direction = ray.map((value, i) => value - along[i] * tilt);
    const a = dot(direction, direction), b = dot(offset, direction);
    const disc = b * b - a * (dot(offset, offset) - radius * radius);
    if (a < 1e-20 || disc < 0) return Infinity;
    const reach = Math.sqrt(disc);
    return (b + reach) / a < near ? Infinity : Math.max(near, (b - reach) / a);
  }

  function softNormal(strand, start, ray, along, near) {
    const { radius, flattened } = strand;
    if (!flattened) {
      const t = radialEntry(start, ray, along, radius, near);
      return Number.isFinite(t) ? sectionNormal(strand, start, ray, along, t, false) : null;
    }
    // Intersect the rounded band in its transverse plane for a flat ribbon.
    const lateral = radius * (1 - flatBlur) / flatBlur;
    const limit = Math.abs(ray[2]) > 1e-12 ? (start[2] - Math.sign(ray[2]) * radius) / ray[2] : Infinity;
    const flat = limit >= near && Math.abs(ray[1] * limit - start[1]) <= lateral ? limit : Infinity;
    const a = radialEntry([start[0], start[1] - lateral, start[2]], ray, along, radius, near);
    const b = radialEntry([start[0], start[1] + lateral, start[2]], ray, along, radius, near);
    const t = Math.min(flat, a, b);
    return Number.isFinite(t) ? sectionNormal(strand, start, ray, along, t, false) : null;
  }

  function emissionAt(materials, index) {
    const at = index * materialStride;
    return materials?.[at + 1] || materials?.[at + 2] || materials?.[at + 3] ?
      materials.subarray(at + 1, at + 4) : undefined;
  }

  function sample(strand, { origin, direction, axial }, near, wantNormal, wantDensity, wantExit, wantStation) {
    const { from, axis, radius, length, major, minor, flattened, beta, group, clips } = strand;
    if (clips && !group && !insideProjectedCaps(clips, origin, direction)) return null;
    const offsetFromEye = [from[0] - origin[0], from[1] - origin[1], from[2] - origin[2]];
    const axialStart = dot(offsetFromEye, direction), axialSlope = dot(axis, direction);
    let start = offsetFromEye, ray = direction, along = axis, scale = 1;
    if (major) {
      // Whiten the section and integrate the Gaussian along the transformed ray.
      const blur = flattened ? flatBlur : 1;
      start = [dot(axis, offsetFromEye), dot(major, offsetFromEye) / blur, dot(minor, offsetFromEye)];
      ray = [axialSlope, dot(major, direction) / blur, dot(minor, direction)];
      scale = Math.hypot(...ray);
      ray = ray.map(v => v / scale);
      along = alongX;
    }
    if (group) {
      const interval = clips ? clipInterval(clips, origin, direction, near / axial) : [near / axial, Infinity];
      if (!interval) return null;
      const t = hardEntry(start, ray, along, radius, length, flattened, interval[0] * scale);
      if (!Number.isFinite(t) || t > interval[1] * scale + 1e-9 || strand.opacity < minimum) return null;
      const hit = { alpha: strand.opacity, depth: t * axial / scale };
      if (wantStation) hit.station = Math.max(0, Math.min(1, (axialSlope * t / scale - dot(offsetFromEye, axis)) / length));
      if (wantExit) {
        const reverse = ray.map(value => -value);
        const far = -hardEntry(start, reverse, along, radius, length, flattened, -Infinity);
        hit.exitDepth = Math.max(t, Math.min(far, interval[1] * scale)) * axial / scale;
      }
      if (wantNormal) {
        const clipped = clips && interval[0] > near / axial && Math.abs(t / scale - interval[0]) < 1e-8;
        const plane = clipped && clips.find(({ point, normal }) =>
          Math.abs(dot(normal, origin) + t / scale * dot(normal, direction) - dot(normal, point)) < 1e-8);
        hit.normal = plane ? plane.normal.map(value => -value) : sectionNormal(strand, start, ray, along, t, true);
      }
      return hit;
    }
    const tau = strand.tau / scale, integrate = beta ? compactKernel : kernel;
    const rayStart = major ? dot(start, ray) : axialStart, parallel = major ? ray[0] : axialSlope;
    const px = start[0] - rayStart * ray[0], py = start[1] - rayStart * ray[1], pz = start[2] - rayStart * ray[2];
    const dx = along[0] - parallel * ray[0], dy = along[1] - parallel * ray[1], dz = along[2] - parallel * ray[2];
    const transverse = Math.hypot(dx, dy, dz);
    if (!flattened) {
      const hit = integrate(length, radius, transverse, dx, dy, dz, px, py, pz);
      if (!hit) return null;
      const density = tau * hit.amount;
      const coverage = -Math.expm1(-density);
      if (!(coverage >= minimum)) return null;
      const sample = { alpha: coverage, depth: Math.max(near, axial * (axialStart + hit.at * axialSlope)) };
      if (wantStation) sample.station = hit.at / length;
      if (wantNormal) sample.normal = softNormal(strand, start, ray, along, near / axial * scale);
      if (wantDensity) sample.density = density;
      return sample;
    }

    // Integrate parallel strips before turning optical depth into a single fragment.
    let amount = 0, weightedDepth = 0, weightedStation = 0;
    const lateral = dot(major, direction);
    for (const [offset, weight] of ribbonSamples) {
      const shift = offset * radius, whitened = shift / flatBlur, alongRay = whitened * ray[1];
      const hit = integrate(length, radius, transverse, dx, dy, dz,
        px - alongRay * ray[0], py + whitened - alongRay * ray[1], pz - alongRay * ray[2]);
      if (!hit) continue;
      const mass = weight * hit.amount;
      amount += mass;
      weightedDepth += mass * (axialStart + shift * lateral + hit.at * axialSlope);
      if (wantStation) weightedStation += mass * hit.at;
    }
    const normalization = beta ? 35 / (32 * betaRadius * flatBlur) : flatNormalization;
    const density = tau * normalization * amount;
    const coverage = -Math.expm1(-density);
    if (coverage < minimum) return null;
    const hit = { alpha: coverage, depth: Math.max(near, axial * weightedDepth / amount) };
    if (wantStation) hit.station = weightedStation / (amount * length);
    if (wantNormal) hit.normal = softNormal(strand, start, ray, along, near / axial * scale);
    if (wantDensity) hit.density = density;
    return hit;
  }
  function sampleAt(strand, rayAt, x, y, near, wantNormal, wantDensity, wantExit, wantStation) {
    const style = strand.projectedWidth, weight = style?.weight?.(x, y) ?? 1;
    if (weight === 0) return null;
    const section = weight === 1 ? strand : style.fade ?
      { ...strand, opacity: strand.opacity * weight, tau: strand.tau * weight } :
      { ...strand, radius: strand.radius * weight };
    const ray = rayAt(x, y), dash = section.pattern?.dash;
    const hit = sample(section, ray, near, wantNormal, wantDensity || dash && !section.group, wantExit, wantStation);
    if (!hit || !dash) return hit;
    const site = section.pattern.coordinates(ray, hit.depth / ray.axial, x, y);
    const gain = section.pattern.opacity(site);
    if (gain === 0) return null;
    if (gain < 1) {
      if (section.group) hit.alpha *= gain;
      else {
        hit.density *= gain;
        hit.alpha = -Math.expm1(-hit.density);
      }
    }
    return hit.alpha >= minimum ? hit : null;
  }
  return Object.freeze({ tag, joinGroups, axialUnits, minimum, castShadow, receiveShadow, overlapsDepth,
    clipStride, materialStride, lightingStride, timingStride, stationStride, clipPlanes,
    emissionAt, lightingAt, isRow, carrier, spanShape, roundSpan, writeClips, timeWindow, timedOpacity, timedCarrier, prepare, sample, sampleAt, specular, directional });
})();
if (typeof module !== 'undefined') module.exports = CurveSplat;
