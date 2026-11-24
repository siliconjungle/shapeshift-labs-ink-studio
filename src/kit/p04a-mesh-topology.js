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

  function vertexWeights(value, id) {
    if (value === undefined) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.entries(value).some(([channel, weight]) => !name(channel) ||
          ['__proto__', 'prototype', 'constructor'].includes(channel) || !unit(weight)))
      throw new RangeError('Vertex ' + id + ' needs named weights in [0, 1]');
    return { weights: frozen(Object.fromEntries(Object.keys(value).sort().map(channel => [channel, value[channel]]))) };
  }

  function cornerAttributes(value, face) {
    if (value === undefined) return undefined;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('Face ' + face + ' needs named corner attributes');
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [channel, data] of entries) {
      if (!name(channel) || ['__proto__', 'prototype', 'constructor'].includes(channel) ||
          !(Number.isFinite(data) || Array.isArray(data) && data.length >= 1 && data.length <= 4 && Array.from(data).every(Number.isFinite)))
        throw new TypeError('Face ' + face + ' corner attributes need finite scalars or vectors of up to four values');
    }
    return frozen(Object.fromEntries(entries.map(([key, data]) => [key, Array.isArray(data) ? frozen(data.slice()) : data])));
  }

  function edgeShading({ smooth, crease }) {
    if (smooth !== undefined && typeof smooth !== 'boolean' || crease !== undefined && !unit(crease))
      throw new RangeError('Edge smooth needs a boolean and crease needs a weight in [0, 1]');
    return { ...(smooth !== undefined && { smooth }), ...(crease !== undefined && { crease }) };
  }

  function shadingSettings(source) {
    if (source === undefined || source === null) return undefined;
    if (Object.getPrototypeOf(source) !== Object.prototype ||
        Object.keys(source).some(key => key !== 'smooth' && key !== 'weighting') ||
        source.smooth !== undefined && typeof source.smooth !== 'boolean' ||
        source.weighting !== undefined && !['uniform', 'area', 'angle', 'area-angle'].includes(source.weighting))
      throw new TypeError('Mesh shading needs smooth and a uniform, area, angle or area-angle weighting');
    return frozen({ ...(source.smooth !== undefined && { smooth: source.smooth }),
      ...(source.weighting !== undefined && { weighting: source.weighting }) });
  }

  function cornerNormal(value) {
    if (value === undefined) return undefined;
    const length = vector(value, 3, Number.isFinite) && Math.hypot(...value);
    if (!Number.isFinite(length) || !length) throw new RangeError('An authored corner normal needs a finite nonzero XYZ vector');
    return frozen(Array.from(value, n => Math.abs(1 - length) < 1e-12 ? n : n / length));
  }

  function build(source, keepEdges = false) {
    if (documents.has(source)) return source;
    const { format: type = format, version = 1, id, shading: authoredShading, vertices: inputVertices, edges: inputEdges = [], faces: inputFaces } = source ?? {};
    if (type !== format || version !== 1 || !name(id))
      throw new TypeError('Use a version 1 mesh topology document with a mesh ID');
    const shading = shadingSettings(authoredShading), vertices = new Map();
    for (const [key, { position, weights }] of index(inputVertices, 'Vertices')) {
      if (!vector(position, 3, value => Number.isFinite(value) && Number.isFinite(Math.fround(value))))
        throw new RangeError('Vertex ' + key + ' needs a finite XYZ position');
      vertices.set(key, frozen({ id: key, position: frozen(Array.from(position)), ...vertexWeights(weights, key) }));
    }
    const authoredEdges = new Map();
    for (const [key, edge] of index(inputEdges, 'Edges')) {
      if (!vector(edge.vertices, 2, name) || edge.vertices[0] === edge.vertices[1])
        throw new RangeError('Edge ' + key + ' needs two distinct vertex IDs');
      const endpoints = edgeKey(...edge.vertices);
      if (authoredEdges.has(endpoints)) throw new RangeError('Duplicate edge endpoints for ' + key);
      authoredEdges.set(endpoints, { id: key, ...edgeShading(edge) });
    }

    const corners = new Set(), edges = new Map(), faces = [], triangles = [];
    for (const [key, row] of index(inputFaces, 'Faces')) {
      const { material = 'default' } = row;
      if (!name(material) || !Array.isArray(row.corners) || row.corners.length < 3 || row.corners.length > maxCornersPerFace)
        throw new RangeError('Face ' + key + ' needs a material ID and 3 to ' + maxCornersPerFace + ' corners');
      if (triangles.length + row.corners.length - 2 > maxTriangles)
        throw new RangeError('Mesh topology exceeds the render triangle budget');
      const used = new Set();
      let layout;
      const face = frozen({ id: key, material, corners: frozen(Array.from(row.corners, corner => {
        const { id: cornerId, vertex, uv = [0, 0] } = corner ?? {};
        if (!name(cornerId) || corners.has(cornerId) || !vertices.has(vertex) || used.has(vertex) || !vector(uv, 2, unit))
          throw new RangeError('Face ' + key + ' needs unique corners, distinct existing vertices and normalized UV pairs');
        corners.add(cornerId);
        used.add(vertex);
        const attributes = cornerAttributes(corner.attributes, key), normal = cornerNormal(corner.normal);
        const shape = JSON.stringify(Object.entries(attributes ?? {}).map(([id, data]) => [id, Array.isArray(data) ? data.length : 0]));
        if (layout !== undefined && layout !== shape) throw new TypeError('Face ' + key + ' must use one corner attribute layout');
        layout = shape;
        return frozen({ id: cornerId, vertex, uv: frozen(Array.from(uv)), ...(attributes && { attributes }), ...(normal && { normal }) });
      })) });
      for (const [i, corner] of face.corners.entries()) {
        const next = face.corners[(i + 1) % face.corners.length];
        const endpoints = edgeKey(corner.vertex, next.vertex);
        if (!edges.has(endpoints)) {
          edges.set(endpoints, {
            ...(authoredEdges.get(endpoints) ?? { id: 'edge/' + endpoints }),
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
      if (!edges.has(endpoints)) throw new RangeError('Edge ' + key.id + ' is not a polygon boundary');
    }
    const retainedEdges = [...edges.values()];
    index(retainedEdges, 'Edges');
    const doc = frozen({ format, version, id, vertices: frozen([...vertices.values()]),
      edges: frozen(retainedEdges.map(({ uses, ...edge }) => frozen(edge))), faces: frozen(faces),
      ...(shading && { shading }) });
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

  function edit(source, { vertices = [], faces = [], removeVertices = [], removeFaces = [], edges = [], shading } = {}) {
    const doc = create(source), prior = new Map(doc.vertices.map(row => [row.id, row]));
    const updates = [...index(vertices, 'Updated vertices').values()].map(row => {
      const { id, position, weights = prior.get(row.id)?.weights } = row;
      return { id, position, ...(weights !== undefined && weights !== null && { weights }) };
    });
    const byEdge = index(edges, 'Updated edge shading'), knownEdges = new Set(doc.edges.map(edge => edge.id));
    for (const [id, edge] of byEdge) {
      if (!knownEdges.has(id) || Object.keys(edge).some(key => !['id', 'smooth', 'crease'].includes(key)))
        throw new RangeError('Update smooth or crease on a retained edge ' + id);
    }
    const edgeRows = doc.edges.map(edge => {
      const changes = byEdge.get(edge.id);
      if (!changes) return edge;
      const { id, vertices, smooth, crease } = { ...edge, ...changes };
      return { id, vertices, ...edgeShading({ smooth: smooth ?? undefined, crease: crease ?? undefined }) };
    });
    return build({ ...doc, edges: edgeRows, shading: shading === undefined ? doc.shading : shading,
      vertices: apply(doc.vertices, updates, removeVertices, 'vertices'),
      faces: apply(doc.faces, faces, removeFaces, 'faces')
    }, true);
  }

  function inspect(source) {
    const doc = create(source);
    const { edges, triangles } = documents.get(doc);
    return { id: doc.id, vertices: doc.vertices.length, faces: doc.faces.length, triangles: triangles.length,
      edges: edges.map(({ uses, ...edge }) => ({ ...edge, uses: uses.slice() })) };
  }

  function fromIndexed({ id, positions, indices, uvs, normals, materials = ['default'], faceMaterials } = {}) {
    if (!list(positions) || positions.length % 3 || !list(indices) || indices.length % 3 ||
        indices.length / 3 > maxTriangles || indices.length && !positions.length ||
        normals !== undefined && (!list(normals) || normals.length !== positions.length) ||
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
        return { id: 'c/' + offset, vertex: vertices[vertex].id, uv: uvs?.slice(vertex * 2, vertex * 2 + 2),
          normal: normals?.slice(vertex * 3, vertex * 3 + 3) };
      }) };
    });
    return create({ id, vertices, faces });
  }

  function triangulate(source) {
    const doc = create(source);
    const { vertices, triangles, edges } = documents.get(doc);
    const directions = meshTopologyShading.resolve(doc, edges, vertices);
    const positions = [], uvs = [], normals = [], indices = [], materials = [], faceMaterials = [], triangleSources = [];
    const renderVertices = new Map(), slots = new Map();
    for (const { face, local } of triangles) {
      if (!slots.has(face.material)) {
        slots.set(face.material, materials.length);
        materials.push(face.material);
      }
      faceMaterials.push(slots.get(face.material));
      const corners = local.map(i => face.corners[i]);
      const active = directions && corners.some(row => directions.has(row.id));
      const geometric = active && meshTopologyShading.triangleNormal(corners.map(row => vertices.get(row.vertex).position));
      for (const { id, vertex, uv } of corners) {
        const normal = active && (directions.get(id) ?? geometric);
        const key = JSON.stringify(normal ? [vertex, ...uv, ...normal] : [vertex, ...uv]);
        if (!renderVertices.has(key)) {
          renderVertices.set(key, positions.length / 3);
          positions.push(...vertices.get(vertex).position);
          uvs.push(...uv);
          if (directions) normals.push(...(normal || [0, 0, 0]));
        }
        indices.push(renderVertices.get(key));
      }
      triangleSources.push(frozen({ face: face.id, corners: frozen(corners.map(corner => corner.id)) }));
    }
    return { positions, uvs, ...(directions && { normals }), indices, materials, faceMaterials, triangleSources };
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
