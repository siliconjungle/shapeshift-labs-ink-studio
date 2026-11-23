const CurveSplat = require('../src/curve-splat.js');
const StableDetail = require('../src/stable-detail.js');
const PixelLook = require('../src/pixel-look.js');

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const covarianceSlots = [4, 5, 6, 8, 9, 10];
const chunkSize = 32;

function projector({ view, focal, near, ortho, artScale }) {
  const scale = focal / artScale;
  const viewPoint = point => [0, 1, 2].map(k =>
    view[k] * point[0] + view[k + 4] * point[1] + view[k + 8] * point[2] + view[k + 12]);
  function compare(point, chordPoint) {
    const a = viewPoint(point), b = viewPoint(chordPoint), depth = Math.min(-a[2], -b[2]);
    if (depth < near) return Infinity;
    const multiplier = ortho ? scale : scale / depth;
    const x = ortho ? a[0] - b[0] : (a[0] / -a[2] - b[0] / -b[2]) * depth;
    const y = ortho ? a[1] - b[1] : (a[1] / -a[2] - b[1] / -b[2]) * depth;
    return multiplier * Math.hypot(x, y, a[2] - b[2]);
  }
  return { compare, size(point, width) {
    const depth = -viewPoint(point)[2];
    return depth < near ? Infinity : width * scale / (ortho ? 1 : depth);
  } };
}

function flatten(path, range, projection, write) {
  const { points, indices, radius } = path;
  function visit(first, last) {
    if (last - first === 1) {
      write(indices[first], points[first], points[last], radius);
      return;
    }
    const a = points[first], b = points[last], v = b.map((value, i) => value - a[i]), square = dot(v, v);
    let error = square > 1e-14 ? Math.max(projection.compare(a, a), projection.compare(b, b)) : Infinity;
    let previous = 0;
    const chord = [];
    for (let i = first + 1; i < last && error < range[1]; i++) {
      const t = Math.max(0, Math.min(1, dot(points[i].map((value, k) => value - a[k]), v) / square));
      if (t < previous - 1e-6) {
        error = Infinity;
        break;
      }
      const p = mix(a, b, t);
      chord.push(p);
      error = Math.max(error, projection.compare(points[i], p));
      previous = t;
    }
    if (error <= range[0]) {
      write(indices[first], a, b, radius, indices.slice(first + 1, last));
      return;
    }
    if (error < range[1]) {
      const amount = 1 - StableDetail.weight(range, error);
      for (let i = first + 1; i < last; i++) points[i] = mix(points[i], chord[i - first - 1], amount);
    }
    const middle = (first + last) >> 1;
    visit(first, middle);
    visit(middle, last);
  }
  visit(0, indices.length);
}

function frame(records, camera, { data, x, y, z, alpha, scale, windows, rig }) {
  if (!records?.some(row=>row.aggregate || row.runs.length)) return;
  const projection = projector(camera), hidden = new Set(), choices = new Map(), geometry = new Map();
  const stats = { removedSegments: 0, aggregateGroups: 0, blendingGroups: 0, aggregateSegments: 0 };
  const center = i => [x[i], y[i], z[i]];
  const part = i => rig?.free?.[i] ? 0 : rig?.bid?.[i] ?? 0;
  const span = i => !hidden.has(i) && alpha[i] > 0 ? CurveSplat.roundSpan(data, i * 16, scale[i], center(i)) : undefined;

  for (const { aggregate } of records) {
    if (!aggregate || !aggregate.opacity || aggregate.coverage) continue;
    const { detail, proxy: [start, end], pitch, opacity, transition } = aggregate;
    const parent = part(start);
    let ready = true;
    for (const [first, end] of detail) for (let i = first; i < end && ready; i++) {
      const window = windows?.[i];
      ready = alpha[i] > 0 && part(i) === parent &&
        (!window || window.first === 0 && window.last === 1 && window.width === 1 && window.fade === 1);
    }
    if (!ready) continue;
    let pixels = 0;
    for (let i = start; i < end; i++) {
      const row = CurveSplat.roundSpan(data, i * 16, scale[i], center(i));
      if (!row || part(i) !== parent) { pixels = Infinity; break; }
      const size = pitch * row.radius / data[i * 16 + 12];
      pixels = Math.max(pixels, projection.size(row.from, size), projection.size(row.to, size));
    }
    const detailWeight = StableDetail.weight(transition, pixels);
    const weight = detailWeight <= 1 / 32 ? 0 : detailWeight > 31 / 32 ? 1 : detailWeight;
    if (weight === 1) continue;
    stats.aggregateGroups++;
    stats.aggregateSegments += end - start;
    if (weight) stats.blendingGroups++;
    const fine = { weight, detail: true, cohort:aggregate }, coarse = { weight, detail: false, cohort:aggregate };
    for (const [first, end] of detail) for (let i = first; i < end; i++) {
      if (!weight) hidden.add(i);
      else choices.set(i, fine);
    }
    for (let i = start; i < end; i++) {
      alpha[i] = opacity;
      if (weight) choices.set(i, coarse);
    }
  }

  for (const { runs, simplify, aggregate } of records) for (const [start, end] of aggregate?.coverage ? [] : runs) {
    for (let first = start; first < end; first += chunkSize) {
      const last = Math.min(first + chunkSize, end);
      let path;
      function close() {
        if (path?.indices.length > 1) flatten(path, simplify, projection, (i, a, b, radius, removed = []) => {
          const original = path.original.get(i);
          if (!removed.length && ((a === original[0] && b === original[1]) || (b === original[0] && a === original[1]))) return;
          const row = CurveSplat.carrier(a, b, radius);
          if (!row) return;
          const q = i * 16, dataRow = data.slice(q, q + 16);
          dataRow.set(row.center);
          for (let k = 0; k < covarianceSlots.length; k++) dataRow[covarianceSlots[k]] = row.covariance[k];
          dataRow[12] = radius;
          dataRow[13] = row.half;
          geometry.set(i, { data: dataRow, center: row.center, endIndex: removed.at(-1) ?? i });
          for (const i of removed) hidden.add(i);
          stats.removedSegments += removed.length;
        });
        path = undefined;
      }
      for (let i = first; i < last; i++) {
        const section = span(i);
        if (!section) { close(); continue; }
        const color = data[i * 16 + 7];
        let { from, to } = section;
        if (path) {
          const previous = path.points.at(-1);
          if (distance(previous, to) < distance(previous, from)) [from, to] = [to, from];
          if (distance(previous, from) > .0001 || Math.abs(path.radius - section.radius) > Math.max(.000001, section.radius * .0002) ||
              color !== path.color || alpha[i] !== path.opacity || part(i) !== path.part)
            close();
        }
        if (!path) {
          if (i + 1 < last && distance(center(i + 1), from) < distance(center(i + 1), to)) [from, to] = [to, from];
          path = { points: [from], indices: [], radius: section.radius, color, opacity:alpha[i], part:part(i), original: new Map() };
        }
        path.original.set(i, [path.points.at(-1), to]);
        path.points.push(to);
        path.indices.push(i);
      }
      close();
    }
  }
  return { hidden, choices, geometry, stats };
}

function visible({ weight, detail }, x, y, artScale) {
  const rank = PixelLook.bayerRank(Math.floor(x / artScale), Math.floor(y / artScale));
  return detail === (rank < weight);
}

module.exports = { frame, visible };
