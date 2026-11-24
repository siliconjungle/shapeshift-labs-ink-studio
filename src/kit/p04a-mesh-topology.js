/* Retained polygon topology. Render triangles are derived from authored corners. */
(function (K) {
  const format = 'ink-studio/mesh-topology';
  const maxTriangles = 250000;
  const maxCornersPerFace = 128;
  const epsilon = 1e-10;
  const documents = new WeakMap();
  const renderSources = new WeakMap(), revisions = new WeakMap();
  const name = value => typeof value === 'string' && Boolean(value.trim());
  const list = value => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const frozen = Object.freeze;
  const pair = (a, b) => a < b ? [a, b] : [b, a];
  const edgeKey = (a, b) => JSON.stringify(pair(a, b));

  function vector(value, size, check) {
    return list(value) && value.length === size && Array.from(value).every(check);
  }

  function index(rows, label) {
    if (!Array.isArray(rows)) throw new TypeError(label + ' must be an array');
    const byId = new Map();
    for (const row of rows) {
      if (!name(row?.id) || byId.has(row.id)) throw new TypeError(label + ' need unique nonempty IDs');
      byId.set(row.id, row);
    }
    return byId;
  }

  function turn(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function segmentsMeet(a, b, c, d) {
    const sign = value => Math.abs(value) <= epsilon ? 0 : Math.sign(value);
    const contains = (p, q, r) => p.every((value, i) =>
      r[i] >= Math.min(value, q[i]) - epsilon && r[i] <= Math.max(value, q[i]) + epsilon);
    const ab = sign(turn(a, b, c)), abd = sign(turn(a, b, d));
    const cd = sign(turn(c, d, a)), cdb = sign(turn(c, d, b));
    return ab * abd < 0 && cd * cdb < 0 ||
      ab === 0 && contains(a, b, c) || abd === 0 && contains(a, b, d) ||
      cd === 0 && contains(c, d, a) || cdb === 0 && contains(c, d, b);
  }

  function tessellate(face, vertices) {
    const points = face.corners.map(({ vertex }) => vertices.get(vertex).position.map(Math.fround));
    const relative = points.map(point => K.V.sub(point, points[0]));
    const scale = Math.max(...relative.flat().map(Math.abs));
    const invalid = () => new RangeError('Face ' + face.id + ' needs a simple polygon with nonzero area');
    if (!scale) throw invalid();
    const local = relative.map(point => point.map(value => value / scale));
    const normal = local.reduce((sum, point, i) => K.V.add(sum, K.V.cross(point, local[(i + 1) % local.length])), [0, 0, 0]);
    const axis = [0, 1, 2].reduce((best, i) => Math.abs(normal[i]) > Math.abs(normal[best]) ? i : best);
    if (Math.abs(normal[axis]) < epsilon) throw invalid();
    if (points.length === 3) return [[0, 1, 2]];

    const projected = local.map(point => [point[(axis + 1) % 3], point[(axis + 2) % 3]]);
    for (let i = 0; i < projected.length; i++) {
      const next = (i + 1) % projected.length, a = projected[i], b = projected[next];
      if (a.every((value, k) => Math.abs(value - b[k]) <= epsilon)) throw invalid();
      for (let j = i + 2; j < projected.length; j++) {
        const end = (j + 1) % projected.length;
        if (end !== i && segmentsMeet(a, b, projected[j], projected[end])) throw invalid();
      }
    }
    const triangles = K.procedural.geometry.triangulate2D(projected, { retainBoundary: true });
    return normal[axis] < 0 ? triangles.map(triangle => triangle.reverse()) : triangles;
  }

  function build(source, keepEdges = false) {
    if (documents.has(source)) return source;
    const { format: type = format, version = 1, id, vertices: inputVertices, edges: inputEdges = [], faces: inputFaces } = source ?? {};
    if (type !== format || version !== 1 || !name(id))
      throw new TypeError('Use a version 1 mesh topology document with a mesh ID');
    const vertices = new Map();
    for (const [key, { position }] of index(inputVertices, 'Vertices')) {
      if (!vector(position, 3, value => Number.isFinite(value) && Number.isFinite(Math.fround(value))))
        throw new RangeError('Vertex ' + key + ' needs a finite XYZ position');
      vertices.set(key, frozen({ id: key, position: frozen(Array.from(position)) }));
    }
    const authoredEdges = new Map();
    for (const [key, edge] of index(inputEdges, 'Edges')) {
      if (!vector(edge.vertices, 2, name) || edge.vertices[0] === edge.vertices[1])
        throw new RangeError('Edge ' + key + ' needs two distinct vertex IDs');
      const endpoints = edgeKey(...edge.vertices);
      if (authoredEdges.has(endpoints)) throw new RangeError('Duplicate edge endpoints for ' + key);
      authoredEdges.set(endpoints, key);
    }

    const corners = new Set(), edges = new Map(), faces = [], triangles = [];
    for (const [key, row] of index(inputFaces, 'Faces')) {
      const { material = 'default' } = row;
      if (!name(material) || !Array.isArray(row.corners) || row.corners.length < 3 || row.corners.length > maxCornersPerFace)
        throw new RangeError('Face ' + key + ' needs a material ID and 3 to ' + maxCornersPerFace + ' corners');
      if (triangles.length + row.corners.length - 2 > maxTriangles)
        throw new RangeError('Mesh topology exceeds the render triangle budget');
      const used = new Set();
      const face = frozen({ id: key, material, corners: frozen(Array.from(row.corners, corner => {
        const { id: cornerId, vertex, uv = [0, 0] } = corner ?? {};
        if (!name(cornerId) || corners.has(cornerId) || !vertices.has(vertex) || used.has(vertex) || !vector(uv, 2, unit))
          throw new RangeError('Face ' + key + ' needs unique corners, distinct existing vertices and normalized UV pairs');
        corners.add(cornerId);
        used.add(vertex);
        return frozen({ id: cornerId, vertex, uv: frozen(Array.from(uv)) });
      })) });
      for (const [i, corner] of face.corners.entries()) {
        const next = face.corners[(i + 1) % face.corners.length];
        const endpoints = edgeKey(corner.vertex, next.vertex);
        if (!edges.has(endpoints)) {
          edges.set(endpoints, {
            id: authoredEdges.get(endpoints) ?? 'edge/' + endpoints,
            vertices: frozen(pair(corner.vertex, next.vertex)),
            uses: []
          });
        }
        edges.get(endpoints).uses.push(frozen({ face: key, from: corner.id, to: next.id }));
      }
      faces.push(face);
      for (const local of tessellate(face, vertices)) triangles.push({ face, local });
    }
    if (!keepEdges) for (const [endpoints, key] of authoredEdges) {
      if (!edges.has(endpoints)) throw new RangeError('Edge ' + key + ' is not a polygon boundary');
    }
    const retainedEdges = [...edges.values()];
    index(retainedEdges, 'Edges');
    const doc = frozen({ format, version, id, vertices: frozen([...vertices.values()]),
      edges: frozen(retainedEdges.map(({ id, vertices }) => frozen({ id, vertices }))), faces: frozen(faces) });
    documents.set(doc, { vertices, triangles, edges: retainedEdges });
    return doc;
  }

  function create(source) {
    return build(source);
  }

  function apply(rows, changed, removed, label) {
    if (!Array.isArray(removed)) throw new TypeError('Removed ' + label + ' must be an array of IDs');
    const values = new Map(rows.map(row => [row.id, row]));
    const updates = index(changed, 'Updated ' + label);
    for (const id of removed) {
      if (updates.has(id) || !values.delete(id)) throw new RangeError('Unknown or conflicting ' + label + ' ID ' + id);
    }
    for (const [id, row] of updates) values.set(id, row);
    return [...values.values()];
  }

  function edit(source, { vertices = [], faces = [], removeVertices = [], removeFaces = [] } = {}) {
    const doc = create(source);
    return build({ ...doc,
      vertices: apply(doc.vertices, vertices, removeVertices, 'vertices'),
      faces: apply(doc.faces, faces, removeFaces, 'faces')
    }, true);
  }

  function inspect(source) {
    const doc = create(source);
    const { edges, triangles } = documents.get(doc);
    return { id: doc.id, vertices: doc.vertices.length, faces: doc.faces.length, triangles: triangles.length,
      edges: edges.map(({ id, vertices, uses }) => ({ id, vertices, uses: uses.slice() })) };
  }

  function fromIndexed({ id, positions, indices, uvs, materials = ['default'], faceMaterials } = {}) {
    if (!list(positions) || positions.length % 3 || !list(indices) || indices.length % 3 ||
        indices.length / 3 > maxTriangles || indices.length && !positions.length ||
        uvs !== undefined && (!list(uvs) || uvs.length !== positions.length / 3 * 2) ||
        faceMaterials !== undefined && (!list(faceMaterials) || faceMaterials.length !== indices.length / 3) ||
        !Array.isArray(materials) || !materials.length || !Array.from(materials).every(name) ||
        new Set(materials).size !== materials.length ||
        !Array.from(indices).every(i => Number.isSafeInteger(i) && i >= 0 && i < positions.length / 3))
      throw new RangeError('Use indexed triangle positions, indices, optional UVs and face material slots');
    const vertices = Array.from({ length: positions.length / 3 }, (_, i) =>
      ({ id: 'v/' + i, position: positions.slice(i * 3, i * 3 + 3) }));
    const faces = Array.from({ length: indices.length / 3 }, (_, i) => {
      const slot = faceMaterials === undefined ? 0 : faceMaterials[i];
      if (!Number.isSafeInteger(slot) || !materials[slot]) throw new RangeError('Missing material slot for triangle ' + i);
      return { id: 'f/' + i, material: materials[slot], corners: [0, 1, 2].map(j => {
        const offset = i * 3 + j, vertex = indices[offset];
        return { id: 'c/' + offset, vertex: vertices[vertex].id, uv: uvs?.slice(vertex * 2, vertex * 2 + 2) };
      }) };
    });
    return create({ id, vertices, faces });
  }

  function triangulate(source) {
    const doc = create(source);
    const { vertices, triangles } = documents.get(doc);
    const positions = [], uvs = [], indices = [], materials = [], faceMaterials = [], triangleSources = [];
    const renderVertices = new Map(), slots = new Map();
    for (const { face, local } of triangles) {
      if (!slots.has(face.material)) {
        slots.set(face.material, materials.length);
        materials.push(face.material);
      }
      faceMaterials.push(slots.get(face.material));
      const corners = local.map(i => face.corners[i]);
      for (const { vertex, uv } of corners) {
        const key = JSON.stringify([vertex, ...uv]);
        if (!renderVertices.has(key)) {
          renderVertices.set(key, positions.length / 3);
          positions.push(...vertices.get(vertex).position);
          uvs.push(...uv);
        }
        indices.push(renderVertices.get(key));
      }
      triangleSources.push(frozen({ face: face.id, corners: frozen(corners.map(corner => corner.id)) }));
    }
    return { positions, uvs, indices, materials, faceMaterials, triangleSources };
  }

  function toSceneMesh(source, { materials, objectId, partId, meshId } = {}) {
    const doc = create(source);
    const { materials: slots, triangleSources, ...geometry } = triangulate(doc);
    if (!triangleSources.length) throw new RangeError('Add at least one polygon before rendering a mesh topology');
    const options = materials === undefined ? null : index(materials, 'Materials');
    const definitions = slots.map(id => {
      if (options && !options.has(id)) throw new RangeError('Missing mesh material ' + id);
      return options?.get(id) ?? { id };
    });
    const mesh = K.sceneMeshes.create({ id: meshId ?? doc.id, objectId, partId, ...geometry, materials: definitions });
    renderSources.set(mesh, { document: doc, triangles: triangleSources });
    return mesh;
  }

  function triangleSource(mesh, triangle) {
    return Number.isSafeInteger(triangle) && triangle >= 0 ? renderSources.get(mesh)?.triangles[triangle] ?? null : null;
  }

  function revision(source) {
    const doc = create(source);
    if (!revisions.has(doc)) {
      const text = JSON.stringify(doc), { hash } = K.procedural.data;
      revisions.set(doc, [text.length, hash(text), hash(text, 0x9e3779b9)].map(n => n.toString(36)).join('-'));
    }
    return revisions.get(doc);
  }

  const sourceDocument = mesh => renderSources.get(mesh)?.document ?? null;
  K.meshTopology = frozen({ create, edit, inspect, fromIndexed, triangulate, toSceneMesh, triangleSource, sourceDocument, revision });
})(KIT);
