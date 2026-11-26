// Adapt contracted graph maps to the native software mesh carrier.
const maxTexels = 1048576;
const bytes = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
const maxCode = precision => precision === 'unorm8' ? 255 : precision === 'unorm16' ? 65535 : 1;

function materialMesh(K, source, packet, { id, objectId, material = id, alphaCutoff, emissionStrength } = {}) {
  const I = K.procedural.graphImages, M = K.procedural.materialChannels;
  const mesh = source.pos && source.tri ? source : K.procedural.sceneGraph.mesh(source);
  const base = M.channel(packet, 'baseColor').raster;
  if (base?.descriptor?.intent !== 'color')
    throw new TypeError('Scene material mesh needs a typed baseColor image');
  const { width, height } = base.raster;
  if (width > 2048 || height > 2048 || width * height > maxTexels)
    throw new RangeError('Scene material mesh exceeds its texture budget');
  if (!mesh.uvs) throw new TypeError('Scene material mesh needs top-left UVs on the source geometry');

  const adapted = [];
  function map(name, intents, scalar = false) {
    if (!Object.hasOwn(packet.channels, name)) return;
    const { raster: image, metadata } = M.channel(packet, name);
    const { raster, descriptor } = image;
    if (!descriptor || !intents.includes(descriptor.intent) || metadata.texCoord !== undefined && metadata.texCoord !== 0)
      throw new TypeError('Scene material ' + name + ' needs a contracted image on UV set 0');
    if (raster.width !== width || raster.height !== height || descriptor.tiling.u !== 'clamp' ||
        descriptor.tiling.v !== 'clamp' || scalar && (raster.channels !== 1 || descriptor.units !== 'unitless'))
      throw new RangeError('Scene material ' + name + ' needs aligned, clamped UV maps');
    return image;
  }
  function delivery(name, image, data) {
    adapted.push({ channel: name, sourceBytes: image.raster.data.byteLength ?? null, workingBytes: data.byteLength,
      sharedInput: data === image.raster.data });
    return data;
  }
  function color(image) {
    const { data } = I.convert(image, { intent: 'color', colorSpace: 'srgb', precision: 'unorm8',
      layout: 'rgba', alpha: 'straight' }).raster;
    return bytes(data) ? data : Uint8Array.from(data);
  }
  function scalarCodes(name) {
    const image = map(name, ['data', 'mask'], true);
    if (!image) return;
    const { raster: { data }, descriptor: { precision } } = image;
    const scale = maxCode(precision);
    return delivery(name, image, bytes(data) ? data : Uint8Array.from(data, n => {
      if (n < 0 || n > scale) throw new RangeError('Scene material ' + name + ' samples need a unit range');
      return Math.round(n * 255 / scale);
    }));
  }
  function normalCodes() {
    const image = map('normal', ['normal']);
    if (!image) return;
    const { raster: { data, channels }, descriptor: { precision, alpha, normalSpace, normalOrientation } } = image;
    if (normalSpace === 'world' || alpha === 'premultiplied')
      throw new TypeError('Scene mesh normals need straight tangent-space samples');
    const flip = normalOrientation === 'directx', scale = maxCode(precision), encoded = precision.startsWith('unorm');
    if (bytes(data) && channels === 4 && alpha === 'straight' && !flip) return delivery('normal', image, data);
    const output = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
      for (let c = 0; c < 3; c++) {
        const unit = encoded ? data[i + c] / scale : .5 + .5 * data[i + c];
        output[j + c] = Math.round(255 * (c === 1 && flip ? 1 - unit : unit));
      }
      output[j + 3] = channels === 4 && alpha !== 'none' ? Math.round(data[i + 3] * 255 / scale) : 255;
    }
    return delivery('normal', image, output);
  }

  let pigment = color(map('baseColor', ['color']));
  const opacity = scalarCodes('opacity');
  if (opacity) {
    if (pigment === base.raster.data) pigment = pigment.slice();
    for (let i = 0; i < opacity.length; i++) pigment[i * 4 + 3] = Math.round(pigment[i * 4 + 3] * opacity[i] / 255);
  }
  delivery('baseColor', base, pigment);
  const emissionImage = map('emission', ['color']);
  const emission = emissionImage && delivery('emission', emissionImage, color(emissionImage));
  const value = K.sceneMeshes.create({ id, objectId, positions: mesh.pos, indices: mesh.tri,
    uvs: mesh.uvs, normals: mesh.normals, materials: [{ id: material, alphaCutoff, emissionStrength,
      texture: { width, height, pixels: pigment }, normal: normalCodes(),
      roughness: scalarCodes('roughness'), metalness: scalarCodes('metalness'), emission }] });
  return { value, report: { id, vertices: value.vertices, triangles: value.triangles, width, height, channels: adapted,
    graphOnly: Object.keys(packet.channels).filter(name => !adapted.some(row => row.channel === name)) } };
}

module.exports = { materialMesh };
