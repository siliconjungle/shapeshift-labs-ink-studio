// Stable chart correspondence and paint transfer for authored UV revisions.
const MeshUV = require('../src/mesh-uv.js');
const { digest } = require('./material-projection.js');

const name = id => typeof id === 'string' && Boolean(id.trim()) && id.length <= 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => digest(JSON.stringify(value));
const ordered = values => [...new Set(values)].sort(compare);

function sourceIds(mesh) {
  const { vertexIds, faceIds } = mesh;
  if (vertexIds === undefined && faceIds === undefined) return null;
  if (!Array.isArray(vertexIds) || vertexIds.length !== mesh.points.length ||
      !Array.from(vertexIds).every(name) || new Set(vertexIds).size !== vertexIds.length ||
      !Array.isArray(faceIds) || faceIds.length !== mesh.faces.length || !Array.from(faceIds).every(name))
    throw new TypeError('A topology-aware bake needs distinct vertex IDs and one stable face ID per input face');
  return { vertexIds, faceIds };
}

function identify(mesh, faces, sourceFaces) {
  const ids = sourceIds(mesh);
  if (!ids) return undefined;
  const labels = sourceFaces.map(i => ids.faceIds[i]);
  const keys = faces.map((vertices, i) => JSON.stringify([labels[i], ...vertices.map(j => ids.vertexIds[j]).sort(compare)]));
  if (new Set(keys).size !== keys.length) throw new RangeError('Stable bake face and vertex IDs identify duplicate triangles');
  return { ...ids, labels, keys, points: mesh.points };
}

function verticesInOrder(face, identity) {
  const ids = face.map(index => identity.vertexIds[index]);
  const first = ids.indexOf(ids.slice().sort(compare)[0]);
  return [first, (first + 1) % 3, (first + 2) % 3];
}

function signatures(chart, data) {
  const { identity, mesh, faces, uvs, normals, materials } = data, rows = [], surface = [];
  const uvBounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of chart.faces) {
    const order = verticesInOrder(faces[f], identity);
    const key = identity.keys[f];
    const uv = order.map(i => [identity.vertexIds[faces[f][i]], uvs[f][i]]);
    rows.push([key, uv]);
    for (const [, [x, y]] of uv) {
      uvBounds[0] = Math.min(uvBounds[0], x); uvBounds[1] = Math.min(uvBounds[1], y);
      uvBounds[2] = Math.max(uvBounds[2], x); uvBounds[3] = Math.max(uvBounds[3], y);
    }
    surface.push([key, materials[mesh.faceMaterials[f]], order.map(i => {
      const n = faces[f][i];
      return [mesh.points[n], mesh.cornerNormals?.[f]?.[i] ?? normals[n], mesh.colors?.[n]];
    })]);
  }
  const sort = (a, b) => compare(a[0], b[0]);
  return { uvBounds, membership: hash(rows.map(row => row[0]).sort(compare)), layout: hash(rows.sort(sort)), signature: hash(surface.sort(sort)) };
}

function matches(charts, identity, prior) {
  let next = prior.nextChartId ?? prior.charts.reduce((n, row) => Math.max(n, row.id + 1), 0);
  const oldById = new Map(prior.charts.map(row => [row.id, row]));
  const exact = new Map(prior.charts.map(row => [row.membership, row.id]));
  const oldTriangles = new Map(prior.identity.keys.map((key, f) => [key, prior.faceCharts[f]]));
  const oldFaces = new Map();
  for (const [i, face] of prior.identity.labels.entries()) {
    if (!oldFaces.has(face)) oldFaces.set(face, new Set());
    oldFaces.get(face).add(prior.faceCharts[i]);
  }
  const used = new Set(), related = new Map(), scores = [];
  // Reused charts keep their numeric owner slots, independent of input order.
  for (const chart of charts) {
    const id = exact.get(chart.membership), same = oldById.get(id);
    if (same) { chart.id = id; used.add(id); }
    const common = new Map(), labels = ordered(chart.faces.map(f => identity.labels[f]));
    const score = (id, slot) => {
      if (!common.has(id)) common.set(id, [0, 0]);
      common.get(id)[slot]++;
    };
    for (const f of chart.faces) {
      const id = oldTriangles.get(identity.keys[f]);
      if (id !== undefined) score(id, 0);
    }
    for (const label of labels) for (const id of oldFaces.get(label) ?? []) score(id, 1);
    related.set(chart, [...common.keys()].sort((a, b) => a - b));
    if (!same) for (const [id, [triangles, faces]] of common) scores.push({ chart, id, triangles, faces });
  }
  scores.sort((a, b) => b.triangles - a.triangles || b.faces - a.faces ||
    compare(a.chart.membership, b.chart.membership) || a.id - b.id);
  for (const { chart, id } of scores) if (chart.id === undefined && !used.has(id)) {
    chart.id = id;
    used.add(id);
  }
  for (const chart of charts) if (chart.id === undefined) {
    if (next >= 0xfffffffe) throw new RangeError('Stable chart ID budget exceeded');
    chart.id = next++;
  }
  return { nextChartId: next, related, retired: prior.charts.filter(row => !used.has(row.id)).map(row => row.id).sort((a, b) => a - b) };
}

