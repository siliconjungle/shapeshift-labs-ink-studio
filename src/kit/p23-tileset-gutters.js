/* Extend chart paint into an existing tileset without moving its sample coordinates. */
(function (K) {
  const A = K.authoring, T = K.meshTopology, {freeze} = K.procedural.data;
  const {fields, name, tuple, integer} = meshUVRegions;

  function rect(value, width, height) {
    if (!tuple(value,4,n=>integer(n,0,A.tilesets.maxEdge)) || !value[2] || !value[3] ||
        value[0]+value[2]>width || value[1]+value[3]>height)
      throw new RangeError('Use an in-bounds texel rectangle [x,y,width,height]');
    return value;
  }

  function rectangle(mask, width, [x,y,w,h]) {
    for (let row=y;row<y+h;row++) mask.fill(1,row*width+x,row*width+x+w);
  }

  function sheetGeometry(scene, tileset, width, height) {
    const all = [], meshes = new Map();
    for (const [object,row] of Object.entries(scene.topologyMeshes ?? {})) {
      const materials = new Set(row.materials?.filter(item=>item.texture?.tileset===tileset).map(item=>item.id));
      if (!materials.size) continue;
      const layout = T.uv.inspect(row.document,'pigment');
      const faces = new Map(layout.faces.filter(face=>materials.has(face.material)).map(face=>[face.id,face.island]));
      const corners = new Map(layout.corners.map(({id,uv})=>[id,MaterialUV.texel(uv,width,height)]));
      const islands = new Map();
      for (const triangle of T.triangulate(row.document).triangleSources) {
        const island = faces.get(triangle.face);
        if (island===undefined) continue;
        if (!islands.has(island)) islands.set(island,[]);
        const points = triangle.corners.map(id=>corners.get(id));
        islands.get(island).push(points);
        all.push(points);
      }
      meshes.set(object,islands);
    }
    const occupied = MeshUV.texelMask(all,width,height).mask;
    // A retained crop still owns its artwork after an inset moves the UVs away from its outer pixels.
    for (const row of Object.values(scene.topologyMeshes ?? {})) for (const binding of row.bindings ?? []) {
      if (!A.tilesetFaces.isSourceBinding(binding) || binding.data.selection?.tileset!==tileset) continue;
      const {x,y,width:w,height:h} = binding.data.selection;
      if ([x,y,w,h].every(Number.isSafeInteger) && x>=0 && y>=0 && w>0 && h>0 && x+w<=width && y+h<=height)
        rectangle(occupied,width,[x,y,w,h]);
    }
    return {occupied,meshes};
  }

  function plan(scene, request) {
    if (!fields(request,['tileset','regions','padding','writable']) || !A.tilesets.validId(request.tileset) ||
        !Array.isArray(request.regions) || !integer(request.regions.length,1,128) || !integer(request.padding,1,32) ||
        request.writable!==undefined && (!Array.isArray(request.writable) || request.writable.length>128))
      throw new TypeError('Paint gutters for named tile rectangles or UV islands with 1–32 texels of padding');
    const {tileset, padding, writable=[]} = request, registry = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const asset = registry.source(tileset), {width,height,encoding,alpha} = asset, size = width*height;
    if (size*request.regions.length>32e6)
      throw new RangeError('Painted gutters exceed the atlas work budget. Choose fewer regions per edit.');
    const {occupied,meshes} = sheetGeometry(scene,tileset,width,height), allowed = new Uint8Array(size);
    for (const value of writable) rectangle(allowed,width,rect(value,width,height));
    const names = new Set(), regions = Array.from(request.regions,row=>{
      const explicit = row?.rect!==undefined;
      if (!(explicit ? fields(row,['id','rect']) : fields(row,['id','object','island'])) || !name(row.id) ||
          names.has(row.id) || !explicit && (!name(row.object) || !name(row.island)))
        throw new TypeError('Gutter regions need unique IDs and either a rectangle or an object and UV island');
      names.add(row.id);
      if (!explicit && !meshes.get(row.object)?.has(row.island))
        throw new RangeError('Choose a UV island that uses the registered tileset');
      if (explicit) rect(row.rect,width,height);
      return row;
    }).sort((a,b)=>a.id<b.id ? -1 : 1);
    const owner = new Int16Array(size), donor = new Int32Array(size), distance = new Uint8Array(size);
    const evidence = regions.map((row,index)=>{
      let mask;
      if (row.rect) {
        mask = new Uint8Array(size);
        rectangle(mask,width,row.rect);
      } else mask = MeshUV.texelMask(meshes.get(row.object).get(row.island),width,height).mask;
      let sourceTexels = 0;
      for (let i=0;i<size;i++) if (mask[i]) {
        sourceTexels++;
        donor[i] = i;
        owner[i] = owner[i] ? -1 : index+1;
        occupied[i] = 1;
      }
      return {...row,sourceTexels,writtenTexels:0};
    });
    const decoded = atob(asset.data), bytes = new Uint8Array(decoded.length);
    for (let i=0;i<bytes.length;i++) bytes[i] = decoded.charCodeAt(i);
    const output = bytes.slice();
    const stride = encoding==='indexed8' ? 1 : 4;
    const equal = (a,b)=>{
      for (let i=0;i<stride;i++) if (bytes[a*stride+i]!==bytes[b*stride+i]) return false;
      return true;
    };
    const opacity = i=>stride===1 ? alpha?.[bytes[i]] ?? 255 : bytes[i*4+3];
    const obstructions = new Uint8Array(size);
    let front = [];
    for (let i=0;i<size;i++) if (owner[i]>0) front.push(i);
    for (let step=1;step<=padding && front.length;step++) {
      const next = [];
      function visit(i,j) {
        if (owner[j]) {
          if (distance[j]===step && owner[j]>0 && owner[j]!==owner[i]) owner[j] = -1;
          return;
        }
        if (occupied[j]) {obstructions[j] |= 1; return;}
        if (!allowed[j] && opacity(j) && !equal(donor[i],j)) {obstructions[j] |= 2; return;}
        owner[j] = owner[i];
        donor[j] = donor[i];
        distance[j] = step;
        next.push(j);
      }
      for (const i of front) if (owner[i]>0) {
        const x = i%width;
        if (x) visit(i,i-1);
        if (x+1<width) visit(i,i+1);
        if (i>=width) visit(i,i-width);
        if (i+width<size) visit(i,i+width);
      }
      front = next;
    }
    let writtenTexels = 0, contestedTexels = 0, protectedTexels = 0, occupiedPaint = 0;
    const bounds = [width,height,-1,-1];
    for (let i=0;i<size;i++) {
      if (owner[i]<0) contestedTexels++;
      if (obstructions[i]&1) protectedTexels++;
      if (obstructions[i]&2) occupiedPaint++;
      if (!distance[i] || owner[i]<=0 || equal(i,donor[i])) continue;
      output.set(bytes.subarray(donor[i]*stride,(donor[i]+1)*stride),i*stride);
      evidence[owner[i]-1].writtenTexels++;
      writtenTexels++;
      const x = i%width, y = Math.floor(i/width);
      bounds[0] = Math.min(bounds[0],x);
      bounds[1] = Math.min(bounds[1],y);
      bounds[2] = Math.max(bounds[2],x);
      bounds[3] = Math.max(bounds[3],y);
    }
    const report = {format:'ink-studio/tileset-gutters',version:1,tileset,atlas:[width,height],encoding,padding,
      distance:'four-neighbor',uvEdits:0,regions:evidence,writtenTexels,changedBounds:writtenTexels ? bounds : null,
      contestedTexels,protectedTexels,occupiedPaint};
    return {asset:writtenTexels ? {...asset,data:A.tilesets.encodeRaster(output)} : asset,report:freeze(report)};
  }

  A.tilesetGutters = Object.freeze({plan});
})(KIT);
