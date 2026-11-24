const png = require('./png.js');
const { loadRaster, pack, unpack } = require('./material-chart-rebake.js');
const { fromSRGBByte, toSRGBByte, filterNormal } = require('../src/semantic-texture-mipmaps.js');

const rgbLayers = ['base', 'normal', 'surface', 'emission'];
const mapFiles = {
  pigment:'pigment', normal:'normal', roughness:'roughness', emission:'emission',
  metallicRoughness:'metallic-roughness', coverage:'coverage', opacity:'opacity'
};

function chooseOwner(owners, footprint, children) {
  let best = 0, bestWeight = 0;
  for (const child of children) {
    const owner = owners[child];
    if (!owner) continue;
    let weight = 0;
    for (const input of children) if (owners[input] === owner)
      weight += 1 + 4 * footprint[input];
    // Any surface coverage beats an unoccupied chart gutter.
    if (weight > bestWeight || (weight === bestWeight && owner < best)) {
      best = owner;
      bestWeight = weight;
    }
  }
  return best;
}

function reduce(source, size, saved, dirty, read) {
  const count = size * size, names = [...source.masks.keys()];
  const previous = saved && loadRaster(read, size, saved.maps, saved.masks);
  const packedOwners = saved && read(saved.owners);
  const owners = saved ? unpack(packedOwners, Uint32Array, count) : new Uint32Array(count);
  const pixels = previous?.pixels ?? Object.fromEntries(rgbLayers.map(layer => [layer, new Uint8Array(count * 3)]));
  const opacity = source.opacity && (previous?.opacity ?? new Uint8Array(count).fill(255));
  const footprint = previous?.footprint ?? new Uint8Array(count);
  const masks = new Map(names.map(name => [name, previous?.masks.get(name) ?? new Uint8Array(count)]));
  const srcMasks = [...source.masks.values()], dstMasks = [...masks.values()];
  const { base, normal, surface, emission } = source.pixels;
  const children = [0,0,0,0], width = size * 2;
  const pigment = [0,0,0], radiance = [0,0,0], mean = [0,0,0], mask = new Float64Array(names.length);
  let filteredTexels = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, p = 2 * (y * width + x);
    children[0] = p;
    children[1] = p + 1;
    children[2] = p + width;
    children[3] = p + width + 1;
    const owner = saved ? owners[i] : chooseOwner(source.owners, source.footprint, children);
    if (!owner || (saved && !dirty.has(owner - 1))) continue;
    owners[i] = owner;
    filteredTexels++;
    let area = 0;
    for (const child of children) if (source.owners[child] === owner) area += source.footprint[child];
    footprint[i] = Math.round(area / 4);
    let total = 0, roughnessSquared = 0, metallic = 0, alpha = 0;
    pigment.fill(0);
    radiance.fill(0);
    mean.fill(0);
    mask.fill(0);
    for (const child of children) {
      if (source.owners[child] !== owner) continue;
      const weight = area ? source.footprint[child] : 1;
      if (!weight) continue;
      const at = child * 3;
      const nx = normal[at] - 128, ny = normal[at + 1] - 128, nz = normal[at + 2] - 128;
      const length = Math.hypot(nx, ny, nz);
      const normalWeight = length ? weight / length : 0;
      mean[0] += nx * normalWeight;
      mean[1] += ny * normalWeight;
      mean[2] += length ? nz * normalWeight : weight;
      for (let c = 0; c < 3; c++) {
        pigment[c] += fromSRGBByte(base[at + c]) * weight;
        radiance[c] += fromSRGBByte(emission[at + c]) * weight;
      }
      roughnessSquared += (surface[at + 1] / 255) ** 2 * weight;
      metallic += surface[at + 2] * weight;
      if (opacity) alpha += source.opacity[child] * weight;
      for (let m = 0; m < mask.length; m++) mask[m] += srcMasks[m][child] * weight;
      total += weight;
    }
    const filtered = filterNormal(mean.map(value => value / total), roughnessSquared / total);
    const at = i * 3;
    for (let c = 0; c < 3; c++) {
      pixels.base[at + c] = toSRGBByte(pigment[c] / total);
      pixels.normal[at + c] = Math.round(127.5 * (1 + filtered.direction[c]));
      pixels.emission[at + c] = toSRGBByte(radiance[c] / total);
    }
    pixels.surface[at] = 255;
    pixels.surface[at + 1] = filtered.roughness;
    pixels.surface[at + 2] = Math.round(metallic / total);
    if (opacity) opacity[i] = Math.round(alpha / total);
    for (let m = 0; m < mask.length; m++) dstMasks[m][i] = Math.round(mask[m] / total);
  }
  return {pixels, opacity, footprint, masks, owners, packedOwners, filteredTexels};
}

function writeMips(baked, size, dirty, prior, read, map, sidecar) {
  const levels = [];
  const savedLevels = prior?.version === 1 ? prior.levels : undefined;
  if (prior?.version === 1 && (!Array.isArray(savedLevels) || savedLevels.length !== Math.log2(size)))
    throw new Error('Invalid chart rebake mip chain');
  let source = baked.raster;
  for (let level = 1, width = size / 2; width >= 1; level++, width /= 2) {
    const prefix = 'mip-' + level + '/';
    const saved = savedLevels?.[level - 1];
    if (savedLevels && (saved?.level !== level || saved.width !== width || saved.height !== width))
      throw new Error('Invalid chart rebake mip dimensions');
    let maps, masks, owners, filteredTexels;
    if (saved && !dirty.size && !!saved.maps.opacity === !!source.opacity &&
        Object.keys(saved.masks).length === source.masks.size &&
        Object.keys(saved.masks).every(name => source.masks.has(name))) {
      maps = Object.fromEntries(Object.entries(mapFiles).filter(([name]) => name !== 'opacity' || source.opacity)
        .map(([name,file]) => {
          const descriptor = saved.maps[name];
          return [name, map(prefix + file, read(descriptor), descriptor.colorSpace)];
        }));
      masks = Object.fromEntries(Object.entries(saved.masks).map(([name, descriptor]) =>
        [name, map(prefix + 'mask-' + name, read(descriptor), descriptor.colorSpace)]));
      owners = sidecar(prefix + 'chart-owners', 'deflate', read(saved.owners));
      filteredTexels = 0;
    } else {
      source = reduce(source, width, saved, dirty, read);
      const {pixels, footprint, opacity} = source;
      const rgb = (name, data, space, alpha) => map(prefix + name,
        alpha ? png.encodeFrame(png.packFrame({w:width,h:width,rgb:data,alpha})) : png.encode(width, width, data), space);
      const gray = (name, data) => map(prefix + name, png.encodeGray(width, width, data), 'linear');
      maps = {
        pigment: rgb('pigment', pixels.base, 'sRGB', opacity),
        normal: rgb('normal', pixels.normal, 'linear'),
        roughness: gray('roughness', Uint8Array.from(footprint, (_n, i) => pixels.surface[i * 3 + 1])),
        emission: rgb('emission', pixels.emission, 'sRGB'),
        metallicRoughness: rgb('metallic-roughness', pixels.surface, 'linear'),
        coverage: gray('coverage', footprint),
        ...(opacity && {opacity: gray('opacity', opacity)})
      };
      masks = Object.fromEntries([...source.masks].map(([name,data]) => [name, gray('mask-' + name, data)]));
      owners = sidecar(prefix + 'chart-owners', 'deflate', source.packedOwners ?? pack(source.owners));
      ({filteredTexels} = source);
    }
    levels.push({level, width, height:width, maps, masks, owners, filteredTexels});
  }
  return {version:1, levels};
}

module.exports = {writeMips};
