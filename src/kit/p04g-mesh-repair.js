/* Explicit repair plans. Stable face and corner lineage follows topology transactions. */
(function (K) {
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
      faces.push({ id:face.id, material:face.material, corners:compact,
        ...(compact.length===face.corners.length && face.diagonal && {diagonal:face.diagonal}) });
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

  function dissolveMapping(doc, g, face, corners, tolerance) {
    const triangle = topology.triangulate(doc).triangleSources.find(row => row.face === face.id);
    const [a, b, c] = triangle.corners.map(id => g.corners.get(id));
    const pos = corner => g.vertices.get(corner.vertex).position;
    const origin = pos(a), u = V.sub(pos(b), origin), v = V.sub(pos(c), origin);
    const raw = V.cross(u, v), length = V.len(raw);
    if (!length) throw new RangeError('Dissolve needs a stable face plane');
    const normal = V.mul(raw, 1 / length);
    const layout = corner => Object.entries(corner.attributes ?? {}).map(([name, data]) => [name, Array.isArray(data) ? data.length : 0]);
    const attributeLayout = layout(a);
    if (corners.some(corner => !equal(corner.normal, a.normal)))
      throw new RangeError('Dissolve would change authored corner normal interpolation');
    if (corners.some(corner => !equal(layout(corner), attributeLayout)))
      throw new RangeError('Dissolve would merge different corner attribute layouts');
    const channels = [...new Set(corners.flatMap(corner => Object.keys(g.vertices.get(corner.vertex).weights ?? {})))];
    const weight = (corner, channel) => {
      const weights = g.vertices.get(corner.vertex).weights ?? {};
      return Object.hasOwn(weights, channel) ? weights[channel] : 0;
    };
    for (const corner of corners) {
      const d = V.sub(pos(corner), origin);
      if (Math.abs(V.dot(d, normal)) > tolerance) throw new RangeError('Dissolve would remove a geometric crease');
      const x = V.dot(V.cross(d, v), normal) / length, y = V.dot(V.cross(u, d), normal) / length;
      const uv = a.uv.map((n, i) => n + x * (b.uv[i] - n) + y * (c.uv[i] - n));
      if (!sameUV(corner.uv, uv)) throw new RangeError('Dissolve would change the face UV interpolation');
      for (const [channel, width] of attributeLayout) {
        const values = [a, b, c, corner].map(row => width ? row.attributes[channel] : [row.attributes[channel]]);
        if (values[0].some((start, i) => Math.abs(values[3][i] - start - x * (values[1][i] - start) -
            y * (values[2][i] - start)) > 1e-6))
          throw new RangeError('Dissolve would change corner attribute interpolation for ' + channel);
      }
      for (const channel of channels) {
        const start = weight(a, channel);
        const expected = start + x * (weight(b, channel) - start) + y * (weight(c, channel) - start);
        if (Math.abs(weight(corner, channel) - expected) > 1e-6)
          throw new RangeError('Dissolve would change weight interpolation for ' + channel);
      }
    }
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
    if (crossesWinding(...uses, g.corners)) throw new RangeError('Repair face winding before dissolving this edge');
    if (edgeSeam(edge, g.corners).seam) throw new RangeError('Dissolve would remove a UV seam');
    dissolveMapping(doc, g, a, [...a.corners, ...b.corners], tolerance);
    function outside(face, use) {
      const start = face.corners.findIndex(corner => corner.id === use.to);
      return [...face.corners.slice(start), ...face.corners.slice(0, start)];
    }
    const first = outside(a, uses[0]), second = outside(b, uses[1]);
    const corners = [...first, ...second.slice(1, -1)];
    const next = topology.edit(doc, { faces: [{ id:a.id, material:a.material, corners }], removeFaces: [b.id] });
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

  function flipDiagonal(doc, op) {
    if (!record(op,['kind','faces','selection']) || (op.faces === undefined) === (op.selection === undefined) ||
        op.faces !== undefined && (!Array.isArray(op.faces) || !op.faces.length))
      throw new TypeError('Flip diagonal needs face IDs or a saved face selection');
    const {ids} = K.meshTopology.select(doc,op.selection === undefined ?
      {domain:'faces',ids:op.faces} : {domain:'faces',from:op.selection});
    if (!ids.length) throw new RangeError('Choose at least one quad to flip its diagonal');
    const g = incidence(doc), selected = new Set(ids);
    function triangles(source) {
      const rows = new Map(ids.map(id=>[id,[]]));
      for (const row of topology.triangulate(source).triangleSources)
        if (selected.has(row.face)) rows.get(row.face).push(row.corners);
      return rows;
    }
    const before = triangles(doc);
    const patch = ids.map(id=>{
      const face = g.faces.get(id);
      if (face.corners.length !== 4) throw new RangeError('Flip diagonal needs a four-corner face: ' + id);
      const [a,b] = before.get(id);
      const ends = new Set(a.filter(corner=>b.includes(corner)));
      return {...face,diagonal:face.corners.map(row=>row.id).filter(corner=>!ends.has(corner))};
    });
    const document = topology.edit(doc,{faces:patch});
    const after = triangles(document), uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
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
      const removed = changes.filter(row => row.after === null).map(row => row.id);
      if (added.length) patches[name] = added;
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
    const commands = { weld, dissolve, winding, 'flip-diagonal': flipDiagonal };
    const steps = [], transfers = { faces: new Map(), corners: new Map(), edges: new Map() };
    let after = before;
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
    }
    const { patch, changes, blockers } = patchFor(before, after, transfers);
    // A persisted patch must resolve temporary edges exactly as the planned sequence did.
    if (Object.keys(patch).length && !equal(topology.edit(before, patch), after))
      throw new RangeError('Repair sequence cannot be represented as one stable topology patch');
    return freeze({ document: after, patch, report: { format, version: 1, mesh: before.id,
      beforeRevision: topology.revision(before), afterRevision: topology.revision(after),
      canCommit: !blockers.length, blockers, operations: clone(request.operations), steps, changes } });
  }

  K.meshTopology = Object.freeze({ ...topology, planRepair });
})(KIT);
