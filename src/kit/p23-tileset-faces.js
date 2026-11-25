/* Place a selected atlas rectangle on a retained mesh polygon. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const sourceFormat = 'ink-studio/tileset-face-source';
  const fields = ['object','part','face','selection','origin','right','up','planeAt','snapGrid','texelsPerUnit','brushScale','material','paint','uvInset','worldSize','materialDefinition'];
  const name = value=>TargetSelectors.name(value) && !['__proto__','prototype','constructor'].includes(value);

  const isSourceBinding = binding=>binding.domain === 'faces' && binding.data?.format === sourceFormat && binding.data.version === 1;

  function sourceBindings(row, id, update) {
    const changes = [];
    const bindings = row.bindings?.map(binding=>{
      const before = binding.data;
      const pick = before?.selection;
      if (!isSourceBinding(binding) ||
          pick?.tileset !== id || ![pick.x,pick.y,pick.width,pick.height].every(Number.isSafeInteger)) return binding;
      const after = update(before);
      if (!after || after === before) return binding;
      changes.push({face:binding.element,binding:binding.id,before,after});
      return {...binding,data:after};
    });
    return {bindings,changes};
  }

  function sameMaterial(a, b) {
    const ordered = (_key,value)=>value && Object.getPrototypeOf(value) === Object.prototype ?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value;
    return JSON.stringify(a,ordered) === JSON.stringify(b,ordered);
  }

  // The renderer addresses first and last texel centers at 0 and 1.
  function cropSource(asset, crop, texelBounds = [crop.x,crop.y,crop.x+crop.width,crop.y+crop.height], paint) {
    const centers = (min,max,first,length,count)=>{
      const middle = (min+max-1)/2;
      const a = Math.min(min,middle), b = Math.max(max-1,middle);
      return [a,b].map(n=>Math.max(first,Math.min(first+length-1,n))/Math.max(1,count-1));
    };
    const [left,right] = centers(texelBounds[0],texelBounds[2],crop.x,crop.width,asset.width);
    const [top,bottom] = centers(texelBounds[1],texelBounds[3],crop.y,crop.height,asset.height);
    const uvs = [[left,bottom],[right,bottom],[right,top],[left,top]];
    return {source:{format:sourceFormat,version:1,selection:crop,atlasSize:[asset.width,asset.height],...(paint && {paint})},
      pigmentUV:paint ? TilesetSelection.paintCorners(uvs,paint) : uvs};
  }

  function prepare(scene, request, {projectTexelsPerUnit} = {}, cellSize) {
    const {object,part,face,selection,origin,right,up,planeAt,snapGrid=false,
      texelsPerUnit,brushScale=1,material:requestedMaterial,paint:requestedPaint,uvInset,worldSize,materialDefinition} = request ?? {};
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
    if (worldSize !== undefined && (!Array.isArray(worldSize) || worldSize.length !== 2 ||
        !Array.from(worldSize).every(n=>Number.isFinite(n) && n>0)))
      throw new RangeError('World size needs a positive finite width and height');
    const size = cellSize ?? worldSize?.slice() ?? [crop.width,crop.height].map(pixels=>positiveScale(pixels*brushScale/density,'World tile extent'));
    if (planeAt !== undefined && [origin,right,up].some(value=>value !== undefined))
      throw new TypeError('Choose plane grid coordinates or an explicit tile frame');
    if (typeof snapGrid !== 'boolean' || snapGrid && planeAt === undefined)
      throw new TypeError('Grid snapping needs a construction plane placement');
    const plane = A.constructionPlane;
    const frame = planeAt === undefined ? plane.resolve({origin,right,up}) : plane.forScene(scene);
    const paint = requestedPaint === undefined ? undefined : TilesetSelection.paintOrientation(requestedPaint);
    const texelBounds = uvInset === undefined ? undefined : TilesetSelection.uvMapping(asset,crop,uvInset).texelBounds;
    const {source,pigmentUV} = cropSource(asset,crop,texelBounds,paint);
    const material = requestedMaterial ?? 'tileset/'+crop.tileset;
    if (materialDefinition !== undefined && (!materialDefinition || Object.getPrototypeOf(materialDefinition) !== Object.prototype ||
        materialDefinition.id !== material || materialDefinition.texture?.tileset !== crop.tileset))
      throw new TypeError('A copied material definition must match the material ID and source tileset');
    const existing = Object.hasOwn(scene.topologyMeshes ?? {},object) ? scene.topologyMeshes[object] : undefined;
    const doc = existing && topology.create(existing.document);
    const uvSet = MaterialUV.resolve(doc?.uvBindings,'pigment');
    const activeSets = [...new Set(Object.values(doc?.uvBindings ?? {}).filter(Boolean))];
    const unitUV = [[0,1],[1,1],[1,0],[0,0]];
    const conflicts = [];
    if (existing && part !== undefined && part !== existing.part) conflicts.push({reason:'different-mesh-part'});
    const slot = existing?.materials?.find(row=>row.id === material);
    if (slot ? slot.texture?.tileset !== crop.tileset : doc?.faces.some(row=>row.material === material))
      conflicts.push({reason:'material-in-use',material});
    if (slot && materialDefinition && !sameMaterial(slot,materialDefinition))
      conflicts.push({reason:'different-material-definition',material});
    if (existing?.bakes?.some(row=>row.material === material))
      conflicts.push({reason:'material-has-bake',material});
    return {object,part:existing?.part ?? part,existing,doc,frame,snapGrid,source,material,slot,density,brushScale,size,materialDefinition,
      uvSet,activeSets,unitUV,pigmentUV,conflicts,faceIds:new Set(doc?.faces.map(row=>row.id)),
      bindingIds:new Set(existing?.bindings?.map(row=>row.id)),vertexIds:new Set(doc?.vertices.map(row=>row.id)),
      cornerIds:new Set(doc?.faces.flatMap(row=>row.corners.map(corner=>corner.id)))};
  }

  function cornersFor(brush, face, ids) {
    const {activeSets,uvSet,unitUV,pigmentUV} = brush;
    return ids.map((vertex,i)=>({id:face+'/c'+i,vertex,uv:uvSet ? unitUV[i] : pigmentUV[i],
      ...(activeSets.length && {attributes:Object.fromEntries(activeSets.map(set=>
        [MaterialUV.key(set),set === uvSet ? pigmentUV[i] : unitUV[i]]))})}));
  }

  function stamp(brush, face, anchor, shared) {
    const {frame,source,material,vertexIds,cornerIds} = brush;
    const [x,y] = frame.axes, [w,h] = brush.size;
    const end = shared?.[1].position ?? K.V.mad(anchor,x,w);
    const positions = [anchor,end,K.V.mad(end,y,h),K.V.mad(anchor,y,h)];
    const binding = {id:'tileset/'+face,domain:'faces',element:face,data:source};
    const ring = positions.map((position,i)=>{
      const weights = shared?.[3-i]?.weights;
      return shared?.[i] ?? {id:face+'/v'+i,position,...(weights && {weights})};
    });
    const vertices = shared ? ring.slice(2) : ring;
    const corners = cornersFor(brush,face,ring.map(row=>row.id));
    const polygon = {id:face,material,corners};
    const conflicts = [];
    if (brush.faceIds.has(face)) conflicts.push({reason:'face-id-in-use',face});
    if (brush.bindingIds.has(binding.id)) conflicts.push({reason:'binding-id-in-use',binding:binding.id});
    for (const {id} of vertices) if (vertexIds.has(id)) conflicts.push({reason:'vertex-id-in-use',vertex:id});
    for (const {id} of corners) if (cornerIds.has(id)) conflicts.push({reason:'corner-id-in-use',corner:id});
    return {polygon,binding,vertices,conflicts};
  }

  function append(brush, stamps, brushes = [brush]) {
    const {existing,doc,part,object} = brush;
    const added = {vertices:stamps.flatMap(row=>row.vertices),faces:stamps.map(row=>row.polygon)};
    const row = existing ? A.meshTopologyScene.revise(existing,added).row :
      {document:topology.create({id:object,...added}),...(part && {part})};
    if (doc && !existing.modifiers?.some(modifier=>modifier.enabled !== false)) {
      const before = topology.revision(doc), after = topology.revision(row.document);
      // Appending a polygon preserves the original anchors and vertex deltas.
      if (row.attachments?.revision === before) row.attachments = {...row.attachments,revision:after};
      if (row.shapeKeys?.restRevision === before) row.shapeKeys = {...row.shapeKeys,restRevision:after};
    }
    const materials = [...brushes].filter(item=>!item.slot).map(({material,source,materialDefinition})=>
      materialDefinition ?? {id:material,texture:{tileset:source.selection.tileset}});
    return {...row,bindings:[...(row.bindings ?? []),...stamps.map(stamp=>stamp.binding)],
      materials:materials.length ? [...(row.materials ?? []),...materials] : row.materials};
  }

  function plan(scene, request, options) {
    const brush = prepare(scene,request,options);
    const {face,planeAt} = request;
    const {object,part,source,material,density,brushScale,size,uvSet,frame,snapGrid,materialDefinition} = brush;
    const plane = A.constructionPlane;
    const gridAt = snapGrid ? plane.quantize(frame,planeAt) : planeAt;
    const anchor = planeAt === undefined ? frame.plane.origin : plane.point(frame,gridAt);
    const placement = stamp(brush,face,anchor);
    const {vertices,polygon,binding,conflicts:local} = placement;
    const conflicts = [...brush.conflicts,...local];
    const report = freeze({format:'ink-studio/tileset-face-placement',version:1,object,
      ...(part && {part}),face,source,material,...(materialDefinition && {materialDefinition}),binding:binding.id,
      texelsPerUnit:density,brushScale,size,vertices,corners:polygon.corners,uvSet,
      ...(planeAt !== undefined && {constructionPlane:frame.plane,planeAt:planeAt.slice()}),
      ...(snapGrid && {gridAt}),conflicts,canCommit:!conflicts.length});
    return conflicts.length ? {report} : {report,row:append(brush,[placement])};
  }

  A.tilesetFaces = Object.freeze({plan,prepare,stamp,append,cornersFor,cropSource,sourceBindings,isSourceBinding,sameMaterial});
})(KIT);
