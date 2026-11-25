/* Place a selected atlas rectangle on a retained mesh polygon. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const sourceFormat = 'ink-studio/tileset-face-source';
  const fields = ['object','part','face','selection','origin','right','up','planeAt','snapGrid','texelsPerUnit','brushScale','material'];
  const name = value=>TargetSelectors.name(value) && !['__proto__','prototype','constructor'].includes(value);

  function sourceBindings(row, id, update) {
    const changes = [];
    const bindings = row.bindings?.map(binding=>{
      const before = binding.data;
      const pick = before?.selection;
      if (binding.domain !== 'faces' || before?.format !== sourceFormat || before.version !== 1 ||
          pick?.tileset !== id || ![pick.x,pick.y,pick.width,pick.height].every(Number.isSafeInteger)) return binding;
      const after = update(before);
      if (!after || after === before) return binding;
      changes.push({face:binding.element,binding:binding.id,before,after});
      return {...binding,data:after};
    });
    return {bindings,changes};
  }

  function prepare(scene, request, {projectTexelsPerUnit} = {}, cellSize) {
    const {object,part,face,selection,origin,right,up,planeAt,snapGrid=false,
      texelsPerUnit,brushScale=1,material:requestedMaterial} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.keys(request).some(key=>!fields.includes(key)) ||
        ![object,face].every(name) || part !== undefined && !name(part) ||
        requestedMaterial !== undefined && !name(requestedMaterial) ||
        !selection || selection.format !== 'ink-studio/tileset-selection' || selection.version !== 1)
      throw new TypeError('Tile placement needs object and face IDs and a version 1 exact tileset selection');
    const tilesets = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const asset = tilesets.source(selection.tileset);
    const crop = TilesetSelection.pick(selection.tileset,asset,selection);
    const {positiveScale} = A.tilesets;
    const density = positiveScale(texelsPerUnit ?? tilesets.texelsPerUnit ?? projectTexelsPerUnit ?? 16,'Texels per unit');
    positiveScale(brushScale,'Brush scale');
    const size = cellSize ?? [crop.width,crop.height].map(pixels=>positiveScale(pixels*brushScale/density,'World tile extent'));
    if (planeAt !== undefined && [origin,right,up].some(value=>value !== undefined))
      throw new TypeError('Choose plane grid coordinates or an explicit tile frame');
    if (typeof snapGrid !== 'boolean' || snapGrid && planeAt === undefined)
      throw new TypeError('Grid snapping needs a construction plane placement');
    const plane = A.constructionPlane;
    const frame = planeAt === undefined ? plane.resolve({origin,right,up}) : plane.forScene(scene);
    const source = {format:sourceFormat,version:1,selection:crop,atlasSize:[asset.width,asset.height]};
    const material = requestedMaterial ?? 'tileset/'+crop.tileset;
    const existing = Object.hasOwn(scene.topologyMeshes ?? {},object) ? scene.topologyMeshes[object] : undefined;
    const doc = existing && topology.create(existing.document);
    const uvSet = MaterialUV.resolve(doc?.uvBindings,'pigment');
    const activeSets = [...new Set(Object.values(doc?.uvBindings ?? {}).filter(Boolean))];
    const u = x=>x/Math.max(1,asset.width-1), v = y=>y/Math.max(1,asset.height-1);
    const left=u(crop.x), rightUV=u(crop.x+crop.width-1), top=v(crop.y), bottom=v(crop.y+crop.height-1);
    const unitUV = [[0,1],[1,1],[1,0],[0,0]];
    const pigmentUV = [[left,bottom],[rightUV,bottom],[rightUV,top],[left,top]];
    const conflicts = [];
    if (existing && part !== undefined && part !== existing.part) conflicts.push({reason:'different-mesh-part'});
    const slot = existing?.materials?.find(row=>row.id === material);
    if (slot ? slot.texture?.tileset !== crop.tileset : doc?.faces.some(row=>row.material === material))
      conflicts.push({reason:'material-in-use',material});
    if (existing?.bakes?.some(row=>row.material === material))
      conflicts.push({reason:'material-has-bake',material});
    return {object,part:existing?.part ?? part,existing,doc,frame,snapGrid,source,material,slot,density,brushScale,size,
      uvSet,activeSets,unitUV,pigmentUV,conflicts,faceIds:new Set(doc?.faces.map(row=>row.id)),
      bindingIds:new Set(existing?.bindings?.map(row=>row.id)),vertexIds:new Set(doc?.vertices.map(row=>row.id)),
      cornerIds:new Set(doc?.faces.flatMap(row=>row.corners.map(corner=>corner.id)))};
  }

  function stamp(brush, face, anchor) {
    const {frame,source,material,activeSets,uvSet,unitUV,pigmentUV,vertexIds,cornerIds} = brush;
    const [x,y] = frame.axes, [w,h] = brush.size;
    const positions = [anchor,K.V.mad(anchor,x,w),K.V.mad(K.V.mad(anchor,x,w),y,h),K.V.mad(anchor,y,h)];
    const binding = {id:'tileset/'+face,domain:'faces',element:face,data:source};
    const vertices = positions.map((position,i)=>({id:face+'/v'+i,position}));
    const corners = vertices.map(({id},i)=>({id:face+'/c'+i,vertex:id,uv:uvSet ? unitUV[i] : pigmentUV[i],
      ...(activeSets.length && {attributes:Object.fromEntries(activeSets.map(set=>
        [MaterialUV.key(set),set === uvSet ? pigmentUV[i] : unitUV[i]]))})}));
    const polygon = {id:face,material,corners};
    const conflicts = [];
    if (brush.faceIds.has(face)) conflicts.push({reason:'face-id-in-use',face});
    if (brush.bindingIds.has(binding.id)) conflicts.push({reason:'binding-id-in-use',binding:binding.id});
    for (const {id} of vertices) if (vertexIds.has(id)) conflicts.push({reason:'vertex-id-in-use',vertex:id});
    for (const {id} of corners) if (cornerIds.has(id)) conflicts.push({reason:'corner-id-in-use',corner:id});
    return {polygon,binding,vertices,conflicts};
  }

  function append(brush, stamps) {
    const {existing,doc,part,object,slot,material,source} = brush;
    const added = {vertices:stamps.flatMap(row=>row.vertices),faces:stamps.map(row=>row.polygon)};
    const row = existing ? A.meshTopologyScene.revise(existing,added).row :
      {document:topology.create({id:object,...added}),...(part && {part})};
    if (doc && !existing.modifiers?.some(modifier=>modifier.enabled !== false)) {
      const before = topology.revision(doc), after = topology.revision(row.document);
      // The new disconnected polygon leaves all original anchors and morph deltas valid.
      if (row.attachments?.revision === before) row.attachments = {...row.attachments,revision:after};
      if (row.shapeKeys?.restRevision === before) row.shapeKeys = {...row.shapeKeys,restRevision:after};
    }
    return {...row,bindings:[...(row.bindings ?? []),...stamps.map(stamp=>stamp.binding)],
      materials:slot ? row.materials : [...(row.materials ?? []),{id:material,texture:{tileset:source.selection.tileset}}]};
  }

  function plan(scene, request, options) {
    const brush = prepare(scene,request,options);
    const {face,planeAt} = request;
    const {object,part,source,material,density,brushScale,size,uvSet,frame,snapGrid} = brush;
    const plane = A.constructionPlane;
    const gridAt = snapGrid ? plane.quantize(frame,planeAt) : planeAt;
    const anchor = planeAt === undefined ? frame.plane.origin : plane.point(frame,gridAt);
    const placement = stamp(brush,face,anchor);
    const {vertices,polygon,binding,conflicts:local} = placement;
    const conflicts = [...brush.conflicts,...local];
    const report = freeze({format:'ink-studio/tileset-face-placement',version:1,object,
      ...(part && {part}),face,source,material,binding:binding.id,
      texelsPerUnit:density,brushScale,size,vertices,corners:polygon.corners,uvSet,
      ...(planeAt !== undefined && {constructionPlane:frame.plane,planeAt:planeAt.slice()}),
      ...(snapGrid && {gridAt}),conflicts,canCommit:!conflicts.length});
    return conflicts.length ? {report} : {report,row:append(brush,[placement])};
  }

  A.tilesetFaces = Object.freeze({plan,prepare,stamp,append,sourceBindings});
})(KIT);
