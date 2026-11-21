/* Bounded edits to an indexed triangle mesh. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph;
  const { bounds, indexed, integer, list, range, record } = P.sceneGraphSupport;
  const probesPerCell = 16;

  function selection(value, count, name) {
    if (value === undefined) return;
    if (!list(value) || value.length > count)
      throw new RangeError('Invalid mesh scramble ' + name);
    const sorted = Array.from(value);
    if (!sorted.every(id => integer(id, 0, count - 1))) throw new RangeError('Invalid mesh scramble ' + name);
    const ids = new Set(sorted.sort((a, b) => a - b));
    if (ids.size !== value.length) throw new RangeError('Duplicate mesh scramble ' + name);
    return ids;
  }

  function donorGrid(points, donors, inside, size) {
    const cells = new Map();
    const site = id => points[id].map(n => Math.floor(n / size));
    const ids = donors ?? points.keys();
    for (const id of ids) {
      if (!inside[id]) continue;
      const key = site(id).join(',');
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(id);
    }
    return function* near(id, dice) {
      const [x, y, z] = site(id);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cell = cells.get([x + dx, y + dy, z + dz].join(','));
        if (!cell) continue;
        const start = Math.floor(dice() * cell.length);
        for (let n = 0; n < Math.min(cell.length, probesPerCell); n++) yield cell[(start + n) % cell.length];
      }
    };
  }

  function scrambleIndices(source, options = {}) {
    if (!record(options) || Object.keys(options).some(key =>
      !['faces', 'donors', 'bounds', 'amount', 'maxFaces', 'minDisplacement', 'maxDisplacement', 'seed', 'edits'].includes(key)))
      throw new TypeError('Invalid mesh scramble options');
    const { amount = .12, maxFaces = 128, minDisplacement = 0, maxDisplacement, seed = 0, edits } = options;
    if (!range(amount, 0, 1) || !integer(maxFaces, 0, 4096) || !Number.isSafeInteger(seed) ||
        !range(maxDisplacement, 1e-6, 4e6) || !range(minDisplacement, 0, maxDisplacement) ||
        edits !== undefined && (!Array.isArray(edits) || edits.length > maxFaces))
      throw new RangeError('Mesh scramble needs a bounded face count, amount and maximum displacement');
    const value = indexed(source), { pos, tri } = value, count = tri.length / 3;
    const faces = selection(options.faces, count, 'faces');
    const donors = selection(options.donors, pos.length / 3, 'donors');
    const box = options.bounds === undefined ? null : bounds(options.bounds);
    const points = Array.from({ length: pos.length / 3 }, (_, i) => pos.subarray(i * 3, i * 3 + 3));
    const inside = Uint8Array.from(points, point => !box || point.every((n, axis) => n >= box.min[axis] && n <= box.max[axis]));
    const eligible = [];
    for (let face = 0; face < count; face++) {
      const i = face * 3;
      if ((!faces || faces.has(face)) && inside[tri[i]] && inside[tri[i + 1]] && inside[tri[i + 2]]) eligible.push(face);
    }
    const changes = [];
    const min2 = minDisplacement ** 2, max2 = maxDisplacement ** 2;

    function redirect(face, corner, to) {
      const i = face * 3, from = tri[i + corner], a = tri[i + (corner + 1) % 3], b = tri[i + (corner + 2) % 3];
      if (to === from || to === a || to === b) return;
      const pa = points[a], pb = points[b], prev = points[from], next = points[to];
      const dx = next[0] - prev[0], dy = next[1] - prev[1], dz = next[2] - prev[2];
      const distance2 = dx * dx + dy * dy + dz * dz;
      if (!distance2 || distance2 < min2 || distance2 > max2) return;
      const u = K.V.sub(pa, next), v = K.V.sub(pb, next), normal = K.V.cross(u, v);
      if (K.V.dot(normal, normal) <= K.V.dot(u, u) * K.V.dot(v, v) * 1e-16) return;
      return { face, corner, from, to, displacement: Math.sqrt(distance2) };
    }

    let attemptedFaces;
    if (edits !== undefined) {
      const selected = new Set(eligible), touched = new Set();
      for (const edit of edits) {
        if (!record(edit) || Object.keys(edit).some(key => !['face', 'corner', 'vertex'].includes(key)) ||
            !selected.has(edit.face) || touched.has(edit.face) || !integer(edit.corner, 0, 2) ||
            !integer(edit.vertex, 0, points.length - 1) || !inside[edit.vertex] || donors && !donors.has(edit.vertex))
          throw new RangeError('Invalid mesh corner edit or multiple edits on a face');
        const change = redirect(edit.face, edit.corner, edit.vertex);
        if (!change) throw new RangeError('Corner edit exceeds displacement limits or degenerates the face');
        touched.add(edit.face);
        changes.push(change);
      }
      attemptedFaces = edits.length;
    } else {
      attemptedFaces = Math.min(maxFaces, Math.ceil(amount * eligible.length));
      if (attemptedFaces) {
        const near = donorGrid(points, donors, inside, maxDisplacement);
        const dice = K.grow.dice(P.data.hash('mesh-index-selection', seed));
        for (let i = 0; i < attemptedFaces; i++) {
          const pick = i + Math.floor(dice() * (eligible.length - i));
          [eligible[i], eligible[pick]] = [eligible[pick], eligible[i]];
          const face = eligible[i], local = K.grow.dice(P.data.hash('mesh-index:' + face, seed));
          const start = Math.floor(local() * 3);
          for (let n = 0; n < 3; n++) {
            const corner = (start + n) % 3;
            let change, matches = 0;
            for (const donor of near(tri[face * 3 + corner], local)) {
              const candidate = redirect(face, corner, donor);
              if (candidate && local() * ++matches < 1) change = candidate;
            }
            if (change) {
              changes.push(change);
              break;
            }
          }
        }
      }
    }
    changes.sort((a, b) => a.face - b.face);
    let largestDisplacement = 0;
    for (const change of changes) {
      tri[change.face * 3 + change.corner] = change.to;
      largestDisplacement = Math.max(largestDisplacement, change.displacement);
    }
    return { value, changes, report: { eligibleFaces: eligible.length, attemptedFaces, changedFaces: changes.length,
      largestDisplacement } };
  }

  A.scrambleIndices = scrambleIndices;
})(KIT);
