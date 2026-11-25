/* Close an authored triangle or quad with a retained atlas crop. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, { V, procedural: { data: { freeze } } } = K;
  const fields = ['object','part','face','vertices','order','revision','selection','material','materialDefinition','paint','uvInset'];
  const text = value => typeof value === 'string' && !!value.trim();
  const edgeKey = (a,b) => JSON.stringify(a < b ? [a,b] : [b,a]);
  const validIDs = ids => Array.isArray(ids) && [3,4].includes(ids.length) &&
    Array.from(ids).every(text) && new Set(ids).size === ids.length;

  function inferOrder(ids, vertices) {
    const origin = vertices.get(ids[0]).position;
    const spans = ids.slice(1).map(id=>V.sub(vertices.get(id).position,origin));
    let normal = [0,0,0];
    for (const [i,a] of spans.entries()) for (const b of spans.slice(i+1)) {
      const candidate = V.cross(a,b);
      if (V.len(candidate) > V.len(normal)) normal = candidate;
    }
    const axis = [0,1,2].reduce((best,i)=>Math.abs(normal[i]) > Math.abs(normal[best]) ? i : best);
    const projected = ids.map(id=>{
      const p = V.sub(vertices.get(id).position,origin);
      return {id,u:p[(axis+1)%3],v:p[(axis+2)%3]};
    });
    const center = projected.reduce(([u,v],row)=>[u+row.u/ids.length,v+row.v/ids.length],[0,0]);
    const angle = row=>Math.atan2(row.v-center[1],row.u-center[0]);
    projected.sort((a,b)=>angle(a)-angle(b));
    const first = projected.reduce((best,row)=>row.v < best.v || row.v === best.v && row.u < best.u ? row : best);
    const start = projected.indexOf(first);
    return projected.slice(start).concat(projected.slice(0,start)).map(row=>row.id);
  }

  function sharedEdges(order, links, corners) {
    return order.flatMap((from,i)=>{
      const to = order[(i+1)%order.length], edge = links.get(edgeKey(from,to));
      return edge ? [{edge:edge.id,from,to,faces:edge.uses.map(use=>use.face),
        opposite:edge.uses.length === 1 && corners.get(edge.uses[0].from).vertex === to}] : [];
    });
  }

  function plan(scene, request) {
    const {object,part,face,vertices:picked,order:requestedOrder,revision,...brushFields} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.keys(request).some(key=>!fields.includes(key)) ||
        ![object,face].every(text) || !picked || part !== undefined && !text(part) || revision !== undefined && !text(revision))
      throw new TypeError('Tile face needs an editable object, new face ID, and three or four selected vertices');
    const old = Object.hasOwn(scene.topologyMeshes ?? {},object) && scene.topologyMeshes[object];
    if (!old || part !== undefined && old.part !== part) throw new RangeError('No editable topology for scene object '+object);
    const doc = T.create(old.document), beforeRevision = T.revision(doc);
    if (revision !== undefined && revision !== beforeRevision) throw new RangeError('Stale topology revision for painted face');
    const explicit = Array.isArray(picked);
    const ids = explicit ? picked : T.select(doc,{from:picked,domain:'vertices'}).ids;
    if (!validIDs(ids) || explicit && requestedOrder !== undefined ||
        requestedOrder !== undefined && (!validIDs(requestedOrder) || requestedOrder.length !== ids.length ||
          !requestedOrder.every(id=>ids.includes(id))))
      throw new TypeError('Choose three or four distinct vertices and an optional order that matches the saved selection');

    const g = retainedMeshHealth.incidence(doc), links = new Map(g.edges.map(edge=>[edgeKey(...edge.vertices),edge]));
    for (const id of ids) if (!g.vertices.has(id)) throw new RangeError('Unknown face vertex '+id);
    const inferred = !explicit && requestedOrder === undefined;
    let order = inferred ? inferOrder(ids,g.vertices) : (explicit ? ids : requestedOrder).slice();
    let shared = sharedEdges(order,links,g.corners);
    if (inferred && shared.length && shared.every(edge=>edge.faces.length === 1 && !edge.opposite)) {
      order = [order[0],...order.slice(1).reverse()];
      shared = sharedEdges(order,links,g.corners);
    }

    const api = A.tilesetFaces, brush = api.prepare(scene,{object,part,face,...brushFields});
    const uvCorners = order.length === 3 ? [0,1,3] : [0,1,2,3];
    const stamp = api.polygonStamp(brush,face,order,[],order.length === 3 ? uvCorners : undefined);
    const conflicts = [...brush.conflicts,...stamp.conflicts];
    const duplicates = doc.faces.filter(row=>row.corners.length === ids.length && row.corners.every(corner=>ids.includes(corner.vertex)));
    for (const row of duplicates) conflicts.push({reason:'duplicate-face',face:row.id});
    for (const {edge,faces,opposite} of shared) {
      if (faces.length > 1) conflicts.push({reason:'edge-would-be-non-manifold',edge,faces});
      else if (!opposite) conflicts.push({reason:'inconsistent-edge-winding',edge,faces});
    }

    const vertices = order.map(id=>g.vertices.get(id));
    try {
      T.create({id:doc.id,vertices,faces:[stamp.polygon]});
    } catch (error) {
      conflicts.push({reason:'invalid-polygon',message:error.message});
    }
    const area = meshFaceRegionGeometry.area(vertices.map(row=>row.position)), length = V.len(area);
    const row = conflicts.length ? undefined : api.append(brush,[stamp]);
    const report = freeze({format:'ink-studio/tileset-face-from-vertices',version:1,mode:'create face',id:face,object,face,
      ...(old.part !== undefined && {part:old.part}),beforeRevision,vertices,cornerOrder:order,uvCorners,
      orderSource:inferred ? 'inferred' : 'explicit',corners:stamp.polygon.corners,sharedEdges:shared,
      ...(length && {normal:V.mul(area,1/length).map(n=>n || 0)}),uvSet:brush.uvSet,
      source:stamp.binding.data,material:brush.material,binding:stamp.binding.id,conflicts,canCommit:!conflicts.length,
      ...(row && {afterRevision:T.revision(row.document),changes:A.meshTopologyScene.diff(old,row)})});
    return {row,report};
  }

  A.tilesetFaceFromVertices = Object.freeze({plan});
})(KIT);
