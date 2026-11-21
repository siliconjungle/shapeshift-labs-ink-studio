/* Deterministic, variable-radius surface marks selected with a bounded octree. */
const Stippling = (() => {
  const prepared = new WeakSet(),
    cache = new WeakMap(),
    clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const num = (v, a, b, key) => {
    if (!Number.isFinite(v) || v < a || v > b) throw new RangeError('Stippling: invalid ' + key);
    return v;
  };
  const vec = (v, key) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6))
      throw new TypeError('Stippling: invalid ' + key);
    return v.slice();
  };
  const color = v => {
    if (typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)) v = [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
    return Object.freeze(vec(v, 'color').map(v => num(v, 0, 255, 'RGB byte')));
  };
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    unit = n => {
      const l = Math.hypot(...n);
      if (l < 1e-9) throw new RangeError('Stippling: normal must be nonzero');
      return n.map(v => v / l);
    };
  function prepare(raw) {
    if (raw === false || raw === undefined) return null;
    if (prepared.has(raw)) return raw;
    if (raw && typeof raw === 'object' && cache.has(raw)) return cache.get(raw);
    const original = raw;
    if (raw === true) raw = {};
    const keys = [
      'style',
      'spacing',
      'fine',
      'coarse',
      'size',
      'radiusLimit',
      'density',
      'curvature',
      'silhouetteBand',
      'views',
      'light',
      'ambient',
      'toneDensity',
      'ink',
      'paper',
      'palette',
      'normalThreshold',
      'seed',
      'zones',
      'importance',
      'shadowSteps',
      'shadowDistance',
      'maxCandidates',
      'maxMarks',
      'maxChecks',
      'maxProbes'
    ];
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(k => !keys.includes(k)))
      throw new TypeError('Stippling: invalid settings');
    const {
      style = 'ink',
      spacing = 0.08,
      fine = 0.65,
      coarse = 2.5,
      size = [0.1, 0.42],
      radiusLimit = 0.45,
      density = 1,
      curvature = 0.13,
      silhouetteBand = 0.25,
      views = [],
      light = [-0.45, 0.8, 0.55],
      ambient = 0.2,
      toneDensity = 0.6,
      ink = '#173b51',
      paper = '#f5ead0',
      palette = ['#17536b', '#328794', '#a1bba0', '#eeb16d', '#d6694b'],
      normalThreshold = 0.2,
      seed = 1,
      zones = [],
      importance,
      shadowSteps = 6,
      shadowDistance = 2,
      maxCandidates = 100000,
      maxMarks = 30000,
      maxChecks = 2000000,
      maxProbes = 1000000
    } = raw;
    if (
      !['ink', 'pointillism'].includes(style) ||
      !Array.isArray(size) ||
      size.length !== 2 ||
      size[1] < size[0] ||
      !Array.isArray(views) ||
      views.length > 16 ||
      !Array.isArray(zones) ||
      zones.length > 64 ||
      !Array.isArray(palette) ||
      !palette.length ||
      palette.length > 32 ||
      (importance !== undefined && typeof importance !== 'function')
    )
      throw new TypeError('Stippling: invalid style, views, marks or detail authoring');
    const p = {
      style,
      spacing: num(spacing, 0.0001, 1000, 'spacing'),
      fine: num(fine, 0.25, 1, 'fine'),
      coarse: num(coarse, 1, 8, 'coarse'),
      radiusLimit: num(radiusLimit, 0.05, 2, 'radius limit'),
      size: Object.freeze(size.map(v => num(v, 0.025, 0.8, 'mark size'))),
      density: num(density, 0.1, 4, 'density'),
      curvature: num(curvature, 0.005, 1, 'curvature'),
      silhouetteBand: num(silhouetteBand, 0.01, 1, 'silhouette band'),
      views: Object.freeze(views.map(v => Object.freeze(unit(vec(v, 'view'))))),
      light: Object.freeze(unit(vec(light, 'light'))),
      ambient: num(ambient, 0, 1, 'ambient'),
      toneDensity: num(toneDensity, 0, 1, 'tone density'),
      ink: color(ink),
      paper: paper === false ? false : color(paper),
      palette: Object.freeze(palette.map(color)),
      normalThreshold: num(normalThreshold, -1, 1, 'normal threshold'),
      seed: num(seed, 0, 4294967295, 'seed'),
      importance,
      shadowSteps: num(shadowSteps, 0, 32, 'shadow steps'),
      shadowDistance: num(shadowDistance, 0, 1000, 'shadow distance')
    };
    for (const [key, value, limit] of [
      ['maxCandidates', maxCandidates, 1000000],
      ['maxMarks', maxMarks, 1000000],
      ['maxChecks', maxChecks, 20000000],
      ['maxProbes', maxProbes, 10000000]
    ]) {
      p[key] = num(value, 1, limit, key);
      if (!Number.isInteger(value)) throw new RangeError('Stippling: budgets must be integers');
    }
    if (!Number.isInteger(seed) || !Number.isInteger(shadowSteps))
      throw new RangeError('Stippling: seed and step count must be integers');
    p.zones = Object.freeze(
      zones.map(z => {
        if (!z || Object.keys(z).some(k => !['at', 'radius', 'strength'].includes(k)))
          throw new TypeError('Stippling: invalid detail zone');
        return Object.freeze({
          at: Object.freeze(vec(z.at, 'zone center')),
          radius: num(z.radius, 0.0001, 1e6, 'zone radius'),
          strength: num(z.strength ?? 1, 0, 1, 'zone strength')
        });
      })
    );
    Object.freeze(p);
    prepared.add(p);
    if (original && typeof original === 'object') cache.set(original, p);
    return p;
  }
  function hash(point, seed = 1) {
    let h = seed >>> 0;
    for (let i = 0; i < 3; i++) {
      h ^= Math.imul(Math.round(point[i] * 100000), [73856093, 19349663, 83492791][i]);
      h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
    }
    return (h >>> 0) / 4294967296;
  }
  function measure(definition, field, position, normal, step) {
    const p = prepare(definition);
    if (!p || typeof field !== 'function')
      throw new TypeError('Stippling: measurement needs a profile and signed field');
    const n = unit(vec(normal, 'normal')),
      at = vec(position, 'position');
    num(step, 0.00001, 10000, 'probe step');
    const u = unit(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]]),
      v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]],
      d = field(...at);
    let bend = 0,
      visibility = 1;
    for (const axis of [u, v])
      for (const sign of [-1, 1]) {
        const q = at.map((x, i) => x + axis[i] * step * sign),
          sample = field(...q);
        if (!Number.isFinite(sample)) throw new Error('Stippling: signed field returned a nonfinite distance');
        bend = Math.max(bend, Math.abs(sample - d) / step);
      }
    const nd = Math.max(0, dot(n, p.light));
    if (nd > 0 && p.shadowSteps && p.shadowDistance) {
      for (let j = 1; j <= p.shadowSteps; j++) {
        const t = step * 0.35 + p.shadowDistance * (j / p.shadowSteps) ** 2,
          q = at.map((x, i) => x + n[i] * step * 0.15 + p.light[i] * t),
          h = field(...q);
        if (!Number.isFinite(h)) throw new Error('Stippling: shadow field returned a nonfinite distance');
        visibility = Math.min(visibility, clamp((8 * h) / t));
        if (visibility <= 0) break;
      }
    }
    return { curvature: bend, light: p.ambient + (1 - p.ambient) * nd * visibility };
  }
  function features(definition, candidate) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Stippling: expected settings');
    const position = vec(candidate.position, 'position'),
      normal = unit(vec(candidate.normal, 'normal')),
      base = num(candidate.spacing ?? p.spacing, 0.0001, 1000, 'candidate spacing'),
      bend = num(candidate.curvature ?? 0, 0, 1e6, 'curvature'),
      lit = num(candidate.light ?? p.ambient + (1 - p.ambient) * Math.max(0, dot(normal, p.light)), 0, 1, 'light');
    const silhouette = p.views.reduce((m, v) => Math.max(m, clamp(1 - Math.abs(dot(normal, v)) / p.silhouetteBand)), 0);
    let importance = Math.max(
      clamp(num(candidate.curvature ?? 0, 0, 1000000, 'curvature sample') / p.curvature),
      silhouette,
      num(candidate.detail ?? 0, 0, 1, 'detail')
    );
    for (const z of p.zones) {
      const d = Math.hypot(...position.map((x, i) => x - z.at[i])) / z.radius;
      importance = Math.max(importance, z.strength * clamp(1 - d * d));
    }
    if (p.importance) {
      const value = p.importance(
        Object.freeze({
          ...candidate,
          position: Object.freeze(position.slice()),
          normal: Object.freeze(normal.slice())
        })
      );
      importance = Math.max(importance, num(value, 0, 1, 'importance callback'));
    }
    const tone = 1 - lit,
      scale = p.coarse + (p.fine - p.coarse) * importance,
      spacing = (base * scale) / Math.sqrt(p.density * (1 - p.toneDensity + p.toneDensity * (0.3 + 0.7 * tone))),
      radius = Math.min(base * p.radiusLimit, spacing * (p.size[0] + (p.size[1] - p.size[0]) * tone));
    return { position, normal, importance, tone, spacing, radius };
  }
  function sample(candidates, definition = true) {
    const p = prepare(definition);
    if (!p || !Array.isArray(candidates) || candidates.length > p.maxCandidates)
      throw new RangeError('Stippling: candidate budget exceeded or invalid candidates');
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity],
      rows = candidates.map((c, index) => {
        const f = features(p, c);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], f.position[k]);
          max[k] = Math.max(max[k], f.position[k]);
        }
        return { ...f, index, rank: hash(f.position, p.seed) - f.importance * 0.2, group: c.group };
      });
    rows.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.position[0] - b.position[0] ||
        a.position[1] - b.position[1] ||
        a.position[2] - b.position[2] ||
        a.index - b.index
    );
    const marks = [],
      stats = {
        candidates: rows.length,
        accepted: 0,
        rejected: 0,
        checks: 0,
        meanImportance: 0,
        minSpacing: Infinity,
        maxSpacing: 0
      };
    if (!rows.length) return { marks, stats };
    const span = Math.max(...max.map((v, i) => v - min[i]), p.spacing),
      origin = min.map((v, i) => (v + max[i] - span) / 2),
      root = { min: origin, max: origin.map(v => v + span), radius: 0, items: [] };
    const child = (node, index) => {
      const mid = node.min.map((v, i) => (v + node.max[i]) / 2);
      return {
        min: node.min.map((v, k) => (index & (1 << k) ? mid[k] : v)),
        max: node.max.map((v, k) => (index & (1 << k) ? v : mid[k])),
        radius: 0,
        items: []
      };
    };
    function insert(node, mark, depth = 0) {
      node.radius = Math.max(node.radius, mark.spacing / 2);
      if ((!node.children && node.items.length < 12) || depth >= 20) {
        node.items.push(mark);
        return;
      }
      if (!node.children) {
        node.children = Array.from({ length: 8 }, (_, i) => child(node, i));
        const items = node.items;
        node.items = [];
        for (const m of items) insert(node, m, depth);
      }
      const mid = node.min.map((v, i) => (v + node.max[i]) / 2),
        index = mark.position.reduce((n, v, i) => n + (v >= mid[i] ? 1 << i : 0), 0);
      insert(node.children[index], mark, depth + 1);
    }
    function conflict(node, c) {
      if (++stats.checks > p.maxChecks) throw new RangeError('Stippling: neighbor work budget exceeded');
      const radius = c.spacing / 2 + node.radius;
      let distance = 0;
      for (let k = 0; k < 3; k++)
        distance += Math.max(node.min[k] - c.position[k], 0, c.position[k] - node.max[k]) ** 2;
      if (distance >= radius * radius) return false;
      if (node.children) return node.children.some(n => conflict(n, c));
      for (const m of node.items) {
        if (++stats.checks > p.maxChecks) throw new RangeError('Stippling: neighbor work budget exceeded');
        if (c.group !== m.group || dot(c.normal, m.normal) < p.normalThreshold) continue;
        const d = c.position.reduce((s, v, i) => s + (v - m.position[i]) ** 2, 0),
          r = (c.spacing + m.spacing) / 2;
        if (d < r * r * (1 - 1e-9)) return true;
      }
      return false;
    }
    for (const c of rows) {
      if (conflict(root, c)) {
        stats.rejected++;
        continue;
      }
      if (marks.length >= p.maxMarks) throw new RangeError('Stippling: mark budget exceeded');
      insert(root, c);
      marks.push(
        Object.freeze({ index: c.index, spacing: c.spacing, radius: c.radius, importance: c.importance, tone: c.tone })
      );
      stats.meanImportance += c.importance;
      stats.minSpacing = Math.min(stats.minSpacing, c.spacing);
      stats.maxSpacing = Math.max(stats.maxSpacing, c.spacing);
    }
    stats.accepted = marks.length;
    stats.meanImportance /= marks.length || 1;
    if (!marks.length) stats.minSpacing = 0;
    return Object.freeze({ marks: Object.freeze(marks), stats: Object.freeze(stats) });
  }
  function paint(definition, rgb, position) {
    const p = prepare(definition);
    if (p.style === 'ink') return p.ink;
    const c = vec(rgb, 'source color'),
      pal = p.palette;
    let first = 0,
      best = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = c.reduce((s, v, k) => s + (v - pal[i][k]) ** 2, 0);
      if (d < best) {
        best = d;
        first = i;
      }
    }
    let second = first,
      t = 0;
    for (let i = 0; i < pal.length; i++) {
      if (i === first) continue;
      const a = pal[first],
        d = pal[i].map((v, k) => v - a[k]),
        den = dot(d, d);
      if (!den) continue;
      const w = clamp(
          dot(
            c.map((v, k) => v - a[k]),
            d
          ) / den
        ),
        error = c.reduce((s, v, k) => s + (v - a[k] - d[k] * w) ** 2, 0);
      if (error < best) {
        best = error;
        second = i;
        t = w;
      }
    }
    return pal[hash(position, p.seed ^ 0x6a09e667) < t ? second : first];
  }
  return Object.freeze({ prepare, hash, measure, features, sample, paint });
})();
if (typeof module !== 'undefined') module.exports = Stippling;
