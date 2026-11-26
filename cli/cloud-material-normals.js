'use strict';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((n, k) => n - b[k]);
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const normalize = a => {
  const len = Math.hypot(...a);
  return len > 1e-12 ? a.map(n => n / len) : [0, 0, 0];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function neighborhood(points) {
  function partition(rows, depth) {
    if (!rows.length) return null;
    const axis = depth % 3;
    rows.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
    const middle = rows.length >> 1;
    return { id: rows[middle], axis,
      left: partition(rows.slice(0, middle), depth + 1), right: partition(rows.slice(middle + 1), depth + 1) };
  }
  const tree = partition(Array.from(points.keys()), 0);
  return (row, limit) => {
    const at = points[row], nearest = [], maxVisits = 768;
    let visits = 0;
    function search(node) {
      if (!node || visits >= maxVisits) return;
      visits++;
      const p = points[node.id], delta = at[node.axis] - p[node.axis];
      const first = delta < 0 ? node.left : node.right, second = delta < 0 ? node.right : node.left;
      search(first);
      if (node.id !== row) {
        const distance = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
        if (distance > 0 && (nearest.length < limit || distance < nearest.at(-1).distance)) {
          const i = nearest.findIndex(hit => hit.distance > distance || (hit.distance === distance && hit.row > node.id));
          nearest.splice(i < 0 ? nearest.length : i, 0, { row: node.id, distance });
          if (nearest.length > limit) nearest.pop();
        }
      }
      if (nearest.length < limit || delta ** 2 <= nearest.at(-1).distance) search(second);
    }
    search(tree);
    return { nearest, limited: visits === maxVisits };
  };
}

function plane(points, at, nearest) {
  if (nearest.length < 4) return { direction: [0, 0, 0], support: 0 };
  const variance = nearest.at(-1).distance * .5;
  const samples = [{ p: at, w: 1 }, ...nearest.map(({ row, distance }) => ({ p: points[row], w: Math.exp(-distance / variance) }))];
  const weight = samples.reduce((sum, sample) => sum + sample.w, 0);
  const centroid = at.map((_, k) => samples.reduce((sum, sample) => sum + sample.w * sample.p[k], 0) / weight);
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const { p, w } of samples) {
    const offset = sub(p, centroid);
    for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) matrix[i][j] += w * offset[i] * offset[j] / variance;
  }
  matrix[1][0] = matrix[0][1];
  matrix[2][0] = matrix[0][2];
  matrix[2][1] = matrix[1][2];
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  // Cyclic Jacobi rotations diagonalize the symmetric 3x3 neighborhood covariance.
  for (let sweep = 0; sweep < 7; sweep++) for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const off = matrix[a][b];
    if (Math.abs(off) < 1e-12) continue;
    const angle = .5 * Math.atan2(2 * off, matrix[b][b] - matrix[a][a]), c = Math.cos(angle), s = Math.sin(angle);
    const x = matrix[a][a], y = matrix[b][b];
    matrix[a][a] = c * c * x - 2 * c * s * off + s * s * y;
    matrix[b][b] = s * s * x + 2 * c * s * off + c * c * y;
    matrix[a][b] = matrix[b][a] = 0;
    const k = 3 - a - b, u = matrix[k][a], v = matrix[k][b];
    matrix[k][a] = matrix[a][k] = c * u - s * v;
    matrix[k][b] = matrix[b][k] = s * u + c * v;
    for (const row of vectors) {
      const u = row[a], v = row[b];
      row[a] = c * u - s * v;
      row[b] = s * u + c * v;
    }
  }
  const [first, mid, last] = [0, 1, 2].sort((a, b) => matrix[a][a] - matrix[b][b]);
  const spread = matrix[last][last], gap = matrix[mid][mid] - matrix[first][first];
  return { direction: vectors.map(row => row[first]), support: clamp(2 * gap / Math.max(spread, 1e-12)) };
}

function estimate(world, { neighbors, normalToward }) {
  const points = Array.from({ length: world.count }, (_, i) => Array.from(world.data.subarray(i * 16, i * 16 + 3)));
  const find = neighborhood(points), axes = world.gaussianHarmonics.normals;
  return points.map((at, row) => {
    const axis = Array.from(axes.subarray(row * 3, row * 3 + 3)), strength = clamp(Math.hypot(...axis) / 127);
    const { nearest, limited } = find(row, neighbors);
    const local = plane(points, at, nearest);
    const authored = normalize(axis), reference = normalToward ?? normalize(at);
    const alignment = Math.abs(dot(authored, local.direction));
    const useAxis = strength > local.support * .8;
    let normal = useAxis ? authored : local.support > .02 ? local.direction : normalize(reference);
    if (!normal.some(Boolean)) normal = [0, 1, 0];
    const facing = dot(normal, reference);
    if (facing < 0) normal = normal.map(n => -n);
    const signSupport = normalToward ? clamp(Math.abs(facing) * 4) : clamp(Math.abs(facing) * 1.7);
    const agreement = strength > .2 && local.support > .2 ? .7 + .3 * alignment : 1;
    const certainty = (useAxis ? strength * .95 : local.support * .86) * agreement *
      (.35 + .65 * signSupport) * (limited ? .8 : 1);
    return { normal, uncertainty: 1 - clamp(certainty), source: useAxis ? 'covariance' : local.support > .02 ? 'neighborhood' : 'orientation',
      neighbors: nearest.length, limited };
  });
}

module.exports = { estimate, dot, cross, clamp, normalize };
