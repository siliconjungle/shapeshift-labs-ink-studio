'use strict';

const { cutoff } = require('../src/gaussian-filter.js');
const { inRange } = require('./scan-fusion-views.js');
const { claimFields, integer } = require('./gaussian-training-views.js');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const stride = 8;
const variance = .3;

function settings(options = {}) {
  if (!claimFields(options, ['resolution', 'maxPoints', 'iterations', 'maxSamples', 'alphaCutoff', 'maskMargin']))
    throw new TypeError('Unknown Gaussian training setting');
  const { resolution = 28, maxPoints = 2400, iterations = 24, maxSamples = 240_000_000,
    alphaCutoff = .5, maskMargin = 1 } = options;
  if (!integer(resolution, 8, 64) || !integer(maxPoints, 16, 8000) || !integer(iterations, 1, 96) ||
      !integer(maxSamples, 1, 800_000_000) || !inRange(alphaCutoff, .05, .95) || !integer(maskMargin, 0, 2))
    throw new RangeError('Gaussian training settings exceed supported limits');
  return { resolution, maxPoints, iterations, maxSamples, alphaCutoff, maskMargin };
}

function projector(camera) {
  const { pose: { eye, right, up, back }, type, fx, fy, cx, cy, near, far } = camera;
  const forward = back.map(n => -n), ortho = type === 'orthographic';
  return (x, y, z) => {
    const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
    const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
    if (depth < near || depth > far) return;
    const across = dx * right[0] + dy * right[1] + dz * right[2];
    const above = dx * up[0] + dy * up[1] + dz * up[2];
    const inverse = ortho ? 1 : 1 / depth, sx = fx * inverse, sy = -fy * inverse;
    return { x: cx + across * sx, y: cy + above * sy, depth, sx, sy, right, up, forward,
      slopeX: ortho ? 0 : across * inverse, slopeY: ortho ? 0 : above * inverse };
  };
}

function dilate(view, margin) {
  const { width, height, silhouette } = view;
  if (!margin) return silhouette;
  const padded = new Uint8Array(silhouette.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!silhouette[y * width + x]) continue;
    const left = Math.max(0, x - margin), right = Math.min(width, x + margin + 1);
    for (let yy = Math.max(0, y - margin); yy < Math.min(height, y + margin + 1); yy++)
      padded.fill(1, yy * width + left, yy * width + right);
  }
  return padded;
}

function seed(bounds, views, config) {
  const span = bounds.max.map((max, axis) => max - bounds.min[axis]);
  const cell = Math.max(...span) / config.resolution;
  const grid = span.map(n => Math.ceil(n / cell)), spacing = span.map((n, k) => n / grid[k]);
  const [nx, ny, nz] = grid, plane = nx * ny, volume = new Uint8Array(plane * nz);
  const projections = views.map(view => ({ ...view, project: projector(view.camera), padded: dilate(view, config.maskMargin) }));
  const xyz = (x, y, z) => [x, y, z].map((n, i) => bounds.min[i] + (n + .5) * spacing[i]);
  let carved = 0, kept = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const coordinates = xyz(x, y, z);
    if (!projections.every(({ width, height, project, padded }) => {
      const p = project(...coordinates);
      if (!p || p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
      return padded[Math.floor(p.y) * width + Math.floor(p.x)];
    })) { carved++; continue; }
    volume[z * plane + y * nx + x] = 1;
    kept++;
  }
  const surface = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    if (!volume[i]) continue;
    if (x && x + 1 < nx && y && y + 1 < ny && z && z + 1 < nz &&
        volume[i - 1] && volume[i + 1] && volume[i - nx] && volume[i + nx] &&
        volume[i - plane] && volume[i + plane]) continue;
    surface.push(xyz(x, y, z));
  }
  if (!surface.length) throw new RangeError('Training masks have no common volume inside the requested bounds');
  const count = Math.min(surface.length, config.maxPoints);
  const positions = Array.from({ length: count }, (_, i) => surface[Math.floor((i + .5) * surface.length / count)]);
  const sums = new Float64Array(count * 4), mean = [0, 0, 0];
  let meanWeight = 0;
  for (const { width, height, project, target, silhouette } of projections) {
    const coords = positions.map(p => project(...p));
    const depths = new Float64Array(width * height).fill(Infinity);
    for (const p of coords) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      for (let v = Math.max(0, y - 1); v <= Math.min(height - 1, y + 1); v++)
        for (let u = Math.max(0, x - 1); u <= Math.min(width - 1, x + 1); u++)
          depths[v * width + u] = Math.min(depths[v * width + u], p.depth);
    }
    for (let i = 0; i < coords.length; i++) {
      const p = coords[i], index = Math.floor(p.y) * width + Math.floor(p.x);
      if (!silhouette[index]) continue;
      const weight = Math.exp(-2 * (p.depth - depths[index]) / cell), at = index * 4, out = i * 4;
      for (let c = 0; c < 3; c++) sums[out + c] += weight * target[at + c] / target[at + 3];
      sums[out + 3] += weight;
    }
    for (let at = 0; at < target.length; at += 4) {
      for (let c = 0; c < 3; c++) mean[c] += target[at + c];
      meanWeight += target[at + 3];
    }
  }
  const values = new Float64Array(count * stride);
  const spread = .57 * Math.sqrt(surface.length / count);
  for (let i = 0; i < count; i++) {
    const offset = i * stride, at = i * 4;
    values.set(positions[i], offset);
    values[offset + 3] = Math.log(clamp(spread, .57, 1.65));
    values[offset + 4] = .72;
    for (let c = 0; c < 3; c++) values[offset + 5 + c] = sums[at + 3] > 1e-6 ?
      sums[at + c] / sums[at + 3] : mean[c] / meanWeight;
  }
  return { values, cell, evidence: { grid, cell, voxelsKept: kept, voxelsCarved: carved, surfaceVoxels: surface.length } };
}

