/* Explicit repair plans. Stable face and corner lineage follows topology transactions. */
const retainedMeshRepair = (function (K) {
  const topology = K.meshTopology, { V } = K;
  const { incidence, edgeSeam, crossesWinding, sameUV } = retainedMeshHealth;
  const { freeze, clone } = K.procedural.data;
  const format = 'ink-studio/mesh-repair';
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const record = (value, keys) => !!value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));

  function weld(doc, op) {
    if (!record(op, ['kind', 'keep', 'remove', 'maxDistance', 'weights', 'removeCollapsed']) ||
        !Array.isArray(op.remove) || !op.remove.length || new Set(op.remove).size !== op.remove.length ||
        op.remove.includes(op.keep) || !Number.isFinite(op.maxDistance) || op.maxDistance < 0 ||
        op.weights !== undefined && !['match', 'keep', 'average'].includes(op.weights) ||
        op.removeCollapsed !== undefined && typeof op.removeCollapsed !== 'boolean')
      throw new TypeError('Weld needs a retained vertex, distinct removed vertices, and a nonnegative maximum distance');
    const vertices = index(doc.vertices), keeper = vertices.get(op.keep), removed = [...op.remove].sort();
    if (!keeper || removed.some(id => !vertices.has(id))) throw new RangeError('Unknown weld vertex');
    const source = removed.map(id => vertices.get(id));
    if (source.some(row => V.dist(row.position, keeper.position) > op.maxDistance))
      throw new RangeError('Weld vertices exceed the maximum distance');
    const policy = op.weights ?? 'match';
    if (policy === 'match' && source.some(row => !equal(row.weights, keeper.weights)))
      throw new RangeError('Weld weights differ. Choose keep or average to resolve them');
    const verticesToUpdate = [];
    if (policy === 'average') {
      const rows = [keeper, ...source], names = [...new Set(rows.flatMap(row => Object.keys(row.weights ?? {})))].sort();
      if (names.length) verticesToUpdate.push({ ...keeper, weights: Object.fromEntries(names.map(name =>
        [name, rows.reduce((sum, row) => sum + (Object.hasOwn(row.weights ?? {}, name) ? row.weights[name] : 0), 0) / rows.length])) });
    }
    const remapped = new Set(removed), swap = id => remapped.has(id) ? keeper.id : id;
    const faces = [], removeFaces = [], corners = [];
    for (const face of doc.faces) {
      if (!face.corners.some(corner => remapped.has(corner.vertex))) continue;
      const ring = face.corners.map(corner => ({ ...corner, vertex: swap(corner.vertex) }));
      if (new Set(ring.map(corner => corner.vertex)).size < 3) {
        if (!op.removeCollapsed) throw new RangeError('Weld collapses face ' + face.id + '. Set removeCollapsed to remove it');
        removeFaces.push(face.id);
        continue;
      }
      const compact = [];
      function retain(kept, lost) {
        if (!sameUV(kept.uv, lost.uv)) throw new RangeError('Weld would collapse different corner UVs on ' + face.id);
        if (!equal(kept.normal, lost.normal)) throw new RangeError('Weld would collapse different corner normals on ' + face.id);
        if (!equal(kept.attributes, lost.attributes)) throw new RangeError('Weld would collapse different corner attributes on ' + face.id);
        corners.push({ from: lost.id, to: kept.id });
      }
      for (const corner of ring) {
        const prior = compact.at(-1);
        if (corner.vertex === prior?.vertex) retain(prior, corner);
        else compact.push(corner);
      }
      if (compact[0].vertex === compact.at(-1).vertex) retain(compact[0], compact.pop());
      const revised = {...face,corners:compact};
      if (compact.length !== face.corners.length) delete revised.diagonal;
      faces.push(revised);
    }
    const next = topology.edit(doc, { vertices: verticesToUpdate, removeVertices: removed, faces, removeFaces });
    const nextEdge = new Map(next.edges.map(edge => [JSON.stringify(edge.vertices), edge.id]));
    const edges = doc.edges.flatMap(edge => {
      if (!edge.vertices.some(id => remapped.has(id))) return [];
      const id = nextEdge.get(JSON.stringify(edge.vertices.map(swap).sort()));
      return id ? [{ from: edge.id, to: id }] : [];
    });
    return { document: next, links: { corners, edges },
      effect: { kind: 'weld', keep: keeper.id, removed, removedFaces: removeFaces, weights: policy } };
  }

  function facePlane(g, [a, b, c]) {
    const pos = corner => g.vertices.get(corner.vertex).position;
    const origin = pos(a), u = V.sub(pos(b), origin), v = V.sub(pos(c), origin);
    const raw = V.cross(u, v), length = V.len(raw);
    if (!length) throw new RangeError('Dissolve needs a stable face plane');
    const normal = V.mul(raw, 1 / length);
    return corner => {
      const d = V.sub(pos(corner), origin);
      return {distance:V.dot(d,normal),x:V.dot(V.cross(d,v),normal)/length,y:V.dot(V.cross(u,d),normal)/length};
    };
  }

  const layout = corner => Object.entries(meshCornerTint.generic(corner) ?? {}).map(([key,value])=>
    [key,Array.isArray(value) ? value.length : 0]);
  const weights = (g,corner) => g.vertices.get(corner.vertex).weights ?? {};
  const weight = (g,corner,channel) => Object.hasOwn(weights(g,corner),channel) ? weights(g,corner)[channel] : 0;
  const affine = (a,b,c,x,y) => a+x*(b-a)+y*(c-a);
  const blend = ([a,b,c],x,y) => a.map((n,i)=>affine(n,b[i],c[i],x,y));
  const tint = (row,mode='multiply') => {
    const values = meshCornerTint.stream(row,mode);
    return [values[0],values[1],values[2],values[3] ?? 1];
  };

  function dissolveMapping(doc, g, face, corners, tolerance) {
    const triangle = topology.triangulate(doc).triangleSources.find(row => row.face === face.id);
    const [a, b, c] = triangle.corners.map(id => g.corners.get(id));
    const coordinates = facePlane(g,[a,b,c]), attributeLayout = layout(a);
    if (corners.some(corner => !equal(corner.normal, a.normal)))
      throw new RangeError('Dissolve would change authored corner normal interpolation');
    if (corners.some(corner => !equal(layout(corner), attributeLayout)))
      throw new RangeError('Dissolve would merge different corner attribute layouts');
    const channels = [...new Set(corners.flatMap(corner => Object.keys(weights(g,corner))))];
    for (const corner of corners) {
      const {distance,x,y} = coordinates(corner);
      if (Math.abs(distance) > tolerance) throw new RangeError('Dissolve would remove a geometric crease');
      const uv = blend([a.uv,b.uv,c.uv],x,y);
      if (!sameUV(corner.uv, uv)) throw new RangeError('Dissolve would change the face UV interpolation');
      for (const [channel, width] of attributeLayout) {
        const values = [a, b, c, corner].map(row => width ? row.attributes[channel] : [row.attributes[channel]]);
        if (values[0].some((start, i) => Math.abs(values[3][i] - start - x * (values[1][i] - start) -
            y * (values[2][i] - start)) > 1e-6))
          throw new RangeError('Dissolve would change corner attribute interpolation for ' + channel);
      }
      if (!sameUV(tint(corner,doc.tintBlend),blend([a,b,c].map(row=>tint(row,doc.tintBlend)),x,y),1e-6))
        throw new RangeError('Dissolve would change corner tint interpolation');
      for (const channel of channels) {
        const expected = affine(weight(g,a,channel),weight(g,b,channel),weight(g,c,channel),x,y);
        if (Math.abs(weight(g,corner,channel) - expected) > 1e-6)
          throw new RangeError('Dissolve would change weight interpolation for ' + channel);
      }
    }
  }

  function outside(face, use) {
    const start = face.corners.findIndex(corner => corner.id === use.to);
    return [...face.corners.slice(start), ...face.corners.slice(0, start)];
  }

  function dissolve(doc, op) {
    const { tolerance = .000001 } = op;
    if (!record(op, ['kind', 'edge', 'keep', 'tolerance']) || !Number.isFinite(tolerance) || tolerance < 0)
      throw new TypeError('Dissolve needs a shared edge and an optional plane tolerance');
    const g = incidence(doc), edge = g.edges.find(row => row.id === op.edge);
    if (edge?.uses.length !== 2) throw new RangeError('Dissolve needs a manifold edge between two faces');
    if (edge.smooth === false || edge.crease > 0)
      throw new RangeError('Dissolve would remove an authored hard edge or subdivision crease');
    const uses = [...edge.uses].sort((a, b) => a.face < b.face ? -1 : 1);
    if (op.keep !== undefined) {
      if (!uses.some(use => use.face === op.keep)) throw new RangeError('Dissolve keeper must be one of the incident faces');
      if (uses[1].face === op.keep) uses.reverse();
    }
    const [a, b] = uses.map(use => g.faces.get(use.face));
    if (a.material !== b.material) throw new RangeError('Dissolve would remove a material boundary');
    if (a.smoothingGroup !== b.smoothingGroup) throw new RangeError('Dissolve would remove a smoothing group boundary');
    if (crossesWinding(...uses, g.corners)) throw new RangeError('Repair face winding before dissolving this edge');
    if (edgeSeam(edge, g.corners).seam) throw new RangeError('Dissolve would remove a UV seam');
    dissolveMapping(doc, g, a, [...a.corners, ...b.corners], tolerance);
    const first = outside(a, uses[0]), second = outside(b, uses[1]);
    const corners = [...first, ...second.slice(1, -1)];
    const next = topology.edit(doc, { faces: [{ id:a.id, material:a.material, smoothingGroup:a.smoothingGroup, corners }], removeFaces: [b.id] });
    return { document: next,
      links: { faces: [{ from: b.id, to: a.id }], corners: [
        { from: second[0].id, to: first.at(-1).id }, { from: second.at(-1).id, to: first[0].id }
      ] }, effect: { kind: 'dissolve', edge: edge.id, keep: a.id, removedFace: b.id } };
  }

  function orientation(g, anchor) {
    const links = new Map([...g.faces.keys()].map(id => [id, []]));
    for (const edge of g.edges) if (edge.uses.length === 2) {
      const [a, b] = edge.uses, flip = crossesWinding(a, b, g.corners);
      links.get(a.face).push({ id: b.face, flip });
      links.get(b.face).push({ id: a.face, flip });
    }
    const reverse = new Map([[anchor, false]]), queue = [anchor];
    for (let i = 0; i < queue.length; i++) for (const { id, flip } of links.get(queue[i])) {
      const wanted = reverse.get(queue[i]) !== flip;
      if (reverse.has(id)) {
        if (reverse.get(id) !== wanted) throw new RangeError('This face region has no consistent manifold winding');
      } else {
        reverse.set(id, wanted);
        queue.push(id);
      }
    }
    return [...reverse].filter(([, flip]) => flip).map(([id]) => id);
  }

  function winding(doc, op) {
    const { normals = 'preserve' } = op;
    if (!record(op, ['kind', 'anchor', 'faces', 'selection', 'normals', 'viewFrom']) ||
        ['anchor','faces','selection'].filter(key=>op[key] !== undefined).length !== 1 ||
        op.faces !== undefined && (!Array.isArray(op.faces) || !op.faces.length) ||
        !['preserve','reverse'].includes(normals))
      throw new TypeError('Winding needs an anchor, explicit face IDs, or a saved face selection and optional normal policy');
    const viewFrom = meshWinding.direction(op.viewFrom);
    const selection = op.selection !== undefined && K.meshTopology.select(doc,{from:op.selection,domain:'faces'});
    if (selection && !selection.ids.length) throw new RangeError('Select at least one face to reverse');
    const g = incidence(doc);
    if ((op.faces ?? selection?.ids ?? [op.anchor]).some(id => !g.faces.has(id))) throw new RangeError('Unknown winding face');
    const ids = [...new Set(op.faces ?? selection?.ids ?? orientation(g, op.anchor))].sort();
    const normal = normals === 'reverse' ? n=>n.map(value=>-value || 0) : undefined;
    const faces = ids.map(id=>meshWinding.edit(g.faces.get(id),true,normal));
    const document = faces.length ? topology.edit(doc, { faces }) : doc;
    return { document, links: {}, effect: { kind: 'winding', reversed: ids, normals,
      ...(op.anchor !== undefined && { anchor: op.anchor }), ...(viewFrom && {viewFrom}),
      facing:meshWinding.changes(doc,document,ids.map(from=>({from})),viewFrom),
      windingConflicts:meshWinding.conflicts(document,new Set(ids)) } };
  }

  function quadSelection(doc, op, label, fields = []) {
    if (!record(op,['kind','faces','selection',...fields]) || (op.faces === undefined) === (op.selection === undefined) ||
        op.faces !== undefined && (!Array.isArray(op.faces) || !op.faces.length))
      throw new TypeError(label + ' needs face IDs or a saved face selection');
    const {ids} = K.meshTopology.select(doc,op.selection === undefined ?
      {domain:'faces',ids:op.faces} : {domain:'faces',from:op.selection});
    if (!ids.length) throw new RangeError(label + ' needs at least one selected quad');
    return ids;
  }

  function neighboringPlane(g, face, neighborId) {
    const neighbor = g.faces.get(neighborId);
    if (!neighbor || neighbor.id === face.id) throw new RangeError('Choose a distinct neighboring face to guide the quad');
    const shared = g.edges.filter(edge=>[face.id,neighbor.id].every(id=>edge.uses.some(use=>use.face === id)));
    const guideVertices = new Set(neighbor.corners.map(row=>row.vertex));
    if (shared.length !== 1 || shared[0].uses.length !== 2 ||
        face.corners.filter(row=>guideVertices.has(row.vertex)).length !== 2)
      throw new RangeError('Straighten quad needs exactly one manifold edge with its guiding face');
    const [edge] = shared;
    const point = id=>g.vertices.get(id).position;
    const [origin,end] = edge.vertices.map(point);
    const along = V.sub(end,origin), axis = V.mul(along,1/V.len(along));
    const orientation = meshFaceRegionGeometry.area(neighbor.corners.map(row=>point(row.vertex)));
    // Keep the plane through both edge vertices even when the guide itself is warped.
    const normal = V.mad(orientation,axis,-V.dot(orientation,axis));
    if (V.len(normal) <= 1e-8*V.len(orientation))
      throw new RangeError('The guiding face needs a stable orientation about the shared edge');
    return {origin,normal,edge:edge.id,vertices:edge.vertices,neighbor:neighbor.id};
  }

  function straightenQuad(doc, op) {
    const label = 'Straighten quad';
    const ids = quadSelection(doc,op,label,['plane','neighbor']);
    if ((op.plane === undefined) === (op.neighbor === undefined))
      throw new TypeError('Straighten quad needs a mesh-local plane or a neighboring face ID');
    if (op.neighbor !== undefined && ids.length !== 1)
      throw new RangeError('Straighten one quad when using a neighboring face');
    const g = incidence(doc), faces = ids.map(id=>g.faces.get(id));
    if (faces.some(face=>face.corners.length !== 4))
      throw new RangeError('Straighten quad needs four-corner faces');
    const guide = op.neighbor === undefined ? null : neighboringPlane(g,faces[0],op.neighbor);
    const input = guide ? {origin:guide.origin,normal:guide.normal} : op.plane;
    const {origin,normal,distance} = meshComponentSnap.explicitPlane(input,label,'mesh-local');
    const hinge = new Set(guide?.vertices), positions = new Map(), edits = [];
    for (const face of faces) for (const {vertex} of face.corners) {
      if (positions.has(vertex)) continue;
      const before = g.vertices.get(vertex).position, signed = distance(before);
      const tolerance = 32*Number.EPSILON*Math.hypot(...V.sub(before,origin));
      const after = hinge.has(vertex) || Math.abs(signed) <= tolerance ? before : V.mad(before,normal,-signed);
      if (!Number.isFinite(signed) || after.some(n=>!Number.isFinite(n)))
        throw new RangeError('Straighten plane projection needs finite coordinates');
      const moved = after.some((value,i)=>value !== before[i]);
      positions.set(vertex,{before,after,delta:V.sub(after,before),distanceBefore:signed,distanceAfter:distance(after),moved});
      if (moved) edits.push({id:vertex,position:after});
    }
    const describe = ({id:corner,vertex})=>({corner,vertex,...positions.get(vertex)});
    const selected = new Set(ids);
    const effect = {kind:'straighten-quad',
      plane:{origin,normal,source:guide ? 'neighbor' : 'explicit',
        ...(guide && {neighbor:guide.neighbor,edge:guide.edge,hinge:guide.vertices})},
      faces:faces.map(face=>{
        const corners = face.corners.map(describe);
        return {face:face.id,corners,
          maxBefore:Math.max(...corners.map(row=>Math.abs(row.distanceBefore))),
          maxAfter:Math.max(...corners.map(row=>Math.abs(row.distanceAfter)))};
      }),
      adjacent:edits.length ? doc.faces.flatMap(face=>{
        if (selected.has(face.id)) return [];
        const corners = face.corners.filter(row=>positions.get(row.vertex)?.moved).map(describe);
        return corners.length ? [{face:face.id,corners}] : [];
      }) : []};
    try {
      return {document:edits.length ? topology.edit(doc,{vertices:edits}) : doc,links:{},effect};
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return {document:doc,links:{},effect,blockers:[{code:'invalid-straightened-quad',
        faces:ids,message:'Cannot straighten quad: '+error.message}]};
    }
  }

  function faceTriangles(source, ids) {
    const rows = new Map(ids.map(id=>[id,[]]));
    for (const row of topology.triangulate(source).triangleSources)
      if (rows.has(row.face)) rows.get(row.face).push(row.corners);
    return rows;
  }

  function flipDiagonal(doc, op) {
    const ids = quadSelection(doc,op,'Flip diagonal'), g = incidence(doc);
    const before = faceTriangles(doc,ids);
    const patch = ids.map(id=>{
      const face = g.faces.get(id);
      if (face.corners.length !== 4) throw new RangeError('Flip diagonal needs a four-corner face: ' + id);
      const [a,b] = before.get(id);
      const ends = new Set(a.filter(corner=>b.includes(corner)));
      return {...face,diagonal:face.corners.map(row=>row.id).filter(corner=>!ends.has(corner))};
    });
    const document = topology.edit(doc,{faces:patch});
    const after = faceTriangles(document,ids), uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
    function describe(rows) {
      const [a,b] = rows;
      const diagonal = a.filter(id=>b.includes(id)).sort();
      const vertex = id=>g.corners.get(id).vertex;
      const point = id=>g.vertices.get(vertex(id)).position.map(Math.fround);
      const samples = rows.map(corners=>{
        const [a,b,c] = corners.map(point);
        const cross = V.cross(V.sub(b,a),V.sub(c,a)), length = V.len(cross);
        return { corners, vertices:corners.map(vertex), normal:cross.map(n=>n/length || 0) };
      });
      const dot = V.dot(samples[0].normal,samples[1].normal);
      return { diagonal, vertices:diagonal.map(vertex), midpoint:V.lerp(...diagonal.map(point),.5),
        midpointUV:MaterialUV.uv(g.corners.get(diagonal[0]),uvSet).map((n,i)=>
          (n+MaterialUV.uv(g.corners.get(diagonal[1]),uvSet)[i])*.5),
        bendDegrees:Math.acos(Math.min(1,Math.max(-1,dot)))*180/Math.PI, triangles:samples };
    }
    return {document,links:{},effect:{kind:'flip-diagonal',uvSet,faces:ids.map(face=>({
      face,before:describe(before.get(face)),after:describe(after.get(face))
    }))}};
  }

  function splitQuad(doc, op) {
    const ids = quadSelection(doc,op,'Split quad'), g = incidence(doc);
    const triangles = faceTriangles(doc,ids), revision = topology.revision(doc);
    const used = new Set([...doc.vertices,...doc.edges,...doc.faces,...g.corners.values()].map(row=>row.id));
    const edgeKey = ids => JSON.stringify(ids.slice().sort());
    function fresh(base) {
      let id = base;
      for (let n=2;used.has(id);n++) id = base+'/'+n;
      used.add(id);
      return id;
    }
    const faces = [], links = {faces:[],corners:[]};
    const splits = ids.map(id=>{
      const face = g.faces.get(id);
      if (face.corners.length !== 4) throw new RangeError('Split quad needs a four-corner face: ' + id);
      const rings = triangles.get(id).slice();
      if (!rings[0].includes(face.corners[0].id)) rings.reverse();
      const added = fresh(id+'/triangle'), retained = new Set(rings[0]);
      const diagonal = rings[1].filter(corner=>retained.has(corner)).map(corner=>g.corners.get(corner).vertex);
      links.faces.push({from:id,to:added});
      const children = rings.map((ring,i)=>{
        const child = i===0 ? id : added;
        const corners = ring.map((from,j)=>{
          let to = from;
          if (i && retained.has(from)) {
            to = fresh(child+'/c'+j);
            links.corners.push({from,to});
          }
          return {from,to};
        });
        const polygon = {id:child,material:face.material,smoothingGroup:face.smoothingGroup,
          corners:corners.map(({from,to})=>({...g.corners.get(from),id:to})),
          sourceQuad:{mesh:doc.id,face:id,revision,corners:ring}};
        faces.push(polygon);
        return {face:child,corners};
      });
      return {sourceFace:id,material:face.material,vertices:diagonal.slice().sort(),triangles:children};
    });
    const document = topology.edit(doc,{faces}), edges = new Map(document.edges.map(row=>[edgeKey(row.vertices),row.id]));
    return {document,links,effect:{kind:'split-quad',faces:splits.map(row=>({...row,edge:edges.get(edgeKey(row.vertices))}))}};
  }

  function joinEdge(doc, g, op, label) {
    if (op.edge !== undefined) {
      const edge = g.edges.find(row=>row.id === op.edge);
      if (edge?.uses.length !== 2) throw new RangeError(label + ' needs a manifold edge between two faces');
      return edge;
    }
    const {ids} = K.meshTopology.select(doc,op.selection === undefined ?
      {domain:'faces',ids:op.faces} : {domain:'faces',from:op.selection});
    if (ids.length !== 2) throw new RangeError(label + ' needs exactly two selected faces');
    const shared = g.edges.filter(row=>ids.every(id=>row.uses.some(use=>use.face === id)));
    if (shared.length !== 1 || shared[0].uses.length !== 2)
      throw new RangeError(label + ' needs exactly one manifold shared edge');
    return shared[0];
  }

  function joinUVs(edge, keep, remove, shared) {
    const layouts = [0,...MaterialUV.setsOf(keep.corners[0])];
    const sets = [...new Set([...layouts,...Object.keys(edge.uvSeams ?? {}).map(Number)])].sort((a,b)=>a-b);
    return sets.map(set=>{
      if (!layouts.includes(set)) return {set,authored:true,discontinuous:false,endpoints:[]};
      const endpoints = shared.map(({kept,lost})=>{
        const after = MaterialUV.uv(kept,set), prior = MaterialUV.uv(lost,set);
        const pinned = {keep:MaterialUV.pinned(kept,set),remove:MaterialUV.pinned(lost,set)};
        return {vertex:kept.vertex,keepCorner:kept.id,removeCorner:lost.id,
          before:[{face:keep.id,uv:after,pinned:pinned.keep},{face:remove.id,uv:prior,pinned:pinned.remove}],
          after,delta:after.map((n,i)=>n-prior[i]),pinnedAfter:pinned.keep || pinned.remove};
      });
      return {set,authored:MaterialUV.seam(edge,set),
        discontinuous:endpoints.some(({delta})=>delta.some(n=>n !== 0)),endpoints};
    });
  }

  function retainPins(corner,lost) {
    return {...corner,uvPinned:corner.uvPinned || lost.uvPinned,uvPins:{...corner.uvPins,...lost.uvPins}};
  }

  function prepareTriangleJoin(doc, g, edge, op, uvs) {
    const uses = [...edge.uses].sort((a,b)=>a.face < b.face ? -1 : 1);
    const faces = uses.map(use=>g.faces.get(use.face));
    if (faces.some(face=>face.corners.length !== 3) ||
        new Set(faces.flatMap(face=>face.corners.map(corner=>corner.vertex))).size !== 4)
      throw new RangeError('Join triangles needs two triangular faces with four distinct vertices');
    if (crossesWinding(...uses,g.corners)) throw new RangeError('Repair face winding before joining triangles');
    if (faces[0].material !== faces[1].material) throw new RangeError('Join triangles would remove a material boundary');
    if (faces[0].smoothingGroup !== faces[1].smoothingGroup)
      throw new RangeError('Join triangles would remove a smoothing group boundary');
    if (edge.smooth === false || edge.crease > 0)
      throw new RangeError('Join triangles would remove an authored hard edge or subdivision crease');
    if (!equal(layout(faces[0].corners[0]),layout(faces[1].corners[0])))
      throw new RangeError('Join triangles needs matching corner attribute layouts');

    const [a,b] = faces.map(face=>face.sourceQuad ?? {});
    const sourceFace = a.mesh === doc.id && a.mesh === b.mesh && a.face === b.face && a.revision === b.revision ? a.face : undefined;
    const keeper = op.keep ?? (faces.some(face=>face.id === sourceFace) ? sourceFace : faces[0].id);
    if (!faces.some(face=>face.id === keeper)) throw new RangeError('Join keeper must be one of the incident triangles');
    if (keeper === faces[1].id) { faces.reverse(); uses.reverse(); }
    const [keep,remove] = faces;
    const [first,second] = faces.map((face,i)=>outside(face,uses[i]));
    const shared = [{kept:first[0],lost:second[2]},{kept:first[2],lost:second[0]}];
    const nonUV = corner=>Object.entries(corner.attributes ?? {}).filter(([key])=>!MaterialUV.isKey(key));
    if (shared.some(({kept,lost})=>!equal(kept.normal,lost.normal) || !equal(nonUV(kept),nonUV(lost))))
      throw new RangeError('Join triangles would discard differing shared corner normals or non-UV attributes');

    const uvSets = joinUVs(edge,keep,remove,shared);
    const seams = uvSets.filter(row=>row.authored || row.discontinuous).map(row=>row.set);
    const corners = [...first,second[1]].map(corner=>{
      const lost = shared.find(row=>row.kept === corner)?.lost;
      return lost ? retainPins(corner,lost) : corner;
    });
    const start = corners.findIndex(corner=>corner.id === keep.corners[0].id);
    const ring = [...corners.slice(start),...corners.slice(0,start)];
    const diagonal = shared.map(({kept})=>kept.id).sort();
    const quad = {id:keep.id,material:keep.material,smoothingGroup:keep.smoothingGroup,corners:ring,diagonal};
    const links = {faces:[{from:remove.id,to:keep.id}],
      corners:shared.map(({kept,lost})=>({from:lost.id,to:kept.id}))};
    const effect = {kind:'join-triangles',edge:edge.id,vertices:edge.vertices,keep:keep.id,removedFace:remove.id,
      material:keep.material,cornerOrder:ring.map(corner=>corner.id),diagonal,uvs,uvSets,seams,links,
      triangles:faces.map(({id,corners,sourceQuad})=>({face:id,corners:corners.map(row=>row.id),...(sourceQuad && {sourceQuad})}))};
    if (uvs === 'match' && seams.length) {
      const message = 'Join triangles would remove a UV seam. Set uvs to keep to accept the previewed change';
      return {quad,links,effect,blockers:[{code:'join-uv-seam',edge:edge.id,sets:seams,message}]};
    }
    return {quad,links,effect};
  }

  function joinTriangles(doc, op) {
    const {uvs = 'match'} = op;
    if (!record(op,['kind','edge','faces','selection','keep','uvs']) ||
        ['edge','faces','selection'].filter(key=>op[key] !== undefined).length !== 1 ||
        op.faces !== undefined && (!Array.isArray(op.faces) || op.faces.length !== 2) ||
        !['match','keep'].includes(uvs))
      throw new TypeError('Join triangles needs an edge, two face IDs, or a saved face selection, and a match or keep UV policy');
    const g = incidence(doc), edge = joinEdge(doc,g,op,'Join triangles');
    const {quad,links,effect,blockers} = prepareTriangleJoin(doc,g,edge,op,uvs);
    const joined = topology.edit(doc,{faces:[quad],removeFaces:[effect.removedFace]});
    return blockers ? {document:doc,links:{},effect,blockers} : {document:joined,links,effect};
  }

  function tileRegistration(g, faces, reference, mode) {
    const corners = faces.flatMap(face=>face.corners);
    const coordinates = facePlane(g,reference);
    const origin = g.vertices.get(reference[0].vertex).position;
    const span = Math.max(...corners.map(corner=>V.dist(origin,g.vertices.get(corner.vertex).position)));
    const uvSets = [0,...MaterialUV.setsOf(reference[0])];
    const attributes = layout(reference[0]).filter(([key])=>!MaterialUV.isKey(key));
    const joints = [...new Set(corners.flatMap(corner=>Object.keys(weights(g,corner))))].sort();
    const issues = [];
    for (const face of faces) for (const corner of face.corners) {
      const {distance,x,y} = coordinates(corner);
      if (Math.abs(distance) > 1e-7*span)
        issues.push({kind:'geometry-interpolation',face:face.id,corner:corner.id,planeDistance:distance});
      const compare = (kind, channel, values, actual) => {
        const expected = blend(values,x,y);
        if (!sameUV(actual,expected,1e-9)) issues.push({kind,...channel,face:face.id,corner:corner.id,actual,expected});
      };
      for (const set of uvSets)
        compare('uv-interpolation',{set},reference.map(row=>MaterialUV.uv(row,set)),MaterialUV.uv(corner,set));
      for (const [key,width] of attributes) {
        const value = row=>width ? row.attributes[key] : [row.attributes[key]];
        compare('attribute-interpolation',{attribute:key},reference.map(value),value(corner));
      }
      compare('attribute-interpolation',{attribute:'tint'},reference.map(row=>tint(row,mode)),tint(corner,mode));
      for (const joint of joints) {
        const value = row=>[weight(g,row,joint)];
        compare('weight-interpolation',{joint},reference.map(value),value(corner));
      }
      if (reference.some(row=>!equal(row.normal,corner.normal))) issues.push({
        kind:'corner-shading',face:face.id,corner:corner.id,normal:corner.normal ?? null});
    }
    return issues;
  }

  function mergeTiles(doc, op) {
    const {mode = 'safe'} = op;
    if (!record(op,['kind','edge','faces','selection','keep','mode']) ||
        ['edge','faces','selection'].filter(key=>op[key] !== undefined).length !== 1 ||
        op.faces !== undefined && (!Array.isArray(op.faces) || op.faces.length !== 2) ||
        !['safe','force'].includes(mode))
      throw new TypeError('Merge tiles needs a shared edge, two face IDs, or a saved face selection, and safe or force mode');
    const g = incidence(doc), edge = joinEdge(doc,g,op,'Merge tiles');
    const uses = [...edge.uses].sort((a,b)=>a.face < b.face ? -1 : 1);
    const keeper = op.keep ?? uses[0].face;
    if (!uses.some(use=>use.face === keeper)) throw new RangeError('Merge keeper must be one of the incident tiles');
    if (keeper === uses[1].face) uses.reverse();
    const faces = uses.map(use=>g.faces.get(use.face)), [keep,remove] = faces;
    if (faces.some(face=>face.corners.length < 4) ||
        new Set(faces.flatMap(face=>face.corners.map(corner=>corner.vertex))).size !==
          keep.corners.length+remove.corners.length-2)
      throw new RangeError('Merge tiles needs two polygonal tiles meeting only at the shared edge');
    if (crossesWinding(...uses,g.corners)) throw new RangeError('Repair face winding before merging tiles');
    if (!equal(layout(keep.corners[0]),layout(remove.corners[0])))
      throw new RangeError('Merge tiles needs matching corner attribute layouts');

    const before = faceTriangles(doc,faces.map(face=>face.id));
    const reference = before.get(keep.id)[0].map(id=>g.corners.get(id));
    const discarded = tileRegistration(g,faces,reference,doc.tintBlend);
    if (keep.material !== remove.material)
      discarded.push({kind:'material',face:remove.id,before:remove.material,after:keep.material});
    if (keep.smoothingGroup !== remove.smoothingGroup)
      discarded.push({kind:'smoothing-group',face:remove.id,before:remove.smoothingGroup ?? null,after:keep.smoothingGroup ?? null});
    const {id,vertices,uses:incidents,...settings} = edge;
    if (Object.keys(settings).length) discarded.push({kind:'authored-edge',edge:{id,vertices,...settings}});
    const [first,second] = faces.map((face,i)=>outside(face,uses[i]));
    const shared = [{kept:first[0],lost:second.at(-1)},{kept:first.at(-1),lost:second[0]}];
    const uvSets = joinUVs(edge,keep,remove,shared);
    for (const {set,endpoints} of uvSets) for (const change of endpoints) {
      if (change.delta.some(n=>n !== 0)) discarded.push({kind:'shared-uv',set,...change});
    }
    const keepPins = new Map(shared.map(({kept,lost})=>[kept.id,lost]));
    const corners = [...first,...second.slice(1,-1)].map(corner=>
      keepPins.has(corner.id) ? retainPins(corner,keepPins.get(corner.id)) : corner);
    const start = corners.findIndex(corner=>corner.id === keep.corners[0].id);
    const ring = [...corners.slice(start),...corners.slice(0,start)];
    const polygon = {id:keep.id,material:keep.material,corners:ring,
      ...(keep.smoothingGroup !== undefined && {smoothingGroup:keep.smoothingGroup})};
    const document = topology.edit(doc,{faces:[polygon],removeFaces:[remove.id]});
    const links = {faces:[{from:remove.id,to:keep.id}],
      corners:shared.map(({kept,lost})=>({from:lost.id,to:kept.id}))};
    const effect = {kind:'merge-tiles',mode,edge:id,vertices,keep:keep.id,removedFace:remove.id,discarded,uvSets,links,
      before:faces.map(face=>({...face,triangles:before.get(face.id)})),
      after:{...polygon,triangles:faceTriangles(document,[keep.id]).get(keep.id)}};
    if (mode === 'safe' && discarded.length) {
      const message = 'Merging these tiles changes registered data. Preview mode force to choose what to discard';
      return {document:doc,links:{},effect,blockers:[{code:'tile-merge-loss',edge:id,message}]};
    }
    return {document,links,effect};
  }

  function patchFor(before, after, transfers) {
    const { vertices, faces, corners, edges } = K.authoring.meshTopologyScene.diff({ document: before }, { document: after });
    const beforeIncidence = incidence(before), afterIncidence = incidence(after);
    const changedWeights = vertices.filter(row => !equal(row.before?.weights, row.after?.weights))
      .map(({ id, before, after }) => ({ id, before: before?.weights ?? null, after: after?.weights ?? null }));
    const affected = new Set(edges.map(row => row.id).concat([...transfers.edges.keys()], [...transfers.edges.values()]));
    const changedFaces = new Set(faces.map(row => row.id));
    function seams(g) {
      return g.edges.filter(edge => affected.has(edge.id) || edge.uses.some(use => changedFaces.has(use.face)))
        .map(edge => edgeSeam(edge, g.corners));
    }
    const patches = {};
    for (const [name, changes] of [['vertices', vertices], ['faces', faces]]) if (changes.length) {
      const map = index(after[name]), added = changes.filter(row => row.after).map(row => {
        const value = map.get(row.id);
        return name === 'vertices' && row.before?.weights !== undefined && value.weights === undefined ?
          { ...value, weights: null } : value;
      });
      // New records must append in the order produced by the planned steps.
      const appended = new Set(changes.filter(row=>!row.before && row.after).map(row=>row.id));
      const removed = changes.filter(row => row.after === null).map(row => row.id);
      if (added.length) patches[name] = added.filter(row=>!appended.has(row.id))
        .concat(after[name].filter(row=>appended.has(row.id)));
      if (removed.length) patches['remove' + name[0].toUpperCase() + name.slice(1)] = removed;
    }
    const idsFor = g => ({ faces: g.faces, corners: g.corners, edges: index(g.edges) });
    const oldIds = idsFor(beforeIncidence), newIds = idsFor(afterIncidence);
    const lineage = Object.fromEntries(Object.entries(transfers).map(([domain, rows]) => [domain, [...rows]
      .filter(([from, to]) => from !== to && oldIds[domain].has(from) && newIds[domain].has(to))
      .map(([from, to]) => ({ from, to }))]).filter(([, rows]) => rows.length));
    if (Object.keys(lineage).length) patches.lineage = lineage;
    const materials = faces.map(({ id, before, after }) => ({ id, before: before?.material ?? null, after: after?.material ?? null }));
    const blockers = afterIncidence.edges.flatMap(edge => edge.uses.length > 2 &&
      edge.uses.length > (oldIds.edges.get(edge.id)?.uses.length ?? 0) ?
      [{ code: 'new-non-manifold-edge', edge: edge.id, faces: edge.uses.map(use => use.face).sort() }] : []);
    return { patch: patches, blockers, changes: { vertices, edges, faces, corners,
      weights: changedWeights, materials, seams: { before: seams(beforeIncidence), after: seams(afterIncidence) } } };
  }

  function planRepair(source, request) {
    const before = topology.create(source);
    if (!record(request, ['revision', 'operations']) || !Array.isArray(request.operations) ||
        !request.operations.length || request.operations.length > 128)
      throw new TypeError('Repair needs a topology revision and 1 to 128 explicit operations');
    if (request.revision !== topology.revision(before)) throw new RangeError('Stale mesh repair revision');
    const commands = { weld, dissolve, winding, 'flip-diagonal': flipDiagonal, 'split-quad': splitQuad,
      'join-triangles': joinTriangles, 'merge-tiles':mergeTiles, 'straighten-quad':straightenQuad };
    const steps = [], transfers = { faces: new Map(), corners: new Map(), edges: new Map() };
    let after = before, refused = [];
    for (const [i, op] of request.operations.entries()) {
      if (!op || !Object.hasOwn(commands, op.kind)) throw new TypeError('Unknown mesh repair operation at ' + i);
      const result = commands[op.kind](after, op);
      after = result.document;
      for (const [domain, links] of Object.entries(result.links)) {
        const map = transfers[domain], current = new Map(links.map(row => [row.from, row.to]));
        for (const [from, to] of map) if (current.has(to)) map.set(from, current.get(to));
        for (const row of links) if (!map.has(row.from)) map.set(row.from, row.to);
      }
      steps.push({ index: i, ...result.effect });
      if (result.blockers?.length) {
        refused = result.blockers;
        after = before;
        break;
      }
    }
    const { patch, changes, blockers } = patchFor(before, after, transfers);
    // A persisted patch must resolve temporary edges exactly as the planned sequence did.
    if (Object.keys(patch).length && !equal(topology.edit(before, patch), after))
      throw new RangeError('Repair sequence cannot be represented as one stable topology patch');
    return freeze({ document: after, patch, report: { format, version: 1, mesh: before.id,
      beforeRevision: topology.revision(before), afterRevision: topology.revision(after),
      canCommit: !(refused.length || blockers.length), blockers: [...refused,...blockers],
      operations: clone(request.operations), steps, changes } });
  }

  K.meshTopology = Object.freeze({ ...topology, planRepair });
  return { tileRegistration, prepareTriangleJoin };
})(KIT);
