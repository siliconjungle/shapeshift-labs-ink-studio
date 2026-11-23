// KHR_gaussian_splatting and native triangle primitives share one retained glTF pose.
import { shBasis, srgbDisplay } from './gaussian-splats.mjs';

export const gaussianGltfExtension = 'KHR_gaussian_splatting';
const prefix = gaussianGltfExtension + ':';
const colors = ['srgb_rec709_display', 'lin_rec709_display'];
const elements = {
  5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767],
  5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32']
};
const unsigned = [5121, 5123, 5125], float = [5126], maxPoints = 4_000_000;
const countValid = n => Number.isSafeInteger(n) && n >= 0;
const clamp = n => Math.min(1, Math.max(0, n));

export const hasScanSurfaceGltf = document => document?.asset?.extras?.inkStudioScanSurface === 1;

export function hasGaussianGltf(document) {
  return (document?.meshes ?? []).some(mesh =>
    mesh?.primitives?.some(part => Object.hasOwn(part?.extensions ?? {}, gaussianGltfExtension)));
}

function makeAccessors(document, binary) {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const { accessors = [], bufferViews = [] } = document;
  function at(id, start, length) {
    const row = bufferViews[id], offset = row?.byteOffset ?? 0;
    if (row?.buffer !== 0 || ![offset, start, length, row.byteLength].every(countValid) ||
        start + length > row.byteLength || offset + start + length > view.byteLength)
      throw new RangeError('glTF accessor exceeds its buffer view');
    return offset + start;
  }
  return function accessor(id, type, allowed, normalized, label) {
    const a = accessors[id], width = type === 'SCALAR' ? 1 : Number(type.slice(-1));
    if (a?.type !== type || !allowed.includes(a.componentType) ||
        (a.componentType === 5126 ? !!a.normalized : normalized !== undefined && !!a.normalized !== normalized) ||
        !countValid(a.count) || !a.count || a.count > maxPoints)
      throw new TypeError('Invalid glTF accessor for ' + label);
    const [size, method, top] = elements[a.componentType], row = width * size;
    const stride = bufferViews[a.bufferView]?.byteStride ?? row;
    if (!countValid(stride) || stride < row || stride % size)
      throw new RangeError('Invalid glTF stride for ' + label);
    const first = a.bufferView === undefined ? null : at(a.bufferView, a.byteOffset ?? 0, row + stride * (a.count - 1));
    let replacements, data;
    if (a.sparse) {
      const { count, indices, values } = a.sparse, component = indices?.componentType;
      if (!unsigned.includes(component) || !countValid(count) || count < 1 || count > a.count || !values)
        throw new RangeError('Invalid sparse glTF accessor for ' + label);
      const [keySize, keyMethod] = elements[component];
      const start = at(indices.bufferView, indices.byteOffset ?? 0, count * keySize);
      data = at(values.bufferView, values.byteOffset ?? 0, count * row);
      replacements = new Map();
      let previous = -1;
      for (let i = 0; i < count; i++) {
        const key = view[keyMethod](start + keySize * i, true);
        if (key <= previous || key >= a.count) throw new RangeError('Invalid sparse glTF indices for ' + label);
        replacements.set(key, i);
        previous = key;
      }
    }
    return {
      count: a.count,
      get(i, c = 0) {
        const replacement = replacements?.get(i);
        if (replacement === undefined && first === null) return 0;
        const offset = replacement === undefined ? first + i * stride : data + replacement * row;
        const value = view[method](offset + c * size, true);
        if (!Number.isFinite(value)) throw new RangeError('Nonfinite glTF ' + label);
        return a.normalized ? Math.max(-1, value / top) : value;
      }
    };
  };
}

function position(matrix, x, y, z) {
  return [0, 1, 2].map(i => matrix[i] * x + matrix[i+4] * y + matrix[i+8] * z + matrix[i+12]);
}

