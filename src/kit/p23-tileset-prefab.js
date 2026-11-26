/* Promote retained tile faces into an ordinary linked visual prefab. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, {V} = K;
  const {freeze} = K.procedural.data;
  const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
  const fields = (row, keys) => record(row) && Object.keys(row).every(key => keys.includes(key));

  function resolveOrigin(scene, origin, env) {
    if (origin?.kind === 'object-point') {
      const {target,local,world,...evidence} = A.objectPoints.resolve(scene,env,origin);
      return {...evidence,at:target};
    }
    if (fields(origin,['kind']) && origin.kind === 'plane')
      return {kind:'plane',at:A.constructionPlane.forScene(scene).plane.origin};
    if (fields(origin,['kind','id','at']) && origin.kind === 'point' && K.world.data.id(origin.id) && meshPivot.xyz(origin.at))
      return {kind:'point',id:origin.id,at:origin.at.slice()};
    if (fields(origin,['kind','object','vertex']) && origin.kind === 'vertex') {
      const {object,vertex,target} = A.constructionPlane.originTarget(scene,origin);
      return {kind:'vertex',object,vertex,at:target};
    }
    throw new TypeError('Choose the construction plane, an object point, named XYZ point, or named scene vertex as the prefab origin');
  }

  function subset(row, doc, faces, edges, vertices, bindings, origin) {
    const used = new Set(faces.map(face => face.material));
    return {...row, document:T.create({...doc,faces,edges,
      vertices:origin ? vertices.map(vertex => ({...vertex,position:V.sub(vertex.position,origin)})) : vertices}),
      ...(row.bindings && {bindings}),
      ...(origin && row.materials && {materials:row.materials.filter(material => used.has(material.id))}),
      ...(origin && row.bakes && {bakes:row.bakes.filter(bake => used.has(bake.material))}),
      ...(origin && row.pivot && {pivot:V.sub(row.pivot,origin)}),
      ...(origin && row.points && {points:Object.fromEntries(Object.entries(row.points).map(([id,point]) =>
        [id,{...point,position:V.sub(point.position,origin)}]))})};
  }

  function partition(row, doc, selected, origin) {
    const edgeInfo = T.inspect(doc).edges;
    const moveEdges = new Set(), keepEdges = new Set();
    for (const edge of edgeInfo) {
      if (edge.uses.some(use => selected.has(use.face))) moveEdges.add(edge.id);
      if (edge.uses.some(use => !selected.has(use.face))) keepEdges.add(edge.id);
    }
    const sharedEdges = [...moveEdges].filter(id => keepEdges.has(id));
    // Preserve smooth fans across a boundary that will become two separate meshes.
    const normals = sharedEdges.length && meshTopologyShading.resolve(doc,edgeInfo,
      new Map(doc.vertices.map(vertex => [vertex.id,vertex])));
    const moveFaces = [], keepFaces = [], moveCorners = new Set(), keepCorners = new Set();
    const moveVertices = new Set(), keepVertices = new Set();
    for (const face of doc.faces) {
      const move = selected.has(face.id), corners = move ? moveCorners : keepCorners;
      const vertices = move ? moveVertices : keepVertices;
      for (const corner of face.corners) {
        corners.add(corner.id);
        vertices.add(corner.vertex);
      }
      (move ? moveFaces : keepFaces).push(normals ? {...face,corners:face.corners.map(corner =>
        !corner.normal && normals.has(corner.id) ? {...corner,normal:normals.get(corner.id)} : corner)} : face);
    }
    const move = {faces:selected,edges:moveEdges,corners:moveCorners};
    const keep = {faces:new Set(keepFaces.map(face => face.id)),edges:keepEdges,corners:keepCorners};
    const all = !keepFaces.length, bindings = row.bindings ?? [];
    const promoted = subset(row,doc,moveFaces,doc.edges.filter(edge => moveEdges.has(edge.id)),
      doc.vertices.filter(vertex => moveVertices.has(vertex.id)),
      bindings.filter(binding => all || !binding.review && move[binding.domain].has(binding.element)),origin);
    const remainder = all ? null : subset(row,doc,keepFaces,doc.edges.filter(edge => keepEdges.has(edge.id)),
      doc.vertices.filter(vertex => keepVertices.has(vertex.id) || !moveVertices.has(vertex.id)),
      bindings.filter(binding => binding.review || keep[binding.domain].has(binding.element)));
    return {promoted,remainder,sharedEdges};
  }

  function plan(scene, request, env) {
    const {id,own} = K.world.data;
    const {prefab,instance=prefab,faces,origin={kind:'plane'}} = request ?? {};
    if (!fields(request,['prefab','instance','faces','origin']) || !id(prefab) || !id(instance) ||
        !record(faces) || !Object.keys(faces).length)
      throw new TypeError('Prefab promotion needs a new prefab ID and selected tile faces by editable object');
    const frame = resolveOrigin(scene,origin,env), conflicts = [], sources = [], decals = [], uses = new Set();
    const report = {format:'ink-studio/tileset-prefab-promotion',version:1,prefab,instance,origin:frame,
      canCommit:false,sources,decals,conflicts};
    const {spec} = A.scenePrefabs.expand(scene,env);
    if (own(scene.prefabs ?? {},prefab) || own(env.prefabs ?? {},prefab)) conflicts.push({kind:'prefab-in-use',id:prefab});
    if (own(scene.instances ?? {},instance)) conflicts.push({kind:'instance-in-use',id:instance});
    const loose = scene.topologyMeshes ?? {}, topologyMeshes = {...loose}, topologyMembers = {};
    const occupied = new Set(Object.keys(spec.topologyMeshes ?? {}).concat(spec.solids.map(solid => solid.id)));
    const members = new Set(Object.keys(faces).filter(id));
    const selectionByObject = new Map();
    let ordinal = 0;
    for (const [object, selection] of Object.entries(faces)) {
      if (!own(loose,object)) {
        conflicts.push({kind:'not-a-loose-mesh',object});
        continue;
      }
      const beforeConflicts = conflicts.length;
      const row = loose[object], doc = T.create(row.document);
      const query = Array.isArray(selection) ? {domain:'faces',ids:selection} : {domain:'faces',from:selection};
      if (!selection) throw new TypeError('Use explicit face IDs or a saved face selection for '+object);
      const picked = T.select(doc,query);
      if (!picked.ids.length) throw new RangeError('Select one or more tile faces on '+object);
      const selected = new Set(picked.ids);
      const bindings = (row.bindings ?? []).filter(binding => selected.has(binding.element) &&
        !binding.review && A.tilesetFaces.isSourceBinding(binding));
      const painted = new Set(bindings.map(binding => binding.element));
      const unbound = picked.ids.filter(face => !painted.has(face));
      if (unbound.length) conflicts.push({kind:'face-has-no-tile-binding',object,faces:unbound});
      if (row.part !== undefined || doc.skin || row.modifiers?.some(op => op.enabled !== false) ||
          row.shapeKeys || row.attachments || A.hybridOwnership.manages(scene.hybridOwnership,{object,part:row.part}))
        conflicts.push({kind:'dependent-mesh',object});
      for (const [dependent, mesh] of Object.entries(spec.topologyMeshes ?? {}))
        if (mesh.modifiers?.some(op => op.enabled !== false && op.kind === 'projection' && op.target === object))
          conflicts.push({kind:'projection-target',object,dependent});
      let member = object;
      if (!id(member)) {
        do member = 'mesh-'+(++ordinal); while (members.has(member));
        members.add(member);
      }
      const destination = instance+'.'+member;
      if (occupied.has(destination)) conflicts.push({kind:'object-in-use',object:destination});
      selectionByObject.set(object,{selected,destination,all:selected.size === doc.faces.length});
      if (conflicts.length !== beforeConflicts) continue;
      const {promoted,remainder,sharedEdges} = partition(row,doc,selected,frame.at);
      topologyMembers[member] = promoted;
      if (remainder) topologyMeshes[object] = remainder;
      else delete topologyMeshes[object];
      const sheets = [
        ...bindings.map(binding => binding.data.selection?.tileset),
        ...(promoted.materials ?? []).map(material => material.texture?.tileset),
        ...(promoted.bakes ?? []).map(bake => bake.maps.texture?.tileset)
      ].filter(Boolean);
      for (const sheet of sheets) uses.add(sheet);
      sources.push({object,member,destination,selection:picked,remaining:remainder?.document.faces.length ?? 0,
        sharedEdges,tilesets:[...new Set(sheets)].sort()});
    }

    const currentDecals = scene.surfaceDecals?.decals;
    const nextDecals = currentDecals?.map(decal => {
      const {anchor} = decal, scope = selectionByObject.get(anchor.object);
      if (!scope) return decal;
      if (!scope.all && anchor.face === undefined) {
        conflicts.push({kind:'decal-needs-face',object:anchor.object,decal:decal.id});
        return decal;
      }
      if (!scope.all && !scope.selected.has(anchor.face)) return decal;
      decals.push({id:decal.id,from:anchor.object,to:scope.destination,...(anchor.face !== undefined && {face:anchor.face})});
      return {...decal,anchor:{...anchor,object:scope.destination}};
    });
    if (conflicts.length) return {report:freeze(report)};
    const definition = {revision:1,solids:{},topologyMeshes:topologyMembers,usesTilesets:[...uses].sort()};
    const placement = {prefab,transform:{translation:frame.at}};
    const patch = {topologyMeshes,prefabs:{...scene.prefabs,[prefab]:definition},
      instances:{...scene.instances,[instance]:placement},
      ...(decals.length && {surfaceDecals:{...scene.surfaceDecals,decals:nextDecals}})};
    const hinge = scene.constructionPlane?.edgeAnchor;
    if (hinge && selectionByObject.has(hinge.object) &&
        !topologyMeshes[hinge.object]?.document.edges.some(edge => edge.id === hinge.edge)) {
      const {edgeAnchor,...plane} = A.constructionPlane.forScene(scene).plane;
      patch.constructionPlane = plane;
      report.detachedPlaneEdge = edgeAnchor;
    }
    return {patch,report:freeze({...report,canCommit:true,placement,usesTilesets:definition.usesTilesets})};
  }

  A.tilesetPrefab = Object.freeze({plan});
})(KIT);
