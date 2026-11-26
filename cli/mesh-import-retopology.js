const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Assets = require('./asset-files.js');
const GLB = require('./glb-file.js');
const PNG = require('./png.js');
const { publish } = require('./visual-sweep.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function pigment(bytes, mimeType) {
  if (mimeType !== 'image/png') throw new TypeError('Imported pigment needs a PNG atlas');
  try {
    const { w, h } = PNG.layout(bytes, true);
    if (w > 1024 || h > 1024) throw new RangeError('Indexed pigment exceeds its atlas budget');
    const { value, alpha, palette } = PNG.indexedRaster(bytes);
    return { width: w, height: h, indices: value.data, palette, coverage: alpha.data };
  } catch (error) {
    if (!/needs a palette-indexed PNG/.test(error.message)) throw error;
    const { w, h, bitDepth } = PNG.nativeLayout(bytes);
    if (w > 2048 || h > 2048 || bitDepth > 8) throw new RangeError('Imported pigment needs a byte atlas within its size budget');
    return { width: w, height: h, pixels: PNG.raster(bytes).data };
  }
}

function gltfSource(file, K, input, recordFile) {
  const original = /\.glb$/i.test(file) ? GLB.readGlb(input) : { gltf: JSON.parse(input), bin: undefined };
  const { gltf, bin } = GLB.readGlb(GLB.embed(original.gltf, file, original.bin, recordFile));
  const { V } = K;
  const normals = [], weights = [], primitiveSlots = [], mirrored = new Set();
  let skin, rigid = false;
  const mesh = K.mesh.gltf(gltf, [bin], { attributes: true, allUVSets: true, visitPrimitive(primitive, visit) {
    const { node, firstVertex, vertexCount, firstFace, faceCount, accessor, matrix } = visit;
    if (!faceCount) return;
    const { JOINTS_0, WEIGHTS_0, JOINTS_1, WEIGHTS_1, NORMAL } = primitive.attributes;
    if (JOINTS_1 !== undefined || WEIGHTS_1 !== undefined) throw new RangeError('Imported skin needs at most four joint influences');
    if (node.skin === undefined && (JOINTS_0 !== undefined || WEIGHTS_0 !== undefined) ||
        node.skin !== undefined && (JOINTS_0 === undefined || WEIGHTS_0 === undefined))
      throw new RangeError('Imported skin needs matching joint and weight streams');
    if (node.skin === undefined) rigid = true;
    else {
      const names = gltf.skins[node.skin]?.joints.map(index => gltf.nodes[index]?.name ?? 'joint-' + index);
      if (!names?.length || new Set(names).size !== names.length ||
          skin && JSON.stringify(skin.joints) !== JSON.stringify(names))
        throw new RangeError('Use one named joint roster in an imported mesh');
      skin ??= { joints: names };
      const joints = accessor(JOINTS_0), values = accessor(WEIGHTS_0);
      if (joints.n !== vertexCount || values.n !== vertexCount || joints.w !== 4 || values.w !== 4)
        throw new RangeError('Invalid imported skin attribute size');
      for (let i = 0; i < vertexCount; i++) {
        const row = new Map();
        for (let k = 0; k < 4; k++) {
          const joint = joints.get(i, k), weight = values.get(i, k);
          if (!Number.isInteger(joint) || !names[joint] || !Number.isFinite(weight) || weight < 0 || weight > 1)
            throw new RangeError('Invalid imported joint influence');
          if (weight) row.set(names[joint], (row.get(names[joint]) ?? 0) + weight);
        }
        if (!row.size) throw new RangeError('Imported skin needs a nonzero weight at every vertex');
        weights[firstVertex + i] = Object.fromEntries(row);
      }
    }
    primitiveSlots.push([firstFace, faceCount, primitive.material]);
    const [x, y, z] = [0, 4, 8].map(i => matrix.slice(i, i + 3));
    const normalBasis = [V.cross(y, z), V.cross(z, x), V.cross(x, y)], flip = V.dot(x, normalBasis[0]) < 0;
    if (flip) for (let f = firstFace; f < firstFace + faceCount; f++) mirrored.add(f);
    if (NORMAL !== undefined) {
      const normal = accessor(NORMAL);
      if (normal.n !== vertexCount || normal.w !== 3) throw new RangeError('Invalid imported normal attribute size');
      for (let i = 0; i < vertexCount; i++) {
        const value = [0, 1, 2].map(k => normal.get(i, k));
        normals[firstVertex + i] = V.norm([0, 1, 2].map(k => V.dot(value, normalBasis.map(axis => axis[k])) * (flip ? -1 : 1)));
      }
    }
  } });
  if (rigid && skin) throw new RangeError('Separate rigid and skinned primitives before importing a mesh cage');
  if (mesh.skipped || mesh.uvBindingConflicts?.length)
    throw new RangeError('Imported mesh needs triangles and consistent material UV bindings');
  const reverse = (rows, face) => rows && mirrored.has(face) ? rows.slice().reverse() : rows;
  mesh.cornerNormals = Array.from({ length: mesh.tri.length / 3 }, (_, i) =>
    Array.from(mesh.tri.slice(i * 3, i * 3 + 3), vertex => normals[vertex]));
  for (const key of ['uvs', 'uvFaces', 'cornerNormals']) if (mesh[key]) mesh[key] = mesh[key].map(reverse);
  for (const rows of Object.values(mesh.uvSets ?? {})) for (const i of mirrored) rows[i] = reverse(rows[i], i);
  for (const i of mirrored) [mesh.tri[i * 3], mesh.tri[i * 3 + 2]] = [mesh.tri[i * 3 + 2], mesh.tri[i * 3]];
  for (const [face, faceCount, index] of primitiveSlots) {
    const row = gltf.materials?.[index], ref = row?.pbrMetallicRoughness?.baseColorTexture;
    const material = mesh.mats[mesh.tmat[face]];
    if (!ref) continue;
    const set = ref.texCoord ?? 0;
    const coordinates = set ? mesh.uvSets?.[set] : mesh.uvs ?? mesh.uvFaces;
    for (let i = face; i < face + faceCount; i++)
      if (!coordinates?.[i]) throw new RangeError('Imported pigment needs registered triangle UVs');
    if (material.texture) continue;
    if (ref.extensions?.KHR_texture_transform) throw new RangeError('Bake the imported pigment UV transform before retopology');
    const asset = gltf.images?.[gltf.textures?.[ref.index]?.source], view = gltf.bufferViews?.[asset?.bufferView];
    if (!view) throw new RangeError('Imported pigment needs an embedded PNG image');
    const begin = view.byteOffset ?? 0;
    material.texture = { bytes: bin.subarray(begin, begin + view.byteLength), mimeType: asset.mimeType };
  }
  return { mesh, ...(skin && { skin, weights: Array.from({ length: mesh.pos.length / 3 }, (_, i) => weights[i]) }) };
}

