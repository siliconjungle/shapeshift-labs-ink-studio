// Fit an editable, object-local volume to silhouettes on approved art grids.
(function (K) {
  const format = 'ink-studio/turntable-shape', maxCells = 500000, maxPixels = 262144, maxViews = 12;
  const fail = message => { throw new RangeError('Turntable shape: ' + message); };
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const vector = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(n => Number.isFinite(n) && Math.abs(n) <= 1e5);
  const product = dims => dims.reduce((total, n) => total * n, 1);
  const axes = [0, 1, 2];
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
  const name = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
  const viewport = camera => integer(camera?.width, 8, 1024) && integer(camera.height, 8, 1024) &&
    camera.width * camera.height <= maxPixels;

  function validateGrid(grid) {
    if (!vector(grid?.min) || !Array.isArray(grid.dims) || grid.dims.length !== 3 ||
        !Array.from(grid.dims).every(n => integer(n, 1, 256)) || product(grid.dims) > maxCells ||
        !Number.isFinite(grid.cell) || grid.cell < 0.001 || grid.cell > 1000) fail('invalid voxel grid');
    return grid;
  }

  function cells(grid, visit) {
    const { min, dims: [nx, ny, nz], cell } = grid;
    let index = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, index++) {
      visit(index, min[0] + (x + 0.5) * cell, min[1] + (y + 0.5) * cell, min[2] + (z + 0.5) * cell);
    }
  }

  function pack(grid, mask) {
    const runs = [];
    for (let i = 0; i < mask.length;) {
      if (!mask[i]) { i++; continue; }
      const start = i++;
      while (mask[i]) i++;
      runs.push(start, i - start);
    }
    return { format, version: 1, grid: { min: grid.min.slice(), dims: grid.dims.slice(), cell: grid.cell }, runs };
  }

  function unpack(shape) {
    if (shape?.format !== format || shape.version !== 1) fail('expected a saved turntable shape');
    const grid = validateGrid(shape.grid), count = product(grid.dims), { runs } = shape;
    if (!Array.isArray(runs) || !runs.length || runs.length % 2 || runs.length > count + 1)
      fail('invalid occupied runs');
    const mask = new Uint8Array(count);
    let previousEnd = -1;
    for (let i = 0; i < runs.length; i += 2) {
      const start = runs[i], length = runs[i + 1], end = start + length;
      if (!integer(start, 0, count - 1) || !integer(length, 1, count) || start <= previousEnd || end > count)
        fail('invalid occupied runs');
      mask.fill(1, start, end);
      previousEnd = end;
    }
    return { grid, mask };
  }

  function fromSdf(distance, { bounds, cell = 0.08 } = {}) {
    if (typeof distance !== 'function' || !vector(bounds?.min) || !vector(bounds.max) ||
        bounds.min.some((n, k) => n >= bounds.max[k])) fail('expected a distance function and finite growing bounds');
    const grid = validateGrid({
      min: bounds.min, dims: bounds.max.map((n, i) => Math.ceil((n - bounds.min[i]) / cell - 1e-10)), cell
    });
    const mask = new Uint8Array(product(grid.dims));
    cells(grid, (i, x, y, z) => {
      const value = distance(x, y, z);
      if (!Number.isFinite(value)) fail('distance samples must be finite');
      mask[i] = value <= 0 ? 1 : 0;
    });
    const shape = pack(grid, mask);
    if (!shape.runs.length) fail('source does not occupy a voxel at this resolution');
    return shape;
  }

  function checkCamera(camera) {
    if (!viewport(camera) || !vector(camera.target) ||
        !Number.isFinite(camera.yaw) || !Number.isFinite(camera.pitch) || Math.abs(camera.pitch) > Math.PI / 2 ||
        !Number.isFinite(camera.scale) || camera.scale <= 0 || camera.scale > 1e6) fail('invalid orthographic view');
    return camera;
  }

  function camera(shape, { width = 96, height = 96, yaw = 0, pitch = 0 } = {}) {
    if (shape?.format !== format || shape.version !== 1) fail('expected a saved turntable shape');
    const { min, dims, cell } = validateGrid(shape.grid);
    const target = min.map((n, i) => n + dims[i] * cell / 2);
    const diameter = Math.hypot(...dims) * cell;
    // Keep voxel centers denser than the native art grid so thin shapes do not develop pinholes.
    const scale = Math.min(Math.min(width, height) * 0.92 / diameter, 0.85 / cell);
    return checkCamera({ target, width, height, yaw, pitch, scale });
  }

  function projector(camera) {
    checkCamera(camera);
    const { target, yaw, pitch, scale, width, height } = camera;
    const { right, up, back } = CameraLens.orbitPose(yaw, pitch, 1, target);
    function pixel(x, y, z) {
      x -= target[0]; y -= target[1]; z -= target[2];
      const u = Math.floor(width * 0.5 + scale * (right[0] * x + right[2] * z));
      const v = Math.floor(height * 0.5 - scale * (up[0] * x + up[1] * y + up[2] * z));
      return u < 0 || u >= width || v < 0 || v >= height ? -1 : u + v * width;
    }
    return { pixel, back };
  }

  function projection(grid, mask, camera) {
    const { pixel } = projector(camera), image = new Uint8Array(camera.width * camera.height);
    cells(grid, (i, x, y, z) => {
      if (!mask[i]) return;
      const j = pixel(x, y, z);
      if (j >= 0) image[j] = 1;
    });
    return image;
  }

  function perspective(camera) {
    const { view, width, height, tangent, clipNear, clipFar } = camera ?? {};
    if (!viewport(camera) || camera.ortho !== false || !list(view) || view.length !== 16 ||
        ![3, 7, 11].every(i => Math.abs(view[i]) <= 1e-8) || Math.abs(view[15] - 1) > 1e-8 ||
        !Number.isFinite(tangent) || tangent <= 0 || tangent > 1e3 ||
        !Number.isFinite(clipNear) || clipNear <= 0 || !Number.isFinite(clipFar) || clipFar <= clipNear)
      fail('expected a native perspective camera grid with a rigid view, lens, viewport and clip planes');
    const pose = CameraLens.fromView(view);
    if (!vector(pose.eye)) fail('camera eye exceeds the coordinate budget');
    return { width, height, view: Array.from(view), tangent, ortho: false, clipNear, clipFar };
  }

  function perspectiveCamera(camera, placement) {
    camera = perspective(camera);
    if (placement === undefined) return camera;
    const { position = [0, 0, 0], matrix = K.M.id() } = placement;
    if (!vector(position) || !list(matrix) || matrix.length !== 9 || !Array.from(matrix).every(Number.isFinite))
      fail('part placement needs a position and a rigid 3×3 matrix');
    const inverse = K.M.tr(matrix), local = p => K.M.app(inverse, p);
    const { eye, right, up, back } = CameraLens.fromView(camera.view);
    return perspective({ ...camera, view: CameraLens.matrix({
      eye: local(K.V.sub(eye, position)), right: local(right), up: local(up), back: local(back)
    }) });
  }

  function depthSettings(camera, { occluderDepth, depthBias = 0 } = {}) {
    if (!Number.isFinite(depthBias) || depthBias < 0 || depthBias > camera.clipFar ||
        occluderDepth !== undefined && (!list(occluderDepth) ||
          occluderDepth.length !== camera.width * camera.height ||
          !Array.from(occluderDepth).every(n => n === null || n === Infinity || Number.isFinite(n) && n > 0)))
      fail('occluder depth needs one positive axial depth or null per native pixel and a nonnegative bias');
    return { occluderDepth, depthBias };
  }

  // All distances on the ray are axial scene depths. Visit each positive-length
  // voxel interval once, advancing every tied axis at an edge or corner.
  function voxelRays(grid, camera, budget) {
    const { dims, min, cell } = grid, { view, width, height, tangent, clipNear, clipFar } = camera;
    const { eye } = CameraLens.fromView(view);
    const rayAt = CameraLens.rays(view, eye, width, height, height / (2 * tangent), false);
    const origin = eye.map((n, a) => (n - min[a]) / cell), strides = [1, dims[0], dims[0] * dims[1]];
    return (x, y, front, visit) => {
      const ray = rayAt(x + .5, height - y - .5);
      const d = ray.direction.map(n => n / (ray.axial * cell));
      let enter = clipNear, exit = clipFar;
      for (const a of axes) {
        if (Math.abs(d[a]) < 1e-12) {
          d[a] = 0;
          if (origin[a] < 0 || origin[a] >= dims[a]) return -1;
        } else {
          const p = -origin[a] / d[a], q = (dims[a] - origin[a]) / d[a];
          enter = Math.max(enter, Math.min(p, q));
          exit = Math.min(exit, Math.max(p, q));
        }
      }
      if (exit <= enter) return -1;
      const start = enter + Math.min((exit - enter) * .5, 1e-7 / Math.max(...d.map(Math.abs)));
      const at = axes.map(a => Math.max(0, Math.min(dims[a] - 1, Math.floor(origin[a] + start * d[a]))));
      const step = d.map(Math.sign), delta = d.map(n => Math.abs(1 / n));
      const next = axes.map(a => d[a] ? (at[a] + Number(step[a] > 0) - origin[a]) / d[a] : Infinity);
      let index = at[0] + at[1] * strides[1] + at[2] * strides[2], t = enter;
      while (true) {
        const end = Math.min(next[0], next[1], next[2], exit);
        if (--budget.remaining < 0) fail('perspective traversal budget exceeded; reduce the view grid or voxel resolution');
        if (end > t && visit(index, t < front)) break;
        if (end >= exit) break;
        let outside = false;
        const tie = end + 1e-10;
        for (const a of axes) if (next[a] <= tie) {
          at[a] += step[a];
          outside ||= at[a] < 0 || at[a] >= dims[a];
          index += step[a] * strides[a];
          next[a] += delta[a];
        }
        if (outside) break;
        t = end;
      }
      return front >= exit ? 0 : front <= enter ? 2 : 1;
    };
  }

  function observeGrid(grid, mask, camera, { occluderDepth, depthBias }, budget, constraints) {
    const count = camera.width * camera.height;
    const visible = new Uint8Array(count), occluded = new Uint8Array(count);
    const blocked = new Uint8Array(count), sampled = new Uint8Array(count);
    const ray = voxelRays(grid, camera, budget), scratch = constraints && new Int32Array(grid.dims.reduce((a, b) => a + b, 0));
    const { width, height } = camera;
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const z = occluderDepth?.[p] ?? Infinity;
      const front = z >= camera.clipNear && z < camera.clipFar ? z - depthBias : Infinity;
      let seen = false, hidden = false, hits = 0;
      const coverage = ray(x, y, front, (index, inFront) => {
        if (inFront) {
          if (scratch) scratch[hits++] = index;
          seen ||= !!mask[index];
        } else hidden ||= !!mask[index];
        return seen && !scratch || hidden;
      });
      sampled[p] = Number(coverage !== -1);
      blocked[p] = Math.max(0, coverage);
      visible[p] = Number(seen);
      occluded[p] = Number(hidden && !seen);
      if (constraints) {
        const { clear, target, requested, forbidden } = constraints;
        const vote = clear[p] || !target[p] ? forbidden : !seen ? requested : null;
        if (vote) for (let i = 0; i < hits; i++) vote[scratch[i]] = 1;
      }
    }
    return { mask: visible, occluded, blocked, sampled };
  }

  const visitBudget = () => ({ remaining: 64e6 });

  function observe(shape, camera, options) {
    const { grid, mask } = unpack(shape);
    camera = perspective(camera);
    return observeGrid(grid, mask, camera, depthSettings(camera, options), visitBudget());
  }

  function silhouette(shape, camera, options) {
    if (camera?.view !== undefined) return observe(shape, camera, options).mask;
    const { grid, mask } = unpack(shape);
    return projection(grid, mask, camera);
  }

  function grow(kept, eligible, dims, maxGrowth) {
    if (!maxGrowth) return 0;
    const [nx, ny, nz] = dims, layer = nx * ny;
    const queue = new Int32Array(kept.length);
    let head = 0, tail = 0, added = 0;
    for (let i = 0; i < kept.length; i++) if (kept[i]) queue[tail++] = i;
    function add(index) {
      if (!eligible[index] || kept[index]) return;
      kept[index] = 1;
      queue[tail++] = index;
      added++;
    }
    for (let step = 0; step < maxGrowth && head < tail; step++) {
      const end = tail;
      while (head < end) {
        const i = queue[head++], x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / layer);
        if (x > 0) add(i - 1);
        if (x + 1 < nx) add(i + 1);
        if (y > 0) add(i - nx);
        if (y + 1 < ny) add(i + nx);
        if (z > 0) add(i - layer);
        if (z + 1 < nz) add(i + layer);
      }
    }
    return added;
  }

  function prepareOpenings(openings, camera) {
    if (!Array.isArray(openings) || openings.length > 32) fail('use up to 32 opening witnesses per view');
    const clear = new Uint8Array(camera.width * camera.height), seen = new Set();
    const rows = Array.from(openings, ({ id, rect } = {}) => {
      const [x, y, w, h] = Array.isArray(rect) ? rect : [];
      if (!name(id) || seen.has(id) || rect?.length !== 4 || !integer(x, 0, camera.width - 1) ||
          !integer(y, 0, camera.height - 1) || !integer(w, 1, camera.width - x) || !integer(h, 1, camera.height - y))
        fail('opening witnesses need unique IDs and pixel rectangles inside the camera viewport');
      seen.add(id);
      for (let j = y; j < y + h; j++) clear.fill(1, j * camera.width + x, j * camera.width + x + w);
      return { id, rect: [x, y, w, h] };
    });
    return { clear, openings: rows };
  }

  function viewReports(view, after, shared, review) {
    const { id, camera, target, before, clear, perspective: isPerspective, openings = [] } = view;
    let addPixels = 0, erasePixels = 0, missing = 0, extra = 0, occludedPixels = 0, occludedRequests = 0;
    for (let i = 0; i < target.length; i++) {
      const want = target[i] && !clear?.[i];
      if (want && !before.mask[i]) addPixels++;
      if (before.mask[i] && !want) erasePixels++;
      if (after.occluded?.[i]) occludedPixels++;
      if (want && !after.mask[i]) {
        if (after.occluded?.[i] || after.blocked?.[i] === 2) {
          occludedRequests++;
          if (review) review.disagreement[i] = 3;
        } else {
          missing++;
          if (review) review.disagreement[i] = 1;
        }
      }
      if (after.mask[i] && !want) {
        extra++;
        if (review) review.disagreement[i] = 2;
      }
    }
    const checks = openings.map(({ id: opening, rect }) => {
      const [x, y, w, h] = rect;
      let filled = 0, occluded = 0, unobserved = 0, paintConflicts = 0;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const p = i + j * camera.width;
        if (after.mask[p]) filled++;
        else if (after.blocked[p]) occluded++;
        else if (!after.sampled[p]) unobserved++;
        paintConflicts += target[p];
      }
      const row = { id: opening, rect, clear: w * h - filled - occluded - unobserved,
        filled, occluded, unobserved, paintConflicts, ready: filled + occluded + unobserved === 0 };
      if (!shared.has(opening)) shared.set(opening, []);
      shared.get(opening).push({ view: id, ...row });
      return row;
    });
    return { ...(id && { id }), addPixels, erasePixels, missing, extra,
      ...(isPerspective && { occludedPixels, occludedRequests, openings: checks }) };
  }

  function fit(prior, edits, { maxGrowth = 4, review = false } = {}) {
    if (!Array.isArray(edits) || !integer(edits.length, 2, maxViews) || !integer(maxGrowth, 0, 32))
      fail('use 2–12 views and a growth limit of 0–32 voxels');
    const { grid, mask } = unpack(prior);
    const kept = new Uint8Array(mask.length), requested = new Uint8Array(mask.length), forbidden = new Uint8Array(mask.length);
    const center = grid.min.map((n, a) => n + grid.dims[a] * grid.cell / 2);
    const budget = visitBudget(), ids = new Set();
    const views = Array.from(edits, ({ camera, mask: target, id, occluderDepth, depthBias, openings } = {}, i) => {
      const isPerspective = camera?.view !== undefined;
      if (isPerspective) id ??= 'view-' + (i + 1);
      if (id !== undefined && (!name(id) || ids.has(id))) fail('view IDs must be unique');
      ids.add(id);
      if (!viewport(camera) || !list(target) || target.length !== camera.width * camera.height ||
          Array.from(target).some(n => n !== 0 && n !== 1)) fail('each edit needs a matching binary mask');
      if (isPerspective) {
        camera = perspective(camera);
        const depth = depthSettings(camera, { occluderDepth, depthBias });
        const checks = prepareOpenings(openings ?? [], camera);
        const { eye, back } = CameraLens.fromView(camera.view);
        const before = observeGrid(grid, mask, camera, depth, budget, { ...checks, target, requested, forbidden });
        return { id, camera, direction: K.V.norm(K.V.sub(eye, center), back), before, target, depth,
          ...checks, perspective: true };
      }
      if (occluderDepth !== undefined || depthBias !== undefined || openings !== undefined)
        fail('occluders and opening witnesses need a native perspective camera grid');
      const { pixel, back } = projector(camera);
      const before = { mask: projection(grid, mask, camera) };
      cells(grid, (i, x, y, z) => {
        const p = pixel(x, y, z);
        if (p < 0 || !target[p]) forbidden[i] = 1;
        else if (!before.mask[p]) requested[i] = 1;
      });
      return { id, camera, direction: back, before, target };
    });
    if (!views.some(a => views.some(b => Math.abs(K.V.dot(a.direction, b.direction)) < Math.cos(Math.PI / 18))))
      fail('at least two views must differ by ten degrees, excluding opposite silhouettes');

    let retained = 0, removed = 0;
    for (let i = 0; i < mask.length; i++) {
      if (forbidden[i]) { removed += mask[i]; requested[i] = 0; }
      else if (mask[i]) { kept[i] = 1; retained++; }
    }
    if (!retained) fail('edits leave no supported source voxels; check their alignment or use a closer prior');
    const added = grow(kept, requested, grid.dims, maxGrowth);
    const shared = new Map(), images = [];
    const report = views.map(view => {
      const { width, height } = view.camera;
      const after = view.perspective ? observeGrid(grid, kept, view.camera, view.depth, budget) :
        { mask: projection(grid, kept, view.camera) };
      const image = review && { id: view.id, width, height, before: view.before.mask, ...after,
        disagreement: new Uint8Array(width * height), ...(view.clear && { protectedOpening: view.clear }) };
      if (image) images.push(image);
      return viewReports(view, after, shared, image);
    });
    const openings = Array.from(shared, ([id, views]) => ({ id, ready: views.every(view => view.ready), views }));
    return { shape: pack(grid, kept), report: { retained, removed, added, views: report,
      ...(views.some(view => view.perspective) && { openings }) }, ...(review && { review: images }) };
  }

  function proxy(shape, options) {
    const { grid: { min, dims, cell }, mask } = unpack(shape);
    return K.voxelSurface.fromMask(mask, {
      min: [0, 0, 0], dims, size: [cell, cell, cell], origin: min, orientation: [0, 0, 0]
    }, { mode: 'slabs', ...options });
  }

  K.turntableShape = Object.freeze({ fromSdf, camera, perspectiveCamera, observe, silhouette, fit, proxy });
})(KIT);
