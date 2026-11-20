/* Seeded iterated function systems with independent geometry, color and density. */
(function (K) {
  const P = K.procedural, clamp = K.clamp,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    finite = (n, max) => Number.isFinite(n) && Math.abs(n) <= max,
    unit = n => finite(n, 1) && n >= 0,
    empty = Object.freeze({ mass: 0, density: 0, color: null });

  function tuple(value, size, limit) {
    if (!Array.isArray(value) || value.length !== size || !Array.from(value).every(n => finite(n, limit)))
      throw new RangeError('Expected a finite IFS coordinate or matrix');
    return value.slice();
  }

  const variations = {
    linear: (x, y, z) => [x, y, z],
    sinusoidal: (x, y, z) => [Math.sin(x), Math.sin(y), Math.sin(z)],
    spherical(x, y, z) {
      const r = x * x + y * y + z * z || 1;
      return [x / r, y / r, z / r];
    },
    swirl(x, y, z) {
      const r = x * x + y * y, s = Math.sin(r), c = Math.cos(r);
      return [x * s - y * c, x * c + y * s, z];
    },
    horseshoe(x, y, z) {
      const r = Math.hypot(x, y) || 1;
      return [(x - y) * (x + y) / r, 2 * x * y / r, z];
    },
    polar: (x, y, z) => [Math.atan2(y, x) / Math.PI, Math.hypot(x, y) - 1, z],
    bubble(x, y, z) {
      const q = 4 / (4 + x * x + y * y + z * z);
      return [x * q, y * q, z * q];
    }
  };

  function affine(dimension, spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Expected an IFS transform');
    const { matrix, offset } = spec;
    const t = offset === undefined ? Array(dimension).fill(0) : tuple(offset, dimension, 1e4);
    if (matrix === undefined && offset === undefined) return (x, y, z) => [x, y, z];
    const m = matrix === undefined
      ? Array.from({ length: dimension ** 2 }, (_, i) => Number(i % (dimension + 1) === 0))
      : tuple(matrix, dimension ** 2, 1e4);
    if (dimension === 2) return (x, y) => [m[0] * x + m[1] * y + t[0], m[2] * x + m[3] * y + t[1], 0];
    return (x, y, z) => [
      m[0] * x + m[1] * y + m[2] * z + t[0],
      m[3] * x + m[4] * y + m[5] * z + t[1],
      m[6] * x + m[7] * y + m[8] * z + t[2]
    ];
  }

  function mapping(dimension, spec) {
    const first = affine(dimension, spec), list = spec.variations,
      post = spec.post === undefined ? null : affine(dimension, spec.post);
    if (list === undefined) return post ? (x, y, z) => post(...first(x, y, z)) : first;
    if (!Array.isArray(list) || !integer(list.length, 1, 16))
      throw new RangeError('A flame transform takes 1–16 weighted variations');
    const terms = Array.from(list, row => {
      const type = row?.type, weight = row?.weight ?? 1;
      if (typeof type !== 'string' || !Object.hasOwn(variations, type) || !finite(weight, 8))
        throw new RangeError('Unknown flame variation or invalid weight');
      return { apply: variations[type], weight };
    }).filter(term => term.weight !== 0);
    return (x, y, z) => {
      const [u, v, w] = first(x, y, z);
      let a = 0, b = 0, c = 0;
      for (const { apply, weight } of terms) {
        const q = apply(u, v, w);
        a += q[0] * weight;
        b += q[1] * weight;
        c += q[2] * weight;
      }
      return post ? post(a, b, c) : [a, b, c];
    };
  }

  function compile({ dimension = 2, transforms, final } = {}) {
    if (![2, 3].includes(dimension) || !Array.isArray(transforms) || !integer(transforms.length, 1, 64))
      throw new RangeError('Iterated systems need 2 or 3 dimensions and 1–64 transforms');
    const branches = Array.from(transforms, (spec, index) => {
      const apply = mapping(dimension, spec), weight = spec.weight ?? 1,
        color = spec.color ?? (transforms.length === 1 ? .5 : index / (transforms.length - 1)),
        colorMix = spec.colorMix ?? .5;
      if (!finite(weight, 1e6) || weight < 0 || !unit(color) || !unit(colorMix))
        throw new RangeError('IFS transforms need a nonnegative probability weight and color controls in [0, 1]');
      return { apply, weight, color, colorMix };
    });
    const scale = Math.max(...branches.map(branch => branch.weight));
    if (!scale) throw new RangeError('At least one IFS transform needs a positive probability weight');
    let weightSum = 0;
    for (const branch of branches) {
      weightSum += branch.weight / scale;
      branch.upper = weightSum;
    }
    const project = final === undefined ? null : mapping(dimension, final);

    function settings({ count = 100000, seed = 1, burnIn = 32, start = Array(dimension).fill(0), escape = 1e4 } = {}) {
      if (!integer(count, 1, 2000000) || !Number.isSafeInteger(seed) || !integer(burnIn, 0, 4096) ||
          !finite(escape, 1e7) || escape <= 0)
        throw new RangeError('Invalid IFS point budget, seed, warm-up or escape limit');
      return { count, seed, burnIn, initial: tuple(start, dimension, escape), escape };
    }

    function run({ count, seed, burnIn, initial, escape }, emit) {
      const random = mulberry32(seed >>> 0), [sx, sy, sz = 0] = initial;
      let x = sx, y = sy, z = sz, color = .5, warm = burnIn, written = 0, restarts = 0;
      const valid = p => finite(p[0], escape) && finite(p[1], escape) && finite(p[2], escape);
      for (let i = 0; i < count + burnIn; i++) {
        const roll = random() * weightSum;
        let index = 0;
        while (index + 1 < branches.length && roll >= branches[index].upper) index++;
        const { apply, color: target, colorMix } = branches[index], mapped = apply(x, y, z);
        if (!valid(mapped)) {
          restarts++;
          x = sx; y = sy; z = sz; color = .5; warm = burnIn;
          continue;
        }
        [x, y, z] = mapped;
        color += (target - color) * colorMix;
        if (warm) { warm--; continue; }
        const p = project ? project(x, y, z) : mapped;
        if (!valid(p)) continue;
        emit(p[0], p[1], p[2], color, index, written++);
      }
      return { attempts: count, count: written, restarts, discarded: count - written };
    }

    function points(options) {
      const limits = settings(options), positions = new Float32Array(limits.count * dimension),
        colors = new Float32Array(limits.count), branches = new Uint8Array(limits.count);
      const stats = run(limits, (x, y, z, color, branch, i) => {
        const at = i * dimension;
        positions[at] = x;
        positions[at + 1] = y;
        if (dimension === 3) positions[at + 2] = z;
        colors[i] = color;
        branches[i] = branch;
      });
      return Object.freeze({ ...stats, dimension, positions: positions.subarray(0, stats.count * dimension),
        colors: colors.subarray(0, stats.count), branches: branches.subarray(0, stats.count) });
    }

    function density({ bounds, resolution = dimension === 2 ? [256, 256] : [64, 64, 64], exposure = 1, ...options } = {}) {
      const limits = settings(options), lo = tuple(bounds?.min, dimension, 1e7), hi = tuple(bounds?.max, dimension, 1e7);
      const res = typeof resolution === 'number' ? Array(dimension).fill(resolution) : resolution;
      if (!Array.isArray(res) || res.length !== dimension || !Array.from(res).every(n => integer(n, 1, 512)) ||
          res.reduce((a, b) => a * b, 1) > 2000000 || !finite(exposure, 1e6) || exposure < 0 ||
          lo.some((v, i) => hi[i] - v < 1e-8))
        throw new RangeError('IFS density needs ordered bounds, a bounded resolution and nonnegative exposure');

      const [nx, ny, nz = 1] = res, count = nx * ny * nz, xy = nx * ny,
        size = lo.map((v, i) => (hi[i] - v) / res[i]), [dx, dy, dz = 1] = size,
        [x0, y0, z0 = 0] = lo, [x1, y1, z1 = 0] = hi,
        weights = new Uint32Array(count), tones = new Float64Array(count);
      let clipped = 0, peak = 0;
      const within = (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && (dimension === 2 || (z >= z0 && z <= z1));
      const stats = run(limits, (x, y, z, color) => {
        if (!within(x, y, z)) { clipped++; return; }
        const i = Math.min(nx - 1, Math.floor((x - x0) / dx)),
          j = Math.min(ny - 1, Math.floor((y - y0) / dy)),
          k = dimension === 2 ? 0 : Math.min(nz - 1, Math.floor((z - z0) / dz)),
          at = i + nx * j + xy * k;
        peak = Math.max(peak, ++weights[at]);
        tones[at] += color;
      });

      const displayMax = exposure ? Math.log1p(exposure * peak) : peak;
      const display = mass => displayMax ? (exposure ? Math.log1p(exposure * mass) : mass) / displayMax : 0;
      function probe(x, y, z, withColor) {
        if (!within(x, y, z)) return withColor ? empty : 0;
        const u = clamp((x - x0) / dx - .5, 0, nx - 1), v = clamp((y - y0) / dy - .5, 0, ny - 1),
          w = dimension === 2 ? 0 : clamp((z - z0) / dz - .5, 0, nz - 1),
          i = Math.floor(u), j = Math.floor(v), k = Math.floor(w), at = i + nx * j + xy * k,
          e = i + 1 < nx ? 1 : 0, n = j + 1 < ny ? nx : 0, h = k + 1 < nz ? xy : 0,
          a = u - i, b = v - j, c = w - k;
        function value(data) {
          const north = data[at] + (data[at + e] - data[at]) * a,
            south = data[at + n] + (data[at + n + e] - data[at + n]) * a,
            bottom = north + (south - north) * b;
          if (!c) return bottom;
          const upperNorth = data[at + h] + (data[at + h + e] - data[at + h]) * a,
            upperSouth = data[at + h + n] + (data[at + h + n + e] - data[at + h + n]) * a;
          return bottom + (upperNorth + (upperSouth - upperNorth) * b - bottom) * c;
        }
        const mass = value(weights);
        if (!mass) return withColor ? empty : 0;
        const density = display(mass);
        return withColor ? { mass, density, color: clamp(value(tones) / mass, 0, 1) } : density;
      }
      function bin(i, j, k = 0) {
        if (!integer(i, 0, nx - 1) || !integer(j, 0, ny - 1) || !integer(k, 0, nz - 1))
          throw new RangeError('IFS density bin is outside the grid');
        const at = i + nx * j + xy * k, mass = weights[at];
        return mass ? { mass, density: display(mass), color: clamp(tones[at] / mass, 0, 1) } : empty;
      }
      return Object.freeze({ ...stats, clipped, deposited: stats.count - clipped, peak, dimension, bounds: P.data.freeze({ min: lo, max: hi }),
        resolution: Object.freeze(res.slice()), cellSize: Object.freeze(size), bin,
        at: (x, y, z = 0) => probe(x, y, z, true), sample: (x, y, z = 0) => probe(x, y, z, false) });
    }

    return Object.freeze({ dimension, points, density });
  }

  function gasket(vertices) {
    const dimension = vertices[0].length;
    return { dimension, transforms: vertices.map(vertex => ({
      matrix: Array.from({ length: dimension ** 2 }, (_, i) => i % (dimension + 1) === 0 ? .5 : 0),
      offset: vertex.map(v => v * .5)
    })) };
  }

  const presets = P.data.freeze({
    barnsley: { transforms: [
      { matrix: [0, 0, 0, .16], weight: 1, color: .06 },
      { matrix: [.85, .04, -.04, .85], offset: [0, 1.6], weight: 85, color: .68 },
      { matrix: [.2, -.26, .23, .22], offset: [0, 1.6], weight: 7, color: .93 },
      { matrix: [-.15, .28, .26, .24], offset: [0, .44], weight: 7, color: .34 }
    ] },
    sierpinski: gasket([[-1, 0], [1, 0], [0, Math.sqrt(3)]]),
    tetrahedron: gasket([[-1, -.65, -1 / Math.sqrt(3)], [1, -.65, -1 / Math.sqrt(3)],
      [0, -.65, 2 / Math.sqrt(3)], [0, -.65 + Math.sqrt(8 / 3), 0]])
  });

  function preset(name) {
    if (typeof name !== 'string' || !Object.hasOwn(presets, name)) throw new RangeError('Unknown IFS preset');
    return compile(presets[name]);
  }

  P.ifs = Object.freeze({ compile, preset, presets, variations: Object.freeze(Object.keys(variations)) });
})(KIT);
