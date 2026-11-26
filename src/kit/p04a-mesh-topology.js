/* Retained polygon topology. Render triangles are derived from authored corners. */
const meshQuadDiagonal = Object.freeze({
  remap(face,corners) {
    return face.diagonal?.map(id=>corners[face.corners.findIndex(corner=>corner.id===id)].id);
  }
});

const isMeshSmoothingGroup = value => typeof value === 'string' && Boolean(value.trim()) ||
  Number.isSafeInteger(value) && value >= 0;

// Retained tint and the vertex streams consumed by both native renderers.
const meshCornerTint = (() => {
  const neutral = Object.freeze([1,1,1,1]);
  const clear = Object.freeze([0,0,0,0]);
  const midpoint = Object.freeze([.5,.5,.5,1]);
  const unit = n=>Number.isFinite(n) && n>=0 && n<=1;
  const clamp = n=>Math.min(1,Math.max(0,n));
  const read = ({attributes} = {})=>{
    const tint=attributes?.tint;
    return Array.isArray(tint) && [3,4].includes(tint.length) && tint.every(unit) ? tint : undefined;
  };
  const matches = (tint,color,tolerance)=>tint!==undefined && color.every((value,k)=>
    Math.abs(value-(tint[k] ?? 1))<=tolerance+(tolerance ? Number.EPSILON : 0));
  const modes = Object.freeze(['multiply','replace','alpha-blend','midpoint']);
  const coverage = (corner,tint)=>tint ? corner.attributes.tintCoverage ?? 1 : 0;
  function generic(corner) {
    if (!read(corner)) return corner.attributes;
    const {tint,tintCoverage,...attributes} = corner.attributes;
    return attributes;
  }
  function stream(corner,mode) {
    const tint = read(corner);
    if (mode==='midpoint' || mode==='multiply') {
      const blank = mode==='midpoint' ? midpoint : neutral;
      if (!tint) return blank;
      const weight = coverage(corner,tint);
      const value = weight===1 ? tint : tint.map((n,k)=>k===3 ? n : blank[k]+weight*(n-blank[k]));
      return mode==='midpoint' ? [value[0],value[1],value[2],tint[3] ?? 1] : value;
    }
    if (!tint) return clear;
    const weight = coverage(corner,tint)*(mode==='alpha-blend' ? tint[3] ?? 1 : 1);
    return [tint[0]*weight,tint[1]*weight,tint[2]*weight,weight];
  }
  function sample(rows,weights,mode='multiply') {
    const tints=rows.map(read), exact=weights.indexOf(1);
    if (exact>=0 && weights.every((weight,i)=>i===exact || weight===0)) {
      const tint=tints[exact], tintCoverage=rows[exact].attributes?.tintCoverage;
      return tint ? {tint,...(tintCoverage!==undefined && {tintCoverage})} : {};
    }
    const size=tints.reduce((n,tint,i)=>weights[i]>0 ? Math.max(n,tint?.length ?? 0) : n,0);
    if (!size) return {};
    if (mode==='replace' || mode==='alpha-blend') {
      const effective = tints.map((tint,i)=>weights[i]*coverage(rows[i],tint)*
        (mode==='alpha-blend' ? tint?.[3] ?? 1 : 1));
      const total = effective.reduce((a,b)=>a+b,0);
      if (total<=0) return {};
      const channel = k=>clamp(effective.reduce((sum,n,i)=>sum+n*(tints[i]?.[k] ?? 1),0)/total);
      const rgb = [0,1,2].map(channel);
      return mode==='alpha-blend' ? {tint:[...rgb,clamp(total)]} :
        {tint:size===4 ? [...rgb,channel(3)] : rgb,...(total<1-1e-12 && {tintCoverage:clamp(total)})};
    }
    const colors=rows.map(row=>stream(row,mode));
    const tint=Array.from({length:size},(_,k)=>clamp(weights.reduce((sum,n,i)=>sum+n*(colors[i][k] ?? 1),0)));
    return {tint};
  }
  return Object.freeze({read,generic,stream,sample,matches,modes,clear,midpoint,neutral});
})();

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

  function quadDiagonal(id, raw, corners) {
    if (raw === undefined) return;
    const slots = Array.isArray(raw) && raw.map(value=>corners.findIndex(corner=>corner.id===value));
    if (corners.length !== 4 || !slots || slots.length !== 2 || !Array.from(slots).every(i=>i>=0) ||
        Math.abs(slots[0]-slots[1]) !== 2)
      throw new RangeError('Face ' + id + ' diagonal needs two opposite corner IDs on a quad');
    return frozen(pair(...raw));
  }

  function quadSource(raw) {
    if (raw === undefined) return;
    const keys = ['mesh','face','revision','corners'];
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key=>!keys.includes(key)) ||
        ![raw.mesh,raw.face,raw.revision].every(name) || !Array.isArray(raw.corners) || raw.corners.length !== 3 ||
        !Array.from(raw.corners).every(name) || new Set(raw.corners).size !== 3)
      throw new TypeError('A quad split source needs a mesh, face, revision and three distinct source corners');
    return frozen({mesh:raw.mesh,face:raw.face,revision:raw.revision,corners:frozen(raw.corners.slice())});
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
    if (face.diagonal) {
      const first = face.corners.findIndex(corner=>corner.id===face.diagonal[0]);
      const [a,b,c,d] = [0,1,2,3].map(i=>(first+i)%4);
      const explicit = [[a,b,c],[a,c,d]];
      if (explicit.some(tri=>turn(...tri.map(i=>projected[i]))*Math.sign(normal[axis]) <= epsilon))
        throw new RangeError('Face ' + face.id + ' diagonal would leave the quad or collapse a triangle');
      return explicit;
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

  function skinSettings(value) {
    if (value === undefined || value === null) return;
    const { joints, locked = [], mirrors = [], fallback = joints?.[0] } = value;
    const jointName = id => TargetSelectors.name(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
    const roster = Array.isArray(joints) && new Set(joints);
    if (Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !['joints', 'locked', 'mirrors', 'fallback'].includes(key)) ||
        !roster || !roster.size || roster.size > 256 || roster.size !== joints.length ||
        !Array.from(roster).every(jointName) || !roster.has(fallback) ||
        !Array.isArray(locked) || new Set(locked).size !== locked.length || !Array.from(locked).every(id => roster.has(id)) ||
        !Array.isArray(mirrors) || !Array.from(mirrors).every(pair => Array.isArray(pair) && vector(pair, 2, id => roster.has(id))) ||
        new Set(mirrors.flat()).size !== mirrors.length * 2)
      throw new TypeError('Mesh skin needs unique joint IDs, a known fallback, valid locks, and disjoint mirror pairs');
    return frozen({ joints:frozen(joints.slice()), fallback, locked:frozen(joints.filter(id => locked.includes(id))),
      mirrors:frozen(mirrors.map(pair => frozen(pair.slice()))) });
  }

  function cornerAttributes(value, face) {
    if (value === undefined) return undefined;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('Face ' + face + ' needs named corner attributes');
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [channel, data] of entries) {
      if (channel.startsWith('uv/') && (!MaterialUV.isKey(channel) || !vector(data, 2, unit)))
        throw new RangeError('Alternate UV corner attributes need uv/1 through uv/31 and a normalized UV pair');
      if (!name(channel) || ['__proto__', 'prototype', 'constructor'].includes(channel) ||
          !(Number.isFinite(data) || Array.isArray(data) && data.length >= 1 && data.length <= 4 && Array.from(data).every(Number.isFinite)))
        throw new TypeError('Face ' + face + ' corner attributes need finite scalars or vectors of up to four values');
    }
    return frozen(Object.fromEntries(entries.map(([key, data]) => [key, Array.isArray(data) ? frozen(data.slice()) : data])));
  }

  function edgeSettings({ smooth, crease, uvSeam, uvSeams }) {
    const alternate=MaterialUV.flags(uvSeams);
    if (smooth !== undefined && typeof smooth !== 'boolean' || crease !== undefined && !unit(crease) ||
        uvSeam !== undefined && typeof uvSeam !== 'boolean')
      throw new RangeError('Edge smooth and UV seam need booleans and crease needs a weight in [0, 1]');
    return { ...(smooth !== undefined && { smooth }), ...(crease !== undefined && { crease }), ...(uvSeam && { uvSeam }), ...(alternate && {uvSeams:alternate}) };
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
    const { format: type = format, version = 1, id, shading: authoredShading, skin: authoredSkin, vertices: inputVertices,
      edges: inputEdges = [], faces: inputFaces, uvBindings:inputBindings, uvPivots:inputPivots, tintBlend:inputTintBlend } = source ?? {};
    if (type !== format || version !== 1 || !name(id))
      throw new TypeError('Use a version 1 mesh topology document with a mesh ID');
    const shading = shadingSettings(authoredShading), skin = skinSettings(authoredSkin), vertices = new Map(), uvBindings=MaterialUV.bindings(inputBindings);
    if (inputTintBlend!==undefined && !meshCornerTint.modes.includes(inputTintBlend))
      throw new TypeError('Use multiply, replace, alpha-blend, or midpoint tint');
    const tintBlend = inputTintBlend;
    const uvPivots = MaterialUV.pivots(inputPivots);
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
      authoredEdges.set(endpoints, { id: key, ...edgeSettings(edge) });
    }

    const corners = new Set(), edges = new Map(), faces = [], triangles = [];
    for (const [key, row] of index(inputFaces, 'Faces')) {
      const { material = 'default', smoothingGroup } = row;
      if (smoothingGroup !== undefined && !isMeshSmoothingGroup(smoothingGroup))
        throw new TypeError('A face smoothing group needs a nonempty name or nonnegative integer');
      if (!name(material) || !Array.isArray(row.corners) || row.corners.length < 3 || row.corners.length > maxCornersPerFace)
        throw new RangeError('Face ' + key + ' needs a material ID and 3 to ' + maxCornersPerFace + ' corners');
      if (triangles.length + row.corners.length - 2 > maxTriangles)
        throw new RangeError('Mesh topology exceeds the render triangle budget');
      const used = new Set();
      let layout;
      const ring = frozen(Array.from(row.corners, corner => {
        const { id: cornerId, vertex, uv = [0, 0], uvPinned } = corner ?? {};
        if (!name(cornerId) || corners.has(cornerId) || !vertices.has(vertex) || used.has(vertex) || !vector(uv, 2, unit) ||
            uvPinned !== undefined && typeof uvPinned !== 'boolean')
          throw new RangeError('Face ' + key + ' needs unique corners, distinct existing vertices and normalized UV pairs with optional boolean pins');
        corners.add(cornerId);
        used.add(vertex);
        const attributes = cornerAttributes(corner.attributes, key), normal = cornerNormal(corner.normal);
        if (attributes?.tintCoverage!==undefined && (!unit(attributes.tintCoverage) || !meshCornerTint.read({attributes})))
          throw new RangeError('Corner tint coverage needs a normalized tint and unit weight');
        const uvPins=MaterialUV.flags(corner.uvPins);
        if (uvPins && Object.keys(uvPins).some(set=>!attributes?.[MaterialUV.key(set)]))
          throw new RangeError('Pin an authored UV layout on corner '+cornerId);
        const shape = JSON.stringify(Object.entries(meshCornerTint.generic({attributes}) ?? {})
          .map(([id, data]) => [id, Array.isArray(data) ? data.length : 0]));
        if (layout !== undefined && layout !== shape) throw new TypeError('Face ' + key + ' must use one corner attribute layout');
        layout = shape;
        return frozen({ id: cornerId, vertex, uv: frozen(Array.from(uv)), ...(attributes && { attributes }),
          ...(normal && { normal }), ...(uvPinned && { uvPinned }), ...(uvPins && {uvPins}) });
      }));
      const diagonal = quadDiagonal(key,row.diagonal,ring);
      const sourceQuad = quadSource(row.sourceQuad);
      const face = frozen({ id: key, material, corners:ring, ...(diagonal && {diagonal}), ...(sourceQuad && {sourceQuad}),
        ...(smoothingGroup !== undefined && {smoothingGroup}) });
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
    const usedSets=new Set(Object.values(uvBindings ?? {}).filter(Boolean));
    if (usedSets.size && (!faces.length || faces.some(face=>[...usedSets].some(set=>!MaterialUV.uv(face.corners[0],set)))))
      throw new RangeError('A bound UV layout needs authored coordinates on every face');
    const doc = frozen({ format, version, id, vertices: frozen([...vertices.values()]),
      edges: frozen(retainedEdges.map(({ uses, ...edge }) => frozen(edge))), faces: frozen(faces),
      ...(shading && { shading }), ...(skin && { skin }), ...(uvBindings && {uvBindings}), ...(uvPivots && {uvPivots}), ...(tintBlend && {tintBlend}) });
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

  function edit(source, { vertices = [], faces = [], removeVertices = [], removeFaces = [], edges = [], shading, uvBindings, skin, uvPivots, tintBlend } = {}) {
    const doc = create(source), prior = new Map(doc.vertices.map(row => [row.id, row]));
    const updates = [...index(vertices, 'Updated vertices').values()].map(row => {
      const { id, position, weights = prior.get(row.id)?.weights } = row;
      return { id, position, ...(weights !== undefined && weights !== null && { weights }) };
    });
    const nextFaces = apply(doc.faces,faces,removeFaces,'faces');
    const byEdge = index(edges, 'Updated edges'), knownEdges = new Set(doc.edges.map(edge => edge.id));
    for (const [id, edge] of byEdge) {
      if (Object.keys(edge).some(key => !['id', 'smooth', 'crease', 'uvSeam', 'uvSeams'].includes(key)))
        throw new RangeError('Update smooth, crease, or UV seam on a retained edge ' + id);
    }
    const edgeRows = doc.edges.map(edge => {
      const changes = byEdge.get(edge.id);
      if (!changes) return edge;
      const { id, vertices, smooth, crease, uvSeam, uvSeams } = { ...edge, ...changes };
      return { id, vertices, ...edgeSettings({ smooth: smooth ?? undefined, crease: crease ?? undefined, uvSeam, uvSeams }) };
    });
    const pending = new Set([...byEdge.keys()].filter(id=>!knownEdges.has(id)));
    if (pending.size) {
      const existing = new Set(doc.edges.map(edge=>edgeKey(...edge.vertices)));
      for (const face of nextFaces) for (const [i,corner] of (face.corners ?? []).entries()) {
        const next = face.corners[(i+1)%face.corners.length];
        const key = edgeKey(corner.vertex,next.vertex), id = 'edge/'+key;
        if (!existing.has(key) && pending.delete(id))
          edgeRows.push({id,vertices:pair(corner.vertex,next.vertex),...edgeSettings(byEdge.get(id))});
      }
      if (pending.size) throw new RangeError('No retained or newly created edge ' + pending.values().next().value);
    }
    return build({ ...doc, edges: edgeRows, uvBindings:uvBindings ?? doc.uvBindings, shading: shading === undefined ? doc.shading : shading,
      uvPivots:uvPivots === undefined ? doc.uvPivots : uvPivots,
      skin: skin === undefined ? doc.skin : skin, tintBlend:tintBlend ?? doc.tintBlend,
      vertices: apply(doc.vertices, updates, removeVertices, 'vertices'),
      faces: nextFaces
    }, true);
  }

  function inspect(source) {
    const doc = create(source);
    const { edges, triangles } = documents.get(doc);
    return { id: doc.id, vertices: doc.vertices.length, faces: doc.faces.length, triangles: triangles.length,
      edges: edges.map(({ uses, ...edge }) => ({ ...edge, uses: uses.slice() })) };
  }

  function fromIndexed({ id, positions, indices, uvs, normals, materials = ['default'], faceMaterials, weights, skin } = {}) {
    if (!list(positions) || positions.length % 3 || !list(indices) || indices.length % 3 ||
        indices.length / 3 > maxTriangles || indices.length && !positions.length ||
        normals !== undefined && (!list(normals) || normals.length !== positions.length) ||
        uvs !== undefined && (!list(uvs) || uvs.length !== positions.length / 3 * 2) ||
        weights !== undefined && (!Array.isArray(weights) || weights.length !== positions.length / 3) ||
        faceMaterials !== undefined && (!list(faceMaterials) || faceMaterials.length !== indices.length / 3) ||
        !Array.isArray(materials) || !materials.length || !Array.from(materials).every(name) ||
        new Set(materials).size !== materials.length ||
        !Array.from(indices).every(i => Number.isSafeInteger(i) && i >= 0 && i < positions.length / 3))
      throw new RangeError('Use indexed triangle positions, indices, optional UVs and face material slots');
    const vertices = Array.from({ length: positions.length / 3 }, (_, i) =>
      ({ id: 'v/' + i, position: positions.slice(i * 3, i * 3 + 3), weights:weights?.[i] }));
    const faces = Array.from({ length: indices.length / 3 }, (_, i) => {
      const slot = faceMaterials === undefined ? 0 : faceMaterials[i];
      if (!Number.isSafeInteger(slot) || !materials[slot]) throw new RangeError('Missing material slot for triangle ' + i);
      return { id: 'f/' + i, material: materials[slot], corners: [0, 1, 2].map(j => {
        const offset = i * 3 + j, vertex = indices[offset];
        return { id: 'c/' + offset, vertex: vertices[vertex].id, uv: uvs?.slice(vertex * 2, vertex * 2 + 2),
          normal: normals?.slice(vertex * 3, vertex * 3 + 3) };
      }) };
    });
    return create({ id, vertices, faces, skin });
  }

  function renderGeometry(source) {
    const doc = create(source);
    const { vertices, triangles, edges } = documents.get(doc);
    const directions = meshTopologyShading.resolve(doc, edges, vertices);
    const positions = [], uvs = [], normals = [], indices = [], materials = [], faceMaterials = [], triangleSources = [];
    const sets=new Set(doc.faces.flatMap(row=>MaterialUV.setsOf(row.corners[0])));
    const uvSets=Object.fromEntries([...sets].sort((a,b)=>a-b).map(set=>[set,[]]));
    const renderVertices = new Map(), vertexSources = [], slots = new Map();
    let cornerTints;
    const mode = doc.tintBlend ?? 'multiply', channels = mode==='multiply' ? 3 : 4;
    const blank = mode==='multiply' ? meshCornerTint.neutral : mode==='midpoint' ? meshCornerTint.midpoint : meshCornerTint.clear;
    for (const { face, local } of triangles) {
      if (!slots.has(face.material)) {
        slots.set(face.material, materials.length);
        materials.push(face.material);
      }
      faceMaterials.push(slots.get(face.material));
      const corners = local.map(i => face.corners[i]);
      const active = directions && corners.some(row => directions.has(row.id));
      const geometric = active && meshTopologyShading.triangleNormal(corners.map(row => vertices.get(row.vertex).position));
      for (const { id, vertex, uv, attributes } of corners) {
        const normal = active && (directions.get(id) ?? geometric);
        const alternate=Object.keys(uvSets).map(set=>attributes?.[MaterialUV.key(set)] ?? null);
        const key = JSON.stringify([vertex,...uv,...(normal || []),...alternate]);
        if (!renderVertices.has(key)) {
          renderVertices.set(key, positions.length / 3);
          vertexSources.push(vertex);
          positions.push(...vertices.get(vertex).position);
          uvs.push(...uv);
          Object.values(uvSets).forEach((rows,i)=>rows.push(...(alternate[i] ?? [0,0])));
          if (directions) normals.push(...(normal || [0, 0, 0]));
        }
        const color = meshCornerTint.stream({attributes},mode);
        if (!cornerTints && blank.some((value,k)=>k<(mode==='midpoint' ? 3 : channels) && value!==color[k])) {
          cornerTints = new Array(indices.length*channels);
          for (let i=0;i<cornerTints.length;i++) cornerTints[i]=blank[i%channels];
        }
        if (cornerTints) {
          cornerTints.push(color[0],color[1],color[2]);
          if (channels===4) cornerTints.push(mode==='midpoint' ? 1 : color[3]);
        }
        indices.push(renderVertices.get(key));
      }
      triangleSources.push(frozen({ face: face.id, corners: frozen(corners.map(corner => corner.id)) }));
    }
    return { positions, uvs, ...(sets.size && {uvSets}), ...(doc.uvBindings && {uvBindings:doc.uvBindings}), ...(directions && { normals }), ...(cornerTints && {cornerTints}), ...(doc.tintBlend && {tintBlend:doc.tintBlend}), indices, materials, faceMaterials, triangleSources, vertexSources };
  }

  function triangulate(source) {
    const { vertexSources, ...geometry } = renderGeometry(source);
    return geometry;
  }

  function toSceneMesh(source, { materials, objectId, partId, meshId, frame, tileWraps } = {}) {
    const doc = create(source);
    const { materials: slots, triangleSources, vertexSources, ...geometry } = renderGeometry(doc);
    if (!triangleSources.length) throw new RangeError('Add at least one polygon before rendering a mesh topology');
    const options = materials === undefined ? null : index(materials, 'Materials');
    const definitions = slots.map(id => {
      if (options && !options.has(id)) throw new RangeError('Missing mesh material ' + id);
      return options?.get(id) ?? { id };
    });
    if (frame) {
      const place = K.sceneGraph.transform(frame);
      const map = (values, point) => {
        const output = new Array(values.length);
        for (let i = 0; i < values.length; i += 3)
          [output[i], output[i + 1], output[i + 2]] = point(values.slice(i, i + 3));
        return output;
      };
      geometry.positions = map(geometry.positions, value => K.sceneGraph.point(place, value));
      if (K.M.det(place.matrix) < 0) for (const [i,source] of triangleSources.entries()) {
        const j = i*3;
        [geometry.indices[j+1],geometry.indices[j+2]] = [geometry.indices[j+2],geometry.indices[j+1]];
        const [a,b,c] = source.corners;
        triangleSources[i] = frozen({face:source.face,corners:frozen([a,c,b])});
      }
      if (geometry.normals) {
        const normals = K.M.tr(K.sceneGraph.inverse(place).matrix);
        geometry.normals = map(geometry.normals, value => K.M.app(normals, value));
      }
    }
    const mesh = K.sceneMeshes.create({ id: meshId ?? doc.id, objectId, partId, ...geometry, materials: definitions });
    const layer=K.sceneMeshes.layer(mesh);
    layer.featureFaces=Array.from({length:mesh.triangles},(_,i)=>triangleSources[K.sceneMeshes.sourceTriangle(mesh,i)].face);
    if (tileWraps?.size) K.sceneMeshes.bindTileWraps(mesh,tileWraps);
    renderSources.set(mesh, { document: doc, triangles: triangleSources, vertices: vertexSources });
    return mesh;
  }

  function triangleSource(mesh, triangle) {
    return Number.isSafeInteger(triangle) && triangle >= 0 ? renderSources.get(mesh)?.triangles[triangle] ?? null : null;
  }

  function revision(source) {
    const doc = create(source);
    if (!revisions.has(doc)) {
      // Pivot placement alone leaves revision-checked geometry and UV selections usable.
      const {uvPivots,...geometry} = doc;
      const text = JSON.stringify(uvPivots ? geometry : doc), { hash } = K.procedural.data;
      revisions.set(doc, [text.length, hash(text), hash(text, 0x9e3779b9)].map(n => n.toString(36)).join('-'));
    }
    return revisions.get(doc);
  }

  function sourceVertex(mesh, vertex) {
    return Number.isSafeInteger(vertex) && vertex >= 0 ? renderSources.get(mesh)?.vertices[vertex] ?? null : null;
  }
  const sourceDocument = mesh => renderSources.get(mesh)?.document ?? null;
  K.meshTopology = frozen({ create, edit, inspect, fromIndexed, triangulate, toSceneMesh, triangleSource, sourceVertex, sourceDocument, revision });
})(KIT);
