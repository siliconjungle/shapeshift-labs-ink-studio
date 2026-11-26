const { area2 } = require('./glb-uv.js');

function triangle(uv, size) {
  const points = uv.map(point => point.map(n => n * size));
  const det = area2(...points);
  if (Math.abs(det) < 1e-16) throw new Error('Cannot bake a degenerate UV triangle');
  return { points, det };
}

function samples({ points: [a, b, c], det }, size, visit) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const x1 = Math.min(size, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y1 = Math.min(size, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const q = [x + .5, y + .5], u = area2(a, q, c) / det, v = area2(a, b, q) / det;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
    visit(x + y * size, u, v, Math.min(u, v, 1 - u - v) > 1e-7, x, y);
  }
}

function gutters(covered, size, padding, eligible, copy) {
  if (!padding) return;
  const { length: count } = covered;
  let front = [];
  for (let i = 0; i < count; i++) if (covered[i] && eligible(i) &&
    ((i % size > 0 && !covered[i - 1]) || (i % size < size - 1 && !covered[i + 1]) ||
    (i >= size && !covered[i - size]) || (i < count - size && !covered[i + size]))) front.push(i);
  for (let step = 0; step < padding && front.length; step++) {
    const next = [];
    for (const i of front) {
      if (i % size > 0) copy(i, i - 1, next);
      if (i % size < size - 1) copy(i, i + 1, next);
      if (i >= size) copy(i, i - size, next);
      if (i < count - size) copy(i, i + size, next);
    }
    front = next;
  }
}

module.exports = { triangle, samples, gutters };
