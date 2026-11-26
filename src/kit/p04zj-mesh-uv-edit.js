/* UV editing operates on retained corners and keeps geometric topology stable. */
(function (K) {
  const topology = K.meshTopology, { V } = K;
  const { sameUV, area2 } = MeshUV;
  const selectionFormat = 'ink-studio/uv-selection';
  const graphCache = new WeakMap(), domains = ['islands', 'faces', 'edges', 'corners'];
  const fields = (value, allowed) => !!value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => allowed.includes(key));
  const tuple = (value, length, check = Number.isFinite) =>
    Array.isArray(value) && value.length === length && Array.from(value).every(check);
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const order = values => [...new Set(values)].sort();
  const index = rows => new Map(rows.map(row => [row.id, row]));

  function sets(values) {
    const parent = new Map([...values].map(id => [id, id]));
    function root(id) {
      while (parent.get(id) !== id) {
        parent.set(id, parent.get(parent.get(id)));
        id = parent.get(id);
      }
      return id;
    }
    return { root, join(a, b) {
      a = root(a); b = root(b);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    } };
  }

  function graph(source, selector = 0) {
    const doc = topology.create(source), set=MaterialUV.resolve(doc.uvBindings,selector);
    if (!graphCache.has(doc)) graphCache.set(doc,new Map());
    const cached=graphCache.get(doc);
    if (cached.has(set)) return cached.get(set);
    const byFace=index(doc.faces);
    const vertices=index(doc.vertices), faces=set ? index(doc.faces.map(face=>({...face,
      corners:face.corners.map(row=>{
        const uv=MaterialUV.uv(row,set);
        if (!uv) throw new RangeError('UV set '+set+' is missing on corner '+row.id);
        return {...row,uv,uvPinned:MaterialUV.pinned(row,set)};
      })}))) : byFace, corners=new Map(), edges=new Map();
    const faceEdges = new Map(doc.faces.map(face => [face.id, []]));
    for (const face of faces.values()) for (const corner of face.corners)
      corners.set(corner.id, { ...corner, face: face.id, position: vertices.get(corner.vertex).position });
    const islandsSet = sets(faces.keys()), weldSet = sets(corners.keys());
    for (const edge of topology.inspect(doc).edges) {
      const sides = edge.uses.map(({ face, from, to }) => {
        const ordered = corners.get(from).vertex === edge.vertices[0] ? [from, to] : [to, from];
        faceEdges.get(face).push(edge.id);
        return { face, corners: ordered, uv: ordered.map(id => corners.get(id).uv) };
      }).sort((a, b) => a.face < b.face ? -1 : 1);
      const [a, b] = sides, manifold = sides.length === 2, authored=MaterialUV.seam(edge,set);
      const kind = sides.length === 1 ? 'boundary' : !manifold ? 'non-manifold' :
        faces.get(a.face).material !== faces.get(b.face).material ? 'material-boundary' :
        authored || !a.uv.every((uv, j) => sameUV(uv, b.uv[j])) ? 'seam' : 'continuous';
      if (kind === 'continuous') {
        islandsSet.join(a.face, b.face);
        a.corners.forEach((id, i) => weldSet.join(id, b.corners[i]));
      }
      edges.set(edge.id, { id: edge.id, kind, authored, vertices: edge.vertices, sides });
    }
    const islands = new Map(), atIsland = new Map(), welds = new Map(), atWeld = new Map();
    for (const id of order(faces.keys())) {
      const key = islandsSet.root(id), face = faces.get(id);
      if (!islands.has(key)) islands.set(key, { id: key, material: face.material, faces: [] });
      const row = islands.get(key);
      row.faces.push(id);
      atIsland.set(id, key);
      for (const corner of face.corners) {
        const weld = weldSet.root(corner.id);
        atWeld.set(corner.id, weld);
        if (!welds.has(weld)) welds.set(weld, []);
        welds.get(weld).push(corner.id);
      }
    }
    for (const row of islands.values()) {
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const id of row.faces) for (const { uv: [u, v] } of faces.get(id).corners) {
        bounds[0] = Math.min(bounds[0], u); bounds[1] = Math.min(bounds[1], v);
        bounds[2] = Math.max(bounds[2], u); bounds[3] = Math.max(bounds[3], v);
      }
      row.bounds = bounds;
    }
    const triangles = () => topology.triangulate(doc).triangleSources;
    const data = { doc,set,byFace,faces, corners, edges, islands, atIsland, faceEdges, welds, atWeld, triangles };
    cached.set(set, data);
    return data;
  }

  function sourceInfo(doc, format) {
    return { format, version: 1, mesh: doc.id, revision: topology.revision(doc) };
  }

  function inspect(source, uvSet = 0, { atlas, atlasFor } = {}) {
    const g = graph(source,uvSet);
    if (atlas !== undefined && !tuple(atlas,2,n=>Number.isSafeInteger(n) && n>0))
      throw new RangeError('UV inspection atlas needs positive integer width and height');
    const explicit = atlas && {kind:'explicit',size:atlas.slice()};
    const sources = new Map();
    if (explicit || atlasFor) for (const {id,material} of g.faces.values()) {
      const resolved = explicit ?? atlasFor?.(material);
      if (resolved) sources.set(id,resolved);
    }
    const toTexel = (face,uv)=>MaterialUV.texel(uv,...sources.get(face).size);
    return {
      ...sourceInfo(g.doc, 'ink-studio/uv-layout'),
      ...(g.set && {uvSet:g.set}), ...(g.doc.uvBindings && {uvBindings:g.doc.uvBindings}),
      ...(sources.size && {texelCoordinates:{origin:'top-left',units:'texel-centers'}}),
      islands: Array.from(g.islands.values(), row => ({ ...row, faces: row.faces.slice(), bounds: row.bounds.slice() })),
      faces: Array.from(g.faces.values(), face => ({ id: face.id, material: face.material, island: g.atIsland.get(face.id),
        corners: face.corners.map(row => row.id), edges: g.faceEdges.get(face.id).slice(),
        ...(sources.has(face.id) && {atlas:sources.get(face.id)}) })),
      edges: Array.from(g.edges.values(), row => ({ ...row, vertices: row.vertices.slice(),
        sides: row.sides.map(({face,corners,uv})=>({face,corners:corners.slice(),uv:uv.map(p=>p.slice()),
          ...(sources.has(face) && {texels:uv.map(pair=>toTexel(face,pair))})})) })),
      corners: Array.from(g.corners.values(), ({ id, vertex, uv, face, uvPinned }) =>
        ({ id, vertex, face, uv: uv.slice(), pinned: Boolean(uvPinned), weld: g.atWeld.get(id),
          ...(sources.has(face) && {texel:toTexel(face,uv)}) }))
    };
  }

  function known(g, domain, ids) {
    if (!Array.isArray(ids) || Array.from(ids).some(id => !g[domain].has(id)))
      throw new RangeError('Choose existing UV ' + domain + ' by their stable IDs');
    return order(ids);
  }

  function selection(g, domain, ids, hit) {
    const selectedFaces = domain === 'islands' ? ids.flatMap(id => g.islands.get(id).faces) :
      domain === 'corners' ? ids.map(id => g.corners.get(id).face) :
      domain === 'edges' ? ids.flatMap(id => g.edges.get(id).sides.map(side => side.face)) : ids;
    const faces = order(selectedFaces);
    return { ...sourceInfo(g.doc, selectionFormat), ...(g.set && {uvSet:g.set}), domain, ids, faces,
      islands: order(faces.map(face => g.atIsland.get(face))),
      corners: domain === 'corners' ? ids : order(domain === 'edges' ?
        ids.flatMap(id => g.edges.get(id).sides.flatMap(side => side.corners)) :
        faces.flatMap(id => g.faces.get(id).corners.map(row => row.id))),
      edges: domain === 'edges' ? ids : order(domain === 'corners' ?
        ids.flatMap(id => {
          const corner = g.corners.get(id);
          return g.faceEdges.get(corner.face).filter(edge => g.edges.get(edge).vertices.includes(corner.vertex));
        }) : faces.flatMap(id => g.faceEdges.get(id))),
      ...(hit && { hit }) };
  }

  function segmentDistance(point, a, b) {
    const relative = b.map((n, i) => n - a[i]), delta = point.map((n, i) => n - a[i]);
    const length = relative.reduce((sum, n) => sum + n * n, 0);
    const t = length ? Math.min(1, Math.max(0, delta.reduce((sum, n, i) => sum + n * relative[i], 0) / length)) : 0;
    return Math.hypot(...delta.map((n, i) => n - t * relative[i]));
  }

  function atlasSelection(g, domain, { at, radius = .015, material, face }) {
    if (!tuple(at, 2, unit) || !unit(radius) || radius > .25 ||
        material !== undefined && ![...g.islands.values()].some(row => row.material === material) ||
        face !== undefined && (!g.faces.has(face) || material !== undefined && g.faces.get(face).material !== material))
      throw new RangeError('Atlas selection needs normalized UV, a valid face or material, and a radius up to .25');
    const belongs = id => (face === undefined || face === id) && (material === undefined || g.faces.get(id).material === material);
    const candidates = [];
    if (domain === 'corners') for (const row of g.corners.values()) {
      if (belongs(row.face)) candidates.push({ id: row.id, face: row.face, distance: Math.hypot(at[0] - row.uv[0], at[1] - row.uv[1]) });
    } else if (domain === 'edges') for (const row of g.edges.values()) {
      for (const side of row.sides) if (belongs(side.face))
        candidates.push({ id: row.id, face: side.face, distance: segmentDistance(at, ...side.uv) });
    } else {
      for (const row of g.triangles()) {
        if (!belongs(row.face)) continue;
        const [a, b, c] = row.corners.map(id => g.corners.get(id).uv);
        const area = area2(a, b, c);
        if (Math.abs(area) <= 1e-12) continue;
        const inside = [area2(a, b, at), area2(b, c, at), area2(c, a, at)].every(n => n / area >= -1e-8);
        if (inside) candidates.push({ id: domain === 'faces' ? row.face : g.atIsland.get(row.face), face: row.face, distance: 0 });
      }
    }
    let closest = Infinity;
    for (const row of candidates) closest = Math.min(closest, row.distance);
    const tied = closest <= radius ? candidates.filter(row => row.distance <= closest + 1e-7) : [];
    const ids = order(tied.map(row => row.id));
    const welded = domain === 'corners' && new Set(ids.map(id => g.atWeld.get(id))).size === 1;
    const status = !ids.length ? 'miss' : ids.length === 1 || welded ? 'hit' : 'ambiguous';
    return selection(g, domain, status === 'hit' ? ids : [], { space: 'atlas', at: at.slice(), status,
      candidates: ids, faces: order(tied.map(row => row.face)) });
  }

  function select(source, query = {}) {
    if (!fields(query, ['domain', 'ids', 'atlas', 'from', 'uvSet', 'tint']) || !domains.includes(query.domain) ||
        [query.ids, query.atlas, query.from, query.tint].filter(n => n !== undefined).length !== 1)
      throw new TypeError('Choose a UV selection domain and IDs, an atlas location, a tint, or a saved selection');
    const g = graph(source,query.uvSet ?? query.from?.uvSet ?? 0), { domain, ids, atlas, from, tint } = query;
    if (tint !== undefined) {
      if (domain !== 'faces' || !fields(tint, ['color', 'tolerance', 'match']))
        throw new TypeError('A vertex tint query needs the faces domain and a tint object');
      const { color, tolerance = 0, match = 'any' } = tint;
      if (!(tuple(color, 3, unit) || tuple(color, 4, unit)) || !unit(tolerance) || !['any', 'all'].includes(match))
        throw new RangeError('Vertex tint needs normalized RGB or RGBA, a channel tolerance in [0, 1], and any or all corners');
      const matched = [];
      for (const face of g.faces.values()) {
        const corners = face.corners.filter(({ attributes: { tint: value } = {} }) =>
          (tuple(value, 3, unit) || tuple(value, 4, unit)) &&
          color.every((channel, i) => Math.abs(channel - (value[i] ?? 1)) <= tolerance + (tolerance ? Number.EPSILON : 0)));
        if (corners.length && (match === 'any' || corners.length === face.corners.length))
          matched.push({ face: face.id, corners: order(corners.map(corner => corner.id)) });
      }
      matched.sort((a, b) => a.face < b.face ? -1 : a.face > b.face ? 1 : 0);
      return { ...selection(g, domain, matched.map(row => row.face)), tint: { color: color.slice(), tolerance, match, matches: matched } };
    }
    if (atlas !== undefined) {
      if (!fields(atlas, ['at', 'radius', 'face', 'material'])) throw new TypeError('Invalid UV atlas pick');
      return atlasSelection(g, domain, atlas);
    }
    if (from !== undefined && (from?.format !== selectionFormat || from.version !== 1 || from.mesh !== g.doc.id ||
        from.revision !== topology.revision(g.doc) || from.domain !== domain || (from.uvSet ?? 0)!==g.set))
      throw new RangeError('Use a UV selection from this mesh revision and domain');
    return selection(g, domain, known(g, domain, from === undefined ? ids : from.ids), from?.hit);
  }

  function modelHit(mesh, frame, x, y) {
    const { w, h, passes } = frame, p = y * w + x;
    const slot = passes.surfaceSources[passes.sourceSurface[p]];
    if (slot?.kind !== 'mesh' || slot.asset !== mesh.id || slot.object !== mesh.objectId ||
        (slot.part ?? undefined) !== mesh.partId) return null;
    const draw = slot.primitive / 3 + passes.sourceTriangle[p];
    const triangle = K.sceneMeshes.sourceTriangle(mesh, draw), source = topology.triangleSource(mesh, triangle);
    if (!source) return null;
    return { ...source, triangle, weights: Array.from(passes.sourceCoordinates.subarray(p * 3, p * 3 + 3)) };
  }

  function pickModel(mesh, frame, pixel, domain = 'faces', uvSet = 0) {
    const source = topology.sourceDocument(mesh), { w, h, passes } = frame ?? {};
    if (!source || !domains.includes(domain) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
        !tuple(pixel, 2, Number.isSafeInteger) || pixel[0] < 0 || pixel[0] >= w || pixel[1] < 0 || pixel[1] >= h ||
        passes?.sourceSurface?.length !== w * h || passes.sourceTriangle?.length !== w * h ||
        passes.sourceCoordinates?.length !== w * h * 3 || !Array.isArray(passes.surfaceSources))
      throw new TypeError('Model selection needs a retained mesh and an in-bounds pixel in native source passes');
    const g = graph(source,uvSet), hit = modelHit(mesh, frame, ...pixel);
    if (!hit) return selection(g, domain, [], { space: 'model', pixel: pixel.slice(), status: 'miss' });
    const { face, triangle, weights } = hit;
    const blend = (key, length) => Array.from({ length }, (_, k) =>
      hit.corners.reduce((sum, id, i) => sum + g.corners.get(id)[key][k] * weights[i], 0));
    const uv = blend('uv', 2), point = blend('position', 3), parent = g.faces.get(face);
    let id = domain === 'islands' ? g.atIsland.get(face) : face;
    if (domain === 'corners' || domain === 'edges') {
      const candidates = domain === 'corners' ?
        parent.corners.map(row => [row.id, V.dist(point, g.corners.get(row.id).position)]) :
        g.faceEdges.get(face).map(id => {
          const { corners } = g.edges.get(id).sides.find(row => row.face === face);
          return [id, segmentDistance(point, ...corners.map(id => g.corners.get(id).position))];
        });
      candidates.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      id = candidates[0][0];
    }
    return selection(g, domain, [id], { space: 'model', status: 'hit', pixel: pixel.slice(), face, triangle, weights, uv });
  }

  function modelFaces(mesh, frame) {
    const { w, h, passes } = frame;
    if (!topology.sourceDocument(mesh) || passes?.sourceSurface?.length !== w * h ||
        passes.sourceTriangle?.length !== w * h || !Array.isArray(passes.surfaceSources))
      throw new TypeError('A model face map needs native source passes for retained topology');
    const cache = new Map(), faceAt = new Int32Array(w * h).fill(-1), faces = [];
    const ids = new Map();
    for (let p = 0; p < faceAt.length; p++) {
      const slot = passes.surfaceSources[passes.sourceSurface[p]];
      if (slot?.kind !== 'mesh' || slot.asset !== mesh.id || slot.object !== mesh.objectId ||
          (slot.part ?? undefined) !== mesh.partId) continue;
      const draw = slot.primitive / 3 + passes.sourceTriangle[p];
      if (!cache.has(draw)) {
        const face = topology.triangleSource(mesh, K.sceneMeshes.sourceTriangle(mesh, draw))?.face;
        if (face !== undefined && !ids.has(face)) { ids.set(face, faces.length); faces.push(face); }
        cache.set(draw, ids.get(face) ?? -1);
      }
      faceAt[p] = cache.get(draw);
    }
    return { faces, faceAt };
  }

  function readability(mesh, frame, request) {
    const source = topology.sourceDocument(mesh), { w, h, passes } = frame ?? {};
    if (!source || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w * h > 1048576 ||
        passes?.sourceSurface?.length !== w * h || passes.sourceTriangle?.length !== w * h ||
        passes.sourceCoordinates?.length !== w * h * 3 || !Array.isArray(passes.surfaceSources) ||
        !fields(request, ['atlas', 'features']) || !Array.isArray(request.features) ||
        request.features.length < 1 || request.features.length > 128)
      throw new TypeError('Readability needs native mesh source passes, an atlas, and named face features');
    const atlas = meshUVRegions.grid(request.atlas), g = graph(source), seen = new Set(), byFace = new Map();
    const features = Array.from(request.features, row => {
      if (!fields(row, ['id', 'faces', 'minPixels', 'minTexelsPerPixel']) ||
          !meshUVRegions.name(row.id) || seen.has(row.id) ||
          row.minPixels !== undefined && !tuple(row.minPixels, 2, n => Number.isInteger(n) && n >= 1) ||
          row.minTexelsPerPixel !== undefined && (!Number.isFinite(row.minTexelsPerPixel) || row.minTexelsPerPixel <= 0))
        throw new RangeError('Readability features need distinct IDs and optional minimum size and sampling requirements');
      seen.add(row.id);
      const faces = known(g, 'faces', row.faces);
      if (!faces.length) throw new RangeError('Choose at least one readability face');
      const feature = { ...row, faces, bounds: [w, h, -1, -1], pixels: 0, sampling: [] };
      for (const id of faces) {
        if (!byFace.has(id)) byFace.set(id, []);
        byFace.get(id).push(feature);
      }
      return feature;
    });
    const lookup = new Map(), faceSlots = new Map(), faces = [];
    const owners = new Int32Array(w * h).fill(-1), uv = new Float64Array(w * h * 2);
    for (let p = 0; p < owners.length; p++) {
      const slot = passes.surfaceSources[passes.sourceSurface[p]];
      if (slot?.kind !== 'mesh' || slot.asset !== mesh.id || slot.object !== mesh.objectId ||
          (slot.part ?? undefined) !== mesh.partId) continue;
      const draw = slot.primitive / 3 + passes.sourceTriangle[p];
      if (!lookup.has(draw)) {
        const tri = topology.triangleSource(mesh, K.sceneMeshes.sourceTriangle(mesh, draw));
        if (!tri || !byFace.has(tri.face)) lookup.set(draw, null);
        else {
          if (!faceSlots.has(tri.face)) { faceSlots.set(tri.face, faces.length); faces.push(tri.face); }
          lookup.set(draw, { owner: faceSlots.get(tri.face), points: tri.corners.map(id => g.corners.get(id).uv) });
        }
      }
      const tri = lookup.get(draw);
      if (!tri) continue;
      owners[p] = tri.owner;
      for (let a = 0; a < 2; a++) for (let i = 0; i < 3; i++)
        uv[p * 2 + a] += tri.points[i][a] * passes.sourceCoordinates[p * 3 + i] * atlas[a];
    }
    let work = 16e6;
    for (let p = 0; p < owners.length; p++) {
      const owner = owners[p];
      if (owner < 0) continue;
      const x = p % w, y = Math.floor(p / w);
      const right = x + 1 < w && owners[p + 1] === owner ? 1 : x > 0 && owners[p - 1] === owner ? -1 : 0;
      const down = y + 1 < h && owners[p + w] === owner ? w : y > 0 && owners[p - w] === owner ? -w : 0;
      let sampling;
      if (right && down) {
        const a = uv[(p + right) * 2] - uv[p * 2], b = uv[(p + right) * 2 + 1] - uv[p * 2 + 1];
        const c = uv[(p + down) * 2] - uv[p * 2], d = uv[(p + down) * 2 + 1] - uv[p * 2 + 1];
        const det = a * d - b * c, trace = a * a + b * b + c * c + d * d;
        const larger = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * det * det))) / 2;
        sampling = larger ? Math.abs(det) / Math.sqrt(larger) : 0;
      }
      const visible = byFace.get(faces[owner]);
      if ((work -= visible.length) < 0) throw new RangeError('Readability crosses too many overlapping feature groups');
      for (const feature of visible) {
        const b = feature.bounds;
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        feature.pixels++;
        if (sampling !== undefined) feature.sampling.push(sampling);
      }
    }
    return { grid: [w, h], atlas, features: features.map(({ bounds, pixels, sampling, minPixels, minTexelsPerPixel, ...row }) => {
      const [x, y, r, b] = bounds, rect = pixels ? [x, y, r - x + 1, b - y + 1] : null;
      sampling.sort((a, b) => a - b);
      const quantile = q => sampling.length ? sampling[Math.floor((sampling.length - 1) * q)] : null;
      const p10 = quantile(.1), p50 = quantile(.5);
      const ready = !!rect && (!minPixels || rect[2] >= minPixels[0] && rect[3] >= minPixels[1]) &&
        (minTexelsPerPixel === undefined || p10 !== null && p10 >= minTexelsPerPixel);
      return { ...row, pixels, bounds: rect, samples: sampling.length, texelsPerPixel: { p10, p50 },
        ...(minPixels && { minPixels }), ...(minTexelsPerPixel !== undefined && { minTexelsPerPixel }), ready };
    }) };
  }

  function targets(g, domain, { ids, selection: saved }) {
    const result = saved === undefined ? known(g, domain, ids) :
      ids === undefined ? select(g.doc, { domain, from: saved, uvSet:g.set }).ids : [];
    if (!result.length) throw new RangeError('Choose at least one UV ' + domain + ' target');
    return result;
  }

  function seamEdges(g, ids) {
    const edges = ids.map(id => g.edges.get(id));
    if (edges.some(row => !['seam', 'continuous'].includes(row.kind)))
      throw new RangeError('Cut and stitch need two-sided manifold edges on one material sheet');
    return edges;
  }

  function islandWelds(g, id) {
    return order(g.islands.get(id).faces.flatMap(face => g.faces.get(face).corners.map(corner => g.atWeld.get(corner.id))));
  }

  function transform(g, operation, points) {
    if (!fields(operation, ['op', 'ids', 'selection', 'translate', 'rotation', 'scale', 'pivot']))
      throw new TypeError('Unknown UV transform setting');
    const ids = targets(g, 'islands', operation);
    const { translate = [0, 0], rotation = 0, scale = [1, 1], pivot } = operation;
    const sizes = typeof scale === 'number' ? [scale, scale] : scale;
    if (!tuple(translate, 2) || !Number.isFinite(rotation) || !tuple(sizes, 2, n => Number.isFinite(n) && n !== 0) ||
        pivot !== undefined && !tuple(pivot, 2, unit))
      throw new RangeError('UV transform needs a finite translation, radians, nonzero scale, and optional normalized pivot');
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    for (const id of ids) {
      const [l, t, r, b] = g.islands.get(id).bounds, [u, v] = pivot ?? [(l + r) / 2, (t + b) / 2];
      for (const key of islandWelds(g, id)) {
        const [a, b] = g.corners.get(key).uv, x = (a - u) * sizes[0], y = (b - v) * sizes[1];
        const uv = [u + translate[0] + x * cos - y * sin, v + translate[1] + x * sin + y * cos];
        for (const corner of g.welds.get(key)) points.set(corner, uv);
      }
    }
    return ids;
  }

  function align(g, edges, keep, points, conflict) {
    const fixed = side => g.atIsland.get(side.face) === keep;
    const pairs = edges.map(edge => ({
      id: edge.id, fixed: edge.sides.find(fixed), moving: edge.sides.find(side => !fixed(side))
    }));
    if (pairs.some(pair => !pair.fixed || !pair.moving) ||
        new Set(pairs.map(pair => g.atIsland.get(pair.moving.face))).size !== 1) {
      conflict('alignment-needs-two-islands', { edges: edges.map(row => row.id) });
      return;
    }
    const [pair] = pairs, [[ax, ay], [bx, by]] = pair.moving.uv, [[u, v], [x, y]] = pair.fixed.uv;
    const sx = bx - ax, sy = by - ay, tx = x - u, ty = y - v, length2 = sx * sx + sy * sy;
    if (length2 <= 1e-14 || tx * tx + ty * ty <= 1e-14) {
      conflict('degenerate-seam', { edge: pair.id });
      return;
    }
    const real = (tx * sx + ty * sy) / length2, imaginary = (ty * sx - tx * sy) / length2;
    for (const key of islandWelds(g, g.atIsland.get(pair.moving.face))) {
      const [a, b] = g.corners.get(key).uv, dx = a - ax, dy = b - ay;
      const uv = [u + real * dx - imaginary * dy, v + imaginary * dx + real * dy];
      for (const id of g.welds.get(key)) points.set(id, uv);
    }
    for (const { id, fixed, moving } of pairs)
      if (moving.corners.some((corner, i) => !sameUV(points.get(corner), fixed.uv[i])))
        conflict('unaligned-seam', { edge: id });
  }

  function stitch(g, operation, points, edges, conflict) {
    if (!fields(operation, ['op', 'ids', 'selection', 'mode', 'keepFace']))
      throw new TypeError('Unknown UV stitch setting');
    const ids = targets(g, 'edges', operation), joins = seamEdges(g, ids);
    const { mode = 'weld', keepFace } = operation, keep = g.atIsland.get(keepFace);
    if (!['weld', 'align'].includes(mode) || (mode === 'align' || keepFace !== undefined) && keep === undefined ||
        keep !== undefined && !joins.some(row => row.sides.some(side => g.atIsland.get(side.face) === keep)))
      throw new RangeError('Choose weld or align and a retained keeper face incident to the seam island');
    if (mode === 'align') align(g, joins, keep, points, conflict);

    const getUV = id => points.get(id) ?? g.corners.get(id).uv;
    const keys = order(joins.flatMap(row => row.sides.flatMap(side => side.corners.map(id => g.atWeld.get(id)))));
    const joined = sets(keys), preferred = new Map();
    for (const { sides: [a, b] } of joins) for (let i = 0; i < 2; i++) {
      joined.join(g.atWeld.get(a.corners[i]), g.atWeld.get(b.corners[i]));
      const fixed = [a, b].filter(side => g.atIsland.get(side.face) === keep);
      const chosen = fixed.find(side => side.face === keepFace) ?? (fixed.length === 1 ? fixed[0] : undefined);
      if (chosen) preferred.set(chosen.corners[i], g.corners.get(chosen.corners[i]).uv);
    }
    const packets = new Map();
    for (const key of keys) {
      const root = joined.root(key);
      if (!packets.has(root)) packets.set(root, []);
      packets.get(root).push(key);
    }
    for (const group of packets.values()) {
      const corners = group.flatMap(key => g.welds.get(key));
      const anchors = corners.flatMap(id => {
        const { uvPinned, uv } = g.corners.get(id);
        return uvPinned || preferred.has(id) ? [{ corner: id, uv: preferred.get(id) ?? uv }] : [];
      });
      const chosen = anchors[0]?.uv ?? [0, 1].map(axis => group.reduce((sum, key) => sum + getUV(key)[axis], 0) / group.length);
      if (anchors.some(row => !sameUV(row.uv, chosen)))
        conflict('stitch-anchor-conflict', { corners: anchors.map(row => row.corner) });
      for (const id of corners) points.set(id, chosen);
    }
    for (const id of ids) edges.set(id, false);
    return ids;
  }

  function remapFace(g, operation, points, conflict) {
    const {id,source,destination} = operation;
    const rectangle = bounds => tuple(bounds,4,unit) && bounds[0] < bounds[2] && bounds[1] < bounds[3];
    if (!fields(operation,['op','id','source','destination']) || !rectangle(source) || !rectangle(destination))
      throw new TypeError('Face UV remap needs a face ID and positive normalized source and destination rectangles');
    const face = g.faces.get(id);
    if (!face) throw new RangeError('Unknown UV face '+id);
    const u = face.corners.map(corner=>corner.uv[0]), v = face.corners.map(corner=>corner.uv[1]);
    const low = [Math.min(...u),Math.min(...v)], high = [Math.max(...u),Math.max(...v)];
    if ([0,1].some(axis => low[axis] < source[axis]-1e-7 || high[axis] > source[axis+2]+1e-7)) {
      conflict('face-outside-source-uvs',{face:id,bounds:[...low,...high],source});
    } else if (low.some((value,axis) => value === high[axis])) {
      conflict('degenerate-face-uvs',{face:id,bounds:[...low,...high]});
    } else {
      for (const {id:corner,uv} of face.corners) {
        points.set(corner,uv.map((value,axis)=>{
          const start = destination[axis], end = destination[axis+2];
          if (low[axis] === start && high[axis] === end) return value;
          if (value === low[axis]) return start;
          if (value === high[axis]) return end;
          return start + (end-start)*(value-low[axis])/(high[axis]-low[axis]);
        }));
      }
    }
    return [id];
  }

  function draft(g, operation) {
    if (!operation || typeof operation !== 'object' || !['cut', 'stitch', 'pin', 'transform', 'unwrap', 'relax', 'texel-budget', 'remap-face'].includes(operation.op))
      throw new TypeError('Use a UV cut, stitch, pin, transform, face remap, local solve or texel budget operation');
    const points = new Map(), edges = new Map(), pins = new Map(), conflicts = [];
    let count = 0;
    function conflict(code, evidence) {
      count++;
      if (conflicts.length < 128) conflicts.push({ code, ...evidence });
    }
    let ids, evidence;
    const local = operation.op === 'unwrap' || operation.op === 'relax';
    if (local) {
      ids = targets(g, 'faces', operation);
      evidence = meshUVRegions.local(g, ids, operation, points, conflict);
    } else if (operation.op === 'texel-budget') {
      evidence = meshUVTexelBudget.assign(g, operation, points, conflict);
      ids = order((evidence.islands ?? []).map(row => row.id));
    } else if (operation.op === 'remap-face') ids = remapFace(g,operation,points,conflict);
    else if (operation.op === 'transform') ids = transform(g, operation, points);
    else if (operation.op === 'stitch') ids = stitch(g, operation, points, edges, conflict);
    else if (operation.op === 'cut') {
      if (!fields(operation, ['op', 'ids', 'selection'])) throw new TypeError('Unknown UV cut setting');
      ids = targets(g, 'edges', operation);
      for (const { id } of seamEdges(g, ids)) edges.set(id, true);
    } else {
      if (!fields(operation, ['op', 'ids', 'selection', 'pinned']) || typeof operation.pinned !== 'boolean')
        throw new TypeError('Pin needs stable UV corners and a boolean pinned value');
      ids = targets(g, 'corners', operation);
      for (const id of ids) pins.set(id, operation.pinned);
    }
    for (const [id, uv] of points) {
      const corner = g.corners.get(id);
      const unchanged = operation.op === 'remap-face' ? uv.every((n,i)=>n === corner.uv[i]) : sameUV(uv,corner.uv);
      if (unchanged) { points.delete(id); continue; }
      if (corner.uvPinned) conflict('pinned-corner', { corner: id, uv: corner.uv, proposed: uv });
      else if (!uv.every(n => Number.isFinite(n) && n >= -1e-10 && n <= 1 + 1e-10))
        conflict('outside-atlas', { corner: id, proposed: uv.map(n => Number.isFinite(n) ? n : null) });
      else points.set(id, uv.map(n => Math.max(0, Math.min(1, n))));
    }
    if (!count && points.size) for (const { face, corners } of g.triangles()) {
      if (!corners.some(id => points.has(id))) continue;
      const before = area2(...corners.map(id => g.corners.get(id).uv));
      const after = area2(...corners.map(id => points.get(id) ?? g.corners.get(id).uv));
      if (Math.abs(before) > 1e-12 && Math.abs(after) <= 1e-12)
        conflict('collapsed-uv-triangle', { face, corners });
      else if ((operation.op === 'stitch' || local) && before * after < 0)
        conflict('flipped-uv-triangle', { face, corners });
    }
    if (!count && local && points.size) meshUVRegions.checkOverlaps(g, points, conflict);
    const report = { op: operation.op, ids, pointEdits: points.size, conflictCount: count, conflicts,
      ...(evidence && { evidence }) };
    if (count) return { document: g.doc, report };
    const affectedFaces = new Set([...points.keys(), ...pins.keys()].map(id => g.corners.get(id).face));
    const faces = [...affectedFaces].map(id => {
      const face = g.byFace.get(id);
      return { ...face, corners: face.corners.map(corner => {
        const uv=points.get(corner.id), pin=pins.get(corner.id);
        if (!g.set) return {...corner,...(uv && {uv}),...(pin!==undefined && {uvPinned:pin})};
        return {...corner,...(uv && {attributes:{...corner.attributes,[MaterialUV.key(g.set)]:uv}}),
          ...(pin!==undefined && {uvPins:{...corner.uvPins,[g.set]:pin}})};
      }) };
    });
    const original=index(g.doc.edges);
    const seams = [...edges].map(([id, uvSeam]) => g.set ?
      {id,uvSeams:{...original.get(id).uvSeams,[g.set]:uvSeam}} : {id,uvSeam});
    const document = topology.edit(g.doc, { faces, edges: seams });
    return { document, report };
  }

  function plan(source, request) {
    if (!fields(request, ['revision', 'operations', 'protect','uvSet','bindings']) ||
        !Array.isArray(request.operations ?? []) || (request.operations?.length ?? 0)>32 ||
        (!request.operations?.length && request.bindings===undefined))
      throw new TypeError('Use a UV edit with up to 32 operations or material channel bindings');
    const base = graph(source,request.uvSet ?? 0), revision = topology.revision(base.doc);
    const bindings=MaterialUV.bindings(request.bindings);
    if (request.revision !== undefined && request.revision !== revision)
      throw new RangeError('UV edit was authored against a different topology revision');
    let document = base.doc;
    const operations = [];
    for (const operation of request.operations ?? []) {
      const local = ['unwrap', 'relax', 'texel-budget'].includes(operation?.op);
      if (local && request.protect !== undefined && operation.protect !== undefined)
        throw new TypeError('Choose transaction-wide or per-operation UV protection');
      const next = draft(graph(document,base.set), local && request.protect !== undefined ?
        { ...operation, protect: request.protect } : operation);
      operations.push(next.report);
      if (next.report.conflictCount) break;
      document = next.document;
    }
    const canCommit = operations.every(row => !row.conflictCount);
    if (!canCommit) document = base.doc;
    else if (bindings) document=topology.edit(document,{uvBindings:bindings});
    const next = graph(document,base.set), cornerChanges = [], faceChanges = [];
    for (const face of document.faces) {
      const before = base.faces.get(face.id), after = next.faces.get(face.id);
      let changed = false;
      for (const [i, corner] of after.corners.entries()) {
        const prior = before.corners[i];
        if (prior.uv.every((n, axis) => corner.uv[axis] === n) && prior.uvPinned === corner.uvPinned) continue;
        changed = true;
        cornerChanges.push({ id: corner.id, face: face.id, before: prior.uv, after: corner.uv,
          pinBefore: Boolean(prior.uvPinned), pinAfter: Boolean(corner.uvPinned) });
      }
      if (changed) faceChanges.push(face);
    }
    const seamChanges = document.edges.flatMap(edge => {
      const before = base.edges.get(edge.id).authored, after = MaterialUV.seam(edge,base.set);
      return before === after ? [] : [{ id: edge.id, uvSeam: after }];
    });
    const seamPatch=base.set ? seamChanges.map(({id,uvSeam})=>
      ({id,uvSeams:{...next.doc.edges.find(row=>row.id===id).uvSeams,[base.set]:uvSeam}})) : seamChanges;
    const bindingsChanged=JSON.stringify(document.uvBindings)!==JSON.stringify(base.doc.uvBindings);
    const patch = { ...(faceChanges.length && { faces: faceChanges }), ...(seamPatch.length && { edges: seamPatch }),
      ...(bindingsChanged && {uvBindings:document.uvBindings}) };
    return { document, patch, report: { canCommit, mesh: document.id, revision, outputRevision: topology.revision(document),
      ...(base.set && {uvSet:base.set}), ...(bindingsChanged && {bindingsBefore:base.doc.uvBindings ?? {},bindingsAfter:document.uvBindings}),
      operations, corners: cornerChanges, seams: seamChanges, islandsBefore: base.islands.size, islandsAfter: next.islands.size } };
  }

  function fromTriangles(source, { id, joinCoincident = false } = {}) {
    const { points, triangles, uvs, uvSets, uvBindings, groupsByFace, tints, cutSeams = [], uvCuts } = source ?? {};
    if (typeof id !== 'string' || !id.trim() || typeof joinCoincident !== 'boolean')
      throw new TypeError('UV import needs a mesh ID and an optional coincident vertex policy');
    MeshUV.validate(points, triangles, uvs, true);
    if (!uvs?.length || uvs.some(row => !row || row.some(uv => !uv.every(unit))))
      throw new RangeError('UV import needs a normalized UV pair for every triangle corner');
    if (groupsByFace !== undefined && (!Array.isArray(groupsByFace) || groupsByFace.length !== triangles.length))
      throw new TypeError('UV face groups must match the imported triangles');
    if (tints !== undefined && (!Array.isArray(tints) || tints.length !== triangles.length ||
        Array.from(tints).some(row => row !== null && !(Array.isArray(row) && row.length === 3 &&
          Array.from(row).every(color => tuple(color, row[0]?.length, unit) && [3, 4].includes(color.length))))))
      throw new RangeError('Imported vertex tints need one normalized RGB or RGBA value per tinted triangle corner');
    const vertices = [], aliases = new Map();
    const ids = points.map((position, i) => {
      const key = joinCoincident ? position.join('/') : i;
      if (!aliases.has(key)) {
        const id = 'v/' + i;
        aliases.set(key, id);
        vertices.push({ id, position });
      }
      return aliases.get(key);
    });
    const faces = triangles.map((row, i) => ({ id: 'f/' + i, material: groupsByFace?.[i]?.material ?? 'default',
      corners: row.map((vertex, j) => ({ id: 'c/' + i + '/' + j, vertex: ids[vertex], uv: uvs[i][j],
        ...((uvSets || tints?.[i]) && { attributes: {
          ...(uvSets && Object.fromEntries(Object.entries(uvSets).filter(([set,rows])=>Number(set)>0&&rows[i])
            .map(([set,rows])=>[MaterialUV.key(set),rows[i][j]]))),
          ...(tints?.[i] && { tint: tints[i][j] })
        } }) })) }));
    const cuts = new Map();
    for (const [set, pairs] of [[0, cutSeams], ...Object.entries(uvCuts ?? {})]) {
      if (!MaterialUV.layout(+set) || !Array.isArray(pairs)) throw new TypeError('Imported UV cuts need triangle edge pairs');
      for (const pair of pairs) {
        if (!tuple(pair, 2, i => Number.isSafeInteger(i) && i >= 0 && i < ids.length) || ids[pair[0]] === ids[pair[1]])
          throw new RangeError('Imported UV seams need distinct physical endpoints');
        const vertices = order(pair.map(i => ids[i])), key = 'edge/' + JSON.stringify(vertices);
        const edge = cuts.get(key) ?? { id: key, vertices };
        if (+set === 0) edge.uvSeam = true;
        else edge.uvSeams = { ...edge.uvSeams, [set]: true };
        cuts.set(key, edge);
      }
    }
    return topology.create({ id, vertices, faces, uvBindings, edges: [...cuts.values()] });
  }

  K.meshTopology = Object.freeze({ ...topology, uv: Object.freeze({ fromTriangles, inspect, select, pickModel, modelFaces, readability, plan }) });
})(KIT);
