// Fit one editable, object-local volume from orthographic silhouettes.
(function (K) {
  const format = 'ink-studio/turntable-shape', maxCells = 500000, maxPixels = 262144, maxViews = 12;
  const fail = message => { throw new RangeError('Turntable shape: ' + message); };
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const vector = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(n => Number.isFinite(n) && Math.abs(n) <= 1e5);
  const product = dims => dims.reduce((total, n) => total * n, 1);

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
    if (!vector(camera?.target) || !integer(camera.width, 8, 1024) || !integer(camera.height, 8, 1024) ||
        camera.width * camera.height > maxPixels ||
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

  function silhouette(shape, camera) {
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

  function fit(prior, edits, { maxGrowth = 4 } = {}) {
    if (!Array.isArray(edits) || !integer(edits.length, 2, maxViews) || !integer(maxGrowth, 0, 32))
      fail('use 2–12 views and a growth limit of 0–32 voxels');
    const { grid, mask } = unpack(prior);
    const views = edits.map(({ camera, mask: target }) => {
      const { pixel, back } = projector(camera);
      if ((!Array.isArray(target) && !ArrayBuffer.isView(target)) || target.length !== camera.width * camera.height ||
          Array.from(target).some(n => n !== 0 && n !== 1)) fail('each edit needs a matching binary mask');
      return { camera, pixel, back, target, before: projection(grid, mask, camera) };
    });
    if (!views.some(a => views.some(b => Math.abs(K.V.dot(a.back, b.back)) < Math.cos(Math.PI / 18))))
      fail('at least two views must differ by ten degrees, excluding opposite silhouettes');

    const kept = new Uint8Array(mask.length), eligible = new Uint8Array(mask.length);
    let retained = 0, removed = 0;
    cells(grid, (i, x, y, z) => {
      let touched = false;
      for (const view of views) {
        const p = view.pixel(x, y, z);
        if (p < 0 || !view.target[p]) { removed += mask[i]; return; }
        touched ||= !view.before[p];
      }
      if (mask[i]) { kept[i] = 1; retained++; }
      else if (touched) eligible[i] = 1;
    });
    if (!retained) fail('edits leave no supported source voxels; check their alignment or use a closer prior');
    const added = grow(kept, eligible, grid.dims, maxGrowth);
    const report = views.map(({ camera, before, target }) => {
      const after = projection(grid, kept, camera);
      let addPixels = 0, erasePixels = 0, missing = 0, extra = 0;
      for (let i = 0; i < target.length; i++) {
        if (target[i] && !before[i]) addPixels++;
        if (before[i] && !target[i]) erasePixels++;
        if (target[i] && !after[i]) missing++;
        if (after[i] && !target[i]) extra++;
      }
      return { addPixels, erasePixels, missing, extra };
    });
    return { shape: pack(grid, kept), report: { retained, removed, added, views: report } };
  }

  function proxy(shape, options) {
    const { grid: { min, dims, cell }, mask } = unpack(shape);
    return K.voxelSurface.fromMask(mask, {
      min: [0, 0, 0], dims, size: [cell, cell, cell], origin: min, orientation: [0, 0, 0]
    }, { mode: 'slabs', ...options });
  }

  K.turntableShape = Object.freeze({ fromSdf, camera, silhouette, fit, proxy });
})(KIT);
