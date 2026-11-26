/* Bounded, reusable brush silhouettes with pigment and relief in mark-local space. */
(function (K) {
  const P = K.procedural, { V, Q } = K, { boxOf } = P.spatial;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const finite = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const pair = (v, lo, hi) => Array.isArray(v) && v.length === 2 && Array.from(v).every(n => finite(n, lo, hi));
  const smooth = t => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;

  function grainAt(x, y, seed) {
    const i = Math.floor(x), j = Math.floor(y);
    const u = smooth(x - i), v = smooth(y - j);
    const value = (a, b) => {
      let n = Math.imul(a, 0x8da6b343) ^ Math.imul(b, 0xd8163841) ^ seed;
      n = Math.imul(n ^ n >>> 16, 0x7feb352d);
      return ((n ^ n >>> 15) >>> 0) / 4294967295;
    };
    return mix(mix(value(i, j), value(i + 1, j), u), mix(value(i, j + 1), value(i + 1, j + 1), u), v);
  }

  function prepare(raw) {
    if (!fields(raw, ['silhouette', 'spacing', 'coverage', 'grain', 'depth']))
      throw new TypeError('A mark profile needs a silhouette, spacing and depth, with optional coverage and grain');
    const { silhouette, spacing, coverage = {}, grain = {}, depth } = raw;
    if (!finite(spacing, .0001, 1000) || !Array.isArray(silhouette) || silhouette.length < 1 || silhouette.length > 16)
      throw new RangeError('A mark profile needs positive spacing and 1–16 outline polygons');
    const rings = Array.from(silhouette, ring => {
      if (!Array.isArray(ring) || ring.length < 3 || ring.length > 64 || !Array.from(ring).every(p => pair(p, -10000, 10000)))
        throw new TypeError('Each mark outline needs 3–64 finite XY points');
      const last = ring.at(-1);
      const points = ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
      P.geometry.triangulate2D(points);
      return points;
    });
    if (!fields(depth, ['back', 'curve']) || !Array.isArray(depth.curve) || depth.curve.length < 1 || depth.curve.length > 16)
      throw new TypeError('A mark depth needs a curve of [inward distance, front height] pairs');
    const { back = 0 } = depth, curve = Array.from(depth.curve, row => Array.isArray(row) ? row.slice() : row);
    if (!finite(back, 0, 1000) || !Array.from(curve).every(p => pair(p, 0, 1000)) || curve[0][0] !== 0 ||
        curve.some(([x], i) => i > 0 && x <= curve[i - 1][0]))
      throw new RangeError('Mark depth distances must start at zero and increase, with nonnegative heights and back depth');
    const rise = Math.max(...curve.map(p => p[1]));
    if (back + rise < .0001) throw new RangeError('A mark profile needs positive depth');
    if (!fields(coverage, ['opacity', 'feather']) || !fields(grain, ['amount', 'scale', 'seed']))
      throw new TypeError('Mark coverage needs opacity and feather, and grain needs amount, scale and seed');
    const { opacity = 1, feather = 0 } = coverage, { amount = 0, scale = .04, seed = 0 } = grain;
    if (!finite(opacity, 0, 1) || !finite(feather, 0, 1000) || !finite(amount, 0, 1) ||
        !finite(scale, .0001, 1000) || !finite(seed, 0, 4294967295) || !Number.isSafeInteger(seed))
      throw new RangeError('Mark coverage and grain amounts must be within [0,1], with valid feather, scale and integer seed');
    const outline = rings.map(P.geometry.profileDistance);
    const xy = boxOf(rings.flatMap(ring => ring.map(([x, y]) => [x, y, 0])));
    const cost = rings.reduce((n, ring) => n + ring.length, 0);
    const maxSlope = curve.slice(1).reduce((n, [x, y], i) => Math.max(n, Math.abs(y - curve[i][1]) / (x - curve[i][0])), 0);
    if (!Number.isFinite(maxSlope)) throw new RangeError('Mark depth curve is too steep to evaluate');
    const side = (x, y) => {
      let d = Infinity;
      for (const distance of outline) d = Math.min(d, distance(x, y));
      return d;
    };
    function relief(inward) {
      for (let i = 1; i < curve.length; i++) {
        const [x, y] = curve[i];
        if (inward <= x) {
          const [px, py] = curve[i - 1];
          return mix(py, y, (inward - px) / (x - px));
        }
      }
      return curve.at(-1)[1];
    }
    function stamp(weight, ordinal) {
      const bounds = { min: [xy.min[0], xy.min[1], -back * weight], max: [xy.max[0], xy.max[1], rise * weight] };
      const gradient = Math.hypot(1, maxSlope * weight), pigment = opacity * weight;
      return { bounds,
        sd(x, y, z) {
          const d = side(x, y), top = relief(Math.max(0, -d)) * weight;
          return Math.max(d, -back * weight - z, (z - top) / gradient);
        },
        ...(pigment < 1 || feather > 0 || amount > 0 ? { opacityAt(x, y) {
          const edge = feather ? smooth(K.clamp(-side(x, y) / feather, 0, 1)) : 1;
          const texture = amount ? 1 - amount * grainAt(x / scale, y / scale, seed ^ Math.imul(ordinal, 0x9e3779b9)) : 1;
          return pigment * edge * texture;
        } } : {})
      };
    }
    return { spacing, cost, stamp };
  }

  function prepareBrush(raw) {
    if (!fields(raw, ['kind', 'profile', 'mix']) || raw.kind !== 'mark-profile')
      throw new TypeError('A mark-profile brush needs a profile and optional mix');
    const first = prepare(raw.profile);
    if (raw.mix === undefined) return { profiles: [first] };
    const { profile, range } = raw.mix ?? {};
    if (!fields(raw.mix, ['profile', 'range']) || !pair(range, 0, 1) || range[0] >= range[1])
      throw new RangeError('A profile mix needs a second profile and an increasing stroke range within [0,1]');
    return { profiles: [first, prepare(profile)], range };
  }

  function place({ profiles, range }, guide, limit) {
    let length = 0;
    const offsets = guide.map((pose, i) => i ? length += V.dist(pose.point, guide[i - 1].point) : 0);
    let candidates = 0;
    return profiles.map(({ spacing, stamp }, family) => {
      const wholeSteps = Math.floor(length / spacing + 1e-9);
      const includeEnd = length - wholeSteps * spacing > 1e-8;
      const count = 1 + wholeSteps + Number(includeEnd);
      candidates += count;
      if (candidates > limit) throw new RangeError('A profiled stroke exceeds 4096 evaluated dabs; increase profile spacing or shorten the path');
      const dabs = [];
      let i = 1;
      for (let ordinal = 0; ordinal < count; ordinal++) {
        const d = Math.min(length, ordinal * spacing), t = length ? d / length : 0;
        const blend = range ? smooth(K.clamp((t - range[0]) / (range[1] - range[0]), 0, 1)) : 0;
        const weight = family === 0 ? 1 - blend : blend;
        if (weight <= 1e-6) continue;
        while (i < offsets.length - 1 && offsets[i] <= d) i++;
        let pose = guide[0];
        if (length) {
          const a = guide[i - 1], b = guide[i], span = offsets[i] - offsets[i - 1];
          const f = span > 1e-10 ? (d - offsets[i - 1]) / span : 1;
          pose = { point: V.lerp(a.point, b.point, f), rotation: Q.slerp(a.rotation, b.rotation, f), pressure: mix(a.pressure, b.pressure, f) };
        }
        dabs.push({ pose, ...stamp(weight, ordinal) });
      }
      return dabs;
    });
  }

  P.markProfiles = Object.freeze({ prepare, prepareBrush, place });
})(KIT);