function assign(charts, data, prior) {
  if (!data.identity) return {};
  for (const chart of charts) Object.assign(chart, signatures(chart, data));
  if (!prior) return { nextChartId: charts.length };
  if (charts.some(row => row.id !== undefined))
    return { nextChartId: prior.nextChartId ?? charts.reduce((n, row) => Math.max(n, row.id + 1), 0) };
  return matches(charts, data.identity, prior);
}

const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const interpolate = (uvs, weights) => [0, 1].map(a => weights.reduce((sum, w, i) => sum + w * uvs[i][a], 0));

function oldTriangle(prior, f) {
  const points = prior.faces[f].map(i => prior.identity.points[i]);
  const [a, b, c] = points, u = sub(b, a), v = sub(c, a), uu = dot(u, u), uv = dot(u, v), vv = dot(v, v);
  const det = uu * vv - uv * uv, epsilon = Math.sqrt(Math.max(uu, vv)) * 1e-6 + 1e-8;
  return { a, u, v, uu, uv, vv, det, epsilon, uvs: prior.uvs[f], owner: prior.faceCharts[f] + 1,
    vertexIds: prior.faces[f].map(i => prior.identity.vertexIds[i]) };
}

function weightsAt(point, tri) {
  const { a, u, v, uu, uv, vv, det, epsilon } = tri;
  if (!(det > 0)) return null;
  const delta = sub(point, a), du = dot(delta, u), dv = dot(delta, v);
  const y = (du * vv - dv * uv) / det, z = (dv * uu - du * uv) / det, x = 1 - y - z;
  if (Math.min(x, y, z) < -1e-6 || Math.hypot(...delta.map((n, i) => n - y * u[i] - z * v[i])) > epsilon) return null;
  return [x, y, z];
}

function surfaceMapping(prior, state) {
  const exact = new Map(), byFace = new Map();
  for (const [f, key] of prior.identity.keys.entries()) {
    const tri = oldTriangle(prior, f), label = prior.identity.labels[f];
    exact.set(key, tri);
    if (!byFace.has(label)) byFace.set(label, []);
    byFace.get(label).push(tri);
  }
  const direct = state.identity.keys.map((key, f) => {
    const tri = exact.get(key);
    if (!tri) return null;
    const uvs = state.faces[f].map(i => tri.uvs[tri.vertexIds.indexOf(state.identity.vertexIds[i])]);
    return { uvs, owner: tri.owner };
  });
  let visits = 0;
  function mapped(face, point, weights) {
    const target = direct[face];
    if (target) return { uv: interpolate(target.uvs, weights), owner: target.owner };
    const candidates = byFace.get(state.identity.labels[face]) ?? [];
    if (candidates.length > 256) return null;
    let result;
    for (const tri of candidates) {
      if (++visits > 32e6) return null;
      const bary = weightsAt(point, tri);
      if (!bary) continue;
      const uv = interpolate(tri.uvs, bary);
      if (result && (result.owner !== tri.owner || !MeshUV.sameUV(result.uv, uv))) return null;
      result = { uv, owner: tri.owner };
    }
    return result;
  }
  return mapped;
}