function imported(file, kit, input, recordFile) {
  if (/\.json$/i.test(file)) {
    const document = JSON.parse(input), slots = document.format === 'ink-studio/mesh-topology' ?
      [...new Set(document.faces.map(row => row.material))] : document.materials ?? ['default'];
    return { document: { id: path.basename(file), ...document }, materials: slots.map(id => ({ id })) };
  }
  const { mesh, skin, weights } = /\.(glb|gltf)$/i.test(file) ? gltfSource(file, kit.KIT, input, recordFile) :
    { mesh: require('../index.js').readMesh(file, { attributes: true, strictTextures: true, onFile: name => recordFile(path.resolve(name)) }) };
  const uv = mesh.uvs ?? mesh.uvFaces;
  if (/\.obj$/i.test(file)) for (const [face, slot] of mesh.tmat.entries()) {
    if (mesh.mats[slot].texture && !uv?.[face]) throw new RangeError('Imported pigment needs registered triangle UVs');
  }
  const names = new Set();
  const materials = mesh.mats.map(({ name, rgb, texture }, i) => {
    let id = name?.trim() || 'material-' + i;
    while (names.has(id)) id += '/' + i;
    names.add(id);
    return { id, color: rgb.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255))
      .reduce((sum, n) => sum * 256 + n, 0), ...(texture && { texture: pigment(texture.bytes, texture.mimeType) }) };
  });
  const vertexColors = mesh.vertexTints?.flatMap(row => row?.slice(0, 3) ?? [1, 1, 1]) ?? mesh.vcol;
  const cornerAttributes = mesh.vertexTints?.some(row => row?.length === 4) ?
    Array.from({ length: mesh.tri.length / 3 }, (_, i) => Array.from(mesh.tri.slice(i * 3, i * 3 + 3),
      vertex => ({ pigmentAlpha: mesh.vertexTints[vertex]?.[3] ?? 1 }))) : undefined;
  return { document: { id: path.basename(file), positions: mesh.pos, indices: mesh.tri, faceMaterials: mesh.tmat,
    materials: materials.map(row => row.id), ...(vertexColors && { vertexColors }), cornerAttributes,
    cornerUVs: uv, cornerNormals: mesh.cornerNormals, uvSets: mesh.uvSets, uvBindings: mesh.uvBindings,
    ...(skin && { skin, weights }) }, materials };
}

