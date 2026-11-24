// Resolve source geometry and registered appearance in receiver rest space.
const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const glb = require('./glb-file.js');

const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const clamp = n => Math.max(0, Math.min(1, n));
const name = value => typeof value === 'string' && Boolean(value.trim());
const list = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(Number.isFinite);

function image(input) {
  if (!input) return;
  if (input.bytes) {
    if (input.mimeType && input.mimeType !== 'image/png') throw new TypeError('Cage material images need PNG or decoded bytes');
    const { w:width,h:height }=PNG.layout(input.bytes);
    if (width>4096 || height>4096) throw new RangeError('Cage material images are limited to 4096 texels per axis');
    const { w, h, data, max } = PNG.raster(input.bytes);
    return { width: w, height: h, data, max, channels: 4 };
  }
  const { width, height, pixels, channels = 4 } = input;
  if (![width,height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096) || ![3,4].includes(channels) ||
      !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width*height*channels)
    throw new RangeError('Cage material images need matching RGB8 or RGBA8 data');
  return { width, height, data: pixels, max: 255, channels };
}

function texel(texture, uv) {
  const axis = (i, wrap) => {
    const u = uv[i];
    if (wrap === 10497) return u - Math.floor(u);
    if (wrap === 33648) return 1 - Math.abs(1 - (u % 2 + 2) % 2);
    return clamp(u);
  };
  const { width, height, data, channels, max, wrapS, wrapT } = texture;
  const x = Math.min(width - 1, Math.floor(axis(0, wrapS) * width));
  const y = Math.min(height - 1, Math.floor(axis(1, wrapT) * height));
  const i = (y*width + x)*channels;
  return [data[i]/max, data[i+1]/max, data[i+2]/max, channels === 4 ? data[i+3]/max : 1];
}

function gltfSource(file, K) {
  const bytes = fs.readFileSync(file);
  const container = /\.glb$/i.test(file) ? glb.readGlb(bytes) : { gltf: JSON.parse(bytes), bin: undefined };
  const { gltf, bin } = glb.readGlb(glb.embed(container.gltf, file, container.bin));
  const cached = new Map();
  function texture(ref) {
    if (!ref) return;
    if ((ref.texCoord ?? 0) !== 0 || ref.extensions?.KHR_texture_transform)
      throw new TypeError('Cage source textures need untransformed TEXCOORD_0');
    if (!cached.has(ref.index)) {
      const row = gltf.textures?.[ref.index], asset = gltf.images?.[row?.source], block = gltf.bufferViews?.[asset?.bufferView];
      if (asset?.mimeType !== 'image/png' || !block) throw new TypeError('Cage source textures need PNG images');
      const start = block.byteOffset ?? 0, info = image({bytes:bin.subarray(start,start+block.byteLength),mimeType:asset.mimeType});
      const { wrapS = 10497, wrapT = 10497 } = gltf.samplers?.[row.sampler] ?? {};
      cached.set(ref.index, { ...info, wrapS, wrapT });
    }
    return cached.get(ref.index);
  }
  const materials = [{ color:[1,1,1], roughness:1 }];
  for (const row of gltf.materials ?? []) {
    const pbr = row.pbrMetallicRoughness ?? {}, base = pbr.baseColorFactor ?? [1,1,1,1];
    materials.push({
      name:row.name, color:base.slice(0,3), alpha:base[3],
      roughness:pbr.roughnessFactor ?? 1, metallic:pbr.metallicFactor ?? 1,
      emission:(row.emissiveFactor ?? [0,0,0]).map(n=>n*(row.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1)),
      ...(row.alphaMode === 'MASK' && { alphaCutoff:row.alphaCutoff ?? .5 }),
      images:{ pigment:texture(pbr.baseColorTexture), normal:texture(row.normalTexture),
        surface:texture(pbr.metallicRoughnessTexture), emission:texture(row.emissiveTexture) },
      normalScale:row.normalTexture?.scale ?? 1
    });
  }
  const byFace = [], vertexColors = [], vertexNormals = [], mirrored = new Set();
  const { V } = K;
  const raw = K.mesh.gltf(gltf,[bin],{ attributes:true,visitPrimitive(primitive, visit) {
    const { firstVertex,vertexCount,firstFace,faceCount,accessor,matrix } = visit;
    const values = key => primitive.attributes[key] === undefined ? undefined : accessor(primitive.attributes[key]);
    const color = values('COLOR_0'), normal = values('NORMAL');
    const [x,y,z] = [0,4,8].map(i=>matrix.slice(i,i+3));
    const dual = [V.cross(y,z),V.cross(z,x),V.cross(x,y)], flip = V.dot(x,dual[0])<0;
    for (let i=0;i<faceCount;i++) {
      byFace[firstFace+i] = (primitive.material ?? -1)+1;
      if (flip) mirrored.add(firstFace+i);
    }
    for (let i=0;i<vertexCount;i++) {
      if (color) vertexColors[firstVertex+i] = [0,1,2].map(k=>color.get(i,k)/(color.ints ? color.top : 1));
      if (normal) {
        const n = [0,1,2].map(k=>normal.get(i,k));
        vertexNormals[firstVertex+i] = V.norm([0,1,2].map(k=>V.dot(n,dual.map(d=>d[k]))*(flip?-1:1)));
      }
    }
  }});
  const model = K.model.fromMesh(raw), uvs = raw.uvs ?? raw.uvFaces;
  return { ...model, materials, faceMaterials:byFace, colors:vertexColors, normals:vertexNormals,
    faces:model.faces.map((row,i)=>mirrored.has(i)?row.slice().reverse():row),
    uvs:uvs?.map((row,i)=>row && mirrored.has(i)?row.slice().reverse():row) };
}