function packets(values, view, cell) {
  const project = projector(view.camera), result = [], { width, height } = view;
  for (let i = 0; i < values.length; i += stride) {
    const p = project(values[i], values[i + 1], values[i + 2]);
    if (!p) continue;
    const { x, y, sx, sy, slopeX, slopeY, right, up, forward } = p;
    const sigma2 = (cell * Math.exp(values[i + 3])) ** 2;
    const dx = right.map((v, k) => sx * (v - slopeX * forward[k]));
    const dy = up.map((v, k) => sy * (v - slopeY * forward[k]));
    const a = sigma2 * sx * sx * (1 + slopeX ** 2), b = sigma2 * sx * sy * slopeX * slopeY;
    const c = sigma2 * sy * sy * (1 + slopeY ** 2);
    const reachX = Math.sqrt(2 * cutoff * (a + variance)), reachY = Math.sqrt(2 * cutoff * (c + variance));
    const left = Math.max(0, Math.ceil(x - reachX - .5)), rightEdge = Math.min(width - 1, Math.floor(x + reachX - .5));
    const top = Math.max(0, Math.ceil(y - reachY - .5)), bottom = Math.min(height - 1, Math.floor(y + reachY - .5));
    if (left > rightEdge || top > bottom) continue;
    const pure = sigma2 ** 2 * sx ** 2 * sy ** 2 * (1 + slopeX ** 2 + slopeY ** 2);
    const det = pure + variance * (a + c + variance), gain = Math.sqrt(pure / det);
    const k0 = (c + variance) / det, k1 = -b / det, k2 = (a + variance) / det;
    result.push({ i, x, y, dx, dy, depth: p.depth, left, right: rightEdge, top, bottom,
      a, b, c, k0, k1, k2, gain, samples: (rightEdge - left + 1) * (bottom - top + 1) });
  }
  return result.sort((a, b) => a.depth - b.depth || a.i - b.i);
}

