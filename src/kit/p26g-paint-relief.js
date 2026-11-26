/* Relief settings and the height gradient of a paint footprint. */
(function (K) {
  const P = K.procedural, { V } = K;
  const range = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  const fields = (value, allowed) => K.world.data.record(value) && Object.keys(value).every(key => allowed.includes(key));

  function prepare(raw) {
    if (raw === undefined) return;
    const { mode, height } = raw ?? {};
    if (mode === 'flat' && fields(raw, ['mode'])) return { mode };
    if (!range(Math.abs(height), .0001, 100) || !Number.isFinite(height))
      throw new RangeError('Shading and volume relief need a signed height of at least .0001 and at most 100 units');
    if (mode === 'shading' && fields(raw, ['mode', 'height', 'feather', 'tint'])) {
      const { feather = .06, tint = true } = raw;
      if (!range(feather, .0001, 100) || typeof tint !== 'boolean')
        throw new RangeError('Shading relief needs a positive feather and boolean tint');
      return { mode, height, feather, tint };
    }
    if (mode === 'volume' && fields(raw, height > 0 ? ['mode', 'height', 'seat', 'silhouetteAllowance', 'castShadow']
      : ['mode', 'height', 'seat'])) {
      const { seat = Math.abs(height) * .5, silhouetteAllowance, castShadow = false } = raw;
      if (!range(seat, .00005, 100) || typeof castShadow !== 'boolean' ||
          silhouetteAllowance !== undefined && !range(silhouetteAllowance, .0001, 100))
        throw new RangeError('Volume relief needs positive seating and silhouette distances and boolean castShadow');
      return { mode, height, seat, ...(height > 0 && { castShadow }),
        ...(silhouetteAllowance !== undefined && { silhouetteAllowance }) };
    }
    throw new TypeError('Choose flat paint, shading relief, or volume relief with settings for that mode');
  }

  function gradient(relief, form, space, accepts, remaining) {
    const { feather, height } = relief, { min, max } = form.bounds;
    const h = Math.min(.01, feather * space.scale * .25);
    function rise(point) {
      const at = space.inverse(point);
      if (at.some((n, i) => n < min[i] || n > max[i])) return 0;
      const t = K.clamp(-form.sd(...at) / feather, 0, 1);
      return t === 0 ? 0 : height * space.scale * t * t * (3 - 2 * t) *
        (form.opacityAt?.(...at) ?? 1) * (remaining?.(point) ?? 1);
    }
    return (point, normal) => {
      const at = space.inverse(point), pad = h / space.scale;
      if (at.some((n, i) => n < min[i] - pad || n > max[i] + pad) || accepts && !accepts(point, normal)) return;
      const u = V.perp(normal), v = V.cross(normal, u);
      const slope = axis => (rise(V.mad(point, axis, h)) - rise(V.mad(point, axis, -h))) / (2 * h);
      const x = slope(u), y = slope(v);
      if (x || y) return V.mad(V.mul(u, x), v, y);
    };
  }

  P.paintRelief = Object.freeze({ prepare, gradient });
})(KIT);
