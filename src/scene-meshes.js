/* Indexed, UV-mapped triangle assets for the shared cutout surface renderer. */
const SceneMeshes = (() => {
  const Sprite = typeof SpriteSurface === 'undefined' ? require('./sprite-surface.js') : SpriteSurface;
  const Mips = typeof SemanticTextureMipmaps === 'undefined' ? require('./semantic-texture-mipmaps.js') : SemanticTextureMipmaps;
  const simulationAPI=()=>typeof SimulationMaterialLayers==='undefined'?require('./simulation-material-layers.js'):SimulationMaterialLayers;
  const state = Symbol.for('ink-studio.sceneMesh');
  const charts = new WeakMap(), rayQueries = new WeakMap();
  const maxTriangles = 250000;
  const maxEdge = 2048;
  const array = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
  const bytes = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
  const name = value => typeof value === 'string' && Boolean(value.trim());
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;

  function every(input, check) {
    for (const value of input) if (!check(value)) return false;
    return true;
  }

  function positionsOf(input, length = input?.length) {
    if (!array(input) || input.length !== length || !length || length % 3 || length > maxTriangles * 9 ||
        !every(input,Number.isFinite))
      throw new RangeError('Mesh positions need one finite XYZ triple per vertex');
    const points = Float32Array.from(input);
    if (!points.every(Number.isFinite)) throw new RangeError('Mesh positions exceed float storage');
    return points;
  }

  function bounds(positions) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i+k]);
      max[k] = Math.max(max[k], positions[i+k]);
    }
    return { min, max };
  }

  function materialOf({ id, color = 0xffffff, texture: input, normal, roughness, emission, emissionStrength,
      alphaCutoff = .5, sampling, engraving, mipmaps, simulationLayers, scan } = {}) {
    const texture=Mips.texture(input);
    const { width = 1, height = 1, pixels, indices, palette } = texture ?? {};
    const simulation=simulationLayers===undefined ? undefined :
      simulationAPI().create(simulationLayers);
    const rules=Mips.settings(mipmaps ?? (simulation||indices||roughness!==undefined||emission||scan ? true : undefined));
    if(simulation&&!rules)throw new TypeError('Simulation layers need semantic material channels');
    if(rules && sampling)throw new TypeError('Choose one texture filter per material');
    if (!name(id) || !Number.isInteger(color) || color < 0 || color > 0xffffff || !unit(alphaCutoff))
      throw new RangeError('Mesh materials need an ID, RGB24 tint, and alpha cutoff in [0,1]');
    if (![width,height].every(n => Number.isInteger(n) && n > 0 && n <= maxEdge) ||
        texture !== undefined && (!bytes(pixels) || pixels.length !== width * height * 4))
      throw new RangeError('Mesh textures need top-down RGBA8 pixels and dimensions up to 2048');
    if (normal !== undefined && (!bytes(normal) || normal.length !== width * height * 4))
      throw new RangeError('Mesh normal maps need matching top-down RGBA8 pixels');
    const tint = [color >> 16, color >> 8 & 255, color & 255];
    const blockTexture = input?.blockTexture;
    if (blockTexture && (rules || sampling || indices || !pixels || blockTexture.width !== width ||
        blockTexture.height !== height || width % 4 || height % 4 ||
        !(blockTexture.blocks instanceof Uint8Array) || blockTexture.blocks.length !== width * height / 2))
      throw new RangeError('BC1 blocks need a matching opaque base-color texture');
    function paint(x, y) {
      if (!pixels) return color;
      const at = (y * width + x) * 4;
      if (pixels[at+3] / 255 < alphaCutoff) return;
      let ink = 0;
      for (let c = 0; c < 3; c++) ink = ink * 256 + Math.round(pixels[at+c] * tint[c] / 255);
      return ink;
    }
    function chain() {
      const pigment=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const ink=paint(x,y);
        if(ink!==undefined)pigment.set([ink>>16,ink>>8&255,ink&255,255],(y*width+x)*4);
      }
      const tintColor=ink=>tint.reduce((value,n,c)=>value*256+Math.round((ink>>((2-c)*8)&255)*n/255),0);
      return Mips.build({width,height,pigment,indices,palette:palette?.map(tintColor),normal,roughness,emission,emissionStrength,scan},
        {...rules,protect:rules.protect.map(tintColor)});
    }
    return { id, width, height, paint, normal, sampling, engraving, simulation, blockTexture, tint, ...(rules&&{chain}) };
  }

  function atlasWidth(materials) {
    // Tallest-first shelf packing. Choose the narrowest power-of-two multiple
    // of the largest tile that stays within the texture height limit.
    let width = Math.max(...materials.map(row => row.width));
    while (width < maxEdge) {
      let x = 0, y = 0, shelf = 0;
      for (const material of materials) {
        if (x + material.width > width) { x = 0; y += shelf; shelf = 0; }
        x += material.width;
        shelf = Math.max(shelf, material.height);
      }
      if (y + shelf <= maxEdge) break;
      width = Math.min(width * 2, maxEdge);
    }
    return width;
  }

  function create({ id, objectId = id, partId, positions: authored, uvs: uvInput, indices, materials, faceMaterials } = {}) {
    if (!name(id) || !name(objectId) || partId !== undefined && !name(partId))
      throw new TypeError('An indexed scene mesh needs nonempty mesh, object and optional part IDs');
    const positions = positionsOf(authored), vertices = positions.length / 3;
    if (!array(uvInput) || uvInput.length !== vertices * 2 || !every(uvInput,unit) ||
        !array(indices) || !indices.length || indices.length % 3 || indices.length / 3 > maxTriangles ||
        !every(indices,n => Number.isSafeInteger(n) && n >= 0 && n < vertices))
      throw new RangeError('A mesh needs normalized UV pairs and valid indexed triangles');
    const triangles = indices.length / 3;
    if (!Array.isArray(materials) || !materials.length || materials.length > 64 ||
        faceMaterials === undefined && materials.length !== 1 ||
        faceMaterials !== undefined && (!array(faceMaterials) || faceMaterials.length !== triangles ||
          !every(faceMaterials,n => Number.isInteger(n) && n >= 0 && n < materials.length)))
      throw new RangeError('A mesh needs 1 to 64 materials and a material index for each face when using multiple materials');
    const rows = Array.from(materials,materialOf);
    if (new Set(rows.map(row => row.id)).size !== rows.length)
      throw new RangeError('Mesh material IDs must be distinct');
    const grouped = rows.map(() => []), used = rows.map((row,index) => ({ ...row,index }));
    for (let triangle = 0; triangle < triangles; triangle++) grouped[faceMaterials?.[triangle] ?? 0].push(triangle);
    const tiles = used.filter(row => grouped[row.index].length).sort((a,b) => b.height-a.height || a.index-b.index);
    if (tiles.reduce((sum,tile) => sum+tile.width*tile.height,0) > maxEdge ** 2)
      throw new RangeError('Mesh textures exceed the 2048 × 2048 atlas budget');
    const atlas = Sprite.make(atlasWidth(tiles),maxEdge), regions = [];
    for (const tile of tiles) regions[tile.index] = atlas.reserve(tile.width,tile.height,tile.paint,{normal:tile.normal});
    const uvs = Float32Array.from(uvInput), source = Uint32Array.from(indices);
    const drawIndices = new Uint32Array(source.length), semantic=[], blocks=[];
    if(tiles.reduce((sum,tile)=>sum+(tile.chain?tile.width*tile.height:0),0)>2**20)
      throw new RangeError('Mesh semantic mipmaps exceed the texel budget');
    let cursor = 0;
    for (const [index,faces] of grouped.entries()) {
      if (!faces.length) continue;
      const offset = cursor;
      for (const face of faces) {
        drawIndices.set(source.subarray(face*3,face*3+3),cursor);
        cursor += 3;
      }
      const material = rows[index];
      atlas.meshRegion({ points:positions, restPoints:positions, uvs, triangles:drawIndices.subarray(offset,cursor) },
        regions[index], {id:material.id, objectId, partId, materialId:material.id, sampling:material.sampling,
          engraving:material.engraving});
      if (material.blockTexture) blocks.push({ first:offset, end:cursor, region:regions[index],
        texture:material.blockTexture, tint:material.tint });
      if(material.chain)semantic.push({first:offset,end:cursor,region:regions[index],chain:material.chain(),
        ...(material.simulation&&{simulation:material.simulation,materialId:material.id})});
    }
    const layer = atlas.finish();
    if(semantic.length)layer.semanticMipmaps=semantic;
    if (blocks.length) layer.blockTextures = { revision:layer.revision, ranges:blocks,
      complete:blocks.reduce((sum,row)=>sum+row.end-row.first,0)===source.length };
    layer.sceneMeshId = id;
    const restBounds=bounds(positions);
    const data = { positions, rest:positions, restBounds, uvs, indices:source, drawIndices, layer, regions, revision:0,
      materials:rows.map(row => row.id), faceMaterials:faceMaterials && Uint8Array.from(faceMaterials), bounds:restBounds };
    return Object.freeze({ id, objectId, partId, vertices, triangles,
      materials:Object.freeze(tiles.map(tile=>tile.id).sort()), [state]:data });
  }

  function depthProxy({id,positions,indices} = {}) {
    const points = positionsOf(positions);
    return create({id,positions:points,indices,uvs:new Float32Array(points.length / 3 * 2),
      materials:[{id:'proxy'}]});
  }

  function fromObjectTexels(bake, {id,objectId,partId,materialId=id,emissionStrength=1,
      lighting={}} = {}) {
    if (!bake?.cells || !bake.normal || !bake.roughness || !bake.emission)
      throw new TypeError('Use a relightable object texel bake');
    const {width,height,rgba,normal,roughness,emission,points,uvs,triangles}=bake;
    const mipmaps={ambient:.25,specular:.42,...lighting};
    const mesh=create({id,objectId,partId,positions:points,uvs,indices:triangles,
      materials:[{id:materialId,texture:{width,height,pixels:rgba},normal,roughness,emission,emissionStrength,mipmaps}]});
    const data=read(mesh), layer=data.layer;
    layer.semanticMipmaps=[{ ...layer.semanticMipmaps[0],objectTexels:true }];
    data.objectTexels={bake,emissionStrength,mipmaps:layer.semanticMipmaps[0].chain.rule};
    return mesh;
  }

  function updateObjectTexels(mesh, bake) {
    const data=read(mesh), binding=data.objectTexels;
    const previous=binding?.bake;
    if (!previous || !bake?.normal || !bake.roughness || !bake.emission ||
        bake.cells!==previous.cells || bake.points!==previous.points ||
        bake.triangles!==previous.triangles || bake.uvs!==previous.uvs ||
        bake.width!==previous.width || bake.height!==previous.height)
      throw new TypeError('Object texel edits must retain the bound cells and geometry');
    if (previous===bake) return mesh;
    const {width,height,rgba,normal,roughness,emission}=bake;
    const {layer}=data, [row]=layer.semanticMipmaps;
    const chain=Mips.build({width,height,pigment:rgba,normal,roughness,emission,
      emissionStrength:binding.emissionStrength},binding.mipmaps);
    Sprite.update(layer,row.region,{w:width,h:height,rgba});
    layer.normalPixels.set(normal);
    layer.semanticMipmaps=[{...row,chain}];
    binding.bake=bake;
    return mesh;
  }

  function read(mesh) {
    if (!mesh?.[state]) throw new TypeError('Use SceneMeshes.create for indexed scene geometry');
    return mesh[state];
  }

  function inspectUV(mesh, {material, size, ...options} = {}) {
    const {rest,uvs,indices,materials,faceMaterials,regions}=read(mesh);
    const name=material??(mesh.materials.length===1 ? mesh.materials[0] : undefined);
    const slot=materials.indexOf(name), region=regions[slot];
    if (!region) throw new RangeError('Choose a textured mesh material to inspect its UV atlas');
    const points=Array.from({length:rest.length/3},(_,i)=>Array.from(rest.subarray(i*3,i*3+3)));
    const triangles=[];
    for (let i=0; i<indices.length; i+=3)
      if ((faceMaterials?.[i/3]??0)===slot) triangles.push(Array.from(indices.subarray(i,i+3)));
    const uv=triangles.map(face=>face.map(i=>[uvs[i*2],uvs[i*2+1]]));
    const api=typeof MeshUV==='undefined' ? require('./mesh-uv.js') : MeshUV;
    return api.inspect({points,triangles,uvs:uv},{...options,size:size??[region.width,region.height]});
  }

  function pose(mesh, input) {
    const data = read(mesh), positions = positionsOf(input,data.positions.length), target = data.layer.vertices;
    for (let i = 0; i < data.drawIndices.length; i++) {
      const at = data.drawIndices[i] * 3;
      for (let k = 0; k < 3; k++) target[i*5+k] = positions[at+k];
    }
    Sprite.markGeometryDirty(data.layer);
    data.positions = positions;
    data.bounds = bounds(positions);
    data.revision++;
    return mesh;
  }

  function uvAnchors(mesh, {V, procedural:{spatial}}) {
    if (charts.has(mesh)) return charts.get(mesh);
    const data = read(mesh), {indices,uvs} = data;
    let lookup;
    function uvAt(i) { return [uvs[i*2],uvs[i*2+1],0]; }
    function triangleAt(triangle) {
      const vertices=Array.from(indices.subarray(triangle*3,triangle*3+3));
      const [a,b,c]=vertices.map(uvAt), ab=V.sub(b,a), ac=V.sub(c,a);
      const det=ab[0]*ac[1]-ab[1]*ac[0];
      if (Math.abs(det)>1e-12) return {triangle,vertices,a,ab,ac,det};
    }
    function anchorAt(face,uv) {
      if (!face) return;
      const {triangle,vertices,a,ab,ac,det}=face;
      const x=uv[0]-a[0], y=uv[1]-a[1];
      const b=(x*ac[1]-y*ac[0])/det, c=(ab[0]*y-ab[1]*x)/det;
      const raw=[1-b-c,b,c];
      if (raw.some(w=>w < -1e-7)) return;
      const weights=raw.map(w=>Math.max(0,w)), sum=weights.reduce((total,w)=>total+w,0);
      return {triangle,vertices,weights:weights.map(w=>w/sum),ab,ac,det};
    }
    function bind(uv,triangle) {
      if (triangle!==undefined) {
        if (!Number.isSafeInteger(triangle) || triangle<0 || triangle>=mesh.triangles)
          throw new RangeError('A mesh UV root needs an authored triangle index');
        return anchorAt(triangleAt(triangle),uv);
      }
      if (!lookup) lookup=spatial.pointIndex(Array.from({length:mesh.triangles},(_,i)=>{
        const face=triangleAt(i);
        if (!face) return;
        const box=spatial.boxOf(face.vertices.map(uvAt));
        return {...face,bounds:spatial.expand(box,1e-7)};
      }).filter(Boolean));
      let result;
      lookup([uv[0],uv[1],0],face=>{
        if (!result || face.triangle<result.triangle) result=anchorAt(face,uv) ?? result;
      });
      return result;
    }
    function sample(anchor) {
      const {positions}=data, {vertices,weights,ab:du,ac:dv,det,triangle}=anchor;
      const [a,b,c]=vertices.map(i=>positions.subarray(i*3,i*3+3)), ab=V.sub(b,a), ac=V.sub(c,a);
      const normal=V.cross(ab,ac), area=V.len(normal);
      if (area<=1e-12*Math.max(1e-6,V.len(ab)*V.len(ac))) return;
      return {p:[0,1,2].map(k=>a[k]*weights[0]+b[k]*weights[1]+c[k]*weights[2]),n:V.mul(normal,1/area),
        tangent:V.mul(V.sub(V.mul(ab,dv[1]),V.mul(ac,du[1])),1/det),
        bitangent:V.mul(V.sub(V.mul(ac,du[0]),V.mul(ab,dv[0])),1/det),
        triangle,weights:weights.slice()};
    }
    const chart=Object.freeze({bind,sample,revision:()=>data.revision});
    charts.set(mesh,chart);
    return chart;
  }

  function skin(mesh, influences) {
    const {rest}=read(mesh);
    if (!Array.isArray(influences) || influences.length!==mesh.vertices)
      throw new RangeError('Mesh skinning needs one influence row per vertex');
    let lastBone=0;
    const weights=Array.from(influences,row=>{
      const pairs=Number.isSafeInteger(row) ? [[row,1]] : row;
      if (!Array.isArray(pairs) || !pairs.length || pairs.length>4 || !pairs.every(pair=>
        Array.isArray(pair) && pair.length===2 && Number.isSafeInteger(pair[0]) && pair[0]>=0 && unit(pair[1])))
        throw new RangeError('Mesh skin weights need one to four [bone, weight] pairs');
      const total=pairs.reduce((sum,[bone,weight])=>{
        lastBone=Math.max(lastBone,bone);
        return sum+weight;
      },0);
      if (!total) throw new RangeError('Mesh skin weights need a positive sum');
      return pairs.map(([bone,weight])=>[bone*12,weight/total]);
    });
    const positions=new Float32Array(rest.length);
    return Object.freeze({mesh,pose(matrices) {
      if (!array(matrices) || matrices.length%12 || matrices.length<(lastBone+1)*12 || !every(matrices,Number.isFinite))
        throw new RangeError('Mesh skinning needs a finite twelve-value matrix per bone');
      for (const [i,row] of weights.entries()) {
        const p=i*3, x=rest[p], y=rest[p+1], z=rest[p+2];
        for (let k=0;k<3;k++) {
          let next=0;
          for (const [bone,weight] of row) {
            const at=bone+k*3;
            next+=weight*(matrices[at]*x+matrices[at+1]*y+matrices[at+2]*z+matrices[bone+9+k]);
          }
          positions[p+k]=next;
        }
      }
      return pose(mesh,positions);
    }});
  }

  function list(world, enabled, additional=[]) {
    if (enabled===false) return [];
    const authored=world.meshes;
    if (authored!==undefined && !Array.isArray(authored))
      throw new RangeError('A scene needs an array of indexed meshes');
    const meshes=additional.length ? (authored??[]).concat(additional) : authored??[];
    if (meshes.length > 32)
      throw new RangeError('A scene supports up to 32 indexed meshes');
    const ids = new Set();
    let triangles = 0, texels = 0;
    for (const mesh of meshes) {
      const {layer} = read(mesh);
      triangles += mesh.triangles;
      texels += layer.width * layer.height;
      if (ids.has(mesh.id) || triangles > 500000 || texels > 16 * 1024 * 1024)
        throw new RangeError('Scene meshes need distinct IDs and must fit the scene triangle and texture budgets');
      ids.add(mesh.id);
    }
    return meshes;
  }

  function layers(world, enabled, additional) {
    return list(world,enabled,additional).map(mesh => read(mesh).layer);
  }

  function proxyPlan(world, enabled, toleranceOverride) {
    const definition = world.splatDepthProxies;
    if (enabled === false || definition === false || definition === undefined) return null;
    if (!definition || !Array.isArray(definition.meshes))
      throw new TypeError('Splat depth proxies need an object with a mesh list');
    const tolerance = toleranceOverride ?? definition.tolerance ?? .03;
    if (!Number.isFinite(tolerance) || tolerance < 0)
      throw new RangeError('Splat proxy depth tolerance must be a finite nonnegative distance');
    const meshes = list(definition);
    return meshes.length ? {meshes:meshes.map(read), tolerance} : null;
  }

  function intersect(mesh, {origin,direction,maxDistance}, {V,rayBox,restSpace=false,candidates,pigment=false}, accept) {
    const data=read(mesh), {rest,uvs,indices,materials,faceMaterials,regions,layer} = data;
    const positions=restSpace ? rest : data.positions;
    if (rayBox(restSpace ? data.restBounds : data.bounds,origin,direction,maxDistance) === null) return null;
    let closest = null, closestMaterial = Infinity, stop = maxDistance;
    const count=candidates?.length ?? indices.length/3;
    for (let i=0;i<count;i++) {
      const offset=(candidates ? candidates[i] : i)*3;
      const a = indices[offset], b = indices[offset+1], c = indices[offset+2];
      const p = positions.subarray(a*3,a*3+3);
      const ab = V.sub(positions.subarray(b*3,b*3+3),p), ac = V.sub(positions.subarray(c*3,c*3+3),p);
      const h = V.cross(direction,ac), det = V.dot(ab,h);
      const epsilon=1e-12 * V.len(ab) * V.len(ac);
      if (restSpace ? det<=epsilon : Math.abs(det)<=epsilon) continue;
      const delta = V.sub(origin,p), v = V.dot(delta,h)/det;
      if (v < -1e-7 || v > 1+1e-7) continue;
      const q = V.cross(delta,ab), w = V.dot(direction,q)/det, u = 1-v-w;
      if (w < -1e-7 || u < -1e-7) continue;
      const distance = V.dot(ac,q)/det;
      const triangle = offset/3, slot = faceMaterials?.[triangle] ?? 0;
      if (distance <= 0 || distance > stop || distance === stop && slot >= closestMaterial) continue;
      const interpolate = (data,size) => Array.from({length:size},(_,k) =>
        data[a*size+k]*u + data[b*size+k]*v + data[c*size+k]*w);
      const uv = interpolate(uvs,2).map(n => Math.max(0,Math.min(1,n)));
      const region = regions[slot];
      const x = region.x+Math.floor(.5+(region.width-1)*uv[0]);
      const y = region.y+Math.floor(.5+(region.height-1)*uv[1]);
      const at=(y*layer.width+x)*4;
      if (layer.pixels[at+3] < 128) continue;
      const normal = V.norm(V.cross(ab,ac).map(n => n*Math.sign(det)));
      const hit = { kind:'mesh', index:-1, id:mesh.objectId, mesh:mesh.id, triangle,
        target:{object:mesh.objectId,material:materials[slot],...(mesh.partId && {entity:mesh.objectId,part:mesh.partId})},
        distance, point:V.mad(origin,direction,distance), normal, uv, restPosition:interpolate(rest,3), alpha:1, solid:true,
        ...(pigment && {pigment:layer.pixels[at]*65536+layer.pixels[at+1]*256+layer.pixels[at+2]}),
        ...(restSpace && {vertices:[a,b,c],weights:[u,v,w]}) };
      if (accept && !accept(hit)) continue;
      closest = hit;
      closestMaterial = slot;
      stop = distance;
    }
    return closest;
  }

  function rayQuery(mesh,{V,procedural:{spatial}}) {
    const {positions,indices,revision}=read(mesh), cached=rayQueries.get(mesh);
    if(cached?.revision===revision)return cached.trace;
    const position=i=>positions.subarray(i*3,i*3+3);
    const lookup=spatial.pointIndex(Array.from({length:mesh.triangles},(_,triangle)=>{
      const at=triangle*3;
      return {triangle,bounds:spatial.expand(spatial.boxOf([
        position(indices[at]),position(indices[at+1]),position(indices[at+2])
      ]),1e-7)};
    }));
    const trace=(ray,accept)=>{
      const candidates=[];
      lookup.ray(ray.origin,ray.direction,ray.maxDistance,row=>candidates.push(row.triangle));
      candidates.sort((a,b)=>a-b);
      return candidates.length ? intersect(mesh,ray,{V,rayBox:spatial.rayBox,candidates,pigment:true},accept) : null;
    };
    rayQueries.set(mesh,{revision,trace});
    return trace;
  }

  function projector(mesh,{at,normal,up,size,depth,minFacing=.25},{V,procedural:{spatial}}) {
    const {rest,indices}=read(mesh), right=V.cross(up,normal), faces=[];
    const points=Array.from({length:rest.length/3},(_,i)=>{
      const p=V.sub(rest.subarray(i*3,i*3+3),at);
      return [V.dot(p,right),V.dot(p,up),V.dot(p,normal)];
    });
    for(let f=0;f<indices.length/3;f++) {
      const a=points[indices[f*3]],b=points[indices[f*3+1]],c=points[indices[f*3+2]];
      const box=spatial.boxOf([a,b,c]);
      if (box.min[2]>depth || box.max[2]<-depth ||
          size.some((n,k)=>box.min[k]>n*.5 || box.max[k]<-n*.5)) continue;
      box.min[2]=box.max[2]=0;
      faces.push({f,bounds:spatial.expand(box,1e-7)});
    }
    const index=spatial.pointIndex(faces), direction=V.mul(normal,-1);
    return point=>{
      const p=V.sub(point,at), candidates=[];
      index([V.dot(p,right),V.dot(p,up),0],row=>candidates.push(row.f));
      candidates.sort((a,b)=>a-b);
      return intersect(mesh,{origin:V.mad(point,normal,depth),direction,maxDistance:depth*2},
        {V,rayBox:spatial.rayBox,restSpace:true,candidates},hit=>{
          const cosine=V.dot(hit.normal,normal);
          return cosine>0 && cosine>=minFacing;
        });
    };
  }

  function sampleProjection(mesh, {vertices,weights}, {V}) {
    const {positions}=read(mesh), [a,b,c]=vertices.map(i=>positions.subarray(i*3,i*3+3));
    const area=V.cross(V.sub(b,a),V.sub(c,a));
    if (V.len(area)<=1e-12) return null;
    return {p:[0,1,2].map(k=>a[k]*weights[0]+b[k]*weights[1]+c[k]*weights[2]),n:V.norm(area)};
  }

  function clipUV(mesh, {min,max,material,clip:limit}) {
    const valid=(min,max)=>[min,max].every(point=>Array.isArray(point)&&point.length===2&&Array.from(point).every(Number.isFinite)) &&
        max.every((value,k)=>value-min[k]>=1e-8);
    if (!valid(min,max) || limit!==undefined&&!valid(limit?.min,limit?.max))
      throw new RangeError('Mesh UV clipping needs a finite ordered rectangle');
    const {indices,uvs,rest,materials,faceMaterials}=read(mesh), slot=materials.indexOf(material);
    if (material!==undefined && slot<0) throw new RangeError('Unknown mesh material '+material);
    const points=[], texture=[], triangles=[], anchors=[];
    const lo=limit ? min.map((n,k)=>Math.max(n,limit.min[k])) : min;
    const hi=limit ? max.map((n,k)=>Math.min(n,limit.max[k])) : max;
    function clip(polygon,axis,edge,sign) {
      const result=[];
      for (let i=0;i<polygon.length;i++) {
        const a=polygon[i], b=polygon[(i+1)%polygon.length];
        const da=(a.uv[axis]-edge)*sign, db=(b.uv[axis]-edge)*sign;
        if (da>=0) result.push(a);
        if ((da<0)!==(db<0) && da!==0 && db!==0) {
          const f=da/(da-db), mix=(n,k)=>n+(b.uv[k]-n)*f;
          result.push({uv:a.uv.map(mix),weights:a.weights.map((n,k)=>n+(b.weights[k]-n)*f)});
        }
      }
      return result;
    }
    const count=hi.every((n,k)=>n>lo[k]) ? mesh.triangles : 0;
    for (let face=0;face<count;face++) {
      if (slot>=0 && (faceMaterials?.[face]??0)!==slot) continue;
      const vertices=Array.from(indices.subarray(face*3,face*3+3));
      let polygon=vertices.map((i,j)=>({uv:[uvs[i*2],uvs[i*2+1]],weights:[0,1,2].map(k=>Number(j===k))}));
      if ([0,1].some(axis=>polygon.every(({uv})=>uv[axis]<lo[axis]) || polygon.every(({uv})=>uv[axis]>hi[axis])))
        continue;
      for (let k=0;k<2;k++) polygon=clip(clip(polygon,k,lo[k],1),k,hi[k],-1);
      if (polygon.length<3) continue;
      const root=anchors.length, [a]=polygon;
      const faces=[];
      for (let i=1;i<polygon.length-1;i++) {
        const [b,c]=polygon.slice(i,i+2).map(row=>row.uv);
        const [x,y]=a.uv;
        if (Math.abs((b[0]-x)*(c[1]-y)-(b[1]-y)*(c[0]-x))>1e-14) faces.push(root,root+i,root+i+1);
      }
      if (!faces.length) continue;
      if (triangles.length+faces.length>3*8192) throw new RangeError('A UV brush exceeds 8192 clipped mesh triangles');
      triangles.push(...faces);
      for (const {uv,weights} of polygon) {
        anchors.push({vertices,weights});
        texture.push(...uv.map((n,k)=>Math.max(0,Math.min(1,(n-min[k])/(max[k]-min[k])))));
        points.push(...[0,1,2].map(k=>vertices.reduce((sum,i,j)=>sum+rest[i*3+k]*weights[j],0)));
      }
    }
    return {anchors, points:Float32Array.from(points), uvs:Float32Array.from(texture), triangles:Uint32Array.from(triangles)};
  }

  return Object.freeze({create,fromObjectTexels,updateObjectTexels,scanFrame:Mips.scanFrame,pose,inspectUV,uvAnchors,skin,list,layers,layer:mesh=>read(mesh).layer,
    simulationFrame:(...args)=>simulationAPI().frame(...args),depthProxy,proxyPlan,intersect,rayQuery,projector,sampleProjection,clipUV,revision:mesh=>read(mesh).revision});
})();
if (typeof module !== 'undefined') module.exports = SceneMeshes;
