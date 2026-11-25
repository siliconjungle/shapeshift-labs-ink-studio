/* Raster edits and UV reference migration for retained tileset images. */
(function (K) {
  const A = K.authoring;
  const {freeze} = K.procedural.data;

  function editRaster(asset, map, tileSize) {
    const {before:[oldWidth,oldHeight],size:[width,height],index} = map;
    const grid = tileSize ? {tileSize} : {};
    if (width === oldWidth && height === oldHeight) {
      const {tileSize:previousGrid,...original} = asset;
      return {...original,...grid};
    }
    const wasIndexed = asset.encoding === 'indexed8', padding = index.includes(-1);
    const palette = asset.palette?.slice(), alpha = asset.alpha?.slice() ?? [];
    let transparent = alpha.indexOf(0);
    if (wasIndexed && padding && transparent === -1 && palette.length < 256) {
      transparent = palette.length;
      palette.push(0);
      while (alpha.length < transparent) alpha.push(255);
      alpha.push(0);
    }
    const indexed = wasIndexed && (!padding || transparent >= 0);
    const bytes = atob(asset.data), pixels = new Uint8Array(index.length*(indexed ? 1 : 4));
    for (let i=0;i<index.length;i++) {
      const source = index[i];
      if (indexed) {
        pixels[i] = source < 0 ? transparent : bytes.charCodeAt(source);
      } else if (source >= 0) {
        const dest = i*4;
        if (wasIndexed) {
          const slot = bytes.charCodeAt(source), color = palette[slot];
          pixels[dest] = color>>16;
          pixels[dest+1] = color>>8;
          pixels[dest+2] = color;
          pixels[dest+3] = alpha[slot] ?? 255;
        } else {
          for (let channel=0;channel<4;channel++) pixels[dest+channel] = bytes.charCodeAt(source*4+channel);
        }
      }
    }
    return {version:1,width,height,...grid,encoding:indexed ? 'indexed8' : 'rgba8',data:A.tilesets.encodeRaster(pixels),
      ...(indexed && {palette,...((asset.alpha !== undefined || alpha.length) && {alpha})})};
  }

  function gridPlan(grid, map, operation) {
    const before = grid.tileSize;
    if (operation.tileSize !== undefined) {
      const after = TilesetSelection.tileSize(operation.tileSize);
      return {before,after,canCommit:TilesetSelection.gridFits({width:map.size[0],height:map.size[1]},after)};
    }
    if (!before) return {before:null,after:null,canCommit:true};
    const {width,height,paddingX=0,paddingY=0,offsetX=0,offsetY=0} = before;
    const [dx,dy] = map.offset;
    const scale = (value,axis)=>value*map.size[axis]/map.before[axis];
    const first = (origin,step,shift)=>origin >= shift ? origin-shift :
      origin+Math.ceil((shift-origin)/step)*step-shift;
    const after = operation.type === 'resize' ?
      {width,height,paddingX,paddingY,offsetX:first(offsetX,width+paddingX,dx),offsetY:first(offsetY,height+paddingY,dy)} :
      {width:scale(width,0),height:scale(height,1),paddingX:scale(paddingX,0),paddingY:scale(paddingY,1),
        offsetX:scale(offsetX,0),offsetY:scale(offsetY,1)};
    const canCommit = Object.values(after).every(n=>Number.isInteger(n) && n>=0 && n<=A.tilesets.maxEdge) &&
      after.width>0 && after.height>0 && TilesetSelection.gridFits({width:map.size[0],height:map.size[1]},after);
    return {before,after:canCommit ? TilesetSelection.tileSize(after) : after,canCommit};
  }

  const rasterChannels = material => ['normal','roughness','metalness','emission']
    .filter(channel=>Array.isArray(material?.[channel]));

  function faceEdits(scene, id, map, operation) {
    const topology = K.meshTopology, meshes = {}, references = [], invalidatedBakes = [];
    const dimensionsChanged = map.before.some((size,i)=>size!==map.size[i]);
    if (!dimensionsChanged) return {meshes,references,invalidatedBakes};
    for (const [object,row] of Object.entries(scene.topologyMeshes ?? {})) {
      const materials = new Map((row.materials ?? []).map(material=>[material.id,material]));
      const activeBakes = new Map((row.bakes ?? []).filter(bake=>!bake.invalidated).map(bake=>[bake.material,bake]));
      if (![...materials.values()].some(material=>material.texture?.tileset === id) &&
          ![...activeBakes.values()].some(bake=>bake.maps.texture?.tileset === id)) continue;
      const doc = topology.create(row.document), uvSet = MaterialUV.resolve(doc.uvBindings,'pigment');
      const changed = [], dirty = new Map();
      for (const face of doc.faces) {
        const material = materials.get(face.material), bake = activeBakes.get(face.material);
        const base = material?.texture, baked = bake?.maps.texture;
        const usesBase = base?.tileset === id, usesBake = baked?.tileset === id;
        if (!usesBase && !usesBake) continue;
        const corners = face.corners.map(corner=>{
          const before = MaterialUV.uv(corner,uvSet);
          const after = operation.type === 'resize' ? before.map((value,i)=>{
            if (map.before[i] === map.size[i] && map.offset[i] === 0) return value;
            // Mesh UV zero and one address the centers of the first and last texels.
            const center = value*(map.before[i]-1)-map.offset[i], span = map.size[i]-1;
            if (center < -1e-12 || center > span+1e-12) return center/Math.max(1,span);
            return span ? Math.max(0,Math.min(span,center))/span : 0;
          }) : before;
          return {id:corner.id,before,after};
        });
        const moved = corners.some(({before,after})=>after.some((value,i)=>value !== before[i]));
        const override = moved && (usesBase && baked && !usesBake || usesBake && base && !usesBase);
        const conflicts = [];
        const channels = usesBase ? rasterChannels(material) : rasterChannels(bake?.maps);
        if (channels.length) conflicts.push({reason:'registered-material-maps',channels});
        if (operation.type === 'resize') {
          if (override) conflicts.push({reason:'shared-uv-textures'});
          for (const [i,{id:corner,before,after}] of corners.entries()) {
            if (after.some((value,axis)=>map.size[axis] === 1 && map.before[axis] !== 1 ?
              value !== 0 : value<0 || value>1)) conflicts.push({reason:'outside-canvas',corner});
            if (MaterialUV.pinned(face.corners[i],uvSet) && after.some((value,axis)=>value!==before[axis]))
              conflicts.push({reason:'pinned-uv',corner});
          }
        }
        const status = conflicts.length ? 'blocked' : moved ? 'remapped' : operation.type === 'resize' ? 'unchanged' : 'resampled';
        references.push({object,...(row.part && {part:row.part}),face:face.id,material:face.material,uvSet,
          texture:usesBake ? usesBase ? 'material-and-bake' : 'bake' : 'material',status,corners,conflicts});
        if (conflicts.length) continue;
        if (moved) changed.push({...face,corners:face.corners.map((corner,i)=>uvSet ?
          {...corner,attributes:{...corner.attributes,[MaterialUV.key(uvSet)]:corners[i].after}} :
          {...corner,uv:corners[i].after})});
        if (usesBase && bake && (!baked || usesBake && rasterChannels(bake.maps).length)) {
          if (!dirty.has(bake.id)) dirty.set(bake.id,[]);
          dirty.get(bake.id).push(face.id);
        }
      }
      if (changed.length || dirty.size) {
        const document = changed.length ? topology.edit(doc,{faces:changed}) : row.document;
        const bakes = row.bakes?.map(bake => {
          const faces = dirty.get(bake.id);
          if (!faces) return bake;
          invalidatedBakes.push({object,bake:bake.id,faces});
          return {...bake,invalidated:{faces}};
        });
        meshes[object] = {...row,document,...(bakes && {bakes})};
      }
    }
    return {meshes,references,invalidatedBakes};
  }

  function plan(scene, id, operation) {
    if (operation?.type === 'swap') return A.tilesetSwap.plan(scene,id,operation);
    const tilesets = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const asset = tilesets.source(id), {type,size,anchor,tileSize} = operation ?? {};
    if (!operation || Object.getPrototypeOf(operation) !== Object.prototype || Object.keys(operation).some(key=>!['type','size','anchor','tileSize'].includes(key)) ||
        !['resize','resample'].includes(type) || type === 'resample' && anchor !== undefined)
      throw new TypeError('Choose an anchored tileset resize or nearest-neighbor tileset resample');
    const map = PixelCanvasTransforms.plan(asset.width,asset.height,
      {type,size,...(type === 'resize' && {anchor:anchor ?? 'top-left'})},undefined,A.tilesets.maxEdge);
    const grid = gridPlan(tilesets.grid(id),map,operation);
    const {meshes,references,invalidatedBakes} = faceEdits(scene,id,map,operation);
    const canCommit = grid.canCommit && references.every(ref=>!ref.conflicts.length);
    const report = {format:'ink-studio/tileset-canvas-edit',version:1,tileset:id,type,
      ...(type === 'resize' && {anchor:anchor ?? 'top-left'}),before:map.before,size:map.size,
      sourceOffset:map.offset,sourceScale:map.scale,grid,references,invalidatedBakes,canCommit};
    if (!canCommit) return {report:freeze(report)};
    if (tileSize === undefined && map.size.every((value,i)=>value === map.before[i]))
      return {report:freeze({...report,encoding:{before:asset.encoding,after:asset.encoding}})};
    const inherited = tilesets.grid().tileSize;
    const keepInherited = asset.tileSize === undefined && tileSize === undefined && JSON.stringify(grid.after) === JSON.stringify(inherited);
    const next = editRaster(asset,map,keepInherited ? null : grid.after);
    return {asset:next,meshes,report:freeze({...report,encoding:{before:asset.encoding,after:next.encoding}})};
  }

  A.tilesetCanvas = Object.freeze({plan});
})(KIT);
