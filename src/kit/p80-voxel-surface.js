/* Optional tangible blocks sampled from the existing signed-distance core. */
(function (K) {
  const { V, M } = K,
    freeze = K.procedural.data.freeze,
    known = new WeakSet(),
    faceLimit = 250000;
  const fail = message => {
    throw new RangeError('Voxel surface: ' + message);
  };
  const vec = p =>
    Array.isArray(p) && p.length === 3 && Array.from(p).every(x => Number.isFinite(x) && Math.abs(x) <= 1e6);
  const latticeIndex = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isSafeInteger);
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const budget = (n, max, label) => {
    if (!integer(n, 1, max)) fail('invalid ' + label + ' budget');
    return n;
  };
  const matrix = a => M.mul(M.rot([0, 0, 1], a[2]), M.mul(M.rot([0, 1, 0], a[1]), M.rot([1, 0, 0], a[0])));
  const axes = axis => [(axis + 1) % 3, (axis + 2) % 3];
  const key = p => p.join('/');
  // Greedy rectangles are deterministic and preserve apertures and partial occlusion.
  function rectangles(mask, w, h, emit) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!mask[x + y * w]) continue;
        let dx = 1,
          dy = 1;
        while (x + dx < w && mask[x + dx + y * w]) dx++;
        outer: while (y + dy < h) {
          for (let u = 0; u < dx; u++) if (!mask[x + u + (y + dy) * w]) break outer;
          dy++;
        }
        for (let v = 0; v < dy; v++) mask.fill(0, x + (y + v) * w, x + dx + (y + v) * w);
        emit(x, y, dx, dy);
      }
  }
  function validateGrid(grid) {
    if (
      !grid ||
      !vec(grid.origin) ||
      !vec(grid.orientation) ||
      !vec(grid.size) ||
      grid.size.some(n => n < 0.001 || n > 1e4) ||
      !latticeIndex(grid.min) ||
      !latticeIndex(grid.dims) ||
      !grid.dims.every((n, k) => integer(n, 1, 2000000) && Number.isSafeInteger(grid.min[k] + n)) ||
      grid.dims.reduce((a, b) => a * b, 1) > 2000000
    ) fail('invalid block grid');
  }
  function compile(grid, input, { mode = 'cubes', closed = false, gap = 0, maxFaces = 180000, samples = 0 } = {}) {
    budget(maxFaces, faceLimit, 'face');
    validateGrid(grid);
    if (
      !Array.isArray(input) ||
      input.length > 100000 ||
      !['cubes', 'columns', 'slabs', 'relief'].includes(mode) ||
      typeof closed !== 'boolean' ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      gap > 0.8
    )
      fail('invalid block plan');
    const R = matrix(grid.orientation),
      dims = grid.dims,
      stride = [1, dims[0], dims[0] * dims[1]],
      occupancy = new Int32Array(dims.reduce((a, b) => a * b, 1)).fill(-1);
    const offset = p => p.reduce((s, n, k) => s + n * stride[k], 0),
      inside = p => p.every((n, k) => n >= 0 && n < dims[k]);
    const point = p =>
      V.add(
        grid.origin,
        M.app(
          R,
          p.map((n, k) => (n + grid.min[k]) * grid.size[k])
        )
      );
    if (!integer(samples, 0, occupancy.length)) fail('invalid sample count');
    const ids = new Set(),
      blocks = Array.from(input, (b, i) => {
        if (
          !b ||
          typeof b.id !== 'string' ||
          !b.id.length ||
          b.id.length > 180 ||
          ids.has(b.id) ||
          !vec(b.index) ||
          !vec(b.span) ||
          !b.index.every((n, k) => integer(n, 0, dims[k] - 1)) ||
          !b.span.every((n, k) => integer(n, 1, dims[k] - b.index[k]))
        )
          fail('invalid or overlapping block');
        ids.add(b.id);
        for (let z = b.index[2]; z < b.index[2] + b.span[2]; z++)
          for (let y = b.index[1]; y < b.index[1] + b.span[1]; y++)
            for (let x = b.index[0]; x < b.index[0] + b.span[0]; x++) {
              const at = offset([x, y, z]);
              if (occupancy[at] !== -1) fail('overlapping blocks');
              occupancy[at] = i;
            }
        return {
          id: b.id,
          index: b.index.slice(),
          span: b.span.slice(),
          center: point(b.index.map((n, k) => n + b.span[k] / 2)),
          half: b.span.map((n, k) => ((n - gap) * grid.size[k]) / 2)
        };
      });
    const faces = [],
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const [bi, b] of blocks.entries())
      for (let axis = 0; axis < 3; axis++)
        for (const side of [-1, 1]) {
          const [u, v] = axes(axis),
            w = b.span[u],
            h = b.span[v],
            mask = new Uint8Array(w * h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const p = b.index.slice();
              p[u] += x;
              p[v] += y;
              p[axis] += side > 0 ? b.span[axis] : -1;
              mask[x + y * w] = closed || gap > 0 || !inside(p) || occupancy[offset(p)] === -1 ? 1 : 0;
            }
          rectangles(mask, w, h, (x, y, dx, dy) => {
            if (faces.length >= maxFaces) fail('face budget exceeded');
            const a = b.index.slice();
            a[u] += x;
            a[v] += y;
            a[axis] += side > 0 ? b.span[axis] - gap / 2 : gap / 2;
            const loU = x === 0 ? gap / 2 : 0,
              loV = y === 0 ? gap / 2 : 0,
              hiU = x + dx === w ? gap / 2 : 0,
              hiV = y + dy === h ? gap / 2 : 0;
            a[u] += loU;
            a[v] += loV;
            const c = a.slice(),
              d = a.slice(),
              e = a.slice();
            c[u] += dx - loU - hiU;
            d[u] += dx - loU - hiU;
            d[v] += dy - loV - hiV;
            e[v] += dy - loV - hiV;
            const points = (side > 0 ? [a, c, d, e] : [a, e, d, c]).map(point),
              n = [0, 0, 0];
            n[axis] = side;
            for (const p of points) {
              if (!vec(p)) fail('face exceeds the native surface coordinate range');
              for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], p[k]);
                max[k] = Math.max(max[k], p[k]);
              }
            }
            faces.push({ block: bi, normal: M.app(R, n), points });
          });
        }
    const plan = freeze({
      format: 'ink-studio/voxel-surface',
      version: 1,
      mode,
      closed,
      gap,
      grid,
      blocks,
      faces,
      bounds: faces.length ? { min, max } : null,
      stats: { cells: occupancy.length, samples, blocks: blocks.length, faces: faces.length, splats: faces.length * 2 }
    });
    known.add(plan);
    return plan;
  }
  function validate(plan) {
    if (known.has(plan)) return plan;
    if (!plan || plan.format !== 'ink-studio/voxel-surface' || plan.version !== 1) fail('expected a voxel surface');
    return compile(plan.grid, plan.blocks, {
      mode: plan.mode,
      closed: plan.closed,
      gap: plan.gap,
      maxFaces: faceLimit,
      samples: plan.stats?.samples
    });
  }
  function fromSdf(
    source,
    {
      bounds,
      size = 0.2,
      mode = 'cubes',
      axis = 1,
      side = 1,
      thickness = 0.12,
      orientation = [0, 0, 0],
      origin = [0, 0, 0],
      iso = 0,
      closed = false,
      gap = 0,
      maxCells = 200000,
      maxSamples = 200000,
      maxBlocks = 30000,
      maxFaces = 180000
    } = {}
  ) {
    budget(maxCells, 2000000, 'cell');
    budget(maxSamples, 2000000, 'sample');
    budget(maxBlocks, 100000, 'block');
    budget(maxFaces, faceLimit, 'face');
    if (typeof source !== 'function' && typeof source?.sd !== 'function')
      fail('expected a distance function or held SDF');
    const sample = typeof source === 'function' ? source : (x, y, z) => source.sd(x, y, z);
    if (
      !bounds ||
      !vec(bounds.min) ||
      !vec(bounds.max) ||
      bounds.min.some((n, k) => n >= bounds.max[k]) ||
      !vec(origin) ||
      !vec(orientation) ||
      !Number.isFinite(iso) ||
      !integer(axis, 0, 2) ||
      ![-1, 1].includes(side) ||
      !Number.isFinite(thickness) ||
      thickness < 0.001 ||
      thickness > 1e4 ||
      !['cubes', 'columns', 'slabs', 'relief'].includes(mode) ||
      typeof closed !== 'boolean' ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      gap > 0.8
    )
      fail('invalid sampling options');
    size = typeof size === 'number' ? [size, size, size] : size;
    if (!vec(size) || size.some(n => n < 0.001 || n > 1e4)) fail('invalid cell size');
    const R = matrix(orientation),
      inverse = M.tr(R),
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const p = M.app(
        inverse,
        V.sub(
          [0, 1, 2].map(k => bounds[i & (1 << k) ? 'max' : 'min'][k]),
          origin
        )
      );
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k] / size[k]);
        hi[k] = Math.max(hi[k], p[k] / size[k]);
      }
    }
    const min = lo.map(Math.floor),
      dims = hi.map((n, k) => Math.ceil(n) - min[k]),
      cells = dims.reduce((a, b) => a * b, 1);
    if (!Number.isSafeInteger(cells) || cells > maxCells || cells > maxSamples)
      fail('cell/sample budget exceeded before sampling');
    const stride = [1, dims[0], dims[0] * dims[1]],
      offset = p => p.reduce((s, n, k) => s + n * stride[k], 0),
      occupied = new Uint8Array(cells);
    let samples = 0;
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++) {
          const p = [x, y, z],
            world = V.add(
              origin,
              M.app(
                R,
                p.map((n, k) => (n + min[k] + 0.5) * size[k])
              )
            );
          if (world.some((n, k) => n < bounds.min[k] || n > bounds.max[k])) continue;
          const d = sample(...world);
          samples++;
          if (!Number.isFinite(d)) fail('distance sample must be finite');
          occupied[offset(p)] = d <= iso ? 1 : 0;
        }
    return fromMask(occupied, { min, dims, size, origin, orientation },
      { mode, axis, side, thickness, closed, gap, maxBlocks, maxFaces, samples });
  }
  function fromMask(occupied, grid, {
    mode = 'cubes', axis = 1, side = 1, thickness = 0.12, closed = false, gap = 0,
    maxBlocks = 30000, maxFaces = 180000, samples = 0
  } = {}) {
    validateGrid(grid);
    budget(maxBlocks, 100000, 'block');
    const { min, dims, size } = grid, count = dims[0] * dims[1] * dims[2];
    if (!(occupied instanceof Uint8Array) || occupied.length !== count || occupied.some(n => n > 1) ||
        !['cubes', 'columns', 'slabs', 'relief'].includes(mode) || !integer(axis, 0, 2) ||
        ![-1, 1].includes(side) || !Number.isFinite(thickness) || thickness < 0.001 || thickness > 1e4)
      fail('invalid voxel mask or block options');
    const offset = p => p[0] + dims[0] * (p[1] + dims[1] * p[2]);
    const blocks = [],
      append = (index, span) => {
        if (blocks.length >= maxBlocks) fail('block budget exceeded');
        blocks.push({ id: key(index.map((n, k) => n + min[k])) + ':' + key(span), index, span });
      };
    if (mode === 'cubes') {
      for (let z = 0; z < dims[2]; z++)
        for (let y = 0; y < dims[1]; y++)
          for (let x = 0; x < dims[0]; x++) if (occupied[offset([x, y, z])]) append([x, y, z], [1, 1, 1]);
    } else {
      const [u, v] = axes(axis);
      if (mode === 'columns' || mode === 'relief') {
        for (let j = 0; j < dims[v]; j++)
          for (let i = 0; i < dims[u]; i++) {
            const p = [0, 0, 0];
            p[u] = i;
            p[v] = j;
            if (mode === 'relief') {
              for (let d = 0; d < dims[axis]; d++) {
                p[axis] = side > 0 ? dims[axis] - 1 - d : d;
                if (occupied[offset(p)]) {
                  const span = [1, 1, 1],
                    depth = Math.min(
                      Math.max(1, Math.ceil(thickness / size[axis])),
                      side > 0 ? p[axis] + 1 : dims[axis] - p[axis]
                    );
                  span[axis] = depth;
                  if (side > 0) p[axis] -= depth - 1;
                  append(p.slice(), span);
                  break;
                }
              }
            } else
              for (let d = 0; d < dims[axis]; d++) {
                p[axis] = d;
                if (!occupied[offset(p)]) continue;
                const start = d;
                while (d + 1 < dims[axis]) {
                  p[axis] = d + 1;
                  if (!occupied[offset(p)]) break;
                  d++;
                }
                p[axis] = start;
                const span = [1, 1, 1];
                span[axis] = d - start + 1;
                append(p.slice(), span);
              }
          }
      } else
        for (let d = 0; d < dims[axis]; d++) {
          const mask = new Uint8Array(dims[u] * dims[v]);
          for (let j = 0; j < dims[v]; j++)
            for (let i = 0; i < dims[u]; i++) {
              const p = [0, 0, 0];
              p[axis] = d;
              p[u] = i;
              p[v] = j;
              mask[i + j * dims[u]] = occupied[offset(p)];
            }
          rectangles(mask, dims[u], dims[v], (i, j, w, h) => {
            const p = [0, 0, 0],
              span = [1, 1, 1];
            p[axis] = d;
            p[u] = i;
            p[v] = j;
            span[u] = w;
            span[v] = h;
            append(p, span);
          });
        }
    }
    return compile(
      { min: min.slice(), dims: dims.slice(), size: size.slice(), origin: grid.origin.slice(), orientation: grid.orientation.slice() },
      blocks,
      { mode, closed, gap, maxFaces, samples }
    );
  }
  function facets(plan) {
    const vertices = [],
      triangles = [];
    for (const f of plan.faces) {
      const n = vertices.length;
      vertices.push(...f.points);
      triangles.push([n, n + 1, n + 2], [n, n + 2, n + 3]);
    }
    return K.facets.fromMesh({ points: vertices, faces: triangles }, { maxFacets: faceLimit * 2, maxVertices: faceLimit * 4 });
  }
  function paint(plan, options) {
    const { color, grouping, ...rest } = options;
    if (grouping !== undefined && grouping !== 'block' && grouping !== 'normal') fail('grouping is block or normal');
    return {
      ...rest,
      object: options.object ?? 'voxel-surface',
      material: options.material ?? 'block-surface',
      grouping: grouping === 'normal' ? 'normal' : f => plan.blocks[plan.faces[Math.floor(Number(f.id) / 2)].block].id,
      ...(color !== undefined && {
        color:
          typeof color === 'function'
            ? f => {
                const face = plan.faces[Math.floor(Number(f.id) / 2)];
                return color(plan.blocks[face.block], face);
              }
            : color
      })
    };
  }
  function draw(B, input, options = {}) {
    const plan = validate(input),
      batch = K.facets.draw(B, facets(plan), paint(plan, options)),
      ranges = plan.blocks.map(b => ({ id: b.id, center: b.center, half: b.half, ids: [] }));
    plan.faces.forEach((f, k) => ranges[f.block].ids.push(batch.first + k * 2, batch.first + k * 2 + 1));
    return {
      first: batch.first,
      end: batch.end,
      ids: batch.ids,
      closed: plan.closed || plan.gap > 0,
      blocks: ranges,
      stats: plan.stats
    };
  }
  function requireClosed(batch) {
    if (!batch?.closed || !Array.isArray(batch.blocks)) fail('independent blocks require closed:true (or gap>0)');
  }
  function groups(batch, { prefix = 'block', ...options } = {}) {
    requireClosed(batch);
    if (typeof prefix !== 'string' || !prefix.length || prefix.length > 60) fail('invalid block group prefix');
    if (Object.hasOwn(options, 'id') || Object.hasOwn(options, 'ids') || Object.hasOwn(options, 'selector'))
      fail('group identity is supplied by block ranges');
    return batch.blocks
      .filter(b => b.ids.length)
      .map(b => ({ ...options, id: prefix + '/' + b.id, ids: b.ids.slice() }));
  }
  function bind(world, batch, { pose } = {}) {
    if (typeof pose !== 'function') fail('a block pose callback is required');
    requireClosed(batch);
    if (!batch.blocks.length || batch.blocks.length > 65535) fail('block rigs need 1 to 65535 blocks');
    const ids = [],
      bid = [],
      matrices = new Float32Array(batch.blocks.length * 12);
    batch.blocks.forEach((b, k) => {
      for (const id of b.ids) {
        ids.push(id);
        bid.push(k);
      }
    });
    const rig = K.bones.bind(world, {
      ids,
      bid: Float32Array.from(bid),
      M: matrices,
      pose(time) {
        batch.blocks.forEach((block, k) => {
          const t = pose(block, time, k) ?? {},
            R = t.rotation ?? M.id(),
            scale = t.scale ?? 1,
            translation = t.translation ?? [0, 0, 0];
          if (!Array.isArray(R) && !ArrayBuffer.isView(R)) fail('invalid block rotation');
          if (
            R.length !== 9 ||
            !Array.from(R).every(Number.isFinite) ||
            !vec(translation) ||
            !Number.isFinite(scale) ||
            scale < 0.001 ||
            scale > 100
          )
            fail('invalid block transform');
          const A = Array.from(R, n => n * scale),
            p = V.sub(V.add(block.center, translation), M.app(A, block.center));
          matrices.set([...A, ...p], k * 12);
        });
      }
    });
    return rig;
  }
  K.voxelSurface = Object.freeze({
    fromSdf,
    fromMask,
    draw,
    toMesh: (input, options = {}) => {
      const p = validate(input);
      return K.facets.toMesh(facets(p), paint(p, options));
    },
    world(input, options = {}) {
      const { appearance = {}, background = '#101e2c', camera, ...settings } = options;
      if (typeof background !== 'string' || !/^#[\da-f]{6}$/i.test(background)) fail('expected #RRGGBB background');
      const B = makeBuilder(1, [parseInt(background.slice(1), 16), 0xffffff]);
      draw(B, input, appearance);
      return B.finish({
        radius: 100,
        dither: 0,
        fog: { c: 0, start: 1, max: 0 },
        look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' },
        ...(camera && { cam: camera }),
        ...settings
      });
    },
    groups,
    bind
  });
})(KIT);
