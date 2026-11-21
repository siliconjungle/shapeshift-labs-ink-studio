/* Nested tonal art maps over retained native-splat coordinates. No frame-time raster generation. */
const Engraving = (() => {
  let F, Print;
  try {
    Print = ScreenPrint;
  } catch {
    Print = require('./screen-print.js');
  }
  try {
    F = SplatFootprints;
  } catch {
    F = require('./splat-footprints.js');
  }
  const styles = Object.freeze(['hatching', 'engraving', 'woodcut', 'stippling']),
    maxStyles = 16,
    tones = 8;
  const prepared = new WeakSet(),
    objects = new WeakMap(),
    mapsBySpec = new WeakMap(),
    geometryCache = new Map(),
    valid = new WeakSet();
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n)),
    dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const num = (n, a, b, key) => {
    if (!Number.isFinite(n) || n < a || n > b) throw new RangeError('Engraving: invalid ' + key);
    return n;
  };
  const xyz = (v, key) => {
    if (!(Array.isArray(v) || ArrayBuffer.isView(v)) || v.length !== 3)
      throw new TypeError('Engraving: invalid ' + key);
    return Array.from(v, n => num(n, -1e6, 1e6, key));
  };
  const unit = v => {
    const l = Math.hypot(...v);
    if (l < 1e-8) throw new RangeError('Engraving: axis must be nonzero');
    return v.map(n => n / l);
  };
  const color = (v, key) => {
    if (typeof v === 'string' && /^#[\da-f]{6}$/i.test(v))
      return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
    const a = xyz(v, key);
    a.forEach(n => num(n, 0, 1, key));
    return a;
  };
  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (prepared.has(value)) return value;
    if (value && typeof value === 'object' && objects.has(value)) return objects.get(value);
    const input = value;
    if (value === true) value = {};
    if (typeof value === 'string') value = { style: value };
    const keys = [
      'style',
      'projection',
      'scale',
      'origin',
      'along',
      'across',
      'radius',
      'ink',
      'paper',
      'strength',
      'density',
      'contrast',
      'bias',
      'ambient',
      'tone',
      'strokeWidth',
      'jitter',
      'seed',
      'resolution',
      'lodBias',
      'screenPrint'
    ];
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !keys.includes(k)))
      throw new TypeError('Engraving: invalid settings');
    const {
      style = 'engraving',
      projection = 'triplanar',
      scale = 0.65,
      origin = [0, 0, 0],
      along = [1, 0, 0],
      across = [0, 1, 0],
      radius = 1,
      ink = '#15263b',
      paper = '#f0dbb2',
      strength = 1,
      density = 1,
      contrast = 1,
      bias = 0,
      ambient = 0.16,
      tone = 'normal',
      strokeWidth = 1.15,
      jitter = 0.08,
      seed = 1,
      resolution = 64,
      lodBias = 0
    } = value;
    if (
      !styles.includes(style) ||
      !['plane', 'cylinder', 'sphere', 'triplanar'].includes(projection) ||
      !['normal', 'luminance', 'hybrid'].includes(tone)
    )
      throw new TypeError('Engraving: unknown style, projection or tone source');
    num(scale, 0.001, 1000, 'scale');
    num(radius, 0.001, 1000, 'radius');
    num(strength, 0, 1, 'strength');
    num(density, 0.05, 4, 'density');
    num(contrast, 0.1, 4, 'contrast');
    num(bias, -1, 1, 'bias');
    num(ambient, 0, 1, 'ambient');
    num(strokeWidth, 0.35, 3, 'strokeWidth');
    num(jitter, 0, 0.3, 'jitter');
    num(seed, 0, 4294967295, 'seed');
    num(lodBias, -3, 3, 'lodBias');
    if (!Number.isInteger(seed) || ![32, 64, 128].includes(resolution))
      throw new RangeError('Engraving: seed must be uint32; resolution must be 32, 64 or 128');
    const u = unit(xyz(along, 'along')),
      a = xyz(across, 'across'),
      v = unit(a.map((n, i) => n - dot(a, u) * u[i]));
    const p = Object.freeze({
      style,
      projection,
      scale,
      origin: Object.freeze(xyz(origin, 'origin')),
      along: Object.freeze(u),
      across: Object.freeze(v),
      radius,
      ink: Object.freeze(color(ink, 'ink')),
      paper: Object.freeze(color(paper, 'paper')),
      strength,
      density,
      contrast,
      bias,
      ambient,
      tone,
      strokeWidth,
      jitter,
      seed,
      resolution,
      lodBias,
      ...(value.screenPrint !== undefined &&
        value.screenPrint !== false && { screenPrint: Print.prepare(value.screenPrint) })
    });
    prepared.add(p);
    if (input && typeof input === 'object') objects.set(input, p);
    return p;
  }
  const hash = (n, s) => {
    let a = Math.imul(n ^ s, 0x45d9f3b);
    a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
    return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
  };
  const fract = x => x - Math.floor(x),
    smooth = (a, b, x) => {
      const t = clamp((x - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
  const radical = (n, base) => {
    let v = 0,
      f = 1 / base;
    while (n) {
      v += (n % base) * f;
      n = Math.floor(n / base);
      f /= base;
    }
    return v;
  };
  const reverse = (n, bits) => {
    let r = 0;
    for (let i = 0; i < bits; i++) {
      r = r * 2 + (n & 1);
      n >>= 1;
    }
    return r;
  };
  function maps(definition) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Engraving: maps need enabled settings');
    if (mapsBySpec.has(p)) return mapsBySpec.get(p);
    const key = JSON.stringify([p.style, p.strokeWidth, p.jitter, p.seed, p.resolution]);
    if (geometryCache.has(key)) {
      const out = geometryCache.get(key);
      mapsBySpec.set(p, out);
      return out;
    }
    const levels = [];
    let total = 0;
    for (let mip = 0; mip < 3; mip++) {
      const size = p.resolution >> mip,
        N = size >> 2,
        bits = Math.log2(N),
        data = new Float32Array(size * size * tones),
        means = new Float32Array(tones);
      for (let t = 0; t < tones; t++)
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) / size,
              v = (y + 0.5) / size,
              tone = t / (tones - 1);
            let a = 0;
            if (t === tones - 1) a = 1;
            else if (t) {
              const evaluate = dark => {
                let ink = 0;
                if (p.style === 'stippling') {
                  for (let j = 0; j < N; j++)
                    for (let i = 0; i < N; i++) {
                      const index = j * N + i,
                        rank = hash(index, p.seed),
                        birth = rank * 0.92;
                      if (dark < birth) continue;
                      const px = fract(radical(index + 1, 2) + hash(1, p.seed)),
                        py = fract(radical(index + 1, 3) + hash(2, p.seed));
                      const dx = Math.min(Math.abs(u - px), 1 - Math.abs(u - px)),
                        dy = Math.min(Math.abs(v - py), 1 - Math.abs(v - py));
                      const radius = (0.5 + 0.7 * smooth(birth, Math.min(1, birth + 0.24), dark)) * p.strokeWidth;
                      ink = Math.max(ink, 1 - smooth(radius - 0.5, radius + 0.5, Math.hypot(dx, dy) * size));
                    }
                } else {
                  const families = p.style === 'hatching' ? 1 : 3;
                  for (let family = 0; family < families; family++) {
                    const start = family === 0 ? 0 : family === 1 ? 0.3 : 0.64,
                      amount = clamp((dark - start) / (1 - start));
                    const wave = p.style === 'woodcut' ? 0.045 : 0.012;
                    const q =
                      (family === 0 ? v : family === 1 ? u : u + v) +
                      wave * Math.sin(2 * Math.PI * u) * (1 + p.jitter * Math.sin(4 * Math.PI * v + p.seed));
                    for (let i = 0; i < N; i++) {
                      const activation = clamp(amount * N - reverse(i, bits));
                      if (!activation) continue;
                      let numerator = i,
                        denominator = N;
                      while (denominator > 1 && !(numerator & 1)) {
                        numerator /= 2;
                        denominator /= 2;
                      }
                      const at = i / N + (p.jitter * 0.12 * Math.sin(numerator * 6.3 + p.seed)) / denominator;
                      const dist = (Math.abs(fract(q - at + 0.5) - 0.5) * size) / (family === 2 ? Math.SQRT2 : 1);
                      const width = p.strokeWidth * (0.78 + 0.22 * hash(i + family * 71, p.seed));
                      ink = Math.max(ink, activation * (1 - smooth(width * 0.5 - 0.45, width * 0.5 + 0.45, dist)));
                    }
                  }
                }
                return ink;
              };
              a = p.style === 'woodcut' ? 1 - evaluate(1 - tone) : evaluate(tone);
            }
            data[t * size * size + y * size + x] = a;
            means[t] += a / (size * size);
          }
      levels.push(Object.freeze({ size, data, means, offset: total }));
      total += data.length;
    }
    const packed = new Float32Array(total);
    for (const level of levels) {
      const n = level.size,
        area = n * n;
      for (let tone = 0; tone < tones; tone++)
        for (let i = 0; i < area; i++)
          packed[level.offset + Math.floor(tone / 4) * area * 4 + i * 4 + (tone % 4)] = level.data[tone * area + i];
    }
    const out = Object.freeze({ tones, levels: Object.freeze(levels), data: packed, bytes: packed.byteLength, key });
    if (geometryCache.size >= 16) geometryCache.delete(geometryCache.keys().next().value);
    geometryCache.set(key, out);
    mapsBySpec.set(p, out);
    return out;
  }
  function bilinear(level, t, u, v) {
    const n = level.size,
      x = fract(u) * n - 0.5,
      y = fract(v) * n - 0.5,
      ix = Math.floor(x),
      iy = Math.floor(y),
      a = x - ix,
      b = y - iy;
    const at = (dx, dy) => level.data[t * n * n + ((iy + dy + n) % n) * n + ((ix + dx + n) % n)];
    return (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b) + (at(0, 1) * (1 - a) + at(1, 1) * a) * b;
  }
  function sample(definition, u, v, darkness, footprint = 0) {
    const p = prepare(definition);
    if (!p) return 0;
    for (const n of [u, v, darkness, footprint])
      if (!Number.isFinite(n)) throw new TypeError('Engraving: sample must be finite');
    if (footprint < 0) throw new RangeError('Engraving: footprint must be nonnegative');
    const m = maps(p),
      d = clamp((darkness - 0.5) * p.contrast + 0.5 + p.bias) * p.density,
      at = clamp(d) * 7,
      lo = Math.floor(at),
      hi = Math.min(7, lo + 1),
      f = at - lo;
    const lod = clamp(Math.log2(Math.max(1e-8, (footprint * p.resolution) / p.scale)) + p.lodBias, 0, 3),
      a = Math.min(2, Math.floor(lod)),
      b = Math.min(2, a + 1),
      l = lod - a;
    const read = i =>
      bilinear(m.levels[i], lo, u / p.scale, v / p.scale) * (1 - f) +
      bilinear(m.levels[i], hi, u / p.scale, v / p.scale) * f;
    const ink = read(a) * (1 - l) + read(b) * l,
      mean = m.levels[2].means[lo] * (1 - f) + m.levels[2].means[hi] * f;
    return ink * (1 - Math.max(0, lod - 2)) + mean * Math.max(0, lod - 2);
  }
  function coordinates(p, point) {
    const q = point.map((n, i) => n - p.origin[i]),
      z = cross(p.along, p.across),
      x = dot(q, p.along),
      y = dot(q, p.across),
      depth = dot(q, z);
    if (p.projection === 'plane') return [x, y];
    if (p.projection === 'cylinder') return [Math.atan2(depth, x) * p.radius, y];
    if (p.projection === 'sphere')
      return [Math.atan2(depth, x) * p.radius, Math.atan2(y, Math.hypot(x, depth)) * p.radius];
    return q;
  }
  function shade(
    definition,
    point,
    normal,
    rgb,
    { light = [-0.45, 0.8, 0.55], visibility = 1, footprint = 0, restNormal = normal, screen } = {}
  ) {
    const p = prepare(definition);
    if (!p) return rgb;
    const n = unit(xyz(normal, 'normal')),
      sun = unit(xyz(light, 'light')),
      lit = 1 - clamp(p.ambient + (1 - p.ambient) * Math.max(0, dot(n, sun)) * clamp(visibility));
    const lum = 1 - clamp(rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722),
      tone = p.tone === 'normal' ? lit : p.tone === 'luminance' ? lum : lit * 0.65 + lum * 0.35;
    const uv = coordinates(p, point);
    if (p.screenPrint) {
      if (p.screenPrint.strength === 0) return rgb;
      const print = (a, b) =>
        Print.shade(
          p.screenPrint,
          [a, b],
          rgb.map(v => clamp(v)),
          { footprint, screen, light: 1 - lit }
        );
      if (p.screenPrint.space === 'screen' || p.projection !== 'triplanar') return print(uv[0], uv[1]);
      const w = restNormal.map(n => Math.abs(n) ** 8),
        sum = w.reduce((a, b) => a + b, 0) || 1,
        out = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++)
        if (w[axis] / sum > 0.001) {
          const c = print(uv[(axis + 1) % 3], uv[(axis + 2) % 3]);
          for (let i = 0; i < 3; i++) out[i] += (c[i] * w[axis]) / sum;
        }
      return out;
    }
    let ink;
    if (p.projection === 'triplanar') {
      const w = restNormal.map(n => Math.abs(n) ** 8),
        sum = w.reduce((a, b) => a + b, 0) || 1;
      ink = 0;
      for (let axis = 0; axis < 3; axis++)
        if (w[axis] / sum > 0.001) {
          const a = (axis + 1) % 3,
            b = (axis + 2) % 3;
          ink += (w[axis] / sum) * sample(p, uv[a], uv[b], tone, footprint);
        }
    } else ink = sample(p, uv[0], uv[1], tone, footprint);
    return rgb.map((n, i) => n * (1 - p.strength) + (p.paper[i] * (1 - ink) + p.ink[i] * ink) * p.strength);
  }
  function layout(count, settings, indices, anchors, restFrames) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 0xffffff ||
      !Array.isArray(settings) ||
      settings.length > maxStyles ||
      !(indices instanceof Uint16Array) ||
      indices.length > count ||
      !(anchors instanceof Float32Array) ||
      anchors.length !== indices.length * 3 ||
      !(restFrames instanceof Float32Array) ||
      restFrames.length !== indices.length * 6
    )
      throw new RangeError('Engraving: invalid layout');
    const styles = settings.map(prepare);
    if (
      styles.some(p => !p) ||
      indices.some(i => i > styles.length) ||
      ![anchors, restFrames].every(a => a.every(Number.isFinite))
    )
      throw new TypeError('Engraving: invalid binding');
    const result = Object.freeze({
      version: 1,
      styles: Object.freeze(styles),
      indices: indices.slice(),
      anchors: anchors.slice(),
      restFrames: restFrames.slice()
    });
    valid.add(result);
    return result;
  }
  function validate(world) {
    const b = world.engraving;
    if (!b) return null;
    if (b.version !== 1 || b.indices.length > world.count) throw new TypeError('Engraving: incompatible binding');
    if (!valid.has(b)) {
      layout(world.count, b.styles, b.indices, b.anchors, b.restFrames);
      valid.add(b);
    }
    return b;
  }
  function bindMany(world, assignments) {
    if (
      !Number.isSafeInteger(world?.count) ||
      world.count < 0 ||
      world.count > 0xffffff ||
      !(world.data instanceof Float32Array) ||
      world.data.length < world.count * 16
    )
      throw new TypeError('Engraving: expected a native splat world');
    if (!world.engraving && assignments.every(([, definition]) => !prepare(definition))) return 0;
    const old = validate(world),
      settings = old ? old.styles.slice() : [],
      indices = new Uint16Array(world.count),
      anchors = new Float32Array(world.count * 3),
      restFrames = new Float32Array(world.count * 6),
      frames = new Float32Array(world.count * 6);
    if (old) {
      indices.set(old.indices);
      anchors.set(old.anchors);
      restFrames.set(old.restFrames);
    }
    if (world.splatFootprints?.frames) frames.set(world.splatFootprints.frames);
    const normals = world.renderMetadata?.normals,
      keys = new Map(settings.map((p, i) => [JSON.stringify(p), i + 1]));
    let id = 0;
    for (const [selection, definition] of assignments) {
      const p = prepare(definition),
        rows = selection === 'all' ? Array.from({ length: world.count }, (_, i) => i) : Array.from(selection);
      if (rows.some(i => !Number.isInteger(i) || i < 0 || i >= world.count))
        throw new RangeError('Engraving: invalid selection');
      const key = p && JSON.stringify(p);
      id = p ? (keys.get(key) ?? 0) : 0;
      if (p && !id) {
        if (settings.length >= maxStyles) throw new RangeError('Engraving: exceeds 16 styles');
        id = settings.push(p);
        keys.set(key, id);
      }
      for (const i of rows) {
        if (!p) {
          indices[i] = 0;
          continue;
        }
        const q = i * 16,
          flags = Math.round(world.data[q + 11]);
        if (world.data[q + 3] <= 0 || flags & (32 | 256 | 32768)) continue;
        let f = frames.subarray(i * 6, i * 6 + 6);
        if (!f.some(Boolean)) {
          const n = normals && Array.from(normals.subarray(i * 3, i * 3 + 3));
          if (!n || Math.hypot(...n) < 1e-8) continue;
          const normal = unit(n),
            axis = Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
            u = unit(cross(axis, normal)),
            v = cross(normal, u);
          frames.set([...u, ...v], i * 6);
          f = frames.subarray(i * 6, i * 6 + 6);
        }
        if (!indices[i]) {
          anchors.set(world.data.subarray(q, q + 3), i * 3);
          restFrames.set(f, i * 6);
        }
        indices[i] = id;
      }
    }
    const next = layout(world.count, settings, indices, anchors, restFrames),
      b = world.splatFootprints;
    if (b && b.indices.length === world.count) F.setFrames(world, frames);
    else {
      const ids = new Uint16Array(world.count);
      if (b) ids.set(b.indices);
      world.splatFootprints = F.layout(world.count, b?.styles ?? [], ids, frames);
    }
    world.engraving = next;
    return id;
  }
  const bind = (world, selection, definition) => bindMany(world, [[selection, definition]]);
  function update(world, slot, definition) {
    const b = validate(world),
      p = prepare(definition);
    if (!b || !p || !Number.isInteger(slot) || slot < 1 || slot > b.styles.length)
      throw new RangeError('Engraving: invalid style edit');
    const styles = b.styles.slice();
    styles[slot - 1] = p;
    world.engraving = Object.freeze({ ...b, styles: Object.freeze(styles) });
    valid.add(world.engraving);
    return slot;
  }
  function subset(world, selection) {
    const b = validate(world);
    if (!b) return;
    const ids = Array.from(selection);
    if (ids.some(i => !Number.isSafeInteger(i) || i < 0 || i >= world.count))
      throw new RangeError('Engraving: invalid subset row');
    return layout(
      ids.length,
      b.styles,
      Uint16Array.from(ids, i => b.indices[i] ?? 0),
      Float32Array.from(
        ids.flatMap(i => (i < b.indices.length ? Array.from(b.anchors.subarray(i * 3, i * 3 + 3)) : [0, 0, 0]))
      ),
      Float32Array.from(
        ids.flatMap(i =>
          i < b.indices.length ? Array.from(b.restFrames.subarray(i * 6, i * 6 + 6)) : [0, 0, 0, 0, 0, 0]
        )
      )
    );
  }
  function join(parts) {
    if (!parts.some(w => w.engraving)) return;
    const settings = [],
      keys = new Map(),
      count = parts.reduce((n, p) => n + p.count, 0),
      indices = new Uint16Array(count),
      anchors = new Float32Array(count * 3),
      restFrames = new Float32Array(count * 6);
    let offset = 0;
    for (const w of parts) {
      const b = validate(w);
      if (b) {
        const remap = b.styles.map(s => {
          const key = JSON.stringify(s);
          if (!keys.has(key)) {
            if (settings.length >= maxStyles) throw new RangeError('Engraving: exceeds 16 joined styles');
            keys.set(key, settings.push(s));
          }
          return keys.get(key);
        });
        b.indices.forEach((id, i) => (indices[offset + i] = id ? remap[id - 1] : 0));
        anchors.set(b.anchors, offset * 3);
        restFrames.set(b.restFrames, offset * 6);
      }
      offset += w.count;
    }
    return layout(count, settings, indices, anchors, restFrames);
  }
  return Object.freeze({
    styles,
    print: Print,
    maxStyles,
    tones,
    prepare,
    maps,
    sample,
    coordinates,
    shade,
    light: value => unit(xyz(value, 'light')),
    layout,
    validate,
    bind,
    bindMany,
    update,
    subset,
    join
  });
})();
if (typeof module !== 'undefined') module.exports = Engraving;
