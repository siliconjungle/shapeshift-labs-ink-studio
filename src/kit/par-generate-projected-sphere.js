/* Orthographic sphere projection with reusable UVs, depth and banded illumination. */
(function (K) {
  const P = K.procedural;
  const { dimensions, vector, range, integer, raster, unit, wrap } = P.generatorSupport;
  const tau = Math.PI * 2;

  function sphereMap({ center, radius, yaw = 0, pitch = 0, roll = 0, light = [-.5, .6, .8],
    ambient = .3, steps = 5, rim = .17, ...options } = {}) {
    const { width, height } = dimensions(options), area = width * height;
    center ??= [width / 2, height / 2];
    radius ??= Math.min(width, height) * .43;
    if (!vector(center, 2) || !range(radius, .5, 1e6) || ![yaw, pitch, roll].every(Number.isFinite) ||
        !vector(light, 3) || !(Math.hypot(...light) > 0) || !Number.isFinite(Math.hypot(...light)) ||
        !range(ambient, 0, 1) || !range(rim, 0, 1) || !integer(steps, 1, 64))
      throw new RangeError('Sphere map needs finite rotation, lighting, and a positive radius');
    const normal = new Float32Array(area * 3), uv = new Float32Array(area * 3);
    const depth = new Float32Array(area), illumination = new Float32Array(area);
    const ca = Math.cos(wrap(yaw, tau)), sa = Math.sin(wrap(yaw, tau));
    const cb = Math.cos(pitch), sb = Math.sin(pitch), cc = Math.cos(roll), sc = Math.sin(roll);
    const len = Math.hypot(...light), [lx, ly, lz] = light.map(n => n / len);
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      const nx = (x + .5 - center[0]) / radius, ny = (center[1] - y - .5) / radius;
      const q = nx * nx + ny * ny;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q), o = i * 3;
      normal[o] = nx; normal[o+1] = ny; normal[o+2] = nz;
      depth[i] = nz;
      const r = cc * nx + sc * ny, s = cc * ny - sc * nx;
      const t = cb * nz - sb * s;
      const px = ca * r - sa * t, py = cb * s + sb * nz, pz = sa * r + ca * t;
      uv[o] = wrap(Math.atan2(px, pz) / tau + .5, 1);
      uv[o+1] = .5 - Math.asin(Math.max(-1, Math.min(1, py))) / Math.PI;
      uv[o+2] = 1;
      const diffuse = unit(lx * nx + ly * ny + lz * nz);
      const band = steps === 1 ? diffuse : Math.round(diffuse * (steps - 1)) / (steps - 1);
      illumination[i] = unit(ambient + (1 - ambient) * band + rim * (1 - nz) ** 3);
    }
    return {
      value: raster(width, height, uv, 3),
      normal: raster(width, height, normal, 3),
      depth: raster(width, height, depth),
      illumination: raster(width, height, illumination)
    };
  }

  function projectSphere(source, { filter = 'nearest', ...options } = {}) {
    const projection = sphereMap(options);
    const rgba = P.rasterWarp.sample(source, projection.value, { edgeU: 'wrap', edgeV: 'clamp', filter });
    const { data } = rgba, light = projection.illumination.data;
    for (let i = 0; i < light.length; i++) for (let c = 0; c < 3; c++)
      data[i*4+c] = Math.round(data[i*4+c] * light[i]);
    return { ...projection, value: rgba, uv: projection.value };
  }

  Object.assign(P.generator, { sphereMap, projectSphere });
})(KIT);
