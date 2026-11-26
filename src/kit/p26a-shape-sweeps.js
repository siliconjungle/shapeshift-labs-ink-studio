/* Retained poses and bounded signed-distance sampling for sculpt sweeps. */
(function (K) {
  const P = K.procedural, { V, Q, M } = K;
  const { boxOf, expand } = P.spatial;
  const maxPoses = 4096;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 10000;
  const positive = n => finite(n) && n >= .0001;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(finite);
  const identity = [0, 0, 0, 1];

  function extrusion(points, depth) {
    let area = 0;
    for (const [i, point] of points.entries()) {
      const next = points[(i + 1) % points.length];
      if (point[0] === next[0] && point[1] === next[1])
        throw new RangeError('Sweep profile edges must have positive length');
      area += point[0] * next[1] - point[1] * next[0];
    }
    if (Math.abs(area) < 1e-8) throw new RangeError('A sweep profile must enclose an area');
    const half = depth / 2, distance = P.geometry.profileDistance(points);
    const bounds = boxOf(points.flatMap(([x, y]) => [[x, y, -half], [x, y, half]]));
    const feature = Math.min(...V.sub(bounds.max, bounds.min)) / 2;
    return { bounds, feature, cost: points.length, sd(x, y, z) {
      const edge = distance(x, y), cap = Math.abs(z) - half;
      return Math.hypot(Math.max(0, edge), Math.max(0, cap)) + Math.min(0, Math.max(edge, cap));
    } };
  }

  function brushSource(brush) {
    const { kind, half, round = 0, radius, major, minor, length, points, depth } = brush ?? {};
    if (kind === 'wedge' && fields(brush, ['kind', 'half']) && vector(half, 3) && half.every(positive)) {
      const [x, y, z] = half;
      return extrusion([[-x, -y], [x, -y], [-x, y]], 2 * z);
    }
    if (kind === 'profile' && fields(brush, ['kind', 'points', 'depth']) && positive(depth) &&
        Array.isArray(points) && points.length >= 3 && points.length <= 64 && Array.from(points).every(p => vector(p, 2))) {
      const ring = points.map(p => p.slice());
      if (ring[0].every((value, axis) => value === ring.at(-1)[axis])) ring.pop();
      if (ring.length >= 3) return extrusion(ring, depth);
    }
    let feature;
    if (kind === 'box' && fields(brush, ['kind', 'half', 'round']) &&
        vector(half, 3) && half.every(positive) && finite(round) && round >= 0 && round <= Math.min(...half))
      feature = Math.min(...half);
    if (kind === 'torus' && fields(brush, ['kind', 'major', 'minor']) && positive(major) && positive(minor) && minor < major)
      feature = minor;
    if (kind === 'sphere' && fields(brush, ['kind', 'radius']) && positive(radius)) feature = radius;
    if (['capsule', 'cylinder'].includes(kind) && fields(brush, ['kind', 'radius', 'length']) &&
        positive(radius) && positive(length)) feature = Math.min(radius, length / 2);
    if (feature === undefined)
      throw new TypeError('A sweep brush needs a bounded box, wedge, torus, profile, sphere, capsule or cylinder');
    const sd = P.sceneGraph.shape(kind, brush);
    return { sd, bounds: sd.bounds, feature, cost: 1 };
  }

  function poseSource(input, index) {
    const { point, rotation = identity, pressure = 1 } = input ?? {};
    if (!fields(input, ['point', 'rotation', 'pressure']) || !vector(point, 3) || !vector(rotation, 4) ||
        !finite(pressure) || pressure < 0 || pressure > 4)
      throw new TypeError('Sweep pose ' + index + ' needs a finite point, optional quaternion and pressure from 0 to 4');
    return { point: point.slice(), rotation: Q.normalize(rotation), pressure };
  }

  function transform(bounds, pose) {
    const { point, pressure } = pose, rotation = Q.toMatrix(pose.rotation);
    const center = V.mul(V.lerp(bounds.min, bounds.max, .5), pressure);
    const half = V.mul(V.sub(bounds.max, bounds.min), pressure / 2);
    const world = V.add(point, M.app(rotation, center));
    const extent = [0, 3, 6].map(i =>
      Math.abs(rotation[i]) * half[0] + Math.abs(rotation[i + 1]) * half[1] + Math.abs(rotation[i + 2]) * half[2]);
    const inverse = M.tr(rotation);
    return {
      bounds: { min: V.sub(world, extent), max: V.add(world, extent) },
      local: pressure > 0 ? (x, y, z, sd) => {
        const a = (x - point[0]) / pressure, b = (y - point[1]) / pressure, c = (z - point[2]) / pressure;
        return sd(inverse[0] * a + inverse[1] * b + inverse[2] * c,
          inverse[3] * a + inverse[4] * b + inverse[5] * c,
          inverse[6] * a + inverse[7] * b + inverse[8] * c) * pressure;
      } : (x, y, z) => Math.hypot(x - point[0], y - point[1], z - point[2])
    };
  }

  const union = (a, b) => ({
    min: a.min.map((v, i) => Math.min(v, b.min[i])),
    max: a.max.map((v, i) => Math.max(v, b.max[i]))
  });
  function tree(entries, first = 0, end = entries.length) {
    if (end - first === 1) return entries[first];
    const middle = (first + end) >> 1;
    const left = tree(entries, first, middle), right = tree(entries, middle, end);
    return { bounds: union(left.bounds, right.bounds), left, right };
  }
  function outside({ min, max }, x, y, z) {
    return Math.max(min[0] - x, x - max[0], min[1] - y, y - max[1], min[2] - z, z - max[2]);
  }
  const nearestDistance = (entry, x, y, z, best) => Math.min(best, entry.sample(x, y, z));
  function distance(root, x, y, z, best, measure = nearestDistance) {
    // The signed box distance is a lower bound even inside the box.
    if (outside(root.bounds, x, y, z) > best) return best;
    if (root.sample) return measure(root, x, y, z, best);
    const { left, right } = root;
    return outside(left.bounds, x, y, z) <= outside(right.bounds, x, y, z)
      ? distance(right, x, y, z, distance(left, x, y, z, best, measure), measure)
      : distance(left, x, y, z, distance(right, x, y, z, best, measure), measure);
  }
  function blend(a, b, radius) {
    const margin = Math.max(0, radius - Math.abs(a - b));
    return Math.min(a, b) - margin * margin / (4 * radius);
  }

  function ruled(poses) {
    const start = poses[0].point, end = poses.at(-1).point;
    if (V.dist(start, end) < 1e-8) throw new RangeError('A ruled stroke needs distinct first and last points');
    let length = 0;
    const offsets = poses.map((pose, i) => i ? length += V.dist(pose.point, poses[i - 1].point) : 0);
    return poses.map((pose, i) => ({ ...pose, point: V.lerp(start, end, offsets[i] / length) }));
  }

  const range = (value, max) => vector(value, 2) && value.every(n => n >= 0 && n <= max);
  const responseAt = ([low, high], pressure) => low + (high - low) * Math.min(1, pressure);
  const hasOpacity = pressureResponse => pressureResponse?.opacity?.some(value => value < 1) ?? false;

  function blendRows(rows, radius) {
    if (radius === 0 || rows.length < 2) return rows;
    return rows.slice(1).map((b, i) => {
      const a = rows[i];
      return { bounds: expand(union(a.bounds, b.bounds), radius / 4),
        sample: (x, y, z) => blend(a.sample(x, y, z), b.sample(x, y, z), radius) };
    });
  }

  function field(rows) {
    const root = tree(rows);
    return { bounds: P.data.freeze({ min: root.bounds.min.slice(), max: root.bounds.max.slice() }),
      sd: (x, y, z) => distance(root, x, y, z, Infinity) };
  }

  function stampedSweep(brush, guide, step, blendRadius, pressureResponse, looseness) {
    const api = P.paintLooseness, opacity = hasOpacity(pressureResponse);
    let rows, cost, spacing;
    if (brush?.kind === 'mark-profile') {
      const plan = P.markProfiles.prepareBrush(brush);
      rows = P.markProfiles.place(plan, guide, maxPoses, looseness);
      cost = Math.max(...plan.profiles.map(profile => profile.cost));
      spacing = step ?? Math.max(.0001, Math.min(.06, ...plan.profiles.map(profile => profile.spacing / 2)));
    } else {
      const brushForm = brushSource(brush);
      spacing = step ?? Math.max(.0001, Math.min(.06, brushForm.feature / 2));
      cost = brushForm.cost;
      rows = [api.dabs(guide, spacing, looseness, maxPoses).map(row => ({ ...row, ...brushForm }))];
    }
    const families = rows.map((dabs, family) => dabs.flatMap(dab => {
      const { pose, source: { bounds, sd, opacityAt }, size } = api.vary(looseness, dab, family, dab);
      const scale = pressureResponse === undefined ? pose.pressure : responseAt(pressureResponse.width ?? [1, 1], pose.pressure);
      if (scale <= 0) return [];
      const alpha = opacity ? responseAt(pressureResponse.opacity, pose.pressure) : 1;
      const width = scale * size, placed = transform(bounds, { ...pose, pressure: width });
      return [{ bounds: placed.bounds, sample: (x, y, z) => placed.local(x, y, z, sd),
        ...(opacityAt || alpha < 1 ? { alphaAt: opacityAt ? (x, y, z) => alpha * placed.local(x, y, z, opacityAt) / width
          : () => alpha } : {}) }];
    }));
    const stations = families.flat();
    if (!stations.length) throw new RangeError('No dabs have positive width; change pressure or spacing');
    const colorTree = stations.some(row => row.alphaAt) && tree(stations);
    return { ...field(families.flatMap(rows => blendRows(rows, blendRadius))), guide, sampleCount: stations.length,
      cost, step: spacing,
      ...(colorTree && { opacityAt(x, y, z) {
        let source;
        distance(colorTree, x, y, z, Infinity, (entry, x, y, z, best) => {
          const d = entry.sample(x, y, z);
          if (d > best) return best;
          source = entry;
          return d;
        });
        return source?.alphaAt?.(x, y, z) ?? 1;
      } }) };
  }

  function opacitySampler(poses, response) {
    if (poses.length === 1) return () => responseAt(response, poses[0].pressure);
    const sections = poses.slice(1).map((end, i) => {
      const start = poses[i], delta = V.sub(end.point, start.point), length2 = V.dot(delta, delta);
      return { index: i, bounds: boxOf([start.point, end.point]), sample(x, y, z) {
        const offset = [x - start.point[0], y - start.point[1], z - start.point[2]];
        const t = length2 > 1e-16 ? K.clamp(V.dot(offset, delta) / length2, 0, 1) : 1;
        return { distance: Math.hypot(...V.mad(offset, delta, -t)), pressure: start.pressure + (end.pressure - start.pressure) * t };
      } };
    });
    const root = tree(sections);
    return (x, y, z) => {
      let pressure = 1, latest = -1;
      distance(root, x, y, z, Infinity, (entry, x, y, z, best) => {
        const sample = entry.sample(x, y, z);
        if (sample.distance > best || sample.distance === best && entry.index < latest) return best;
        pressure = sample.pressure;
        latest = entry.index;
        return sample.distance;
      });
      return responseAt(response, pressure);
    };
  }

  function prepare({ brush, poses, step, blendRadius = 0, path = 'free', pressureResponse, looseness }) {
    if (!Array.isArray(poses) || poses.length < 1 || poses.length > 1024 ||
        !finite(blendRadius) || blendRadius < 0 ||
        (step !== undefined && (!positive(step) || step > 1)))
      throw new RangeError('A sweep needs 1–1024 poses, a nonnegative blend radius and an optional step from .0001 to 1');
    if (!['free', 'ruled'].includes(path)) throw new TypeError('A sweep path must be free or ruled');
    if (pressureResponse !== undefined && (!fields(pressureResponse, ['width', 'opacity']) ||
        pressureResponse.width !== undefined && !range(pressureResponse.width, 4) ||
        pressureResponse.opacity !== undefined && !range(pressureResponse.opacity, 1)))
      throw new TypeError('Pressure response needs [at zero, at one] ranges for width (0–4) or opacity (0–1)');
    const input = Array.from(poses, poseSource), guide = path === 'ruled' ? ruled(input) : input;
    if (brush?.kind === 'mark-profile' || looseness !== undefined)
      return stampedSweep(brush, guide, step, blendRadius, pressureResponse, P.paintLooseness.prepare(looseness));
    const source = brushSource(brush);
    const authored = pressureResponse === undefined ? guide : guide.map(pose => ({
      ...pose, pressure: responseAt(pressureResponse.width ?? [1, 1], pose.pressure)
    }));
    if (!authored.some(p => p.pressure)) throw new RangeError('A sweep needs at least one positive pressure or mapped width');
    const radius = Math.hypot(...source.bounds.min.map((v, i) => Math.max(Math.abs(v), Math.abs(source.bounds.max[i]))));
    const narrowest = Math.min(1, ...authored.filter(p => p.pressure > 0).map(p => p.pressure));
    const spacing = step ?? Math.max(.0001, Math.min(.06, source.feature * narrowest / 2));
    const stations = [authored[0]];
    for (let i = 1; i < authored.length; i++) {
      const a = authored[i - 1], b = authored[i];
      const travel = V.dist(a.point, b.point) + radius * (Math.abs(a.pressure - b.pressure) +
        Math.max(a.pressure, b.pressure) * Q.angle(a.rotation, b.rotation));
      if (travel <= 1e-10) continue;
      const divisions = Math.ceil(travel / spacing);
      if (stations.length + divisions > maxPoses)
        throw new RangeError('A sweep exceeds 4096 evaluated poses; use a larger step or a shorter path');
      for (let j = 1; j < divisions; j++) {
        const t = j / divisions;
        stations.push({ point: V.lerp(a.point, b.point, t), rotation: Q.slerp(a.rotation, b.rotation, t),
          pressure: a.pressure + t * (b.pressure - a.pressure) });
      }
      stations.push(b);
    }
    const rows = stations.map(pose => {
      const { bounds, local } = transform(source.bounds, pose);
      return { bounds, sample: (x, y, z) => local(x, y, z, source.sd) };
    });
    // Blend neighboring stations independently so overlap never compounds with step density.
    return { ...field(blendRows(rows, blendRadius)), cost: source.cost, sampleCount: stations.length, step: spacing, guide,
      ...(hasOpacity(pressureResponse) && { opacityAt: opacitySampler(guide, pressureResponse.opacity) }) };
  }

  P.shapeSweeps = Object.freeze({ prepare });
})(KIT);
