/* Grow a painted polygon from a retained boundary edge. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {V} = K, {freeze} = K.procedural.data;
  const fields = ['object','part','edge','face','selection','angle','sizing','depth','paint','uvInset',
    'material','materialDefinition','brushScale','texelsPerUnit','worldSize'];
  const name = value=>typeof value === 'string' && Boolean(value.trim());

  function plan(scene, request, options) {
    const {object,part,edge:id,face,angle=0,sizing,depth,...brushFields} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.keys(request).some(key=>!fields.includes(key)) ||
        ![object,id,face].every(name) || part !== undefined && !name(part) || !Number.isFinite(angle) ||
        sizing !== undefined && !['brush','proportional'].includes(sizing) ||
        depth !== undefined && (sizing !== undefined || !Number.isFinite(depth) || depth<=0))
      throw new TypeError('Grow needs an object, boundary edge, new face ID, finite angle, and a sizing mode or positive depth');
    const rows = scene.topologyMeshes ?? {}, old = Object.hasOwn(rows,object) && rows[object];
    if (!old || part !== undefined && old.part !== part) throw new RangeError('No editable topology for scene object '+object);
    const document = topology.create(old.document), g = retainedMeshHealth.incidence(document);
    const edge = g.edges.find(item=>item.id === id);
    if (!edge) throw new RangeError('Unknown mesh edge '+id+' on '+object);
    const beforeRevision = topology.revision(document), incidentFaces = edge.uses.map(use=>use.face);
    const fit = depth === undefined ? sizing ?? 'proportional' : 'explicit';
    const info = {format:'ink-studio/tileset-face-grow',version:1,mode:'grow',id:face,object,face,
      ...(old.part && {part:old.part}),edge:id,angle,sizing:fit,incidentFaces,beforeRevision};
    const blocked = conflicts=>({report:freeze({...info,conflicts,canCommit:false})});
    if (edge.uses.length !== 1) return blocked([{reason:'edge-is-not-a-boundary'}]);

    // Opposite edge traversal gives the new face compatible winding.
    const use = meshEdgeFlowData.openUse(g,edge), {width,outward} = meshEdgeFlowData.openEdgeFrame(g,use);
    const shared = [use.a,use.b].map(corner=>g.vertices.get(corner.vertex));
    const [start] = shared;
    if (!width) return blocked([{reason:'edge-has-no-span'}]);
    const length = Math.hypot(...outward);
    if (!length) return blocked([{reason:'edge-has-no-outward-direction'}]);
    const frame = A.constructionPlane.tilt(scene,{object,edge:id,from:start.id,degrees:angle,referenceUp:V.mul(outward,1/length)});
    const {origin,right,up} = frame.plane, api = A.tilesetFaces;
    const brush = api.prepare(scene,{object,part,face,origin,right,up,...brushFields},options);
    const crop = brush.source.selection;
    const height = A.tilesets.positiveScale(depth ?? (fit === 'brush' ? brush.size[1] : width*crop.height/crop.width),'Grow depth');
    brush.size = [width,height];

    const stamp = api.stamp(brush,face,start.position,shared);
    const conflicts = [...brush.conflicts,...stamp.conflicts];
    const row = conflicts.length ? undefined : api.append(brush,[stamp]);
    const report = freeze({...info,source:brush.source,material:brush.material,binding:stamp.binding.id,
      size:brush.size,frame:{origin,right,up,normal:frame.axes[2]},sharedVertices:shared,
      vertices:stamp.vertices,corners:stamp.polygon.corners,conflicts,canCommit:!conflicts.length,
      ...(row && {afterRevision:topology.revision(row.document),changes:A.meshTopologyScene.diff(old,row)})});
    return {row,report};
  }

  A.tilesetGrow = Object.freeze({plan});
})(KIT);
