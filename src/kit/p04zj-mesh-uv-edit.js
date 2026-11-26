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
    const pivot = g.doc.uvPivots?.[g.set];
    return {
      ...sourceInfo(g.doc, 'ink-studio/uv-layout'),
      ...(g.set && {uvSet:g.set}), ...(g.doc.uvBindings && {uvBindings:g.doc.uvBindings}),
      ...(pivot && {pivot:pivot.slice()}),
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

  function edgeSides(g,ids,restrict) {
    const byEdge = new Map(ids.map(id=>[id,new Set()]));
    if (restrict !== undefined) {
      if (!Array.isArray(restrict)) throw new TypeError('Use saved UV edge sides');
      for (const {edge,face} of restrict) {
        const seen = byEdge.get(edge);
        if (!seen || seen.has(face) || !g.edges.get(edge).sides.some(side=>side.face===face))
          throw new RangeError('Use existing distinct face sides of each selected UV edge');
        seen.add(face);
      }
      if ([...byEdge.values()].some(seen=>!seen.size)) throw new RangeError('A selected UV edge needs at least one face side');
    }
    return ids.flatMap(edge=>g.edges.get(edge).sides
      .filter(({face})=>restrict===undefined || byEdge.get(edge).has(face))
      .map(({face,corners})=>({edge,face,corners:corners.slice()})));
  }

  function pickedSide(g,edge,face) {
    return g.edges.get(edge).kind === 'continuous' ? undefined : [{edge,face}];
  }

  function selection(g, domain, ids, hit, restrict) {
    const sides = domain === 'edges' ? edgeSides(g,ids,restrict) : undefined;
    const selectedFaces = domain === 'islands' ? ids.flatMap(id => g.islands.get(id).faces) :
      domain === 'corners' ? ids.map(id => g.corners.get(id).face) :
      sides ? sides.map(side=>side.face) : ids;
    const faces = order(selectedFaces);
    const corners = domain === 'corners' ? ids : order(sides ?
      sides.flatMap(side=>side.corners) : faces.flatMap(id => g.faces.get(id).corners.map(row => row.id)));
    return { ...sourceInfo(g.doc, selectionFormat), ...(g.set && {uvSet:g.set}), domain, ids, faces,
      islands: order(faces.map(face => g.atIsland.get(face))),
      corners, vertices:order(corners.map(id=>g.corners.get(id).vertex)),
      edges: domain === 'edges' ? ids : order(domain === 'corners' ?
        ids.flatMap(id => {
          const corner = g.corners.get(id);
          return g.faceEdges.get(corner.face).filter(edge => g.edges.get(edge).vertices.includes(corner.vertex));
        }) : faces.flatMap(id => g.faceEdges.get(id))),
      ...(sides && {edgeSides:sides}), ...(hit && { hit }) };
  }

  function segmentDistance(point, a, b) {
    const relative = b.map((n, i) => n - a[i]), delta = point.map((n, i) => n - a[i]);
    const length = relative.reduce((sum, n) => sum + n * n, 0);
    const t = length ? Math.min(1, Math.max(0, delta.reduce((sum, n, i) => sum + n * relative[i], 0) / length)) : 0;
    return Math.hypot(...delta.map((n, i) => n - t * relative[i]));
  }

  function atlasSelection(g, domain, { at, texel, size, radius, material, face }, atlasFor) {
    if ((at === undefined) === (texel === undefined) || at !== undefined && (!tuple(at,2,unit) || size !== undefined) ||
        material !== undefined && ![...g.islands.values()].some(row => row.material === material) ||
        face !== undefined && (!g.faces.has(face) || material !== undefined && g.faces.get(face).material !== material))
      throw new RangeError('Atlas selection needs normalized UV or a source texel and an optional valid face or material');
    const sheet = material ?? (face === undefined ? undefined : g.faces.get(face).material);
    const dimensions = size === undefined && texel !== undefined && sheet !== undefined ? atlasFor?.(sheet)?.size : size;
    if (texel !== undefined && (!tuple(dimensions,2,n=>Number.isSafeInteger(n) && n>0) || !tuple(texel,2) ||
        texel.some((n,i)=>n<0 || n>dimensions[i]-1)))
      throw new RangeError('A texel pick needs an in-bounds point and atlas dimensions from a face, material, or explicit size');
    const point = texel ?? at, coordinate = dimensions ? uv=>MaterialUV.texel(uv,...dimensions) : uv=>uv;
    const reach = radius === undefined ? (dimensions ? .75 : .015) : radius;
    if (!Number.isFinite(reach) || reach < 0 || reach > (dimensions ? Math.max(...dimensions) : .25))
      throw new RangeError('Atlas pick radius must be nonnegative and within the atlas coordinate range');
    const belongs = id => (face === undefined || face === id) && (material === undefined || g.faces.get(id).material === material);
    const candidates = [];
    if (domain === 'corners') for (const row of g.corners.values()) {
      if (belongs(row.face)) {
        const [u,v] = coordinate(row.uv);
        candidates.push({id:row.id,face:row.face,distance:Math.hypot(point[0]-u,point[1]-v)});
      }
    } else if (domain === 'edges') for (const row of g.edges.values()) {
      for (const side of row.sides) if (belongs(side.face))
        candidates.push({ id: row.id, face: side.face, distance: segmentDistance(point, ...side.uv.map(coordinate)) });
    } else {
      for (const row of g.triangles()) {
        if (!belongs(row.face)) continue;
        const [a, b, c] = row.corners.map(id => coordinate(g.corners.get(id).uv));
        const area = area2(a, b, c);
        const inside = Math.abs(area) <= 1e-12 ?
          dimensions?.includes(1) && [[a,b],[b,c],[c,a]].some(([from,to])=>segmentDistance(point,from,to)<=1e-7) :
          [area2(a,b,point),area2(b,c,point),area2(c,a,point)].every(n=>n/area>=-1e-8);
        if (inside) candidates.push({ id: domain === 'faces' ? row.face : g.atIsland.get(row.face), face: row.face, distance: 0 });
      }
    }
    let closest = Infinity;
    for (const row of candidates) closest = Math.min(closest, row.distance);
    const tied = closest <= reach ? candidates.filter(row => row.distance <= closest + 1e-7) : [];
    const ids = order(tied.map(row => row.id));
    const welded = domain === 'corners' && new Set(ids.map(id => g.atWeld.get(id))).size === 1;
    const splitEdge = domain === 'edges' && ids.length === 1 && pickedSide(g,ids[0],tied[0].face);
    const status = !ids.length ? 'miss' : (ids.length === 1 || welded) && !(splitEdge && tied.length>1) ? 'hit' : 'ambiguous';
    return selection(g,domain,status === 'hit' ? ids : [],{
      space:'atlas',...(dimensions ? {texel:texel.slice(),size:dimensions.slice()} : {at:at.slice()}),status,
      candidates:ids,faces:order(tied.map(row=>row.face)),
      ...(domain === 'edges' && {candidateSides:tied.map(({id:edge,face})=>({edge,face}))})
    },status === 'hit' && splitEdge ? splitEdge : undefined);
  }

  const meshDomains = {corners:'vertices',edges:'edges',faces:'faces',islands:'faces'};

  function fromTopology(g,domain,raw) {
    if (!fields(raw,['selection','face']) || raw.selection?.domain !== meshDomains[domain] ||
        raw.face !== undefined && !g.faces.has(raw.face))
      throw new TypeError('Use a matching mesh component selection and an optional incident face');
    const native = topology.select(g.doc,{from:raw.selection});
    const selected = new Set(native.ids), face = raw.face;
    const hit = {space:'topology',...(face !== undefined && {face})};
    if (domain === 'corners') return selection(g,domain,order([...g.corners.values()]
      .filter(row=>(face === undefined || row.face===face) && selected.has(row.vertex)).map(row=>row.id)),hit);
    if (domain === 'edges') {
      if (face === undefined) return selection(g,domain,native.ids,hit);
      const ids = native.ids.filter(id=>g.edges.get(id).sides.some(side=>side.face===face));
      return selection(g,domain,ids,hit,ids.map(edge=>({edge,face})));
    }
    const faces = face === undefined ? native.ids : native.ids.filter(id=>id===face);
    return selection(g,domain,domain === 'islands' ? order(faces.map(id=>g.atIsland.get(id))) : faces,hit);
  }

  function select(source, query = {}, {atlasFor} = {}) {
    if (!fields(query, ['domain', 'ids', 'atlas', 'from', 'uvSet', 'tint', 'topology']) || !domains.includes(query.domain) ||
        [query.ids, query.atlas, query.from, query.tint, query.topology].filter(n => n !== undefined).length !== 1)
      throw new TypeError('Choose a UV selection domain and IDs, an atlas location, a tint, or a saved selection');
    const g = graph(source,query.uvSet ?? query.from?.uvSet ?? 0), { domain, ids, atlas, from, tint } = query;
    if (query.topology !== undefined) return fromTopology(g,domain,query.topology);
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
      if (!fields(atlas, ['at', 'texel', 'size', 'radius', 'face', 'material'])) throw new TypeError('Invalid UV atlas pick');
      return atlasSelection(g, domain, atlas,atlasFor);
    }
    if (from !== undefined && (from?.format !== selectionFormat || from.version !== 1 || from.mesh !== g.doc.id ||
        from.revision !== topology.revision(g.doc) || from.domain !== domain || (from.uvSet ?? 0)!==g.set))
      throw new RangeError('Use a UV selection from this mesh revision and domain');
    return selection(g, domain, known(g, domain, from === undefined ? ids : from.ids), from?.hit, from?.edgeSides);
  }

  function toTopologySelection(source,saved,domain = 'match') {
    const selected = select(source,{domain:saved?.domain,from:saved});
    const target = domain === 'match' ? meshDomains[selected.domain] : domain;
    if (!['vertices','edges','faces'].includes(target)) throw new TypeError('Choose a vertex, edge, face, or matching topology selection');
    return topology.select(source,{domain:target,ids:selected[target]});
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
    return selection(g, domain, [id], { space: 'model', status: 'hit', pixel: pixel.slice(), face, triangle, weights, uv },
      domain === 'edges' ? pickedSide(g,id,face) : undefined);
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

  function connectedUnwrap(g, faceIds, operation, points, edges, conflict) {
    const {cuts} = operation;
    const ids = cuts===undefined ? [] : Array.isArray(cuts) ? known(g,'edges',cuts) :
      select(g.doc,{domain:'edges',from:cuts,uvSet:g.set}).ids;
    const requested = new Set(ids), selected = new Set(faceIds);
    for (const edge of seamEdges(g,ids)) {
      if (!edge.sides.some(side=>selected.has(side.face))) throw new RangeError('A new unwrap cut must touch a selected face');
      edges.set(edge.id,true);
    }
    const weldSet = sets(g.corners.keys()), topologyEdges = new Map(), joined = [];
    for (const edge of g.edges.values()) {
      let kind = edge.kind;
      if (requested.has(edge.id)) kind = 'seam';
      else if (kind==='seam' && !edge.authored && edge.sides.every(side=>selected.has(side.face))) {
        kind = 'continuous';
        joined.push(edge.id);
      }
      if (kind==='continuous') {
        const [a,b] = edge.sides;
        a.corners.forEach((id,i)=>weldSet.join(id,b.corners[i]));
      }
      topologyEdges.set(edge.id,kind===edge.kind ? edge : {...edge,kind});
    }
    const welds = new Map(), atWeld = new Map();
    for (const id of order(g.corners.keys())) {
      const weld = weldSet.root(id);
      if (!welds.has(weld)) welds.set(weld,[]);
      welds.get(weld).push(id);
      atWeld.set(id,weld);
    }
    const report = meshUVRegions.connected({...g,edges:topologyEdges,welds,atWeld},faceIds,operation,points,conflict);
    return {...report,across:'geometry',cuts:ids,joinedEdges:order(joined),edgeChanges:[]};
  }

  function islandWelds(g, id) {
    return order(g.islands.get(id).faces.flatMap(face => g.faces.get(face).corners.map(corner => g.atWeld.get(corner.id))));
  }

  function boundsOf(points) {
    const bounds = [Infinity,Infinity,-Infinity,-Infinity];
    for (const point of points) for (const [axis,n] of point.entries()) {
      bounds[axis] = Math.min(bounds[axis],n);
      bounds[axis+2] = Math.max(bounds[axis+2],n);
    }
    return bounds;
  }

  const centerOf = bounds=>[(bounds[0]+bounds[2])*.5,(bounds[1]+bounds[3])*.5];

  function setPivot(g, operation) {
    const {target} = operation, before = g.doc.uvPivots?.[g.set] ?? null;
    if (!fields(operation,['op','target']) || target !== null && !fields(target,['kind','uv','corner','selection']))
      throw new TypeError('Set a UV pivot from a selection center, point, pinned corner, snapped corner, or null');
    let after = null, anchor = null;
    if (target?.kind === 'point' && fields(target,['kind','uv']) && tuple(target.uv,2,unit)) {
      after = target.uv.slice();
      anchor = {kind:'point'};
    } else if (target?.kind === 'selection-center' && fields(target,['kind','selection'])) {
      const selected = select(g.doc,{domain:target.selection?.domain,uvSet:g.set,from:target.selection});
      if (!selected.corners.length) throw new RangeError('Choose a nonempty UV selection to center the pivot');
      const bounds = boundsOf(selected.corners.map(id=>g.corners.get(id).uv));
      after = centerOf(bounds);
      anchor = {kind:target.kind,bounds,corners:selected.corners};
    } else if (target?.kind === 'pinned' || target?.kind === 'corner') {
      const {kind,corner,selection:saved} = target;
      if (!fields(target,['kind','corner','selection']) ||
          (corner === undefined) === (saved === undefined))
        throw new TypeError('Choose one UV corner ID or a saved single-corner pick for the pivot');
      const ids = saved === undefined ? [corner] : select(g.doc,{domain:'corners',uvSet:g.set,from:saved}).ids;
      if (ids.length !== 1 || !g.corners.has(ids[0])) throw new RangeError('Choose one existing UV corner for the pivot');
      const found = g.corners.get(ids[0]);
      if (kind === 'pinned' && !found.uvPinned) throw new RangeError('The pivot corner must be pinned on this UV layout');
      after = found.uv.slice();
      anchor = {kind,corner:found.id,face:found.face,pinned:Boolean(found.uvPinned)};
    } else if (target !== null) throw new TypeError('Unknown UV pivot target');

    const uvPivots = {...g.doc.uvPivots};
    if (after) uvPivots[g.set] = after;
    else delete uvPivots[g.set];
    const changed = before && after ? before.some((n,i)=>n!==after[i]) : before!==after;
    return {document:changed ? topology.edit(g.doc,{uvPivots}) : g.doc,
      report:{op:operation.op,ids:[],pointEdits:0,conflictCount:0,conflicts:[],
        evidence:{before,after,target:anchor,changed}}};
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
    const dedicated = g.doc.uvPivots?.[g.set], pivots = [];
    for (const id of ids) {
      const [l, t, r, b] = g.islands.get(id).bounds, [u, v] = pivot ?? dedicated ?? [(l + r) / 2, (t + b) / 2];
      pivots.push({island:id,uv:[u,v]});
      for (const key of islandWelds(g, id)) {
        const [a, b] = g.corners.get(key).uv, x = (a - u) * sizes[0], y = (b - v) * sizes[1];
        const uv = [u + translate[0] + x * cos - y * sin, v + translate[1] + x * sin + y * cos];
        for (const corner of g.welds.get(key)) points.set(corner, uv);
      }
    }
    return {ids,evidence:{pivotSource:pivot ? 'explicit' : dedicated ? 'dedicated' : 'island-center',pivots}};
  }

  function selectedUVGroups(g,operation,domain,mode,scope) {
    const ids = targets(g,domain,operation);
    const selected = selection(g,domain,ids,undefined,operation.selection?.edgeSides);
    if (mode==='per-face') return {ids,groups:selected.faces.map(face=>({face,corners:g.faces.get(face).corners}))};
    const corners = scope==='together' ? cornerOverlaps(g)(selected.corners) : selected.corners;
    return {ids,groups:[{corners:corners.map(id=>g.corners.get(id))}]};
  }

  function groupAtlas(g,corners,face,atlas,atlasFor,validSize,label) {
    const materials = new Set(corners.map(corner=>g.faces.get(face ?? corner.face).material));
    const sizes = atlas ? [atlas] : Array.from(materials,material=>atlasFor?.(material)?.size);
    const size = sizes[0];
    if (!tuple(size,2,validSize) || sizes.some(other=>!other || other[0]!==size[0] || other[1]!==size[1]))
      throw new RangeError(label+' needs matching atlas dimensions within each group');
    return size;
  }

  function texelPoint(uv,spans) {
    return uv.map((n,i)=>{
      const coordinate = n*spans[i], half = Math.round(coordinate*2)/2;
      return half/spans[i]===n ? half : coordinate;
    });
  }

  function orientationAngle(degrees,increment) {
    const steps = increment===undefined ? undefined : Math.round(Math.abs(degrees)/increment);
    if (steps!==undefined && !Number.isSafeInteger(steps))
      throw new RangeError('The angle increment needs a representable number of steps');
    const applied = steps===undefined ? degrees : Math.sign(degrees)*steps*increment;
    if (!Number.isFinite(applied)) throw new RangeError('UV orientation exceeds the finite angle range');
    const remainder = applied%360, wrapped = remainder<0 ? remainder+360 : remainder;
    const nearestQuarter = Math.round(wrapped/90)*90;
    const exact = steps===undefined ? wrapped===nearestQuarter :
      Math.abs(wrapped-nearestQuarter)<=Number.EPSILON*360*4;
    return {requested:degrees,applied:(exact ? applied+(nearestQuarter-wrapped) : applied) || 0,
      wrapped:(exact ? nearestQuarter%360 : wrapped) || 0,
      ...(increment!==undefined && {increment}),exact};
  }

  function orient(g,operation,points,atlasFor) {
    const {mode='group',domain=operation.selection?.domain ?? (mode==='per-face' ? 'faces' : 'islands'),
      scope='independent',degrees=0,increment,flipX=false,flipY=false,pivot,space='uv',atlas} = operation;
    if (!fields(operation,['op','ids','selection','mode','domain','scope','degrees','increment','flipX','flipY','pivot','space','atlas']) ||
        !['group','per-face'].includes(mode) || !domains.includes(domain) ||
        !['together','independent'].includes(scope) || mode==='per-face' &&
        (!['faces','islands'].includes(domain) || pivot!==undefined || operation.scope!==undefined))
      throw new TypeError('Orient a group of UVs or turn whole faces about their own centers');
    if (!Number.isFinite(degrees) || increment!==undefined && (!Number.isFinite(increment) || increment<=0) ||
        typeof flipX!=='boolean' || typeof flipY!=='boolean' || pivot!==undefined && !tuple(pivot,2,unit) ||
        !['uv','texel'].includes(space) || atlas!==undefined &&
        (space!=='texel' || !tuple(atlas,2,n=>Number.isSafeInteger(n) && n>1)))
      throw new RangeError('UV orientation needs finite degrees, a positive angle increment, boolean flips, and optional normalized pivot or texel atlas');

    const {ids,groups} = selectedUVGroups(g,operation,domain,mode,scope);
    const angle = orientationAngle(degrees,increment), {wrapped,exact} = angle;
    // Transform pivot-relative offsets with the same top-down quarter turns used for tile paint.
    let rotate;
    if (exact) rotate = TilesetSelection.paintTransform({rotation:wrapped,flipX,flipY},0,0).point;
    else {
      const radians = wrapped*Math.PI/180, cos = Math.cos(radians), sin = Math.sin(radians);
      rotate = ([x,y])=>{
        const u = flipX ? -x : x, v = flipY ? -y : y;
        return [u*cos-v*sin,u*sin+v*cos];
      };
    }
    const sameX = exact && rotate([1,0])[0]===1, sameY = exact && rotate([0,1])[1]===1;
    const dedicated = mode==='group' ? g.doc.uvPivots?.[g.set] : undefined;
    const shared = pivot ?? dedicated, pivots = [];
    for (const {corners,face} of groups) {
      const size = space==='texel' ? groupAtlas(g,corners,face,atlas,atlasFor,
        n=>Number.isSafeInteger(n) && n>1,'Texel orientation') : undefined;
      const spans = size ? size.map(n=>n-1) : [1,1];
      const toWorking = uv=>size ? texelPoint(uv,spans) : uv;
      const base = corners.map(({uv})=>toWorking(uv));
      const center = shared ? toWorking(shared) : centerOf(boundsOf(base));
      pivots.push({...(face!==undefined && {face}),uv:shared?.slice() ?? center.map((n,i)=>n/spans[i]),...(size && {atlas:size.slice()})});
      for (const [i,{id,uv}] of corners.entries()) {
        const [x,y] = rotate(base[i].map((n,axis)=>n-center[axis]));
        points.set(id,[sameX ? uv[0] : (center[0]+x)/spans[0],sameY ? uv[1] : (center[1]+y)/spans[1]]);
      }
    }
    const pivotSource = pivot ? 'explicit' : dedicated ? 'dedicated' : mode==='per-face' ? 'face-center' : 'group-center';
    return {ids,evidence:{mode,domain,scope,space,angle,flipX,flipY,mirrored:flipX!==flipY,pivotSource,pivots,
      faces:order([...points.keys()].map(id=>g.corners.get(id).face)),edgeChanges:[]}};
  }

  function faceGrain(g,face) {
    const row = g.faces.get(face), positions = row.corners.map(({id})=>g.corners.get(id).position);
    const edges = positions.map(point=>V.sub(point,positions[0]));
    const geometryScale = Math.max(...edges.flat().map(Math.abs));
    const uv = row.corners.map(({uv})=>[uv[0]-row.corners[0].uv[0],uv[1]-row.corners[0].uv[1]]);
    const uvScale = Math.max(...uv.flat().map(Math.abs));
    if (!geometryScale || !Number.isFinite(geometryScale) || !uvScale) return;
    const points = edges.map(point=>point.map(n=>n/geometryScale));
    const coords = uv.map(pair=>pair.map(n=>n/uvScale));
    let normal = [0,0,0], u = [0,0,0], v = [0,0,0], area = 0;
    // Boundary sums produce the area-weighted surface tangents for increasing U and V.
    for (const [i,a] of points.entries()) {
      const next = (i+1)%points.length, b = points[next], [s,t] = coords[i], [x,y] = coords[next];
      normal = V.add(normal,V.cross(a,b));
      u = V.add(u,V.sub(V.mul(a,y),V.mul(b,t)));
      v = V.add(v,V.sub(V.mul(b,s),V.mul(a,x)));
      area += s*y-x*t;
    }
    if (Math.abs(area)<1e-12 || V.len(normal)<1e-12) return;
    normal = V.norm(normal);
    const tangent = direction=>V.mad(direction,normal,-V.dot(direction,normal));
    u = V.mul(tangent(u),Math.sign(area));
    v = V.mul(tangent(v),Math.sign(area));
    const handedness = V.dot(V.cross(V.norm(u),V.norm(v)),normal);
    if (Math.abs(handedness)<1e-10) return;
    return {normal,tangents:[u,v],handedness:Math.sign(handedness)};
  }

  function grainReference(g,request,axis) {
    if (!fields(request,['face','edge','selection','from']) ||
        [request.face,request.edge,request.selection].filter(value=>value!==undefined).length!==1)
      throw new TypeError('Choose a reference face, directed edge, or saved single face or edge selection');
    const {selection:saved,from} = request;
    const picked = saved===undefined ? undefined : select(g.doc,{domain:saved?.domain,from:saved,uvSet:g.set});
    if (picked && (picked.ids.length!==1 || !['faces','edges'].includes(picked.domain)))
      throw new RangeError('Choose one reference face or edge');
    const face = request.face ?? (picked?.domain==='faces' ? picked.ids[0] : undefined);
    if (face!==undefined) {
      if (from!==undefined || !g.faces.has(face)) throw new RangeError('Choose an existing reference face');
      const basis = faceGrain(g,face);
      const {material,corners} = g.faces.get(face);
      const contour = corners.map(row=>row.uv);
      return {kind:'face',face,direction:basis ? V.norm(basis.tangents[axis]) : null,
        handedness:basis?.handedness ?? null,guides:[{material,points:[...contour,contour[0]]}]};
    }
    const edge = request.edge ?? picked?.ids[0], row = g.edges.get(edge);
    if (!row || from!==undefined && !row.vertices.includes(from)) throw new RangeError('Choose an existing reference edge and optional start vertex');
    const sides = edgeSides(g,[edge],picked?.edgeSides);
    const [a,b] = sides[0].corners.map(id=>g.corners.get(id).position);
    const reverse = from===row.vertices[1], delta = reverse ? V.sub(a,b) : V.sub(b,a);
    const scale = Math.max(...delta.map(Math.abs));
    return {kind:'edge',edge,from:row.vertices[reverse ? 1 : 0],to:row.vertices[reverse ? 0 : 1],
      direction:scale>0 && Number.isFinite(scale) ? V.norm(delta.map(n=>n/scale)) : null,
      guides:sides.map(side=>({material:g.faces.get(side.face).material,points:side.corners.map(id=>g.corners.get(id).uv)}))};
  }

  const grainError = (a,b)=>Math.atan2(V.len(V.cross(a,b)),V.dot(a,b))*180/Math.PI;

  function closestGrainTurn(tangents,direction,axis,flipX) {
    let best;
    for (const degrees of [0,90,270,180]) {
      const turn = TilesetSelection.paintTransform({rotation:degrees,flipX,flipY:false},1,1).point;
      const origin = turn([0,0])[axis];
      const coefficients = [turn([1,0])[axis]-origin,turn([0,1])[axis]-origin];
      const after = V.norm(V.add(V.mul(tangents[0],coefficients[0]),V.mul(tangents[1],coefficients[1])));
      const error = grainError(after,direction);
      if (!best || error<best.error-1e-9) best = {degrees,turn,after,error};
    }
    return best;
  }

  function normalizeGrain(g,operation,points,conflict) {
    const {reference:target,domain=operation.selection?.domain ?? 'faces',axis='u',method='quarter-turn',
      maxError=45,matchHandedness=true} = operation;
    if (!fields(operation,['op','ids','selection','domain','reference','axis','method','maxError','matchHandedness']) ||
        !['faces','islands'].includes(domain) || !['u','v'].includes(axis) || !['quarter-turn','continuous'].includes(method) ||
        !Number.isFinite(maxError) || maxError<0 || maxError>180 || typeof matchHandedness!=='boolean')
      throw new TypeError('Normalize selected faces or islands with a reference, U or V axis, and optional alignment method and angular tolerance');
    const {ids,groups} = selectedUVGroups(g,operation,domain,'per-face');
    const dimension = axis==='u' ? 0 : 1, reference = grainReference(g,target,dimension), faces = [];
    if (!reference.direction) conflict('degenerate-orientation-reference',
      reference.kind==='face' ? {face:reference.face} : {edge:reference.edge});
    else for (const {face,corners} of groups) {
      if (face===reference.face) {
        faces.push({face,status:'reference'});
        continue;
      }
      const basis = faceGrain(g,face);
      if (!basis) {
        faces.push({face,status:'degenerate'});
        conflict('degenerate-face-orientation',{face});
        continue;
      }
      const {normal,tangents:[u,v],handedness} = basis;
      const projected = V.mad(reference.direction,normal,-V.dot(reference.direction,normal));
      if (V.len(projected)<=1e-8) {
        faces.push({face,status:'perpendicular'});
        conflict('reference-perpendicular-to-face',{face});
        continue;
      }
      const direction = V.norm(projected), before = V.norm(basis.tangents[dimension]);
      const flipX = matchHandedness && reference.kind==='face' && handedness!==reference.handedness;
      const closest = method==='quarter-turn' ? closestGrainTurn([u,v],direction,dimension,flipX) : undefined;
      let degrees, error, after;
      if (closest) ({degrees,error,after} = closest);
      else {
        // Solve the desired tangent in the current UV basis, then rotate it onto the requested UV axis.
        const x = V.dot(V.cross(direction,v),normal)*handedness*(flipX ? -1 : 1);
        const y = V.dot(V.cross(u,direction),normal)*handedness;
        const turn = dimension*90-Math.atan2(y,x)*180/Math.PI;
        degrees = ((turn+180)%360+360)%360-180;
        if (Math.abs(degrees)<1e-9) degrees = 0;
        after = degrees===0 ? V.norm(V.mul(basis.tangents[dimension],flipX && dimension===0 ? -1 : 1)) : direction;
        error = grainError(after,direction);
      }
      const row = {face,status:'aligned',degrees,flipX,desiredDirection:direction,beforeDirection:before,afterDirection:after,
        beforeError:grainError(before,direction),afterError:error};
      faces.push(row);
      if (error>maxError+1e-8) {
        row.status = 'outside-tolerance';
        conflict('orientation-outside-tolerance',{face,degrees,error,maxError});
        continue;
      }
      if (degrees===0 && !flipX) {
        row.status = 'already-aligned';
        continue;
      }
      if (closest) {
        const bounds = boundsOf(corners.map(({uv})=>uv)), spans = bounds.slice(2).map((n,i)=>n-bounds[i]);
        for (const {id,uv} of corners) {
          const rotated = closest.turn(uv.map((n,i)=>(n-bounds[i])/spans[i]));
          points.set(id,rotated.map((n,i)=>n===1 ? bounds[i+2] : bounds[i]+n*spans[i]));
        }
      } else orient(g,{op:'orient',domain:'faces',ids:[face],mode:'per-face',degrees,flipX},points);
    }
    return {ids,evidence:{domain,axis,method,maxError,matchHandedness,reference,faces,edgeChanges:[]}};
  }

  function snappedUVScale(axes,requested) {
    const result = factor=>{
      const bounds = [];
      for (const {low,high,pivot,span} of axes) {
        const first = pivot+(low-pivot)*factor, last = pivot+(high-pivot)*factor;
        const a = Math.round(first), b = Math.round(last);
        const epsilon = 32*Number.EPSILON*Math.max(1,span);
        if (![a,b].every(Number.isSafeInteger) || a<0 || b>span || a===b && low!==high ||
            !Number.isInteger(pivot) && (low===pivot || high===pivot) ||
            Math.abs(first-a)>epsilon || Math.abs(last-b)>epsilon)
          return;
        bounds.push([a || 0,b || 0]);
      }
      return {factor,bounds};
    };
    // A nonzero endpoint offset determines the scale once it lands on a texel.
    let driver, offset = 0;
    for (const axis of axes) for (const end of [axis.low,axis.high]) {
      if (Math.abs(end-axis.pivot)>Math.abs(offset)) {
        driver = axis;
        offset = end-axis.pivot;
      }
    }
    if (!driver) return result(requested);
    const {pivot,span} = driver;
    const min = offset>0 ? Math.floor(pivot)+1 : 0, max = offset>0 ? span : Math.ceil(pivot)-1;
    if (min>max) return;
    const target = Math.max(min,Math.min(max,pivot+offset*requested));
    let lower = Math.floor(target), upper = lower+1;
    while (lower>=min || upper<=max) {
      const left = target-lower, right = upper-target;
      const nearer = lower>=min && (upper>max || left<right || left===right && offset>0) ? lower-- : upper++;
      const factor = (nearer-pivot)/offset;
      const matched = factor>0 && Number.isFinite(factor) && result(factor);
      if (matched) return matched;
    }
  }

  function scaleUV(g,operation,points,atlasFor,conflict) {
    const {mode='group',domain=operation.selection?.domain ?? (mode==='per-face' ? 'faces' : 'islands'),
      scope='independent',factor,aspectLock=false,snapBounds=false,pivot,atlas} = operation;
    if (!fields(operation,['op','ids','selection','mode','domain','scope','factor','aspectLock','snapBounds','pivot','atlas']) ||
        !['group','per-face'].includes(mode) || !domains.includes(domain) ||
        !['together','independent'].includes(scope) || mode==='per-face' &&
        (!['faces','islands'].includes(domain) || pivot!==undefined || operation.scope!==undefined))
      throw new TypeError('Scale a group of UVs or scale whole faces about their own centers');
    const requested = typeof factor==='number' ? [factor,factor] : factor;
    const atlasAxis = n=>Number.isSafeInteger(n) && n>=2 && n<=4096;
    if (!tuple(requested,2,n=>Number.isFinite(n) && n>0) || typeof aspectLock!=='boolean' ||
        typeof snapBounds!=='boolean' || pivot!==undefined && !tuple(pivot,2,unit) ||
        atlas!==undefined && (!snapBounds || !tuple(atlas,2,atlasAxis)))
      throw new RangeError('UV scale needs positive factors, boolean locks, and optional pivot or bounds atlas of 2 to 4096 texels per axis');
    if (aspectLock && requested[0]!==requested[1]) throw new RangeError('Aspect lock needs one uniform scale factor');

    const {ids,groups} = selectedUVGroups(g,operation,domain,mode,scope);
    const dedicated = mode==='group' ? g.doc.uvPivots?.[g.set] : undefined;
    const shared = pivot ?? dedicated, pivots = [], bounds = [];
    const pivotSource = pivot ? 'explicit' : dedicated ? 'dedicated' : mode==='per-face' ? 'face-center' : 'group-center';
    for (const {corners,face} of groups) {
      const size = snapBounds ? groupAtlas(g,corners,face,atlas,atlasFor,atlasAxis,'UV bounds snapping') : undefined;
      const spans = size ? size.map(n=>n-1) : [1,1];
      const toWorking = uv=>size ? texelPoint(uv,spans) : uv;
      const before = boundsOf(corners.map(({uv})=>toWorking(uv)));
      const origin = shared ? toWorking(shared) : centerOf(before);
      const anchor = shared?.slice() ?? origin.map((n,i)=>n/spans[i]);
      const target = face===undefined ? {} : {face};
      pivots.push({...target,uv:anchor,...(size && {atlas:size.slice()})});
      const atScale = (n,i,s)=>n===origin[i] || s===1 ? n : origin[i]+(n-origin[i])*s;
      const desired = before.map((n,index)=>atScale(n,index%2,requested[index%2]));
      const row = {...target,units:size ? 'texels' : 'uv',before,
        requested:desired.map(n=>Number.isFinite(n) ? n : null)};
      bounds.push(row);
      let factors = requested, after = desired;
      if (size) {
        const axes = spans.map((span,i)=>({span,pivot:origin[i],low:before[i],high:before[i+2]}));
        const solved = aspectLock ? [snappedUVScale(axes,requested[0])] :
          axes.map((axis,i)=>snappedUVScale([axis],requested[i]));
        if (solved.some(result=>!result)) {
          conflict('incompatible-snapped-bounds',{...target,pivot:anchor,bounds:row.requested,atlas:size.slice(),aspectLock});
          continue;
        }
        factors = aspectLock ? [solved[0].factor,solved[0].factor] : solved.map(result=>result.factor);
        const [[l,r],[t,b]] = aspectLock ? solved[0].bounds : solved.map(result=>result.bounds[0]);
        after = [l,t,r,b];
      }
      row.factors = factors.slice();
      row.applied = after.map(n=>Number.isFinite(n) ? n : null);
      for (const {id,uv} of corners) {
        const source = toWorking(uv);
        points.set(id,source.map((n,i)=>{
          if (uv[i]===anchor[i]) return uv[i];
          if (size && n===before[i]) return after[i]/spans[i];
          if (size && n===before[i+2]) return after[i+2]/spans[i];
          return factors[i]===1 ? uv[i] : atScale(n,i,factors[i])/spans[i];
        }));
      }
    }
    const faces = order(groups.flatMap(({face,corners})=>face===undefined ? corners.map(row=>row.face) : [face]));
    return {ids,evidence:{mode,domain,scope,aspectLock,snapBounds,requestedFactors:requested.slice(),
      pivotSource,pivots,bounds,faces,edgeChanges:[]}};
  }

  function cornerOverlaps(g) {
    const positionKey = corner=>JSON.stringify([g.faces.get(corner.face).material,...corner.uv]);
    const byPosition = new Map();
    for (const corner of g.corners.values()) {
      const key = positionKey(corner);
      if (!byPosition.has(key)) byPosition.set(key,[]);
      byPosition.get(key).push(corner.id);
    }
    return ids=>{
      const seen = new Set(ids), queue = ids.slice(), positions = new Set(), welds = new Set();
      function include(rows) {
        for (const id of rows) if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
      for (const id of queue) {
        const key = positionKey(g.corners.get(id)), weld = g.atWeld.get(id);
        if (!positions.has(key)) {
          positions.add(key);
          include(byPosition.get(key));
        }
        if (!welds.has(weld)) {
          welds.add(weld);
          include(g.welds.get(weld));
        }
      }
      return order(queue);
    };
  }

  function moveCornerScope(g,ids,scope,points,propose,expand=cornerOverlaps(g)) {
    const coincident = expand(ids);
    const active = new Set(scope === 'together' ? coincident : ids), moving = [], held = [];
    for (const id of coincident) {
      const {face,vertex,uv,uvPinned} = g.corners.get(id);
      const row = {id,face,vertex,material:g.faces.get(face).material,uv:uv.slice(),pinned:Boolean(uvPinned)};
      if (active.has(id)) {
        const next = propose(row);
        points.set(id,next);
        moving.push({...row,proposed:next.map(n=>Number.isFinite(n) ? n : null)});
      } else held.push(row);
    }
    return {moving,held,edgeChanges:[]};
  }

  function moveCorners(g,operation,points) {
    const {scope,translate=[0,0]} = operation;
    if (!fields(operation,['op','ids','selection','scope','translate']) ||
        !['together','independent'].includes(scope) || !tuple(translate,2))
      throw new TypeError('Move UV corners with together or independent scope and an optional finite UV translation');
    const ids = targets(g,'corners',operation);
    const motion = moveCornerScope(g,ids,scope,points,({uv})=>uv.map((n,i)=>n+translate[i]));
    return {ids,evidence:{scope,translate:translate.slice(),...motion}};
  }

  function sourcePixelGrid(material,atlasFor,atlas,tile,explicitGrid,operation) {
    const source = atlasFor?.(material), size = atlas ?? source?.size;
    if (!tuple(size,2,n=>Number.isSafeInteger(n) && n>0))
      throw new RangeError('UV '+operation+' needs source atlas dimensions for material '+material);
    const grid = tile ? explicitGrid ?? source?.grid?.tileSize : undefined;
    if (tile && !grid) throw new RangeError('Tile '+operation+' needs a declared tile grid for material '+material);
    if (grid && !TilesetSelection.gridFits({width:size[0],height:size[1]},grid))
      throw new RangeError('Tile '+operation+' grid must fit the source atlas for material '+material);
    return {atlas:size.slice(),atlasSource:atlas ? 'explicit' : source.kind,
      ...(!atlas && source.tileset && {tileset:source.tileset}),
      ...(grid && {grid,gridSource:explicitGrid ? 'explicit' : source.grid.source})};
  }

  const tileStride = grid=>[grid.width+(grid.paddingX ?? 0),grid.height+(grid.paddingY ?? 0)];

  function nudge(g,operation,points,atlasFor) {
    const {steps,increment='pixel',atlas,tileSize,scope,domain=operation.selection?.domain ?? 'islands'} = operation;
    const perAxis = increment==='pixel' ? [1,1] : typeof increment==='number' ? [increment,increment] : increment;
    if (!fields(operation,['op','ids','selection','domain','scope','steps','increment','atlas','tileSize']) ||
        !domains.includes(domain) || !tuple(steps,2,Number.isSafeInteger) ||
        (domain!=='islands' ? !['together','independent'].includes(scope) : scope!==undefined) ||
        increment!=='tile' && (!tuple(perAxis,2,n=>Number.isFinite(n) && n>0) || tileSize!==undefined) ||
        atlas!==undefined && !tuple(atlas,2,n=>Number.isSafeInteger(n) && n>0))
      throw new TypeError('Nudge UV islands or scoped corners, edges, or faces with integer steps, a positive pixel increment or tile, and optional atlas dimensions');
    const explicitGrid = tileSize===undefined ? undefined : TilesetSelection.tileSize(tileSize);
    const ids = targets(g,domain,operation), resolved = new Map();
    function translation(material) {
      if (resolved.has(material)) return resolved.get(material).uv;
      const source = sourcePixelGrid(material,atlasFor,atlas,increment==='tile',explicitGrid,'nudge');
      const pixels = source.grid ? tileStride(source.grid) : perAxis.slice();
      const texels = steps.map((n,i)=>n*pixels[i]);
      const uv = texels.map((n,i)=>n===0 ? 0 : n/(source.atlas[i]-1));
      if (!uv.every(Number.isFinite)) throw new RangeError('UV nudge exceeds finite precision or moves along a one-texel axis for material '+material);
      const {atlas:size,atlasSource,tileset,grid,gridSource} = source;
      resolved.set(material,{material,atlas:size,atlasSource,pixels,texels,uv,
        ...(tileset && {tileset}),...(grid && {grid,gridSource})});
      return uv;
    }
    const selected = selection(g,domain,ids,undefined,operation.selection?.edgeSides);
    let corners;
    if (domain!=='islands') corners = moveCornerScope(g,selected.corners,scope,points,({material,uv})=>{
      const shift = translation(material);
      return uv.map((n,i)=>n+shift[i]);
    });
    else for (const id of selected.corners) {
      const {face,uv} = g.corners.get(id), shift = translation(g.faces.get(face).material);
      points.set(id,uv.map((n,i)=>n+shift[i]));
    }
    return {ids,evidence:{domain,steps:steps.slice(),increment:Array.isArray(increment) ? increment.slice() : increment,
      materials:[...resolved.values()],...(corners && {scope,...corners})}};
  }

  function snapGrid(target,atlasFor) {
    const {axis,units='texel',step:spacing=1,origin:offset=0,atlas,tileSize} = target, tile = units==='tile';
    if (!fields(target,['kind','axis','units','step','origin','atlas','tileSize']) ||
        !['u','v'].includes(axis) || !['uv','texel','tile'].includes(units) ||
        !Number.isFinite(spacing) || spacing<=0 || tile && (target.step!==undefined || target.origin!==undefined) ||
        !tile && tileSize!==undefined || atlas!==undefined &&
        (units==='uv' || !tuple(atlas,2,n=>Number.isSafeInteger(n) && n>0)))
      throw new TypeError('UV grid snap needs a u or v axis and a positive texel or UV step, or a tile grid');
    const explicitGrid = tileSize===undefined ? undefined : TilesetSelection.tileSize(tileSize);
    const dimension = axis==='u' ? 0 : 1, materials = new Map(), guides = new Map();
    function lineFor(material,at) {
      if (!materials.has(material)) {
        const source = units==='uv' ? {} : sourcePixelGrid(material,atlasFor,atlas,tile,explicitGrid,'snap');
        const span = source.atlas ? source.atlas[dimension]-1 : 1;
        const origin = tile ? (source.grid[dimension ? 'offsetY' : 'offsetX'] ?? 0) : offset;
        const interval = tile ? tileStride(source.grid)[dimension] : spacing;
        const limit = tile ? span+1-source.grid[dimension ? 'height' : 'width'] : span;
        const epsilon = Number.EPSILON*span*4;
        const first = tile ? 0 : Math.ceil((-origin-epsilon)/interval);
        const last = Math.floor((limit-origin+epsilon)/interval);
        if (!span) throw new RangeError('UV grid snap cannot resolve a line along a one-texel axis for '+material);
        if (!Number.isFinite(origin) || origin<0 || origin>span || ![first,last].every(Number.isSafeInteger))
          throw new RangeError('UV grid snap needs an in-bounds origin and representable grid lines for '+material);
        materials.set(material,{material,...source,span,first,last,origin,step:interval});
      }
      const {span,first,last,origin,step} = materials.get(material);
      const index = Math.min(last,Math.max(first,Math.round((at*span-origin)/step)));
      const coordinate = Math.max(0,Math.min(1,(origin+index*step)/span));
      const points = dimension ? [[0,coordinate],[1,coordinate]] : [[coordinate,0],[coordinate,1]];
      guides.set(JSON.stringify([material,coordinate]),{material,points});
      return coordinate;
    }
    return {dimension,lineFor,guides,evidence:()=>({kind:'grid',axis,units,
      materials:[...materials.values()].map(({span,first,last,...row})=>row)})};
  }

  function snapReference(g,target) {
    const {kind,corner,edge,face,selection:saved} = target;
    if (!fields(target,['kind','corner','edge','face','selection']) || !['chart','seam'].includes(kind) ||
        [corner,edge,saved].filter(n=>n!==undefined).length!==1 || face!==undefined && edge===undefined)
      throw new TypeError('Choose a chart corner, chart edge side, or seam side by ID or saved selection');
    const picked = saved===undefined ? undefined : select(g.doc,{domain:saved?.domain,from:saved,uvSet:g.set});
    if (picked && (picked.ids.length!==1 || !['corners','edges'].includes(picked.domain)))
      throw new RangeError('Snap needs one reference corner or edge side');
    const anchor = g.corners.get(corner ?? (picked?.domain==='corners' ? picked.ids[0] : undefined));
    if (corner!==undefined || picked?.domain==='corners') {
      if (!anchor || kind!=='chart') throw new RangeError('Choose an existing chart corner');
      return {kind,face:anchor.face,corners:[anchor.id],points:[anchor.uv.slice()]};
    }
    const edgeId = edge ?? picked?.ids[0], row = g.edges.get(edgeId);
    if (!row || kind==='seam' && row.kind!=='seam') throw new RangeError('Choose an existing '+kind+' edge');
    const sides = edgeSides(g,[edgeId],picked?.edgeSides ?? (face===undefined ? undefined : [{edge:edgeId,face}]));
    if (sides.length!==1 && (kind==='seam' || row.kind!=='continuous'))
      throw new RangeError('Choose the reference edge side by face or saved selection');
    const side = sides[0], points = side.corners.map(id=>g.corners.get(id).uv.slice());
    if (sameUV(...points)) throw new RangeError('Snap needs a nondegenerate reference edge');
    return {kind,edge:edgeId,face:side.face,corners:side.corners,points};
  }

  function snapElements(g,operation,points,atlasFor,conflict) {
    const {scope,target,domain=operation.selection?.domain ?? 'corners'} = operation;
    if (!fields(operation,['op','ids','selection','scope','domain','target']) ||
        !['corners','edges'].includes(domain) || !['together','independent'].includes(scope) || !target)
      throw new TypeError('Snap UV corners or edges with together or independent scope and a grid, chart, or seam target');
    const ids = targets(g,domain,operation);
    const selected = selection(g,domain,ids,undefined,operation.selection?.edgeSides);
    const sides = selected.edgeSides;
    if (sides) {
      const split = sides.filter(({edge})=>g.edges.get(edge).kind!=='continuous').map(({edge})=>edge);
      if (new Set(split).size!==split.length) throw new RangeError('Choose the source edge side with a saved UV selection');
    }

    const grid = target.kind==='grid' ? snapGrid(target,atlasFor) : undefined;
    const reference = grid ? undefined : snapReference(g,target);
    if (reference && sides && (reference.points.length!==2 || ids.length!==1))
      throw new RangeError('Snap one source edge to one chart or seam edge');
    const materialOf = face=>g.faces.get(face).material;
    const material = reference && materialOf(reference.face);
    const size = reference && atlasFor?.(material)?.size;
    const weights = size ? size.map(n=>Math.max(1,n-1)**2) : [1,1];
    const distance2 = (a,b)=>a.reduce((sum,n,i)=>sum+(n-b[i])**2*weights[i],0);
    const island = reference && g.atIsland.get(reference.face), fixed = new Set(reference?.corners);
    const expand = cornerOverlaps(g), groups = new Map(), proposals = new Map();
    function propose(id,uv) {
      if (scope==='together' && !groups.has(id)) {
        const group = expand([id]);
        for (const corner of group) groups.set(corner,group);
      }
      for (const corner of groups.get(id) ?? [id]) {
        const prior = proposals.get(corner);
        if (prior && !prior.every((n,i)=>Math.abs(n-uv[i])<=1e-12))
          conflict('snap-competing-targets',{corner,proposed:[prior,uv]});
        else if (fixed.has(corner) && !uv.every((n,i)=>n===g.corners.get(corner).uv[i]))
          conflict('snap-moves-reference',{corner,proposed:uv});
        else if (!prior) proposals.set(corner,uv);
      }
    }
    function eligible(face) {
      if (grid) return true;
      const code = materialOf(face)!==material ? 'snap-different-material' :
        reference.kind==='chart' && g.atIsland.get(face)===island ? 'snap-same-chart' : undefined;
      if (code) conflict(code,{face,reference:reference.face});
      return !code;
    }
    function onGrid(uv,line) {
      return uv.map((n,i)=>i===grid.dimension ? line : n);
    }
    function onReference(uv) {
      const [a,b] = reference.points;
      if (!b) return a;
      const delta = b.map((n,i)=>n-a[i]), length = distance2(a,b);
      const t = delta.reduce((sum,n,i)=>sum+n*(uv[i]-a[i])*weights[i],0)/length;
      return t<=0 ? a : t>=1 ? b : a.map((n,i)=>n+t*delta[i]);
    }
    if (sides) for (const {edge,face,corners} of sides) {
      if (!eligible(face)) continue;
      const [a,b] = corners.map(id=>g.corners.get(id).uv);
      if (grid) {
        const line = grid.lineFor(materialOf(face),(a[grid.dimension]+b[grid.dimension])*.5);
        corners.forEach((id,i)=>propose(id,onGrid(i ? b : a,line)));
      } else {
        const [c,d] = reference.points;
        const reverse = edge!==reference.edge && distance2(a,d)+distance2(b,c)<distance2(a,c)+distance2(b,d);
        propose(corners[0],reverse ? d : c);
        propose(corners[1],reverse ? c : d);
      }
    } else for (const id of selected.corners) {
      const {uv,face} = g.corners.get(id);
      if (eligible(face)) propose(id,grid ? onGrid(uv,grid.lineFor(materialOf(face),uv[grid.dimension])) : onReference(uv));
    }
    const motion = moveCornerScope(g,selected.corners,scope,points,({id,uv})=>proposals.get(id) ?? uv,expand);
    const guides = grid ? [...grid.guides.values()] : [{material,points:reference.points}];
    return {ids,evidence:{domain,scope,target:grid ? grid.evidence() : reference,guides,...motion}};
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

  function draft(g, operation, options) {
    const {atlasFor} = options;
    if (operation?.op === 'set-pivot') return setPivot(g,operation);
    if (!operation || typeof operation !== 'object' ||
        !['cut', 'stitch', 'pin', 'transform', 'orient', 'normalize-orientation', 'scale', 'move-corners', 'nudge', 'snap', 'unwrap', 'flatten', 'relax', 'texel-budget', 'remap-face'].includes(operation.op))
      throw new TypeError('Use a UV pivot, cut, stitch, pin, transform, orientation, reference normalization, scale, nudge, snap, flatten, corner move, face remap, local solve or texel budget operation');
    const points = new Map(), edges = new Map(), pins = new Map(), conflicts = [];
    let count = 0;
    function conflict(code, evidence) {
      count++;
      if (conflicts.length < 128) conflicts.push({ code, ...evidence });
    }
    let ids, evidence;
    const local = operation.op === 'unwrap' || operation.op === 'relax';
    const connected = operation.op==='unwrap' && operation.across==='geometry';
    const precise = connected || ['remap-face','orient','normalize-orientation','scale','move-corners','nudge','snap','flatten'].includes(operation.op);
    const preserveWinding = local || ['stitch','scale','move-corners','nudge','snap'].includes(operation.op);
    if (local) {
      ids = targets(g, 'faces', operation);
      evidence = connected ? connectedUnwrap(g,ids,operation,points,edges,conflict) :
        meshUVRegions.local(g, ids, operation, points, conflict);
    } else if (operation.op==='flatten') {
      const domain = operation.domain ?? operation.selection?.domain ?? 'faces';
      if (!['faces','islands'].includes(domain)) throw new TypeError('Flatten selected faces or UV islands');
      ids = targets(g,domain,operation);
      evidence = meshUVFlatten.projection(g,selection(g,domain,ids).faces,operation,points,options,conflict);
    } else if (operation.op === 'texel-budget') {
      evidence = meshUVTexelBudget.assign(g, operation, points, conflict);
      ids = order((evidence.islands ?? []).map(row => row.id));
    } else if (operation.op === 'remap-face') ids = remapFace(g,operation,points,conflict);
    else if (operation.op === 'transform') ({ids,evidence} = transform(g, operation, points));
    else if (operation.op === 'orient') ({ids,evidence} = orient(g,operation,points,atlasFor));
    else if (operation.op === 'normalize-orientation') ({ids,evidence} = normalizeGrain(g,operation,points,conflict));
    else if (operation.op === 'scale') ({ids,evidence} = scaleUV(g,operation,points,atlasFor,conflict));
    else if (operation.op === 'move-corners') ({ids,evidence} = moveCorners(g,operation,points));
    else if (operation.op === 'nudge') ({ids,evidence} = nudge(g,operation,points,atlasFor));
    else if (operation.op === 'snap') ({ids,evidence} = snapElements(g,operation,points,atlasFor,conflict));
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
    const mirrored = operation.op==='orient' && evidence.mirrored ? new Set(points.keys()) : null;
    const normalized = operation.op==='normalize-orientation' ?
      new Set(evidence.faces.filter(row=>row.flipX).map(row=>row.face)) : null;
    for (const [id, uv] of points) {
      const corner = g.corners.get(id);
      const unchanged = precise ? uv.every((n,i)=>n === corner.uv[i]) : sameUV(uv,corner.uv);
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
      else if (before * after < 0 && (preserveWinding || operation.op==='orient' && !corners.every(id=>mirrored?.has(id)) ||
          normalized && !normalized.has(face)))
        conflict('flipped-uv-triangle', { face, corners });
    }
    if (!count && local && points.size) meshUVRegions.checkOverlaps(g, points, conflict);
    const report = { op: operation.op, ids, pointEdits: points.size, conflictCount: count, conflicts,
      ...(evidence && { evidence }) };
    if (count || !points.size && !edges.size && !pins.size) return { document: g.doc, report };
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
    if (evidence?.edgeChanges) {
      const next = graph(document,g.set);
      evidence.edgeChanges = [...g.edges.values()].flatMap(({id,kind})=>{
        const after = next.edges.get(id).kind;
        return kind === after ? [] : [{edge:id,before:kind,after}];
      });
    }
    return { document, report };
  }

  function plan(source, request, options = {}) {
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
        { ...operation, protect: request.protect } : operation,options);
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
    const pivotBefore = base.doc.uvPivots?.[base.set] ?? null, pivotAfter = document.uvPivots?.[base.set] ?? null;
    const pivotChanged = JSON.stringify(pivotBefore)!==JSON.stringify(pivotAfter);
    const patch = { ...(faceChanges.length && { faces: faceChanges }), ...(seamPatch.length && { edges: seamPatch }),
      ...(bindingsChanged && {uvBindings:document.uvBindings}), ...(pivotChanged && {uvPivots:document.uvPivots ?? {}}) };
    const flatten = canCommit && options.retainFlatten ? operations.filter(row=>row.op==='flatten').flatMap(row=>
      row.evidence.faces.map(({face,binding})=>({face,uvSet:base.set,binding}))) : [];
    return { document, patch, ...(flatten.length && {flatten}), report: { canCommit, mesh: document.id, revision, outputRevision: topology.revision(document),
      ...(base.set && {uvSet:base.set}), ...(bindingsChanged && {bindingsBefore:base.doc.uvBindings ?? {},bindingsAfter:document.uvBindings}),
      ...(pivotChanged && {pivot:{before:pivotBefore,after:pivotAfter}}),
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

  K.meshTopology = Object.freeze({ ...topology, uv: Object.freeze({ fromTriangles, inspect, select, toTopologySelection, pickModel, modelFaces, readability, plan }) });
})(KIT);
