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

  function sourceForTileOnly(oldAtlas, {asset,atlas}, uvs, prior, slots) {
    if (!slots) return {};
    const sameSize = prior && prior.data.selection?.tileset === oldAtlas &&
      prior.data.atlasSize?.[0] === asset.width && prior.data.atlasSize?.[1] === asset.height;
    const hint = sameSize ? {...prior,data:{...prior.data,selection:{...prior.data.selection,tileset:atlas}}} : undefined;
    const mapping = A.tilesetEyedrop.recover(asset,atlas,texelsOf(uvs,asset),hint,slots);
    return mapping.paint ? {source:A.tilesetFaces.cropSource(asset,mapping.selection,undefined,mapping.paint).source,
      sourceStatus:mapping.sourceStatus} : {};
  }

  function rebindSources(row, updates) {
    const api = A.tilesetFaces;
    const all = row.bindings ?? [];
    const related = binding=>updates.has(binding.element) && api.isSourceBinding(binding);
    const used = new Set(all.filter(binding=>!related(binding)).map(binding=>binding.id));
    const reserved = new Set([...updates.values()].map(({prior})=>prior?.id)), replacements = new Map();
    for (const [face,{prior,source}] of updates) if (source) {
      const base = prior?.id ?? 'tileset/'+face;
      let id = base;
      for (let n=2;used.has(id) || reserved.has(id) && id!==prior?.id;n++) id = base+'/'+n;
      used.add(id);
      const placement = prior?.data.placement;
      replacements.set(face,{id,domain:'faces',element:face,data:{...source,...(placement && {placement})}});
    }
    const result = all.flatMap(entry=>{
      if (!related(entry)) return [entry];
      const {prior} = updates.get(entry.element), binding = replacements.get(entry.element);
      if (!binding || prior && entry.id!==prior.id) return [];
      replacements.delete(entry.element);
      return [binding];
    });
    return result.concat([...replacements.values()]);
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
    const slots = A.tilesetFaces.sourceCorners(prior,target.corners.length);
    const revision = topology.revision(doc);
    const info = {format:'ink-studio/tileset-face-reskin',version:1,id:face,object,face,mode,...(old.part && {part:old.part}),
      uvSet,tileset:brush.atlas,before:{material:target.material,tileset:oldAtlas ?? null,source:prior?.data ?? null},beforeRevision:revision};
    const blocked = reason=>({report:freeze({...info,conflicts:[{reason}],canCommit:false})});
    if (mode !== 'tileset' && !slots) return blocked('crop-needs-a-quad');

    let after = before, source, sourceStatus;
    if (mode === 'tileset') {
      ({source,sourceStatus} = sourceForTileOnly(oldAtlas,brush,before,prior,slots));
    } else {
      let paint = brush.paint;
      if (mode === 'relative') {
        const eye = A.tilesetEyedrop;
        const asset = oldAtlas && atlases.source(oldAtlas);
        const orientation = asset ? eye.recover(asset,oldAtlas,texelsOf(before,asset),prior,slots) : eye.orientationOf(before,undefined,slots);
        if (!orientation.paint || orientation.orientationStatus === 'ambiguous')
          return blocked(orientation.paint ? 'ambiguous-current-orientation' : 'unsupported-current-orientation');
        paint = compose(paint,orientation.paint);
      }
      const result = A.tilesetFaces.cropSource(brush.asset,brush.selection,brush.bounds,paint);
      source = result.source;
      after = slots.map(slot=>result.pigmentUV[slot]);
      sourceStatus = 'brush';
    }
    if (source && slots.length === 3) source = {...source,uvCorners:slots};

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
    const bindings = rebindSources(row,new Map([[face,{prior,source}]]));
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

  function assignmentFaces(doc, {object,part,ids,selection}, uvSet) {
    if (selection?.format==='ink-studio/tileset-component-selection') {
      if (selection.version!==1 || selection.domain!=='tiles' || selection.object!==object || selection.part!==part)
        throw new RangeError('Use a saved tile selection from this scene mesh');
      selection = selection.selection;
      if (!selection) throw new TypeError('A saved tile selection needs its topology selection');
    }
    const saved = selection?.format==='ink-studio/uv-selection';
    if (saved && !['faces','islands'].includes(selection.domain))
      throw new TypeError('Use a saved face or island UV selection for tileset assignment');
    const chosen = saved ? topology.uv.select(doc,{domain:selection.domain,from:selection,uvSet}).faces :
      topology.select(doc,selection===undefined ? {domain:'faces',ids} : {domain:'faces',from:selection},{object,part}).ids;
    if (!chosen.length) throw new RangeError('Choose at least one face to assign');
    return new Set(chosen);
  }

  function projectAssignment(group, positions) {
    const {V} = K, [{face,triangles}] = group;
    const [a,b] = face.corners.map(corner=>positions.get(corner.vertex));
    const [p,q,r] = triangles[0].positions;
    const horizontal = V.norm(V.sub(b,a)), normal = V.norm(V.cross(V.sub(q,p),V.sub(r,p)));
    const down = V.cross(horizontal,normal), points = new Map();
    for (const {face} of group) for (const corner of face.corners) {
      const offset = V.sub(positions.get(corner.vertex),a);
      points.set(corner.id,[V.dot(offset,horizontal),V.dot(offset,down)]);
    }
    return points;
  }

  function fitAssignment(group, positions, original, destination) {
    const useUV = group.every(({triangles})=>triangles.every(({uv})=>uv.every(Boolean) && Math.abs(MeshUV.area2(...uv))>1e-12));
    const points = useUV ? original : projectAssignment(group,positions);
    const [l,t,r,b] = meshUVRegions.bounds(group.flatMap(({face})=>face.corners.map(corner=>points.get(corner.id))));
    if (!(l<r && t<b)) return;
    const [bottomLeft,,topRight,topLeft] = destination;
    const mapped = new Map();
    const lerp = (a,b,t)=>t===0 ? a : t===1 ? b : a+(b-a)*t;
    for (const {face} of group) for (const {id} of face.corners) {
      const [u,v] = points.get(id);
      const s = (u-l)/(r-l), h = (v-t)/(b-t);
      mapped.set(id,topLeft.map((start,i)=>topRight[i]!==start ? lerp(start,topRight[i],s) : lerp(start,bottomLeft[i],h)));
    }
    return {mapped,basis:useUV ? 'authored-uv' : 'surface-projection'};
  }

  function preserveAssignment(face, triangles, original, originalImage, destination, clamp, conflicts) {
    const {id} = face;
    if (!originalImage || face.corners.some(corner=>!original.get(corner.id))) {
      conflicts.push({reason:originalImage ? 'missing-source-uv' : 'missing-source-atlas',face:id,material:face.material});
      return;
    }
    const mapped = new Map(), texels = new Map();
    const spans = destination.map(n=>n-1);
    for (const {id:corner} of face.corners) {
      const before = MaterialUV.texel(original.get(corner),...originalImage.size);
      const after = before.map((n,i)=>Math.max(0,Math.min(n,spans[i])));
      const clampedAxes = ['u','v'].filter((axis,i)=>Math.abs(before[i]-after[i])>1e-9);
      texels.set(corner,{before,after,clampedAxes});
      mapped.set(corner,after.map((n,i)=>n/Math.max(1,spans[i])));
      if (clampedAxes.length && !clamp) conflicts.push({reason:'texel-outside-tileset',face:id,corner,
        texel:before,clampedTexel:after,axes:clampedAxes});
    }
    for (const triangle of triangles) {
      const values = triangle.corners.map(id=>texels.get(id));
      if (!values.some(row=>row.clampedAxes.length)) continue;
      const before = MeshUV.area2(...values.map(row=>row.before)), after = MeshUV.area2(...values.map(row=>row.after));
      if (Math.abs(before)<=1e-12) continue;
      const reason = Math.abs(after)<=1e-12 ? 'clamp-collapsed-uv' : before*after<0 ? 'clamp-flipped-uv' : undefined;
      if (reason) conflicts.push({reason,face:id,corners:triangle.corners});
    }
    return {mapped,basis:'source-texels',texels};
  }

  function preservedSource(asset, atlas, texels, prior, slots, beforeImage) {
    const data = prior?.data;
    const matches = beforeImage.tileset && data?.selection?.tileset===beforeImage.tileset &&
      beforeImage.size.every((n,i)=>n===data.atlasSize?.[i]);
    const hint = matches ? {...prior,data:{...data,atlasSize:[asset.width,asset.height],
      selection:{...data.selection,tileset:atlas}}} : undefined;
    const recovered = A.tilesetEyedrop.recover(asset,atlas,texels,hint,slots);
    return A.tilesetFaces.cropSource(asset,recovered.selection,undefined,recovered.paint).source;
  }

  function planAssignment(scene, request) {
    const {object,part,mode='tile',mapping='group',ids,selection,tile,tileset,cell,revision,clamp} = request ?? {};
    const preserve = mapping==='preserve-texels';
    if (!request || Object.getPrototypeOf(request)!==Object.prototype ||
        Object.keys(request).some(key=>!['object','part','mode','mapping','ids','selection','tile','tileset','cell','revision','clamp'].includes(key)) ||
        !name(object) || part!==undefined && !name(part) || !['tile','sheet'].includes(mode) ||
        !['group','per-face','preserve-texels'].includes(mapping) || preserve && mode!=='sheet' ||
        clamp!==undefined && (!preserve || typeof clamp!=='boolean') || (ids===undefined)===(selection===undefined) ||
        ids!==undefined && !Array.isArray(ids) || selection!==undefined && (!selection || Object.getPrototypeOf(selection)!==Object.prototype) ||
        (mode==='tile' ? !tile || tileset!==undefined : !name(tileset) || tile!==undefined || cell!==undefined) ||
        cell!==undefined && (!cell || Object.getPrototypeOf(cell)!==Object.prototype ||
          Object.keys(cell).length!==2 || ![cell.column,cell.row].every(Number.isSafeInteger)))
      throw new TypeError('Assign selected faces to a saved tile or sheet, with clamping available for preserve-texels sheet mapping');
    const rows = scene.topologyMeshes ?? {}, old = Object.hasOwn(rows,object) && rows[object];
    if (!old || part!==undefined && old.part!==part) throw new RangeError('No editable topology for scene object '+object);
    const doc = topology.create(old.document), beforeRevision = topology.revision(doc);
    if (revision!==undefined && revision!==beforeRevision) throw new RangeError('Tileset assignment was authored against a different topology revision');
    const uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
    const chosen = assignmentFaces(doc,{object,part:old.part,ids,selection},uvSet);
    const atlases = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const brush = mode==='tile' ? pick(atlases,{selection:tile,cell},'crop') : pick(atlases,{tileset},'tileset');
    const {asset,atlas} = brush, crop = brush.selection ?? TilesetSelection.pick(atlas,asset,{x:0,y:0,width:asset.width,height:asset.height});
    const {source,pigmentUV} = A.tilesetFaces.cropSource(asset,crop,brush.bounds,brush.paint);
    const faceData = new Map(doc.faces.filter(face=>chosen.has(face.id)).map(face=>[face.id,{face,triangles:[]}]));
    const positions = new Map(doc.vertices.map(({id,position})=>[id,position]));
    const selectedCorners = new Map([...faceData.values()].flatMap(({face})=>face.corners.map(corner=>[corner.id,corner])));
    const original = new Map([...selectedCorners].map(([id,corner])=>[id,MaterialUV.uv(corner,uvSet)]));
    for (const {face,corners} of topology.triangulate(doc).triangleSources) if (faceData.has(face))
      faceData.get(face).triangles.push({corners,positions:corners.map(id=>positions.get(selectedCorners.get(id).vertex)),
        uv:corners.map(id=>original.get(id))});
    const selected = [...faceData.values()], groups = mapping==='group' ? [selected] : selected.map(row=>[row]);
    const definitions = new Map((old.materials ?? []).map(material=>[material.id,material]));
    const activeBakes = new Map((old.bakes ?? []).filter(bake=>!bake.invalidated).map(bake=>[bake.material,bake]));
    const unselectedSlots = new Set(doc.faces.filter(face=>!chosen.has(face.id)).map(face=>face.material));
    const oldAtlases = A.meshTopologyScene.uvAtlases(scene,old,'pigment'), destination = [asset.width,asset.height];
    const added = [], materials = new Map(), replacements = [], faces = [], conflicts = [], footprints = [], bindings = new Map();
    const targetBounds = meshUVRegions.bounds(pigmentUV), spans = destination.map(n=>n-1);
    const constantAxis = targetBounds[0]===targetBounds[2] || targetBounds[1]===targetBounds[3];
    for (const group of groups) {
      const fitted = !preserve && fitAssignment(group,positions,original,pigmentUV);
      if (!preserve && !fitted) {
        conflicts.push({reason:'degenerate-assignment-bounds',faces:group.map(row=>row.face.id)});
        continue;
      }
      for (const {face,triangles} of group) {
        const {id,material} = face, bake = activeBakes.get(material), beforeImage = oldAtlases?.(material);
        const fit = preserve ? preserveAssignment(face,triangles,original,beforeImage,destination,clamp,conflicts) : fitted;
        if (!fit) continue;
        if (!materials.has(material)) {
          const base = definitions.get(material) ?? {id:material};
          const next = materialFor({...old,materials:[...(old.materials ?? []),...added]},base,atlas,Boolean(bake));
          if (next.add) added.push(next.definition);
          materials.set(material,next.definition);
        }
        const definition = materials.get(material);
        const paint = face.corners.map(corner=>{
          const before = original.get(corner.id) ?? null, proposed = fit.mapped.get(corner.id);
          const after = before && uvMatch(before,proposed) ? before : proposed;
          fit.mapped.set(corner.id,after);
          return {id:corner.id,before,after,...(preserve && {texels:fit.texels.get(corner.id)})};
        });
        const proposed = corners=>corners.map(id=>fit.mapped.get(id));
        for (const [i,corner] of face.corners.entries()) if (MaterialUV.pinned(corner,uvSet) && paint[i].before!==paint[i].after)
          conflicts.push({reason:'pinned-uv',face:id,corner:corner.id});
        if (!preserve && !constantAxis && triangles.some(row=>Math.abs(MeshUV.area2(...proposed(row.corners)))<=1e-12))
          conflicts.push({reason:'degenerate-assignment-uv',face:id,basis:fit.basis});
        footprints.push(triangles.map(row=>proposed(row.corners).map(uv=>MaterialUV.texel(uv,...destination))));
        const prior = A.tilesetEyedrop.sourceBinding(old,id), slots = A.tilesetFaces.sourceCorners(prior,face.corners.length);
        const texels = paint.map(row=>MaterialUV.texel(row.after,...destination));
        const bindingSource = preserve ? preservedSource(asset,atlas,texels,prior,slots,beforeImage) : {...source};
        if (!preserve) {
          const inferred = slots && A.tilesetEyedrop.orientationOf(texels,undefined,slots).paint;
          if (inferred) bindingSource.paint = inferred;
          else delete bindingSource.paint;
        }
        if (slots?.length===3) bindingSource.uvCorners = slots;
        bindings.set(id,{prior,source:bindingSource});
        faces.push({face:id,basis:fit.basis,corners:paint,
          before:{material,tileset:beforeImage?.tileset ?? null,atlasSize:beforeImage?.size ?? null,
            ...(preserve && {texelBounds:meshUVRegions.bounds(paint.map(row=>row.texels.before))}),
            metrics:beforeImage && triangles.every(row=>row.uv.every(Boolean)) ?
              meshUVRegions.stats(triangles,beforeImage.size.map(n=>n-1)) : null},
          after:{material:definition.id,tileset:atlas,bounds:meshUVRegions.bounds(texels),
            ...(preserve && {atlasSize:destination,source:bindingSource,
              clampedCorners:paint.filter(row=>row.texels.clampedAxes.length).map(row=>row.id)}),
            metrics:meshUVRegions.stats(triangles,spans,row=>proposed(row.corners))}});
        if (definition.id!==material || paint.some(({before,after})=>before!==after)) replacements.push({
          ...face,material:definition.id,corners:face.corners.map((corner,i)=>{
            const {before,after} = paint[i];
            return before===after ? corner : uvSet ?
              {...corner,attributes:{...corner.attributes,[MaterialUV.key(uvSet)]:after}} : {...corner,uv:after};
          })
        });
      }
    }
    const {perFace,...coverage} = MeshUV.sampleCoverage(footprints,crop,atlases.resolve({tileset:atlas}));
    faces.forEach((row,i)=>{ row.after.coverage = perFace[i]; });
    const report = {format:'ink-studio/tileset-uv-assignment',version:1,object,...(old.part && {part:old.part}),
      id:atlas,mode,mapping,uvSet,beforeRevision,target:{...source,uvBounds:targetBounds},ids:[...chosen],
      ...(preserve && {clamp:clamp ?? false}),faces,coverage,conflicts,canCommit:!conflicts.length};
    if (conflicts.length) return {report:freeze(report)};
    const row = replacements.length ? A.meshTopologyScene.revise(old,{faces:replacements}).row : {...old};
    row.bindings = rebindSources(row,bindings);
    if (added.length) row.materials = [...(row.materials ?? []),...added];
    if (row.bakes) row.bakes = row.bakes.map(bake=>unselectedSlots.has(bake.material) ?
      activeBakes.get(bake.material) ?? bake : bake);
    const afterRevision = topology.revision(row.document);
    if (!row.modifiers?.some(modifier=>modifier.enabled!==false)) {
      if (row.attachments?.revision===beforeRevision) row.attachments = {...row.attachments,revision:afterRevision};
      if (row.shapeKeys?.restRevision===beforeRevision) row.shapeKeys = {...row.shapeKeys,restRevision:afterRevision};
    }
    return {row,report:freeze({...report,afterRevision,addedMaterials:added,changes:A.meshTopologyScene.diff(old,row)})};
  }

  A.tilesetReskin = Object.freeze({plan,planAssignment});
})(KIT);