function gaussianPrimitive(part, accessor, point) {
  const spec = part.extensions[gaussianGltfExtension];
  if (part.mode !== 0 || !spec || spec.kernel !== 'ellipse' || !colors.includes(spec.colorSpace) ||
      (spec.projection ?? 'perspective') !== 'perspective' || (spec.sortingMethod ?? 'cameraDistance') !== 'cameraDistance')
    throw new TypeError('Unsupported KHR_gaussian_splatting ellipse primitive settings');
  const attr = (name, type, allowed, normalized) => {
    const stream = accessor(part.attributes[prefix + name], type, allowed, normalized, prefix + name);
    if (stream.count !== point.count) throw new RangeError('Gaussian attribute count differs from POSITION for ' + name);
    return stream;
  };
  const rotation = attr('ROTATION', 'VEC4', [5120, 5122, 5126], true);
  const scale = attr('SCALE', 'VEC3', [5121, 5123, 5126]);
  const opacity = attr('OPACITY', 'SCALAR', [5121, 5123, 5126], true);
  const harmonics = [attr('SH_DEGREE_0_COEF_0', 'VEC3', float)];
  let degree = 0;
  for (let l = 1; l <= 3; l++) {
    const names = Array.from({ length: 2*l+1 }, (_, i) => 'SH_DEGREE_' + l + '_COEF_' + i);
    if (!names.some(name => part.attributes[prefix + name] !== undefined)) continue;
    if (degree !== l - 1) throw new RangeError('Gaussian spherical harmonic degrees must be consecutive');
    harmonics.push(...names.map(name => attr(name, 'VEC3', float)));
    degree = l;
  }
  return { rotation, scale, opacity, harmonics, degree, colorSpace: spec.colorSpace };
}

function readIndices(part, point, accessor) {
  const indices = part.indices === undefined ? null : accessor(part.indices, 'SCALAR', unsigned, false, 'indices');
  const length = indices?.count ?? point.count;
  const get = i => {
    const value = indices?.get(i) ?? i;
    if (value >= point.count) throw new RangeError('glTF index is outside its primitive');
    return value;
  };
  return { length, get };
}

function triangles(mode, { length, get }) {
  if (mode === 4 && length % 3) throw new RangeError('glTF TRIANGLES need groups of three indices');
  if (length < 3 || length > (mode === 4 ? 750_000 : 250_002)) throw new RangeError('glTF triangle primitive exceeds the native mesh budget');
  if (mode === 4) return Uint32Array.from({ length }, (_, i) => get(i));
  const result = new Uint32Array((length - 2) * 3);
  for (let i = 0; i < length - 2; i++) {
    const a = mode === 6 ? 0 : i, b = i + 1;
    result.set(i % 2 && mode === 5 ? [get(b), get(a), get(i+2)] : [get(a), get(b), get(i+2)], i*3);
  }
  return result;
}

function orientation(matrix) {
  const basis = [0, 4, 8].map(i => {
    const axis = matrix.slice(i, i+3), length = Math.hypot(...axis);
    if (!(length > 0) || !Number.isFinite(length)) throw new RangeError('Invalid Gaussian glTF node scale');
    return axis.map(n => n / length);
  });
  const [[a,b,c],[d,e,f],[g,h,i]] = basis;
  if (Math.abs(a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g) - 1) > .001)
    throw new RangeError('Gaussian glTF node transform needs orthogonal axes and positive orientation');
  return basis;
}

// Four Gauss–Legendre latitudes and eight longitudes integrate products of
// real SH through degree three. Store one rotation per primitive, not per splat.
function harmonicRotation(axes, degree) {
  const terms = (degree+1)**2 - 1;
  if (!terms || axes.every((axis, i) => axis.every((v, j) => Math.abs(v - +(i === j)) < 1e-10))) return null;
  const result = Array.from({ length: terms }, () => new Float64Array(terms));
  for (const [z, weight] of [[-.8611363115940526,.3478548451374538],[-.3399810435848563,.6521451548625461],
    [.3399810435848563,.6521451548625461],[.8611363115940526,.3478548451374538]]) {
    const r = Math.sqrt(1-z*z);
    for (let k = 0; k < 8; k++) {
      const phi = k*Math.PI/4, ray = [r*Math.cos(phi),r*Math.sin(phi),z];
      const local = axes.map(axis => axis[0]*ray[0] + axis[1]*ray[1] + axis[2]*ray[2]);
      const a = shBasis(ray, degree), b = shBasis(local, degree);
      for (let l = 1; l <= degree; l++) for (let i = l*l-1; i < (l+1)**2-1; i++)
        for (let j = l*l-1; j < (l+1)**2-1; j++) result[i][j] += a[i]*b[j]*weight*Math.PI/4;
    }
  }
  return result;
}

