const { dot, along, clamp, scale, cross, unit, luma, frame, direction, tau } = require('./physical-reference-math.js');
const { fresnel, fresnel0, dielectricFresnel } = require('./physical-openpbr.js');

function ggx(n, tangent, roughness, anisotropy, view) {
  const [t, b] = tangent ? [tangent, cross(n, tangent)] : frame(n);
  const ratio = 1 - anisotropy;
  const alpha = roughness * roughness * Math.sqrt(2 / (1 + ratio * ratio));
  const ax = Math.max(.002, alpha), ay = Math.max(.002, ratio * alpha);
  const nv = Math.max(.00001, dot(n, view));
  const projected = (d, cosine) => Math.hypot(ax * dot(d, t), ay * dot(d, b), cosine);
  const gv = projected(view, nv);
  function evaluate(out, h, vh, nl) {
    const nh = dot(n, h);
    if (nl <= 0 || nh <= 0) return [0, 0];
    const slope = (dot(h, t) / ax) ** 2 + (dot(h, b) / ay) ** 2 + nh * nh;
    const d = 1 / (Math.PI * ax * ay * slope * slope);
    return [d * nl / (2 * (nl * gv + nv * projected(out, nl))), d * nh / (4 * vh)];
  }
  function sample(rng) {
    const u = rng(), angle = tau * rng(), radius = Math.sqrt(u / (1 - u));
    const h = unit(along(along(n, t, ax * radius * Math.cos(angle)), b, ay * radius * Math.sin(angle)));
    const vh = dot(view, h);
    return vh > 0 ? along(scale(view, -1), h, 2 * vh) : null;
  }
  return { evaluate, sample };
}

function openPbrBrdf(hit, view) {
  const { n, ng, coatNormal, tangent, coatTangent, m: { color, openPbr: p } } = hit;
  const metal = p.base_metalness, cw = p.coat_weight, coatF0 = fresnel0(p.coat_ior);
  const nv = Math.max(.00001, dot(n, view)), cnv = Math.max(.00001, dot(coatNormal, view));
  const f0 = (1 - cw) * fresnel0(p.specular_ior) + cw * fresnel0(p.specular_ior / p.coat_ior);
  const dielectric = clamp(p.specular_weight * f0);
  const metalWeight = clamp(p.specular_weight), edge = p.specular_color;
  const roughness = p.specular_roughness, cr = p.coat_roughness;
  const baseRoughness = roughness + cw * (Math.min(1, roughness ** 4 + 2 * cr ** 4) ** .25 - roughness);
  const base = ggx(n, tangent, baseRoughness, p.specular_roughness_anisotropy, view);
  const coat = cw ? ggx(coatNormal, coatTangent, cr, p.coat_roughness_anisotropy, view) : null;
  const coatView = cw ? dielectricFresnel(coatF0, cnv) : 0;
  const baseSpec = color.map((v, i) => (1 - metal) * edge[i] * dielectric + metal * v * metalWeight);
  const diffuse = (1 - metal) * luma(color);
  const specular = Math.max(.02, luma(baseSpec) + .12 * (1 - nv) ** 5);
  const top = cw * Math.max(.02, coatView);
  const total = diffuse + specular + top;
  const chooseDiffuse = diffuse / total, chooseBase = specular / total, chooseCoat = top / total;
  const diffuseBasis = chooseDiffuse ? frame(n) : null;
  const sigma = p.base_diffuse_roughness;
  const diffuseA = 1 / (1 + (.5 - 2 / (3 * Math.PI)) * sigma);
  const darkening = cw * p.coat_darkening;
  const internal = Math.min(.95, coatF0 + .7 * Math.max(0, 1 - (1 / p.coat_ior) ** 2));
  const grazing = 1 / 7;

  function evaluate(out) {
    if (dot(ng, out) <= 0) return null;
    const nl = dot(n, out), cnl = dot(coatNormal, out);
    if (nl <= 0 && (!coat || cnl <= 0)) return null;
    const h = unit(along(view, out, 1)), vh = clamp(dot(view, h));
    if (vh <= 0) return null;
    const [baseResponse, basePdf] = base.evaluate(out, h, vh, nl);
    const [coatResponse, coatPdf] = coat ? coat.evaluate(out, h, vh, cnl) : [0, 0];
    const coatIncoming = coat ? dielectricFresnel(coatF0, cnl) : 0;
    const coatTransmission = (1 - coatView) * (1 - coatIncoming);
    const coatReflection = cw * coatResponse * dielectricFresnel(coatF0, vh);
    const s = dot(view, out) - nv * nl;
    const diffuseResponse = Math.max(0, nl) * diffuseA *
      (1 + sigma * s / (s > 0 ? Math.max(nv, nl) : 1)) / Math.PI;
    const dielectricReflection = dielectricFresnel(dielectric, vh);
    const edgeProfile = (vh / grazing) * ((1 - vh) / (1 - grazing)) ** 6;
    const pdf = chooseDiffuse * Math.max(0, nl) / Math.PI + chooseBase * basePdf + chooseCoat * coatPdf;
    const weight = color.map((v, i) => {
      const d = dielectricReflection * edge[i];
      const m = metalWeight * clamp(fresnel(v, vh) - edgeProfile * (1 - edge[i]) * fresnel(v, grazing));
      const substrate = baseResponse * ((1 - metal) * d + metal * m) +
        diffuseResponse * (1 - metal) * v * (1 - d);
      const internalLoss = 1 - darkening * (1 - (1 - internal) / (1 - v * internal));
      const tint = p.coat_color[i];
      return coatReflection + substrate * ((1 - cw) + cw * tint * coatTransmission) * internalLoss;
    });
    return { pdf, weight };
  }
  function sample(rng) {
    const pick = rng();
    if (pick < chooseDiffuse) return direction(n, diffuseBasis, Math.sqrt(1 - rng()), tau * rng());
    return pick < chooseDiffuse + chooseBase || !coat ? base.sample(rng) : coat.sample(rng);
  }
  return { evaluate, sample };
}

module.exports = { openPbrBrdf };
