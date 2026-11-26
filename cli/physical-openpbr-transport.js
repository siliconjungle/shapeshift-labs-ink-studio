const { dot, along, clamp, scale, unit, luma, frame, direction, tau } = require('./physical-reference-math.js');
const { ggx } = require('./physical-openpbr-brdf.js');
const { blend, cauchy, dielectric, film, fuzzEnergy, thinSheet, transmittedCosine } = require('./physical-openpbr-optics.js');

const one = [1, 1, 1];
const inverseLength = (cm, metersPerUnit) => Math.min(1e6, metersPerUnit / (Math.max(1e-12, cm) * .01));
const attenuation = (extinction, distance) => extinction.map(rate => rate ? Math.exp(-rate * distance) : 1);

function mediumFor(p, kind, ior, metersPerUnit) {
  const isSubsurface = kind === 'subsurface';
  const g = clamp(isSubsurface ? p.subsurface_scatter_anisotropy : p.transmission_scatter_anisotropy, -.995, .995);
  let extinction, scattering;
  if (isSubsurface) {
    extinction = p.subsurface_radius_scale.map(scale => inverseLength(p.subsurface_radius * scale, metersPerUnit));
    // Invert diffuse albedo to the scattering albedo of a homogeneous medium.
    scattering = p.subsurface_color.map((v, c) => {
      const s = clamp(4.097369 + 4.20863 * v - Math.sqrt(9.59217 + 41.6808 * v + 17.7126 * v * v));
      return extinction[c] * clamp((1 - s * s) / (1 - g * s * s));
    });
  } else if (p.transmission_depth > 0) {
    const rate = inverseLength(p.transmission_depth, metersPerUnit);
    scattering = p.transmission_scatter.map(value => value * rate);
    const absorption = p.transmission_color.map((value, c) => -Math.log(Math.max(1e-12, value)) * rate - scattering[c]);
    const shift = Math.min(0, ...absorption);
    extinction = absorption.map((value, c) => value - shift + scattering[c]);
  } else {
    extinction = scattering = [0, 0, 0];
  }
  return { ior, kind, p, extinction, scattering, g, scatters:scattering.some(Boolean) };
}

function freeFlight(medium, boundary, channel, rng) {
  if (!medium.scatters) return { distance:boundary, weight:attenuation(medium.extinction, boundary), scatter:false };
  const selected = channel ?? Math.min(2, Math.floor(rng() * 3));
  const rate = medium.extinction[selected];
  const flight = rate ? -Math.log1p(-rng()) / rate : Infinity;
  const scatter = flight < boundary, distance = scatter ? flight : boundary;
  const tr = attenuation(medium.extinction, distance);
  const probabilities = scatter ? tr.map((t, c) => t * medium.extinction[c]) : tr;
  const pdf = channel === null ? (probabilities[0] + probabilities[1] + probabilities[2]) / 3 : probabilities[channel];
  const weight = tr.map((t,c) => pdf && (channel === null || channel === c) ? (t / pdf) * (scatter ? medium.scattering[c] : 1) : 0);
  return { distance, scatter, weight };
}

function phase(incoming, medium) {
  const { g } = medium;
  const basis = frame(incoming);
  function evaluate(out) {
    const cosine = clamp(dot(incoming, out), -1, 1);
    const pdf = (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * cosine) ** 1.5);
    return { pdf, weight:[pdf, pdf, pdf] };
  }
  function sample(rng) {
    const u = rng(), k = (1 - g * g) / (1 - g + 2 * g * u);
    const cosine = Math.abs(g) < 1e-4 ? 2 * u - 1 : (1 + g * g - k * k) / (2 * g);
    return direction(incoming, basis, clamp(cosine, -1, 1), tau * rng());
  }
  return { evaluate, sample };
}

function refract(view, h, eta, cosine) {
  const sin2 = eta * eta * (1 - cosine * cosine);
  if (sin2 >= 1) return null;
  return unit(along(scale(view, -eta), h, eta * cosine - Math.sqrt(1 - sin2)));
}

function cover(p, hit, view, optics) {
  if (!p.coat_weight && !p.fuzz_weight) return one;
  const nv = Math.max(0, dot(hit.n, view)), cnv = Math.max(0, dot(hit.coatNormal ?? hit.n, view));
  const coat = optics.coat(cnv);
  const fuzz = 1 - fuzzEnergy(p, blend(nv, cnv, p.coat_weight));
  return p.coat_color.map(v => fuzz * blend(1, coat.loss * v ** (.5 / Math.max(.01, coat.cos)), p.coat_weight));
}

function sheetDirection(view, ng, roughness, rng) {
  const axis = scale(view, -1);
  if (roughness <= .002) return axis;
  const cos = rng() ** (1 / (1 + 2 / roughness ** 4));
  const out = direction(axis, frame(axis), cos, tau * rng()), dn = dot(out, ng);
  return dn > 0 ? along(out, ng, -2 * dn) : out;
}

