/* Plan revision edits against retained image, mesh, timeline and prefab sources. */
(function (K) {
  const A = K.authoring, {freeze,hash} = K.procedural.data;
  const ordered = table=>Object.entries(table ?? {}).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0);
  const imageShape = asset=>[asset.width,asset.height,asset.encoding,asset.palette,asset.alpha];
  const sameImage = (a,b)=>JSON.stringify(imageShape(a)) === JSON.stringify(imageShape(b)) &&
    (a.data === b.data || atob(a.data) === atob(b.data));
  const descriptor = (id,asset,tileSize)=>({id,width:asset.width,height:asset.height,encoding:asset.encoding,
    tileSize,revision:hash(JSON.stringify([...imageShape(asset),asset.data,tileSize])).toString(16).padStart(8,'0')});

  function clipDefinitions(timeline) {
    if (!timeline) return [];
    const sequences = timeline.sequences ?? {}, reachable = new Set();
    const pending = (timeline.clips ?? []).map(clip=>clip.sequence);
    while (pending.length) {
      const sequence = pending.pop();
      if (reachable.has(sequence)) continue;
      reachable.add(sequence);
      for (const clip of sequences[sequence]?.clips ?? []) pending.push(clip.sequence);
    }
    return [[null,timeline],...ordered(sequences)].flatMap(([owner,node])=>
      (node.clips ?? []).map(({id,sequence})=>({id,sequence,owner,reachable:owner === null || reachable.has(owner)})));
  }

  function inventory(scene, ids, external) {
    const result = new Map(ids.map(id=>[id,{faces:[],materials:[],clips:[],prefabs:[]}]));
    const evaluate = scene.topologyMeshes && A.meshTopologyScene.evaluator(scene.topologyMeshes);
    for (const [object,mesh] of ordered(scene.topologyMeshes)) {
      const materials = (mesh.materials ?? []).map(row=>({material:row.id,tileset:row.texture?.tileset}));
      const bakes = (mesh.bakes ?? []).map(row=>({material:row.material,tileset:row.maps.texture?.tileset,
        bake:row.id,invalidated:Boolean(row.invalidated)}));
      const scoped = [...materials,...bakes].filter(row=>result.has(row.tileset));
      if (!scoped.length) continue;
      const doc = mesh.modifiers ? evaluate(object).document : mesh.document;
      const faces = new Map();
      for (const face of doc.faces) {
        const material = face.material ?? 'default';
        if (!faces.has(material)) faces.set(material,[]);
        faces.get(material).push(face.id);
      }
      for (const {material,tileset,bake,invalidated} of scoped) {
        const overridden = (mesh.bakes ?? []).some(row=>
          row.material === material && row.maps.texture !== undefined && !row.invalidated);
        const binding = {object,...(mesh.part && {part:mesh.part}),material,...(bake && {bake}),
          active:bake ? !invalidated : !overridden};
        const deps = result.get(tileset);
        deps.materials.push(binding);
        for (const face of (faces.get(material) ?? []).sort()) deps.faces.push({...binding,face});
      }
    }
    const instances = new Map();
    for (const [id,{prefab}] of ordered(scene.instances)) {
      if (!instances.has(prefab)) instances.set(prefab,[]);
      instances.get(prefab).push(id);
    }
    for (const [scope,table] of [['scene',scene.prefabs],['library',external]]) {
      for (const [id,prefab] of ordered(table)) for (const sheet of prefab.usesTilesets ?? []) {
        if (!result.has(sheet)) continue;
        const placements = instances.get(id) ?? [];
        result.get(sheet).prefabs.push({id,revision:prefab.revision,scope,
          ...(scope === 'library' && scene.prefabLibrary && {library:scene.prefabLibrary}),
          instances:placements,used:placements.length>0});
      }
    }
    const clips = clipDefinitions(scene.timeline);
    for (const deps of result.values()) {
      if (deps.faces.some(face=>face.active) || deps.prefabs.some(prefab=>prefab.used)) deps.clips = clips;
    }
    return result;
  }

  function dependencies(scene, id, external) {
    const tilesets = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const ids = id === undefined ? Object.keys(scene.tilesets ?? {}).sort() : [id];
    const assets = ids.map(key=>descriptor(key,tilesets.source(key),tilesets.grid(key).tileSize));
    const refs = inventory(scene,ids,external), links = A.tilesetSources.prepare(scene);
    return freeze({format:'ink-studio/tileset-dependencies',version:1,
      sheets:assets.map(asset=>({...asset,...refs.get(asset.id),...(links[asset.id] && {source:links[asset.id]})}))});
  }

  function combine(ids, tilesets, axis) {
    let width = 0, height = 0;
    const placements = ids.map(id=>{
      const asset = tilesets.source(id);
      const x = axis === 'x' ? width : 0, y = axis === 'y' ? height : 0;
      width = Math.max(width,x+asset.width);
      height = Math.max(height,y+asset.height);
      return {id,x,y,width:asset.width,height:asset.height};
    });
    if (width>A.tilesets.maxEdge || height>A.tilesets.maxEdge) return {width,height,placements};
    const first = tilesets.source(ids[0]);
    const signature = asset=>JSON.stringify([asset.palette,asset.alpha]);
    const indexed = placements.every(row=>{
      const asset = tilesets.source(row.id);
      return asset.encoding === 'indexed8' && signature(asset) === signature(first) &&
        (axis === 'x' ? row.height === height : row.width === width);
    });
    const channels = indexed ? 1 : 4, pixels = new Uint8Array(width*height*channels);
    for (const row of placements) {
      const source = indexed ? atob(tilesets.source(row.id).data) : tilesets.resolve({tileset:row.id}).pixels;
      const stride = row.width*channels;
      for (let y=0;y<row.height;y++) {
        const start = ((row.y+y)*width+row.x)*channels;
        if (indexed) {
          for (let byte=0;byte<stride;byte++) pixels[start+byte] = source.charCodeAt(y*stride+byte);
        } else pixels.set(source.subarray(y*stride,(y+1)*stride),start);
      }
    }
    const asset = {version:1,width,height,encoding:indexed ? 'indexed8' : 'rgba8',data:A.tilesets.encodeRaster(pixels),
      tileSize:{width,height},...(indexed && {palette:first.palette,...(first.alpha !== undefined && {alpha:first.alpha})})};
    return {asset,width,height,placements};
  }

  function redirect(scene, from, to) {
    const meshes = {}, prefabs = {};
    const texture = source=>source?.tileset === from ? {...source,tileset:to} : source;
    for (const [object,mesh] of ordered(scene.topologyMeshes)) {
      const materials = mesh.materials?.map(row=>row.texture?.tileset === from ? {...row,texture:texture(row.texture)} : row);
      const bakes = mesh.bakes?.map(row=>row.maps.texture?.tileset === from ?
        {...row,maps:{...row.maps,texture:texture(row.maps.texture)}} : row);
      if (materials?.some((item,i)=>item !== mesh.materials[i]) || bakes?.some((item,i)=>item !== mesh.bakes[i]))
        meshes[object] = {...mesh,...(materials && {materials}),...(bakes && {bakes})};
    }
    for (const [id,prefab] of ordered(scene.prefabs)) {
      if (prefab.usesTilesets?.includes(from))
        prefabs[id] = {...prefab,usesTilesets:[...new Set(prefab.usesTilesets.map(sheet=>sheet === from ? to : sheet))]};
    }
    return {...(Object.keys(meshes).length && {topologyMeshes:{...scene.topologyMeshes,...meshes}}),
      ...(Object.keys(prefabs).length && {prefabs:{...scene.prefabs,...prefabs}})};
  }

  function invalidateBakes(scene, id) {
    const meshes = {}, invalidatedBakes = [];
    for (const [object,mesh] of ordered(scene.topologyMeshes)) {
      const bound = new Set((mesh.materials ?? []).filter(row=>row.texture?.tileset === id).map(row=>row.id));
      const bakes = mesh.bakes?.map(row=>{
        if (row.invalidated || row.maps.texture !== undefined || !bound.has(row.material)) return row;
        const faces = mesh.document.faces.filter(face=>(face.material ?? 'default') === row.material).map(face=>face.id).sort();
        if (!faces.length) return row;
        invalidatedBakes.push({object,bake:row.id,faces});
        return {...row,invalidated:{faces}};
      });
      if (bakes?.some((row,i)=>row !== mesh.bakes[i])) meshes[object] = {...mesh,bakes};
    }
    return {patch:Object.keys(meshes).length ? {topologyMeshes:{...scene.topologyMeshes,...meshes}} : {},invalidatedBakes};
  }

  const schemas = {clone:['id','newId'],replace:['id','asset'],combine:['ids','newId','axis'],
    deduplicate:['id','keepId'],remove:['id']};

  function plan(scene, request, external) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        !Object.hasOwn(schemas,request.type) || Object.keys(request).some(key=>key !== 'type' && !schemas[request.type].includes(key)))
      throw new TypeError('Choose a tileset clone, replace, combine, deduplicate or remove request');
    const {type,id,newId,keepId,axis='x'} = request;
    const ids = type === 'combine' ? request.ids : type === 'deduplicate' ? [id,keepId] : [id];
    const output = {...scene.tilesets}, API = A.tilesets;
    if (!Array.isArray(ids) || !ids.length || (type === 'combine' && ids.length<2) ||
        !Array.from(ids).every(API.validId) || new Set(ids).size !== ids.length)
      throw new TypeError('Choose distinct source tileset IDs');
    const tilesets = API.prepare(scene.tilesets,scene.tilesetDefaults);
    const sources = ids.map(key=>tilesets.source(key));
    const refs = inventory(scene,ids,external);
    const blockers = [], links = A.tilesetSources.prepare(scene);
    let extra = {}, detail = {};
    if (type === 'clone' || type === 'combine') {
      if (!API.validId(newId)) throw new TypeError('Use a lowercase new tileset ID with letters, digits, and dashes');
      if (Object.hasOwn(output,newId)) blockers.push({reason:'id-in-use',id:newId});
      else if (type === 'clone') output[newId] = sources[0];
      else {
        if (!['x','y'].includes(axis)) throw new RangeError('Choose an x or y strip for the combined atlas');
        const {asset,width,height,placements} = combine(ids,tilesets,axis);
        if (asset) output[newId] = asset;
        else blockers.push({reason:'combined-atlas-too-large',id:newId,width,height,limit:API.maxEdge});
        detail = {axis,placements};
      }
    } else if (type === 'replace') {
      const asset = request.asset;
      const {tileSize,...image} = API.prepare({replacement:asset}).source('replacement');
      const revised = {...image,...(sources[0].tileSize && {tileSize:sources[0].tileSize})};
      const grid = tilesets.grid(id).tileSize;
      if (grid && !TilesetSelection.gridFits(revised,grid)) blockers.push({reason:'grid-does-not-fit',id,tileSize:grid});
      output[id] = revised;
      if (!sameImage(sources[0],revised)) {
        const {patch,invalidatedBakes} = invalidateBakes(scene,id);
        extra = patch;
        detail = {invalidatedBakes};
      }
    } else {
      const {materials,prefabs} = refs.get(id);
      if (type === 'remove') {
        if (materials.length || prefabs.length) blockers.push({reason:'tileset-in-use',id});
      } else {
        const [from,to] = sources, sameGrid = JSON.stringify(tilesets.grid(id).tileSize) === JSON.stringify(tilesets.grid(keepId).tileSize);
        if (!sameGrid || !sameImage(from,to))
          blockers.push({reason:'different-tilesets',id,keepId});
        if (links[id] && JSON.stringify(links[id]) !== JSON.stringify(links[keepId]))
          blockers.push({reason:'different-source-links',id,keepId});
        for (const prefab of prefabs.filter(row=>row.scope === 'library'))
          blockers.push({reason:'shared-prefab-library',id,prefab:prefab.id});
        if (!blockers.length) extra = redirect(scene,id,keepId);
      }
      if (!blockers.length) {
        delete output[id];
        if (links[id]) {
          const remaining = {...links};
          delete remaining[id];
          extra.tilesetSources = remaining;
        }
      }
    }
    const before = ids.map((key,i)=>({...descriptor(key,sources[i],tilesets.grid(key).tileSize),...refs.get(key),...(links[key] && {source:links[key]})}));
    const after = [...ids,...(newId !== undefined && !ids.includes(newId) ? [newId] : [])]
      .filter(key=>Object.hasOwn(output,key)).map(key=>descriptor(key,output[key],
        output[key].tileSize ?? tilesets.grid().tileSize));
    const report = freeze({format:'ink-studio/tileset-revision-edit',version:1,type,before,after,
      ...detail,...(type === 'deduplicate' && {redirect:{from:id,to:keepId}}),blockers,canCommit:!blockers.length});
    return report.canCommit ? {patch:{tilesets:output,...extra},report} : {report};
  }

  A.tilesetRevisions = Object.freeze({dependencies,plan});
})(KIT);
