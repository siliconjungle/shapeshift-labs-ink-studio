const { clamp } = require('./physical-reference-math.js');

const iorLimit = n => clamp(n, .025, 40);
const blend = (a, b, t) => (1 - t) * a + t * b;
const rgbWavelength = [.6563, .5461, .4861];

function transmittedCosine(cos, from, to) {
  return Math.sqrt(Math.max(0, 1 - (from / to) ** 2 * (1 - clamp(cos) ** 2)));
}

function amplitudes(cos, toCos, from, to) {
  return [(from * cos - to * toCos) / (from * cos + to * toCos || 1),
    (to * cos - from * toCos) / (to * cos + from * toCos || 1)];
}

function dielectric(cos, from, to) {
  if (from === to) return 0;
  const c = clamp(cos), t = transmittedCosine(c, from, to);
  if (!t) return 1;
  const [s, p] = amplitudes(c, t, from, to);
  return (s * s + p * p) * .5;
}

function effectiveIor(base, ambient, weight) {
  const n = iorLimit(base);
  const normal = (n - ambient) / (n + ambient);
  const epsilon = Math.sign(normal) * Math.sqrt(clamp(weight * normal * normal, 0, .999999));
  return iorLimit(ambient * (1 + epsilon) / (1 - epsilon));
}

function cauchy(ior, dispersion, abbe, channel) {
  if (channel === null || !dispersion) return ior;
  const wavelength = rgbWavelength[channel];
  const spread = (ior - 1) * dispersion / Math.max(1e-6, abbe);
  const slope = spread / (1 / .4861 ** 2 - 1 / .6563 ** 2);
  return iorLimit(ior + slope * (1 / wavelength ** 2 - 1 / .5876 ** 2));
}

function film(p, cos, from, to, conductor) {
  const d = conductor === undefined ? dielectric(cos, from, to) : 0;
  const plain = conductor ?? [d, d, d];
  if (!p.thin_film_weight || !p.thin_film_thickness) return plain;
  const middle = iorLimit(p.thin_film_ior);
  const filmCos = transmittedCosine(cos, from, middle);
  const substrateCos = transmittedCosine(cos, from, to);
  if (!filmCos || conductor === undefined && !substrateCos) {
    return plain.map(reflected => blend(reflected, 1, p.thin_film_weight));
  }
  const entry = amplitudes(cos, filmCos, from, middle);
  const dielectricExit = conductor === undefined ? amplitudes(filmCos, substrateCos, middle, to) : null;
  const path = 4 * Math.PI * middle * filmCos * Math.min(p.thin_film_thickness, 1e4);
  return rgbWavelength.map((wavelength, i) => {
    const exit = dielectricExit ?? [-Math.sqrt(conductor[i]), Math.sqrt(conductor[i])];
    let sum = 0;
    for (const delta of [-.018, 0, .018]) {
      const interference = Math.cos(path / (wavelength + delta));
      for (let pol = 0; pol < 2; pol++) {
        const a = entry[pol], b = exit[pol], cross = 2 * a * b * interference;
        sum += clamp((a * a + b * b + cross) / Math.max(1e-9, 1 + (a * b) ** 2 + cross));
      }
    }
    return blend(plain[i], sum / 6, p.thin_film_weight);
  });
}

function layer(p, ambient) {
  const coatIor = iorLimit(p.coat_ior), cw = p.coat_weight;
  const bare = effectiveIor(p.specular_ior, ambient, p.specular_weight);
  const covered = cw ? effectiveIor(p.specular_ior, coatIor, p.specular_weight) : bare;
  const totalIor = blend(bare, covered, cw);
  const rough = p.specular_roughness, cr = p.coat_roughness;
  const roughness = blend(rough, Math.min(1, rough ** 4 + 2 * cr ** 4) ** .25, cw);
  function coat(cos) {
    if (!cw) return { loss: 1, cos };
    const transmitted = transmittedCosine(cos, ambient, coatIor);
    return { loss: 1 - dielectric(cos, ambient, coatIor), cos: Math.max(.01, transmitted) };
  }
  function reflection(cos) {
    const unclad = film(p, cos, ambient, bare);
    if (!cw) return unclad;
    const coated = film(p, coat(cos).cos, coatIor, covered);
    return unclad.map((r, i) => blend(r, coated[i], cw));
  }
  return { coatIor, totalIor, roughness, reflection, coat };
}

function fuzzEnergy(p, cosine) {
  if (!p.fuzz_weight) return 0;
  const grazing = (1 - clamp(cosine)) ** blend(4.5, 1.4, p.fuzz_roughness);
  return p.fuzz_weight * blend(.027 + .62 * grazing, .24 + .16 * grazing, p.fuzz_roughness);
}

function thinSheet(p, reflection, cosine) {
  return reflection.map((f, i) => {
    const pass = p.transmission_color[i] ** (1 / Math.max(.05, cosine));
    const series = (1 - f) ** 2 / Math.max(1e-9, 1 - (f * pass) ** 2);
    return { reflection: clamp(f + series * f * pass ** 2), transmission: clamp(series * pass) };
  });
}

module.exports = { iorLimit, blend, transmittedCosine, dielectric, effectiveIor, cauchy, film, layer, fuzzEnergy, thinSheet };
