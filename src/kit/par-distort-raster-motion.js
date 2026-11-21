/* Recover the dominant image-space camera transform and express remaining motion in stabilized axes. */
(function (K) {
  const P = K.procedural, W = P.rasterWarp;
  const { view, int, clamp, fraction, raster } = P.rasterWarpSupport;
  const identity = { a: 1, b: 0, tx: 0, ty: 0 };
  const range = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  const allowedScale = ({ a, b }) => range(a * a + b * b, .25 ** 2, 4 ** 2);

  function plane(source, width, height, limit, name) {
    if (source == null) return null;
    const plane = view(source);
    if (plane.width !== width || plane.height !== height || plane.channels !== 1 ||
        !plane.data.every(n => range(n, 0, limit)))
      throw new RangeError('Camera motion ' + name + ' needs aligned single-channel samples in 0–' + limit);
    return plane.data;
  }

  function sampleGrid(width, height, motion, allowed, maxSamples) {
    const columns = Math.min(width, maxSamples, Math.max(1, Math.floor(Math.sqrt(maxSamples * width / height))));
    const rows = Math.min(height, Math.max(1, Math.floor(maxSamples / columns)));
    const samples = [];
    for (let row = 0; row < rows; row++) {
      const top = Math.floor(row * height / rows), bottom = Math.floor((row + 1) * height / rows);
      for (let col = 0; col < columns; col++) {
        const left = Math.floor(col * width / columns), right = Math.floor((col + 1) * width / columns);
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        let best = null, distance = Infinity;
        for (let iy = top; iy < bottom; iy++) for (let ix = left; ix < right; ix++) {
          const p = iy * width + ix, x = ix + .5, y = iy + .5;
          const u = x + motion[p * 2], v = y + motion[p * 2 + 1];
          if (!allowed(p, u, v)) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < distance) { best = { x, y, u, v }; distance = d; }
        }
        if (best) samples.push(best);
      }
    }
    return samples;
  }

  function fromPair(left, right, baseline) {
    const x = right.x - left.x, y = right.y - left.y, u = right.u - left.u, v = right.v - left.v;
    const span = x * x + y * y;
    if (span < baseline * baseline) return null;
    const a = (x * u + y * v) / span, b = (x * v - y * u) / span;
    const fit = { a, b, tx: left.u - a * left.x + b * left.y, ty: left.v - b * left.x - a * left.y };
    return allowedScale(fit) ? fit : null;
  }

  function score(fit, samples, threshold) {
    const { a, b, tx, ty } = fit, inliers = [];
    let error = 0;
    for (const point of samples) {
      const { x, y, u, v } = point;
      const squared = (a * x - b * y + tx - u) ** 2 + (b * x + a * y + ty - v) ** 2;
      if (squared <= threshold * threshold) { inliers.push(point); error += squared; }
    }
    return { fit, inliers, error };
  }

  function leastSquares(points, translate, baseline) {
    let x = 0, y = 0, u = 0, v = 0;
    for (const p of points) { x += p.x; y += p.y; u += p.u; v += p.v; }
    const n = points.length;
    x /= n; y /= n; u /= n; v /= n;
    if (translate) return { ...identity, tx: u - x, ty: v - y };
    let spread = 0, along = 0, across = 0;
    for (const p of points) {
      const dx = p.x - x, dy = p.y - y, du = p.u - u, dv = p.v - v;
      spread += dx * dx + dy * dy;
      along += dx * du + dy * dv;
      across += dx * dv - dy * du;
    }
    if (spread < n * baseline * baseline / 4) return null;
    const a = along / spread, b = across / spread;
    const fit = { a, b, tx: u - a * x + b * y, ty: v - b * x - a * y };
    return allowedScale(fit) ? fit : null;
  }

  function consensus(samples, translate, { threshold, iterations, seed, minInliers }, baseline) {
    const dice = K.grow.dice(seed), count = samples.length;
    if (count < minInliers) return null;
    let best = score(identity, samples, threshold);
    function consider(fit) {
      if (!fit) return;
      const candidate = score(fit, samples, threshold);
      if (candidate.inliers.length > best.inliers.length ||
          candidate.inliers.length === best.inliers.length && candidate.error < best.error) best = candidate;
    }
    for (let i = 0; i < iterations; i++) {
      const index = count <= iterations ? i % count : Math.floor(dice() * count);
      const point = samples[index];
      const other = samples[(index + 1 + Math.floor(dice() * (count - 1))) % count];
      consider(translate ? { ...identity, tx: point.u - point.x, ty: point.v - point.y } : fromPair(point, other, baseline));
    }
    const fitted = best.inliers.length >= minInliers && leastSquares(best.inliers, translate, baseline);
    if (!fitted) return null;
    consider(fitted);
    return best;
  }

  function cameraMotion(motion, { model = 'similarity', confidence, mask, minConfidence = .2, maskThreshold = .5,
    threshold = 1.35, maxSamples = 1024, iterations = 192, minInliers = 6, minInlierRatio = .55, seed = 0 } = {}) {
    const { width, height, channels, data } = view(motion);
    if (channels !== 2 || width * height > 500000 || !data.every(n => range(n, -16384, 16384)))
      throw new RangeError('Camera motion needs bounded XY displacement within a 500,000-pixel budget');
    if (!['translation', 'similarity'].includes(model) || !fraction(minConfidence) || !range(maskThreshold, 0, 255) ||
        !range(threshold, .01, 100) || !int(maxSamples, 2, 4096) || !int(iterations, 1, 1024) ||
        !int(minInliers, 2, maxSamples) || !range(minInlierRatio, .1, 1) || !Number.isSafeInteger(seed))
      throw new RangeError('Invalid camera motion model, thresholds, or consensus settings');
    const weights = plane(confidence, width, height, 1, 'confidence'), background = plane(mask, width, height, 255, 'mask');
    const allowed = (p, u, v) => (!weights || weights[p] >= minConfidence) && (!background || background[p] >= maskThreshold) &&
      u >= 0 && v >= 0 && u < width && v < height;
    const samples = sampleGrid(width, height, data, allowed, maxSamples);
    const baseline = clamp(Math.min(width, height) * .12, 1, 12);
    const solved = consensus(samples, model === 'translation', { threshold, iterations, seed, minInliers }, baseline);
    const inlierCount = solved?.inliers.length ?? 0, inlierRatio = samples.length ? inlierCount / samples.length : 0;
    const valid = inlierCount >= minInliers && inlierRatio >= minInlierRatio;
    const { a, b, tx, ty } = valid ? solved.fit : identity, square = a * a + b * b;
    const inverse = [[a / square, b / square, (-a * tx - b * ty) / square],
      [-b / square, a / square, (b * tx - a * ty) / square]];
    const cx = width / 2, cy = height / 2;
    const transform = { model, valid, samples: samples.length, inliers: inlierCount, inlierRatio,
      rms: inlierCount ? Math.sqrt(solved.error / inlierCount) : null, scale: Math.sqrt(square),
      rotation: Math.atan2(b, a), pan: [a * cx - b * cy + tx - cx, b * cx + a * cy + ty - cy],
      matrix: [[a, -b, tx], [b, a, ty]], inverse };
    const camera = new Float32Array(data.length), local = new Float32Array(data.length);
    const uv = new Float32Array(data.length), inliers = new Uint8Array(width * height);
    for (let iy = 0, p = 0; iy < height; iy++) for (let ix = 0; ix < width; ix++, p++) {
      const x = ix + .5, y = iy + .5, i = p * 2;
      const u = a * x - b * y + tx, v = b * x + a * y + ty;
      const dx = data[i] - (u - x), dy = data[i + 1] - (v - y);
      camera[i] = u - x; camera[i + 1] = v - y;
      local[i] = (a * dx + b * dy) / square; local[i + 1] = (-b * dx + a * dy) / square;
      uv[i] = u / width; uv[i + 1] = v / height;
      if (valid && allowed(p, x + data[i], y + data[i + 1]) && dx * dx + dy * dy <= threshold * threshold)
        inliers[p] = 255;
    }
    return { value: raster(width, height, 2, local), camera: raster(width, height, 2, camera),
      field: raster(width, height, 2, uv), inliers: raster(width, height, 1, inliers), transform };
  }

  W.cameraMotion = cameraMotion;
})(KIT);
