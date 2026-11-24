/* Quad patches across authored boundary loops. */
const meshEdgeSurfaces = (function (K) {
  const { V } = K, { record } = meshCutGeometry;
  const { name, cyclic, rotate, boundary, position, point, cornerData, corners } = meshEdgeFlowData;
  const validInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

  function assemble(g) {
    const vertices = [], faces = [], sources = [], conflicts = new Set(), newVertices = [];
    function vertex(samples, position) {
      const row = point(g, samples, position);
      vertices.push(row.vertex);
      newVertices.push(row.sources);
      return row.vertex.id;
    }
    function face(ring, data, material, edges) {
      const id = g.fresh('face');
      faces.push({ id, material, corners: corners(g, ring, data, conflicts) });
      sources.push({ face: id, edges });
    }
    function result(detail) {
      return { patch: { ...(vertices.length && { vertices }), faces }, affected: faces.map(row => row.id),
        detail: { ...detail, faces: sources, vertices: newVertices, attributeConflicts: [...conflicts].sort() } };
    }
    return { vertex, face, result };
  }

  function reversed(loop) {
    return loop.map((_, i) => {
      const row = cyclic(loop, -i - 1);
      return { ...row, id: row.b.vertex, a: row.b, b: row.a };
    });
  }

  function align(g, a, b) {
    let best = 0, smallest = Infinity;
    for (let offset = 0; offset < b.length; offset++) {
      let cost = 0;
      for (let i = 0; i < a.length && cost < smallest; i++)
        cost += V.dist(position(g, a[i].id), position(g, cyclic(b, i + offset).id)) ** 2;
      if (cost < smallest) { best = offset; smallest = cost; }
    }
    return best;
  }

  function bridge(g, op) {
    if (!record(op, ['kind', 'first', 'second', 'starts', 'offset', 'segments', 'material', 'uv']) ||
        op.starts !== undefined && !(Array.isArray(op.starts) && op.starts.length === 2 && Array.from(op.starts).every(name)) ||
        op.offset !== undefined && !Number.isSafeInteger(op.offset) ||
        op.segments !== undefined && !validInteger(op.segments, 1, 32) ||
        op.material !== undefined && !name(op.material) || op.uv !== undefined && !['strip', 'inherit'].includes(op.uv))
      throw new TypeError('Bridge needs two saved boundary loops and optional starts, offset, segments, material and UV mode');
    const a = boundary(g, op.first, op.starts?.[0]), originalB = boundary(g, op.second, op.starts?.[1]);
    const n = a.length, segments = op.segments ?? 1, used = new Set(a.map(row => row.id));
    if (n !== originalB.length || n > 1024 || originalB.some(row => used.has(row.id)))
      throw new RangeError('Bridge needs two disjoint loops with the same edge count (3 to 1024 per loop)');
    const reverseB = reversed(originalB);
    const offset = op.offset === undefined ? align(g, a, reverseB) : ((op.offset % n) + n) % n;
    const b = rotate(reverseB, offset), patch = assemble(g);
    const ids = [a.map(row => row.id)];
    for (let j = 1; j < segments; j++) {
      const v = j / segments;
      ids.push(a.map((row, i) => patch.vertex([[row.id, 1 - v], [b[i].id, v]])));
    }
    ids.push(b.map(row => row.id));

    const span = [0];
    for (let i = 0; i < n; i++) {
      const length = loop => V.dist(position(g, loop[i].a.vertex), position(g, loop[i].b.vertex));
      span.push(span[i] + (length(a) + length(b)) / 2);
    }
    function sample(i, j, side) {
      const v = j / segments, u = span[i + Number(side === 'b')] / span[n];
      return cornerData([[a[i][side], 1 - v], [b[i][side], v]], op.uv === 'inherit' ? undefined : [u, v]);
    }
    for (let j = 0; j < segments; j++) for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const data = [sample(i, j, 'a'), sample(i, j, 'b'), sample(i, j + 1, 'b'), sample(i, j + 1, 'a')];
      const side = (j + .5) / segments <= .5 ? a[i] : b[i];
      patch.face([ids[j][i], ids[j][k], ids[j + 1][k], ids[j + 1][i]], data,
        op.material ?? side.face.material, [a[i].edge, b[i].edge]);
    }
    return patch.result({ offset, segments, pairs: a.map((row, i) => [row.id, b[i].id]) });
  }

  function grid(g, op) {
    if (!record(op, ['kind', 'selection', 'start', 'columns', 'material']) ||
        op.columns !== undefined && !validInteger(op.columns, 1, 127) || op.material !== undefined && !name(op.material))
      throw new TypeError('Grid fill needs a saved boundary loop and optional start, column count and material');
    const loop = boundary(g, op.selection, op.start);
    if (loop.length % 2 || loop.length < 4 || loop.length > 256)
      throw new RangeError('Grid fill needs one boundary with 4 to 256 edges and an even edge count');
    const span = loop.length / 2, width = op.columns ?? Math.floor(span / 2), height = span - width;
    if (height < 1 || height > 127) throw new RangeError('Grid column count leaves no valid row count');
    const south = loop.slice(0, width), east = loop.slice(width, width + height);
    const west = reverseSide(loop.slice(2 * width + height)), north = reverseSide(loop.slice(width + height, 2 * width + height));
    function reverseSide(side) {
      return side.slice().reverse().map(({ a, b, ...edge }) => ({ ...edge, a: b, b: a }));
    }
    const path = rows => [rows[0].a.vertex, ...rows.map(row => row.b.vertex)];
    const bottom = path(south), top = path(north), left = path(west), right = path(east);
    const at = id => position(g, id), patch = assemble(g);
    const ids = [bottom];
    for (let j = 1; j < height; j++) {
      const v = j / height, ring = [left[j]];
      for (let i = 1; i < width; i++) {
        const u = i / width;
        const weights = [(1 - v) / 2, v / 2, (1 - u) / 2, u / 2];
        const ends = [bottom[i], top[i], left[j], right[j]];
        const profile = ends.reduce((sum, id, k) => V.mad(sum, at(id), 2 * weights[k]), [0, 0, 0]);
        const bilinear = V.lerp(V.lerp(at(bottom[0]), at(bottom[width]), u),
          V.lerp(at(top[0]), at(top[width]), u), v);
        ring.push(patch.vertex(ends.map((id, k) => [id, weights[k]]), V.sub(profile, bilinear)));
      }
      ring.push(right[j]);
      ids.push(ring);
    }
    ids.push(top);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const rails = [south[i], north[i], west[j], east[j]];
      const distances = [j, height - 1 - j, i, width - 1 - i];
      const closest = distances.indexOf(Math.min(...distances));
      const data = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => {
        const u = (i + s) / width, v = (j + t) / height;
        const x = s ? 'b' : 'a', y = t ? 'b' : 'a';
        return cornerData([[rails[0][x], (1 - v) / 2], [rails[1][x], v / 2],
          [rails[2][y], (1 - u) / 2], [rails[3][y], u / 2]], [u, v]);
      });
      patch.face([ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]], data,
        op.material ?? rails[closest].face.material, rails.map(row => row.edge));
    }
    return patch.result({ columns: width, rows: height, boundary: loop.map(row => row.edge) });
  }

  return { bridge, grid };
})(KIT);
