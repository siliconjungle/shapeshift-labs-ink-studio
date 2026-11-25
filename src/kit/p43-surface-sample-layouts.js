/* Stratified surface points and shortest-path spacing on explicit surface neighbors. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    point = p => Array.isArray(p) && p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);

  function patch(spec) {
    const out = [];
    P.geometry.samplePatch({ jitter: 1, ...spec }, (p, u, v) => out.push({ point: p.slice(), uv: [u, v] }));
    return P.data.freeze(out);
  }

  function grid({bounds, id, origin, step, radius = 0, jitter = 0, seed = 0, accept} = {}) {
    const size = bounds?.min?.length;
    checkGrid([2, 3].includes(size), 'A scatter grid needs 2D or 3D bounds');
    const axis = vector => Array.isArray(vector) && vector.length === size && Array.from(vector).every(Number.isFinite);
    const spacing = typeof step === 'number' ? Array(size).fill(step) : step;
    checkGrid(axis(bounds.min) && axis(bounds.max) &&
      bounds.min.every((n, i) => n < bounds.max[i]) && axis(origin) && axis(spacing) &&
      spacing.every(n => n > 0) && K.world.data.id(id) && id.length <= 55 && Number.isSafeInteger(seed) &&
      Number.isFinite(jitter) && jitter >= 0 && jitter <= 1 && Number.isFinite(radius) && radius >= 0 &&
      Math.min(...spacing) * (1 - jitter) >= radius && (accept === undefined || typeof accept === 'function'),
    'A scatter grid needs an ID, finite origin and positive step with enough room for its radius and jitter');
    const first = origin.map((n, i) => Math.ceil((bounds.min[i] - n) / spacing[i] - jitter / 2));
    const last = origin.map((n, i) => Math.floor((bounds.max[i] - n) / spacing[i] + jitter / 2));
    const counts = first.map((n, i) => Math.max(0, last[i] - n + 1));
    const count = counts.reduce((a, b) => a * b, 1);
    checkGrid([...first, ...last].every(n => limit(n, -1e9, 1e9)) && count <= 100000,
      'Scatter grid exceeds its cell budget or coordinate range');
    const samples = [], report = {mode: 'grid', candidates: count, outside: 0, masked: 0};
    for (let index = 0; index < count; index++) {
      let cell = index;
      const coordinates = counts.map((n, axis) => {
        const component = first[axis] + cell % n;
        cell = Math.floor(cell / n);
        return component;
      });
      const key = id + '.' + coordinates.join('.');
      const dice = K.grow.dice(P.data.hash(key, seed));
      const point = coordinates.map((n, i) => origin[i] + (n + (dice() - .5) * jitter) * spacing[i]);
      if (point.some((n, i) => n < bounds.min[i] || n > bounds.max[i])) report.outside++;
      else if (accept && !accept(point)) report.masked++;
      else samples.push({id: key, point, cell: coordinates});
    }
    return P.data.freeze({samples, report: {...report, accepted: samples.length}});
  }

  function checkGrid(condition, message) {
    if (!condition) throw new RangeError(message);
  }

  function triangles(input, { count, seed = 0, accept, maxTriangles = 200000 } = {}) {
    const positions = input?.positions ?? input;
    if (
      !(Array.isArray(positions) || ArrayBuffer.isView(positions)) || !positions.length ||
      positions.length % 9 !== 0 || !limit(maxTriangles, 1, 500000) || positions.length / 9 > maxTriangles ||
      !positions.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6) ||
      !limit(count, 1, 500000) || !Number.isSafeInteger(seed) || (accept !== undefined && typeof accept !== 'function')
    ) throw new Error('Stratified triangles need finite triangle positions, a sample count and a work limit');
    const areas = new Float64Array(positions.length / 9),
      read = i => [positions[i], positions[i + 1], positions[i + 2]],
      dice = K.grow.dice(P.data.hash('area-strata', seed));
    let total = 0;
    for (let i = 0; i < areas.length; i++) {
      const a = read(9 * i);
      total += 0.5 * V.len(V.cross(V.sub(read(9 * i + 3), a), V.sub(read(9 * i + 6), a)));
      areas[i] = total;
    }
    const samples = [];
    if (!total) return Object.freeze(samples);
    let triangle = 0;
    for (let i = 0; i < count; i++) {
      const cumulative = (i + dice()) * total / count;
      while (triangle < areas.length - 1 && areas[triangle] <= cumulative) triangle++;
      const s = Math.sqrt(dice()), r = dice(),
        barycentric = [1 - s, s * (1 - r), s * r],
        p = [0, 0, 0];
      for (let corner = 0; corner < 3; corner++)
        for (let axis = 0; axis < 3; axis++) p[axis] += positions[9 * triangle + 3 * corner + axis] * barycentric[corner];
      const result = P.data.freeze({ key: i, point: p, triangle, barycentric });
      if (!accept || accept(result)) samples.push(result);
    }
    return Object.freeze(samples);
  }

  function geodesicSpacing(points, links, { distance, candidates, maxTraversals = 3000000 } = {}) {
    const n = points?.length;
    if (
      !Array.isArray(points) || !limit(n, 1, 200000) || !points.every(point) ||
      !Array.isArray(links) || links.length > 1000000 ||
      !Number.isFinite(distance) || distance < 0 || !limit(maxTraversals, 1, 20000000) ||
      (candidates !== undefined && (!Array.isArray(candidates) || candidates.length > n || candidates.some(i => !limit(i, 0, n - 1))))
    ) throw new Error('Geodesic spacing needs points, surface links, separation and a work budget');
    const adjacent = points.map(() => []),
      orders = candidates ?? points.map((_, i) => i),
      blocked = new Uint8Array(n),
      visited = new Uint32Array(n),
      distances = new Float64Array(n),
      selection = [],
      work = { traversals: 0 };
    for (const link of links) {
      if (!Array.isArray(link) || link.length < 2 || link.length > 3 ||
        !limit(link[0], 0, n - 1) || !limit(link[1], 0, n - 1) || link[0] === link[1])
        throw new Error('Surface links need two distinct point indices');
      const [a, b, length = V.dist(points[link[0]], points[link[1]])] = link;
      if (!Number.isFinite(length) || length < 0) throw new Error('Surface link cost must be finite and nonnegative');
      adjacent[a].push({ cell: b, length });
      adjacent[b].push({ cell: a, length });
    }
    let version = 0;
    for (const origin of orders) {
      if (blocked[origin]) continue;
      selection.push(origin);
      blocked[origin] = 1;
      if (distance === 0) continue;
      version++;
      const queue = new ProceduralHeap((a, b) => a.distance < b.distance || (a.distance === b.distance && a.cell < b.cell));
      queue.push({ cell: origin, distance: 0 });
      visited[origin] = version;
      distances[origin] = 0;
      while (queue.size) {
        const current = queue.pop();
        if (current.distance !== distances[current.cell]) continue;
        blocked[current.cell] = 1;
        for (const { cell, length } of adjacent[current.cell]) {
          if (++work.traversals > maxTraversals) throw new Error('Geodesic spacing exceeds its traversal budget');
          const next = current.distance + length;
          if (next >= distance || (visited[cell] === version && distances[cell] <= next)) continue;
          distances[cell] = next;
          visited[cell] = version;
          queue.push({ cell, distance: next });
        }
      }
    }
    return P.data.freeze({ indices: selection, work });
  }

  Object.assign(P.sampling, { patch, grid, triangles, geodesicSpacing });
})(KIT);