function transmission(hit, view, ambient, optics) {
  const { n, ng, tangent, m:{openPbr:p} } = hit;
  const dielectricWeight = 1 - p.base_metalness;
  const t = p.transmission_weight * dielectricWeight;
  const s = !p.geometry_thin_walled && p.subsurface_radius > 0 && p.subsurface_radius_scale.some(Boolean) ?
    (dielectricWeight - t) * p.subsurface_weight : 0;
  if (!(t || s)) return null;
  const full = t + s;
  const nv = clamp(dot(n, view));
  const fresnel = optics.reflection(nv);
  const loss = cover(p, hit, view, optics);
  const pure = full === 1 && !p.fuzz_weight && !p.coat_weight && fresnel.every(v => v === 0);
  const probability = pure ? 1 : clamp(full * (1 - luma(fresnel)) * luma(loss), .025, .95);
  const base = ggx(n, tangent, optics.roughness, p.specular_roughness_anisotropy, view);

  function sample(rng, channel, metersPerUnit, dispersionSample) {
    if (p.geometry_thin_walled) {
      const sheet = thinSheet(p, fresnel, transmittedCosine(nv, ambient, optics.totalIor));
      return { dir:sheetDirection(view, ng, optics.roughness, rng),
        weight:sheet.map((row, i) => row.transmission * loss[i] * t / probability), event:'thinTransmission' };
    }
    const isSubsurface = s > 0 && (!t || rng() * full >= t);
    const kind = isSubsurface ? 'subsurface' : 'transmission';
    const disperses = !isSubsurface && p.transmission_dispersion_scale > 0 && optics.totalIor !== 1;
    const chosen = disperses && channel === null ? (dispersionSample ?? Math.min(2, Math.floor(rng() * 3))) : channel;
    const ior = disperses ? cauchy(optics.totalIor, p.transmission_dispersion_scale, p.transmission_dispersion_abbe_number, chosen) :
      optics.totalIor;
    const eta = ambient / ior, smooth = optics.roughness <= .002 || eta === 1;
    const h = smooth ? n : base.half(rng);
    const cos = clamp(dot(view,h));
    if (cos <= 0) return null;
    const dir = refract(view,h,eta,cos);
    if (!dir || dot(ng,dir) >= 0) return null;
    const geom = smooth ? 1 : base.transportWeight(dir,h);
    const coating = optics.reflection(cos);
    const wavelengthFresnel = ior === optics.totalIor ? null : film(p,cos,ambient,ior);
    const referenceFresnel = wavelengthFresnel && film(p,cos,ambient,optics.totalIor);
    const interfacePass = wavelengthFresnel ?
      coating.map((v,i) => clamp(v + wavelengthFresnel[i] - referenceFresnel[i])) : coating;
    const tint = !isSubsurface && p.transmission_depth === 0 ? p.transmission_color : one;
    const weight = tint.map((v,i) => (1 - interfacePass[i]) * loss[i] * v * geom * eta * eta * full / probability);
    if (chosen !== channel) for (let i=0; i<3; i++) weight[i] *= i === chosen ? 3 : 0;
    return { dir, weight, channel:chosen, medium:mediumFor(p,kind,ior,metersPerUnit), event:kind,
      disperses:chosen !== channel };
  }
  return { probability, sample };
}

function leave(hit, view, interior, outside, channel, rng) {
  const { n, ng, tangent } = hit;
  const { p, ior } = interior;
  const eta = ior / outside, roughness = p.specular_roughness;
  const base = ggx(n,tangent,roughness,p.specular_roughness_anisotropy,view);
  const smooth = roughness <= .002 || eta === 1;
  const h = smooth ? n : base.half(rng), cos = clamp(dot(view,h));
  if (!cos) return null;
  const transmitted = refract(view,h,eta,cos);
  const reflected = film(p,cos,ior,outside);
  const probability = !transmitted ? 1 : channel === null ? luma(reflected) : reflected[channel];
  const reflect = probability >= 1 || (probability > 0 && rng() < probability);
  const dir = reflect ? along(scale(view,-1),h,2*cos) : transmitted;
  if ((reflect ? 1 : -1) * dot(ng,dir) <= 0) return null;
  const geom = smooth ? 1 : base.transportWeight(dir,h);
  const coatRatio = Math.max(.025,p.coat_ior) / outside;
  const cosOut = Math.abs(dot(n,dir));
  const coatCos = Math.max(.01,transmittedCosine(cosOut,1,coatRatio));
  const coatLoss = 1 - dielectric(cosOut,1,coatRatio);
  const fuzz = 1 - fuzzEnergy(p,cosOut);
  const weight = reflected.map((v,i) => reflect ? v * geom / probability :
    (1-v) * geom * eta * eta * fuzz * blend(1, coatLoss * p.coat_color[i] ** (.5 / coatCos),p.coat_weight) / (1-probability));
  return { dir, weight, exit:!reflect };
}

module.exports = { attenuation, freeFlight, phase, transmission, leave };
