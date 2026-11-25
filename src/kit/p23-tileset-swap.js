/* Exchange two atlas rectangles and keep the authored faces sampling their original paint. */
(function (K) {
  const A = K.authoring, topology = K.meshTopology, {freeze} = K.procedural.data;
  const {key,uv,pinned,resolve} = MaterialUV;

  function rectangle(id, asset, bounds) {
    if (bounds?.tileset !== undefined && bounds.tileset !== id)
      throw new RangeError('Both regions must address the selected tileset');
    const {x,y,width,height} = TilesetSelection.pick(id,asset,bounds ?? undefined);
    return {x,y,width,height};
  }

  function exchange(asset, a, b) {
    const channels = asset.encoding === 'indexed8' ? 1 : 4;
    const bytes = atob(asset.data), data = new Uint8Array(bytes.length);
    for (let i=0;i<data.length;i++) data[i] = bytes.charCodeAt(i);
    const stride = a.width*channels;
    for (let y=0;y<a.height;y++) {
      const rowA = ((a.y+y)*asset.width+a.x)*channels;
      const rowB = ((b.y+y)*asset.width+b.x)*channels;
      const saved = data.slice(rowA,rowA+stride);
      data.copyWithin(rowA,rowB,rowB+stride);
      data.set(saved,rowB);
    }
    return {...asset,data:A.tilesets.encodeRaster(data)};
  }

  function sampleBounds(corners, span) {
    // Scene meshes place UV zero and one at the first and last texel centers.
    const low = [Infinity,Infinity], high = [-Infinity,-Infinity];
    for (const uv of corners) for (let axis=0;axis<2;axis++) {
      const texel = Math.floor(.5+Math.fround(uv[axis])*span[axis]);
      low[axis] = Math.min(low[axis],texel);
      high[axis] = Math.max(high[axis],texel);
    }
    return {x:low[0],y:low[1],width:high[0]-low[0]+1,height:high[1]-low[1]+1};
  }

  const contains = (a,b) => a.x<=b.x && a.y<=b.y && a.x+a.width>=b.x+b.width && a.y+a.height>=b.y+b.height;
  const intersects = (a,b) => a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
  const enabled = value=>value !== undefined && value !== false;

  function filter(material) {
    return enabled(material.sampling) || enabled(material.mipmaps) ||
      material.mipmaps === undefined && ['roughness','metalness','emission','scan','simulationLayers']
        .some(channel=>material[channel] !== undefined);
  }

  function facePlan(face, material, bake, id, regions, span, uvSet, look) {
    const base = material.texture, baked = bake?.maps.texture;
    const usesBase = base?.tileset === id, usesBake = baked?.tileset === id;
    if (!usesBase && !usesBake) return;
    const before = face.corners.map(corner=>uv(corner,uvSet) ?? [0,0]);
    const footprint = sampleBounds(before,span);
    const region = regions.findIndex(slot=>contains(slot,footprint));
    const crosses = region<0 && regions.some(slot=>intersects(slot,footprint));
    // Check both the baked appearance and the underlying paint used after rebaking.
    const bakedMaterial = bake && {...material,...bake.maps,sampling:bake.maps.mipmaps ? undefined : material.sampling};
    const conflicts = [];
    if (usesBase && filter(material) || bakedMaterial?.texture?.tileset === id && filter(bakedMaterial))
      conflicts.push({reason:'atlas-wide-filter'});
    if (crosses) conflicts.push({reason:'crossing-region'});
    if (region<0 && !conflicts.length) return;
    const corners = face.corners.map(({id},i)=>({id,before:before[i],after:before[i]}));
    if (region>=0) {
      const from = regions[region], to = regions[1-region], shift = [to.x-from.x,to.y-from.y];
      if (base && !usesBase || baked && !usesBake) conflicts.push({reason:'shared-uv-textures'});
      const channels = ['normal','roughness','metalness','emission']
        .filter(channel=>Array.isArray(material[channel]) || Array.isArray(bake?.maps[channel]));
      if (channels.length) conflicts.push({reason:'registered-material-maps',channels});
      if (enabled(material.engraving ?? look?.engraving)) conflicts.push({reason:'uv-engraving'});
      for (const [index,corner] of corners.entries()) {
        if (pinned(face.corners[index],uvSet)) conflicts.push({reason:'pinned-uv',corner:corner.id});
        corner.after = corner.before.map((value,axis)=>shift[axis] ? (value*span[axis]+shift[axis])/span[axis] : value);
        if (corner.after.some(value=>value < -1e-12 || value > 1+1e-12))
          conflicts.push({reason:'outside-uv-range',corner:corner.id});
        else corner.after = corner.after.map(value=>Math.max(0,Math.min(1,value)));
      }
      const translated = sampleBounds(corners.map(corner=>corner.after),span);
      if (translated.x !== footprint.x+shift[0] || translated.y !== footprint.y+shift[1] ||
          translated.width !== footprint.width || translated.height !== footprint.height)
        conflicts.push({reason:'unstable-texel-boundary'});
    }
    return {face:face.id,material:face.material,uvSet,footprint,
      ...(region>=0 && {from:region === 0 ? 'a' : 'b',to:region === 0 ? 'b' : 'a'}),
      status:conflicts.length ? 'blocked' : 'remapped',corners,conflicts};
  }

  function updateRow(row, doc, faces) {
    const document = topology.edit(doc,{faces});
    const before = topology.revision(doc), after = topology.revision(document);
    // A UV translation leaves the stable vertex and corner addresses of these assets intact.
    return {...row,document,
      ...(row.attachments?.revision === before && {attachments:{...row.attachments,revision:after}}),
      ...(row.shapeKeys?.restRevision === before && {shapeKeys:{...row.shapeKeys,restRevision:after}})};
  }

  function referencesFor(scene, id, asset, regions) {
    const patches = [], references = [], blockers = [];
    const span = [asset.width-1,asset.height-1], look = K.diorama.sceneLook(scene);
    const evaluate = A.meshTopologyScene.evaluator(scene.topologyMeshes ?? {});
    for (const [object,row] of Object.entries(scene.topologyMeshes ?? {}).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0)) {
      const materials = new Map((row.materials ?? []).map(material=>[material.id,material]));
      const bakes = new Map((row.bakes ?? []).map(bake=>[bake.material,bake]));
      if (![...materials.values()].some(material=>material.texture?.tileset === id) &&
          ![...bakes.values()].some(bake=>bake.maps.texture?.tileset === id)) continue;
      const doc = topology.create(row.document), uvSet = resolve(doc.uvBindings,'pigment');
      const inspect = face => facePlan(face,materials.get(face.material) ?? {},bakes.get(face.material),id,regions,span,uvSet,look);
      const modifiers = row.modifiers?.filter(modifier=>modifier.enabled !== false);
      if (modifiers?.length) {
        const affected = doc.faces.find(inspect) ?? evaluate(object).document.faces.find(inspect);
        if (affected) blockers.push({reason:'active-mesh-modifiers',object,face:affected.id,modifiers:modifiers.map(row=>row.id)});
        continue;
      }
      const faces = [];
      for (const face of doc.faces) {
        const ref = inspect(face);
        if (!ref) continue;
        references.push({object,...(row.part && {part:row.part}),...ref});
        if (ref.conflicts.length) continue;
        faces.push({...face,corners:face.corners.map((corner,i)=>uvSet ?
          {...corner,attributes:{...corner.attributes,[key(uvSet)]:ref.corners[i].after}} :
          {...corner,uv:ref.corners[i].after})});
      }
      if (faces.length) patches.push([object,updateRow(row,doc,faces)]);
    }
    return {meshes:Object.fromEntries(patches),references,blockers};
  }

  function plan(scene, id, operation) {
    if (!operation || operation.type !== 'swap' || Object.getPrototypeOf(operation) !== Object.prototype || Object.keys(operation).some(key=>!['type','a','b'].includes(key)))
      throw new TypeError('A tileset swap needs two texel rectangles');
    const atlas = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults), asset = atlas.source(id);
    const a = rectangle(id,asset,operation.a), b = rectangle(id,asset,operation.b);
    if (a.width !== b.width || a.height !== b.height || intersects(a,b))
      throw new RangeError('Swap rectangles must have equal dimensions and no overlap');
    const {meshes,references,blockers} = referencesFor(scene,id,asset,[a,b]);
    const canCommit = !blockers.length && references.every(ref=>!ref.conflicts.length);
    const report = freeze({format:'ink-studio/tileset-swap',version:1,type:'swap',tileset:id,regions:{a,b},
      size:[asset.width,asset.height],encoding:asset.encoding,texelsExchanged:2*a.width*a.height,
      ...(scene.tilesetSources?.[id] && {source:scene.tilesetSources[id]}),
      references,blockers,canCommit});
    return canCommit ? {asset:exchange(asset,a,b),meshes,report} : {report};
  }

  A.tilesetSwap = Object.freeze({plan});
})(KIT);
