/* Place a selected atlas rectangle on a retained mesh polygon. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const sourceFormat = 'ink-studio/tileset-face-source';
  const fields = ['object','part','face','selection','origin','right','up','planeAt','snapGrid','texelsPerUnit','brushScale','material','paint','uvInset','worldSize','materialDefinition'];
  const name = value=>TargetSelectors.name(value) && !['__proto__','prototype','constructor'].includes(value);

  const isSourceBinding = binding=>binding.domain === 'faces' && binding.data?.format === sourceFormat && binding.data.version === 1;
  const quadCorners = [0,1,2,3];

  function sourceCorners(binding, count) {
    if (count === 4) return quadCorners.slice();
    const slots = binding?.data?.uvCorners;
    if (count === 3 && binding && !binding.review && isSourceBinding(binding) && Array.isArray(slots) &&
        slots.length === count && new Set(slots).size === count && Array.from(slots).every(slot=>quadCorners.includes(slot)))
      return slots.slice();
  }

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

  function splitSources(original, remapped, before, after) {
    if (!remapped.some(binding=>binding.review?.reason === 'split' && isSourceBinding(binding)) ||
        !after.faces.some(face=>face.sourceQuad)) return remapped;
    const old = new Map(before.faces.map(face=>[face.id,face])), next = new Map(after.faces.map(face=>[face.id,face]));
    const used = new Set(remapped.map(binding=>binding.id));
    const uvSet = MaterialUV.resolve(before.uvBindings,'pigment');
    if (uvSet !== MaterialUV.resolve(after.uvBindings,'pigment')) return remapped;
    return remapped.flatMap((binding,i)=>{
      const prior = original[i], parent = old.get(prior.element), candidates = binding.review?.candidates;
      if (prior.review || !isSourceBinding(prior) || binding.review?.reason !== 'split' ||
          parent?.corners.length !== 4 || candidates.length !== 2 || !candidates.includes(parent.id)) return [binding];
      const sourceSlots = new Map(parent.corners.map((corner,slot)=>[corner.vertex,{corner,slot}]));
      const children = candidates.map(id=>{
        const face = next.get(id), source = face?.sourceQuad;
        if (source?.mesh !== before.id || source.face !== parent.id || face.corners.length !== 3 ||
            face.material !== parent.material) return null;
        const slots = face.corners.map(corner=>{
          const parent = sourceSlots.get(corner.vertex), uv = MaterialUV.uv(corner,uvSet);
          return parent && source.corners.includes(parent.corner.id) &&
            uv.every((n,i)=>n===MaterialUV.uv(parent.corner,uvSet)[i]) ? parent.slot : undefined;
        });
        return slots.every(slot=>slot !== undefined) ? {id,slots} : null;
      });
      if (children.some(child=>!child)) return [binding];
      return children.map(({id:element,slots})=>{
        const base = 'tileset/'+element;
        let id = element === parent.id ? prior.id : base;
        if (element !== parent.id) {
          for (let n=2;used.has(id);n++) id = base+'/'+n;
          used.add(id);
        }
        return {...prior,id,element,data:{...prior.data,uvCorners:slots}};
      });
    });
  }

  function sameMaterial(a, b) {
    const ordered = (_key,value)=>value && Object.getPrototypeOf(value) === Object.prototype ?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value;
    return JSON.stringify(a,ordered) === JSON.stringify(b,ordered);
  }

  function matchingJoinSource(sources, faces, quad, uvSet) {
    if (sources.length !== 2 || new Set(sources.map(binding=>binding.element)).size !== 2 ||
        sources.some(binding=>binding.review || binding.data.review)) return;
    const [first,second] = sources.map(({data:{uvCorners,...data}})=>data);
    if (!sameMaterial(first,second)) return;

    const byVertex = new Map(quad.corners.map(corner=>[corner.vertex,corner]));
    const slots = new Map();
    for (const binding of sources) {
      const face = faces.get(binding.element), order = sourceCorners(binding,face.corners.length);
      if (!order || face.material !== quad.material) return;
      for (const [i,corner] of face.corners.entries()) {
        const target = byVertex.get(corner.vertex);
        if (!target || !sameMaterial(MaterialUV.uv(corner,uvSet),MaterialUV.uv(target,uvSet)) ||
            slots.has(corner.vertex) && slots.get(corner.vertex) !== order[i]) return;
        slots.set(corner.vertex,order[i]);
      }
    }
    const order = quad.corners.map(corner=>slots.get(corner.vertex));
    if (order.every((slot,i)=>slot === i)) return first;

    // A valid quad ring may begin at a different corner from the original crop.
    let paint;
    try { paint = TilesetSelection.paintOrientation(first.paint ?? {}); }
    catch (error) { if (!(error instanceof TypeError || error instanceof RangeError)) throw error; return; }
    const prior = TilesetSelection.paintCorners(quadCorners,paint), wanted = order.map(slot=>prior[slot]);
    for (const rotation of [0,90,180,270]) {
      const next = {...paint,rotation};
      if (TilesetSelection.paintCorners(quadCorners,next).every((slot,i)=>slot === wanted[i]))
        return {...first,paint:next};
    }
  }

  function joinSources(original, remapped, before, after, correspondence) {
    const sources = original.filter(isSourceBinding);
    const merged = correspondence.domains.faces.groups.filter(row=>row.status === 'merged' &&
      row.from.length === 2 && row.to.length === 1);
    if (!sources.length || !merged.length) return remapped;
    const old = new Map(before.faces.map(face=>[face.id,face])), next = new Map(after.faces.map(face=>[face.id,face]));
    const byFace = new Map(), changes = new Map();
    const uvSet = MaterialUV.resolve(before.uvBindings,'pigment');
    if (uvSet !== MaterialUV.resolve(after.uvBindings,'pigment')) return remapped;
    for (const binding of sources) {
      if (!byFace.has(binding.element)) byFace.set(binding.element,[]);
      byFace.get(binding.element).push(binding);
    }
    for (const {from,to:[element]} of merged) {
      const quad = next.get(element), candidates = from.flatMap(id=>byFace.get(id) ?? []);
      if (!candidates.length || quad.corners.length !== 4 || from.some(id=>old.get(id).corners.length !== 3)) continue;
      const source = matchingJoinSource(candidates,old,quad,uvSet);
      if (source) {
        const keeper = candidates.find(binding=>binding.element === element) ?? candidates[0];
        for (const binding of candidates) changes.set(binding.id,binding === keeper ? {...keeper,element,data:source} : null);
      } else for (const binding of candidates) {
        changes.set(binding.id,{...binding,element,review:{reason:'joined-tileset-sources-need-review',candidates:[element]}});
      }
    }
    return remapped.map(binding=>changes.has(binding.id) ? changes.get(binding.id) : binding).filter(Boolean);
  }

  function previewMerges(row, steps) {
    const byFace = new Map(), changed = new Set();
    const uvSet = MaterialUV.resolve(row.document.uvBindings,'pigment');
    const materials = new Map((row.materials ?? []).map(({id,texture})=>[id,texture?.tileset]));
    for (const binding of row.bindings ?? []) if (isSourceBinding(binding)) {
      if (!byFace.has(binding.element)) byFace.set(binding.element,[]);
      byFace.get(binding.element).push(binding);
    }
    const coverage = [];
    for (const step of steps) {
      const {kind,keep,removedFace,discarded} = step;
      if (kind === 'split-quad') {
        for (const {sourceFace,triangles} of step.faces)
          for (const child of triangles) byFace.set(child.face,byFace.get(sourceFace) ?? []);
      }
      if (!['merge-tiles','join-triangles','dissolve'].includes(kind)) continue;
      const sources = [...new Map([...(byFace.get(keep) ?? []),...(byFace.get(removedFace) ?? [])]
        .map(binding=>[binding.id,binding])).values()];
      if (kind === 'join-triangles' && step.uvSets.some(row=>row.set === uvSet && row.discontinuous))
        for (const binding of sources) changed.add(binding.id);
      if (kind === 'merge-tiles') {
        const paintChanges = discarded.some(({kind,set})=>['material','geometry-interpolation'].includes(kind) ||
          (kind === 'shared-uv' || kind === 'uv-interpolation') && set === uvSet);
        const before = step.before.map(({id:face,material})=>({face,material,tileset:materials.get(material) ?? null,
          bindings:byFace.get(face) ?? []}));
        if (paintChanges) for (const binding of sources) changed.add(binding.id);
        coverage.push({step:step.index,face:keep,uvSet,paintChanges,before,bindings:sources.map(({id,review,data})=>({id,
          status:review || data.review || changed.has(id) ? 'needs-review' : 'retained'}))});
      }
      byFace.set(keep,sources);
      byFace.delete(removedFace);
    }
    return {coverage,changed};
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

  function readCollectionChoice(choice) {
    const {collection,entry,seed,key,step,sequenceIndex} = choice ?? {};
    const index = value=>Number.isSafeInteger(value) && value>=0;
    const text = value=>typeof value === 'string' && Boolean(value.trim());
    if (!choice || Object.getPrototypeOf(choice) !== Object.prototype ||
        ![collection,entry].every(text) || !Number.isSafeInteger(seed) ||
        (key === undefined ? !index(step) || !index(sequenceIndex) || sequenceIndex>step :
          !text(key) || step !== undefined || sequenceIndex !== undefined))
      throw new TypeError('A collection pick needs its entry, seed, and key or sequence step');
    return {collection,entry,seed,...(key === undefined ? {step,sequenceIndex} : {key})};
  }

  function paintSource(asset,crop,selection,requestedPaint,uvInset) {
    const choice = selection.collectionChoice === undefined ? undefined : readCollectionChoice(selection.collectionChoice);
    if (choice && (selection.paint === undefined || requestedPaint !== undefined))
      throw new TypeError('Use the recorded paint orientation with a seeded collection pick');
    const rawPaint = requestedPaint === undefined ? selection.paint : requestedPaint;
    const paint = rawPaint === undefined ? undefined : TilesetSelection.paintOrientation(rawPaint);
    const texelBounds = uvInset === undefined ? undefined : TilesetSelection.uvMapping(asset,crop,uvInset).texelBounds;
    const result = cropSource(asset,crop,texelBounds,paint);
    if (choice) result.source.collectionChoice = choice;
    return result;
  }

  function materialConflicts(existing,doc,slot,material,tileset,materialDefinition) {
    const conflicts = [];
    if (slot ? slot.texture?.tileset !== tileset : doc?.faces.some(row=>row.material === material))
      conflicts.push({reason:'material-in-use',material});
    if (slot && materialDefinition && !sameMaterial(slot,materialDefinition))
      conflicts.push({reason:'different-material-definition',material});
    if (existing?.bakes?.some(row=>row.material === material))
      conflicts.push({reason:'material-has-bake',material});
    return conflicts;
  }

  function extrusionBrush(scene,row,brush,requestedMaterial) {
    const selection = brush?.selection;
    if (!brush || Object.getPrototypeOf(brush) !== Object.prototype ||
        Object.keys(brush).some(key=>!['selection','paint','uvInset'].includes(key)) ||
        selection?.format !== 'ink-studio/tileset-selection' || selection.version !== 1 ||
        requestedMaterial !== undefined && !name(requestedMaterial))
      throw new TypeError('Sidewall brush needs a version 1 exact tileset selection and optional paint orientation and UV inset');
    const asset = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(selection.tileset);
    const crop = TilesetSelection.pick(selection.tileset,asset,selection);
    const material = requestedMaterial ?? 'tileset/'+crop.tileset;
    const slot = row.materials?.find(item=>item.id === material);
    return {...paintSource(asset,crop,selection,brush.paint,brush.uvInset),material,slot,
      issues:materialConflicts(row,row.document,slot,material,crop.tileset)
        .map(conflict=>({kind:'extrusion-brush-material-conflict',...conflict,tileset:crop.tileset}))};
  }

  function extrusionUpdates(row,sidewallUVs) {
    if (sidewallUVs?.mode !== 'brush' || !sidewallUVs.faces.length) return {};
    const {source,material,faces,createsMaterial} = sidewallUVs;
    const used = new Set(row.bindings?.map(binding=>binding.id));
    const addBindings = faces.map(({face})=>{
      const base = 'tileset/'+face;
      let id = base;
      for (let n=2;used.has(id);n++) id = base+'/'+n;
      used.add(id);
      return {id,domain:'faces',element:face,data:source};
    });
    const materials = createsMaterial ?
      [...(row.materials ?? []),{id:material,texture:{tileset:source.selection.tileset}}] : undefined;
    return {addBindings,materials};
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
    const {source,pigmentUV} = paintSource(asset,crop,selection,requestedPaint,uvInset);
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
    conflicts.push(...materialConflicts(existing,doc,slot,material,crop.tileset,materialDefinition));
    return {object,part:existing?.part ?? part,existing,doc,frame,snapGrid,source,material,slot,density,brushScale,size,materialDefinition,
      uvSet,activeSets,unitUV,pigmentUV,conflicts,faceIds:new Set(doc?.faces.map(row=>row.id)),
      bindingIds:new Set(existing?.bindings?.map(row=>row.id)),vertexIds:new Set(doc?.vertices.map(row=>row.id)),
      cornerIds:new Set(doc?.faces.flatMap(row=>row.corners.map(corner=>corner.id)))};
  }

  function cornersFor(brush, face, ids, slots = quadCorners) {
    const {activeSets,uvSet,unitUV,pigmentUV} = brush;
    return ids.map((vertex,i)=>{
      const slot = slots[i];
      return {id:face+'/c'+i,vertex,uv:uvSet ? unitUV[slot] : pigmentUV[slot],
        ...(activeSets.length && {attributes:Object.fromEntries(activeSets.map(set=>
          [MaterialUV.key(set),set === uvSet ? pigmentUV[slot] : unitUV[slot]]))})};
    });
  }

  function stamp(brush, face, anchor, shared) {
    const {frame} = brush;
    const [x,y] = frame.axes, [w,h] = brush.size;
    const end = shared?.[1].position ?? K.V.mad(anchor,x,w);
    const positions = [anchor,end,K.V.mad(end,y,h),K.V.mad(anchor,y,h)];
    const ring = positions.map((position,i)=>{
      const weights = shared?.[3-i]?.weights;
      return shared?.[i] ?? {id:face+'/v'+i,position,...(weights && {weights})};
    });
    return polygonStamp(brush,face,ring.map(row=>row.id),shared ? ring.slice(2) : ring);
  }

  function polygonStamp(brush, face, ids, vertices, uvCorners) {
    const {source,material,vertexIds,cornerIds} = brush;
    const data = uvCorners ? {...source,uvCorners} : source;
    const binding = {id:'tileset/'+face,domain:'faces',element:face,data};
    const corners = cornersFor(brush,face,ids,uvCorners);
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

  A.tilesetFaces = Object.freeze({plan,prepare,stamp,polygonStamp,append,cornersFor,cropSource,sourceBindings,sourceCorners,
    splitSources,joinSources,previewMerges,isSourceBinding,sameMaterial,extrusionBrush,extrusionUpdates});
})(KIT);
