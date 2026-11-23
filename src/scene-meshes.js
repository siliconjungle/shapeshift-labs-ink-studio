/* Indexed, UV-mapped triangle assets for the shared cutout surface renderer. */
const SceneMeshes = (() => {
  const Sprite = typeof SpriteSurface === 'undefined' ? require('./sprite-surface.js') : SpriteSurface;
  const state = Symbol.for('ink-studio.sceneMesh');
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

  function materialOf({ id, color = 0xffffff, texture, normal, alphaCutoff = .5, sampling } = {}) {
    const { width = 1, height = 1, pixels } = texture ?? {};
    if (!name(id) || !Number.isInteger(color) || color < 0 || color > 0xffffff || !unit(alphaCutoff))
      throw new RangeError('Mesh materials need an ID, RGB24 tint, and alpha cutoff in [0,1]');
    if (![width,height].every(n => Number.isInteger(n) && n > 0 && n <= maxEdge) ||
        texture !== undefined && (!bytes(pixels) || pixels.length !== width * height * 4))
      throw new RangeError('Mesh textures need top-down RGBA8 pixels and dimensions up to 2048');
    if (normal !== undefined && (!bytes(normal) || normal.length !== width * height * 4))
      throw new RangeError('Mesh normal maps need matching top-down RGBA8 pixels');
    const tint = [color >> 16, color >> 8 & 255, color & 255];
    function paint(x, y) {
      if (!pixels) return color;
      const at = (y * width + x) * 4;
      if (pixels[at+3] / 255 < alphaCutoff) return;
      let ink = 0;
      for (let c = 0; c < 3; c++) ink = ink * 256 + Math.round(pixels[at+c] * tint[c] / 255);
      return ink;
    }
    return { id, width, height, paint, normal, sampling };
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
    const drawIndices = new Uint32Array(source.length);
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
        regions[index], {id:material.id, objectId, partId, materialId:material.id, sampling:material.sampling});
    }
    const layer = atlas.finish();
    layer.sceneMeshId = id;
    const data = { positions, rest:positions, uvs, indices:source, drawIndices, layer, regions,
      materials:rows.map(row => row.id), faceMaterials:faceMaterials && Uint8Array.from(faceMaterials), bounds:bounds(positions) };
    return Object.freeze({ id, objectId, partId, vertices, triangles,
      materials:Object.freeze(tiles.map(tile=>tile.id).sort()), [state]:data });
  }

  function depthProxy({id,positions,indices} = {}) {
    const points = positionsOf(positions);
    return create({id,positions:points,indices,uvs:new Float32Array(points.length / 3 * 2),
      materials:[{id:'proxy'}]});
  }

  function read(mesh) {
    if (!mesh?.[state]) throw new TypeError('Use SceneMeshes.create for indexed scene geometry');
    return mesh[state];
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
    return mesh;
  }

  function list(world, enabled) {
    const meshes = world.meshes;
    if (enabled === false || meshes === undefined) return [];
    if (!Array.isArray(meshes) || meshes.length > 32)
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

  function layers(world, enabled) {
    return list(world,enabled).map(mesh => read(mesh).layer);
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

  function intersect(mesh, {origin,direction,maxDistance}, {V,rayBox}, accept) {
    const {positions,rest,uvs,indices,materials,faceMaterials,regions,layer,bounds} = read(mesh);
    if (rayBox(bounds,origin,direction,maxDistance) === null) return null;
    let closest = null, closestMaterial = Infinity, stop = maxDistance;
    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = indices[offset], b = indices[offset+1], c = indices[offset+2];
      const p = positions.subarray(a*3,a*3+3);
      const ab = V.sub(positions.subarray(b*3,b*3+3),p), ac = V.sub(positions.subarray(c*3,c*3+3),p);
      const h = V.cross(direction,ac), det = V.dot(ab,h);
      if (Math.abs(det) <= 1e-12 * V.len(ab) * V.len(ac)) continue;
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
      if (layer.pixels[(y*layer.width+x)*4+3] < 128) continue;
      const normal = V.norm(V.cross(ab,ac).map(n => n*Math.sign(det)));
      const hit = { kind:'mesh', index:-1, id:mesh.objectId, mesh:mesh.id, triangle,
        target:{object:mesh.objectId,material:materials[slot],...(mesh.partId && {entity:mesh.objectId,part:mesh.partId})},
        distance, point:V.mad(origin,direction,distance), normal, uv, restPosition:interpolate(rest,3), alpha:1, solid:true };
      if (accept && !accept(hit)) continue;
      closest = hit;
      closestMaterial = slot;
      stop = distance;
    }
    return closest;
  }

  return Object.freeze({create,pose,list,layers,layer:mesh=>read(mesh).layer,depthProxy,proxyPlan,intersect});
})();
if (typeof module !== 'undefined') module.exports = SceneMeshes;
