/* Optional native splat silhouettes. Author once, sample cached signed-distance tiles. */
const SplatFootprints = (() => {
  const types = Object.freeze(['circle', 'square', 'wedge', 'star', 'cross', 'chip', 'polygon', 'mask']);
  const resolution = 128,
    columns = 8,
    maxStyles = 64,
    half = Math.sqrt(2 * Math.log(2));
  const validLayouts = new WeakSet();
  const prepared = new WeakSet(),
    fields = new WeakMap(),
    plans = new WeakMap(),
    geometryCache = new Map(),
    indexPlans = new WeakMap();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function num(x, a, b, label) {
    if (!Number.isFinite(x) || x < a || x > b) throw new RangeError('Splat footprint: invalid ' + label);
    return x;
  }
  function record(o, keys, label) {
    if (!o || Object.getPrototypeOf(o) !== Object.prototype || Object.keys(o).some(k => !keys.includes(k)))
      throw new TypeError('Splat footprint: invalid ' + label);
  }
  function prepare(spec) {
    if (spec === undefined || spec === false) return null;
    if (prepared.has(spec)) return spec;
    if (typeof spec === 'string') spec = { shape: spec };
    record(
      spec,
      ['shape', 'rotation', 'stretch', 'softness', 'tips', 'innerRadius', 'width', 'seed', 'vertices', 'mask'],
      'settings'
    );
    const { shape = 'square', rotation = 0, stretch = [1, 1], softness = 0.08 } = spec;
    if (!types.includes(shape)) throw new TypeError('Splat footprint: unknown shape ' + shape);
    num(rotation, -Math.PI * 2, Math.PI * 2, 'rotation');
    num(softness, 0, 0.5, 'softness');
    if (!Array.isArray(stretch) || stretch.length !== 2)
      throw new TypeError('Splat footprint: stretch needs two numbers');
    const scale = Object.freeze(Array.from(stretch, v => num(v, 0.1, 4, 'stretch')));
    const own =
      { star: ['tips', 'innerRadius'], cross: ['width'], chip: ['seed'], polygon: ['vertices'], mask: ['mask'] }[
        shape
      ] ?? [];
    if (Object.keys(spec).some(k => !['shape', 'rotation', 'stretch', 'softness', ...own].includes(k)))
      throw new TypeError('Splat footprint: setting does not belong to ' + shape);
    const p = { shape, rotation, stretch: scale, softness };
    let vertices;
    if (shape === 'circle') vertices = null;
    if (shape === 'square')
      vertices = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ];
    if (shape === 'wedge')
      vertices = [
        [-1, -1],
        [1, 0],
        [-1, 1]
      ];
    if (shape === 'star') {
      const tips = num(spec.tips ?? 5, 3, 12, 'tips'),
        innerRadius = num(spec.innerRadius ?? 0.43, 0.12, 0.85, 'innerRadius');
      if (!Number.isInteger(tips)) throw new RangeError('Splat footprint: tips must be an integer');
      Object.assign(p, { tips, innerRadius });
      vertices = Array.from({ length: tips * 2 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / tips,
          r = i % 2 ? innerRadius : 1;
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
    }
    if (shape === 'cross') {
      const w = num(spec.width ?? 0.32, 0.1, 0.85, 'width');
      p.width = w;
      vertices = [
        [-w, -1],
        [w, -1],
        [w, -w],
        [1, -w],
        [1, w],
        [w, w],
        [w, 1],
        [-w, 1],
        [-w, w],
        [-1, w],
        [-1, -w],
        [-w, -w]
      ];
    }
    if (shape === 'chip') {
      const seed = num(spec.seed ?? 1, 0, 4294967295, 'seed');
      if (!Number.isInteger(seed)) throw new RangeError('Splat footprint: seed must be an integer');
      p.seed = seed;
      let s = (seed ^ 0x9e3779b9) >>> 0;
      const rnd = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      vertices = Array.from({ length: 7 }, (_, i) => {
        const a = ((i + rnd() * 0.35) * Math.PI * 2) / 7,
          r = 0.65 + rnd() * 0.35;
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
    }
    if (shape === 'polygon') {
      if (!Array.isArray(spec.vertices) || spec.vertices.length < 3 || spec.vertices.length > 64)
        throw new RangeError('Splat footprint: polygon needs 3–64 vertices');
      vertices = Array.from(spec.vertices, v => {
        if (!Array.isArray(v) || v.length !== 2) throw new TypeError('Splat footprint: invalid vertex');
        return Array.from(v, n => num(n, -1, 1, 'vertex'));
      });
      if (
        Math.abs(
          vertices.reduce((sum, v, i) => {
            const w = vertices[(i + 1) % vertices.length];
            return sum + v[0] * w[1] - v[1] * w[0];
          }, 0)
        ) < 1e-6
      )
        throw new RangeError('Splat footprint: polygon has no area');
      p.vertices = vertices;
    }
    if (shape === 'mask') {
      record(spec.mask, ['width', 'height', 'alpha'], 'mask');
      const { width, height, alpha } = spec.mask;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 2 ||
        height < 2 ||
        width > 128 ||
        height > 128 ||
        !(Array.isArray(alpha) || alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray) ||
        alpha.length !== width * height
      )
        throw new RangeError('Splat footprint: mask needs 2–128 texels per axis and alpha bytes');
      const values = Array.from(alpha, v => {
        num(v, 0, 255, 'mask alpha');
        if (!Number.isInteger(v)) throw new TypeError('Splat footprint: alpha needs bytes');
        return v;
      });

      p.mask = Object.freeze({ width, height, alpha: Object.freeze(values) });
    }
    if (vertices) {
      vertices = Object.freeze(vertices.map(v => Object.freeze(v)));
      if (shape === 'polygon') p.vertices = vertices;
    }
    const c = Math.cos(rotation),
      s = Math.sin(rotation);
    Object.defineProperties(p, {
      outline: { value: vertices },
      matrix: { value: Object.freeze([c / scale[0], s / scale[0], -s / scale[1], c / scale[1]]) },
      reach: { value: half * Math.SQRT2 * Math.max(...scale) * (1 + softness) }
    });
    Object.freeze(p);
    prepared.add(p);
    return p;
  }
  function polygonDistance(v, x, y) {
    let best = Infinity,
      inside = false;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const a = v[j],
        b = v[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      best = Math.min(best, (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2);
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return Math.sqrt(best) * (inside ? -1 : 1);
  }
  // Exact squared Euclidean distance transform; two separable lower envelopes.
  function edt(input, w, h) {
    const temp = new Float64Array(input.length),
      out = new Float64Array(input.length),
      n = Math.max(w, h);
    const f = new Float64Array(n),
      d = new Float64Array(n),
      v = new Int32Array(n),
      z = new Float64Array(n + 1);
    function line(length) {
      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (let q = 1; q < length; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
          k--;
          s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < length; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) ** 2 + f[v[k]];
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = input[y * w + x];
      line(w);
      for (let x = 0; x < w; x++) temp[y * w + x] = d[x];
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = temp[y * w + x];
      line(h);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    return out;
  }
  function field(definition) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Splat footprint: a field needs a shape');
    if (fields.has(p)) return fields.get(p);
    const { rotation, stretch, softness, ...geometry } = p,
      key = JSON.stringify(geometry);
    if (geometryCache.has(key)) {
      const f = geometryCache.get(key);
      fields.set(p, f);
      return f;
    }
    const n = resolution,
      result = new Float32Array(n * n);
    if (p.shape === 'mask') {
      const on = new Uint8Array(n * n),
        outside = new Float64Array(n * n),
        inside = new Float64Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = (x / (n - 1)) * 3 - 1.5,
            v = (y / (n - 1)) * 3 - 1.5;
          const ix = Math.floor((u + 1) * 0.5 * p.mask.width),
            iy = Math.floor((1 - v) * 0.5 * p.mask.height);
          const yes =
            ix >= 0 &&
            iy >= 0 &&
            ix < p.mask.width &&
            iy < p.mask.height &&
            p.mask.alpha[iy * p.mask.width + ix] >= 128;
          const i = y * n + x;
          on[i] = +yes;
          outside[i] = yes ? 0 : 1e12;
          inside[i] = yes ? 1e12 : 0;
        }
      const a = edt(outside, n, n),
        b = edt(inside, n, n);
      for (let i = 0; i < result.length; i++)
        result[i] = ((on[i] ? -(Math.sqrt(b[i]) - 0.5) : Math.sqrt(a[i]) - 0.5) * 3) / (n - 1);
    } else
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = (x / (n - 1)) * 3 - 1.5,
            v = (y / (n - 1)) * 3 - 1.5;
          result[y * n + x] = p.shape === 'circle' ? Math.hypot(u, v) - 1 : polygonDistance(p.outline, u, v);
        }
    if (geometryCache.size >= 128) geometryCache.delete(geometryCache.keys().next().value);
    geometryCache.set(key, result);
    fields.set(p, result);
    return result;
  }
  function distance(p, x, y) {
    if (Math.abs(x) > 1.5 || Math.abs(y) > 1.5) return Math.max(Math.abs(x), Math.abs(y)) - 1;
    const data = field(p),
      n = resolution,
      px = clamp((x / 3 + 0.5) * (n - 1), 0, n - 1),
      py = clamp((y / 3 + 0.5) * (n - 1), 0, n - 1);
    const ix = Math.floor(px),
      iy = Math.floor(py),
      jx = Math.min(ix + 1, n - 1),
      jy = Math.min(iy + 1, n - 1),
      a = px - ix,
      b = py - iy;
    return (
      (data[iy * n + ix] * (1 - a) + data[iy * n + jx] * a) * (1 - b) +
      (data[jy * n + ix] * (1 - a) + data[jy * n + jx] * a) * b
    );
  }
  function coverage(p, x, y) {
    const d = distance(p, x, y),
      s = p.softness;
    if (!s) return d <= 0 ? 1 : 0;
    const t = clamp((d + s) / (2 * s), 0, 1);
    return 1 - t * t * (3 - 2 * t);
  }
  function transform(p, A, B, C) {
    const s = Math.sqrt(Math.max(1e-16, A * C - B * B)),
      den = half * s * Math.sqrt(Math.max(1e-16, A + C + 2 * s));
    const a = (C + s) / den,
      b = -B / den,
      c = (A + s) / den,
      m = p.matrix;
    return [m[0] * a + m[1] * b, m[0] * b + m[1] * c, m[2] * a + m[3] * b, m[2] * b + m[3] * c];
  }
  function sample(p, map, x, y) {
    return coverage(p, map[0] * x + map[1] * y, map[2] * x + map[3] * y);
  }
  function layout(count, styles = [], indices) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffff)
      throw new RangeError('Splat footprint: invalid count');
    indices ??= new Uint16Array(count);
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 0xffffff ||
      !Array.isArray(styles) ||
      styles.length > maxStyles ||
      !(indices instanceof Uint16Array) ||
      indices.length !== count
    )
      throw new RangeError('Splat footprint: invalid layout dimensions');
    const settings = Array.from(styles, v => {
      const p = prepare(v);
      if (!p) throw new TypeError('Splat footprint: layout style cannot be disabled');
      return p;
    });
    if (indices.some(i => i > settings.length)) throw new RangeError('Splat footprint: undefined style index');
    const result = Object.freeze({ version: 1, styles: Object.freeze(settings), indices: indices.slice() });
    validLayouts.add(result);
    return result;
  }
  function validate(world) {
    const b = world.splatFootprints;
    if (!b) return null;
    if (!Number.isSafeInteger(world.count) || world.count < 0 || world.count > 0xffffff)
      throw new RangeError('Splat footprint: invalid world count');
    if (validLayouts.has(b) && b.indices.length <= world.count) return b;
    if (plans.has(b) && plans.get(b).count === world.count) return b;
    if (b.version !== 1) throw new TypeError('Splat footprint: unsupported layout version');
    if (!(b.indices instanceof Uint16Array) || b.indices.length > world.count)
      throw new RangeError('Splat footprint: layout exceeds the world');
    layout(b.indices.length, b.styles, b.indices);
    validLayouts.add(b);
    return b;
  }
  function plan(world) {
    const b = validate(world);
    if (!b) return null;
    if (plans.has(b) && plans.get(b).count === world.count) {
      const cached = plans.get(b);
      indexPlans.set(b.indices, cached);
      return cached;
    }
    const styles = b.styles.map(prepare),
      n = resolution,
      cols = Math.min(columns, Math.max(1, styles.length)),
      rows = Math.max(1, Math.ceil(styles.length / cols));
    const previous = indexPlans.get(b.indices),
      tiles = styles.map(field);
    const shared =
      previous &&
      previous.count === world.count &&
      previous.tiles.length === tiles.length &&
      tiles.every((f, i) => f === previous.tiles[i]);
    const atlas = shared ? previous.atlas : new Float32Array(cols * n * rows * n),
      params = new Float32Array(maxStyles * 2 * 4);
    const indices = previous && previous.count === world.count ? previous.indices : new Float32Array(world.count * 4);
    let reach = 3;
    styles.forEach((p, i) => {
      const f = tiles[i],
        x = (i % cols) * n,
        y = Math.floor(i / cols) * n;
      if (!shared) for (let j = 0; j < n; j++) atlas.set(f.subarray(j * n, (j + 1) * n), (y + j) * cols * n + x);
      params.set(p.matrix, i * 4);
      params.set([p.softness, p.reach, 0, 0], maxStyles * 4 + i * 4);
      reach = Math.max(reach, p.reach);
    });
    if (indices !== previous?.indices) for (let i = 0; i < world.count; i++) indices[i * 4] = b.indices[i] ?? 0;
    const out = {
      count: world.count,
      styles,
      tiles,
      atlas,
      params,
      indices,
      width: cols * n,
      height: rows * n,
      columns: cols,
      reach
    };
    plans.set(b, out);
    indexPlans.set(b.indices, out);
    return out;
  }

  function recorder() {
    const styles = [],
      keys = new Map(),
      ranges = [];
    function slot(spec) {
      const p = prepare(spec);
      if (!p) return 0;
      const key = JSON.stringify(p);
      if (keys.has(key)) return keys.get(key);
      if (styles.length >= maxStyles) throw new RangeError('Splat footprint: exceeds 64 styles');
      const id = styles.push(p);
      keys.set(key, id);
      return id;
    }
    return {
      record(first, end, spec) {
        const id = slot(spec),
          last = ranges.at(-1);
        if (last && last[1] === first && last[2] === id) last[1] = end;
        else ranges.push([first, end, id]);
        return id;
      },
      finish(count) {
        if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffff)
          throw new RangeError('Splat footprint: invalid count');
        const ids = new Uint16Array(count);
        for (const [first, end, id] of ranges) {
          if (!Number.isInteger(first) || !Number.isInteger(end) || first < 0 || end < first || end > count)
            throw new RangeError('Splat footprint: invalid recorded range');
          ids.fill(id, first, end);
        }
        return layout(count, styles, ids);
      }
    };
  }
  function assign(world, selection, spec) {
    if (!Number.isSafeInteger(world?.count) || world.count < 0 || world.count > 0xffffff)
      throw new RangeError('Splat footprint: invalid world count');
    const old = validate(world),
      styles = old ? old.styles.slice() : [],
      ids = new Uint16Array(world.count),
      p = prepare(spec),
      key = p && JSON.stringify(p);
    if (old) ids.set(old.indices);
    let id = p ? styles.findIndex(v => JSON.stringify(v) === key) + 1 : 0;
    if (p && !id) {
      if (styles.length >= maxStyles)
        throw new RangeError('Splat footprint: exceeds 64 styles; use update for live edits');
      id = styles.push(p);
    }
    const rows = selection === 'all' ? null : Array.from(selection);
    if (rows && rows.some(i => !Number.isInteger(i) || i < 0 || i >= world.count))
      throw new RangeError('Splat footprint: selected row is outside the world');
    if (rows) for (const i of rows) ids[i] = id;
    else ids.fill(id);
    if (!p && !ids.some(Boolean)) {
      delete world.splatFootprints;
      return 0;
    }
    const next = layout(world.count, styles, ids);
    world.splatFootprints = next;
    return id;
  }
  function update(world, slot, spec) {
    const b = validate(world);
    if (!b || !Number.isInteger(slot) || slot < 1 || slot > b.styles.length)
      throw new RangeError('Splat footprint: invalid style slot');
    const styles = b.styles.slice();
    styles[slot - 1] = prepare(spec);
    if (!styles[slot - 1]) throw new TypeError('Splat footprint: update needs a shape');
    world.splatFootprints = Object.freeze({ version: 1, styles: Object.freeze(styles), indices: b.indices });
    validLayouts.add(world.splatFootprints);
    return slot;
  }
  function setTransform(world, slot, changes) {
    const b = validate(world);
    if (!b || !Number.isInteger(slot) || slot < 1 || slot > b.styles.length)
      throw new RangeError('Splat footprint: invalid style slot');
    record(changes, ['rotation', 'stretch', 'softness'], 'transform');
    const base = prepare(b.styles[slot - 1]),
      rotation = changes.rotation ?? base.rotation,
      softness = changes.softness ?? base.softness,
      stretch = changes.stretch ?? base.stretch;
    num(rotation, -Math.PI * 2, Math.PI * 2, 'rotation');
    num(softness, 0, 0.5, 'softness');
    if (!Array.isArray(stretch) || stretch.length !== 2)
      throw new TypeError('Splat footprint: stretch needs two numbers');
    const scale = Object.freeze(Array.from(stretch, n => num(n, 0.1, 4, 'stretch'))),
      c = Math.cos(rotation),
      s = Math.sin(rotation);
    const p = { ...base, rotation, softness, stretch: scale };
    Object.defineProperties(p, {
      outline: { value: base.outline },
      matrix: { value: Object.freeze([c / scale[0], s / scale[0], -s / scale[1], c / scale[1]]) },
      reach: { value: half * Math.SQRT2 * Math.max(...scale) * (1 + softness) }
    });
    Object.freeze(p);
    prepared.add(p);
    fields.set(p, field(base));
    const styles = b.styles.slice();
    styles[slot - 1] = p;
    world.splatFootprints = Object.freeze({ version: 1, styles: Object.freeze(styles), indices: b.indices });
    validLayouts.add(world.splatFootprints);
    return slot;
  }
  function subset(world, selection) {
    selection = Array.from(selection);
    if (selection.some(i => !Number.isInteger(i) || i < 0 || i >= world.count))
      throw new RangeError('Splat footprint: invalid subset row');
    const b = validate(world);
    return (
      b &&
      layout(
        selection.length,
        b.styles,
        Uint16Array.from(selection, i => b.indices[i] ?? 0)
      )
    );
  }
  function join(parts) {
    if (!parts.some(p => p.splatFootprints)) return undefined;
    const r = recorder();
    let start = 0;
    for (const part of parts) {
      const b = validate(part);
      if (b) {
        let first = 0;
        while (first < part.count) {
          const id = b.indices[first] ?? 0;
          let end = first + 1;
          while (end < part.count && (b.indices[end] ?? 0) === id) end++;
          r.record(start + first, start + end, id ? b.styles[id - 1] : false);
          first = end;
        }
      }
      start += part.count;
    }
    return r.finish(start);
  }
  function rayCoverage(style, cov, center, origin, direction, view) {
    if (
      !view ||
      !view.view ||
      view.view.length !== 16 ||
      !Array.from(view.view).every(Number.isFinite) ||
      ![view.width, view.height, view.tangent, view.clipNear].every(n => Number.isFinite(n) && n > 0) ||
      (view.variance !== undefined && (!Number.isFinite(view.variance) || view.variance < 0))
    )
      throw new TypeError('Splat footprint: invalid projected ray view');
    const m = view.view,
      project = p => [0, 1, 2].map(k => m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12]);
    const c = project(center),
      o = project(origin),
      d = [0, 1, 2].map(k => m[k] * direction[0] + m[k + 4] * direction[1] + m[k + 8] * direction[2]);
    if (c[2] >= -view.clipNear || Math.abs(d[2]) < 1e-10) return 0;
    const t = (c[2] - o[2]) / d[2];
    if (t < 0) return 0;
    const f = view.height / (2 * view.tangent),
      iz = view.ortho ? 1 : -1 / c[2];
    const tx = view.ortho ? 0 : clamp(c[0] * iz, (-1.3 * view.width) / (2 * f), (1.3 * view.width) / (2 * f)) / iz;
    const ty = view.ortho ? 0 : clamp(c[1] * iz, (-1.3 * view.height) / (2 * f), (1.3 * view.height) / (2 * f)) / iz;
    const u = [0, 4, 8].map(k => f * iz * m[k] + f * tx * iz * iz * m[k + 2]);
    const v = [1, 5, 9].map(k => f * iz * m[k] + f * ty * iz * iz * m[k + 1]);
    const tensor = (a, b) =>
      a[0] * (cov[0] * b[0] + cov[1] * b[1] + cov[2] * b[2]) +
      a[1] * (cov[1] * b[0] + cov[3] * b[1] + cov[4] * b[2]) +
      a[2] * (cov[2] * b[0] + cov[4] * b[1] + cov[5] * b[2]);
    const variance = view.variance ?? 0.15,
      A = tensor(u, u) + variance,
      B = tensor(u, v),
      C = tensor(v, v) + variance;
    if (A * C - B * B <= 0) return 0;
    let cx = view.width * 0.5 + f * c[0] * iz,
      cy = view.height * 0.5 + f * c[1] * iz;
    if (view.snap) {
      cx = Math.floor(cx) + 0.5;
      cy = Math.floor(cy) + 0.5;
    }
    return sample(
      style,
      transform(style, A, B, C),
      view.width * 0.5 + f * (o[0] + t * d[0]) * iz - cx,
      view.height * 0.5 + f * (o[1] + t * d[1]) * iz - cy
    );
  }
  const glsl = `
float footprintDistance(sampler2D atlas, float slot, float columns, vec2 p){
 const float N=128.0;
 vec2 cell=vec2(mod(slot-1.0,columns),floor((slot-1.0)/columns))*N;
 vec2 q=clamp((p/3.0+.5)*(N-1.0),vec2(0.0),vec2(N-1.0)),f=fract(q);
 ivec2 a=ivec2(floor(q)),b=min(a+1,ivec2(127)),base=ivec2(cell);
 float d=mix(mix(texelFetch(atlas,base+a,0).r,texelFetch(atlas,base+ivec2(b.x,a.y),0).r,f.x),mix(texelFetch(atlas,base+ivec2(a.x,b.y),0).r,texelFetch(atlas,base+b,0).r,f.x),f.y);
 return any(greaterThan(abs(p),vec2(1.5)))?max(abs(p.x),abs(p.y))-1.0:d;
}
float footprintCoverage(float d,float softness){return softness>0.0?1.0-smoothstep(-softness,softness,d):(d<=0.0?1.0:0.0);}
`;
  return Object.freeze({
    types,
    resolution,
    maxStyles,
    half,
    prepare,
    field,
    distance,
    coverage,
    transform,
    sample,
    layout,
    plan,
    validate,
    recorder,
    assign,
    update,
    setTransform,
    subset,
    join,
    rayCoverage,
    glsl
  });
})();
if (typeof module !== 'undefined') module.exports = SplatFootprints;