function command(action, file, request, rest, opt, kit) {
  if (!file || rest.length || Object.keys(opt).some(key => key !== 'out') ||
      opt.out !== undefined && (typeof opt.out !== 'string' || !opt.out.trim()) || action === 'limit-surface' && !request)
    throw new TypeError('Use mesh-topology remesh-import <mesh> [settings.json] --out directory or limit-surface <mesh.json> <samples.json> --out report.json');
  const { meshTopology: api } = kit.KIT;
  const destination = opt.out && path.resolve(opt.out);
  const settings = request ? read(request) : {};
  if (action === 'limit-surface') {
    if (destination && [file, request].some(source => path.resolve(source) === destination))
      throw new RangeError('Write the limit report separately from its inputs');
    const report = api.queryLimitSurface(read(file), settings);
    if (destination) Assets.json(destination, report);
    else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.converged) process.exitCode = 2;
    return;
  }
  if (destination && fs.existsSync(destination) && (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length))
    throw new RangeError('Choose a new or empty remesh output directory');
  if (!settings || Object.getPrototypeOf(settings) !== Object.prototype ||
      settings.materials !== undefined && !Array.isArray(settings.materials))
    throw new TypeError('Use an imported mesh settings object with optional named materials');
  const input = fs.readFileSync(file), assets = new Set([path.resolve(file), ...(request ? [path.resolve(request)] : [])]);
  const { document, materials } = imported(file, kit, input, name => assets.add(name));
  const named = new Map(materials.map(row => [row.id, row]));
  const declared = new Set();
  for (const row of settings.materials ?? []) {
    if (!named.has(row?.id) || declared.has(row.id)) throw new RangeError('Supply one override per imported material ID');
    declared.add(row.id);
    named.set(row.id, { ...named.get(row.id), ...row });
  }
  const result = api.remeshImported(document, { ...settings, materials: [...named.values()] });
  const receipt = { ...result.report, assets: [...assets].map(source => ({ file: path.basename(source),
    sha256: sha256(source === path.resolve(file) ? input : fs.readFileSync(source)) })) };
  if (destination) publish(destination, temp => {
    if (result.document) {
      Assets.json(path.join(temp, 'repaired.json'), result.repaired);
      Assets.json(path.join(temp, 'mesh.json'), result.document);
      Assets.json(path.join(temp, 'correspondence.json'), result.correspondence);
      const portable = JSON.parse(JSON.stringify(result.materials, (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value));
      Assets.json(path.join(temp, 'materials.json'), portable);
      if (result.attachments) Assets.json(path.join(temp, 'attachments.json'), result.attachments);
    }
    Assets.json(path.join(temp, 'report.json'), receipt);
  });
  else process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  if (!receipt.canCommit) process.exitCode = 2;
}

module.exports = { command };