function packGaussian(data, at, point, matrix, trs, mul, p, i) {
  const scale = [0,1,2].map(k => p.scale.get(i,k)), rotation = [0,1,2,3].map(k => p.rotation.get(i,k));
  const norm = Math.hypot(...rotation), alpha = p.opacity.get(i);
  if (scale.some(n => n < 0) || Math.abs(norm-1) > .02 || alpha < 0 || alpha > 1)
    throw new RangeError('Invalid Gaussian glTF scale, rotation, or opacity');
  const basis = mul(matrix, trs({ scale, rotation: rotation.map(n => n/norm) }));
  const cov = (a,b) => basis[a]*basis[b] + basis[a+4]*basis[b+4] + basis[a+8]*basis[b+8];
  const mean = position(matrix, point.get(i,0), point.get(i,1), point.get(i,2));
  data.set([...mean, alpha, cov(0,0), cov(0,1), cov(0,2), 0, cov(1,1), cov(1,2), cov(2,2)], at);
  if (!data.subarray(at, at+11).every(Number.isFinite)) throw new RangeError('Gaussian glTF geometry exceeds float storage');
}

const displayByte = value => Math.round(255 * clamp(value));
const linearByte = Array.from({length:256}, (_, n) => n <= 10 ? n/(255*12.92) : ((n/255+.055)/1.055)**2.4);
const packRgb = rgb => rgb.reduce((color, v) => color*256 + displayByte(v), 0);

async function browserImage(bytes, mime) {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined')
    throw new TypeError('Textured Gaussian glTF needs an RGBA image decoder');
  const image = await createImageBitmap(new Blob([bytes], { type:mime }), { colorSpaceConversion:'none' });
  try {
    if (image.width>2048 || image.height>2048) throw new RangeError('glTF image exceeds the native mesh texture limit');
    const context = new OffscreenCanvas(image.width,image.height).getContext('2d');
    context.drawImage(image,0,0);
    const { width,height,data:pixels } = context.getImageData(0,0,image.width,image.height);
    return { width,height,pixels };
  } finally {
    image.close();
  }
}

async function meshMaterial(kit, document, binary, part, accessor, vertexCount, decodeImage, cached) {
  const id = part.material === undefined ? 'gltf-material-default' : 'gltf-material-' + part.material;
  const api = kit.authoring.assetTextures;
  const spec = api.baseColor(document, part);
  const color = packRgb(spec.factor.map(srgbDisplay));
  const uvs = new Float32Array(vertexCount * 2);
  if (spec.alphaMode === 'BLEND') throw new TypeError('Gaussian glTF native mesh materials support OPAQUE and MASK');
  if (spec.source === undefined) {
    const material = { id, color };
    if (spec.alphaMode === 'MASK' && spec.opacity < spec.alphaCutoff)
      material.texture = { width:1, height:1, pixels:new Uint8Array(4) };
    return { uvs, material };
  }
  const uv = accessor(spec.index, 'VEC2', [5121,5123,5126], true, 'base color TEXCOORD');
  if (uv.count !== vertexCount) throw new RangeError('glTF TEXCOORD count differs from POSITION');
  const [sin, cos] = [Math.sin(spec.rotation),Math.cos(spec.rotation)];
  for (let i=0; i<vertexCount; i++) {
    const pair = [uv.get(i,0)*spec.scale[0],uv.get(i,1)*spec.scale[1]];
    uvs.set([clamp(pair[0]*cos-pair[1]*sin+spec.offset[0]),clamp(pair[0]*sin+pair[1]*cos+spec.offset[1])],i*2);
  }
  if (!cached.has(spec.source)) {
    const { pixels, mime } = api.embeddedImage({ json:document, bin:binary }, spec.source);
    cached.set(spec.source, await decodeImage(pixels,mime));
  }
  const { width, height, pixels } = cached.get(spec.source);
  if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width*height*4)
    throw new TypeError('glTF image decoder must return RGBA8 pixels');
  const rgba = Uint8Array.from(pixels);
  const tinted = spec.factor.some(value=>value !== 1);
  for (let i=0; i<rgba.length; i+=4) {
    if (tinted) for (let channel=0; channel<3; channel++)
      rgba[i+channel] = displayByte(srgbDisplay(linearByte[rgba[i+channel]]*spec.factor[channel]));
    rgba[i+3] = spec.alphaMode === 'OPAQUE' || rgba[i+3]/255*spec.opacity >= spec.alphaCutoff ? 255 : 0;
  }
  return { uvs, material:{ id, texture:{ width,height,pixels:rgba } } };
}

