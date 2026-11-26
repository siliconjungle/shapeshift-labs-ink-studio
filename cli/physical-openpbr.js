const TextureAddress = require('../src/texture-address.js');
const { clamp, scale, luma } = require('./physical-reference-math.js');

const whiteNits = 100;
const maxRadiance = 1e8;
const mix = (a, b, t) => a + (b - a) * t;

function fresnel0(ior) {
  const ratio = ior >= 1 ? 1 / ior : ior;
  return ((1 - ratio) / (1 + ratio)) ** 2;
}

const fresnel = (f0, cosine) => mix(f0, 1, (1 - clamp(cosine)) ** 5);
const dielectricFresnel = (f0, cosine) => f0 ? fresnel(f0, cosine) : 0;

function texture(P, image, name, identity, budget) {
  const { width, height } = image.raster;
  budget.texels += width * height;
  if (budget.texels > 10e6) throw new RangeError('Physical reference maps exceed the 10-million-texel budget');
  const input = P.openPbr.inputs[name];
  const prepared = input.type === 'color3' ? P.graphImages.convert(image, {
    intent: 'color', colorSpace: P.openPbr.colorSpace, precision: 'float64',
    alpha: image.descriptor.alpha === 'none' ? 'none' : 'straight'
  }) : image;
  const { raster: { channels, data }, descriptor } = prepared;
  const { precision, intent, domain, normalSpace, normalOrientation, sampling, tiling } = descriptor;
  const divisor = precision === 'unorm8' ? 255 : precision === 'unorm16' ? 65535 : 1;
  const vector = input.type === 'vector3';
  const components = input.type === 'float' ? 1 : 3;
  const Pixels = input.max > 1 && !vector ? Float64Array : Float32Array;
  const pixels = new Pixels(width * height * 4);
  let peak = 0;
  for (let i = 0, to = 0; i < data.length; i += channels, to += 4) {
    for (let c = 0; c < components; c++) {
      let value = data[i + c] / divisor;
      if (intent === 'normal') {
        if (domain === 'unit') value = value * 2 - 1;
        if (c === 1 && normalOrientation === 'directx') value = -value;
      }
      if (intent === 'color') value = clamp(value, 0, input.max);
      if (!Number.isFinite(value)) throw new RangeError('OpenPBR map conversion overflow for ' + name);
      pixels[to + c] = value;
      peak = Math.max(peak, value);
    }
    pixels[to + 3] = 1;
  }
  identity.update(JSON.stringify([name, width, height, descriptor])).update(Buffer.from(pixels.buffer));
  const read = TextureAddress.sampler(pixels, width, height, TextureAddress.settings({
    filter: sampling, edgeU: tiling.u, edgeV: tiling.v
  }));
  const work = [0, 0, 0, 0];
  function at([u, v], fallback) {
    read(u, v, work);
    if (vector) return work[3] ? { value: work.slice(0, 3), space: normalSpace ?? 'tangent' } : fallback;
    if (components === 3) return work.slice(0, 3).map((n, c) => n + (1 - clamp(work[3])) * fallback[c]);
    return work[0] + (1 - clamp(work[3])) * (name === 'geometry_opacity' ? 0 : fallback);
  }
  return { at, peak };
}

function material(P, packet, name, id, identity, budget) {
  const { parameters } = packet;
  identity.update(JSON.stringify([name, packet.format, packet.version, packet.spec, packet.colorSpace, whiteNits, parameters]));
  const maps = Object.fromEntries(Object.entries(packet.maps).map(([name, image]) =>
    [name, texture(P, image, name, identity, budget)]));
  const uniforms = Object.fromEntries(Object.keys(parameters).map(name => [name, P.openPbr.inputs[name].type === 'vector3' && parameters[name] ?
    { value: parameters[name], space: 'world' } : parameters[name]]));
  const peak = name => Math.max(maps[name]?.peak ?? 0, Array.isArray(parameters[name]) ?
    Math.max(...parameters[name]) : parameters[name]);
  const brightness = (peak('emission_luminance') / whiteNits) * peak('emission_color');
  if (!Number.isFinite(brightness) || brightness > maxRadiance)
    throw new RangeError('OpenPBR radiance exceeds the physical reference range');
  const read = (name, uv) => maps[name]?.at(uv, uniforms[name]) ?? uniforms[name];

  function visible(uv, rng) {
    const opacity = read('geometry_opacity', uv);
    return opacity >= 1 || opacity > 0 && (rng ? rng() < opacity : opacity >= .5);
  }

  function emitted(uv, cosine) {
    if (!brightness) return [0, 0, 0];
    const luminance = read('emission_luminance', uv) / whiteNits;
    const weight = read('coat_weight', uv);
    const transmission = weight ? 1 - dielectricFresnel(fresnel0(read('coat_ior', uv)), cosine) : 1;
    const tint = weight ? read('coat_color', uv) : [1, 1, 1];
    return read('emission_color', uv).map((n, c) => luminance * n * mix(1, Math.sqrt(tint[c]) * transmission, weight));
  }

  const surfaceMaps = Object.keys(maps).filter(name => name !== 'geometry_opacity' && !name.startsWith('emission_'));
  const uniformSurface = { color: scale(uniforms.base_color, uniforms.base_weight), openPbr: uniforms };
  function at(uv) {
    if (!surfaceMaps.length) return uniformSurface;
    const p = { ...uniforms };
    for (const name of surfaceMaps) p[name] = read(name, uv);
    return { color: scale(p.base_color, p.base_weight), openPbr: p };
  }

  return {
    name, id, visible, at, emitted, weight: brightness,
    twoSidedEmission: parameters.geometry_thin_walled,
    openPbr: P.openPbr.describe(packet)
  };
}

module.exports = { material, fresnel, fresnel0, dielectricFresnel, whiteNits };
