/* Change the atlas or pigment UVs on a retained face. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const fields = ['object','part','face','mode','selection','tileset','cell'];
  const name = value=>typeof value === 'string' && Boolean(value.trim());
  const uvMatch = (a,b)=>a.every((n,i)=>Math.abs(n-b[i])<1e-12);
  const texelsOf = (uvs,asset)=>uvs.map(([u,v])=>[u*(asset.width-1),v*(asset.height-1)]);

  function pick(atlases, {selection:picked,tileset,cell}, mode) {
    const eyedrop = picked?.format === 'ink-studio/tileset-face-pick';
    if (eyedrop && (picked.version !== 1 || !picked.canStamp || !picked.stamp))
      throw new TypeError('Provide a reusable version 1 face pick');
    const saved = eyedrop ? picked.stamp.selection : picked;
    const block = saved?.format === 'ink-studio/tileset-brush';
    if (saved && (!block && saved.format !== 'ink-studio/tileset-selection' || saved.version !== 1) || cell !== undefined && !block)
      throw new TypeError('Choose an exact selection, saved brush, or eyedropped face');
    const atlas = tileset ?? saved?.tileset, asset = atlases.source(atlas);
    const brush = block ? TilesetSelection.readBrush(asset,saved) : null;
    if (mode === 'tileset') return {atlas,asset};
    if (!saved) throw new TypeError('Crop and relative reskins need a saved pick');
    if (brush && cell === undefined && TilesetSelection.hasGaps(brush))
      throw new RangeError('Choose a column and row for a brush with atlas gutters');
    const rect = cell === undefined ? saved : TilesetSelection.cell(brush,cell);
    const selection = TilesetSelection.pick(atlas,asset,rect);
    const rawPaint = eyedrop ? picked.stamp.paint : saved.paint;
    const paint = TilesetSelection.paintOrientation(rawPaint === undefined ? {} : rawPaint);
    const uvInset = eyedrop ? picked.stamp.uvInset : saved.uvInset;
    const bounds = uvInset === undefined ? undefined : TilesetSelection.uvMapping(asset,selection,uvInset).texelBounds;
    return {atlas,asset,selection,paint,bounds};
  }

  function materialFor(row, base, atlas, isolate) {
    if (!isolate && base.texture?.tileset === atlas) return {definition:base};
    const alts = new Map((row.materials ?? []).map(item=>[item.id,item]));
    const occupied = new Set([...alts.keys(),...row.document.faces.map(item=>item.material),...(row.bakes ?? []).map(item=>item.material)]);
    const prefix = base.id+'/tileset/'+atlas;
    let id = prefix;
    for (let n=2;occupied.has(id);n++) {
      const definition = {...base,id,texture:{tileset:atlas}};
      const existing = alts.get(id);
      if (existing && !row.bakes?.some(item=>item.material === id) && A.tilesetFaces.sameMaterial(existing,definition))
        return {definition:existing};
      id = prefix+'/'+n;
    }
    return {add:true,definition:{...base,id,texture:{tileset:atlas}}};
  }

  function compose(brush, current) {
    const direction = current.flipX === current.flipY ? 1 : -1;
    return {
      rotation:(current.rotation+direction*brush.rotation+360)%360,
      flipX:current.flipX !== brush.flipX,
      flipY:current.flipY !== brush.flipY
    };
  }

  function sourceForTileOnly(oldAtlas, {asset,atlas}, uvs, prior) {
    if (uvs.length !== 4) return {};
    const sameSize = prior && prior.data.selection?.tileset === oldAtlas &&
      prior.data.atlasSize?.[0] === asset.width && prior.data.atlasSize?.[1] === asset.height;
    const hint = sameSize ? {...prior,data:{...prior.data,selection:{...prior.data.selection,tileset:atlas}}} : undefined;
    const mapping = A.tilesetEyedrop.recover(asset,atlas,texelsOf(uvs,asset),hint);
    return mapping.paint ? {source:A.tilesetFaces.cropSource(asset,mapping.selection,undefined,mapping.paint).source,
      sourceStatus:mapping.sourceStatus} : {};
  }

  function rebind(row, face, prior, source) {
    const api = A.tilesetFaces;
    const related = binding=>binding.element === face && api.isSourceBinding(binding);
    const all = row.bindings ?? [];
    const unrelated = all.filter(binding=>!related(binding));
    if (!source) return unrelated;
    const used = new Set(unrelated.map(binding=>binding.id));
    const base = prior?.id ?? 'tileset/'+face;
    let id = base;
    for (let n=2;used.has(id);n++) id = base+'/'+n;
    const old = prior?.data;
    const binding = {id,domain:'faces',element:face,data:{...source,...(old?.placement && {placement:old.placement})}};
    let inserted = false;
    const result = all.flatMap(entry=>{
      if (!related(entry)) return [entry];
      if (inserted || prior && entry.id !== prior.id) return [];
      inserted = true;
      return [binding];
    });
    if (!inserted) result.push(binding);
    return result;
  }

  function plan(scene, request) {
    const {object,part,face,mode='crop',selection,tileset,cell} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.keys(request).some(key=>!fields.includes(key)) ||
        ![object,face].every(name) || part !== undefined && !name(part) || !['crop','tileset','relative'].includes(mode) ||
        (mode === 'tileset' && tileset !== undefined ? !name(tileset) || selection !== undefined || cell !== undefined : !selection || tileset !== undefined) ||
        cell !== undefined && (!cell || Object.getPrototypeOf(cell) !== Object.prototype ||
          Object.keys(cell).length !== 2 || ![cell.column,cell.row].every(Number.isSafeInteger)))
      throw new TypeError('Reskin needs a face, a crop, tileset, or relative mode, and a matching brush or tileset');
    const rows = scene.topologyMeshes ?? {}, old = Object.hasOwn(rows,object) && rows[object];
    if (!old || part !== undefined && old.part !== part) throw new RangeError('No editable topology for scene object '+object);
    const doc = topology.create(old.document), target = doc.faces.find(item=>item.id === face);
    if (!target) throw new RangeError('Unknown mesh face '+face+' on '+object);
    const atlases = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults), brush = pick(atlases,request,mode);
    const uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
    const before = target.corners.map(corner=>MaterialUV.uv(corner,uvSet));
    const oldMaterial = old.materials?.find(item=>item.id === target.material) ?? {id:target.material};
    const oldAtlas = oldMaterial.texture?.tileset;
    const prior = A.tilesetEyedrop.sourceBinding(old,face);
    const revision = topology.revision(doc);
    const info = {format:'ink-studio/tileset-face-reskin',version:1,id:face,object,face,mode,...(old.part && {part:old.part}),
      uvSet,tileset:brush.atlas,before:{material:target.material,tileset:oldAtlas ?? null,source:prior?.data ?? null},beforeRevision:revision};
    const blocked = reason=>({report:freeze({...info,conflicts:[{reason}],canCommit:false})});
    if (mode !== 'tileset' && target.corners.length !== 4) return blocked('crop-needs-a-quad');

    let after = before, source, sourceStatus;
    if (mode === 'tileset') {
      ({source,sourceStatus} = sourceForTileOnly(oldAtlas,brush,before,prior));
    } else {
      let paint = brush.paint;
      if (mode === 'relative') {
        const eye = A.tilesetEyedrop;
        const asset = oldAtlas && atlases.source(oldAtlas);
        const orientation = asset ? eye.recover(asset,oldAtlas,texelsOf(before,asset),prior) : eye.orientationOf(before);
        if (!orientation.paint || orientation.orientationStatus === 'ambiguous')
          return blocked(orientation.paint ? 'ambiguous-current-orientation' : 'unsupported-current-orientation');
        paint = compose(paint,orientation.paint);
      }
      const result = A.tilesetFaces.cropSource(brush.asset,brush.selection,brush.bounds,paint);
      source = result.source;
      after = result.pigmentUV;
      sourceStatus = 'brush';
    }

    const sharedMaterial = doc.faces.some(item=>item.id !== face && item.material === target.material);
    const activeBake = old.bakes?.find(item=>item.material === target.material && !item.invalidated);
    const material = materialFor(old,oldMaterial,brush.atlas,sharedMaterial && activeBake);

    const corners = target.corners.map((corner,i)=>({corner:corner.id,before:before[i],
      after:uvMatch(before[i],after[i]) ? before[i] : after[i]}));
    const changed = corners.filter(item=>item.before !== item.after);
    const conflicts = target.corners.flatMap((corner,i)=>MaterialUV.pinned(corner,uvSet) && corners[i].before !== corners[i].after ?
      [{reason:'pinned-uv',corner:corner.id}] : []);
    const report = {...info,corners,after:{material:material.definition.id,tileset:brush.atlas,source:source ?? null,
      sourceStatus:sourceStatus ?? 'no-rectangular-source'},...(activeBake && {previousBake:activeBake.id}),conflicts,canCommit:!conflicts.length};
    if (conflicts.length) return {report:freeze(report)};

    const edited = changed.length || material.definition.id !== target.material;
    const polygon = {...target,material:material.definition.id,corners:target.corners.map((corner,i)=>
      corners[i].before === corners[i].after ? corner : uvSet ?
        {...corner,attributes:{...corner.attributes,[MaterialUV.key(uvSet)]:corners[i].after}} : {...corner,uv:corners[i].after})};
    const row = edited ? A.meshTopologyScene.revise(old,{faces:[polygon]}).row : {...old};
    const bindings = rebind(row,face,prior,source);
    if (bindings.length || old.bindings) row.bindings = bindings;
    if (material.add) row.materials = [...(row.materials ?? []),material.definition];
    // When a face leaves a shared slot its old bake still describes every remaining user.
    if (material.definition.id !== target.material && sharedMaterial && activeBake)
      row.bakes = row.bakes.map(item=>item.id === activeBake.id ? activeBake : item);

    const afterRevision = topology.revision(row.document);
    if (edited && !row.modifiers?.some(modifier=>modifier.enabled !== false)) {
      if (row.attachments?.revision === revision) row.attachments = {...row.attachments,revision:afterRevision};
      if (row.shapeKeys?.restRevision === revision) row.shapeKeys = {...row.shapeKeys,restRevision:afterRevision};
    }
    const changes = A.meshTopologyScene.diff(old,row);
    return {row,report:freeze({...report,afterRevision,changes,...(material.add && {addedMaterial:material.definition})})};
  }

  A.tilesetReskin = Object.freeze({plan});
})(KIT);
