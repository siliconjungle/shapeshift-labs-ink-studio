/* Mark sampling and brush-space variation that leave the receiving solid intact. */
(function (K) {
  const P = K.procedural, { V, Q, M } = K;
  const record = value => K.world.data.record(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const xyz = (v, lo, hi) => Array.isArray(v) && v.length === 3 && Array.from(v).every(n => range(n, lo, hi));
  const smooth = t => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;

  function prepare(raw) {
    if (raw === undefined) return undefined;
    if (!fields(raw, ['size', 'spacing', 'displacement', 'irregularity', 'seed', 'interior', 'silhouetteAllowance']))
      throw new TypeError('Looseness needs size, spacing, displacement, irregularity, seed, interior mask or silhouette allowance');
    const { size = 1, spacing = 1, displacement = 0, irregularity = 0, seed = 0, interior, silhouetteAllowance } = raw;
    if (!range(size, .125, 4) || !range(spacing, .125, 4) || !range(displacement, 0, 100) || !range(irregularity, 0, 1) ||
        !Number.isInteger(seed) || !range(seed, 0, 4294967295) ||
        silhouetteAllowance !== undefined && !range(silhouetteAllowance, 0, 100))
      throw new RangeError('Looseness size and spacing must be .125–4, displacement and allowance 0–100, and irregularity 0–1');
    if (interior !== undefined && (!fields(interior, ['center', 'radii', 'feather']) ||
        !xyz(interior.center, -10000, 10000) || !xyz(interior.radii, .0001, 10000) || !range(interior.feather ?? .3, .001, 1)))
      throw new TypeError('A looseness interior needs an ellipsoid center, three positive radii and an optional feather from .001 to 1');
    return { size, spacing, displacement, irregularity, seed, ...(interior && { interior: { ...interior, feather: interior.feather ?? .3 } }),
      ...(silhouetteAllowance !== undefined && { silhouetteAllowance }) };
  }

  function amountAt(settings, point) {
    if (!settings) return 0;
    const { interior } = settings;
    if (!interior) return 1;
    const radius = Math.hypot(...point.map((n, i) => (n - interior.center[i]) / interior.radii[i]));
    return smooth(K.clamp((1 - radius) / interior.feather, 0, 1));
  }

  function dabs(guide, interval, settings, limit = 4096, remaining) {
    const authored = remaining && settings && settings.spacing !== 1 ? dabs(guide, interval, settings, limit) : undefined;
    const anchors = authored?.filter(row => remaining(row.pose.point) === 1);
    let length = 0;
    const offsets = guide.map((pose, i) => i ? length += V.dist(pose.point, guide[i - 1].point) : 0);
    const rows = [];
    let d = 0, i = 1, a = 0, checkpoint = 0;
    // Integrate spacing along the unscattered path. Displacement and width leave these stations fixed.
    for (;;) {
      if (rows.length >= limit) throw new RangeError('A stamped stroke exceeds 4096 evaluated dabs; increase spacing or shorten the path');
      let pose = guide[0];
      if (length > 1e-8) {
        while (i < offsets.length - 1 && offsets[i] <= d) i++;
        const a = guide[i - 1], b = guide[i], span = offsets[i] - offsets[i - 1];
        const t = span > 1e-10 ? (d - offsets[i - 1]) / span : 1;
        pose = { point: V.lerp(a.point, b.point, t), rotation: Q.slerp(a.rotation, b.rotation, t), pressure: mix(a.pressure, b.pressure, t) };
      }
      const amount = amountAt(settings, pose.point) * (remaining?.(pose.point) ?? 1);
      const progress = length > 1e-8 ? d / length : 0;
      let ordinal = rows.length;
      if (authored) {
        while (a < authored.length - 1 && authored[a].progress < progress - 1e-10) a++;
        ordinal = Math.abs(authored[a].progress - progress) <= 1e-10 ? authored[a].ordinal : authored.length + ordinal;
      }
      rows.push({ pose, amount, progress, ordinal });
      if (d >= length - 1e-8) return rows;
      let next = d + interval * mix(1, settings?.spacing ?? 1, amount);
      if (anchors) {
        // Rejoin the authored sampling phase before passing an unaffected dab.
        while (checkpoint < anchors.length && anchors[checkpoint].progress <= progress + 1e-10) checkpoint++;
        if (checkpoint < anchors.length) next = Math.min(next, anchors[checkpoint].progress * length);
      }
      d = next >= length - 1e-8 ? length : next;
    }
  }

  function vary(settings, row, family, source) {
    if (!settings || !row.amount) return { source, pose: row.pose, size: 1 };
    const { pose, amount, ordinal } = row, { displacement, irregularity, seed } = settings;
    const random = lane => P.data.hash01(family + '/' + ordinal + '/' + lane, seed);
    const angle = 2 * Math.PI * random(0), radius = displacement * amount * Math.sqrt(random(1));
    const point = radius ? V.add(pose.point, M.app(Q.toMatrix(pose.rotation), [radius * Math.cos(angle), radius * Math.sin(angle), 0])) : pose.point;
    const size = mix(1, settings.size, amount);
    if (!irregularity) return { source, pose: { ...pose, point }, size };
    const { bounds, sd, opacityAt } = source;
    const width = bounds.max[0] - bounds.min[0], height = bounds.max[1] - bounds.min[1];
    const amplitude = irregularity * amount * width * .24, frequency = 2 * Math.PI / height, phase = 2 * Math.PI * random(2);
    const slope = 1 + amplitude * frequency;
    const warpedX = (x, y) => x - amplitude * Math.sin((y - bounds.min[1]) * frequency + phase);
    return { pose: { ...pose, point }, size, source: {
      bounds: { min: [bounds.min[0] - amplitude, ...bounds.min.slice(1)], max: [bounds.max[0] + amplitude, ...bounds.max.slice(1)] },
      sd: (x, y, z) => sd(warpedX(x, y), y, z) / slope,
      ...(opacityAt && { opacityAt: (x, y, z) => opacityAt(warpedX(x, y), y, z) })
    } };
  }

  P.paintLooseness = Object.freeze({ prepare, dabs, vary });
})(KIT);