function materialDefinitions(rows, directory) {
  if (rows === undefined) return;
  if (!Array.isArray(rows)) throw new TypeError('Cage source materials need a list of named slots');
  return rows.map(material => {
    const { texture } = material;
    return { ...material, ...(typeof texture === 'string' &&
      { texture:{bytes:fs.readFileSync(path.resolve(directory,texture)),mimeType:'image/png'} }) };
  });
}

function meshSource(source, directory, studio, K) {
  if ((source.file === undefined) === (source.model === undefined))
    throw new TypeError('A mesh or scan cage source needs one file or model');
  const file = source.file && path.resolve(directory,source.file);
  if (file && /\.(gltf|glb)$/i.test(file)) return gltfSource(file,K);
  if (file && /\.obj$/i.test(file)) {
    const raw = studio.readMesh(file,{attributes:true}), mesh = K.model.fromMesh(raw);
    mesh.materials = mesh.materials.map(row=>({...row,color:row.color.map(linear)}));
    if (mesh.colors) mesh.colors = mesh.colors.map(row=>row.map(linear));
    return mesh;
  }
  const raw = file ? JSON.parse(fs.readFileSync(file,'utf8')) : source.model;
  if (raw?.format === 'ink-studio/mesh-topology')
    return K.model.fromTopology(raw,{materials:materialDefinitions(source.materials,directory)});
  if (!raw || !Array.isArray(raw.points) || !Array.isArray(raw.faces))
    throw new TypeError('Cage source needs retained topology, indexed model geometry, OBJ, glTF, or GLB');
  const materials = materialDefinitions(source.materials ?? raw.materials,directory);
  return { ...raw, ...(materials && {materials}) };
}

function fieldSource(source, directory, K) {
  const { file,volume,field,material } = source;
  if ([file,volume,field].filter(value=>value!==undefined).length !== 1)
    throw new TypeError('An SDF cage source needs one diorama file, volume or signed field');
  if (file) {
    const doc = JSON.parse(fs.readFileSync(path.resolve(directory,file),'utf8'));
    return K.model.cageSource(K.diorama.brushField(doc));
  }
  if (volume) return { sdf:K.procedural.sculptMasks.field(volume), sampleSurface:()=>material,
    maskNames:Object.keys(material?.masks ?? {}) };
  if (typeof field?.sdf !== 'function') throw new TypeError('An SDF source needs a signed distance function');
  return field;
}

function meshMaterial(row, normal, weights, point, model, { V }) {
  const material = model.sampleSurface?.(point,normal,row.face) ?? row.material;
  const uv = row.uvs && [0,1].map(k=>weights.reduce((sum,w,i)=>sum+row.uvs[i][k]*w,0));
  const maps = row.material.images;
  const pigment = uv && maps.pigment && texel(maps.pigment,uv);
  if ((pigment ? pigment[3] : 1)*(row.material.alpha ?? 1) < (row.material.alphaCutoff ?? 0)) return null;
  let color = material.color ?? [.45,.45,.45], bump = material.normal ?? normal;
  if (model.colors && row.ids.some(id=>model.colors[id])) {
    const tint = [0,1,2].map(k=>weights.reduce((sum,w,i)=>sum+(model.colors[row.ids[i]]?.[k] ?? 1)*w,0));
    color = color.map((n,i)=>n*tint[i]);
  }
  if (pigment) color = color.map((n,i)=>n*linear(pigment[i]));
  const mapped = uv && maps.normal && row.tangent && texel(maps.normal,uv);
  if (mapped) {
    const [x,y,z] = mapped.map(n=>2*n-1), scale = row.material.normalScale ?? 1;
    const tangent = V.norm(V.mad(row.tangent,normal,-V.dot(row.tangent,normal)),V.perp(normal));
    const bitangent = V.mul(V.cross(normal,tangent),V.dot(V.cross(normal,tangent),row.bitangent)<0?-1:1);
    bump = V.norm(V.mad(V.mad(V.mul(normal,z),tangent,x*scale),bitangent,y*scale),normal);
  }
  const surface = uv && maps.surface && texel(maps.surface,uv);
  const glow = uv && maps.emission && texel(maps.emission,uv);
  return { ...material, color, normal:bump,
    ...(surface && {roughness:(material.roughness ?? 1)*surface[1],metallic:(material.metallic ?? 1)*surface[2]}),
    ...(glow && {emission:(material.emission ?? [1,1,1]).map((n,i)=>n*linear(glow[i]))}) };
}

module.exports = { meshSource, fieldSource, image, meshMaterial, name, list };