function unmappedPaint(prior, state, previous, size, release, painted) {
  const missing = new Map();
  if (![...release].some(id => painted.has(id))) return missing;
  const mapped = surfaceMapping(state, prior), visited = new Uint8Array(previous.owners.length);
  for (const [f, tri] of prior.faces.entries()) {
    const id = prior.faceCharts[f];
    if (!release.has(id) || !painted.has(id)) continue;
    const [a, b, c] = prior.uvs[f].map(uv => uv.map(n => n * size)), det = MeshUV.area2(a, b, c);
    const x0 = Math.floor(Math.min(a[0], b[0], c[0])), x1 = Math.ceil(Math.max(a[0], b[0], c[0]));
    const y0 = Math.floor(Math.min(a[1], b[1], c[1])), y1 = Math.ceil(Math.max(a[1], b[1], c[1]));
    const points = tri.map(i => prior.identity.points[i]);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const pixel = y * size + x;
      if (visited[pixel] || previous.owners[pixel] !== id + 1 || !previous.footprint[pixel] ||
          previous.paint[pixel * 4 + 3] <= 0) continue;
      const q = [x + .5, y + .5], u = MeshUV.area2(a, q, c) / det, v = MeshUV.area2(a, b, q) / det;
      const weights = [1 - u - v, u, v];
      if (Math.min(...weights) < -1e-9) continue;
      const point = points[0].map((_, axis) => dot(weights, points.map(p => p[axis])));
      visited[pixel] = 1;
      if (!mapped(f, point, weights)) missing.set(id, (missing.get(id) ?? 0) + 1);
    }
  }
  return missing;
}

function transferPlan(prior, state, previous, size, release) {
  if (!previous.paint) return undefined;
  const mapped = surfaceMapping(prior, state);
  const paintNames = new Set(prior.paintMasks), painted = new Map();
  for (let i = 0; i < previous.owners.length; i++) if (previous.footprint[i] && previous.paint[i * 4 + 3] > 0) {
    const id = previous.owners[i] - 1;
    painted.set(id, (painted.get(id) ?? 0) + 1);
  }
  const missing = unmappedPaint(prior, state, previous, size, release, painted);
  const values = new Float64Array(paintNames.size);
  function sample(face, point, weights, stamp, at, masks, i) {
    const hit = mapped(face, point, weights);
    if (!hit) return 0;
    const [x, y] = hit.uv.map(n => n * size - .5), l = Math.floor(x), t = Math.floor(y);
    let total = 0;
    values.fill(0);
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const u = l + dx, v = t + dy, j = v * size + u;
      if (u < 0 || v < 0 || u >= size || v >= size || previous.owners[j] !== hit.owner || !previous.footprint[j]) continue;
      const w = (1 - Math.abs(x - u)) * (1 - Math.abs(y - v));
      if (w <= 0) continue;
      total += w;
      for (let c = 0; c < 4; c++) stamp[at + c] += previous.paint[j * 4 + c] * w;
      for (let c = 0; c < masks.length; c++) values[c] += masks[c].prior[j] * w;
    }
    if (!total) return 0;
    for (let c = 0; c < 4; c++) stamp[at + c] /= total;
    for (let c = 0; c < masks.length; c++) masks[c].current[i] = Math.round(values[c] / total);
    return stamp[at + 3] > 0 ? 2 : 1;
  }
  return { paintNames, painted, missing, sample };
}

function overlapReport(points, faces, uvs, faceCharts, size) {
  const { overlap } = MeshUV.inspect({ points, triangles: faces, uvs }, { size, padding: 0, maxChecks: 16000000 });
  if (!overlap.complete || overlap.count) {
    const conflicts = overlap.pairs.slice(0, 128).map(pair => ({
      code: 'atlas-overlap', triangles: pair, charts: ordered(pair.map(f => faceCharts[f]))
    }));
    if (!overlap.complete) conflicts.push({ code: 'atlas-overlap-check-incomplete' });
    return conflicts;
  }
  return [];
}

module.exports = { sourceIds, identify, assign, signatures, transferPlan, overlapReport };
