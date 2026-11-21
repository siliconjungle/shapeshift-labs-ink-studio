/* One shared native triangle carrier: exact silhouette, retained plane depth. */
(function (K) {
  const { V } = K,
    HALF = Math.sqrt(2 * Math.log(2));
  const point = p => Array.isArray(p) && p.length === 3 && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6);
  const profile = SplatFootprints.prepare({
    shape: 'polygon',
    depth: 'plane',
    vertices: [
      [-1, -1],
      [1, -1],
      [-1, 1]
    ],
    softness: 0
  });
  function triangle(
    B,
    points,
    {
      normal,
      color,
      albedo,
      opacity = 1,
      animation,
      finish,
      light = [-0.4, 0.8, 0.5],
      optical,
      object,
      material,
      target
    } = {}
  ) {
    if (
      !B?.dab ||
      !Array.isArray(points) ||
      points.length !== 3 ||
      !points.every(point) ||
      !point(color) ||
      color.some(x => x < 0 || x > 255) ||
      !Number.isFinite(opacity) ||
      opacity <= 0 ||
      opacity > 4
    )
      throw new RangeError('Native patch needs a finite triangle, RGB bytes and opacity');
    if (albedo !== undefined) RenderStages.albedo(albedo);
    const [a, b, c] = points,
      cross = V.cross(V.sub(b, a), V.sub(c, a));
    if (V.len(cross) < 1e-14) return { first: B.count(), end: B.count() };
    const n = normal === undefined ? V.norm(cross) : normal;
    if (!point(n) || Math.abs(V.len(n) - 1) > 0.001 || Math.abs(V.dot(n, V.norm(cross))) < 0.999)
      throw new RangeError('Native patch normal must be unit and perpendicular to its plane');
    const U = V.mul(V.sub(b, a), 0.5),
      W = V.mul(V.sub(c, a), 0.5),
      e = V.norm(U),
      f = V.cross(n, e),
      x = V.dot(W, e),
      y = V.dot(W, f),
      u = V.len(U),
      A = u * u + x * x,
      D = y * y,
      C = x * y,
      angle = 0.5 * Math.atan2(2 * C, A - D),
      delta = Math.hypot(A - D, 2 * C),
      tangent = V.add(V.mul(e, Math.cos(angle)), V.mul(f, Math.sin(angle))),
      center = V.add(a, V.add(U, W)),
      first = B.count();
    if (finish) B.surfaceNext(finish, ...n, light, 1, tangent);
    B.dab(
      ...center,
      n,
      tangent,
      Math.sqrt((A + D + delta) / 2) / HALF,
      Math.sqrt(Math.max(1e-12, (A + D - delta) / 2)) / HALF,
      0.00001,
      color,
      opacity,
      animation
    );
    B.describeFootprint(first, first + 1, profile, [...U, ...W]);
    if (object !== undefined || material !== undefined || target !== undefined)
      B.describeSplats?.(first, first + 1, { object, material, target });
    if (albedo !== undefined) B.describeAlbedo(first, first + 1, albedo);
    if (optical) B.describeOptical(first, first + 1, optical);
    return { first, end: B.count() };
  }
  K.surfacePatches = Object.freeze({ triangle });
})(KIT);
