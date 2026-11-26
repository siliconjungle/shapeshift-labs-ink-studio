/* Normalize dirty indexed geometry before the retained mesh validator runs. */
const meshImportRepair = (function (K) {
  const topology = K.meshTopology, { V } = K;
  const { data: { freeze } } = K.procedural;
  const { record, pair: edgeKey } = meshCutGeometry;
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const finite = values => Array.from(values).every(Number.isFinite);
  const vertex = i => 'v/' + i, face = i => 'f/' + i;
  const cap = 40000;

  function featureIds(value = {}, vertices, faces) {
    if (!record(value, ['vertices', 'edges', 'faces'])) throw new TypeError('Use protected mesh vertices, edges or faces');
    const vertexId = id => Number.isSafeInteger(id) ? vertex(id) : id;
    const faceId = id => Number.isSafeInteger(id) ? face(id) : id;
    const { vertices: held = [], edges = [], faces: painted = [] } = value;
    if (![held, edges, painted].every(rows => Array.isArray(rows) && rows.length <= cap) ||
        !held.every(id => vertices.has(vertexId(id))) || !painted.every(id => faces.has(faceId(id))) ||
        !edges.every(pair => Array.isArray(pair) && pair.length === 2 && vertexId(pair[0]) !== vertexId(pair[1]) &&
          pair.every(id => vertices.has(vertexId(id)))))
      throw new RangeError('Protected mesh features must refer to source elements');
    return { vertices: new Set([...held, ...edges.flat()].map(vertexId)), faces: new Set(painted.map(faceId)),
      edges: new Set(edges.map(pair => edgeKey(...pair.map(vertexId)))) };
  }

  function orient(faces, issues) {
    const borders = new Map(), neighbors = new Map(faces.map(row => [row.id, []]));
    for (const row of faces) for (const [i, corner] of row.corners.entries()) {
      const next = row.corners[(i + 1) % row.corners.length].vertex, key = edgeKey(corner.vertex, next);
      if (!borders.has(key)) borders.set(key, []);
      borders.get(key).push({ face: row.id, direction: corner.vertex < next });
    }
    for (const [key, uses] of borders) {
      if (uses.length > 2) issues.push({ kind: 'non-manifold-edge', vertices: JSON.parse(key), faces: uses.map(use => use.face) });
      if (uses.length !== 2) continue;
      const [a, b] = uses, reverse = a.direction === b.direction;
      neighbors.get(a.face).push([b.face, reverse, key]);
      neighbors.get(b.face).push([a.face, reverse, key]);
    }
    const signs = new Map(), conflicts = new Set();
    for (const { id } of faces) {
      if (signs.has(id)) continue;
      const component = [id];
      signs.set(id, false);
      let flips = 0;
      for (let i = 0; i < component.length; i++) {
        const here = component[i], sign = signs.get(here);
        if (sign) flips++;
        for (const [next, reverse, key] of neighbors.get(here)) {
          const wanted = reverse !== sign;
          if (!signs.has(next)) { signs.set(next, wanted); component.push(next); }
          else if (signs.get(next) !== wanted) conflicts.add(key);
        }
      }
      if (flips * 2 > component.length) for (const name of component) signs.set(name, !signs.get(name));
    }
    for (const key of conflicts) issues.push({ kind: 'non-orientable-component', vertices: JSON.parse(key) });
    return faces.filter(row => signs.get(row.id)).map(row => row.id);
  }

  function clean(source, options = {}) {
    if (!record(options, ['weld', 'protected']) || options.weld !== undefined && typeof options.weld !== 'boolean')
      throw new TypeError('Use imported mesh repair settings');
    const { id, positions, indices, materials = ['default'], faceMaterials, skin, weights, vertexColors,
      cornerUVs, cornerNormals, uvSets, uvBindings, cornerAttributes } = source ?? {};
    if (!list(positions) || !positions.length || positions.length % 3 || positions.length / 3 > cap * 3 ||
        !list(indices) || !indices.length || indices.length % 3 || indices.length / 3 > cap ||
        !Array.isArray(materials) || !materials.length || new Set(materials).size !== materials.length ||
        !materials.every(name => typeof name === 'string' && name.trim()))
      throw new RangeError('Imported repair needs indexed XYZ and 1–40000 triangles with distinct material names');
    const count = positions.length / 3, total = indices.length / 3;
    const sized = (value, length) => value === undefined || list(value) && value.length === length;
    if (!sized(faceMaterials, total) || !sized(weights, count) || !sized(vertexColors, count * 3) ||
        vertexColors !== undefined && !finite(vertexColors) ||
        ![cornerUVs, cornerNormals, cornerAttributes, ...Object.values(uvSets ?? {})].every(rows => sized(rows, total)))
      throw new RangeError('Imported mesh attributes must match their vertex or triangle domain');
    const held = featureIds(options.protected,
      new Set(Array.from({ length: count }, (_, i) => vertex(i))),
      new Set(Array.from({ length: total }, (_, i) => face(i))));
    const issues = [], invalidVertices = [], welds = [], removedFaces = [];
    const aliases = new Map(), vertices = new Map(), exact = new Map();
    const order = Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => Number(held.vertices.has(vertex(b))) - Number(held.vertices.has(vertex(a))) || a - b);
    for (const i of order) {
      const name = vertex(i), xyz = Array.from(positions.slice(i * 3, i * 3 + 3));
      if (!finite(xyz.map(Math.fround))) {
        invalidVertices.push(name);
        if (held.vertices.has(name)) issues.push({ kind: 'protected-vertex-invalid', vertex: name });
        continue;
      }
      const rowWeights = weights?.[i], weightKey = rowWeights && Object.entries(rowWeights).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const key = JSON.stringify([xyz, weightKey]), existing = exact.get(key);
      if (options.weld !== false && existing && !held.vertices.has(name)) {
        aliases.set(name, existing);
        welds.push({ removed: name, kept: existing, distance: 0, weights: 'identical' });
      } else {
        aliases.set(name, name);
        vertices.set(name, { id: name, position: xyz, ...(rowWeights !== undefined && { weights: rowWeights }) });
        if (!existing) exact.set(key, name);
      }
    }
    const triangles = [], unique = new Map();
    function remove(name, kind, other) {
      const row = { face: name, kind, ...(other && { kept: other }) };
      removedFaces.push(row);
      if (held.faces.has(name)) issues.push({ ...row, reason: 'protected-face' });
    }
    const faceOrder = Array.from({ length: total }, (_, i) => i)
      .sort((a, b) => Number(held.faces.has(face(b))) - Number(held.faces.has(face(a))) || a - b);
    for (const i of faceOrder) {
      const name = face(i), ids = Array.from(indices.slice(i * 3, i * 3 + 3));
      const points = ids.map(index => Number.isSafeInteger(index) && index >= 0 && index < count ? aliases.get(vertex(index)) : undefined);
      if (points.some(point => !point)) { remove(name, 'invalid-index-or-vertex'); continue; }
      if (new Set(points).size < 3) { remove(name, 'collapsed-triangle'); continue; }
      const [a, b, c] = points.map(id => vertices.get(id).position.map(Math.fround));
      const u = V.sub(b, a), v = V.sub(c, a), scale = Math.max(...u.map(Math.abs), ...v.map(Math.abs));
      if (!scale || Math.max(...V.cross(V.mul(u, 1 / scale), V.mul(v, 1 / scale)).map(Math.abs)) < 1e-10) {
        remove(name, 'zero-area-triangle'); continue;
      }
      const slot = faceMaterials?.[i] ?? 0, material = materials[slot];
      if (!Number.isSafeInteger(slot) || typeof material !== 'string') { remove(name, 'invalid-material-slot'); continue; }
      const corners = points.map((point, k) => {
        const uv = cornerUVs?.[i]?.[k], normal = cornerNormals?.[i]?.[k];
        const attributes = { ...cornerAttributes?.[i]?.[k] };
        if (vertexColors) attributes.pigmentRgb = Array.from(vertexColors.slice(ids[k] * 3, ids[k] * 3 + 3));
        for (const [set, rows] of Object.entries(uvSets ?? {}))
          if (Number(set) > 0 && rows[i]?.[k]) attributes['uv/' + set] = rows[i][k];
        return { id: 'c/' + (i * 3 + k), vertex: point, ...(uv && { uv }), ...(normal && { normal }),
          ...(Object.keys(attributes).length && { attributes }) };
      });
      const key = JSON.stringify(points.slice().sort()), before = unique.get(key);
      const signature = row => JSON.stringify([row.material, row.corners.map(({ id, ...rest }) => rest)
        .sort((a, b) => a.vertex < b.vertex ? -1 : a.vertex > b.vertex ? 1 : 0)]);
      const row = { id: name, material, corners };
      if (before) {
        if (signature(before) === signature(row)) { remove(name, 'duplicate-triangle', before.id); continue; }
        issues.push({ kind: 'coincident-triangle-attribute-conflict', faces: [before.id, name] });
      } else unique.set(key, row);
      triangles.push(row);
    }
    const flipped = orient(triangles, issues), reversed = new Set(flipped);
    const used = new Set(triangles.flatMap(row => row.corners.map(corner => corner.vertex)));
    const unusedVertices = [...vertices.keys()].filter(name => !used.has(name) && !held.vertices.has(name));
    const before = triangles.length ? topology.create({ id, skin, uvBindings,
      vertices: [...vertices.values()].filter(row => used.has(row.id) || held.vertices.has(row.id)),
      faces: triangles.map(row => reversed.has(row.id) ? { ...row, corners: row.corners.slice().reverse() } : row)
    }) : null;
    if (!before) issues.push({ kind: 'no-usable-triangles' });
    else {
      const boundaries = new Set(before.edges.map(row => edgeKey(...row.vertices)));
      for (const key of held.edges) if (!boundaries.has(key)) issues.push({ kind: 'protected-edge-missing', vertices: JSON.parse(key) });
    }
    const report = { inputVertices: count, inputTriangles: total, invalidVertices, unusedVertices,
      welds, removedFaces, flipped, issues, repairedRevision: before && topology.revision(before) };
    return freeze({ document: before, report });
  }

  K.meshTopology = Object.freeze({ ...topology, repairImported: clean });
  return { featureIds };
})(KIT);
