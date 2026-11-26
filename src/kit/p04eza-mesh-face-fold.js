/* Resolve a shared edge, then rotate a single face around its fixed endpoints. */
const meshFaceFold = (function (K) {
  const {V,M} = K, {freeze} = K.procedural.data;
  const name = value=>typeof value === 'string' && Boolean(value.trim());

  function plan(doc,request,rotate) {
    const T = K.meshTopology, {selection:saved,frame,operation,space} = request;
    if (Object.keys(request).some(key=>!['selection','frame','operation','space'].includes(key)) ||
        space !== undefined && space !== 'local' ||
        Object.getPrototypeOf(operation) !== Object.prototype ||
        Object.keys(operation).some(key=>!['kind','edge','from','degrees'].includes(key)) ||
        !name(operation.edge) || operation.from !== undefined && !name(operation.from) ||
        !Number.isFinite(operation.degrees) || saved?.domain !== 'faces')
      throw new TypeError('Fold one selected face in local space using a shared edge, signed degrees, and optional starting endpoint');
    const {edge:id,from,degrees} = operation;
    const selection = T.select(doc,{from:saved});
    if (selection.ids.length !== 1) throw new RangeError('Fold needs exactly one selected face');
    const [faceId] = selection.ids, g = retainedMeshHealth.incidence(doc);
    const hinge = g.edges.find(edge=>edge.id === id);
    if (hinge?.uses.length !== 2 || !hinge.uses.some(use=>use.face === faceId) ||
        retainedMeshHealth.crossesWinding(...hinge.uses,g.corners))
      throw new RangeError('Fold needs a consistently wound edge shared by the selected face and one stationary face');

    const {after:pivot,target} = T.planPivot(doc,{frame,target:{kind:'edge',id,from}});
    const endpoints = target.vertices.map(vertex=>g.vertices.get(vertex).position);
    const span = V.sub(endpoints[1],endpoints[0]), length = V.len(span);
    if (!length || !Number.isFinite(length)) throw new RangeError('Fold hinge needs distinct finite endpoints');
    const axis = V.mul(span,1/length), angle = degrees % 360;
    const face = g.faces.get(faceId), stationary = hinge.uses.find(use=>use.face !== faceId).face;
    const pinned = new Set(target.vertices);
    for (const {vertex} of face.corners) {
      // A face can also have a separate corner lying exactly on the hinge line.
      const offset = V.sub(g.vertices.get(vertex).position,endpoints[0]);
      if (V.cross(span,offset).every(value=>value===0)) pinned.add(vertex);
    }
    const moving = new Set(face.corners.map(corner=>corner.vertex).filter(vertex=>!pinned.has(vertex)));
    const attached = doc.faces.flatMap(other=>{
      if (other.id === faceId) return [];
      const vertices = other.corners.map(corner=>corner.vertex).filter(vertex=>moving.has(vertex));
      return vertices.length ? [{face:other.id,vertices}] : [];
    });
    const evidence = {kind:'fold',face:faceId,stationary,material:face.material,degrees,
      hinge:{edge:id,from:target.vertices[0],vertices:target.vertices,endpoints,axis},
      replay:{selection,...(frame !== undefined && {frame}),operation:{kind:'fold',edge:id,from:target.vertices[0],degrees}}};
    const revision = T.revision(doc);
    if (attached.length && angle) return freeze({document:doc,patch:{vertices:[]},report:{
      format:'ink-studio/mesh-component-transform',version:1,mesh:doc.id,beforeRevision:revision,afterRevision:revision,
      selection,space:'local',pivot:pivot.local,worldPivot:pivot.world,pinned:[...pinned].sort(),vertices:[],
      operation:evidence,canCommit:false,issues:[{kind:'off-hinge-attachments',faces:attached}]
    }});

    const rotated = rotate(doc,{selection,frame,pivot:pivot.local,pins:{vertices:[...pinned]},
      operation:{kind:'rotate',axis:span,degrees:angle}});
    const authored = rotated.patch.vertices.length && face.corners.some(corner=>corner.normal);
    const matrix = authored && M.rot(axis,angle*(Math.PI/180));
    const patch = authored ? {...rotated.patch,faces:[meshWinding.edit(face,false,normal=>M.app(matrix,normal))]} : rotated.patch;
    const document = authored ? T.edit(doc,patch) : rotated.document;
    const issues = [];
    if (patch.vertices.length) {
      const scope = T.select(document,{domain:'faces',ids:[faceId]});
      const health = T.health(document,{selection:scope,duplicateDistance:0,sliverQuality:0,limit:16});
      if (health.counts.selfIntersections) issues.push({kind:'fold-contact',contacts:health.findings.selfIntersections,
        count:health.counts.selfIntersections});
      if (!health.work.intersectionsComplete) issues.push({kind:'fold-check-budget'});
    }
    return freeze({document,patch,report:{...rotated.report,afterRevision:T.revision(document),
      operation:evidence,canCommit:!issues.length,issues}});
  }

  return {plan};
})(KIT);
