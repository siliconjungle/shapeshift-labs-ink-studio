/* Dense displacement from local image gradients, plus sampling and transport for raster graphs. */
(function (P) {
  const W = P.rasterWarp;
  const { view, int, clamp, tuple, bounded, fraction, fieldFrom, raster } = P.rasterWarpSupport;
  const gaussian = [1, 4, 6, 4, 1];

  function bilinear(data, w, h, x, y, stride = 1, offset = 0) {
    x = clamp(x, 0, w - 1);
    y = clamp(y, 0, h - 1);
    const u = Math.floor(x), v = Math.floor(y), dx = x - u, dy = y - v;
    const p = (v * w + u) * stride + offset;
    const right = u + 1 < w ? stride : 0, bottom = v + 1 < h ? w * stride : 0;
    const top = data[p] + (data[p + right] - data[p]) * dx;
    const low = data[p + bottom] + (data[p + bottom + right] - data[p + bottom]) * dx;
    return top + (low - top) * dy;
  }

  function intensity(image, channel, [low, high]) {
    const { channels, data } = view(image);
    const alpha = channels === 4 || channels === 2 ? channels - 1 : -1;
    const mask = alpha >= 0 && channel !== 'alpha' && channel !== alpha;
    const values = P.raster.channel(image, { channel }).data;
    return Float32Array.from(values, (value, i) => clamp((value - low) / (high - low)) *
      (mask ? clamp(data[i * channels + alpha] / 255) : 1));
  }

  function down(data, w, h, cols, rows) {
    const horizontal = new Float32Array(cols * h), result = new Float32Array(cols * rows);
    for (let y = 0; y < h; y++) for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += gaussian[k + 2] * data[y * w + clamp(x * 2 + k, 0, w - 1)];
      horizontal[y * cols + x] = sum / 16;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += gaussian[k + 2] * horizontal[clamp(y * 2 + k, 0, h - 1) * cols + x];
      result[y * cols + x] = sum / 16;
    }
    return result;
  }

  function gradients(data, w, h) {
    const dx = new Float32Array(w * h), dy = new Float32Array(w * h);
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      dx[p] = (data[p + Number(x + 1 < w)] - data[p - Number(x > 0)]) * .5;
      dy[p] = (data[p + (y + 1 < h ? w : 0)] - data[p - (y > 0 ? w : 0)]) * .5;
    }
    return { dx, dy };
  }

  // A frame-wide candidate helps repetitive patches disambiguate their coarse match.
  // Each patch can reject it in favor of its own predicted or stationary sample.
  function registration({ width: w, height: h, first, second }, spacing, reach, limit) {
    const stride = Math.max(1, Math.floor(Math.sqrt(w * h / 1600)));
    const minSamples = Math.ceil(w / stride) * Math.ceil(h / stride) * .45;
    const candidates = new Map();
    function candidate(u, v) {
      const square = u * u + v * v;
      const key = u + ':' + v;
      if (square > limit * limit || candidates.has(key)) return;
      let count = 0, error = 0;
      for (let y = Math.max(0, -v); y < Math.min(h, h - v); y += stride)
        for (let x = Math.max(0, -u); x < Math.min(w, w - u); x += stride) {
          const delta = first[y * w + x] - second[(y + v) * w + x + u];
          error += delta * delta; count++;
        }
      if (count < minSamples) return;
      candidates.set(key, { u, v, cost: error / count + square * .000002 });
    }
    const ranked = () => [...candidates.values()].sort((a, b) => a.cost - b.cost);
    for (let y = -reach; y <= reach; y++)
      for (let x = -reach; x <= reach; x++) candidate(x * spacing, y * spacing);
    while (spacing > 1) {
      spacing /= 2;
      for (const { u, v } of ranked().slice(0, 8))
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++) candidate(u + x * spacing, v + y * spacing);
    }
    const { u, v } = ranked()[0];
    return [u, v];
  }

  function refine(level, flow, { radius, iterations, regularization, limit, search, global, confidence }) {
    const { width: w, height: h, first, second } = level;
    const { dx, dy } = gradients(first, w, h);
    const offsets = [...new Set([-radius, -Math.ceil(radius / 2), 0, Math.ceil(radius / 2), radius])];
    const row = new Int32Array(25), col = new Int32Array(25), indices = new Int32Array(25);
    const change = new Float64Array(25), reach = Math.min(search, Math.floor(limit));
    let count = 0;
    function residual(u, v, record) {
      let cost = 0;
      for (let j = 0; j < count; j++) {
        const x = col[j] + u, y = row[j] + v;
        const d = first[indices[j]] - bilinear(second, w, h, x, y);
        cost += d * d;
        if (x < -.5 || x > w - .5 || y < -.5 || y > h - .5) cost += .04;
        if (record) change[j] = d;
      }
      return cost;
    }

    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      count = 0;
      let xx = 0, xy = 0, yy = 0;
      for (const oy of offsets) for (const ox of offsets) {
        const u = x + ox, v = y + oy;
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const q = v * w + u;
        col[count] = u; row[count] = v; indices[count++] = q;
        xx += dx[q] * dx[q]; xy += dx[q] * dy[q]; yy += dy[q] * dy[q];
      }
      if (xx + yy < 1e-10) continue;
      const sx = xx + regularization * count, sy = yy + regularization * count, det = sx * sy - xy * xy;
      let u = flow[p * 2], v = flow[p * 2 + 1];
      const penalty = count * .000006;
      let best = residual(u, v, false) + penalty * (u * u + v * v);
      function offer(x, y) {
        const candidate = residual(x, y, false) + penalty * (x * x + y * y);
        if (candidate + 1e-12 < best) { best = candidate; u = x; v = y; }
      }
      offer(0, 0);
      if (global[0] || global[1]) offer(global[0], global[1]);
      // Only the coarsest level seeds correspondences with a discrete search.
      if (reach && best > 1e-10) {
        for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
          if (i * i + j * j <= limit * limit) offer(i, j);
        }
      }
      let cost = residual(u, v, true);
      for (let pass = 0; pass < iterations && cost > 1e-10; pass++) {
        let xt = 0, yt = 0;
        for (let j = 0; j < count; j++) { xt += dx[indices[j]] * change[j]; yt += dy[indices[j]] * change[j]; }
        const du = (sy * xt - xy * yt) / det, dv = (sx * yt - xy * xt) / det, length = Math.hypot(du, dv);
        if (length < .008) break;
        let improved = false;
        for (let step = Math.min(1, 2 / length), attempt = 0; attempt < 3; attempt++, step *= .5) {
          const nu = u + du * step, nv = v + dv * step, bound = Math.max(1, Math.hypot(nu, nv) / limit);
          const nextX = nu / bound, nextY = nv / bound, nextCost = residual(nextX, nextY, false);
          if (nextCost + 1e-10 >= cost) continue;
          u = nextX; v = nextY;
          cost = residual(u, v, true);
          improved = true;
          break;
        }
        if (!improved) break;
      }
      flow[p * 2] = u; flow[p * 2 + 1] = v;
      if (confidence && x + u >= 0 && y + v >= 0 && x + u <= w - 1 && y + v <= h - 1) {
        const texture = Math.max(0, (xx + yy - Math.hypot(xx - yy, 2 * xy)) * .5 / count);
        confidence[p] = texture / (texture + .0005) / (1 + cost / count / .0064);
      }
    }
  }

  function opticalFlow(before, after, { direction = 'forward', channel = 'luma', sampleRange = [0, 255],
    levels = 4, radius = 4, iterations = 5, search = 5, maxMotion = 64, regularization = .00008 } = {}) {
    const a = view(before), b = view(after);
    const { width, height } = a;
    if (a.width !== b.width || a.height !== b.height || width * height > 500000)
      throw new RangeError('Optical flow needs matching raster sizes within its 500,000-pixel budget');
    if (!['forward', 'backward'].includes(direction) || !tuple(sampleRange, 2, bounded) ||
        sampleRange[1] - sampleRange[0] < 1e-8 || !int(levels, 1, 7) || !int(radius, 1, 12) ||
        !int(iterations, 1, 10) || !int(search, 0, 8) ||
        !Number.isFinite(maxMotion) || maxMotion <= 0 || maxMotion > 1024 ||
        !Number.isFinite(regularization) || regularization < 1e-7 || regularization > 1)
      throw new RangeError('Invalid optical flow direction, sample range, or solver settings');
    if (direction === 'backward') [before, after] = [after, before];
    const pyramid = [{ width, height, first: intensity(before, channel, sampleRange), second: intensity(after, channel, sampleRange) }];
    while (pyramid.length < levels) {
      const level = pyramid.at(-1), { width: w, height: h, first, second } = level;
      if (Math.min(w, h) < 24) break;
      const cols = Math.ceil(w / 2), rows = Math.ceil(h / 2);
      pyramid.push({ width: cols, height: rows, first: down(first, w, h, cols, rows), second: down(second, w, h, cols, rows) });
    }
    const confidence = new Float32Array(width * height);
    const translation = search ? registration(pyramid[0], 2 ** (pyramid.length - 1), search, maxMotion) : [0, 0];
    let previous, flow;
    for (let k = pyramid.length - 1; k >= 0; k--) {
      const level = pyramid[k], { width: w, height: h } = level;
      flow = new Float32Array(w * h * 2);
      if (previous) {
        const { width: cols, height: rows } = pyramid[k + 1];
        for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 2) {
          flow[p] = 2 * bilinear(previous, cols, rows, x * .5, y * .5, 2, 0);
          flow[p + 1] = 2 * bilinear(previous, cols, rows, x * .5, y * .5, 2, 1);
        }
      }
      // A single-level, full-size solve uses local refinement to keep search work bounded.
      const coarseSearch = !previous && w * h <= 16384 ? search : 0;
      const limit = maxMotion / 2 ** k;
      refine(level, flow, { radius, iterations, regularization, limit,
        search: coarseSearch, global: translation.map(value => value / 2 ** k), confidence: k === 0 ? confidence : null });
      previous = flow;
    }
    return { value: raster(width, height, 2, flow), confidence: raster(width, height, 1, confidence) };
  }

  function flowSampler(motion, { confidence, minConfidence = .15, scale = 1 } = {}) {
    const { width, height, channels, data } = view(motion);
    if (channels !== 2 || !fraction(minConfidence) || !bounded(scale) || Math.abs(scale) > 1024 ||
        !data.every(n => bounded(n) && Math.abs(n) <= 16384))
      throw new RangeError('Flow sampling needs bounded XY displacements, confidence threshold, and scale');
    let weights;
    if (confidence != null) {
      const mask = view(confidence);
      if (mask.channels !== 1 || mask.width !== width || mask.height !== height || !mask.data.every(fraction))
        throw new RangeError('Flow confidence needs an aligned single-channel raster in 0–1');
      weights = mask.data;
    }
    return (x, y, out = [0, 0]) => {
      if (!bounded(x) || !bounded(y)) throw new RangeError('Flow coordinates must be finite and bounded');
      const u = x - .5, v = y - .5;
      const active = x >= 0 && x < width && y >= 0 && y < height &&
        (!weights || bilinear(weights, width, height, u, v) >= minConfidence);
      out[0] = active ? scale * bilinear(data, width, height, u, v, 2, 0) : 0;
      out[1] = active ? scale * bilinear(data, width, height, u, v, 2, 1) : 0;
      return out;
    };
  }

  function flow(source, motion, settings = {}) {
    const { width, height } = view(source), read = flowSampler(motion, settings);
    if (motion.width !== width || motion.height !== height)
      throw new RangeError('Flow warping needs matching image and displacement dimensions');
    const offset = [0, 0];
    const field = fieldFrom(width, height, 2, (_u, _v, x, y, _p, out) => {
      read(x + .5, y + .5, offset);
      out[0] = (x + .5 + offset[0]) / width;
      out[1] = (y + .5 + offset[1]) / height;
    });
    return { value: W.sample(source, field, settings), field };
  }

  function flowPoints(points, motion, settings) {
    if (!Array.isArray(points) || points.length > 100000 || !Array.from(points).every(point => tuple(point, 2, bounded)))
      throw new RangeError('Flow advection needs up to 100,000 bounded XY points');
    const read = flowSampler(motion, settings), offset = [0, 0];
    return points.map(([x, y]) => {
      read(x, y, offset);
      return [x + offset[0], y + offset[1]];
    });
  }

  Object.assign(W, { opticalFlow, flowSampler, flow, flowPoints });
})(KIT.procedural);