export async function gaussianGltfWorld(source, { toolkit, scene, clip, time = 0, maxSplats = maxPoints, decodeImage = browserImage } = {}) {
  const kit = toolkit?.KIT ?? toolkit;
  if (!kit?.authoring?.gltfAssets || !kit.sceneMeshes) throw new TypeError('Gaussian glTF import needs an Ink Studio KIT');
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const { json, bins } = kit.mesh.glbParts(source);
    source = { document:json, binary:bins[0] };
  }
  const asset = kit.authoring.gltfAssets.create(source);
  const { document, binary } = asset.snapshot();
  const scanSurface = hasScanSurfaceGltf(document);
  if (!scanSurface && !hasGaussianGltf(document)) throw new TypeError('No KHR_gaussian_splatting primitive in glTF');
  const supported = [gaussianGltfExtension,'KHR_mesh_quantization','KHR_texture_transform','KHR_materials_unlit'];
  const missing = (document.extensionsRequired ?? []).filter(name => !supported.includes(name));
  if (missing.length) throw new TypeError('Unsupported required glTF extensions: ' + missing.join(', '));
  if (!countValid(maxSplats) || maxSplats < 1 || maxSplats > maxPoints) throw new RangeError('Invalid Gaussian glTF splat limit');
  const accessor = makeAccessors(document,binary), rows = [], nodes = asset.sample(time, { clip, scene });
  let count = 0, degree = 0;
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const mesh = document.meshes[node.mesh];
    for (const [primitive, part] of mesh.primitives.entries()) {
      const gaussian = Object.hasOwn(part.extensions ?? {}, gaussianGltfExtension), mode = part.mode ?? 4;
      if (!gaussian && ![4,5,6].includes(mode)) continue;
      if (node.skin !== undefined || part.targets?.length) throw new TypeError('Gaussian glTF scene import needs rigid primitives');
      const allowed = document.extensionsUsed?.includes('KHR_mesh_quantization') ? [5120,5121,5122,5123,5126] : float;
      const point = accessor(part.attributes?.POSITION,'VEC3',allowed,undefined,'POSITION');
      const indices = readIndices(part,point,accessor);
      const object = 'gltf-node-' + node.id, id = object + '/primitive-' + primitive;
      const detail = { id, object, node:node.id, nodeName:node.name ?? null, mesh:node.mesh, meshName:mesh.name ?? null,
        primitive, kind:gaussian ? 'gaussian' : 'mesh', matrix:node.world };
      const ellipse = gaussian && gaussianPrimitive(part,accessor,point);
      if (ellipse) {
        count += indices.length;
        if (count > maxSplats) throw new RangeError('Gaussian glTF scene exceeds the splat limit');
        degree = Math.max(degree,ellipse.degree);
      }
      rows.push({ detail, ellipse, part, point, indices, mode });
    }
  }
  if (!count && (!scanSurface || !rows.length)) throw new RangeError('The selected glTF scene has no Gaussian points');

  const data = new Float32Array(count*16), dc = new Float32Array(count*3), terms = (degree+1)**2-1;
  const sh = new Float32Array(count*terms*3);
  const linear = rows.some(row => row.ellipse?.colorSpace === colors[1]) ? new Uint8Array(count) : undefined;
  const objectIds = new Uint32Array(count), targetIds = new Uint32Array(count), objects = [null], targets = [null];
  const normals = scanSurface && new Float32Array(count*3);
  const meshes = [], parts = [], cached = new Map(), { trs, mul } = kit.mesh.gltfTransforms;
  const segments = new Map();
  const lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
  function include(point, extent = [0,0,0]) {
    for (let k=0; k<3; k++) {
      lo[k] = Math.min(lo[k],point[k]-extent[k]);
      hi[k] = Math.max(hi[k],point[k]+extent[k]);
    }
  }
  let next = 0;
  for (const { detail, ellipse, part, point, indices, mode } of rows) {
    const { matrix, id, object } = detail;
    if (!ellipse) {
      const indicesOf = triangles(mode,indices), positions = new Float32Array(point.count*3);
      for (let i=0; i<point.count; i++) {
        const p = position(matrix,point.get(i,0),point.get(i,1),point.get(i,2));
        positions.set(p,i*3);
        include(p);
      }
      const { uvs, material } = await meshMaterial(kit,document,binary,part,accessor,point.count,decodeImage,cached);
      meshes.push(kit.sceneMeshes.create({ id, objectId:object, partId:id, positions, uvs, indices:indicesOf, materials:[material] }));
      parts.push({ ...detail, material:material.id, materialName:document.materials?.[part.material]?.name ?? null,
        triangles:indicesOf.length/3 });
      continue;
    }
    const first = next, objectIndex = segments.get(object) ?? objects.length, targetIndex = targets.length;
    if (!segments.has(object)) { segments.set(object,objectIndex); objects.push(object); }
    targets.push({ entity:object, part:id });
    const axes = orientation(matrix), rotate = harmonicRotation(axes,ellipse.degree);
    const normal = scanSurface && part.attributes.NORMAL !== undefined &&
      accessor(part.attributes.NORMAL,'VEC3',float,false,'NORMAL');
    if (normal && normal.count !== point.count) throw new RangeError('Scan normals must match POSITION');
    const inverseScale = normal && [0,4,8].map(i => 1/Math.hypot(...matrix.slice(i,i+3)));
    const n = ellipse.harmonics.length - 1, input = new Float64Array(n);
    const isLinear = ellipse.colorSpace === colors[1];
    for (let j=0; j<indices.length; j++,next++) {
      const i = indices.get(j), at = next*16;
      packGaussian(data,at,point,matrix,trs,mul,ellipse,i);
      if (normal) {
        const transformed = [0,1,2].map(axis=>axes.reduce((sum,vector,k)=>
          sum+vector[axis]*normal.get(i,k)*inverseScale[k],0));
        const length=Math.hypot(...transformed);
        if (length) normals.set(transformed.map(value=>value/length),next*3);
      }
      include(data.subarray(at,at+3),[4,8,10].map(k => 3*Math.sqrt(data[at+k])));
      objectIds[next] = objectIndex;
      targetIds[next] = targetIndex;
      if (isLinear) linear[next] = 1;
      let rgb = 0;
      for (let c=0; c<3; c++) {
        const val = dc[next*3+c] = ellipse.harmonics[0].get(i,c);
        const base = clamp(.5 + .28209479177387814*val);
        rgb |= displayByte(isLinear ? srgbDisplay(base) : base) << (c*8);
        for (let k=0; k<n; k++) input[k] = ellipse.harmonics[k+1].get(i,c);
        for (let k=0; k<n; k++) sh[(next*terms+k)*3+c] = rotate ?
          rotate[k].reduce((sum,weight,h) => sum+weight*input[h],0) : input[k];
      }
      data[at+7] = rgb;
    }
    parts.push({ ...detail, firstSplat:first, splats:next-first, degree:ellipse.degree, colorSpace:ellipse.colorSpace });
  }
  const target = lo.map((n,k) => (n+hi[k])/2), radius = Math.max(...hi.map((n,k) => n-lo[k]),1e-4);
  const pal = [0x101820,0x334552,0x6f8590,0xbccdd0,0xf4f8f5];
  return { count, data, meshes, ...(scanSurface && {scanSurface:true}), ...(count && { gaussianCloud:true, gaussianSort:'cameraDistance',
      gaussianHarmonics:{ count, degree, dc, sh, linear, up:'y', colorMode:'rgb' } }),
    gltfParts:{ ...(count && {extension:gaussianGltfExtension}), ...(scanSurface && {scanSurface:true}), scene:scene ?? document.scene ?? (document.scenes?.length ? 0 : null),
      ...(clip !== undefined && { clip,time }), parts },
    renderMetadata:{ objectIds, objects, targetIds, targets, ...(normals && {normals}) },
    seed:1, detail:14, radius, moving:new Int32Array(), back:new Int32Array(), pal, palName:'Gaussian glTF',
    bg:[16,24,32], dither:0, fog:{ c:0,start:1,max:0 }, outline:{ c:0,edge:0 },
    cam:{ target, yaw:.18, pitch:.1, dist:radius*2.05, sway:0 } };
}