function rasterize(values, view, cell, budget, grads) {
  const active = packets(values, view, cell), { width, height, target } = view;
  const pixels = width * height;
  const rendered = new Float64Array(pixels * 4), transmittance = new Float64Array(pixels).fill(1);
  const logTransmittance = grads && new Float64Array(pixels);
  const samples = active.reduce((sum, packet) => sum + packet.samples, 0);
  budget.used += samples * (grads ? 2 : 1);
  if (budget.used > budget.max) throw new RangeError('Gaussian footprint sample budget exceeded. Reduce the grid, point count, image size or iterations.');
  for (const { i, x, y, left, right, top, bottom, k0, k1, k2, gain } of active) {
    const opacity = values[i + 4];
    for (let v = top; v <= bottom; v++) for (let u = left; u <= right; u++) {
      const dx = u + .5 - x, dy = v + .5 - y, pix = v * width + u, j = pix * 4;
      const power = -.5 * (k0 * dx * dx + 2 * k1 * dx * dy + k2 * dy * dy);
      if (power < -cutoff) continue;
      const alpha = opacity * gain * Math.exp(power), amount = alpha * transmittance[pix];
      for (let c = 0; c < 3; c++) rendered[j + c] += amount * values[i + 5 + c];
      transmittance[pix] *= 1 - alpha;
      if (logTransmittance) logTransmittance[pix] += Math.log1p(-alpha);
    }
  }
  let loss = 0;
  for (let i = 0; i < pixels; i++) {
    const j = i * 4;
    rendered[j + 3] = 1 - transmittance[i];
    for (let c = 0; c < 4; c++) loss += (rendered[j + c] - target[j + c]) ** 2;
  }
  if (!grads) return { rendered, loss, samples };

  // Reverse compositing gives each hit's behind-color and before-transmittance
  // without retaining a list of fragments for every pixel.
  const behind = new Float64Array(pixels * 4), error = rendered.map((n, i) => n - target[i]);
  // Recover prefix transmittance for each pixel in log space. A highly opaque
  // pixel can underflow the forward product, but its log remains reversible.
  for (let index = active.length - 1; index >= 0; index--) {
    const { i, x, y, left, right, top, bottom, dx, dy, a, b, c, k0, k1, k2, gain } = active[index];
    const opacity = values[i + 4], compensation = 2 - (k0 * a + 2 * k1 * b + k2 * c);
    for (let v = top; v <= bottom; v++) for (let u = left; u <= right; u++) {
      const ox = u + .5 - x, oy = v + .5 - y, qx = k0 * ox + k1 * oy, qy = k1 * ox + k2 * oy;
      const power = -.5 * (ox * qx + oy * qy);
      if (power < -cutoff) continue;
      const kernel = gain * Math.exp(power), alpha = opacity * kernel, pix = v * width + u, j = pix * 4;
      logTransmittance[pix] -= Math.log1p(-alpha);
      const front = Math.exp(logTransmittance[pix]), amount = alpha * front;
      let derivative = error[j + 3] * (1 - behind[j + 3]);
      for (let c = 0; c < 3; c++) {
        const color = values[i + 5 + c], delta = color - behind[j + c];
        derivative += error[j + c] * delta;
        grads[i + 5 + c] += error[j + c] * amount;
        behind[j + c] += alpha * delta;
      }
      behind[j + 3] += alpha * (1 - behind[j + 3]);
      const projected = derivative * amount;
      for (let k = 0; k < 3; k++) grads[i + k] += projected * (qx * dx[k] + qy * dy[k]) * cell;
      grads[i + 3] += projected * (qx * (a * qx + b * qy) + qy * (b * qx + c * qy) + compensation);
      grads[i + 4] += derivative * front * kernel;
    }
  }
  return { loss, samples };
}

function fit(views, bounds, config) {
  const initialized = seed(bounds, views, config), { cell } = initialized, values = initialized.values.slice();
  const m = new Float64Array(values.length), v = new Float64Array(values.length), grads = new Float64Array(values.length);
  const budget = { used: 0, max: config.maxSamples }, losses = [];
  const totalPixels = views.reduce((sum, view) => sum + view.width * view.height, 0), rates = [.025, .025, .025, .032, .034, .045, .045, .045];
  let best = values.slice(), bestLoss = Infinity, bestIteration = 0;
  for (let epoch = 0; epoch <= config.iterations; epoch++) {
    grads.fill(0);
    const update = epoch < config.iterations;
    const score = views.reduce((loss, view) =>
      loss + rasterize(values, view, cell, budget, update ? grads : undefined).loss, 0) / (4 * totalPixels);
    losses.push(score);
    if (score < bestLoss) { bestLoss = score; best = values.slice(); bestIteration = epoch; }
    if (!update) break;
    for (let i = 0; i < values.length; i++) {
      const k = i % stride, g = grads[i];
      m[i] = .9 * m[i] + .1 * g;
      v[i] = .999 * v[i] + .001 * g * g;
      const delta = rates[k] * m[i] / (1 - .9 ** (epoch + 1)) / (Math.sqrt(v[i] / (1 - .999 ** (epoch + 1))) + 1e-8);
      if (k < 3) {
        const center = initialized.values[i], reach = .85 * cell;
        values[i] = clamp(values[i] - delta * cell, Math.max(bounds.min[k], center - reach), Math.min(bounds.max[k], center + reach));
      } else if (k === 3) values[i] = clamp(values[i] - delta, Math.log(.24), Math.log(2));
      else if (k === 4) values[i] = clamp(values[i] - delta, .015, .985);
      else values[i] = clamp(values[i] - delta, 0, 1);
    }
  }
  return { initial: initialized.values, values: best, cell, budget, losses, bestIteration, initialization: initialized.evidence };
}

module.exports = { settings, fit, rasterize, stride };
