/* Place a selected atlas rectangle on a retained mesh polygon. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const sourceFormat = 'ink-studio/tileset-face-source';
  const fields = ['object','part','face','selection','origin','right','up','texelsPerUnit','brushScale','material'];
  const name = value=>TargetSelectors.name(value) && !['__proto__','prototype','constructor'].includes(value);
  const xyz = value=>Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

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

  function frame(origin, right, up, width, height) {
    if (![origin,right,up].every(xyz)) throw new TypeError('Tile placement needs finite XYZ vectors');
    const r = Math.hypot(...right), u = Math.hypot(...up);
    if (!r || !u || !Number.isFinite(r) || !Number.isFinite(u)) throw new RangeError('Tile axes need nonzero directions');
    const x = right.map(value=>value/r), y = up.map(value=>value/u);
    if (Math.abs(K.V.dot(x,y)) > 1e-10) throw new RangeError('Tile right and up must be perpendicular');
    const place = (s,t)=>origin.map((value,i)=>value+x[i]*s+y[i]*t);
    return [origin.slice(),place(width,0),place(width,height),place(0,height)];
  }

  function plan(scene, request, {projectTexelsPerUnit} = {}) {
    const {object,part,face,selection,origin=[0,0,0],right=[1,0,0],up=[0,1,0],
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
    const size = [crop.width,crop.height].map(pixels=>positiveScale(pixels*brushScale/density,'World tile extent'));
    const positions = frame(origin,right,up,...size);
    const source = {format:sourceFormat,version:1,selection:crop,atlasSize:[asset.width,asset.height]};
    const material = requestedMaterial ?? 'tileset/'+crop.tileset;
    const binding = {id:'tileset/'+face,domain:'faces',element:face,data:source};
    const existing = Object.hasOwn(scene.topologyMeshes ?? {},object) ? scene.topologyMeshes[object] : undefined;
    const doc = existing && topology.create(existing.document);
    const uvSet = MaterialUV.resolve(doc?.uvBindings,'pigment');
    const activeSets = [...new Set(Object.values(doc?.uvBindings ?? {}).filter(Boolean))];
    const u = x=>x/Math.max(1,asset.width-1), v = y=>y/Math.max(1,asset.height-1);
    const left=u(crop.x), rightUV=u(crop.x+crop.width-1), top=v(crop.y), bottom=v(crop.y+crop.height-1);
    const unitUV = [[0,1],[1,1],[1,0],[0,0]];
    const pigmentUV = [[left,bottom],[rightUV,bottom],[rightUV,top],[left,top]];
    const vertices = positions.map((position,i)=>({id:face+'/v'+i,position}));
    const corners = vertices.map(({id},i)=>({id:face+'/c'+i,vertex:id,uv:uvSet ? unitUV[i] : pigmentUV[i],
      ...(activeSets.length && {attributes:Object.fromEntries(activeSets.map(set=>
        [MaterialUV.key(set),set === uvSet ? pigmentUV[i] : unitUV[i]]))})}));
    const polygon = {id:face,material,corners};
    const conflicts = [];
    if (existing && part !== undefined && part !== existing.part) conflicts.push({reason:'different-mesh-part'});
    if (doc?.faces.some(row=>row.id === face)) conflicts.push({reason:'face-id-in-use',face});
    if (existing?.bindings?.some(row=>row.id === binding.id)) conflicts.push({reason:'binding-id-in-use',binding:binding.id});
    const vertexIds = new Set(doc?.vertices.map(row=>row.id)), cornerIds = new Set(doc?.faces.flatMap(row=>row.corners.map(corner=>corner.id)));
    for (const {id} of vertices) if (vertexIds.has(id)) conflicts.push({reason:'vertex-id-in-use',vertex:id});
    for (const {id} of corners) if (cornerIds.has(id)) conflicts.push({reason:'corner-id-in-use',corner:id});
    const slot = existing?.materials?.find(row=>row.id === material);
    if (slot ? slot.texture?.tileset !== crop.tileset : doc?.faces.some(row=>row.material === material))
      conflicts.push({reason:'material-in-use',material});
    if (existing?.bakes?.some(row=>row.material === material))
      conflicts.push({reason:'material-has-bake',material});
    const report = freeze({format:'ink-studio/tileset-face-placement',version:1,object,
      ...((existing?.part ?? part) && {part:existing?.part ?? part}),face,source,material,binding:binding.id,
      texelsPerUnit:density,brushScale,size,vertices,corners,uvSet,conflicts,canCommit:!conflicts.length});
    if (conflicts.length) return {report};
    const added = {vertices,faces:[polygon]};
    const row = existing ? A.meshTopologyScene.revise(existing,added).row :
      {document:topology.create({id:object,...added}),...(part && {part})};
    if (doc && !existing.modifiers?.some(modifier=>modifier.enabled !== false)) {
      const before = topology.revision(doc), after = topology.revision(row.document);
      // The new disconnected polygon leaves all original anchors and morph deltas valid.
      if (row.attachments?.revision === before) row.attachments = {...row.attachments,revision:after};
      if (row.shapeKeys?.restRevision === before) row.shapeKeys = {...row.shapeKeys,restRevision:after};
    }
    return {report,row:{...row,bindings:[...(row.bindings ?? []),binding],
      materials:slot ? row.materials : [...(row.materials ?? []),{id:material,texture:{tileset:crop.tileset}}]}};
  }

  A.tilesetFaces = Object.freeze({plan,sourceBindings});
})(KIT);
